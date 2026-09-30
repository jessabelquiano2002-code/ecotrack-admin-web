/*
 * Shared operations data layer for Reports & Analytics.
 *
 * BOTH the Live Dashboard and the Generate Report tab must use these
 * functions so that collection counts, completion rates, complaint counts,
 * open issues, date ranges and barangay matching always agree.
 *
 * Rules implemented here (single source of truth):
 *  - A "collection run" = a final collection_reports record, or a terminal
 *    route_sessions record that has no report yet. route_status_updates are a
 *    field-status log and are NOT collection runs.
 *  - Optional legacy paths (pickup_records, missed_pickups) are merged in as
 *    collection runs when INCLUDE_LEGACY_PICKUP_PATHS is true.
 *  - Fully completed = status "completed" AND no unclaimed Puroks.
 *    Partial = status "partial" OR any unclaimed Purok.
 *  - Complaints from complaints / resident_issues / report_issues that are
 *    written to more than one path are de-duplicated into one record.
 *  - Dates use local time (Asia/Manila deployment); records without a
 *    timestamp are excluded from a dated range.
 */

/** Set to false if pickup_records / missed_pickups are only legacy mirrors of collection_reports. */
export const INCLUDE_LEGACY_PICKUP_PATHS = true;

export const COMPLAINT_SOURCES = new Set(["Complaint", "Resident Issue", "Reported Issue"]);

export type AnyItem = Record<string, any>;

export type RangeFilter = "today" | "7d" | "30d" | "90d" | "custom" | "all";

export type GpsPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

export type GpsTrace = {
  scheduleId: string;
  sessionId: string;
  points: GpsPoint[];
  startTimestamp: number;
  endTimestamp: number;
};

export type CollectionRecord = {
  id: string;
  sessionId: string;
  scheduleId: string;
  routeId: string;
  routeName: string;
  driverId: string;
  driverName: string;
  truckId: string;
  barangay: string;
  barangays: string[];
  assignedPuroks: string[];
  claimedPuroks: string[];
  unclaimedPuroks: string[];
  status: "completed" | "partial" | "missed" | "pending";
  timestamp: number;
  startTime: number;
  completedAt: number;
  truckLoadPercent: number | null;
  truckLoadLabel: string;
  completionReason: string;
  collectionCondition: string;
  distanceMeters: number;
  durationSeconds: number;
  hasGps: boolean;
  gpsPointCount: number;
};

export type IssueRecord = {
  id: string;
  source: string;
  driverId: string;
  driverName: string;
  barangay: string;
  barangays: string[];
  puroks: string[];
  type: string;
  severity: string;
  status: string;
  details: string;
  timestamp: number;
  resolvedAt: number;
  isOpen: boolean;
  isHighImpact: boolean;
};

export type ScheduleRecord = {
  id: string;
  title: string;
  barangay: string;
  barangays: string[];
  puroks: string[];
  driverId: string;
  driverName: string;
  truckId: string;
  routeId: string;
  status: string;
  lastRunStatus: string;
  lastCompletedAt: number;
};

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function toArray(data: unknown): AnyItem[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter(Boolean).map((item, index) => ({
      id: String((item as AnyItem)?.id || index),
      ...(typeof item === "object" && item !== null ? item : { value: item }),
    }));
  }
  if (typeof data === "object") {
    return Object.entries(data as Record<string, unknown>).map(([id, value]) => ({
      id,
      ...(typeof value === "object" && value !== null ? value : { value }),
    }));
  }
  return [];
}

export function flattenPendingSummaries(data: unknown): AnyItem[] {
  const result: AnyItem[] = [];
  const root = objectValue(data);
  Object.entries(root).forEach(([driverKey, schedulesRaw]) => {
    const schedules = objectValue(schedulesRaw);
    Object.entries(schedules).forEach(([scheduleKey, summaryRaw]) => {
      const summary = objectValue(summaryRaw);
      result.push({
        id: `${driverKey}:${scheduleKey}`,
        _driverKey: driverKey,
        _scheduleKey: scheduleKey,
        ...summary,
      });
    });
  });
  return result;
}

export function flattenRouteSessions(data: unknown): AnyItem[] {
  const result: AnyItem[] = [];
  const schedules = objectValue(data);

  Object.entries(schedules).forEach(([scheduleId, sessionsRaw]) => {
    const sessions = objectValue(sessionsRaw);

    Object.entries(sessions).forEach(([sessionId, sessionRaw]) => {
      const session = objectValue(sessionRaw);
      result.push({
        id: sessionId,
        sessionId,
        scheduleId,
        ...session,
      });
    });
  });

  return result;
}

export function isTerminalRouteSession(item: AnyItem): boolean {
  const status = normalizedStatus(item.routeStatus ?? item.status ?? item.collectionStatus);
  return status === "completed" || status === "partial" || status === "missed";
}

export function parseGpsHistory(data: unknown): GpsTrace[] {
  const traces: GpsTrace[] = [];
  const schedules = objectValue(data);

  Object.entries(schedules).forEach(([scheduleId, sessionsRaw]) => {
    const sessions = objectValue(sessionsRaw);
    Object.entries(sessions).forEach(([sessionId, sessionRaw]) => {
      const session = objectValue(sessionRaw);
      const pointsRaw = objectValue(session.points);
      const points: GpsPoint[] = [];

      Object.values(pointsRaw).forEach((pointRaw) => {
        const point = objectValue(pointRaw);
        const latitude = finiteNumber(point.latitude ?? point.lat);
        const longitude = finiteNumber(point.longitude ?? point.lng);
        const timestamp = normalizeTimestamp(point.timestamp ?? point.recordedAt ?? point.lastUpdated);
        if (latitude === null || longitude === null) return;
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
        points.push({ latitude, longitude, timestamp });
      });

      points.sort((a, b) => a.timestamp - b.timestamp);
      if (points.length === 0) return;

      traces.push({
        scheduleId,
        sessionId,
        points,
        startTimestamp: points[0]?.timestamp || 0,
        endTimestamp: points.at(-1)?.timestamp || 0,
      });
    });
  });

  return traces;
}

export function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function nonNegativeNumber(value: unknown): number {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : 0;
}

export function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function bestTimestamp(item: AnyItem): number {
  return normalizeTimestamp(
    item.completedAt ??
      item.timestamp ??
      item.updatedAt ??
      item.createdAt ??
      item.reportedAt ??
      item.submittedAt ??
      item.capturedAt ??
      item.startTime ??
      item.date,
  );
}

export function cleanText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return fallback;
  return text;
}

export function normalizeTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(String).map((item) => item.trim()).filter(Boolean));

  if (value && typeof value === "object") {
    const values = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item === true || item === "true" || item === 1 || item === "1") return key;
        if (typeof item === "string" || typeof item === "number") return String(item);
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean);
    return unique(values);
  }

  if (typeof value === "string") {
    return unique(
      value
        .split(/[,;|]/g)
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  return [];
}

export function normalizePurok(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/all\s*purok/i.test(raw)) return "All Puroks";
  const match = raw.match(/purok\s*(\d+)/i) || raw.match(/^\s*(\d+)\s*$/);
  return match ? `Purok ${Number(match[1])}` : raw;
}

export function purokList(item: AnyItem): string[] {
  const direct =
    item.assignedPuroks ??
    item.claimedPuroks ??
    item.visitedPuroks ??
    item.puroks ??
    item.location?.puroks;

  const values = normalizeTextArray(direct).map(normalizePurok).filter(Boolean);
  if (values.length > 0) return unique(values);

  const single = normalizePurok(item.purok ?? item.purokLabel ?? item.purokName ?? item.zone);
  return single && single !== "All Puroks" ? [single] : [];
}

export function barangaysList(item: AnyItem): string[] {
  const direct = [
    ...normalizeTextArray(item.barangay),
    ...normalizeTextArray(item.barangays),
    ...normalizeTextArray(item.location?.barangay),
    ...normalizeTextArray(item.location?.barangays),
    ...normalizeTextArray(item.assignedBarangay),
    ...normalizeTextArray(item.assignedBarangays),
    ...normalizeTextArray(item.addressBarangay),
    ...normalizeTextArray(item.targetBarangay),
    ...normalizeTextArray(item.targetBarangays),
    ...normalizeTextArray(item.area),
  ];

  const coverage = item.coverageByBarangay;
  const fromCoverage =
    coverage && typeof coverage === "object"
      ? Object.entries(coverage as Record<string, any>).map(([storedKey, value]) =>
          cleanText((value && typeof value === "object" ? value.barangay : undefined) ?? storedKey),
        )
      : [];

  return unique([...direct, ...fromCoverage].filter(Boolean));
}

export function barangayText(item: AnyItem): string {
  const [first] = barangaysList(item);
  return first || "Unspecified Barangay";
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function normalizedStatus(value: unknown): string {
  const status = cleanText(value).toLowerCase();
  if (!status) return "pending";
  if (status.includes("partial")) return "partial";
  if (status.includes("complete") || status === "done" || status === "finished" || status === "collected") return "completed";
  if (status.includes("miss") || status.includes("failed") || status.includes("not collected")) return "missed";
  if (status.includes("resolve") || status.includes("closed") || status.includes("fixed")) return "resolved";
  if (status.includes("cancel") || status.includes("inactive") || status.includes("deleted")) return "cancelled";
  if (status.includes("progress") || status.includes("ongoing") || status.includes("active") || status.includes("assigned")) return "active";
  if (status.includes("open") || status.includes("new")) return "open";
  return status;
}

export function truckLoadPercent(item: AnyItem): number | null {
  const candidates = [item.truckLoadPercent, item.loadPercent, item.vehicleLoadPercent];
  for (const value of candidates) {
    const numeric = finiteNumber(value);
    if (numeric !== null && numeric >= 0 && numeric <= 100) return numeric;
  }

  const label = cleanText(item.truckLoadLabel ?? item.truckLoadFraction ?? item.loadFraction).toLowerCase();
  if (!label) return null;
  if (label.includes("full") || label === "1" || label === "1/1") return 100;
  if (label.includes("3/4") || label.includes("75")) return 75;
  if (label.includes("1/2") || label.includes("50")) return 50;
  if (label.includes("1/4") || label.includes("25")) return 25;
  return null;
}

export function isFullTruck(item: { truckLoadPercent: number | null; truckLoadLabel: string; completionReason: string; collectionCondition: string }): boolean {
  const text = `${item.truckLoadLabel} ${item.completionReason} ${item.collectionCondition}`.toLowerCase();
  return (item.truckLoadPercent ?? 0) >= 100 || text.includes("truck_full") || text.includes("full truck") || text.includes("full capacity");
}

export function formatDate(value: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function localDayStart(value: string): number {
  if (!value) return 0;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

export function localDayEnd(value: string): number {
  if (!value) return 0;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export function reportBounds(range: RangeFilter, customFrom: string, customTo: string): { from: number; to: number; label: string } {
  const now = new Date();
  const end = Date.now();

  if (range === "all") return { from: 0, to: end, label: "All available operational records" };

  if (range === "custom") {
    const from = localDayStart(customFrom);
    const to = localDayEnd(customTo || customFrom);
    if (from > 0 && to >= from) {
      return { from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
    }
    return { from: 0, to: end, label: "Custom range not selected" };
  }

  if (range === "today") {
    const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: fromDate.getTime(), to: end, label: `Today • ${formatDate(fromDate.getTime())}` };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  return { from: start.getTime(), to: end, label: `Last ${days} days` };
}

export function timestampInBounds(timestamp: number, bounds: { from: number; to: number }): boolean {
  if (!timestamp) return bounds.from === 0;
  return timestamp >= bounds.from && timestamp <= bounds.to;
}

export function nearestRecord(records: AnyItem[], driverId: string, scheduleId: string, timestamp: number): AnyItem | null {
  const candidates = records.filter((item) => {
    const candidateDriver = cleanText(item.driverId ?? item._driverKey);
    const candidateSchedule = cleanText(item.scheduleId ?? item._scheduleKey);
    return candidateDriver === driverId && candidateSchedule === scheduleId;
  });

  let best: AnyItem | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  candidates.forEach((item) => {
    const itemTime = bestTimestamp(item);
    const gap = timestamp && itemTime ? Math.abs(timestamp - itemTime) : 0;
    if (gap <= 12 * 60 * 60 * 1000 && gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  });
  return best;
}

export function issueImpact(item: AnyItem): boolean {
  const severity = cleanText(item.severity ?? item.priority).toLowerCase();
  const type = cleanText(item.issueType ?? item.type ?? item.category).toLowerCase();
  return (
    severity.includes("critical") ||
    severity.includes("urgent") ||
    severity.includes("high") ||
    type.includes("truck full") ||
    type.includes("hazard") ||
    type.includes("accident") ||
    type.includes("overflow") ||
    type.includes("illegal dumping") ||
    type.includes("missed")
  );
}

export function isCleanCompletion(item: Pick<CollectionRecord, "status" | "unclaimedPuroks">): boolean {
  return item.status === "completed" && item.unclaimedPuroks.length === 0;
}

export function isPartialRun(item: Pick<CollectionRecord, "status" | "unclaimedPuroks">): boolean {
  return item.status === "partial" || item.unclaimedPuroks.length > 0;
}

export type DriverLookup = Map<string, { name: string; truck: string }>;

export function buildCollectionRecords(input: {
  collectionReports: AnyItem[];
  /** Additional final-report paths (e.g. waste_collection_reports). De-duplicated by session/report id. */
  extraCollectionReports?: AnyItem[];
  routeSessions: AnyItem[];
  pendingSummaries: AnyItem[];
  truckFullAlerts: AnyItem[];
  driverMap: DriverLookup;
  gpsBySession: Map<string, GpsTrace>;
  pickupRecords?: AnyItem[];
  missedPickups?: AnyItem[];
}): CollectionRecord[] {
  const { routeSessions, pendingSummaries, truckFullAlerts, driverMap, gpsBySession } = input;
  const collectionReports: AnyItem[] = [
    ...input.collectionReports,
    ...(input.extraCollectionReports || []).map((item) => {
      const hasOwnKey = cleanText(item.sessionId ?? item.reportId);
      return hasOwnKey ? item : { ...item, id: `waste_collection_reports:${cleanText(item.id)}` };
    }),
  ];

  const routeSessionBySession = new Map<string, AnyItem>(
    routeSessions.map((item) => [cleanText(item.sessionId ?? item.id), item]),
  );

  const sourceMap = new Map<string, AnyItem>();

  collectionReports.forEach((item) => {
    const sessionId = cleanText(item.sessionId ?? item.reportId ?? item.id);
    const key = sessionId || `report:${cleanText(item.id)}`;
    sourceMap.set(key, { ...item, sessionId: sessionId || cleanText(item.id), _source: "collection_reports" });
  });

  routeSessions.forEach((session) => {
    if (!isTerminalRouteSession(session)) return;
    const sessionId = cleanText(session.sessionId ?? session.id);
    if (!sessionId || sourceMap.has(sessionId)) return;

    sourceMap.set(sessionId, {
      ...session,
      id: sessionId,
      reportId: sessionId,
      sessionId,
      collectionStatus: session.routeStatus ?? session.status,
      completedAt: session.completedAt ?? session.endTime ?? session.updatedAt ?? session.lastUpdateTime,
      timestamp: session.completedAt ?? session.endTime ?? session.updatedAt ?? session.lastUpdateTime ?? session.startTime,
      _source: "route_sessions_fallback",
    });
  });

  if (INCLUDE_LEGACY_PICKUP_PATHS) {
    const addLegacy = (item: AnyItem, path: string, forcedStatus?: string) => {
      const linkedSession = cleanText(item.sessionId);
      if (linkedSession && sourceMap.has(linkedSession)) return; // already counted from the real session
      const id = `${path}:${cleanText(item.id)}`;
      if (sourceMap.has(id)) return;
      sourceMap.set(id, {
        ...item,
        id,
        reportId: id,
        sessionId: id,
        collectionStatus: forcedStatus ?? item.collectionStatus ?? item.pickupStatus ?? item.status ?? "completed",
        timestamp: bestTimestamp(item),
        _source: path,
      });
    };
    (input.pickupRecords || []).forEach((item) => addLegacy(item, "pickup_records"));
    (input.missedPickups || []).forEach((item) => addLegacy(item, "missed_pickups", "missed"));
  }

  const mergedCollectionSources = Array.from(sourceMap.values());

    return mergedCollectionSources.map((item) => {
      const id = cleanText(item.reportId ?? item.sessionId ?? item.id);
      const sessionId = cleanText(item.sessionId ?? item.reportId ?? item.id);
      const routeSession = routeSessionBySession.get(sessionId) || {};
      const scheduleId = cleanText(item.scheduleId ?? routeSession.scheduleId);
      const driverId = cleanText(item.driverId ?? item.uid ?? routeSession.driverId ?? routeSession.uid);
      const timestamp = bestTimestamp({ ...routeSession, ...item });
      const summary = nearestRecord(pendingSummaries, driverId, scheduleId, timestamp);
      const summaryItem = summary || {};
      const profile = driverMap.get(driverId);
      const alert = nearestRecord(truckFullAlerts, driverId, scheduleId, timestamp);
      const trace = gpsBySession.get(sessionId);

      /*
       * Final collection_reports are authoritative. The temporary
       * pending_collection_summaries path is only a fallback while a finish
       * request is still being finalized by the Driver app/API.
       */
      const assignedPuroks = normalizeTextArray(
        item.assignedPuroks ??
        item.puroks ??
        routeSession.assignedPuroks ??
        routeSession.puroks ??
        summaryItem.assignedPuroks ??
        summaryItem.puroks,
      ).map(normalizePurok).filter(Boolean);

      const claimedPuroks = normalizeTextArray(
        item.claimedPuroks ??
        item.visitedPuroks ??
        routeSession.claimedPuroks ??
        routeSession.visitedPuroks ??
        summaryItem.claimedPuroks ??
        summaryItem.visitedPuroks,
      ).map(normalizePurok).filter(Boolean);

      const unclaimedPuroks = normalizeTextArray(
        item.unclaimedPuroks ??
        routeSession.unclaimedPuroks ??
        summaryItem.unclaimedPuroks ??
        alert?.unclaimedPuroks,
      ).map(normalizePurok).filter(Boolean);

      const itemHasLoad =
        finiteNumber(item.truckLoadPercent) !== null ||
        Boolean(cleanText(item.truckLoadLabel ?? item.truckLoadFraction));
      const routeSessionHasLoad =
        finiteNumber(routeSession.truckLoadPercent) !== null ||
        Boolean(cleanText(routeSession.truckLoadLabel ?? routeSession.truckLoadFraction));

      const loadSource = itemHasLoad
        ? item
        : routeSessionHasLoad
          ? routeSession
          : Object.keys(summaryItem).length > 0
            ? summaryItem
            : alert || {};

      const loadPercent = truckLoadPercent(loadSource);
      const loadLabel = cleanText(
        item.truckLoadLabel ??
        item.truckLoadFraction ??
        routeSession.truckLoadLabel ??
        routeSession.truckLoadFraction ??
        summaryItem.truckLoadLabel ??
        summaryItem.truckLoadFraction ??
        alert?.truckLoadLabel,
        loadPercent === 100 ? "Full truck" : loadPercent === 75 ? "3/4 truck" : loadPercent === 50 ? "1/2 truck" : loadPercent === 25 ? "1/4 truck" : "Not recorded",
      );

      const completionReason = cleanText(
        item.completionReason ??
        routeSession.completionReason ??
        summaryItem.completionReason ??
        alert?.completionReason,
      );

      const collectionCondition = cleanText(
        item.collectionCondition ??
        routeSession.collectionCondition ??
        summaryItem.collectionCondition ??
        alert?.collectionCondition,
      );

      const rawStatus = normalizedStatus(
        item.collectionStatus ??
        item.routeStatus ??
        item.status ??
        routeSession.collectionStatus ??
        routeSession.routeStatus ??
        routeSession.status,
      );

      let status: CollectionRecord["status"] =
        rawStatus === "missed" ? "missed" :
        rawStatus === "partial" ? "partial" :
        rawStatus === "completed" ? "completed" :
        "pending";

      if (
        unclaimedPuroks.length > 0 ||
        completionReason.toLowerCase().includes("partial") ||
        (completionReason.toLowerCase().includes("truck_full") && unclaimedPuroks.length > 0)
      ) {
        status = "partial";
      }

      return {
        id,
        sessionId,
        scheduleId,
        routeId: cleanText(item.routeId ?? routeSession.routeId),
        routeName: cleanText(item.routeName ?? item.scheduleName ?? routeSession.routeName ?? routeSession.scheduleName, "Collection route"),
        driverId,
        driverName: cleanText(item.driverName ?? routeSession.driverName ?? summaryItem.driverName ?? profile?.name, "Driver"),
        truckId: cleanText(
          item.truckId ??
          item.truck ??
          routeSession.truckId ??
          routeSession.truck ??
          summaryItem.truckId ??
          summaryItem.truck ??
          profile?.truck,
          "Unassigned",
        ),
        barangay: barangayText({ ...summaryItem, ...routeSession, ...item }),
        barangays: barangaysList({ ...summaryItem, ...routeSession, ...item }),
        assignedPuroks: unique(assignedPuroks),
        claimedPuroks: unique(claimedPuroks),
        unclaimedPuroks: unique(unclaimedPuroks),
        status,
        timestamp,
        startTime: normalizeTimestamp(item.startTime ?? routeSession.startTime),
        completedAt: normalizeTimestamp(
          item.completedAt ??
          item.endTime ??
          routeSession.completedAt ??
          routeSession.endTime ??
          item.timestamp ??
          routeSession.timestamp,
        ),
        truckLoadPercent: loadPercent,
        truckLoadLabel: loadLabel,
        completionReason,
        collectionCondition,
        distanceMeters: nonNegativeNumber(
          item.distanceTravelledMeters ??
          item.distanceMeters ??
          routeSession.distanceTravelledMeters ??
          routeSession.distanceMeters,
        ),
        durationSeconds: nonNegativeNumber(
          item.durationSeconds ??
          routeSession.durationSeconds,
        ),
        hasGps: Boolean(trace && trace.points.length >= 2),
        gpsPointCount: trace?.points.length || 0,
      };
    });
}

export function buildIssueRecords(input: {
  issues: AnyItem[];
  residentIssues: AnyItem[];
  reportIssues: AnyItem[];
  complaints: AnyItem[];
}): IssueRecord[] {
  const build = (item: AnyItem, source: string): IssueRecord => {
    const status = normalizedStatus(item.status ?? item.issueStatus ?? "open");
    return {
      id: `${source}:${cleanText(item.id)}`,
      source,
      driverId: cleanText(item.driverId ?? item.uid),
      driverName: cleanText(item.driverName, ""),
      barangay: barangayText(item),
      barangays: barangaysList(item),
      puroks: purokList(item),
      type: cleanText(item.issueType ?? item.type ?? item.category, "General operational issue"),
      severity: cleanText(item.severity ?? item.priority, "Normal"),
      status,
      details: cleanText(item.details ?? item.description ?? item.message ?? item.note, ""),
      timestamp: bestTimestamp(item),
      // Time the case was closed. Only meaningful when the case is no longer open.
      resolvedAt: ["resolved", "closed"].includes(status)
        ? normalizeTimestamp(item.resolvedAt ?? item.resolved_at ?? item.closedAt ?? item.completedAt)
        : 0,
      isOpen: !["resolved", "closed", "cancelled"].includes(status),
      isHighImpact: issueImpact(item),
    };
  };

  const operational = input.issues.map((item) => build(item, "Driver/Admin Issue"));

  // The same complaint can be written to several paths. Keep one record,
  // preferring the official "complaints" record.
  const uniqueComplaints = new Map<string, IssueRecord>();
  [
    ...input.residentIssues.map((item) => build(item, "Resident Issue")),
    ...input.reportIssues.map((item) => build(item, "Reported Issue")),
    ...input.complaints.map((item) => build(item, "Complaint")),
  ].forEach((item) => {
    const signature = [
      item.timestamp,
      item.barangay.toLowerCase(),
      item.puroks.join(",").toLowerCase(),
      item.type.toLowerCase(),
      item.details.toLowerCase().slice(0, 160),
    ].join("|");
    const existing = uniqueComplaints.get(signature);
    if (!existing || item.source === "Complaint") uniqueComplaints.set(signature, item);
  });

  return [...operational, ...Array.from(uniqueComplaints.values())];
}

export function buildScheduleRecords(schedules: AnyItem[]): ScheduleRecord[] {
  return schedules.map((item) => ({
    id: cleanText(item.id),
    title: cleanText(item.title ?? item.name ?? item.scheduleName, "Collection schedule"),
    barangay: barangayText(item),
    barangays: barangaysList(item),
    puroks: purokList(item),
    driverId: cleanText(item.driverId ?? item.assignedDriverId),
    driverName: cleanText(item.driverName ?? item.assignedDriverName, "Unassigned"),
    truckId: cleanText(item.truckId ?? item.truck ?? item.vehicle, "Unassigned"),
    routeId: cleanText(item.routeId ?? item.assignedRouteId),
    status: normalizedStatus(item.status ?? "active"),
    lastRunStatus: normalizedStatus(item.lastRunStatus ?? item.routeStatus),
    lastCompletedAt: normalizeTimestamp(item.lastCompletedAt ?? item.lastCompletedDate),
  }));
}

export type ScopeFilters = { barangay: string; driver: string; truck: string };

export function scopeCollections(
  items: CollectionRecord[],
  bounds: { from: number; to: number },
  filters: ScopeFilters,
): CollectionRecord[] {
  return items.filter((item) => {
    if (!timestampInBounds(item.timestamp, bounds)) return false;
    if (filters.barangay !== "all" && !item.barangays.includes(filters.barangay)) return false;
    if (filters.driver !== "all" && item.driverId !== filters.driver) return false;
    if (filters.truck !== "all" && item.truckId !== filters.truck) return false;
    return true;
  });
}

export function scopeIssues(
  items: IssueRecord[],
  bounds: { from: number; to: number },
  filters: Pick<ScopeFilters, "barangay" | "driver">,
): IssueRecord[] {
  return items.filter((item) => {
    const dateMatch = item.timestamp ? timestampInBounds(item.timestamp, bounds) : item.isOpen;
    if (!dateMatch) return false;
    if (filters.barangay !== "all" && !item.barangays.includes(filters.barangay)) return false;
    if (filters.driver !== "all" && item.driverId && item.driverId !== filters.driver) return false;
    return true;
  });
}

export function scopeSchedules(items: ScheduleRecord[], filters: ScopeFilters): ScheduleRecord[] {
  return items.filter((item) => {
    if (["cancelled", "inactive", "deleted"].includes(item.status)) return false;
    if (filters.barangay !== "all" && !item.barangays.includes(filters.barangay)) return false;
    if (filters.driver !== "all" && item.driverId !== filters.driver) return false;
    if (filters.truck !== "all" && item.truckId !== filters.truck) return false;
    return true;
  });
}
