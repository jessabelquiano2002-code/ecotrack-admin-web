"use client";

import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";

type AnyItem = Record<string, any>;
type RangeFilter = "today" | "7d" | "30d" | "90d" | "custom" | "all";
type ReportType = "complete" | "collection" | "drivers" | "capacity" | "issues" | "complaints" | "schedules" | "gps";
type Priority = "Critical" | "High" | "Monitor" | "Stable";

type GpsPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type GpsTrace = {
  scheduleId: string;
  sessionId: string;
  points: GpsPoint[];
  startTimestamp: number;
  endTimestamp: number;
};

type DriverProfile = {
  id: string;
  name: string;
  truck: string;
  status: string;
  trackingActive: boolean;
  activeSessionId: string;
  activeScheduleId: string;
  activeRouteId: string;
  lastGpsAt: number;
};

type CollectionRecord = {
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

type IssueRecord = {
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
  isOpen: boolean;
  isHighImpact: boolean;
};

type ComplaintHotspotRow = {
  barangay: string;
  total: number;
  open: number;
  resolved: number;
  highImpact: number;
  topCategory: string;
  latestAt: number;
  share: number;
};

type ProblemAreaRow = {
  barangay: string;
  complaints: number;
  missedCollections: number;
  openOperationalIssues: number;
  indicatorTotal: number;
  primaryConcern: string;
};

type MonthlyOpsSnapshot = {
  label: string;
  from: number;
  to: number;
  collectionRuns: number;
  completedRuns: number;
  completionRate: number;
  complaints: number;
  truckFullEvents: number;
  gpsVerifiedRuns: number;
  gpsVerificationRate: number;
  attendanceTotal: number;
  attendancePresent: number;
  attendanceLate: number;
  attendanceAbsent: number;
  attendanceIncomplete: number;
};

type MonthlyComparison = {
  current: MonthlyOpsSnapshot;
  previous: MonthlyOpsSnapshot;
};

type SvgBarDatum = {
  label: string;
  value: number;
};

type SystemSnapshot = {
  drivers: number;
  residents: number;
  activeRoutes: number;
  serviceBarangays: number;
  servicePuroks: number;
  activeSchedules: number;
  collectionRuns: number;
  complaints: number;
  openIssues: number;
  notifications: number;
  gpsSessions: number;
  attendanceRecords: number;
  lateAttendance: number;
  incompleteAttendance: number;
  complianceViolations: number;
  openViolations: number;
  wastePoints: number;
  activeWastePoints: number;
  routeStatusUpdates: number;
  activityReportRequests: number;
  pendingActivityRequests: number;
  activityReports: number;
};

type AttendanceRecord = AnyItem & {
  sourceDriverKey?: string;
  dateKey?: string;
};

type FullSystemSummary = {
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
    incomplete: number;
    completedDuty: number;
    averageDutyMinutes: number;
  };
  compliance: {
    total: number;
    open: number;
    resolved: number;
    issued: number;
    paid: number;
  };
  wastePoints: {
    total: number;
    active: number;
    inactive: number;
    barangays: number;
  };
  routeUpdates: {
    total: number;
    active: number;
    completed: number;
    problem: number;
  };
  activityReports: {
    requests: number;
    pending: number;
    sent: number;
    failed: number;
    generatedReports: number;
  };
  notifications: {
    total: number;
    unread: number;
    resident: number;
    driver: number;
    admin: number;
  };
};

type ResidentCoverageRow = {
  barangay: string;
  residents: number;
  servicePuroks: number;
  activeSchedules: number;
  complaints: number;
  openIssues: number;
  collectionRuns: number;
  completionRate: number;
  activeWastePoints: number;
  assessment: string;
};

type ScheduleRecord = {
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

type AreaRow = {
  key: string;
  barangay: string;
  purok: string;
  trips: number;
  completed: number;
  partial: number;
  missed: number;
  followUpPuroks: string[];
  completionRate: number;
  averageLoad: number | null;
  fullTruckEvents: number;
  openIssues: number;
  highImpactIssues: number;
  activeSchedules: number;
  gpsTrips: number;
  distanceMeters: number;
  priority: Priority;
  priorityScore: number;
  recommendation: string;
  reasons: string[];
};

type DriverRow = {
  key: string;
  driverId: string;
  driverName: string;
  trucks: string[];
  barangays: string[];
  trips: number;
  completed: number;
  partial: number;
  missed: number;
  completionRate: number;
  averageLoad: number | null;
  fullTruckEvents: number;
  openIssues: number;
  activeSchedules: number;
  gpsTrips: number;
  distanceMeters: number;
  durationSeconds: number;
  currentStatus: string;
  trackingActive: boolean;
  activeScheduleId: string;
  lastGpsAt: number;
  assessment: "Good" | "Monitor" | "Review";
};

type TruckRow = {
  key: string;
  truckId: string;
  trips: number;
  completed: number;
  partial: number;
  averageLoad: number | null;
  fullTruckEvents: number;
  barangays: string[];
  drivers: string[];
  distanceMeters: number;
  assessment: "Normal" | "Monitor" | "Capacity Review";
};

type SchedulePerformanceRow = {
  id: string;
  title: string;
  barangay: string;
  puroks: string[];
  driverName: string;
  truckId: string;
  status: string;
  trips: number;
  completed: number;
  partial: number;
  completionRate: number;
  lastActivity: number;
  assessment: string;
};

type ReportSummary = {
  totalTrips: number;
  completedTrips: number;
  partialTrips: number;
  missedTrips: number;
  completionRate: number;
  truckFullEvents: number;
  followUpPuroks: number;
  openIssues: number;
  activeSchedules: number;
  activeDrivers: number;
  onlineDrivers: number;
  trackingDrivers: number;
  gpsVerifiedTrips: number;
  gpsVerificationRate: number;
  averageTruckLoad: number | null;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
};

const REPORT_TYPES: Array<{ value: ReportType; label: string; description: string }> = [
  { value: "complete", label: "Full System Agency Report", description: "Detailed administrator view of field operations, drivers, residents, attendance, compliance, routes, schedules, complaints, notifications, waste points, activity reports, and GPS." },
  { value: "collection", label: "Collection Performance", description: "Barangay and Purok completion, missed service, and required follow-up." },
  { value: "drivers", label: "Driver Operations", description: "Driver activity, assignments, collection completion, and GPS evidence." },
  { value: "capacity", label: "Truck Capacity", description: "Operational truck-load pressure using 1/4, 1/2, 3/4, and Full estimates." },
  { value: "issues", label: "Issues & Complaints", description: "Open and resolved operational issues reported by residents and drivers." },
  { value: "complaints", label: "Complaint Hotspots", description: "Identify which Barangays record the most complaints, open cases, and recurring complaint categories." },
  { value: "schedules", label: "Schedule Performance", description: "Current service coverage compared with actual collection execution." },
  { value: "gps", label: "GPS Activity", description: "Recorded collection-session route traces and field activity evidence." },
];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toArray(data: unknown): AnyItem[] {
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

function countServiceAreaCatalog(data: unknown): { barangays: number; puroks: number } {
  const root = objectValue(data);
  let barangays = 0;
  let puroks = 0;

  Object.values(root).forEach((raw) => {
    const item = objectValue(raw);
    const active = item.active;
    if (active === false || String(active).toLowerCase() === "false") return;

    const barangay = cleanText(item.barangay ?? item.name ?? item.label);
    if (barangay) barangays += 1;

    const purokRoot = objectValue(item.puroks);
    Object.values(purokRoot).forEach((purokRaw) => {
      const purok = objectValue(purokRaw);
      const purokActive = purok.active;
      if (purokActive === false || String(purokActive).toLowerCase() === "false") return;
      if (cleanText(purok.purok ?? purok.name ?? purok.label)) puroks += 1;
    });
  });

  return { barangays, puroks };
}

function flattenDriverAttendance(data: unknown): AttendanceRecord[] {
  const result: AttendanceRecord[] = [];
  const root = objectValue(data);

  Object.entries(root).forEach(([driverKey, datesRaw]) => {
    const dates = objectValue(datesRaw);
    Object.entries(dates).forEach(([dateKey, recordRaw]) => {
      const record = objectValue(recordRaw);
      result.push({
        id: `${driverKey}:${dateKey}`,
        sourceDriverKey: driverKey,
        dateKey,
        ...record,
      });
    });
  });

  return result;
}

function flattenResidentViolations(data: unknown): AnyItem[] {
  const result: AnyItem[] = [];
  const root = objectValue(data);

  Object.entries(root).forEach(([residentId, recordsRaw]) => {
    const records = objectValue(recordsRaw);
    Object.entries(records).forEach(([recordId, recordRaw]) => {
      const record = objectValue(recordRaw);
      result.push({ id: recordId, residentId, ...record });
    });
  });

  return result;
}

function dateKeyTimestamp(value: unknown): number {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0;
  const parsed = Date.parse(`${text}T12:00:00+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function attendanceTimestamp(item: AnyItem): number {
  const timeIn = objectValue(item.timeIn);
  const timeOut = objectValue(item.timeOut);
  return normalizeTimestamp(
    timeOut.timestamp ??
      timeIn.timestamp ??
      item.updatedAt ??
      item.createdAt ??
      dateKeyTimestamp(item.dateKey),
  );
}

function routeStatusTimestamp(item: AnyItem): number {
  return normalizeTimestamp(item.createdAt ?? item.updatedAt ?? item.timestamp);
}

function flattenPendingSummaries(data: unknown): AnyItem[] {
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

function flattenRouteSessions(data: unknown): AnyItem[] {
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

function isTerminalRouteSession(item: AnyItem): boolean {
  const status = normalizedStatus(item.routeStatus ?? item.status ?? item.collectionStatus);
  return status === "completed" || status === "partial" || status === "missed";
}

function parseGpsHistory(data: unknown): GpsTrace[] {
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

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nonNegativeNumber(value: unknown): number {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : 0;
}

function normalizeTimestamp(value: unknown): number {
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

function bestTimestamp(item: AnyItem): number {
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

function cleanText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return fallback;
  return text;
}

function normalizeTextArray(value: unknown): string[] {
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

function normalizePurok(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/all\s*purok/i.test(raw)) return "All Puroks";
  const match = raw.match(/purok\s*(\d+)/i) || raw.match(/^\s*(\d+)\s*$/);
  return match ? `Purok ${Number(match[1])}` : raw;
}

function purokList(item: AnyItem): string[] {
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

function barangaysList(item: AnyItem): string[] {
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

function barangayText(item: AnyItem): string {
  const [first] = barangaysList(item);
  return first || "Unspecified Barangay";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function normalizedStatus(value: unknown): string {
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

function truckLoadPercent(item: AnyItem): number | null {
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

function isFullTruck(item: { truckLoadPercent: number | null; truckLoadLabel: string; completionReason: string; collectionCondition: string }): boolean {
  const text = `${item.truckLoadLabel} ${item.completionReason} ${item.collectionCondition}`.toLowerCase();
  return (item.truckLoadPercent ?? 0) >= 100 || text.includes("truck_full") || text.includes("full truck") || text.includes("full capacity");
}

function formatDateTime(value: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDistance(meters: number): string {
  if (!meters) return "0 km";
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(meters / 1000)} km`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inputDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayStart(value: string): number {
  if (!value) return 0;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function localDayEnd(value: string): number {
  if (!value) return 0;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function reportBounds(range: RangeFilter, customFrom: string, customTo: string): { from: number; to: number; label: string } {
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

function manilaMonthBounds(monthOffset = 0): { from: number; to: number; label: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "numeric",
  });
  const parts = formatter.formatToParts(new Date());
  const currentYear = Number(parts.find((part) => part.type === "year")?.value || 0);
  const currentMonth = Number(parts.find((part) => part.type === "month")?.value || 1);
  const monthIndex = currentMonth - 1 + monthOffset;
  const target = new Date(Date.UTC(currentYear, monthIndex, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const next = new Date(Date.UTC(year, month, 1));
  const nextYear = next.getUTCFullYear();
  const nextMonth = next.getUTCMonth() + 1;
  const pad = (value: number) => String(value).padStart(2, "0");
  const from = new Date(`${year}-${pad(month)}-01T00:00:00+08:00`).getTime();
  const to = new Date(`${nextYear}-${pad(nextMonth)}-01T00:00:00+08:00`).getTime() - 1;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    year: "numeric",
  }).format(new Date(from));
  return { from, to, label };
}

function signedCountChange(current: number, previous: number): string {
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${delta}`;
}

function signedPointChange(current: number, previous: number): string {
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`;
}

function shortChartLabel(value: string, maxLength = 22): string {
  const clean = cleanText(value, "Unknown");
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function barChartSvgHtml(
  title: string,
  subtitle: string,
  data: SvgBarDatum[],
  options: { maximum?: number; suffix?: string; decimals?: number } = {},
): string {
  const rows = data.filter((item) => Number.isFinite(item.value) && item.value >= 0);
  if (rows.length === 0) {
    return `<article class="print-chart-card"><div class="print-chart-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div><div class="print-chart-empty">No recorded data for this chart.</div></article>`;
  }

  const width = 520;
  const barX = 168;
  const barWidth = 275;
  const valueX = 505;
  const rowHeight = 38;
  const top = 12;
  const height = Math.max(82, top * 2 + rows.length * rowHeight);
  const maximum = Math.max(options.maximum || 0, ...rows.map((item) => item.value), 1);
  const suffix = options.suffix || "";
  const decimals = options.decimals ?? 0;

  const rowsHtml = rows.map((item, index) => {
    const y = top + index * rowHeight;
    const barY = y + 13;
    const ratio = Math.max(0, Math.min(1, item.value / maximum));
    const currentWidth = item.value > 0 ? Math.max(2, ratio * barWidth) : 0;
    const formatted = `${item.value.toFixed(decimals)}${suffix}`;
    return `<g>
      <text x="8" y="${y + 20}" class="chart-label">${escapeHtml(shortChartLabel(item.label))}</text>
      <rect x="${barX}" y="${barY}" width="${barWidth}" height="12" rx="6" class="chart-track" />
      <rect x="${barX}" y="${barY}" width="${currentWidth.toFixed(1)}" height="12" rx="6" class="chart-bar" />
      <text x="${valueX}" y="${y + 23}" text-anchor="end" class="chart-value">${escapeHtml(formatted)}</text>
    </g>`;
  }).join("");

  return `<article class="print-chart-card"><div class="print-chart-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div><svg class="print-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${rowsHtml}</svg></article>`;
}

function timestampInBounds(timestamp: number, bounds: { from: number; to: number }): boolean {
  if (!timestamp) return bounds.from === 0;
  return timestamp >= bounds.from && timestamp <= bounds.to;
}

function nearestRecord(records: AnyItem[], driverId: string, scheduleId: string, timestamp: number): AnyItem | null {
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

function issueImpact(item: AnyItem): boolean {
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

function priorityRank(value: Priority): number {
  return value === "Critical" ? 4 : value === "High" ? 3 : value === "Monitor" ? 2 : 1;
}

function areaPriority(input: {
  partial: number;
  missed: number;
  fullTruckEvents: number;
  openIssues: number;
  highImpactIssues: number;
  followUpCount: number;
  activeSchedules: number;
  trips: number;
}): { priority: Priority; score: number } {
  const score =
    input.partial * 4 +
    input.missed * 5 +
    input.fullTruckEvents * 3 +
    input.openIssues * 2 +
    input.highImpactIssues * 3 +
    Math.min(4, input.followUpCount) +
    (input.trips > 0 && input.activeSchedules === 0 ? 2 : 0);

  if (score >= 12) return { priority: "Critical", score };
  if (score >= 7) return { priority: "High", score };
  if (score >= 3) return { priority: "Monitor", score };
  return { priority: "Stable", score };
}

function operationalRecommendation(row: Omit<AreaRow, "priority" | "priorityScore" | "recommendation" | "reasons">): { recommendation: string; reasons: string[] } {
  const area = row.purok ? `${row.barangay} / ${row.purok}` : row.barangay;
  const reasons: string[] = [];
  if (row.partial > 0) reasons.push(`${row.partial} partial collection${row.partial === 1 ? "" : "s"}`);
  if (row.missed > 0) reasons.push(`${row.missed} missed collection${row.missed === 1 ? "" : "s"}`);
  if (row.followUpPuroks.length > 0) reasons.push(`${row.followUpPuroks.length} purok${row.followUpPuroks.length === 1 ? "" : "s"} requiring follow-up`);
  if (row.fullTruckEvents > 0) reasons.push(`${row.fullTruckEvents} full-truck event${row.fullTruckEvents === 1 ? "" : "s"}`);
  if (row.openIssues > 0) reasons.push(`${row.openIssues} open issue${row.openIssues === 1 ? "" : "s"}`);
  if (row.activeSchedules === 0 && row.trips > 0) reasons.push("no active schedule currently recorded");
  if (reasons.length === 0) reasons.push("no current operational pressure signal");

  if (row.missed > 0 || row.partial >= 2 || row.followUpPuroks.length >= 2) {
    return {
      reasons,
      recommendation: `Prioritize follow-up collection for ${area}. Review the uncollected puroks, confirm the next dispatch, and verify completion through GPS before closing the service gap.`,
    };
  }
  if (row.fullTruckEvents >= 2 || (row.fullTruckEvents >= 1 && (row.partial > 0 || row.followUpPuroks.length > 0))) {
    return {
      reasons,
      recommendation: `Review truck capacity and route sequencing for ${area}. The recorded capacity pressure should be validated before changing the collection frequency or assigning an additional trip.`,
    };
  }
  if (row.highImpactIssues > 0 || row.openIssues >= 2) {
    return {
      reasons,
      recommendation: `Resolve the open operational issues affecting ${area}, assign accountable follow-up, and monitor the next collection cycle before adjusting the schedule.`,
    };
  }
  if (row.activeSchedules === 0 && row.trips > 0) {
    return {
      reasons,
      recommendation: `Confirm active schedule coverage for ${area}. Historical collection activity exists, but the report does not currently detect an active service schedule.`,
    };
  }
  return {
    reasons,
    recommendation: `Maintain the current collection plan for ${area}. Continue monitoring completion, truck capacity, GPS verification, and resident/driver reports for new service-pressure signals.`,
  };
}

function routeTraceGeometry(points: GpsPoint[]): { path: string; startX: number; startY: number; endX: number; endY: number } | null {
  if (points.length === 0) return null;
  const renderPoints = points.length > 250 ? points.filter((_, index) => index % Math.ceil(points.length / 250) === 0 || index === points.length - 1) : points;
  const latitudes = renderPoints.map((point) => point.latitude);
  const longitudes = renderPoints.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const lngSpan = Math.max(maxLng - minLng, 0.00001);
  const pad = 18;
  const width = 360 - pad * 2;
  const height = 180 - pad * 2;
  const projected = renderPoints.map((point) => ({
    x: pad + ((point.longitude - minLng) / lngSpan) * width,
    y: pad + (1 - (point.latitude - minLat) / latSpan) * height,
  }));
  const path = projected.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return {
    path,
    startX: projected[0].x,
    startY: projected[0].y,
    endX: projected.at(-1)!.x,
    endY: projected.at(-1)!.y,
  };
}

function routeMapHtml(points: GpsPoint[]): string {
  const map = buildRouteMap(points);
  if (!map) return "<div class='gps-empty'>No GPS points available.</div>";
  const tilesHtml = map.tiles.map((tile) => `<img alt="" src="${escapeHtml(tile.url)}" style="left:${tile.x.toFixed(1)}px;top:${tile.y.toFixed(1)}px" />`).join("");
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  const startLabel = firstPoint ? `${firstPoint.latitude.toFixed(6)}, ${firstPoint.longitude.toFixed(6)}` : "—";
  const endLabel = lastPoint ? `${lastPoint.latitude.toFixed(6)}, ${lastPoint.longitude.toFixed(6)}` : "—";
  return `
    <div class="gps-map" role="img" aria-label="Actual GPS route over OpenStreetMap base map">
      <div class="gps-map-tiles" aria-hidden="true">${tilesHtml}</div>
      <svg viewBox="0 0 ${ROUTE_MAP_WIDTH} ${ROUTE_MAP_HEIGHT}" class="gps-overlay" aria-hidden="true">
        <path d="${map.path}" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${map.path}" fill="none" stroke="#2563eb" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${map.startX.toFixed(1)}" cy="${map.startY.toFixed(1)}" r="12" fill="rgba(22,163,74,.18)" />
        <circle cx="${map.startX.toFixed(1)}" cy="${map.startY.toFixed(1)}" r="7" fill="#16a34a" stroke="#ffffff" stroke-width="3" />
        <circle cx="${map.endX.toFixed(1)}" cy="${map.endY.toFixed(1)}" r="12" fill="rgba(220,38,38,.18)" />
        <circle cx="${map.endX.toFixed(1)}" cy="${map.endY.toFixed(1)}" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="3" />
      </svg>
      <div class="gps-legend"><span class="start"></span>Start <span class="end"></span>End <span class="actual">Actual GPS path on map</span></div>
    </div>
    <div class="gps-coords"><strong>Start GPS:</strong> ${escapeHtml(startLabel)} <span>•</span> <strong>End GPS:</strong> ${escapeHtml(endLabel)}</div>`;
}

const ROUTE_MAP_WIDTH = 720;
const ROUTE_MAP_HEIGHT = 320;
const OSM_TILE_SIZE = 256;

type RouteMapTile = { key: string; x: number; y: number; url: string };
type RouteMapModel = {
  path: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  centerLatitude: number;
  centerLongitude: number;
  zoom: number;
  tiles: RouteMapTile[];
};

function mercatorPoint(latitude: number, longitude: number, zoom: number) {
  const safeLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const worldSize = OSM_TILE_SIZE * 2 ** zoom;
  const sinLatitude = Math.sin((safeLatitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize,
  };
}

function buildRouteMap(points: GpsPoint[]): RouteMapModel | null {
  if (points.length === 0) return null;

  const renderPoints = points.length > 500
    ? points.filter((_, index) => index % Math.ceil(points.length / 500) === 0 || index === points.length - 1)
    : points;
  const padding = 38;
  let zoom = 18;
  let projected = renderPoints.map((point) => mercatorPoint(point.latitude, point.longitude, zoom));

  for (let candidate = 18; candidate >= 4; candidate -= 1) {
    const candidatePoints = renderPoints.map((point) => mercatorPoint(point.latitude, point.longitude, candidate));
    const xs = candidatePoints.map((point) => point.x);
    const ys = candidatePoints.map((point) => point.y);
    zoom = candidate;
    projected = candidatePoints;
    if (Math.max(...xs) - Math.min(...xs) <= ROUTE_MAP_WIDTH - padding * 2
      && Math.max(...ys) - Math.min(...ys) <= ROUTE_MAP_HEIGHT - padding * 2) {
      break;
    }
  }

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const viewportLeft = centerX - ROUTE_MAP_WIDTH / 2;
  const viewportTop = centerY - ROUTE_MAP_HEIGHT / 2;
  const localPoints = projected.map((point) => ({
    x: point.x - viewportLeft,
    y: point.y - viewportTop,
  }));
  const path = localPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  const tileCount = 2 ** zoom;
  const minTileX = Math.floor(viewportLeft / OSM_TILE_SIZE);
  const maxTileX = Math.floor((viewportLeft + ROUTE_MAP_WIDTH) / OSM_TILE_SIZE);
  const minTileY = Math.max(0, Math.floor(viewportTop / OSM_TILE_SIZE));
  const maxTileY = Math.min(tileCount - 1, Math.floor((viewportTop + ROUTE_MAP_HEIGHT) / OSM_TILE_SIZE));
  const tiles: RouteMapTile[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        x: tileX * OSM_TILE_SIZE - viewportLeft,
        y: tileY * OSM_TILE_SIZE - viewportTop,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
      });
    }
  }

  const centerPoint = renderPoints[Math.floor(renderPoints.length / 2)] || renderPoints[0];
  return {
    path,
    startX: localPoints[0].x,
    startY: localPoints[0].y,
    endX: localPoints.at(-1)!.x,
    endY: localPoints.at(-1)!.y,
    centerLatitude: centerPoint.latitude,
    centerLongitude: centerPoint.longitude,
    zoom,
    tiles,
  };
}

function RouteTrace({ points }: { points: GpsPoint[] }) {
  const map = useMemo(() => buildRouteMap(points), [points]);
  if (!map) return <div className="ops-gps-empty">No GPS points available.</div>;

  const openMapUrl = `https://www.openstreetmap.org/?mlat=${map.centerLatitude}&mlon=${map.centerLongitude}#map=${map.zoom}/${map.centerLatitude}/${map.centerLongitude}`;

  return (
    <div className="ops-route-map" role="img" aria-label="Recorded GPS collection route on OpenStreetMap">
      <div className="ops-route-tiles" aria-hidden="true">
        {map.tiles.map((tile) => (
          <img
            alt=""
            decoding="async"
            draggable={false}
            key={tile.key}
            loading="lazy"
            src={tile.url}
            style={{ left: tile.x, top: tile.y }}
          />
        ))}
      </div>
      <svg viewBox={`0 0 ${ROUTE_MAP_WIDTH} ${ROUTE_MAP_HEIGHT}`} className="ops-route-overlay" aria-hidden="true">
        <path d={map.path} className="ops-route-halo" />
        <path d={map.path} className="ops-route-line" />
        <g transform={`translate(${map.startX} ${map.startY})`}>
          <circle r="12" className="ops-route-marker-ring start" />
          <circle r="7" className="ops-route-marker start" />
        </g>
        <g transform={`translate(${map.endX} ${map.endY})`}>
          <circle r="12" className="ops-route-marker-ring end" />
          <circle r="7" className="ops-route-marker end" />
        </g>
      </svg>
      <div className="ops-route-legend"><span className="start" />Start <span className="end" />End</div>
      <a className="ops-route-open" href={openMapUrl} target="_blank" rel="noreferrer">Open full map ↗</a>
      <a className="ops-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
    </div>
  );
}

function reportTypeLabel(value: ReportType): string {
  return REPORT_TYPES.find((item) => item.value === value)?.label || "Complete System";
}

function reportIncludes(reportType: ReportType, section: Exclude<ReportType, "complete">): boolean {
  return reportType === "complete" || reportType === section;
}

function SvgBarChart({
  title,
  subtitle,
  data,
  maximum,
  suffix = "",
  decimals = 0,
}: {
  title: string;
  subtitle: string;
  data: SvgBarDatum[];
  maximum?: number;
  suffix?: string;
  decimals?: number;
}) {
  const rows = data.filter((item) => Number.isFinite(item.value) && item.value >= 0);
  const width = 560;
  const barX = 176;
  const barWidth = 300;
  const valueX = 544;
  const rowHeight = 40;
  const top = 10;
  const height = Math.max(92, top * 2 + Math.max(rows.length, 1) * rowHeight);
  const maxValue = Math.max(maximum || 0, ...rows.map((item) => item.value), 1);

  return (
    <article className="ops-svg-chart-card">
      <header>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </header>
      {rows.length === 0 ? (
        <div className="ops-chart-empty">No recorded data for this chart.</div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="ops-svg-chart" role="img" aria-label={title}>
          {rows.map((item, index) => {
            const y = top + index * rowHeight;
            const ratio = Math.max(0, Math.min(1, item.value / maxValue));
            const currentWidth = item.value > 0 ? Math.max(3, ratio * barWidth) : 0;
            return (
              <g key={`${item.label}-${index}`}>
                <text x="8" y={y + 22} className="ops-chart-label">{shortChartLabel(item.label)}</text>
                <rect x={barX} y={y + 13} width={barWidth} height="13" rx="6.5" className="ops-chart-track" />
                <rect x={barX} y={y + 13} width={currentWidth} height="13" rx="6.5" className="ops-chart-bar" />
                <text x={valueX} y={y + 24} textAnchor="end" className="ops-chart-value">{item.value.toFixed(decimals)}{suffix}</text>
              </g>
            );
          })}
        </svg>
      )}
    </article>
  );
}

export function MetroWastePlanningReport() {
  const today = inputDateValue(new Date());
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const [collectionReports, setCollectionReports] = useState<AnyItem[]>([]);
  const [pendingSummaries, setPendingSummaries] = useState<AnyItem[]>([]);
  const [truckFullAlerts, setTruckFullAlerts] = useState<AnyItem[]>([]);
  const [issues, setIssues] = useState<AnyItem[]>([]);
  const [residentIssues, setResidentIssues] = useState<AnyItem[]>([]);
  const [reportIssues, setReportIssues] = useState<AnyItem[]>([]);
  const [complaints, setComplaints] = useState<AnyItem[]>([]);
  const [schedules, setSchedules] = useState<AnyItem[]>([]);
  const [drivers, setDrivers] = useState<AnyItem[]>([]);
  const [routes, setRoutes] = useState<AnyItem[]>([]);
  const [residents, setResidents] = useState<AnyItem[]>([]);
  const [notifications, setNotifications] = useState<AnyItem[]>([]);
  const [serviceAreasRaw, setServiceAreasRaw] = useState<unknown>({});
  const [routeSessions, setRouteSessions] = useState<AnyItem[]>([]);
  const [activeRouteSessions, setActiveRouteSessions] = useState<AnyItem[]>([]);
  const [driverLocations, setDriverLocations] = useState<AnyItem[]>([]);
  const [gpsRaw, setGpsRaw] = useState<unknown>({});
  const [driverAttendance, setDriverAttendance] = useState<AttendanceRecord[]>([]);
  const [residentViolations, setResidentViolations] = useState<AnyItem[]>([]);
  const [wastePoints, setWastePoints] = useState<AnyItem[]>([]);
  const [routeStatusUpdates, setRouteStatusUpdates] = useState<AnyItem[]>([]);
  const [driverActivityRequests, setDriverActivityRequests] = useState<AnyItem[]>([]);
  const [driverActivityReports, setDriverActivityReports] = useState<AnyItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  const [reportType, setReportType] = useState<ReportType>("complete");
  const [range, setRange] = useState<RangeFilter>("30d");
  const [customFrom, setCustomFrom] = useState(inputDateValue(thirtyDaysAgo));
  const [customTo, setCustomTo] = useState(today);
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [truckFilter, setTruckFilter] = useState("all");
  const [generated, setGenerated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [areaScope, setAreaScope] = useState<"barangay" | "purok">("barangay");

  useEffect(() => {
    const listenArray = (path: string, setter: (value: AnyItem[]) => void) =>
      onValue(ref(db, path), (snapshot) => {
        setter(toArray(snapshot.val()));
        setLastUpdated(Date.now());
      });

    const unsubscribers = [
      listenArray("collection_reports", setCollectionReports),
      onValue(ref(db, "pending_collection_summaries"), (snapshot) => {
        setPendingSummaries(flattenPendingSummaries(snapshot.val()));
        setLastUpdated(Date.now());
      }),
      listenArray("truck_full_alerts", setTruckFullAlerts),
      listenArray("issues", setIssues),
      listenArray("resident_issues", setResidentIssues),
      listenArray("report_issues", setReportIssues),
      listenArray("complaints", setComplaints),
      listenArray("schedules", setSchedules),
      listenArray("drivers", setDrivers),
      listenArray("routes", setRoutes),
      listenArray("residents", setResidents),
      listenArray("notifications", setNotifications),
      onValue(ref(db, "driver_attendance"), (snapshot) => {
        setDriverAttendance(flattenDriverAttendance(snapshot.val()));
        setLastUpdated(Date.now());
      }),
      onValue(ref(db, "residentViolations"), (snapshot) => {
        setResidentViolations(flattenResidentViolations(snapshot.val()));
        setLastUpdated(Date.now());
      }),
      listenArray("waste_disposal_points", setWastePoints),
      listenArray("route_status_updates", setRouteStatusUpdates),
      listenArray("driver_activity_requests", setDriverActivityRequests),
      listenArray("driver_activity_reports", setDriverActivityReports),
      onValue(ref(db, "service_areas"), (snapshot) => {
        setServiceAreasRaw(snapshot.val() || {});
        setLastUpdated(Date.now());
      }),
      onValue(ref(db, "route_sessions"), (snapshot) => {
        setRouteSessions(flattenRouteSessions(snapshot.val()));
        setLastUpdated(Date.now());
      }),
      listenArray("active_route_sessions", setActiveRouteSessions),
      listenArray("driver_locations", setDriverLocations),
      onValue(ref(db, "gps_route_history"), (snapshot) => {
        setGpsRaw(snapshot.val() || {});
        setLastUpdated(Date.now());
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const activeRouteByDriver = useMemo(() => {
    const map = new Map<string, AnyItem>();
    activeRouteSessions.forEach((item) => {
      const driverId = cleanText(item.driverId ?? item.id);
      if (driverId) map.set(driverId, item);
    });
    return map;
  }, [activeRouteSessions]);

  const driverLocationByDriver = useMemo(() => {
    const map = new Map<string, AnyItem>();
    driverLocations.forEach((item) => {
      const driverId = cleanText(item.driverId ?? item.id);
      if (driverId) map.set(driverId, item);
    });
    return map;
  }, [driverLocations]);

  const driverProfiles = useMemo<DriverProfile[]>(() =>
    drivers.map((item) => {
      const id = cleanText(item.id);
      const activeSession = activeRouteByDriver.get(id);
      const location = driverLocationByDriver.get(id);
      const activeSessionId = cleanText(activeSession?.sessionId);
      const activeScheduleId = cleanText(activeSession?.scheduleId);
      const activeRouteId = cleanText(activeSession?.routeId);
      const trackingActive = Boolean(activeSessionId && activeScheduleId);

      return {
        id,
        name: cleanText(item.name ?? item.fullName ?? item.displayName, "Driver"),
        truck: cleanText(item.truck ?? item.vehicle ?? item.truckId, ""),
        status: trackingActive ? "tracking" : normalizedStatus(item.status),
        trackingActive,
        activeSessionId,
        activeScheduleId,
        activeRouteId,
        lastGpsAt: bestTimestamp(location || {}),
      };
    }), [drivers, activeRouteByDriver, driverLocationByDriver]);

  const driverMap = useMemo(() => new Map(driverProfiles.map((item) => [item.id, item])), [driverProfiles]);
  const gpsTraces = useMemo(() => parseGpsHistory(gpsRaw), [gpsRaw]);
  const gpsBySession = useMemo(() => new Map(gpsTraces.map((trace) => [trace.sessionId, trace])), [gpsTraces]);
  const routeSessionBySession = useMemo(() => new Map(routeSessions.map((item) => [cleanText(item.sessionId ?? item.id), item])), [routeSessions]);

  const mergedCollectionSources = useMemo(() => {
    const map = new Map<string, AnyItem>();

    collectionReports.forEach((item) => {
      const sessionId = cleanText(item.sessionId ?? item.reportId ?? item.id);
      const key = sessionId || `report:${cleanText(item.id)}`;
      map.set(key, { ...item, sessionId: sessionId || cleanText(item.id), _source: "collection_reports" });
    });

    routeSessions.forEach((session) => {
      if (!isTerminalRouteSession(session)) return;
      const sessionId = cleanText(session.sessionId ?? session.id);
      if (!sessionId || map.has(sessionId)) return;

      map.set(sessionId, {
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

    return Array.from(map.values());
  }, [collectionReports, routeSessions]);

  const normalizedCollections = useMemo<CollectionRecord[]>(() => {
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
  }, [
    mergedCollectionSources,
    routeSessionBySession,
    pendingSummaries,
    truckFullAlerts,
    driverMap,
    gpsBySession,
  ]);

  const normalizedIssues = useMemo<IssueRecord[]>(() => {
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
        isOpen: !["resolved", "closed", "cancelled"].includes(status),
        isHighImpact: issueImpact(item),
      };
    };

    return [
      ...issues.map((item) => build(item, "Driver/Admin Issue")),
      ...residentIssues.map((item) => build(item, "Resident Issue")),
      ...reportIssues.map((item) => build(item, "Reported Issue")),
      ...complaints.map((item) => build(item, "Complaint")),
    ];
  }, [issues, residentIssues, reportIssues, complaints]);

  const normalizedSchedules = useMemo<ScheduleRecord[]>(() =>
    schedules.map((item) => ({
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
    })), [schedules]);

  const bounds = useMemo(() => reportBounds(range, customFrom, customTo), [range, customFrom, customTo]);

  const barangayOptions = useMemo(() => unique([
    ...normalizedCollections.flatMap((item) => item.barangays),
    ...normalizedIssues.flatMap((item) => item.barangays),
    ...normalizedSchedules.flatMap((item) => item.barangays),
  ].filter((item) => item && item !== "Unspecified Barangay")).sort(), [normalizedCollections, normalizedIssues, normalizedSchedules]);

  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    driverProfiles.forEach((driver) => map.set(driver.id, driver.name));
    normalizedCollections.forEach((item) => {
      if (item.driverId) map.set(item.driverId, item.driverName);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [driverProfiles, normalizedCollections]);

  const truckOptions = useMemo(() => unique([
    ...driverProfiles.map((item) => item.truck),
    ...normalizedCollections.map((item) => item.truckId),
    ...normalizedSchedules.map((item) => item.truckId),
  ].filter((item) => item && item !== "Unassigned")).sort(), [driverProfiles, normalizedCollections, normalizedSchedules]);

  const filteredCollections = useMemo(() => normalizedCollections.filter((item) => {
    if (!timestampInBounds(item.timestamp, bounds)) return false;
    if (barangayFilter !== "all" && !item.barangays.includes(barangayFilter)) return false;
    if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
    if (truckFilter !== "all" && item.truckId !== truckFilter) return false;
    return true;
  }), [normalizedCollections, bounds, barangayFilter, driverFilter, truckFilter]);

  const filteredIssues = useMemo(() => normalizedIssues.filter((item) => {
    const dateMatch = item.timestamp ? timestampInBounds(item.timestamp, bounds) : item.isOpen;
    if (!dateMatch) return false;
    if (barangayFilter !== "all" && !item.barangays.includes(barangayFilter)) return false;
    if (driverFilter !== "all" && item.driverId && item.driverId !== driverFilter) return false;
    return true;
  }), [normalizedIssues, bounds, barangayFilter, driverFilter]);

  const filteredSchedules = useMemo(() => normalizedSchedules.filter((item) => {
    if (["cancelled", "inactive", "deleted"].includes(item.status)) return false;
    if (barangayFilter !== "all" && !item.barangays.includes(barangayFilter)) return false;
    if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
    if (truckFilter !== "all" && item.truckId !== truckFilter) return false;
    return true;
  }), [normalizedSchedules, barangayFilter, driverFilter, truckFilter]);

  const residentById = useMemo(() => {
    const map = new Map<string, AnyItem>();
    residents.forEach((item) => {
      const id = cleanText(item.id ?? item.uid ?? item.residentId);
      if (id) map.set(id, item);
    });
    return map;
  }, [residents]);

  const filteredAttendance = useMemo(() => driverAttendance.filter((item) => {
    const timestamp = attendanceTimestamp(item);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    const driverId = cleanText(item.driverId ?? item.driverUid ?? item.sourceDriverKey);
    if (driverFilter !== "all" && driverId && driverId !== driverFilter) return false;
    if (barangayFilter !== "all") {
      const barangay = barangayText(item);
      if (barangay !== "Unspecified Barangay" && barangay !== barangayFilter) return false;
    }
    if (truckFilter !== "all") {
      const vehicle = cleanText(item.vehicle ?? item.truck ?? item.truckId);
      if (vehicle && vehicle !== truckFilter) return false;
    }
    return true;
  }), [driverAttendance, bounds, driverFilter, barangayFilter, truckFilter]);

  const filteredViolations = useMemo(() => residentViolations.filter((item) => {
    const timestamp = normalizeTimestamp(item.issuedAt ?? item.updatedAt ?? item.createdAt ?? item.timestamp);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    if (barangayFilter !== "all") {
      const resident = residentById.get(cleanText(item.residentId));
      const barangay = barangayText({ ...resident, ...item });
      if (barangay !== "Unspecified Barangay" && barangay !== barangayFilter) return false;
    }
    return true;
  }), [residentViolations, residentById, bounds, barangayFilter]);

  const filteredWastePoints = useMemo(() => wastePoints.filter((item) => {
    if (barangayFilter !== "all" && barangayText(item) !== barangayFilter) return false;
    return true;
  }), [wastePoints, barangayFilter]);

  const filteredRouteStatusUpdates = useMemo(() => routeStatusUpdates.filter((item) => {
    const timestamp = routeStatusTimestamp(item);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    if (driverFilter !== "all") {
      const id = cleanText(item.driverId ?? item.uid);
      if (id && id !== driverFilter) return false;
    }
    if (barangayFilter !== "all") {
      const barangay = barangayText(item);
      if (barangay !== "Unspecified Barangay" && barangay !== barangayFilter) return false;
    }
    return true;
  }), [routeStatusUpdates, bounds, driverFilter, barangayFilter]);

  const filteredActivityRequests = useMemo(() => driverActivityRequests.filter((item) => {
    const timestamp = normalizeTimestamp(item.requestedAt ?? item.createdAt ?? item.updatedAt ?? item.sentAt);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    if (driverFilter !== "all" && cleanText(item.driverId) !== driverFilter) return false;
    return true;
  }), [driverActivityRequests, bounds, driverFilter]);

  const filteredActivityReports = useMemo(() => driverActivityReports.filter((item) => {
    const timestamp = normalizeTimestamp(item.generatedAt ?? item.createdAt ?? item.updatedAt ?? item.sentAt);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    if (driverFilter !== "all" && cleanText(item.driverId) !== driverFilter) return false;
    return true;
  }), [driverActivityReports, bounds, driverFilter]);

  const fullSystemSummary = useMemo<FullSystemSummary>(() => {
    const attendanceStatuses = filteredAttendance.map((item) => cleanText(item.status ?? item.timingStatus, "Incomplete").toLowerCase());
    const dutyValues = filteredAttendance
      .map((item) => nonNegativeNumber(item.totalDutyMinutes))
      .filter((value) => value > 0);
    const complianceStatuses = filteredViolations.map((item) => cleanText(item.status, "Recorded").toLowerCase());
    const activeWastePoints = filteredWastePoints.filter((item) => item.active !== false && String(item.active).toLowerCase() !== "false");
    const routeStatuses = filteredRouteStatusUpdates.map((item) => normalizedStatus(item.status));
    const requestStatuses = filteredActivityRequests.map((item) => cleanText(item.status, "pending").toLowerCase());
    const visibleNotifications = notifications.filter((item) => {
      const timestamp = bestTimestamp(item);
      if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
      if (barangayFilter !== "all") {
        const barangay = barangayText(item);
        if (barangay !== "Unspecified Barangay" && barangay !== barangayFilter) return false;
      }
      return true;
    });

    return {
      attendance: {
        total: filteredAttendance.length,
        present: attendanceStatuses.filter((status) => status === "present" || status === "on time").length,
        late: attendanceStatuses.filter((status) => status.includes("late")).length,
        absent: attendanceStatuses.filter((status) => status.includes("absent")).length,
        incomplete: filteredAttendance.filter((item) => !objectValue(item.timeIn).timestamp || !objectValue(item.timeOut).timestamp).length,
        completedDuty: filteredAttendance.filter((item) => Boolean(objectValue(item.timeIn).timestamp && objectValue(item.timeOut).timestamp)).length,
        averageDutyMinutes: dutyValues.length ? dutyValues.reduce((sum, value) => sum + value, 0) / dutyValues.length : 0,
      },
      compliance: {
        total: filteredViolations.length,
        open: complianceStatuses.filter((status) => !["resolved", "dismissed", "paid"].includes(status)).length,
        resolved: complianceStatuses.filter((status) => status === "resolved" || status === "dismissed").length,
        issued: complianceStatuses.filter((status) => status === "issued").length,
        paid: complianceStatuses.filter((status) => status === "paid").length,
      },
      wastePoints: {
        total: filteredWastePoints.length,
        active: activeWastePoints.length,
        inactive: Math.max(0, filteredWastePoints.length - activeWastePoints.length),
        barangays: new Set(activeWastePoints.map((item) => barangayText(item)).filter((value) => value !== "Unspecified Barangay")).size,
      },
      routeUpdates: {
        total: filteredRouteStatusUpdates.length,
        active: routeStatuses.filter((status) => status === "active" || status === "pending").length,
        completed: routeStatuses.filter((status) => status === "completed").length,
        problem: routeStatuses.filter((status) => status === "missed" || status === "partial" || status === "cancelled").length,
      },
      activityReports: {
        requests: filteredActivityRequests.length,
        pending: requestStatuses.filter((status) => ["pending", "requested", "open", "new"].includes(status)).length,
        sent: requestStatuses.filter((status) => ["sent", "delivered", "completed", "generated"].includes(status)).length,
        failed: requestStatuses.filter((status) => status.includes("fail") || status.includes("error") || status.includes("reject")).length,
        generatedReports: filteredActivityReports.length,
      },
      notifications: {
        total: visibleNotifications.length,
        unread: visibleNotifications.filter((item) => item.seen !== true && item.read !== true).length,
        resident: visibleNotifications.filter((item) => cleanText(item.targetType ?? item.audience).toLowerCase().includes("resident")).length,
        driver: visibleNotifications.filter((item) => cleanText(item.targetType ?? item.audience).toLowerCase().includes("driver")).length,
        admin: visibleNotifications.filter((item) => cleanText(item.targetType ?? item.audience).toLowerCase().includes("admin")).length,
      },
    };
  }, [filteredAttendance, filteredViolations, filteredWastePoints, filteredRouteStatusUpdates, filteredActivityRequests, filteredActivityReports, notifications, bounds, barangayFilter]);

  const filteredComplaints = useMemo(() => {
    const complaintSources = new Set(["Complaint", "Resident Issue", "Reported Issue"]);
    const uniqueRecords = new Map<string, IssueRecord>();

    filteredIssues
      .filter((item) => complaintSources.has(item.source))
      .forEach((item) => {
        const signature = [
          item.timestamp,
          item.barangay.toLowerCase(),
          item.puroks.join(",").toLowerCase(),
          item.type.toLowerCase(),
          item.details.toLowerCase().slice(0, 160),
        ].join("|");
        const existing = uniqueRecords.get(signature);
        if (!existing || item.source === "Complaint") uniqueRecords.set(signature, item);
      });

    return Array.from(uniqueRecords.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [filteredIssues]);

  const complaintHotspots = useMemo<ComplaintHotspotRow[]>(() => {
    const groups = new Map<string, IssueRecord[]>();
    filteredComplaints.forEach((item) => {
      const barangay = cleanText(item.barangay, "Unspecified Barangay");
      const list = groups.get(barangay) || [];
      list.push(item);
      groups.set(barangay, list);
    });

    const totalComplaints = filteredComplaints.length;
    return Array.from(groups.entries()).map(([barangay, rows]) => {
      const categoryCounts = new Map<string, number>();
      rows.forEach((row) => {
        const category = cleanText(row.type, "General complaint");
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      });
      const topCategory = Array.from(categoryCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "General complaint";
      const open = rows.filter((row) => row.isOpen).length;
      return {
        barangay,
        total: rows.length,
        open,
        resolved: rows.length - open,
        highImpact: rows.filter((row) => row.isHighImpact).length,
        topCategory,
        latestAt: rows.reduce((latest, row) => Math.max(latest, row.timestamp), 0),
        share: totalComplaints > 0 ? (rows.length / totalComplaints) * 100 : 0,
      };
    }).sort((a, b) => b.total - a.total || b.open - a.open || a.barangay.localeCompare(b.barangay));
  }, [filteredComplaints]);

  const topComplaintHotspot = complaintHotspots[0] || null;

  const residentCoverageRows = useMemo<ResidentCoverageRow[]>(() => {
    const keys = new Set<string>();
    const residentCounts = new Map<string, number>();
    const servicePurokCounts = new Map<string, number>();

    residents.forEach((item) => {
      const barangay = barangayText(item);
      if (barangay === "Unspecified Barangay") return;
      if (barangayFilter !== "all" && barangay !== barangayFilter) return;
      keys.add(barangay);
      residentCounts.set(barangay, (residentCounts.get(barangay) || 0) + 1);
    });

    Object.entries(objectValue(serviceAreasRaw)).forEach(([registryKey, raw]) => {
      const record = objectValue(raw);
      if (record.active === false || String(record.active).toLowerCase() === "false") return;
      const barangay = cleanText(record.barangay ?? record.name ?? registryKey, registryKey.replace(/_/g, " "));
      if (barangayFilter !== "all" && barangay !== barangayFilter) return;
      keys.add(barangay);
      const puroks = Object.values(objectValue(record.puroks)).filter((purokRaw) => {
        const purok = objectValue(purokRaw);
        return purok.active !== false && String(purok.active).toLowerCase() !== "false";
      }).length;
      servicePurokCounts.set(barangay, puroks);
    });

    filteredCollections.forEach((item) => item.barangays.forEach((barangay) => keys.add(barangay)));
    filteredComplaints.forEach((item) => item.barangays.forEach((barangay) => keys.add(barangay)));
    filteredIssues.forEach((item) => item.barangays.forEach((barangay) => keys.add(barangay)));
    filteredSchedules.forEach((item) => item.barangays.forEach((barangay) => keys.add(barangay)));
    filteredWastePoints.forEach((item) => keys.add(barangayText(item)));

    return Array.from(keys)
      .filter((barangay) => barangay && barangay !== "Unspecified Barangay")
      .map((barangay) => {
        const collections = filteredCollections.filter((item) => item.barangays.includes(barangay));
        const completed = collections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
        const complaints = filteredComplaints.filter((item) => item.barangays.includes(barangay)).length;
        const openIssues = filteredIssues.filter((item) => item.barangays.includes(barangay) && item.isOpen).length;
        const activeSchedules = filteredSchedules.filter((item) => item.barangays.includes(barangay)).length;
        const activeWastePoints = filteredWastePoints.filter((item) => barangayText(item) === barangay && item.active !== false && String(item.active).toLowerCase() !== "false").length;
        const completionRate = collections.length ? (completed / collections.length) * 100 : 0;
        let assessment = "Stable";
        if (openIssues >= 3 || complaints >= 5 || (collections.length >= 2 && completionRate < 70)) assessment = "Priority Review";
        else if (openIssues > 0 || complaints > 0 || (collections.length > 0 && completionRate < 90)) assessment = "Monitor";
        else if (!activeSchedules && (residentCounts.get(barangay) || 0) > 0) assessment = "Coverage Check";

        return {
          barangay,
          residents: residentCounts.get(barangay) || 0,
          servicePuroks: servicePurokCounts.get(barangay) || 0,
          activeSchedules,
          complaints,
          openIssues,
          collectionRuns: collections.length,
          completionRate,
          activeWastePoints,
          assessment,
        };
      })
      .sort((a, b) => b.openIssues - a.openIssues || b.complaints - a.complaints || a.barangay.localeCompare(b.barangay));
  }, [residents, serviceAreasRaw, filteredCollections, filteredComplaints, filteredIssues, filteredSchedules, filteredWastePoints, barangayFilter]);

  const serviceAreaStats = useMemo(() => countServiceAreaCatalog(serviceAreasRaw), [serviceAreasRaw]);
  const activeRouteCount = useMemo(
    () => routes.filter((item) => !["cancelled", "inactive", "deleted"].includes(normalizedStatus(item.status ?? "active"))).length,
    [routes],
  );
  const notificationCount = useMemo(() => notifications.filter((item) => {
    const timestamp = bestTimestamp(item);
    if (timestamp && !timestampInBounds(timestamp, bounds)) return false;
    if (barangayFilter !== "all") {
      const targetBarangay = barangayText(item);
      if (targetBarangay !== "Unspecified Barangay" && targetBarangay !== barangayFilter) return false;
    }
    return true;
  }).length, [notifications, bounds, barangayFilter]);
  const gpsSessionCount = useMemo(() => gpsTraces.filter((trace) => {
    const timestamp = trace.endTimestamp || trace.startTimestamp;
    return !timestamp || timestampInBounds(timestamp, bounds);
  }).length, [gpsTraces, bounds]);

  const summary = useMemo<ReportSummary>(() => {
    const completedTrips = filteredCollections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
    const partialTrips = filteredCollections.filter((item) => item.status === "partial" || item.unclaimedPuroks.length > 0).length;
    const missedTrips = filteredCollections.filter((item) => item.status === "missed").length;
    const truckFullEvents = filteredCollections.filter(isFullTruck).length;
    const followUpPuroks = unique(filteredCollections.flatMap((item) => item.unclaimedPuroks)).length;
    const openIssues = filteredIssues.filter((item) => item.isOpen).length;
    const activeDrivers = unique([
      ...filteredCollections.map((item) => item.driverId),
      ...filteredSchedules.map((item) => item.driverId),
    ].filter(Boolean)).length;
    const gpsVerifiedTrips = filteredCollections.filter((item) => item.hasGps).length;
    const loads = filteredCollections.map((item) => item.truckLoadPercent).filter((value): value is number => value !== null);
    const averageTruckLoad = loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : null;
    const totalTrips = filteredCollections.length;

    const visibleDriverProfiles = driverProfiles.filter((driver) => {
      if (driverFilter !== "all" && driver.id !== driverFilter) return false;
      if (truckFilter !== "all" && driver.truck && driver.truck !== truckFilter) return false;
      return true;
    });
    const onlineDrivers = visibleDriverProfiles.filter((driver) =>
      driver.trackingActive || driver.status === "online" || driver.status === "active",
    ).length;
    const trackingDrivers = visibleDriverProfiles.filter((driver) => driver.trackingActive).length;

    return {
      totalTrips,
      completedTrips,
      partialTrips,
      missedTrips,
      completionRate: totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 0,
      truckFullEvents,
      followUpPuroks,
      openIssues,
      activeSchedules: filteredSchedules.length,
      activeDrivers,
      onlineDrivers,
      trackingDrivers,
      gpsVerifiedTrips,
      gpsVerificationRate: totalTrips > 0 ? (gpsVerifiedTrips / totalTrips) * 100 : 0,
      averageTruckLoad,
      totalDistanceMeters: filteredCollections.reduce(
        (sum, item) => sum + nonNegativeNumber(item.distanceMeters),
        0,
      ),
      totalDurationSeconds: filteredCollections.reduce(
        (sum, item) => sum + nonNegativeNumber(item.durationSeconds),
        0,
      ),
    };
  }, [filteredCollections, filteredIssues, filteredSchedules, driverProfiles, driverFilter, truckFilter]);

  const systemSnapshot = useMemo<SystemSnapshot>(() => ({
    drivers: drivers.length,
    residents: residents.length,
    activeRoutes: activeRouteCount,
    serviceBarangays: serviceAreaStats.barangays,
    servicePuroks: serviceAreaStats.puroks,
    activeSchedules: filteredSchedules.length,
    collectionRuns: filteredCollections.length,
    complaints: filteredComplaints.length,
    openIssues: summary.openIssues,
    notifications: notificationCount,
    gpsSessions: gpsSessionCount,
    attendanceRecords: fullSystemSummary.attendance.total,
    lateAttendance: fullSystemSummary.attendance.late,
    incompleteAttendance: fullSystemSummary.attendance.incomplete,
    complianceViolations: fullSystemSummary.compliance.total,
    openViolations: fullSystemSummary.compliance.open,
    wastePoints: fullSystemSummary.wastePoints.total,
    activeWastePoints: fullSystemSummary.wastePoints.active,
    routeStatusUpdates: fullSystemSummary.routeUpdates.total,
    activityReportRequests: fullSystemSummary.activityReports.requests,
    pendingActivityRequests: fullSystemSummary.activityReports.pending,
    activityReports: fullSystemSummary.activityReports.generatedReports,
  }), [
    drivers.length,
    residents.length,
    activeRouteCount,
    serviceAreaStats,
    filteredSchedules.length,
    filteredCollections.length,
    filteredComplaints.length,
    summary.openIssues,
    notificationCount,
    gpsSessionCount,
    fullSystemSummary,
  ]);

  const buildAreaRows = (scope: "barangay" | "purok"): AreaRow[] => {
    const keys = new Map<string, { barangay: string; purok: string }>();

    const register = (barangay: string, purok = "") => {
      const safeBarangay = barangay || "Unspecified Barangay";
      const safePurok = scope === "purok" ? (purok || "Unspecified Purok") : "";
      const key = scope === "barangay" ? safeBarangay : `${safeBarangay}::${safePurok}`;
      if (!keys.has(key)) keys.set(key, { barangay: safeBarangay, purok: safePurok });
    };

    const barangaysOf = (item: { barangays: string[] }) => (item.barangays.length > 0 ? item.barangays : ["Unspecified Barangay"]);

    filteredCollections.forEach((item) => {
      if (scope === "barangay") barangaysOf(item).forEach((barangay) => register(barangay));
      else {
        const targets = item.assignedPuroks.length > 0 ? item.assignedPuroks : item.claimedPuroks.length > 0 ? item.claimedPuroks : ["Unspecified Purok"];
        barangaysOf(item).forEach((barangay) => targets.forEach((purok) => register(barangay, purok)));
      }
    });
    filteredIssues.forEach((item) => {
      if (scope === "barangay") barangaysOf(item).forEach((barangay) => register(barangay));
      else barangaysOf(item).forEach((barangay) => (item.puroks.length > 0 ? item.puroks : ["Unspecified Purok"]).forEach((purok) => register(barangay, purok)));
    });
    filteredSchedules.forEach((item) => {
      if (scope === "barangay") barangaysOf(item).forEach((barangay) => register(barangay));
      else barangaysOf(item).forEach((barangay) => (item.puroks.length > 0 ? item.puroks : ["Unspecified Purok"]).forEach((purok) => register(barangay, purok)));
    });

    return Array.from(keys.entries()).map(([key, area]) => {
      const collectionMatches = filteredCollections.filter((item) => {
        if (!barangaysOf(item).includes(area.barangay)) return false;
        if (!area.purok) return true;
        const allPuroks = unique([...item.assignedPuroks, ...item.claimedPuroks, ...item.unclaimedPuroks]);
        return allPuroks.length === 0 || allPuroks.includes(area.purok);
      });
      const issueMatches = filteredIssues.filter((item) => {
        if (!barangaysOf(item).includes(area.barangay)) return false;
        if (!area.purok) return true;
        return item.puroks.length === 0 || item.puroks.includes(area.purok);
      });
      const scheduleMatches = filteredSchedules.filter((item) => {
        if (!barangaysOf(item).includes(area.barangay)) return false;
        if (!area.purok) return true;
        return item.puroks.length === 0 || item.puroks.includes(area.purok);
      });

      const completed = collectionMatches.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
      const partial = collectionMatches.filter((item) => item.status === "partial" || item.unclaimedPuroks.length > 0).length;
      const missed = collectionMatches.filter((item) => item.status === "missed").length;
      const loads = collectionMatches.map((item) => item.truckLoadPercent).filter((value): value is number => value !== null);
      const followUpPuroks = unique(collectionMatches.flatMap((item) => item.unclaimedPuroks).filter((purok) => !area.purok || purok === area.purok));
      const base = {
        key,
        barangay: area.barangay,
        purok: area.purok,
        trips: collectionMatches.length,
        completed,
        partial,
        missed,
        followUpPuroks,
        completionRate: collectionMatches.length > 0 ? (completed / collectionMatches.length) * 100 : 0,
        averageLoad: loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : null,
        fullTruckEvents: collectionMatches.filter(isFullTruck).length,
        openIssues: issueMatches.filter((item) => item.isOpen).length,
        highImpactIssues: issueMatches.filter((item) => item.isOpen && item.isHighImpact).length,
        activeSchedules: scheduleMatches.length,
        gpsTrips: collectionMatches.filter((item) => item.hasGps).length,
        distanceMeters: collectionMatches.reduce((sum, item) => sum + item.distanceMeters, 0),
      };
      const recommendation = operationalRecommendation(base);
      const priority = areaPriority({
        partial: base.partial,
        missed: base.missed,
        fullTruckEvents: base.fullTruckEvents,
        openIssues: base.openIssues,
        highImpactIssues: base.highImpactIssues,
        followUpCount: base.followUpPuroks.length,
        activeSchedules: base.activeSchedules,
        trips: base.trips,
      });
      return {
        ...base,
        priority: priority.priority,
        priorityScore: priority.score,
        recommendation: recommendation.recommendation,
        reasons: recommendation.reasons,
      };
    }).sort((a, b) =>
      priorityRank(b.priority) - priorityRank(a.priority) ||
      b.priorityScore - a.priorityScore ||
      b.partial - a.partial ||
      b.fullTruckEvents - a.fullTruckEvents ||
      a.barangay.localeCompare(b.barangay),
    );
  };

  const barangayRows = useMemo(() => buildAreaRows("barangay"), [filteredCollections, filteredIssues, filteredSchedules]);
  const purokRows = useMemo(() => buildAreaRows("purok"), [filteredCollections, filteredIssues, filteredSchedules]);
  const areaRows = areaScope === "barangay" ? barangayRows : purokRows;

  const topProblemAreas = useMemo<ProblemAreaRow[]>(() => {
    const complaintByBarangay = new Map(complaintHotspots.map((row) => [row.barangay, row.total]));
    const complaintSources = new Set(["Complaint", "Resident Issue", "Reported Issue"]);
    const operationalIssueByBarangay = new Map<string, number>();

    filteredIssues.forEach((item) => {
      if (!item.isOpen || complaintSources.has(item.source)) return;
      item.barangays.forEach((barangay) => {
        operationalIssueByBarangay.set(barangay, (operationalIssueByBarangay.get(barangay) || 0) + 1);
      });
    });

    return barangayRows
      .map((row) => {
        const complaints = complaintByBarangay.get(row.barangay) || 0;
        const openOperationalIssues = operationalIssueByBarangay.get(row.barangay) || 0;
        const missedCollections = row.missed;
        const indicatorTotal = complaints + missedCollections + openOperationalIssues;
        const maximum = Math.max(complaints, missedCollections, openOperationalIssues);
        const concerns: string[] = [];
        if (maximum > 0 && complaints === maximum) concerns.push("Complaints");
        if (maximum > 0 && missedCollections === maximum) concerns.push("Missed collections");
        if (maximum > 0 && openOperationalIssues === maximum) concerns.push("Open issues");
        return {
          barangay: row.barangay,
          complaints,
          missedCollections,
          openOperationalIssues,
          indicatorTotal,
          primaryConcern: concerns.join(" + ") || "No current problem signal",
        };
      })
      .filter((row) => row.indicatorTotal > 0)
      .sort((a, b) =>
        b.indicatorTotal - a.indicatorTotal ||
        b.missedCollections - a.missedCollections ||
        b.openOperationalIssues - a.openOperationalIssues ||
        b.complaints - a.complaints ||
        a.barangay.localeCompare(b.barangay),
      )
      .slice(0, 5);
  }, [barangayRows, complaintHotspots, filteredIssues]);

  const monthlyComparison = useMemo<MonthlyComparison>(() => {
    const currentWindow = manilaMonthBounds(0);
    const previousWindow = manilaMonthBounds(-1);
    const complaintSources = new Set(["Complaint", "Resident Issue", "Reported Issue"]);

    const collectionDimensionMatch = (item: CollectionRecord) => {
      if (barangayFilter !== "all" && item.barangay !== barangayFilter) return false;
      if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
      if (truckFilter !== "all" && item.truckId !== truckFilter) return false;
      return true;
    };

    const issueDimensionMatch = (item: IssueRecord) => {
      if (barangayFilter !== "all" && item.barangay !== barangayFilter) return false;
      if (driverFilter !== "all" && item.driverId && item.driverId !== driverFilter) return false;
      return true;
    };

    const attendanceDimensionMatch = (item: AttendanceRecord) => {
      const driverId = cleanText(item.driverId ?? item.driverUid ?? item.sourceDriverKey);
      if (driverFilter !== "all" && driverId && driverId !== driverFilter) return false;
      if (barangayFilter !== "all") {
        const barangay = barangayText(item);
        if (barangay !== "Unspecified Barangay" && barangay !== barangayFilter) return false;
      }
      if (truckFilter !== "all") {
        const vehicle = cleanText(item.vehicle ?? item.truck ?? item.truckId);
        if (vehicle && vehicle !== truckFilter) return false;
      }
      return true;
    };

    const summarize = (window: { from: number; to: number; label: string }): MonthlyOpsSnapshot => {
      const collections = normalizedCollections.filter((item) =>
        collectionDimensionMatch(item) && timestampInBounds(item.timestamp, window),
      );
      const completedRuns = collections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
      const gpsVerifiedRuns = collections.filter((item) => item.hasGps).length;

      const complaintRecords = new Map<string, IssueRecord>();
      normalizedIssues
        .filter((item) => complaintSources.has(item.source) && issueDimensionMatch(item) && timestampInBounds(item.timestamp, window))
        .forEach((item) => {
          const signature = [
            item.timestamp,
            item.barangay.toLowerCase(),
            item.puroks.join(",").toLowerCase(),
            item.type.toLowerCase(),
            item.details.toLowerCase().slice(0, 160),
          ].join("|");
          const existing = complaintRecords.get(signature);
          if (!existing || item.source === "Complaint") complaintRecords.set(signature, item);
        });

      const attendance = driverAttendance.filter((item) => {
        const timestamp = attendanceTimestamp(item);
        return Boolean(timestamp && timestampInBounds(timestamp, window) && attendanceDimensionMatch(item));
      });

      let attendancePresent = 0;
      let attendanceLate = 0;
      let attendanceAbsent = 0;
      let attendanceIncomplete = 0;
      attendance.forEach((item) => {
        const status = cleanText(item.status ?? item.timingStatus, "").toLowerCase();
        const timeIn = objectValue(item.timeIn).timestamp;
        const timeOut = objectValue(item.timeOut).timestamp;
        if (status.includes("absent")) attendanceAbsent += 1;
        else if (!timeIn || !timeOut) attendanceIncomplete += 1;
        else if (status.includes("late")) attendanceLate += 1;
        else attendancePresent += 1;
      });

      return {
        label: window.label,
        from: window.from,
        to: window.to,
        collectionRuns: collections.length,
        completedRuns,
        completionRate: collections.length ? (completedRuns / collections.length) * 100 : 0,
        complaints: complaintRecords.size,
        truckFullEvents: collections.filter(isFullTruck).length,
        gpsVerifiedRuns,
        gpsVerificationRate: collections.length ? (gpsVerifiedRuns / collections.length) * 100 : 0,
        attendanceTotal: attendance.length,
        attendancePresent,
        attendanceLate,
        attendanceAbsent,
        attendanceIncomplete,
      };
    };

    return {
      current: summarize(currentWindow),
      previous: summarize(previousWindow),
    };
  }, [normalizedCollections, normalizedIssues, driverAttendance, barangayFilter, driverFilter, truckFilter]);

  const complaintChartData = useMemo<SvgBarDatum[]>(() =>
    complaintHotspots.slice(0, 6).map((row) => ({ label: row.barangay, value: row.total })),
  [complaintHotspots]);

  const completionChartData = useMemo<SvgBarDatum[]>(() => [
    { label: monthlyComparison.previous.label, value: monthlyComparison.previous.completionRate },
    { label: monthlyComparison.current.label, value: monthlyComparison.current.completionRate },
  ], [monthlyComparison]);

  const attendanceChartData = useMemo<SvgBarDatum[]>(() => [
    { label: "Present / on time", value: monthlyComparison.current.attendancePresent },
    { label: "Late", value: monthlyComparison.current.attendanceLate },
    { label: "Absent", value: monthlyComparison.current.attendanceAbsent },
    { label: "Incomplete punches", value: monthlyComparison.current.attendanceIncomplete },
  ], [monthlyComparison]);

  const truckFullChartData = useMemo<SvgBarDatum[]>(() =>
    [...barangayRows]
      .filter((row) => row.fullTruckEvents > 0)
      .sort((a, b) => b.fullTruckEvents - a.fullTruckEvents || a.barangay.localeCompare(b.barangay))
      .slice(0, 6)
      .map((row) => ({ label: row.barangay, value: row.fullTruckEvents })),
  [barangayRows]);

  const driverRows = useMemo<DriverRow[]>(() => {
    const ids = unique([
      ...filteredCollections.map((item) => item.driverId),
      ...filteredSchedules.map((item) => item.driverId),
      ...driverProfiles
        .filter((item) =>
          item.trackingActive ||
          item.status === "online" ||
          item.status === "active" ||
          (driverFilter !== "all" && item.id === driverFilter),
        )
        .map((item) => item.id),
    ].filter(Boolean));

    return ids.map((driverId) => {
      const profile = driverMap.get(driverId);
      const collections = filteredCollections.filter((item) => item.driverId === driverId);
      const issuesForDriver = filteredIssues.filter((item) => item.driverId === driverId && item.isOpen);
      const schedulesForDriver = filteredSchedules.filter((item) => item.driverId === driverId);
      const completed = collections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
      const partial = collections.filter((item) => item.status === "partial" || item.unclaimedPuroks.length > 0).length;
      const missed = collections.filter((item) => item.status === "missed").length;
      const loads = collections.map((item) => item.truckLoadPercent).filter((value): value is number => value !== null);
      const completionRate = collections.length ? (completed / collections.length) * 100 : 0;
      const fullTruckEvents = collections.filter(isFullTruck).length;
      const assessment: DriverRow["assessment"] =
        missed > 0 || partial >= 2 || completionRate < 70 ? "Review" :
        partial > 0 || fullTruckEvents >= 2 || issuesForDriver.length > 0 ? "Monitor" : "Good";

      return {
        key: driverId,
        driverId,
        driverName: cleanText(collections[0]?.driverName ?? profile?.name, "Driver"),
        trucks: unique([...collections.map((item) => item.truckId), profile?.truck || ""].filter((item) => item && item !== "Unassigned")),
        barangays: unique(collections.map((item) => item.barangay)),
        trips: collections.length,
        completed,
        partial,
        missed,
        completionRate,
        averageLoad: loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : null,
        fullTruckEvents,
        openIssues: issuesForDriver.length,
        activeSchedules: schedulesForDriver.length,
        gpsTrips: collections.filter((item) => item.hasGps).length,
        distanceMeters: collections.reduce((sum, item) => sum + nonNegativeNumber(item.distanceMeters), 0),
        durationSeconds: collections.reduce((sum, item) => sum + nonNegativeNumber(item.durationSeconds), 0),
        currentStatus: profile?.trackingActive
          ? "Tracking"
          : profile?.status === "online" || profile?.status === "active"
            ? "Online"
            : "Offline",
        trackingActive: Boolean(profile?.trackingActive),
        activeScheduleId: cleanText(profile?.activeScheduleId),
        lastGpsAt: profile?.lastGpsAt || 0,
        assessment,
      };
    }).sort((a, b) =>
      Number(b.trackingActive) - Number(a.trackingActive) ||
      b.trips - a.trips ||
      a.driverName.localeCompare(b.driverName),
    );
  }, [filteredCollections, filteredIssues, filteredSchedules, driverMap, driverProfiles, driverFilter]);

  const truckRows = useMemo<TruckRow[]>(() => {
    const truckIds = unique(filteredCollections.map((item) => item.truckId).filter((item) => item && item !== "Unassigned"));
    return truckIds.map((truckId) => {
      const collections = filteredCollections.filter((item) => item.truckId === truckId);
      const completed = collections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
      const partial = collections.filter((item) => item.status === "partial" || item.unclaimedPuroks.length > 0).length;
      const loads = collections.map((item) => item.truckLoadPercent).filter((value): value is number => value !== null);
      const fullTruckEvents = collections.filter(isFullTruck).length;
      const assessment: TruckRow["assessment"] =
        fullTruckEvents >= 2 || (fullTruckEvents >= 1 && partial > 0) ? "Capacity Review" :
        fullTruckEvents >= 1 || partial > 0 ? "Monitor" : "Normal";
      return {
        key: truckId,
        truckId,
        trips: collections.length,
        completed,
        partial,
        averageLoad: loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : null,
        fullTruckEvents,
        barangays: unique(collections.map((item) => item.barangay)),
        drivers: unique(collections.map((item) => item.driverName)),
        distanceMeters: collections.reduce((sum, item) => sum + item.distanceMeters, 0),
        assessment,
      };
    }).sort((a, b) => b.fullTruckEvents - a.fullTruckEvents || b.trips - a.trips);
  }, [filteredCollections]);

  const scheduleRows = useMemo<SchedulePerformanceRow[]>(() => filteredSchedules.map((schedule) => {
    const collections = filteredCollections.filter((item) => item.scheduleId === schedule.id);
    const completed = collections.filter((item) => item.status === "completed" && item.unclaimedPuroks.length === 0).length;
    const partial = collections.filter((item) => item.status === "partial" || item.unclaimedPuroks.length > 0).length;
    const latestCollection = collections.reduce((latest, item) => Math.max(latest, item.timestamp), 0);
    const completionRate = collections.length ? (completed / collections.length) * 100 : 0;
    let assessment = "Scheduled";
    if (collections.length === 0) assessment = "No collection in selected period";
    else if (partial > 0 || completionRate < 80) assessment = "Needs follow-up";
    else assessment = "Performing";
    return {
      id: schedule.id,
      title: schedule.title,
      barangay: schedule.barangay,
      puroks: schedule.puroks,
      driverName: schedule.driverName,
      truckId: schedule.truckId,
      status: schedule.status,
      trips: collections.length,
      completed,
      partial,
      completionRate,
      lastActivity: latestCollection || schedule.lastCompletedAt,
      assessment,
    };
  }).sort((a, b) => b.partial - a.partial || b.trips - a.trips), [filteredSchedules, filteredCollections]);

  const issueRows = useMemo(() => [...filteredIssues].sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (a.isHighImpact !== b.isHighImpact) return a.isHighImpact ? -1 : 1;
    return b.timestamp - a.timestamp;
  }), [filteredIssues]);

  const gpsCards = useMemo(() => {
    return filteredCollections
      .map((collection) => ({ collection, trace: gpsBySession.get(collection.sessionId) }))
      .filter((item): item is { collection: CollectionRecord; trace: GpsTrace } => Boolean(item.trace && item.trace.points.length >= 2))
      .sort((a, b) => b.collection.timestamp - a.collection.timestamp);
  }, [filteredCollections, gpsBySession]);

  const capacityDistribution = useMemo(() => {
    const counts = { quarter: 0, half: 0, threeQuarter: 0, full: 0, unknown: 0 };
    filteredCollections.forEach((item) => {
      const load = item.truckLoadPercent;
      if (load === null) counts.unknown += 1;
      else if (load >= 100) counts.full += 1;
      else if (load >= 75) counts.threeQuarter += 1;
      else if (load >= 50) counts.half += 1;
      else counts.quarter += 1;
    });
    return counts;
  }, [filteredCollections]);

  const managementActions = useMemo(() => {
    const actions: string[] = [];
    barangayRows.filter((row) => row.priority === "Critical" || row.priority === "High").slice(0, 3).forEach((row) => {
      actions.push(`${row.barangay}: ${row.recommendation}`);
    });
    if (summary.followUpPuroks > 0) actions.push(`Confirm follow-up collection for ${summary.followUpPuroks} unique uncollected Purok${summary.followUpPuroks === 1 ? "" : "s"} recorded in the selected period.`);
    if (summary.truckFullEvents > 0) actions.push(`Review ${summary.truckFullEvents} full-truck event${summary.truckFullEvents === 1 ? "" : "s"} against route sequence and truck capacity before changing collection frequency.`);
    if (summary.openIssues > 0) actions.push(`Assign owners and resolution status to ${summary.openIssues} open operational issue${summary.openIssues === 1 ? "" : "s"}.`);
    if (topComplaintHotspot && topComplaintHotspot.total > 0) actions.push(`${topComplaintHotspot.barangay} recorded the highest complaint volume (${topComplaintHotspot.total}, ${topComplaintHotspot.open} still open). Review ${topComplaintHotspot.topCategory.toLowerCase()} complaints and confirm corrective action.`);
    if (summary.gpsVerificationRate < 80 && summary.totalTrips > 0) actions.push(`GPS verification is ${formatPercent(summary.gpsVerificationRate)}. Review trips without sufficient recorded GPS points before treating them as fully verified field activity.`);
    if (fullSystemSummary.attendance.late > 0 || fullSystemSummary.attendance.incomplete > 0) actions.push(`Driver attendance needs review: ${fullSystemSummary.attendance.late} late record${fullSystemSummary.attendance.late === 1 ? "" : "s"} and ${fullSystemSummary.attendance.incomplete} incomplete time-in/time-out record${fullSystemSummary.attendance.incomplete === 1 ? "" : "s"} in the selected period.`);
    if (fullSystemSummary.compliance.open > 0) actions.push(`Resident compliance has ${fullSystemSummary.compliance.open} unresolved violation record${fullSystemSummary.compliance.open === 1 ? "" : "s"}. Confirm ownership, status, and follow-up before closing the reporting period.`);
    if (fullSystemSummary.activityReports.pending > 0) actions.push(`${fullSystemSummary.activityReports.pending} driver activity-report request${fullSystemSummary.activityReports.pending === 1 ? " is" : "s are"} still pending. Generate or close outstanding requests so driver records remain current.`);
    const coverageRisk = residentCoverageRows.find((row) => row.assessment === "Priority Review" || row.assessment === "Coverage Check");
    if (coverageRisk) actions.push(`${coverageRisk.barangay}: ${coverageRisk.assessment}. Residents ${coverageRisk.residents}, active schedules ${coverageRisk.activeSchedules}, open issues ${coverageRisk.openIssues}, complaints ${coverageRisk.complaints}. Confirm service coverage and corrective action.`);
    if (fullSystemSummary.wastePoints.total > 0 && fullSystemSummary.wastePoints.active === 0) actions.push("No active waste drop-off point is currently visible in the selected scope. Review Waste Drop-off Points before resident guidance is issued.");
    if (actions.length === 0) actions.push("Maintain the current operating plan and continue monitoring completion, capacity, GPS verification, issues, schedule coverage, attendance, resident compliance, and administrative follow-up.");
    return unique(actions).slice(0, 10);
  }, [barangayRows, summary, topComplaintHotspot, fullSystemSummary, residentCoverageRows]);

  const reportSubtitle = `${bounds.label} • ${barangayFilter === "all" ? "All Barangays" : barangayFilter} • ${driverFilter === "all" ? "All Drivers" : driverOptions.find(([id]) => id === driverFilter)?.[1] || "Selected Driver"} • ${truckFilter === "all" ? "All Trucks" : truckFilter}`;

  const generateReport = () => {
    if (range === "custom" && (!customFrom || !customTo || localDayEnd(customTo) < localDayStart(customFrom))) {
      window.alert("Select a valid custom start and end date before generating the report.");
      return;
    }
    setGenerated(true);
    setGeneratedAt(Date.now());
  };

  return (
    <section className="ops-report-shell" aria-label="MetroWaste operations report generator">
      <div className="ops-hero ops-agency-hero">
        <div className="ops-agency-brand">
          <img className="ops-agency-logo" src="/metrowaste-logo.jpg" alt="Metro Waste Solid Waste Management Corp. logo" />
          <div className="ops-hero-copy">
            <div className="ops-kicker"><span className="ops-live-dot" /> LIVE FIREBASE DATA • METROWASTE AGENCY REPORTING</div>
            <h2>Agency Operations Report</h2>
            <div className="ops-formal-subtitle">Metrowaste Solid Waste Management Corp.
            • Waste management service in Catbalogan</div>
          </div>
        </div>
        <div className="ops-hero-actions">
          <button type="button" className="ops-primary" onClick={generateReport}>
            <ActionIcon kind="report" />
            Generate Report
          </button>
          <button
            type="button"
            className="ops-secondary"
            disabled={!generated}
            onClick={() => printOperationsReport({
              reportType,
              generatedAt: generatedAt || Date.now(),
              lastUpdated,
              subtitle: reportSubtitle,
              summary,
              barangayRows,
              purokRows,
              driverRows,
              truckRows,
              issueRows,
              scheduleRows,
              gpsCards,
              managementActions,
              capacityDistribution,
              systemSnapshot,
              complaintHotspots,
              complaintRows: filteredComplaints,
              fullSystemSummary,
              topProblemAreas,
              monthlyComparison,
              residentCoverageRows,
              attendanceRows: filteredAttendance,
              violationRows: filteredViolations,
              wastePointRows: filteredWastePoints,
              routeStatusRows: filteredRouteStatusUpdates,
              activityRequestRows: filteredActivityRequests,
            })}
          >
            <ActionIcon kind="print" />
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="ops-config-card">
        <div className="ops-config-heading">
          <div>
            <span>REPORT BUILDER</span>
            <strong>Choose what the agency report should focus on</strong>
            <small>Select a report type and service filters. No database records are changed when a report is generated.</small>
          </div>
          <div className="ops-updated"><span className="ops-updated-dot" />Last data update <b>{formatDateTime(lastUpdated)}</b></div>
        </div>

        <div className="ops-workflow" aria-label="Agency report steps">
          <div><b>1</b><span><strong>Choose report</strong><small>Select the management view.</small></span></div>
          <div><b>2</b><span><strong>Set filters</strong><small>Period, area, driver, or truck.</small></span></div>
          <div><b>3</b><span><strong>Generate</strong><small>Review the report on screen.</small></span></div>
          <div><b>4</b><span><strong>Print / PDF</strong><small>A4 portrait output.</small></span></div>
        </div>

        <div className="ops-report-types">
          {REPORT_TYPES.map((item) => (
            <button
              type="button"
              key={item.value}
              className={reportType === item.value ? "active" : ""}
              onClick={() => setReportType(item.value)}
            >
              <span className={`ops-type-icon ${item.value}`} aria-hidden="true">
                <ReportTypeIcon type={item.value} />
              </span>
              <span className="ops-type-copy">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="ops-filter-grid">
          <label>
            <span>Report period</span>
            <select value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom date range</option>
              <option value="all">All records</option>
            </select>
          </label>
          {range === "custom" && (
            <>
              <label>
                <span>From</span>
                <input type="date" value={customFrom} max={today} onChange={(event) => setCustomFrom(event.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={customTo} max={today} onChange={(event) => setCustomTo(event.target.value)} />
              </label>
            </>
          )}
          <label>
            <span>Barangay</span>
            <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)}>
              <option value="all">All Barangays</option>
              {barangayOptions.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
            </select>
          </label>
          <label>
            <span>Driver</span>
            <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}>
              <option value="all">All Drivers</option>
              {driverOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Truck</span>
            <select value={truckFilter} onChange={(event) => setTruckFilter(event.target.value)}>
              <option value="all">All Trucks</option>
              {truckOptions.map((truck) => <option key={truck} value={truck}>{truck}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!generated ? (
        <div className="ops-empty-state">
          <div className="ops-empty-icon" aria-hidden="true">R</div>
          <h3>Configure your report</h3>
          <p>Select a report type, period, and optional service filters, then generate the operational report.</p>
        </div>
      ) : (
        <div className="ops-output">
          <header className="ops-output-head">
            <div>
              <div className="ops-kicker">AGENCY REPORT PREVIEW</div>
              <h3>{reportType === "complete" ? "Full System Agency Report" : `${reportTypeLabel(reportType)} Report`}</h3>
              <p>{reportSubtitle}</p>
            </div>
            <div className="ops-report-meta">
              <span>Generated</span>
              <strong>{formatDateTime(generatedAt)}</strong>
            </div>
          </header>

          <section className="ops-system-snapshot" aria-label="System-wide data snapshot">
            <div className="ops-snapshot-heading">
              <div>
                <span>SYSTEM SNAPSHOT</span>
                <strong>Live records included in this report</strong>
              </div>
              <b><span className="ops-updated-dot" /> REAL DATA</b>
            </div>
            <div className="ops-snapshot-grid">
              <div><span>Drivers</span><strong>{systemSnapshot.drivers}</strong></div>
              <div><span>Residents</span><strong>{systemSnapshot.residents}</strong></div>
              <div><span>Active Routes</span><strong>{systemSnapshot.activeRoutes}</strong></div>
              <div><span>Service Areas</span><strong>{systemSnapshot.servicePuroks}</strong><small>{systemSnapshot.serviceBarangays} Barangays</small></div>
              <div><span>Schedules</span><strong>{systemSnapshot.activeSchedules}</strong></div>
              <div><span>Collection Runs</span><strong>{systemSnapshot.collectionRuns}</strong></div>
              <div><span>Complaints</span><strong>{systemSnapshot.complaints}</strong></div>
              <div><span>Open Issues</span><strong>{systemSnapshot.openIssues}</strong></div>
              <div><span>Notifications</span><strong>{systemSnapshot.notifications}</strong><small>{fullSystemSummary.notifications.unread} unread</small></div>
              <div><span>GPS Sessions</span><strong>{systemSnapshot.gpsSessions}</strong></div>
              <div><span>Attendance Records</span><strong>{systemSnapshot.attendanceRecords}</strong><small>{systemSnapshot.lateAttendance} late • {systemSnapshot.incompleteAttendance} incomplete</small></div>
              <div><span>Compliance Cases</span><strong>{systemSnapshot.complianceViolations}</strong><small>{systemSnapshot.openViolations} unresolved</small></div>
              <div><span>Waste Points</span><strong>{systemSnapshot.wastePoints}</strong><small>{systemSnapshot.activeWastePoints} active</small></div>
              <div><span>Route Updates</span><strong>{systemSnapshot.routeStatusUpdates}</strong></div>
              <div><span>Activity Requests</span><strong>{systemSnapshot.activityReportRequests}</strong><small>{systemSnapshot.pendingActivityRequests} pending</small></div>
              <div><span>Generated Reports</span><strong>{systemSnapshot.activityReports}</strong></div>
            </div>
          </section>

          <div className="ops-basis-note">
            <div className="ops-basis-icon">i</div>
            <div>
              <strong>Truck capacity measurement</strong>
              <p>
                MetroWaste does not measure collected waste in kilograms. At the end of each collection, the driver
                provides an estimated truck-capacity level: 1/4 truck (25%), 1/2 truck (50%), 3/4 truck (75%),
                or Full truck (100%). These are operational capacity estimates used for monitoring, reporting, and
                route planning together with completed/uncollected Puroks, GPS activity, issues, and schedules.
              </p>
            </div>
          </div>

          <div className="ops-kpi-grid">
            <Kpi label="Collection Runs" value={String(summary.totalTrips)} hint="Recorded collection sessions" />
            <Kpi label="Fully Completed" value={String(summary.completedTrips)} hint={`${formatPercent(summary.completionRate)} completion rate`} tone="good" />
            <Kpi label="Follow-up Runs" value={String(summary.partialTrips + summary.missedTrips)} hint={`${summary.followUpPuroks} uncollected Purok${summary.followUpPuroks === 1 ? "" : "s"}`} tone={summary.partialTrips + summary.missedTrips > 0 ? "warn" : "good"} />
            <Kpi label="Estimated Truck Load" value={summary.averageTruckLoad === null ? "—" : formatPercent(summary.averageTruckLoad)} hint={`${summary.truckFullEvents} full-truck event${summary.truckFullEvents === 1 ? "" : "s"}`} tone={summary.truckFullEvents > 0 ? "warn" : "good"} />
            <Kpi label="Open Issues" value={String(summary.openIssues)} hint="Resident + driver operational issues" tone={summary.openIssues > 0 ? "warn" : "good"} />
            <Kpi
              label="Active Schedules"
              value={String(summary.activeSchedules)}
              hint={`${summary.trackingDrivers} tracking now • ${summary.onlineDrivers} online`}
              tone={summary.trackingDrivers > 0 ? "good" : "neutral"}
            />
            <Kpi label="GPS Verified" value={String(summary.gpsVerifiedTrips)} hint={`${formatPercent(summary.gpsVerificationRate)} of collection runs`} tone={summary.totalTrips > 0 && summary.gpsVerificationRate < 80 ? "warn" : "good"} />
          </div>

          <div className="ops-health-grid">
            <div className="ops-panel ops-health-panel">
              <SectionTitle eyebrow="EXECUTIVE HEALTH" title="Operational Performance" subtitle="Quick management readout from the selected operational period." />
              <div className="ops-health-content">
                <div className="ops-health-metrics">
                  <ProgressMetric label="Collection completion" value={summary.completionRate} />
                  <ProgressMetric label="GPS verification" value={summary.gpsVerificationRate} />
                  <ProgressMetric label="Estimated truck capacity" value={summary.averageTruckLoad ?? 0} muted={summary.averageTruckLoad === null} />
                </div>

                <div
                  className="ops-health-donut"
                  style={{
                    background: `conic-gradient(
                      #129b50 0 ${summary.completionRate}%,
                      #e9f0ec ${summary.completionRate}% 100%
                    )`,
                  }}
                  aria-label={`Collection completion ${formatPercent(summary.completionRate)}`}
                >
                  <div className="ops-health-donut-center">
                    <strong>{formatPercent(summary.completionRate)}</strong>
                    <span>complete</span>
                  </div>
                </div>

                <div className="ops-status-split">
                  <div><span className="dot completed" />Completed <strong>{summary.completedTrips}</strong></div>
                  <div><span className="dot partial" />Partial <strong>{summary.partialTrips}</strong></div>
                  <div><span className="dot missed" />Missed <strong>{summary.missedTrips}</strong></div>
                </div>
              </div>
            </div>

            <div className="ops-panel ops-action-panel">
              <SectionTitle eyebrow="MANAGEMENT ACTION" title="Recommended Next Actions" subtitle="Recommendations are triggered by real operational signals, not by collection count alone." />
              <ol className="ops-action-list">
                {managementActions.map((action, index) => <li key={`${index}-${action}`}>{action}</li>)}
              </ol>
            </div>
          </div>

          {reportType === "complete" && (
            <div className="ops-panel">
              <SectionTitle
                eyebrow="FULL SYSTEM CONTROL"
                title="Administrator System-Wide Operational Summary"
                subtitle="A single management view of field operations, attendance, resident compliance, notifications, waste-point coverage, route updates, and report-processing workload."
              />
              <div className="ops-system-snapshot ops-gap-top">
                <div className="ops-snapshot-heading">
                  <div><span>DRIVER ATTENDANCE</span><strong>Duty accountability</strong></div>
                  <b>{fullSystemSummary.attendance.total} records</b>
                </div>
                <div className="ops-snapshot-grid">
                  <div><span>Present / On time</span><strong>{fullSystemSummary.attendance.present}</strong></div>
                  <div><span>Late</span><strong>{fullSystemSummary.attendance.late}</strong></div>
                  <div><span>Absent</span><strong>{fullSystemSummary.attendance.absent}</strong></div>
                  <div><span>Incomplete</span><strong>{fullSystemSummary.attendance.incomplete}</strong></div>
                  <div><span>Completed Duty</span><strong>{fullSystemSummary.attendance.completedDuty}</strong></div>
                  <div><span>Avg Duty</span><strong>{fullSystemSummary.attendance.averageDutyMinutes ? formatDuration(fullSystemSummary.attendance.averageDutyMinutes * 60) : "—"}</strong></div>
                </div>
              </div>

              <div className="ops-system-snapshot ops-gap-top">
                <div className="ops-snapshot-heading">
                  <div><span>ADMINISTRATIVE CONTROL</span><strong>Compliance, public information, and reporting workflow</strong></div>
                  <b>LIVE SYSTEM</b>
                </div>
                <div className="ops-snapshot-grid">
                  <div><span>Resident Violations</span><strong>{fullSystemSummary.compliance.total}</strong><small>{fullSystemSummary.compliance.open} unresolved</small></div>
                  <div><span>Resolved / Dismissed</span><strong>{fullSystemSummary.compliance.resolved}</strong></div>
                  <div><span>Active Waste Points</span><strong>{fullSystemSummary.wastePoints.active}</strong><small>{fullSystemSummary.wastePoints.inactive} inactive</small></div>
                  <div><span>Route Status Updates</span><strong>{fullSystemSummary.routeUpdates.total}</strong><small>{fullSystemSummary.routeUpdates.problem} needs review</small></div>
                  <div><span>Activity Report Requests</span><strong>{fullSystemSummary.activityReports.requests}</strong><small>{fullSystemSummary.activityReports.pending} pending</small></div>
                  <div><span>Generated Activity Reports</span><strong>{fullSystemSummary.activityReports.generatedReports}</strong></div>
                  <div><span>Resident Notifications</span><strong>{fullSystemSummary.notifications.resident}</strong></div>
                  <div><span>Driver Notifications</span><strong>{fullSystemSummary.notifications.driver}</strong></div>
                  <div><span>Unread Notifications</span><strong>{fullSystemSummary.notifications.unread}</strong></div>
                </div>
              </div>
            </div>
          )}

          {reportType === "complete" && (
            <div className="ops-panel ops-intelligence-panel">
              <SectionTitle
                eyebrow="MANAGEMENT INTELLIGENCE"
                title="Operational Trends, Problem Areas & Monthly Comparison"
                subtitle="SVG charts use actual system records. Problem-area ranking is an equal-weight count of complaints + missed collections + non-complaint open operational issues for the selected report scope."
              />

              <div className="ops-chart-grid ops-gap-top">
                <SvgBarChart
                  title="Complaint volume by Barangay"
                  subtitle="Top Barangays in the selected report scope"
                  data={complaintChartData}
                />
                <SvgBarChart
                  title="Collection completion rate"
                  subtitle="Current calendar month vs previous month (Asia/Manila)"
                  data={completionChartData}
                  maximum={100}
                  suffix="%"
                  decimals={1}
                />
                <SvgBarChart
                  title={`Driver attendance • ${monthlyComparison.current.label}`}
                  subtitle="Exclusive classification of recorded duty attendance"
                  data={attendanceChartData}
                />
                <SvgBarChart
                  title="Truck-full incidents by Barangay"
                  subtitle="Recorded full-truck collection events in the selected report scope"
                  data={truckFullChartData}
                />
              </div>

              <div className="ops-intelligence-grid ops-gap-top">
                <section className="ops-analysis-block">
                  <div className="ops-analysis-heading">
                    <div><span>TOP 5 PROBLEM AREAS</span><strong>Where Admin attention is concentrated</strong></div>
                    <small>Indicator total = complaints + missed collections + open operational issues</small>
                  </div>
                  <div className="ops-table-wrap">
                    <table className="ops-table ops-problem-table">
                      <thead><tr><th>Rank</th><th>Barangay</th><th>Complaints</th><th>Missed Collections</th><th>Open Issues</th><th>Indicator Total</th><th>Primary Concern</th></tr></thead>
                      <tbody>
                        {topProblemAreas.map((row, index) => (
                          <tr key={row.barangay}>
                            <td><strong>#{index + 1}</strong></td>
                            <td><strong>{row.barangay}</strong></td>
                            <td>{row.complaints}</td>
                            <td className={row.missedCollections > 0 ? "attention" : ""}>{row.missedCollections}</td>
                            <td className={row.openOperationalIssues > 0 ? "attention" : ""}>{row.openOperationalIssues}</td>
                            <td><strong>{row.indicatorTotal}</strong></td>
                            <td>{row.primaryConcern}</td>
                          </tr>
                        ))}
                        {topProblemAreas.length === 0 && <tr><td colSpan={7} className="ops-no-data">No complaint, missed-collection, or open operational-issue signal is recorded for the selected scope.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="ops-analysis-block">
                  <div className="ops-analysis-heading">
                    <div><span>MONTHLY MANAGEMENT COMPARISON</span><strong>{monthlyComparison.current.label} vs {monthlyComparison.previous.label}</strong></div>
                    <small>Calendar-month comparison follows Asia/Manila and respects the current Barangay / Driver / Truck filters.</small>
                  </div>
                  <div className="ops-table-wrap">
                    <table className="ops-table ops-month-table">
                      <thead><tr><th>Metric</th><th>{monthlyComparison.previous.label}</th><th>{monthlyComparison.current.label}</th><th>Change</th></tr></thead>
                      <tbody>
                        <tr><td><strong>Collection runs</strong></td><td>{monthlyComparison.previous.collectionRuns}</td><td>{monthlyComparison.current.collectionRuns}</td><td>{signedCountChange(monthlyComparison.current.collectionRuns, monthlyComparison.previous.collectionRuns)}</td></tr>
                        <tr><td><strong>Completion rate</strong></td><td>{formatPercent(monthlyComparison.previous.completionRate)}</td><td>{formatPercent(monthlyComparison.current.completionRate)}</td><td>{signedPointChange(monthlyComparison.current.completionRate, monthlyComparison.previous.completionRate)}</td></tr>
                        <tr><td><strong>Complaints</strong></td><td>{monthlyComparison.previous.complaints}</td><td>{monthlyComparison.current.complaints}</td><td>{signedCountChange(monthlyComparison.current.complaints, monthlyComparison.previous.complaints)}</td></tr>
                        <tr><td><strong>Truck-full incidents</strong></td><td>{monthlyComparison.previous.truckFullEvents}</td><td>{monthlyComparison.current.truckFullEvents}</td><td>{signedCountChange(monthlyComparison.current.truckFullEvents, monthlyComparison.previous.truckFullEvents)}</td></tr>
                        <tr><td><strong>GPS verification rate</strong></td><td>{formatPercent(monthlyComparison.previous.gpsVerificationRate)}</td><td>{formatPercent(monthlyComparison.current.gpsVerificationRate)}</td><td>{signedPointChange(monthlyComparison.current.gpsVerificationRate, monthlyComparison.previous.gpsVerificationRate)}</td></tr>
                        <tr><td><strong>Attendance records</strong></td><td>{monthlyComparison.previous.attendanceTotal}</td><td>{monthlyComparison.current.attendanceTotal}</td><td>{signedCountChange(monthlyComparison.current.attendanceTotal, monthlyComparison.previous.attendanceTotal)}</td></tr>
                        <tr><td><strong>Late attendance</strong></td><td>{monthlyComparison.previous.attendanceLate}</td><td>{monthlyComparison.current.attendanceLate}</td><td>{signedCountChange(monthlyComparison.current.attendanceLate, monthlyComparison.previous.attendanceLate)}</td></tr>
                        <tr><td><strong>Incomplete attendance</strong></td><td>{monthlyComparison.previous.attendanceIncomplete}</td><td>{monthlyComparison.current.attendanceIncomplete}</td><td>{signedCountChange(monthlyComparison.current.attendanceIncomplete, monthlyComparison.previous.attendanceIncomplete)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
              <p className="ops-section-note"><strong>Interpretation note:</strong> The problem-area indicator is a transparent workload signal, not a disciplinary or severity score. Each recorded complaint, missed collection, and non-complaint open operational issue contributes one point.</p>
            </div>
          )}

          {(reportType === "complete" || reportType === "collection") && (
            <div className="ops-panel">
              <div className="ops-section-row">
                <SectionTitle eyebrow="SERVICE PERFORMANCE" title="Barangay & Purok Operational Performance" subtitle="Priorities reflect incomplete service, truck-capacity pressure, unresolved issues, and current schedule coverage." />
                <div className="ops-tabs">
                  <button type="button" className={areaScope === "barangay" ? "active" : ""} onClick={() => setAreaScope("barangay")}>Barangay</button>
                  <button type="button" className={areaScope === "purok" ? "active" : ""} onClick={() => setAreaScope("purok")}>Purok</button>
                </div>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Service Area</th><th>Runs</th><th>Completed</th><th>Follow-up</th><th>Completion</th><th>Avg Est. Load</th><th>Full Truck</th><th>Open Issues</th><th>Schedules</th><th>GPS</th><th>Priority</th><th>Operational Recommendation</th></tr></thead>
                  <tbody>
                    {areaRows.map((row) => (
                      <tr key={row.key}>
                        <td><strong>{row.barangay}</strong>{row.purok && <small>{row.purok}</small>}</td>
                        <td>{row.trips}</td>
                        <td>{row.completed}</td>
                        <td className={row.partial + row.missed > 0 ? "attention" : ""}>{row.partial + row.missed}{row.followUpPuroks.length > 0 && <small>{row.followUpPuroks.join(", ")}</small>}</td>
                        <td><strong>{formatPercent(row.completionRate)}</strong></td>
                        <td>{row.averageLoad === null ? "—" : formatPercent(row.averageLoad)}</td>
                        <td className={row.fullTruckEvents > 0 ? "attention" : ""}>{row.fullTruckEvents}</td>
                        <td className={row.openIssues > 0 ? "attention" : ""}>{row.openIssues}</td>
                        <td>{row.activeSchedules}</td>
                        <td>{row.gpsTrips}/{row.trips}</td>
                        <td><PriorityBadge value={row.priority} /></td>
                        <td className="recommendation"><strong>{row.reasons.join(" • ")}</strong><p>{row.recommendation}</p></td>
                      </tr>
                    ))}
                    {areaRows.length === 0 && <tr><td colSpan={12} className="ops-no-data">No service-area records match the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportIncludes(reportType, "drivers") && (
            <div className="ops-panel">
              <SectionTitle eyebrow="DRIVER OPERATIONS" title="Driver Activity & Service Performance" subtitle="Operational workload and completion indicators; not a disciplinary score." />
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Driver</th><th>Live Status</th><th>Truck</th><th>Last GPS</th><th>Runs</th><th>Completed</th><th>Partial / Missed</th><th>Completion</th><th>Avg Est. Load</th><th>Full Truck</th><th>GPS Runs</th><th>Distance</th><th>Open Issues</th><th>Assessment</th></tr></thead>
                  <tbody>
                    {driverRows.map((row) => (
                      <tr key={row.key}>
                        <td><strong>{row.driverName}</strong><small>{row.barangays.join(", ") || "No service area"}</small></td>
                        <td>
                          <span className={`ops-driver-state ${row.trackingActive ? "tracking" : row.currentStatus.toLowerCase()}`}>
                            {row.currentStatus}
                          </span>
                          {row.activeScheduleId && <small>Schedule {row.activeScheduleId}</small>}
                        </td>
                        <td>{row.trucks.join(", ") || "—"}</td>
                        <td>{row.lastGpsAt > 0 ? formatDateTime(row.lastGpsAt) : "—"}</td>
                        <td>{row.trips}</td>
                        <td>{row.completed}</td>
                        <td>{row.partial + row.missed}</td>
                        <td><strong>{formatPercent(row.completionRate)}</strong></td>
                        <td>{row.averageLoad === null ? "—" : formatPercent(row.averageLoad)}</td>
                        <td>{row.fullTruckEvents}</td>
                        <td>{row.gpsTrips}</td>
                        <td>{formatDistance(row.distanceMeters)}</td>
                        <td>{row.openIssues}</td>
                        <td><AssessmentBadge value={row.assessment} /></td>
                      </tr>
                    ))}
                    {driverRows.length === 0 && <tr><td colSpan={14} className="ops-no-data">No driver activity matches the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportIncludes(reportType, "capacity") && (
            <div className="ops-panel">
              <SectionTitle eyebrow="TRUCK CAPACITY" title="Truck Load & Capacity Pressure" subtitle="Uses the driver's estimated truck capacity: 1/4, 1/2, 3/4, or Full. No kilogram measurement is required." />
              <div className="ops-capacity-grid">
                <CapacityTile label="1/4 Truck" value={capacityDistribution.quarter} percent={summary.totalTrips ? (capacityDistribution.quarter / summary.totalTrips) * 100 : 0} />
                <CapacityTile label="1/2 Truck" value={capacityDistribution.half} percent={summary.totalTrips ? (capacityDistribution.half / summary.totalTrips) * 100 : 0} />
                <CapacityTile label="3/4 Truck" value={capacityDistribution.threeQuarter} percent={summary.totalTrips ? (capacityDistribution.threeQuarter / summary.totalTrips) * 100 : 0} />
                <CapacityTile label="Full Truck" value={capacityDistribution.full} percent={summary.totalTrips ? (capacityDistribution.full / summary.totalTrips) * 100 : 0} alert={capacityDistribution.full > 0} />
              </div>
              <div className="ops-table-wrap ops-gap-top">
                <table className="ops-table">
                  <thead><tr><th>Truck</th><th>Runs</th><th>Completed</th><th>Partial</th><th>Avg Est. Load</th><th>Full Events</th><th>Barangays Served</th><th>Drivers</th><th>Distance</th><th>Assessment</th></tr></thead>
                  <tbody>
                    {truckRows.map((row) => <tr key={row.key}><td><strong>{row.truckId}</strong></td><td>{row.trips}</td><td>{row.completed}</td><td>{row.partial}</td><td>{row.averageLoad === null ? "—" : formatPercent(row.averageLoad)}</td><td className={row.fullTruckEvents > 0 ? "attention" : ""}>{row.fullTruckEvents}</td><td>{row.barangays.join(", ") || "—"}</td><td>{row.drivers.join(", ") || "—"}</td><td>{formatDistance(row.distanceMeters)}</td><td><AssessmentBadge value={row.assessment} /></td></tr>)}
                    {truckRows.length === 0 && <tr><td colSpan={10} className="ops-no-data">No truck-capacity records match the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(reportType === "complete" || reportType === "issues" || reportType === "complaints") && (
            <div className="ops-panel">
              <div className="ops-section-row">
                <SectionTitle
                  eyebrow="COMPLAINT INTELLIGENCE"
                  title="Barangay Complaint Hotspots"
                  subtitle="Ranks complaint and resident-report records by Barangay so management can see where complaint volume is concentrated."
                />
                <span className="ops-count-chip">{filteredComplaints.length} complaint{filteredComplaints.length === 1 ? "" : "s"}</span>
              </div>

              {topComplaintHotspot ? (
                <div className="ops-hotspot-summary">
                  <div><span>Highest complaint volume</span><strong>{topComplaintHotspot.barangay}</strong></div>
                  <div><span>Total complaints</span><strong>{topComplaintHotspot.total}</strong></div>
                  <div><span>Still open</span><strong>{topComplaintHotspot.open}</strong></div>
                  <div><span>Most common category</span><strong>{topComplaintHotspot.topCategory}</strong></div>
                </div>
              ) : (
                <div className="ops-inline-empty">No complaint records match the selected filters.</div>
              )}

              <div className="ops-table-wrap ops-gap-top">
                <table className="ops-table ops-complaint-table">
                  <thead><tr><th>Rank</th><th>Barangay</th><th>Complaints</th><th>Open</th><th>Resolved</th><th>High Impact</th><th>Share</th><th>Most Common Category</th><th>Latest</th></tr></thead>
                  <tbody>
                    {complaintHotspots.map((row, index) => (
                      <tr key={row.barangay}>
                        <td><strong>#{index + 1}</strong></td>
                        <td><strong>{row.barangay}</strong></td>
                        <td>{row.total}</td>
                        <td className={row.open > 0 ? "attention" : ""}>{row.open}</td>
                        <td>{row.resolved}</td>
                        <td>{row.highImpact}</td>
                        <td>{formatPercent(row.share)}</td>
                        <td>{row.topCategory}</td>
                        <td>{formatDateTime(row.latestAt)}</td>
                      </tr>
                    ))}
                    {complaintHotspots.length === 0 && <tr><td colSpan={9} className="ops-no-data">No complaint hotspot data is available for the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>

              {reportType === "complaints" && (
                <div className="ops-table-wrap ops-gap-top">
                  <table className="ops-table">
                    <thead><tr><th>Date</th><th>Barangay</th><th>Purok</th><th>Complaint</th><th>Severity</th><th>Status</th><th>Details</th></tr></thead>
                    <tbody>
                      {filteredComplaints.slice(0, 100).map((row) => <tr key={row.id}><td>{formatDateTime(row.timestamp)}</td><td><strong>{row.barangay}</strong></td><td>{row.puroks.join(", ") || "Not specified"}</td><td>{row.type}</td><td>{row.severity}</td><td><StatusBadge value={row.isOpen ? "Open" : "Resolved"} alert={row.isOpen} /></td><td className="recommendation">{row.details || "No description provided"}</td></tr>)}
                      {filteredComplaints.length === 0 && <tr><td colSpan={7} className="ops-no-data">No complaint records match the selected filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {reportIncludes(reportType, "issues") && (
            <div className="ops-panel">
              <SectionTitle eyebrow="ISSUES & COMPLAINTS" title="Operational Issue Register" subtitle="Consolidated driver, resident, complaint, and report issue records for management follow-up." />
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Date</th><th>Source</th><th>Area</th><th>Issue</th><th>Severity</th><th>Status</th><th>Details</th></tr></thead>
                  <tbody>
                    {issueRows.slice(0, 100).map((row) => <tr key={row.id}><td>{formatDateTime(row.timestamp)}</td><td>{row.source}</td><td><strong>{row.barangay}</strong><small>{row.puroks.join(", ")}</small></td><td>{row.type}</td><td>{row.severity}</td><td><StatusBadge value={row.isOpen ? "Open" : "Resolved"} alert={row.isOpen} /></td><td className="recommendation">{row.details || "—"}</td></tr>)}
                    {issueRows.length === 0 && <tr><td colSpan={7} className="ops-no-data">No issue records match the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportIncludes(reportType, "schedules") && (
            <div className="ops-panel">
              <SectionTitle eyebrow="SCHEDULE PERFORMANCE" title="Collection Schedule Coverage" subtitle="Compares active schedule assignments with collection activity in the selected report period." />
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Schedule</th><th>Service Area</th><th>Driver</th><th>Truck</th><th>Status</th><th>Runs</th><th>Completed</th><th>Partial</th><th>Completion</th><th>Last Activity</th><th>Assessment</th></tr></thead>
                  <tbody>
                    {scheduleRows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong></td><td><strong>{row.barangay}</strong><small>{row.puroks.join(", ") || "All / unspecified Puroks"}</small></td><td>{row.driverName}</td><td>{row.truckId}</td><td>{row.status}</td><td>{row.trips}</td><td>{row.completed}</td><td>{row.partial}</td><td>{formatPercent(row.completionRate)}</td><td>{formatDateTime(row.lastActivity)}</td><td><AssessmentBadge value={row.assessment} /></td></tr>)}
                    {scheduleRows.length === 0 && <tr><td colSpan={11} className="ops-no-data">No active schedules match the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportType === "complete" && (
            <>
              <div className="ops-panel">
                <SectionTitle
                  eyebrow="RESIDENT & SERVICE COVERAGE"
                  title="Barangay Coverage and Community Service Position"
                  subtitle="Combines resident registrations, configured Puroks, collection execution, schedules, complaints, open issues, and active waste drop-off points."
                />
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Barangay</th><th>Residents</th><th>Service Puroks</th><th>Schedules</th><th>Collection Runs</th><th>Completion</th><th>Complaints</th><th>Open Issues</th><th>Waste Points</th><th>Management Assessment</th></tr></thead>
                    <tbody>
                      {residentCoverageRows.map((row) => <tr key={row.barangay}><td><strong>{row.barangay}</strong></td><td>{row.residents}</td><td>{row.servicePuroks}</td><td>{row.activeSchedules}</td><td>{row.collectionRuns}</td><td>{row.collectionRuns ? formatPercent(row.completionRate) : "No runs"}</td><td className={row.complaints > 0 ? "attention" : ""}>{row.complaints}</td><td className={row.openIssues > 0 ? "attention" : ""}>{row.openIssues}</td><td>{row.activeWastePoints}</td><td><AssessmentBadge value={row.assessment} /></td></tr>)}
                      {residentCoverageRows.length === 0 && <tr><td colSpan={10} className="ops-no-data">No Barangay coverage records match the selected scope.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ops-panel">
                <SectionTitle eyebrow="DRIVER ATTENDANCE" title="Duty Attendance & Verification Records" subtitle="Shows recorded duty, scheduled assignment, time-in/time-out completeness, and attendance status for administrative review." />
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Date</th><th>Driver</th><th>Vehicle</th><th>Schedule / Route</th><th>Service Area</th><th>Time In</th><th>Time Out</th><th>Duty</th><th>Status</th></tr></thead>
                    <tbody>
                      {filteredAttendance.slice(0, 100).map((row) => {
                        const timeIn = objectValue(row.timeIn);
                        const timeOut = objectValue(row.timeOut);
                        return <tr key={cleanText(row.id)}><td>{cleanText(row.dateKey) || formatDate(attendanceTimestamp(row))}</td><td><strong>{cleanText(row.driverName, "Driver")}</strong></td><td>{cleanText(row.vehicle ?? row.truck, "—")}</td><td><strong>{cleanText(row.scheduleTitle, "No schedule title")}</strong><small>{cleanText(row.routeId, "No route ID")}</small></td><td><strong>{barangayText(row)}</strong><small>{cleanText(row.puroks, "Purok not recorded")}</small></td><td>{timeIn.timestamp ? formatDateTime(normalizeTimestamp(timeIn.timestamp)) : "Not recorded"}</td><td>{timeOut.timestamp ? formatDateTime(normalizeTimestamp(timeOut.timestamp)) : "Not recorded"}</td><td>{nonNegativeNumber(row.totalDutyMinutes) ? formatDuration(nonNegativeNumber(row.totalDutyMinutes) * 60) : "—"}</td><td><strong>{cleanText(row.status ?? row.timingStatus, "Incomplete")}</strong></td></tr>;
                      })}
                      {filteredAttendance.length === 0 && <tr><td colSpan={9} className="ops-no-data">No driver attendance records match the selected filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ops-panel">
                <SectionTitle eyebrow="RESIDENT COMPLIANCE" title="Resident Violation & Compliance Register" subtitle="Administrative record of resident violations, penalties, review status, and unresolved compliance actions." />
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Date</th><th>Resident</th><th>Barangay / Purok</th><th>Violation</th><th>Penalty</th><th>Status</th><th>Notes</th></tr></thead>
                    <tbody>
                      {filteredViolations.slice(0, 100).map((row) => {
                        const resident = residentById.get(cleanText(row.residentId)) || {};
                        return <tr key={`${cleanText(row.residentId)}:${cleanText(row.id)}`}><td>{formatDateTime(normalizeTimestamp(row.issuedAt ?? row.updatedAt ?? row.createdAt))}</td><td><strong>{cleanText(row.residentName ?? resident.name ?? resident.fullName ?? resident.email, "Resident")}</strong></td><td><strong>{barangayText({ ...resident, ...row })}</strong><small>{cleanText(row.purok ?? resident.purok, "Purok not recorded")}</small></td><td>{cleanText(row.violation, "Not specified")}</td><td>{cleanText(row.penalty, "—")}</td><td><strong>{cleanText(row.status, "Recorded")}</strong></td><td className="recommendation">{cleanText(row.notes, "—")}</td></tr>;
                      })}
                      {filteredViolations.length === 0 && <tr><td colSpan={7} className="ops-no-data">No resident compliance records match the selected filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ops-panel">
                <SectionTitle eyebrow="PUBLIC SERVICE INFRASTRUCTURE" title="Official Waste Drop-off Points" subtitle="Verifies which official waste points are active, where they are located, and whether residents currently have a published disposal reference." />
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Point</th><th>Barangay</th><th>Landmark</th><th>Instructions</th><th>Status</th><th>Last Update</th></tr></thead>
                    <tbody>
                      {filteredWastePoints.map((row) => <tr key={cleanText(row.id)}><td><strong>{cleanText(row.name, "Waste Drop-off Point")}</strong></td><td>{barangayText(row)}</td><td>{cleanText(row.landmark, "—")}</td><td className="recommendation">{cleanText(row.instructions, "No special instructions")}</td><td><strong>{row.active === false || String(row.active).toLowerCase() === "false" ? "Inactive" : "Active"}</strong></td><td>{formatDateTime(normalizeTimestamp(row.updatedAt ?? row.createdAt))}</td></tr>)}
                      {filteredWastePoints.length === 0 && <tr><td colSpan={6} className="ops-no-data">No waste drop-off points match the selected scope.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ops-panel">
                <SectionTitle eyebrow="FIELD STATUS & ADMIN WORKFLOW" title="Route Updates and Driver Report Processing" subtitle="Shows recent field status messages and whether driver-requested activity reports are still pending, sent, or failed." />
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Time</th><th>Driver</th><th>Route</th><th>Stop / Area</th><th>Status</th><th>Notes</th></tr></thead>
                    <tbody>
                      {filteredRouteStatusUpdates.slice(0, 60).map((row) => <tr key={cleanText(row.id)}><td>{formatDateTime(routeStatusTimestamp(row))}</td><td>{cleanText(row.driverName, "Driver")}</td><td><strong>{cleanText(row.routeName, "Route not specified")}</strong></td><td>{cleanText(row.stop ?? row.barangay ?? row.purok, "—")}</td><td><strong>{cleanText(row.status, "—")}</strong></td><td className="recommendation">{cleanText(row.notes, "—")}</td></tr>)}
                      {filteredRouteStatusUpdates.length === 0 && <tr><td colSpan={6} className="ops-no-data">No route-status updates match the selected period.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="ops-table-wrap ops-gap-top">
                  <table className="ops-table">
                    <thead><tr><th>Requested</th><th>Driver</th><th>Reporting Period</th><th>Status</th><th>Sent / Updated</th><th>Administrative Meaning</th></tr></thead>
                    <tbody>
                      {filteredActivityRequests.slice(0, 60).map((row) => {
                        const status = cleanText(row.status, "Pending");
                        const normalized = status.toLowerCase();
                        const meaning = ["sent", "delivered", "completed", "generated"].includes(normalized) ? "Report processed and released" : normalized.includes("fail") || normalized.includes("error") ? "Needs administrator retry or review" : "Awaiting administrator processing";
                        return <tr key={cleanText(row.id)}><td>{formatDateTime(normalizeTimestamp(row.requestedAt ?? row.createdAt))}</td><td><strong>{cleanText(row.driverName ?? row.name, "Driver")}</strong><small>{cleanText(row.driverId, "")}</small></td><td>{cleanText(row.periodLabel ?? row.dateLabel ?? row.reportPeriod, "Requested activity period")}</td><td><strong>{status}</strong></td><td>{formatDateTime(normalizeTimestamp(row.sentAt ?? row.updatedAt))}</td><td className="recommendation">{meaning}</td></tr>;
                      })}
                      {filteredActivityRequests.length === 0 && <tr><td colSpan={6} className="ops-no-data">No driver activity-report requests match the selected period.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {reportIncludes(reportType, "gps") && (
            <div className="ops-panel">
              <div className="ops-section-row">
                <SectionTitle eyebrow="GPS ACTIVITY" title="Recorded Collection Route Traces" subtitle="Actual GPS coordinates from Realtime Database. Green = start, red = end, blue = recorded driver path." />
                <span className="ops-count-chip">{gpsCards.length} verified route{gpsCards.length === 1 ? "" : "s"}</span>
              </div>
              <div className="ops-gps-grid">
                {gpsCards.slice(0, 12).map(({ collection, trace }) => (
                  <article className="ops-gps-card" key={collection.sessionId}>
                    <RouteTrace points={trace.points} />
                    <div className="ops-gps-card-body">
                      <div><strong>{collection.routeName}</strong><span>{collection.barangay}</span></div>
                      <div className="ops-gps-meta"><span>{collection.driverName}</span><span>{collection.truckId}</span><span>{formatDateTime(collection.timestamp)}</span></div>
                      <div className="ops-gps-stats"><span>{trace.points.length} GPS points</span><span>{formatDistance(collection.distanceMeters)}</span><span>{formatDuration(collection.durationSeconds)}</span></div>
                    </div>
                  </article>
                ))}
                {gpsCards.length === 0 && <div className="ops-no-data ops-gps-no-data">No GPS route with at least two recorded points matches the selected filters.</div>}
              </div>
              {gpsCards.length > 12 && <div className="ops-section-note">Showing the 12 most recent GPS route traces on screen. The printable report includes up to 20 recent route traces.</div>}
            </div>
          )}

          <footer className="ops-report-footer">
            <div><strong>MetroWaste Agency Operations Report</strong><span>Management-ready report generated from operational records.</span></div>
            <div><span>Prepared / Reviewed by</span><span className="signature-line" /></div>
            <div><span>Authorized Representative</span><span className="signature-line" /></div>
          </footer>
        </div>
      )}

      <style jsx global>{`
        .ops-report-shell{display:grid;gap:18px;color:#0f172a}.ops-hero{position:relative;overflow:hidden;display:flex;justify-content:space-between;gap:28px;align-items:center;padding:28px;border:1px solid #cfe8df;border-radius:24px;background:radial-gradient(circle at 88% 15%,rgba(16,185,129,.14),transparent 26%),linear-gradient(135deg,#ecfdf5 0%,#ffffff 52%,#eff6ff 100%);box-shadow:0 18px 45px rgba(15,23,42,.06)}.ops-hero:after{content:"";position:absolute;width:220px;height:220px;border:1px solid rgba(5,150,105,.12);border-radius:50%;right:-70px;bottom:-110px}.ops-hero-copy{position:relative;z-index:1;max-width:860px}.ops-kicker{display:flex;align-items:center;gap:8px;color:#047857;font-size:10px;font-weight:950;letter-spacing:.1em}.ops-live-dot{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 5px rgba(16,185,129,.12)}.ops-hero h2{margin:8px 0 7px;font-size:30px;letter-spacing:-.04em;color:#0f172a}.ops-hero p{max-width:820px;margin:0;color:#526176;font-size:12px;line-height:1.65}.ops-source-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}.ops-source-chips span,.ops-count-chip{display:inline-flex;align-items:center;border:1px solid #d7e9e2;background:rgba(255,255,255,.8);border-radius:999px;padding:7px 10px;color:#456056;font-size:9px;font-weight:800}.ops-hero-actions{position:relative;z-index:1;display:flex;flex-direction:column;gap:9px;min-width:220px}.ops-hero-actions button{height:44px;border:0;border-radius:12px;padding:0 16px;font-weight:900;cursor:pointer}.ops-primary{background:#047857;color:#fff;box-shadow:0 10px 24px rgba(4,120,87,.18)}.ops-secondary{background:#0f172a;color:#fff}.ops-secondary:disabled{opacity:.38;cursor:not-allowed}.ops-config-card,.ops-panel,.ops-output{border:1px solid #e2e8f0;border-radius:20px;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.04)}.ops-config-card{padding:18px}.ops-config-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:15px}.ops-config-heading>div:first-child{display:grid;gap:3px}.ops-config-heading span{color:#047857;font-size:8px;font-weight:950;letter-spacing:.09em}.ops-config-heading strong{font-size:16px}.ops-updated{font-size:9px;color:#64748b}.ops-updated b{color:#334155}.ops-report-types{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:14px}.ops-report-types button{display:grid;gap:4px;min-height:76px;text-align:left;border:1px solid #e2e8f0;border-radius:13px;background:#f8fafc;padding:11px;cursor:pointer}.ops-report-types button strong{font-size:10px;color:#334155}.ops-report-types button span{font-size:8px;line-height:1.4;color:#7b8a9d}.ops-report-types button.active{border-color:#34d399;background:#ecfdf5;box-shadow:inset 0 0 0 1px #34d399}.ops-report-types button.active strong{color:#047857}.ops-filter-grid{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:10px;margin-top:13px;padding-top:13px;border-top:1px solid #eef2f7}.ops-filter-grid label{display:grid;gap:5px}.ops-filter-grid label>span{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#64748b}.ops-filter-grid select,.ops-filter-grid input{width:100%;height:39px;border:1px solid #dce5ec;border-radius:10px;background:#fff;padding:0 10px;color:#0f172a;outline:none;font-size:10px}.ops-filter-grid select:focus,.ops-filter-grid input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.08)}.ops-empty-state{display:grid;justify-items:center;text-align:center;padding:48px;border:1px dashed #cbd5e1;border-radius:20px;background:#f8fafc}.ops-empty-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:#047857;color:#fff;font-size:20px;font-weight:950;box-shadow:0 10px 25px rgba(4,120,87,.16)}.ops-empty-state h3{margin:12px 0 4px;font-size:16px}.ops-empty-state p{margin:0;color:#64748b;font-size:10px}.ops-output{display:grid;gap:14px;padding:18px}.ops-output-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:4px 2px 13px;border-bottom:1px solid #edf2f7}.ops-output-head h3{margin:4px 0 3px;font-size:24px;letter-spacing:-.035em}.ops-output-head p{margin:0;color:#64748b;font-size:10px}.ops-report-meta{display:grid;justify-items:end;gap:2px;color:#64748b;font-size:8px}.ops-report-meta strong{color:#334155;font-size:10px}.ops-basis-note{display:flex;align-items:flex-start;gap:11px;padding:13px 14px;border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff}.ops-basis-icon{display:grid;place-items:center;flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:900}.ops-basis-note strong{font-size:10px;color:#1e3a8a}.ops-basis-note p{margin:3px 0 0;color:#475569;font-size:9px;line-height:1.55}.ops-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ops-health-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:12px}.ops-panel{padding:16px}.ops-section-title{display:grid;gap:3px}.ops-section-title span{font-size:8px;font-weight:950;letter-spacing:.08em;color:#059669}.ops-section-title h4{margin:0;font-size:16px;letter-spacing:-.025em}.ops-section-title p{margin:0;color:#64748b;font-size:9px;line-height:1.5}.ops-section-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.ops-tabs{display:inline-flex;gap:3px;padding:4px;background:#f1f5f9;border-radius:10px}.ops-tabs button{height:30px;border:0;border-radius:8px;background:transparent;color:#64748b;padding:0 11px;font-size:9px;font-weight:900;cursor:pointer}.ops-tabs button.active{background:#fff;color:#047857;box-shadow:0 2px 7px rgba(15,23,42,.08)}.ops-health-panel{display:grid;gap:11px}.ops-progress-row{display:grid;grid-template-columns:130px 1fr 43px;align-items:center;gap:9px}.ops-progress-row>span{font-size:9px;color:#475569}.ops-progress-track{height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden}.ops-progress-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#059669,#34d399)}.ops-progress-row>strong{font-size:9px;text-align:right}.ops-progress-row.muted .ops-progress-fill{background:#94a3b8}.ops-progress-row.muted>strong{color:#94a3b8}.ops-status-split{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:3px}.ops-status-split>div{display:flex;align-items:center;gap:6px;border:1px solid #e2e8f0;border-radius:10px;padding:9px;font-size:8px;color:#64748b}.ops-status-split strong{margin-left:auto;color:#0f172a;font-size:11px}.dot{width:7px;height:7px;border-radius:50%}.dot.completed{background:#10b981}.dot.partial{background:#f59e0b}.dot.missed{background:#ef4444}.ops-action-panel{display:grid;align-content:start;gap:10px;background:linear-gradient(135deg,#fff,#f8fafc)}.ops-action-list{display:grid;gap:7px;margin:0;padding:0;list-style:none;counter-reset:action}.ops-action-list li{position:relative;padding:9px 10px 9px 35px;border:1px solid #e8edf2;border-radius:10px;background:#fff;color:#475569;font-size:9px;line-height:1.45;counter-increment:action}.ops-action-list li:before{content:counter(action);position:absolute;left:9px;top:8px;display:grid;place-items:center;width:18px;height:18px;border-radius:6px;background:#ecfdf5;color:#047857;font-size:8px;font-weight:950}.ops-table-wrap{margin-top:13px;overflow:auto;border:1px solid #e2e8f0;border-radius:13px}.ops-table{width:100%;min-width:1120px;border-collapse:collapse;font-size:8.5px}.ops-table th,.ops-table td{padding:10px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}.ops-table th{position:sticky;top:0;background:#f8fafc;color:#64748b;font-size:7px;text-transform:uppercase;letter-spacing:.045em;z-index:1}.ops-table td{color:#475569}.ops-table td>strong,.ops-table td>small{display:block}.ops-table td>strong{color:#172033}.ops-table td>small{margin-top:3px;color:#8492a6;font-size:7.2px;line-height:1.4}.ops-table td.attention{color:#b45309;font-weight:900}.ops-table td.recommendation{min-width:300px}.ops-table td.recommendation p{margin:4px 0 0;color:#64748b;font-size:8px;line-height:1.45}.ops-priority,.ops-assessment,.ops-status-badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 8px;font-size:7px;font-weight:950;white-space:nowrap}.ops-priority.critical{background:#fee2e2;color:#b91c1c}.ops-priority.high{background:#ffedd5;color:#c2410c}.ops-priority.monitor{background:#dbeafe;color:#1d4ed8}.ops-priority.stable{background:#dcfce7;color:#166534}.ops-assessment.good,.ops-assessment.normal,.ops-assessment.performing{background:#dcfce7;color:#166534}.ops-assessment.monitor,.ops-assessment.scheduled{background:#dbeafe;color:#1d4ed8}.ops-assessment.review,.ops-assessment.capacity-review,.ops-assessment.needs-follow-up{background:#ffedd5;color:#c2410c}.ops-assessment.no-collection-in-selected-period{background:#f1f5f9;color:#64748b}.ops-status-badge.open{background:#fee2e2;color:#b91c1c}.ops-status-badge.resolved{background:#dcfce7;color:#166534}.ops-driver-state{display:inline-flex;align-items:center;border-radius:999px;padding:5px 8px;font-size:7px;font-weight:950;white-space:nowrap;background:#f1f5f9;color:#64748b}.ops-driver-state.tracking{background:#dcfce7;color:#166534;box-shadow:inset 0 0 0 1px #bbf7d0}.ops-driver-state.online,.ops-driver-state.active{background:#dbeafe;color:#1d4ed8}.ops-driver-state.offline{background:#f1f5f9;color:#64748b}.ops-no-data{text-align:center!important;padding:25px!important;color:#94a3b8!important}.ops-capacity-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:13px}.ops-capacity-tile{border:1px solid #e2e8f0;border-radius:13px;padding:12px;background:#f8fafc}.ops-capacity-tile.alert{border-color:#fed7aa;background:#fff7ed}.ops-capacity-tile>div:first-child{display:flex;align-items:center;justify-content:space-between}.ops-capacity-tile span{font-size:8px;color:#64748b;font-weight:850}.ops-capacity-tile strong{font-size:17px}.ops-capacity-bar{height:6px;background:#e2e8f0;border-radius:999px;margin-top:9px;overflow:hidden}.ops-capacity-bar>div{height:100%;background:#0ea5e9;border-radius:inherit}.ops-capacity-tile.alert .ops-capacity-bar>div{background:#f97316}.ops-gap-top{margin-top:12px}.ops-gps-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:13px}.ops-gps-card{overflow:hidden;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.ops-gps-svg{display:block;width:100%;height:auto;border-bottom:1px solid #edf2f7}.ops-gps-card-body{display:grid;gap:8px;padding:11px}.ops-gps-card-body>div:first-child{display:grid;gap:2px}.ops-gps-card-body strong{font-size:10px}.ops-gps-card-body span{font-size:8px;color:#64748b}.ops-gps-meta,.ops-gps-stats{display:flex;flex-wrap:wrap;gap:5px}.ops-gps-meta span,.ops-gps-stats span{display:inline-flex;padding:5px 7px;border-radius:999px;background:#f1f5f9;font-size:7px}.ops-gps-stats span{background:#ecfdf5;color:#047857;font-weight:850}.ops-gps-empty,.ops-gps-no-data{min-height:170px;display:grid;place-items:center}.ops-section-note{margin-top:9px;color:#64748b;font-size:8px}.ops-report-footer{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:30px;align-items:end;padding:18px 4px 5px;border-top:1px solid #e2e8f0}.ops-report-footer>div{display:grid;gap:4px}.ops-report-footer strong{font-size:10px}.ops-report-footer span{font-size:8px;color:#64748b}.signature-line{display:block!important;height:20px;border-bottom:1px solid #64748b}.ops-kpi{position:relative;overflow:hidden;display:grid;gap:5px;padding:13px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc}.ops-kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#94a3b8}.ops-kpi.good:before{background:#10b981}.ops-kpi.warn:before{background:#f59e0b}.ops-kpi span{font-size:7.5px;font-weight:950;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.ops-kpi strong{font-size:20px;letter-spacing:-.035em;color:#0f172a}.ops-kpi small{color:#7c8a9c;font-size:7.5px}.ops-section-title+.ops-table-wrap{margin-top:13px}
        /* Readability & professional UI overrides */
        .ops-report-shell{gap:20px;font-size:14px;line-height:1.5}
        .ops-hero{padding:30px;border-radius:22px}
        .ops-kicker{font-size:11px;letter-spacing:.08em}
        .ops-hero h2{font-size:32px;line-height:1.15;margin:10px 0 9px}
        .ops-hero p{font-size:14px;line-height:1.7;color:#475569}
        .ops-source-chips span,.ops-count-chip{font-size:11px;padding:7px 11px}
        .ops-hero-actions{min-width:240px}
        .ops-hero-actions button{height:46px;font-size:14px}
        .ops-config-card{padding:20px}
        .ops-config-heading span{font-size:10px}
        .ops-config-heading strong{font-size:18px}
        .ops-updated{font-size:11px}
        .ops-report-types{gap:10px;margin-top:16px}
        .ops-report-types button{min-height:92px;padding:13px}
        .ops-report-types button strong{font-size:12px;line-height:1.35}
        .ops-report-types button span{font-size:11px;line-height:1.5;color:#64748b}
        .ops-filter-grid{gap:12px;margin-top:15px;padding-top:15px}
        .ops-filter-grid label>span{font-size:10px}
        .ops-filter-grid select,.ops-filter-grid input{height:42px;font-size:12px;padding:0 12px}
        .ops-empty-state h3{font-size:18px}
        .ops-empty-state p{font-size:12px}
        .ops-output{gap:16px;padding:20px}
        .ops-output-head h3{font-size:26px}
        .ops-output-head p{font-size:12px}
        .ops-report-meta{font-size:10px}
        .ops-report-meta strong{font-size:12px}
        .ops-basis-note{padding:15px 16px}
        .ops-basis-note strong{font-size:12px}
        .ops-basis-note p{font-size:12px;line-height:1.6}
        .ops-kpi-grid{gap:12px}
        .ops-kpi{padding:15px}
        .ops-kpi span{font-size:10px}
        .ops-kpi strong{font-size:22px}
        .ops-kpi small{font-size:11px;line-height:1.45}
        .ops-panel{padding:18px}
        .ops-section-title{gap:4px}
        .ops-section-title span{font-size:10px}
        .ops-section-title h4{font-size:18px;line-height:1.3}
        .ops-section-title p{font-size:12px;line-height:1.55}
        .ops-tabs button{height:32px;font-size:11px}
        .ops-progress-row{grid-template-columns:150px 1fr 52px;gap:10px}
        .ops-progress-row>span,.ops-progress-row>strong{font-size:11px}
        .ops-status-split>div{font-size:10.5px;padding:10px}
        .ops-status-split strong{font-size:12px}
        .ops-action-list li{font-size:11.5px;line-height:1.55;padding:10px 12px 10px 38px}
        .ops-action-list li:before{width:20px;height:20px;font-size:9px}
        .ops-table-wrap{margin-top:15px;border-radius:14px}
        .ops-table{font-size:12px;line-height:1.45}
        .ops-table th,.ops-table td{padding:11px 10px}
        .ops-table th{font-size:10.5px;line-height:1.35;letter-spacing:.035em}
        .ops-table td{font-size:12px;color:#334155}
        .ops-table td>small{font-size:10.5px;line-height:1.45}
        .ops-table td.recommendation{min-width:330px}
        .ops-table td.recommendation p{font-size:11px;line-height:1.55}
        .ops-priority,.ops-assessment,.ops-status-badge,.ops-driver-state{font-size:10px;padding:5px 9px}
        .ops-capacity-tile{padding:14px}
        .ops-capacity-tile span{font-size:11px}
        .ops-capacity-tile strong{font-size:19px}
        .ops-gps-card-body strong{font-size:12px}
        .ops-gps-card-body span{font-size:10.5px}
        .ops-gps-meta span,.ops-gps-stats span{font-size:10px}
        .ops-section-note{font-size:11px}
        .ops-report-footer strong{font-size:12px}
        .ops-report-footer span{font-size:10.5px}


        /* =========================================================
           FINAL PROFESSIONAL UI — 14PX MINIMUM READABILITY
           Keeps the existing Firebase/report logic unchanged.
           ========================================================= */
        .ops-report-shell{
          gap:16px;
          font-size:14px;
          line-height:1.55;
          color:#17251e;
        }

        .ops-hero{
          min-height:auto;
          padding:20px 22px;
          border:1px solid #dbe7e0;
          border-left:4px solid #168a4a;
          border-radius:18px;
          background:
            linear-gradient(135deg,#ffffff 0%,#fbfdfc 72%,#f2faf5 100%);
          box-shadow:0 8px 24px rgba(17,54,36,.055);
        }

        .ops-hero:after{
          display:none;
        }

        .ops-hero-copy{
          max-width:900px;
        }

        .ops-kicker{
          gap:8px;
          color:#168a4a;
          font-size:14px;
          line-height:1.35;
          font-weight:900;
          letter-spacing:.045em;
        }

        .ops-live-dot{
          width:9px;
          height:9px;
          box-shadow:0 0 0 4px rgba(22,138,74,.10);
        }

        .ops-hero h2{
          margin:7px 0 6px;
          color:#12251b;
          font-size:26px;
          line-height:1.18;
          letter-spacing:-.03em;
        }

        .ops-hero p{
          max-width:900px;
          margin:0;
          color:#52655b;
          font-size:14px;
          line-height:1.65;
        }

        .ops-source-chips{
          gap:8px;
          margin-top:12px;
        }

        .ops-source-chips span,
        .ops-count-chip{
          min-height:34px;
          padding:7px 11px;
          border:1px solid #d8e7df;
          background:#ffffff;
          color:#496157;
          font-size:14px;
          line-height:1.25;
          font-weight:750;
        }

        .ops-hero-actions{
          min-width:238px;
          gap:9px;
        }

        .ops-hero-actions button{
          height:44px;
          border-radius:11px;
          padding:0 16px;
          font-size:14px;
          font-weight:850;
          transition:transform .15s ease,box-shadow .15s ease,background .15s ease;
        }

        .ops-primary{
          background:#168a4a;
          color:#ffffff;
          box-shadow:0 7px 16px rgba(22,138,74,.16);
        }

        .ops-primary:hover{
          transform:translateY(-1px);
          background:#117a42;
          box-shadow:0 10px 20px rgba(22,138,74,.20);
        }

        .ops-secondary{
          background:#183127;
          color:#ffffff;
          box-shadow:0 6px 14px rgba(20,41,32,.10);
        }

        .ops-secondary:not(:disabled):hover{
          transform:translateY(-1px);
          background:#10261d;
        }

        .ops-config-card,
        .ops-panel,
        .ops-output{
          border:1px solid #dfe7e2;
          border-radius:18px;
          background:#ffffff;
          box-shadow:0 8px 24px rgba(16,35,27,.045);
        }

        .ops-config-card{
          padding:20px;
        }

        .ops-config-heading{
          align-items:center;
        }

        .ops-config-heading>div:first-child{
          gap:4px;
        }

        .ops-config-heading span{
          color:#168a4a;
          font-size:14px;
          line-height:1.3;
          font-weight:900;
          letter-spacing:.045em;
        }

        .ops-config-heading strong{
          color:#15271e;
          font-size:21px;
          line-height:1.3;
          letter-spacing:-.02em;
        }

        .ops-updated{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:8px 11px;
          border:1px solid #e1e9e4;
          border-radius:999px;
          background:#f8fbf9;
          color:#65766d;
          font-size:14px;
          line-height:1.3;
          white-space:nowrap;
        }

        .ops-updated b{
          color:#263c31;
          font-size:14px;
        }

        .ops-report-types{
          grid-template-columns:repeat(7,minmax(150px,1fr));
          gap:9px;
          margin-top:16px;
          overflow-x:auto;
          padding-bottom:2px;
        }

        .ops-report-types button{
          min-height:104px;
          gap:7px;
          padding:13px 14px;
          border:1px solid #dfe7e2;
          border-radius:14px;
          background:#fbfcfb;
          transition:border-color .15s ease,background .15s ease,transform .15s ease,box-shadow .15s ease;
        }

        .ops-report-types button:hover{
          transform:translateY(-1px);
          border-color:#bfd7c8;
          background:#ffffff;
          box-shadow:0 6px 14px rgba(16,35,27,.05);
        }

        .ops-report-types button strong{
          color:#31473c;
          font-size:14px;
          line-height:1.35;
        }

        .ops-report-types button span{
          color:#6a7c72;
          font-size:14px;
          line-height:1.45;
        }

        .ops-report-types button.active{
          border-color:#4fc783;
          background:#eefbf3;
          box-shadow:inset 0 0 0 1px rgba(45,184,103,.30);
        }

        .ops-report-types button.active strong{
          color:#137b43;
        }

        .ops-filter-grid{
          grid-template-columns:repeat(5,minmax(170px,1fr));
          gap:12px;
          margin-top:16px;
          padding-top:16px;
          border-top:1px solid #e9efeb;
        }

        .ops-filter-grid label{
          gap:7px;
        }

        .ops-filter-grid label>span{
          color:#53665c;
          font-size:14px;
          line-height:1.3;
          font-weight:850;
          letter-spacing:.02em;
        }

        .ops-filter-grid select,
        .ops-filter-grid input{
          height:44px;
          border:1px solid #d4dfd8;
          border-radius:11px;
          padding:0 12px;
          background:#ffffff;
          color:#17261e;
          font-size:14px;
        }

        .ops-filter-grid select:focus,
        .ops-filter-grid input:focus{
          border-color:#4dbd7d;
          box-shadow:0 0 0 3px rgba(22,138,74,.10);
        }

        .ops-empty-state{
          min-height:190px;
          padding:32px 24px;
          border:1px dashed #cbd9d1;
          border-radius:18px;
          background:#fbfcfb;
        }

        .ops-empty-icon{
          width:44px;
          height:44px;
          border-radius:12px;
          background:#168a4a;
          font-size:19px;
          box-shadow:0 7px 16px rgba(22,138,74,.15);
        }

        .ops-empty-state h3{
          margin:11px 0 4px;
          color:#15271e;
          font-size:20px;
          line-height:1.3;
        }

        .ops-empty-state p{
          max-width:650px;
          color:#62746a;
          font-size:14px;
          line-height:1.55;
        }

        .ops-output{
          gap:16px;
          padding:20px;
        }

        .ops-output-head{
          padding:3px 2px 14px;
        }

        .ops-output-head h3{
          margin:5px 0 4px;
          color:#15271e;
          font-size:25px;
          line-height:1.25;
        }

        .ops-output-head p{
          color:#607269;
          font-size:14px;
          line-height:1.45;
        }

        .ops-report-meta{
          gap:2px;
          color:#677970;
          font-size:14px;
        }

        .ops-report-meta strong{
          color:#243a2f;
          font-size:14px;
        }

        .ops-basis-note{
          gap:12px;
          padding:15px 16px;
          border:1px solid #bfd6ef;
          border-radius:14px;
          background:#f3f8fe;
        }

        .ops-basis-icon{
          width:30px;
          height:30px;
          border-radius:9px;
          font-size:14px;
        }

        .ops-basis-note strong{
          color:#244d85;
          font-size:14px;
        }

        .ops-basis-note p{
          margin:4px 0 0;
          color:#4e6075;
          font-size:14px;
          line-height:1.6;
        }

        .ops-kpi-grid{
          grid-template-columns:repeat(4,minmax(190px,1fr));
          gap:12px;
        }

        .ops-kpi{
          min-height:110px;
          gap:6px;
          padding:15px 16px;
          border:1px solid #dfe7e2;
          border-radius:14px;
          background:#fbfcfb;
          transition:transform .15s ease,box-shadow .15s ease;
        }

        .ops-kpi:hover{
          transform:translateY(-1px);
          box-shadow:0 8px 18px rgba(16,35,27,.06);
        }

        .ops-kpi span{
          color:#586b61;
          font-size:14px;
          line-height:1.3;
          font-weight:850;
          letter-spacing:.025em;
        }

        .ops-kpi strong{
          color:#13241b;
          font-size:28px;
          line-height:1.05;
          letter-spacing:-.03em;
        }

        .ops-kpi small{
          color:#6b7c73;
          font-size:14px;
          line-height:1.4;
        }

        .ops-health-grid{
          grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);
          gap:12px;
        }

        .ops-panel{
          padding:18px;
        }

        .ops-section-title{
          gap:5px;
        }

        .ops-section-title span{
          color:#168a4a;
          font-size:14px;
          line-height:1.3;
          font-weight:900;
          letter-spacing:.035em;
        }

        .ops-section-title h4{
          color:#17281f;
          font-size:20px;
          line-height:1.3;
          letter-spacing:-.02em;
        }

        .ops-section-title p{
          color:#63756b;
          font-size:14px;
          line-height:1.55;
        }

        .ops-section-row{
          gap:16px;
        }

        .ops-tabs{
          gap:4px;
          padding:4px;
          border-radius:10px;
          background:#f1f5f2;
        }

        .ops-tabs button{
          height:36px;
          padding:0 12px;
          font-size:14px;
        }

        .ops-progress-row{
          grid-template-columns:190px 1fr 62px;
          gap:11px;
        }

        .ops-progress-row>span,
        .ops-progress-row>strong{
          color:#475c50;
          font-size:14px;
        }

        .ops-progress-track{
          height:9px;
        }

        .ops-status-split{
          gap:8px;
        }

        .ops-status-split>div{
          padding:10px 11px;
          color:#5b6f64;
          font-size:14px;
        }

        .ops-status-split strong{
          color:#15271e;
          font-size:14px;
        }

        .ops-action-list{
          gap:8px;
        }

        .ops-action-list li{
          padding:11px 12px 11px 42px;
          color:#43594d;
          font-size:14px;
          line-height:1.55;
        }

        .ops-action-list li:before{
          left:10px;
          top:10px;
          width:22px;
          height:22px;
          font-size:14px;
        }

        .ops-table-wrap{
          margin-top:15px;
          border:1px solid #dfe7e2;
          border-radius:14px;
        }

        .ops-table{
          min-width:1400px;
          font-size:14px;
          line-height:1.45;
        }

        .ops-table th,
        .ops-table td{
          padding:12px 11px;
          font-size:14px;
          line-height:1.45;
        }

        .ops-table th{
          color:#53685d;
          background:#f6f9f7;
          font-size:14px;
          line-height:1.35;
          letter-spacing:.02em;
        }

        .ops-table td{
          color:#33483d;
        }

        .ops-table td>strong{
          color:#182b21;
          font-size:14px;
        }

        .ops-table td>small{
          margin-top:4px;
          color:#728279;
          font-size:14px;
          line-height:1.45;
        }

        .ops-table td.recommendation{
          min-width:360px;
        }

        .ops-table td.recommendation p{
          margin:5px 0 0;
          color:#687970;
          font-size:14px;
          line-height:1.55;
        }

        .ops-priority,
        .ops-assessment,
        .ops-status-badge,
        .ops-driver-state{
          min-height:32px;
          padding:6px 10px;
          font-size:14px;
          line-height:1.2;
        }

        .ops-capacity-grid{
          grid-template-columns:repeat(4,minmax(170px,1fr));
          gap:10px;
          margin-top:14px;
        }

        .ops-capacity-tile{
          padding:14px;
          border-radius:13px;
        }

        .ops-capacity-tile span{
          color:#5c6f65;
          font-size:14px;
        }

        .ops-capacity-tile strong{
          color:#15271e;
          font-size:24px;
        }

        .ops-gps-grid{
          grid-template-columns:repeat(3,minmax(280px,1fr));
          gap:12px;
          margin-top:14px;
        }

        .ops-gps-card-body{
          gap:9px;
          padding:13px;
        }

        .ops-gps-card-body strong{
          color:#17291f;
          font-size:14px;
        }

        .ops-gps-card-body span{
          color:#64766c;
          font-size:14px;
        }

        .ops-gps-meta span,
        .ops-gps-stats span{
          padding:6px 8px;
          font-size:14px;
        }

        .ops-section-note{
          margin-top:10px;
          color:#687a70;
          font-size:14px;
        }

        .ops-report-footer{
          gap:28px;
          padding:18px 4px 4px;
        }

        .ops-report-footer strong,
        .ops-report-footer span{
          font-size:14px;
          line-height:1.4;
        }

        /* Subtle motion only — no distracting animation. */
        .ops-hero,
        .ops-config-card,
        .ops-empty-state,
        .ops-output{
          animation:opsFadeUp .34s ease both;
        }

        .ops-config-card{animation-delay:.04s}
        .ops-empty-state,.ops-output{animation-delay:.08s}

        @keyframes opsFadeUp{
          from{opacity:0;transform:translateY(6px)}
          to{opacity:1;transform:translateY(0)}
        }

        @media(prefers-reduced-motion:reduce){
          .ops-hero,
          .ops-config-card,
          .ops-empty-state,
          .ops-output{
            animation:none!important;
          }
          .ops-primary:hover,
          .ops-secondary:not(:disabled):hover,
          .ops-report-types button:hover,
          .ops-kpi:hover{
            transform:none!important;
          }
        }


        @media(max-width:1250px){.ops-report-types{grid-template-columns:repeat(4,1fr)}.ops-filter-grid{grid-template-columns:repeat(3,1fr)}.ops-gps-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:900px){.ops-hero{align-items:stretch;flex-direction:column}.ops-hero-actions{flex-direction:row}.ops-hero-actions button{flex:1}.ops-kpi-grid{grid-template-columns:repeat(2,1fr)}.ops-health-grid{grid-template-columns:1fr}.ops-report-types{grid-template-columns:repeat(2,1fr)}.ops-filter-grid{grid-template-columns:repeat(2,1fr)}.ops-gps-grid{grid-template-columns:1fr}.ops-report-footer{grid-template-columns:1fr}.ops-section-row,.ops-config-heading{align-items:stretch;flex-direction:column}.ops-updated{align-self:flex-start}}
        @media(max-width:560px){.ops-hero{padding:19px}.ops-hero h2{font-size:24px}.ops-hero-actions{flex-direction:column}.ops-report-types,.ops-filter-grid,.ops-kpi-grid,.ops-capacity-grid{grid-template-columns:1fr}.ops-output{padding:12px}.ops-output-head{align-items:flex-start;flex-direction:column}.ops-report-meta{justify-items:start}.ops-progress-row{grid-template-columns:105px 1fr 38px}.ops-status-split{grid-template-columns:1fr}}

        /* =========================================================
           APPROVED MOCKUP MATCH — FINAL VISUAL OVERRIDES
           ========================================================= */
        .ops-report-shell{
          gap:16px;
          color:#10213a;
          font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }

        .ops-hero{
          min-height:164px;
          padding:20px 24px;
          border:1px solid #e0e7e3;
          border-left:4px solid #159447;
          border-radius:16px;
          background:#ffffff;
          box-shadow:0 6px 18px rgba(19,45,32,.045);
        }

        .ops-hero-copy{max-width:760px}
        .ops-kicker{font-size:12px;color:#0c8c43;letter-spacing:.04em}
        .ops-live-dot{width:8px;height:8px;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.10)}
        .ops-hero h2{margin:8px 0 5px;font-size:25px;line-height:1.15;color:#10213a}
        .ops-hero p{max-width:760px;font-size:14px;line-height:1.55;color:#53647b}

        .ops-source-chips{
          margin-top:12px;
          gap:7px;
        }
        .ops-source-chips span{
          min-height:32px;
          display:inline-flex;
          align-items:center;
          gap:7px;
          padding:6px 11px;
          border:1px solid #dce6e0;
          border-radius:999px;
          background:#fff;
          color:#20334b;
          font-size:12px;
          font-weight:750;
        }
        .ops-source-chips svg{
          width:16px;
          height:16px;
          fill:#14924a;
        }

        .ops-hero-actions{
          min-width:292px;
          gap:9px;
        }
        .ops-hero-actions button{
          height:44px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:9px;
          border-radius:9px;
          font-size:14px;
        }
        .ops-hero-actions button svg{
          width:18px;
          height:18px;
          fill:currentColor;
        }
        .ops-primary{
          background:linear-gradient(135deg,#119c4b,#0b873f);
          box-shadow:0 6px 14px rgba(17,156,75,.14);
        }
        .ops-secondary{
          border:1px solid #dce4e0;
          background:#fff;
          color:#10213a;
          box-shadow:none;
        }
        .ops-secondary:disabled{
          background:#f8faf9;
          color:#9aa7a1;
          opacity:1;
        }
        .ops-secondary:not(:disabled):hover{
          background:#f5f9f6;
          color:#10213a;
        }

        .ops-config-card{
          padding:17px 20px 16px;
          border-radius:16px;
          box-shadow:0 6px 18px rgba(19,45,32,.04);
        }
        .ops-config-heading{align-items:center}
        .ops-config-heading span{font-size:11px;color:#0d8d43}
        .ops-config-heading strong{font-size:18px;color:#10213a}
        .ops-updated{
          padding:7px 10px;
          border:0;
          background:#f6f8f7;
          font-size:11px;
          color:#6e7a75;
        }
        .ops-updated b{font-size:12px;color:#26394f}

        .ops-report-types{
          grid-template-columns:repeat(7,minmax(0,1fr));
          gap:9px;
          margin-top:14px;
          overflow:visible;
        }
        .ops-report-types button{
          position:relative;
          min-height:92px;
          display:grid;
          grid-template-columns:38px minmax(0,1fr);
          align-items:start;
          gap:10px;
          padding:13px 12px;
          border:1px solid #dfe6e2;
          border-radius:10px;
          background:#fff;
          box-shadow:none;
        }
        .ops-report-types button:hover{
          transform:none;
          border-color:#bad7c6;
          box-shadow:0 4px 12px rgba(16,35,27,.045);
        }
        .ops-report-types button.active{
          border-color:#2dbd69;
          background:#f4fcf7;
          box-shadow:inset 0 0 0 1px rgba(45,189,105,.12);
        }
        .ops-report-types button.active::after{
          content:"✓";
          position:absolute;
          top:9px;
          right:9px;
          width:20px;
          height:20px;
          display:grid;
          place-items:center;
          border-radius:50%;
          background:#159447;
          color:#fff;
          font-size:11px;
          font-weight:900;
        }
        .ops-type-icon{
          width:36px;
          height:36px;
          display:grid;
          place-items:center;
          border-radius:9px;
          background:#eef8f1;
          color:#168a4a;
        }
        .ops-type-icon.collection,
        .ops-type-icon.schedule,
        .ops-type-icon.gps{background:#f2edff;color:#7058e8}
        .ops-type-icon.drivers{background:#ebf3ff;color:#3b82f6}
        .ops-type-icon.capacity{background:#fff0e8;color:#f97316}
        .ops-type-icon.issues{background:#fff7e6;color:#f59e0b}
        .ops-type-icon svg{width:21px;height:21px;fill:currentColor}
        .ops-type-copy{display:grid;gap:5px;min-width:0;padding-top:1px}
        .ops-type-copy>strong{font-size:12px!important;color:#203047!important}
        .ops-type-copy>span{font-size:11px!important;line-height:1.45!important;color:#65748a!important}
        .ops-report-types button.active .ops-type-copy>strong{color:#175a36!important}

        .ops-filter-grid{
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:12px;
          margin-top:14px;
          padding-top:14px;
        }
        .ops-filter-grid label>span{
          margin-bottom:1px;
          color:#526176;
          font-size:11px;
          text-transform:uppercase;
          letter-spacing:.035em;
        }
        .ops-filter-grid select,
        .ops-filter-grid input{
          height:40px;
          border:1px solid #d9e2dd;
          border-radius:8px;
          color:#243349;
          font-size:12px;
        }

        .ops-output{
          gap:12px;
          padding:18px 20px;
          border-radius:16px;
          box-shadow:0 6px 18px rgba(19,45,32,.04);
        }
        .ops-output-head{padding:1px 2px 12px}
        .ops-output-head .ops-kicker{font-size:11px}
        .ops-output-head h3{font-size:22px;color:#10213a}
        .ops-output-head p{font-size:12px;color:#627087}
        .ops-report-meta{font-size:10px}
        .ops-report-meta strong{font-size:12px;color:#203047}

        .ops-basis-note{
          padding:12px 14px;
          border:1px solid #c7dcf8;
          border-radius:10px;
          background:#f4f8fe;
        }
        .ops-basis-icon{
          width:27px;
          height:27px;
          border-radius:7px;
          background:#2d6cdf;
        }
        .ops-basis-note strong{font-size:11px;color:#245597}
        .ops-basis-note p{font-size:11px;line-height:1.55;color:#51627a}

        .ops-kpi-grid{
          grid-template-columns:repeat(7,minmax(0,1fr));
          gap:0;
          overflow:hidden;
          border:1px solid #e1e7e4;
          border-radius:10px;
          background:#fff;
        }
        .ops-kpi{
          min-height:76px;
          display:grid;
          grid-template-columns:30px minmax(0,1fr);
          align-items:center;
          gap:9px;
          padding:10px 12px;
          border:0;
          border-right:1px solid #edf1ef;
          border-radius:0;
          background:#fff;
          box-shadow:none;
        }
        .ops-kpi:last-child{border-right:0}
        .ops-kpi:before{display:none}
        .ops-kpi:hover{transform:none;box-shadow:none;background:#fcfdfc}
        .ops-kpi-icon{
          width:30px;
          height:30px;
          display:grid;
          place-items:center;
          border-radius:8px;
          background:#eaf8ef;
          color:#159447;
        }
        .ops-kpi-icon.amber{background:#fff5e8;color:#f59e0b}
        .ops-kpi-icon.purple{background:#f3edff;color:#7758e8}
        .ops-kpi-icon.blue{background:#ebf4ff;color:#3b82f6}
        .ops-kpi-icon.violet{background:#f3edff;color:#6d4de6}
        .ops-kpi-icon svg{width:17px;height:17px;fill:currentColor}
        .ops-kpi-copy{display:grid;gap:1px;min-width:0}
        .ops-kpi span{
          color:#5c6b7f;
          font-size:10px;
          line-height:1.25;
          font-weight:750;
          text-transform:none;
          letter-spacing:0;
        }
        .ops-kpi strong{
          color:#10213a;
          font-size:16px;
          line-height:1.15;
        }
        .ops-kpi small{
          color:#77859a;
          font-size:9px;
          line-height:1.35;
        }

        .ops-health-grid{
          grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);
          gap:12px;
        }
        .ops-panel{
          padding:14px 16px;
          border-radius:12px;
          box-shadow:none;
        }
        .ops-section-title span{font-size:10px;color:#637289}
        .ops-section-title h4{font-size:14px;color:#10213a}
        .ops-section-title p{font-size:10px;color:#6b788c}

        .ops-health-panel{gap:10px}
        .ops-health-content{
          display:grid;
          grid-template-columns:minmax(0,1fr) 150px minmax(150px,.82fr);
          align-items:center;
          gap:16px;
          margin-top:4px;
        }
        .ops-health-metrics{display:grid;gap:10px}
        .ops-progress-row{
          grid-template-columns:1fr auto;
          gap:12px;
        }
        .ops-progress-row>span{
          color:#536176;
          font-size:11px;
        }
        .ops-progress-row>strong{
          color:#159447;
          font-size:12px;
          font-weight:900;
        }
        .ops-progress-track{display:none}
        .ops-health-donut{
          width:112px;
          height:112px;
          justify-self:center;
          display:grid;
          place-items:center;
          border-radius:50%;
          box-shadow:inset 0 0 0 1px rgba(20,148,71,.05);
        }
        .ops-health-donut-center{
          width:72px;
          height:72px;
          display:grid;
          place-items:center;
          align-content:center;
          border-radius:50%;
          background:#fff;
          box-shadow:0 0 0 1px #e7ece9;
        }
        .ops-health-donut-center strong{font-size:16px;color:#138944}
        .ops-health-donut-center span{font-size:9px;color:#7c897f}
        .ops-status-split{
          display:grid;
          grid-template-columns:1fr;
          gap:6px;
          margin:0;
        }
        .ops-status-split>div{
          min-height:31px;
          padding:7px 9px;
          border-radius:7px;
          font-size:10px;
        }
        .ops-status-split strong{font-size:11px}

        .ops-action-panel{gap:7px;background:#fff}
        .ops-action-list{gap:5px}
        .ops-action-list li{
          min-height:31px;
          padding:7px 10px 7px 34px;
          border-radius:7px;
          color:#46576e;
          font-size:10px;
          line-height:1.4;
        }
        .ops-action-list li:before{
          left:8px;
          top:6px;
          width:19px;
          height:19px;
          border-radius:6px;
          font-size:9px;
        }


        /* HARD ICON SIZE SAFETY
           Icon components render child SVGs. Styled-JSX needs svg
           so project-wide SVG rules cannot expand them. */
        .ops-source-chips svg{
          width:16px!important;
          height:16px!important;
          min-width:16px!important;
          max-width:16px!important;
          min-height:16px!important;
          max-height:16px!important;
          flex:0 0 16px!important;
          display:block!important;
          fill:currentColor!important;
        }

        .ops-hero-actions button svg{
          width:18px!important;
          height:18px!important;
          min-width:18px!important;
          max-width:18px!important;
          min-height:18px!important;
          max-height:18px!important;
          flex:0 0 18px!important;
          display:block!important;
          fill:currentColor!important;
        }

        .ops-type-icon svg{
          width:21px!important;
          height:21px!important;
          min-width:21px!important;
          max-width:21px!important;
          min-height:21px!important;
          max-height:21px!important;
          display:block!important;
          fill:currentColor!important;
        }

        .ops-kpi-icon svg{
          width:17px!important;
          height:17px!important;
          min-width:17px!important;
          max-width:17px!important;
          min-height:17px!important;
          max-height:17px!important;
          display:block!important;
          fill:currentColor!important;
        }


        /* FINAL CHILD-COMPONENT STYLE SAFETY */
        .ops-kpi,
        .ops-kpi *,
        .ops-progress-row,
        .ops-progress-row *,
        .ops-capacity-tile,
        .ops-capacity-tile *,
        .ops-gps-card,
        .ops-gps-card *{
          box-sizing:border-box;
        }

        .ops-kpi-icon{
          width:30px!important;
          height:30px!important;
          min-width:30px!important;
          max-width:30px!important;
          min-height:30px!important;
          max-height:30px!important;
          flex:0 0 30px!important;
          overflow:hidden!important;
        }

        .ops-kpi-icon svg{
          width:17px!important;
          height:17px!important;
          min-width:17px!important;
          max-width:17px!important;
          min-height:17px!important;
          max-height:17px!important;
          display:block!important;
          fill:currentColor!important;
        }

        .ops-kpi{
          min-width:0!important;
          overflow:hidden!important;
        }

        .ops-kpi-copy{
          min-width:0!important;
          overflow:hidden!important;
        }

        .ops-kpi-copy span,
        .ops-kpi-copy strong,
        .ops-kpi-copy small{
          max-width:100%!important;
          overflow:hidden!important;
          text-overflow:ellipsis!important;
        }

        .ops-source-chips svg{
          width:16px!important;
          height:16px!important;
          min-width:16px!important;
          max-width:16px!important;
          min-height:16px!important;
          max-height:16px!important;
          flex:0 0 16px!important;
        }

        .ops-hero-actions button svg{
          width:18px!important;
          height:18px!important;
          min-width:18px!important;
          max-width:18px!important;
          min-height:18px!important;
          max-height:18px!important;
          flex:0 0 18px!important;
        }

        .ops-type-icon svg{
          width:21px!important;
          height:21px!important;
          min-width:21px!important;
          max-width:21px!important;
          min-height:21px!important;
          max-height:21px!important;
        }


        .ops-secondary{
          min-height:44px!important;
          border:1px solid #dce4e0!important;
          border-radius:9px!important;
          background:#ffffff!important;
          color:#10213a!important;
          opacity:1!important;
        }
        .ops-secondary:disabled{
          border-color:#e5ebe7!important;
          background:#f8faf9!important;
          color:#9aa7a1!important;
          opacity:1!important;
          cursor:not-allowed!important;
        }

        @media(max-width:1250px){
          .ops-report-types{grid-template-columns:repeat(4,1fr)}
          .ops-kpi-grid{grid-template-columns:repeat(4,1fr)}
          .ops-kpi:nth-child(4){border-right:0}
          .ops-health-content{grid-template-columns:1fr 130px}
          .ops-status-split{grid-column:1/-1;grid-template-columns:repeat(3,1fr)}
        }
        @media(max-width:900px){
          .ops-report-types{grid-template-columns:repeat(2,1fr)}
          .ops-filter-grid{grid-template-columns:repeat(2,1fr)}
          .ops-kpi-grid{grid-template-columns:repeat(2,1fr)}
          .ops-kpi:nth-child(even){border-right:0}
          .ops-health-content{grid-template-columns:1fr}
          .ops-health-donut{justify-self:start}
          .ops-status-split{grid-template-columns:1fr}
        }
        @media(max-width:560px){
          .ops-report-types,.ops-filter-grid,.ops-kpi-grid{grid-template-columns:1fr}
          .ops-kpi{border-right:0;border-bottom:1px solid #edf1ef}
          .ops-kpi:last-child{border-bottom:0}
        }

        /* =========================================================
           AGENCY REPORT — PROFESSIONAL LGU / OLDER-USER POLISH
           Presentation only. Firebase/data/report calculations unchanged.
           ========================================================= */
        .ops-report-shell{
          --agency-green:#087a4b;
          --agency-green-dark:#055c39;
          --agency-green-soft:#edf8f2;
          --agency-ink:#14251d;
          --agency-muted:#5f7168;
          --agency-line:#dce7e1;
          --agency-surface:#ffffff;
          --agency-bg:#f7faf8;
          gap:18px;
          color:var(--agency-ink);
        }
        .ops-hero{
          min-height:176px;
          padding:24px 26px;
          border:1px solid var(--agency-line);
          border-left:5px solid var(--agency-green);
          border-radius:18px;
          background:
            linear-gradient(110deg,#ffffff 0%,#ffffff 58%,#f1faf5 100%);
          box-shadow:0 10px 30px rgba(20,52,36,.065);
        }
        .ops-hero h2{
          margin:8px 0 7px;
          color:#10251b;
          font-size:30px;
          line-height:1.15;
          letter-spacing:-.025em;
        }
        .ops-hero p{
          max-width:790px;
          color:#53675d;
          font-size:15px;
          line-height:1.65;
        }
        .ops-kicker{
          color:var(--agency-green);
          font-size:13px;
          letter-spacing:.055em;
        }
        .ops-source-chips span{
          min-height:34px;
          padding:7px 12px;
          border-color:#d8e6de;
          background:#fff;
          color:#304b3e;
          font-size:13px;
        }
        .ops-hero-actions{
          min-width:260px;
          gap:10px;
        }
        .ops-hero-actions button{
          min-height:48px!important;
          height:48px;
          border-radius:11px!important;
          font-size:15px;
          font-weight:850;
        }
        .ops-primary{
          background:linear-gradient(135deg,#0a8a52,#087344)!important;
          box-shadow:0 8px 18px rgba(8,122,75,.18)!important;
        }
        .ops-config-card,
        .ops-output,
        .ops-panel{
          border-color:var(--agency-line);
          background:var(--agency-surface);
          box-shadow:0 8px 24px rgba(20,52,36,.045);
        }
        .ops-config-card{
          padding:20px 22px 22px;
          border-radius:18px;
        }
        .ops-config-heading{
          align-items:flex-start;
        }
        .ops-config-heading>div:first-child{
          display:grid;
          gap:4px;
        }
        .ops-config-heading span{
          color:var(--agency-green);
          font-size:12px;
          letter-spacing:.06em;
        }
        .ops-config-heading strong{
          color:#163025;
          font-size:20px;
          line-height:1.3;
        }
        .ops-config-heading small{
          max-width:720px;
          color:#677a70;
          font-size:14px;
          line-height:1.5;
        }
        .ops-updated{
          display:inline-flex;
          align-items:center;
          gap:7px;
          min-height:38px;
          padding:8px 11px;
          border:1px solid #e1e9e4;
          border-radius:10px;
          background:#f8faf9;
          color:#67776f;
          font-size:13px;
          white-space:nowrap;
        }
        .ops-updated b{font-size:13px;color:#294338}
        .ops-updated-dot{
          width:8px;
          height:8px;
          border-radius:50%;
          background:#16a34a;
          box-shadow:0 0 0 3px rgba(22,163,74,.10);
        }
        .ops-workflow{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:8px;
          margin-top:17px;
          padding:10px;
          border:1px solid #e2eae5;
          border-radius:14px;
          background:#f8fbf9;
        }
        .ops-workflow>div{
          display:flex;
          align-items:center;
          gap:10px;
          min-width:0;
          padding:8px 10px;
          border-right:1px solid #e3ebe6;
        }
        .ops-workflow>div:last-child{border-right:0}
        .ops-workflow b{
          display:grid;
          place-items:center;
          flex:0 0 30px;
          width:30px;
          height:30px;
          border-radius:9px;
          background:#e7f6ee;
          color:var(--agency-green);
          font-size:14px;
        }
        .ops-workflow span{
          display:grid;
          min-width:0;
          gap:1px;
        }
        .ops-workflow strong{
          color:#274237;
          font-size:13px;
          line-height:1.3;
        }
        .ops-workflow small{
          color:#74847c;
          font-size:12px;
          line-height:1.35;
        }
        .ops-report-types{
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:10px;
          margin-top:15px;
        }
        .ops-report-types button{
          min-height:104px;
          grid-template-columns:42px minmax(0,1fr);
          gap:11px;
          padding:14px;
          border-radius:12px;
          border-color:#dce6e0;
        }
        .ops-report-types button strong{
          color:#263f34;
          font-size:14px;
          line-height:1.35;
        }
        .ops-report-types button span{
          color:#64766d;
          font-size:13px;
          line-height:1.45;
        }
        .ops-report-types button.active{
          border-color:#26a962;
          background:#f0faf4;
          box-shadow:inset 0 0 0 1px rgba(38,169,98,.13),0 5px 15px rgba(21,119,70,.05);
        }
        .ops-type-icon{
          width:40px;
          height:40px;
          border-radius:10px;
        }
        .ops-filter-grid{
          grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
          gap:12px;
          margin-top:16px;
          padding:16px;
          border:1px solid #e3ebe6;
          border-radius:14px;
          background:#fbfcfb;
        }
        .ops-filter-grid label>span{
          color:#566b60;
          font-size:12px;
          letter-spacing:.045em;
        }
        .ops-filter-grid select,
        .ops-filter-grid input{
          height:48px;
          border-radius:10px;
          border-color:#d7e1db;
          background:#fff;
          color:#1d3328;
          font-size:15px;
        }
        .ops-empty-state{
          padding:52px 24px;
          border:1px dashed #cbdad2;
          border-radius:18px;
          background:linear-gradient(180deg,#fbfdfc,#f6faf8);
        }
        .ops-empty-icon{
          width:52px;
          height:52px;
          border-radius:14px;
          background:#087a4b;
          font-size:22px;
        }
        .ops-empty-state h3{font-size:20px;color:#183126}
        .ops-empty-state p{max-width:570px;font-size:15px;line-height:1.6;color:#65786e}
        .ops-output{
          gap:16px;
          padding:22px;
          border-radius:18px;
        }
        .ops-output-head{
          padding:3px 2px 15px;
          border-bottom:1px solid #dfe8e3;
        }
        .ops-output-head h3{
          color:#132b20;
          font-size:28px;
        }
        .ops-output-head p,
        .ops-report-meta,
        .ops-report-meta strong{
          font-size:14px;
        }
        .ops-basis-note{
          border-color:#cfe0f6;
          border-radius:13px;
          background:#f3f8fe;
        }
        .ops-basis-note strong{font-size:14px}
        .ops-basis-note p{font-size:14px;line-height:1.6}
        .ops-kpi-grid{
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:10px;
          padding:0;
          border:0;
          background:transparent;
        }
        .ops-kpi{
          min-height:112px;
          padding:15px 16px;
          border:1px solid #dfe8e3!important;
          border-radius:14px!important;
          background:#fbfcfb!important;
        }
        .ops-kpi:before{display:block}
        .ops-kpi span,.ops-kpi small{font-size:13px!important}
        .ops-kpi strong{font-size:25px!important}
        .ops-panel{border-radius:16px}
        .ops-section-title span{font-size:12px}
        .ops-section-title h4{font-size:20px;color:#183126}
        .ops-section-title p{font-size:14px;color:#687a70}
        .ops-table-wrap{
          border-color:#dce6e0;
          border-radius:12px;
          box-shadow:0 2px 8px rgba(17,49,33,.02);
        }
        .ops-table{min-width:1240px}
        .ops-table th{
          background:#f4f8f5;
          color:#53685d;
        }
        .ops-table tbody tr:hover{background:#fbfdfc}
        .ops-report-footer{
          border-top:1px solid #dce6e0;
          color:#5f7168;
        }

        @media(max-width:1250px){
          .ops-report-types{grid-template-columns:repeat(3,1fr)}
          .ops-workflow{grid-template-columns:repeat(2,1fr)}
          .ops-workflow>div:nth-child(2){border-right:0}
        }
        @media(max-width:900px){
          .ops-hero{padding:20px;gap:18px}
          .ops-hero h2{font-size:27px}
          .ops-hero-actions{min-width:0}
          .ops-config-card{padding:18px}
          .ops-config-heading{gap:12px}
          .ops-report-types{grid-template-columns:repeat(2,1fr)}
          .ops-kpi-grid{grid-template-columns:repeat(2,1fr)}
        }
        @media(max-width:560px){
          .ops-workflow{grid-template-columns:1fr}
          .ops-workflow>div{border-right:0;border-bottom:1px solid #e3ebe6}
          .ops-workflow>div:last-child{border-bottom:0}
          .ops-report-types,.ops-kpi-grid{grid-template-columns:1fr}
          .ops-report-types button{min-height:94px}
          .ops-filter-grid{padding:13px;grid-template-columns:1fr}
          .ops-output{padding:14px}
        }

        /* Actual OpenStreetMap route evidence */
        .ops-gps-grid{
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:16px;
          margin-top:16px;
        }
        .ops-gps-card{
          border:1px solid #dbe5df;
          border-radius:16px;
          box-shadow:0 8px 24px rgba(15,45,31,.07);
          transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;
        }
        .ops-gps-card:hover{
          transform:translateY(-2px);
          border-color:#a9cfbb;
          box-shadow:0 14px 34px rgba(15,45,31,.11);
        }
        .ops-route-map{
          position:relative;
          width:100%;
          aspect-ratio:720/320;
          overflow:hidden;
          isolation:isolate;
          border-bottom:1px solid #dfe8e3;
          background:#e8eee9;
        }
        .ops-route-tiles,.ops-route-overlay{
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
        }
        .ops-route-tiles img{
          position:absolute;
          width:256px;
          height:256px;
          max-width:none;
          user-select:none;
          -webkit-user-drag:none;
        }
        .ops-route-overlay{z-index:2;pointer-events:none}
        .ops-route-halo{
          fill:none;
          stroke:rgba(255,255,255,.96);
          stroke-width:11;
          stroke-linecap:round;
          stroke-linejoin:round;
        }
        .ops-route-line{
          fill:none;
          stroke:#1677ff;
          stroke-width:5;
          stroke-linecap:round;
          stroke-linejoin:round;
          filter:drop-shadow(0 2px 2px rgba(15,70,150,.28));
        }
        .ops-route-marker-ring{stroke:#fff;stroke-width:3;opacity:.92}
        .ops-route-marker-ring.start{fill:rgba(5,150,105,.25)}
        .ops-route-marker-ring.end{fill:rgba(220,38,38,.24)}
        .ops-route-marker{stroke:#fff;stroke-width:3}
        .ops-route-marker.start{fill:#059669}
        .ops-route-marker.end{fill:#dc2626}
        .ops-route-legend,.ops-route-open,.ops-map-credit{
          position:absolute;
          z-index:3;
          border:1px solid rgba(203,213,225,.9);
          background:rgba(255,255,255,.94);
          box-shadow:0 3px 12px rgba(15,23,42,.12);
          backdrop-filter:blur(5px);
        }
        .ops-route-legend{
          top:10px;
          left:10px;
          display:flex;
          align-items:center;
          gap:6px;
          padding:6px 9px;
          border-radius:9px;
          color:#34463d;
          font-size:11px;
          font-weight:800;
        }
        .ops-route-legend span{width:8px;height:8px;border-radius:50%}
        .ops-route-legend span.start{background:#059669}
        .ops-route-legend span.end{margin-left:4px;background:#dc2626}
        .ops-route-open{
          top:10px;
          right:10px;
          padding:6px 9px;
          border-radius:9px;
          color:#075e3b;
          font-size:11px;
          font-weight:900;
          text-decoration:none;
        }
        .ops-map-credit{
          right:5px;
          bottom:4px;
          padding:2px 5px;
          border-radius:4px;
          color:#475569;
          font-size:9px;
          text-decoration:none;
        }
        .ops-gps-card-body{gap:10px;padding:14px 15px 15px}
        .ops-gps-card-body strong{font-size:14px;color:#183126}
        .ops-gps-card-body span{font-size:12px}
        .ops-gps-meta span,.ops-gps-stats span{padding:6px 9px;font-size:11px}
        .ops-gps-stats span{border:1px solid #d7eee2;background:#f0faf5}
        .ops-agency-hero{align-items:center;background:linear-gradient(135deg,#ffffff 0%,#f7fbf9 100%);border:1px solid #dce8e1;box-shadow:0 12px 32px rgba(23,49,38,.07)}
        .ops-agency-brand{display:flex;align-items:center;gap:18px;min-width:0}.ops-agency-logo{width:92px;height:92px;object-fit:contain;flex:0 0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:50%;padding:4px;box-shadow:0 8px 20px rgba(15,23,42,.08)}
        .ops-system-snapshot{border:1px solid #dfe7e2;border-radius:16px;background:#fff;padding:16px}.ops-snapshot-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ops-snapshot-heading>div{display:grid;gap:2px}.ops-snapshot-heading span{font-size:10px;font-weight:950;letter-spacing:.08em;color:#059669}.ops-snapshot-heading strong{font-size:15px;color:#183126}.ops-snapshot-heading>b{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid #bbf7d0;border-radius:999px;background:#f0fdf4;color:#166534;font-size:10px}
        .ops-snapshot-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.ops-snapshot-grid>div{min-height:74px;padding:11px 12px;border:1px solid #e6ece8;border-radius:11px;background:#f9fbfa}.ops-snapshot-grid span,.ops-snapshot-grid strong,.ops-snapshot-grid small{display:block}.ops-snapshot-grid span{font-size:9px;font-weight:850;color:#687970}.ops-snapshot-grid strong{margin-top:4px;font-size:20px;color:#173126}.ops-snapshot-grid small{margin-top:2px;font-size:8px;color:#829087}
        .ops-hotspot-summary{display:grid;grid-template-columns:1.2fr .75fr .75fr 1.4fr;gap:8px;margin-top:14px}.ops-hotspot-summary>div{padding:12px;border:1px solid #e4e9e6;border-radius:11px;background:#f9fbfa}.ops-hotspot-summary span,.ops-hotspot-summary strong{display:block}.ops-hotspot-summary span{font-size:9px;color:#697b72}.ops-hotspot-summary strong{margin-top:4px;font-size:15px;color:#173126}.ops-inline-empty{margin-top:14px;padding:18px;border:1px dashed #cdd8d2;border-radius:11px;color:#718178;text-align:center;font-size:12px}.ops-complaint-table{min-width:980px}
        .ops-type-icon.complaints{background:#fff1f2;color:#be123c}
        .ops-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .ops-svg-chart-card{overflow:hidden;border:1px solid #dfe7e2;border-radius:14px;background:#fff}
        .ops-svg-chart-card>header{display:grid;gap:3px;padding:14px 15px 8px;border-bottom:1px solid #edf2ef;background:#fbfdfc}
        .ops-svg-chart-card>header strong{font-size:13px;color:#173126}.ops-svg-chart-card>header span{font-size:11px;line-height:1.45;color:#6b7c73}
        .ops-svg-chart{display:block;width:100%;height:auto;padding:7px 8px 10px}.ops-chart-label{fill:#40554a;font-size:13px;font-weight:700}.ops-chart-value{fill:#173126;font-size:13px;font-weight:900}.ops-chart-track{fill:#edf3ef}.ops-chart-bar{fill:#159451}.ops-chart-empty{padding:28px 16px;color:#7b8a82;font-size:12px;text-align:center}
        .ops-intelligence-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}.ops-analysis-block{min-width:0}.ops-analysis-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:8px}.ops-analysis-heading>div{display:grid;gap:2px}.ops-analysis-heading span{font-size:10px;font-weight:950;letter-spacing:.07em;color:#15803d}.ops-analysis-heading strong{font-size:15px;color:#173126}.ops-analysis-heading small{max-width:390px;color:#718178;font-size:10px;line-height:1.45;text-align:right}.ops-problem-table{min-width:760px}.ops-month-table{min-width:560px}.ops-section-note strong{color:#314c3e}
        @media(max-width:1180px){.ops-chart-grid,.ops-intelligence-grid{grid-template-columns:1fr}.ops-analysis-heading{align-items:flex-start;flex-direction:column}.ops-analysis-heading small{text-align:left}}
        @media(max-width:1180px){.ops-snapshot-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.ops-hotspot-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:980px){.ops-gps-grid{grid-template-columns:1fr}.ops-agency-brand{align-items:flex-start}.ops-agency-logo{width:76px;height:76px}.ops-snapshot-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:560px){
          .ops-agency-brand{display:grid}.ops-agency-logo{width:68px;height:68px}.ops-snapshot-grid,.ops-hotspot-summary{grid-template-columns:1fr 1fr}
          .ops-route-legend{display:none}
          .ops-route-open{font-size:10px}
          .ops-map-credit{font-size:8px}
        }
      `}</style>
    </section>
  );
}


function ReportTypeIcon({ type }: { type: ReportType }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true } as const;

  if (type === "complete") {
    return <svg {...common}><path d="M4 4h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v11h16V6H4Z" /></svg>;
  }
  if (type === "collection") {
    return <svg {...common}><path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.2l-1.7-2H15Z" /></svg>;
  }
  if (type === "drivers") {
    return <svg {...common}><path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 17c0-4 3.1-7 7-7s7 3 7 7v1H5v-1Z" /></svg>;
  }
  if (type === "capacity") {
    return <svg {...common}><path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /></svg>;
  }
  if (type === "issues") {
    return <svg {...common}><path d="M12 2 1 21h22L12 2Zm1 14h-2v-2h2v2Zm0-4h-2V8h2v4Z" /></svg>;
  }
  if (type === "complaints") {
    return <svg {...common}><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 5v2h10V8H7Zm0 4v2h7v-2H7Z" /></svg>;
  }
  if (type === "schedules") {
    return <svg {...common}><path d="M7 2h2v3H7V2Zm8 0h2v3h-2V2ZM4 5h16a1 1 0 0 1 1 1v15H3V6a1 1 0 0 1 1-1Zm1 5v9h14v-9H5Zm2 2h3v3H7v-3Z" /></svg>;
  }
  return <svg {...common}><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" /></svg>;
}

function SourceIcon({ kind }: { kind: "database" | "cloudOff" | "shield" }) {
  if (kind === "database") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-5 0-9 1.8-9 4v12c0 2.2 4 4 9 4s9-1.8 9-4V6c0-2.2-4-4-9-4Zm0 2c4.2 0 7 .9 7 2s-2.8 2-7 2-7-.9-7-2 2.8-2 7-2Zm0 6c2.8 0 5.3-.6 7-1.5V12c0 1.1-2.8 2-7 2s-7-.9-7-2V8.5c1.7.9 4.2 1.5 7 1.5Zm0 6c2.8 0 5.3-.6 7-1.5V18c0 1.1-2.8 2-7 2s-7-.9-7-2v-3.5c1.7.9 4.2 1.5 7 1.5Z" /></svg>;
  }
  if (kind === "cloudOff") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2 18.7 18.7-1.4 1.4-3-3H7a5 5 0 0 1-1.8-9.7A7 7 0 0 1 6.6 7L1.9 3.4 3.3 2Zm6.3 6.3 8.7 8.7H19a3 3 0 0 0 .7-5.9A7 7 0 0 0 9.6 8.3Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5.2 3.4 9.5 8 11 4.6-1.5 8-5.8 8-11V5l-8-3Zm0 2.2L18 6.4V11c0 4-2.4 7.3-6 8.7C8.4 18.3 6 15 6 11V6.4l6-2.2Z" /></svg>;
}

function ActionIcon({ kind }: { kind: "report" | "print" }) {
  if (kind === "report") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6V2Zm8 2v4h4l-4-4ZM9 12h8v2H9v-2Zm0 4h8v2H9v-2Zm0-8h3v2H9V8Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v5H6V2Zm0 14h12v6H6v-6Zm-2-8h16a2 2 0 0 1 2 2v7h-3v-3H5v3H2v-7a2 2 0 0 1 2-2Zm15 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" /></svg>;
}

function KpiIcon({ label }: { label: string }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (label === "Collection Runs") {
    return <svg {...common}><path d="M7 2h2v3H7V2Zm8 0h2v3h-2V2ZM4 5h16a1 1 0 0 1 1 1v15H3V6a1 1 0 0 1 1-1Zm2 6v8h12v-8H6Z" /></svg>;
  }
  if (label === "Fully Completed") {
    return <svg {...common}><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.3 14.2-4-4 1.4-1.4 2.6 2.6 5.2-5.2 1.4 1.4-6.6 6.6Z" /></svg>;
  }
  if (label === "Follow-up Runs") {
    return <svg {...common}><path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /></svg>;
  }
  if (label === "Estimated Truck Load") {
    return <svg {...common}><path d="M4 18a8 8 0 1 1 16 0h-2a6 6 0 1 0-12 0H4Zm8-9 4 5-1.5 1.3L12 12.1l-2.5 3.2L8 14l4-5Z" /></svg>;
  }
  if (label === "Open Issues") {
    return <svg {...common}><path d="M12 2 2 12h3v9h14v-9h3L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z" /></svg>;
  }
  if (label === "Active Schedules") {
    return <svg {...common}><path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.5 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2 20c0-4 3-6 6-6s6 2 6 6H2Zm12.5 0c0-1.4-.4-2.6-1-3.6 2.3.3 5.5 1.7 5.5 3.6h-4.5Z" /></svg>;
  }
  return <svg {...common}><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" /></svg>;
}

function kpiIconTone(label: string) {
  if (label === "Follow-up Runs") return "amber";
  if (label === "Open Issues") return "purple";
  if (label === "Active Schedules") return "blue";
  if (label === "GPS Verified") return "violet";
  return "green";
}

function Kpi({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <article className={`ops-kpi ${tone}`}>
      <div className={`ops-kpi-icon ${kpiIconTone(label)}`} aria-hidden="true">
        <KpiIcon label={label} />
      </div>
      <div className="ops-kpi-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="ops-section-title"><span>{eyebrow}</span><h4>{title}</h4><p>{subtitle}</p></div>;
}

function ProgressMetric({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div className={`ops-progress-row ${muted ? "muted" : ""}`}><span>{label}</span><div className="ops-progress-track"><div className="ops-progress-fill" style={{ width: `${safe}%` }} /></div><strong>{muted ? "—" : formatPercent(safe)}</strong></div>;
}

function PriorityBadge({ value }: { value: Priority }) {
  return <span className={`ops-priority ${value.toLowerCase()}`}>{value}</span>;
}

function AssessmentBadge({ value }: { value: string }) {
  const className = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={`ops-assessment ${className}`}>{value}</span>;
}

function StatusBadge({ value, alert }: { value: string; alert?: boolean }) {
  return <span className={`ops-status-badge ${alert ? "open" : "resolved"}`}>{value}</span>;
}

function CapacityTile({ label, value, percent, alert = false }: { label: string; value: number; percent: number; alert?: boolean }) {
  return <article className={`ops-capacity-tile ${alert ? "alert" : ""}`}><div><span>{label}</span><strong>{value}</strong></div><div className="ops-capacity-bar"><div style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div></article>;
}

function printOperationsReport(input: {
  reportType: ReportType;
  generatedAt: number;
  lastUpdated: number;
  subtitle: string;
  summary: ReportSummary;
  barangayRows: AreaRow[];
  purokRows: AreaRow[];
  driverRows: DriverRow[];
  truckRows: TruckRow[];
  issueRows: IssueRecord[];
  scheduleRows: SchedulePerformanceRow[];
  gpsCards: Array<{ collection: CollectionRecord; trace: GpsTrace }>;
  managementActions: string[];
  capacityDistribution: { quarter: number; half: number; threeQuarter: number; full: number; unknown: number };
  systemSnapshot: SystemSnapshot;
  complaintHotspots: ComplaintHotspotRow[];
  complaintRows: IssueRecord[];
  fullSystemSummary: FullSystemSummary;
  topProblemAreas: ProblemAreaRow[];
  monthlyComparison: MonthlyComparison;
  residentCoverageRows: ResidentCoverageRow[];
  attendanceRows: AttendanceRecord[];
  violationRows: AnyItem[];
  wastePointRows: AnyItem[];
  routeStatusRows: AnyItem[];
  activityRequestRows: AnyItem[];
}) {
  const printWindow = window.open("", "_blank", "width=900,height=1100");
  if (!printWindow) {
    window.alert("The print window was blocked. Allow pop-ups for this site and try again.");
    return;
  }

  const areaRowsHtml = (rows: AreaRow[], scope: "barangay" | "purok") => rows.map((row, index) => {
    const areaLabel = scope === "purok"
      ? `<strong>${escapeHtml(row.barangay)}</strong><span>Purok: ${escapeHtml(row.purok || "—")}</span>`
      : `<strong>${escapeHtml(row.barangay)}</strong>${row.followUpPuroks.length > 0 ? `<span>Follow-up: ${escapeHtml(row.followUpPuroks.join(", "))}</span>` : ""}`;
    const load = row.averageLoad === null ? "—" : formatPercent(row.averageLoad);
    return `<tr>
      <td class="num">${index + 1}</td>
      <td>${areaLabel}</td>
      <td><strong>${row.trips} run${row.trips === 1 ? "" : "s"}</strong><span>${row.completed} completed • ${row.partial + row.missed} follow-up</span></td>
      <td><strong>${escapeHtml(formatPercent(row.completionRate))}</strong><span>Est. load ${escapeHtml(load)} • ${row.fullTruckEvents} full</span></td>
      <td><strong>${row.openIssues} issue${row.openIssues === 1 ? "" : "s"}</strong><span>${row.activeSchedules} schedule${row.activeSchedules === 1 ? "" : "s"} • GPS ${row.gpsTrips}/${row.trips} • ${escapeHtml(formatDistance(row.distanceMeters))}</span></td>
      <td><span class="pill ${row.priority.toLowerCase()}">${escapeHtml(row.priority)}</span><p>${escapeHtml(row.recommendation)}</p>${row.reasons.length ? `<span>${escapeHtml(row.reasons.join("; "))}</span>` : ""}</td>
    </tr>`;
  }).join("");

  const driverRowsHtml = input.driverRows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.driverName)}</strong><span>${escapeHtml(row.barangays.join(", ") || "No assigned area")}</span></td>
    <td><strong>${escapeHtml(row.currentStatus || "—")}</strong><span>${escapeHtml(row.trucks.join(", ") || "No truck")}${row.activeScheduleId ? ` • Schedule ${escapeHtml(row.activeScheduleId)}` : ""}</span></td>
    <td><strong>${row.trips} run${row.trips === 1 ? "" : "s"} • ${escapeHtml(formatPercent(row.completionRate))}</strong><span>${row.completed} completed • ${row.partial + row.missed} follow-up</span></td>
    <td><strong>GPS ${row.gpsTrips}/${row.trips} • ${escapeHtml(formatDistance(row.distanceMeters))}</strong><span>Load ${row.averageLoad === null ? "—" : escapeHtml(formatPercent(row.averageLoad))} • ${row.fullTruckEvents} full • Last GPS ${row.lastGpsAt > 0 ? escapeHtml(formatDateTime(row.lastGpsAt)) : "—"}</span></td>
    <td><strong>${row.openIssues} open issue${row.openIssues === 1 ? "" : "s"}</strong><span class="assessment-text">${escapeHtml(row.assessment)}</span></td>
  </tr>`).join("");

  const truckRowsHtml = input.truckRows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.truckId)}</strong></td>
    <td><strong>${row.trips} run${row.trips === 1 ? "" : "s"}</strong><span>${row.completed} completed • ${row.partial} partial</span></td>
    <td><strong>${row.averageLoad === null ? "—" : escapeHtml(formatPercent(row.averageLoad))} avg. load</strong><span>${row.fullTruckEvents} full-truck event${row.fullTruckEvents === 1 ? "" : "s"}</span></td>
    <td><strong>${escapeHtml(row.barangays.join(", ") || "—")}</strong><span>Drivers: ${escapeHtml(row.drivers.join(", ") || "—")} • ${escapeHtml(formatDistance(row.distanceMeters))}</span></td>
    <td><strong>${escapeHtml(row.assessment)}</strong></td>
  </tr>`).join("");

  const issueRowsHtml = input.issueRows.slice(0, 100).map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(formatDateTime(row.timestamp))}</strong><span>${escapeHtml(row.source)}</span></td>
    <td><strong>${escapeHtml(row.barangay)}</strong><span>${escapeHtml(row.puroks.join(", ") || "No Purok specified")}</span></td>
    <td><strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.severity)}</span></td>
    <td><span class="status ${row.isOpen ? "open" : "resolved"}">${escapeHtml(row.isOpen ? "Open" : "Resolved")}</span></td>
    <td>${escapeHtml(row.details || "—")}</td>
  </tr>`).join("");

  const complaintHotspotRowsHtml = input.complaintHotspots.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.barangay)}</strong></td>
    <td><strong>${row.total}</strong><span>${escapeHtml(formatPercent(row.share))} of complaints</span></td>
    <td><strong>${row.open}</strong><span>${row.resolved} resolved</span></td>
    <td><strong>${row.highImpact}</strong></td>
    <td><strong>${escapeHtml(row.topCategory)}</strong></td>
    <td><strong>${escapeHtml(formatDateTime(row.latestAt))}</strong></td>
  </tr>`).join("");

  const complaintDetailRowsHtml = input.complaintRows.slice(0, 100).map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(formatDateTime(row.timestamp))}</strong></td>
    <td><strong>${escapeHtml(row.barangay)}</strong><span>${escapeHtml(row.puroks.join(", ") || "Purok not specified")}</span></td>
    <td><strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.severity)}</span></td>
    <td><span class="status ${row.isOpen ? "open" : "resolved"}">${escapeHtml(row.isOpen ? "Open" : "Resolved")}</span></td>
    <td>${escapeHtml(row.details || "No description provided")}</td>
  </tr>`).join("");

  const residentCoverageRowsHtml = input.residentCoverageRows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.barangay)}</strong></td>
    <td><strong>${row.residents}</strong></td>
    <td><strong>${row.servicePuroks}</strong><span>${row.activeSchedules} active schedule${row.activeSchedules === 1 ? "" : "s"}</span></td>
    <td><strong>${row.collectionRuns}</strong><span>${row.collectionRuns ? escapeHtml(formatPercent(row.completionRate)) + " completed" : "No runs recorded"}</span></td>
    <td><strong>${row.complaints}</strong><span>${row.openIssues} open issue${row.openIssues === 1 ? "" : "s"}</span></td>
    <td><strong>${row.activeWastePoints}</strong></td>
    <td><strong>${escapeHtml(row.assessment)}</strong></td>
  </tr>`).join("");

  const attendanceRowsHtml = input.attendanceRows.slice(0, 120).map((row, index) => {
    const timeIn = objectValue(row.timeIn);
    const timeOut = objectValue(row.timeOut);
    return `<tr>
      <td class="num">${index + 1}</td>
      <td><strong>${escapeHtml(cleanText(row.dateKey) || formatDate(attendanceTimestamp(row)))}</strong></td>
      <td><strong>${escapeHtml(cleanText(row.driverName, "Driver"))}</strong><span>${escapeHtml(cleanText(row.vehicle ?? row.truck, "No vehicle"))}</span></td>
      <td><strong>${escapeHtml(cleanText(row.scheduleTitle, "No schedule title"))}</strong><span>${escapeHtml(cleanText(row.routeId, "No route ID"))}</span></td>
      <td><strong>${escapeHtml(barangayText(row))}</strong><span>${escapeHtml(cleanText(row.puroks, "Purok not recorded"))}</span></td>
      <td><strong>${timeIn.timestamp ? escapeHtml(formatDateTime(normalizeTimestamp(timeIn.timestamp))) : "Not recorded"}</strong><span>${timeOut.timestamp ? "Out " + escapeHtml(formatDateTime(normalizeTimestamp(timeOut.timestamp))) : "Time-out not recorded"}</span></td>
      <td><strong>${nonNegativeNumber(row.totalDutyMinutes) ? escapeHtml(formatDuration(nonNegativeNumber(row.totalDutyMinutes) * 60)) : "—"}</strong><span>${escapeHtml(cleanText(row.status ?? row.timingStatus, "Incomplete"))}</span></td>
    </tr>`;
  }).join("");

  const violationRowsHtml = input.violationRows.slice(0, 120).map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(formatDateTime(normalizeTimestamp(row.issuedAt ?? row.updatedAt ?? row.createdAt)))}</strong></td>
    <td><strong>${escapeHtml(cleanText(row.residentName, "Resident"))}</strong><span>${escapeHtml(cleanText(row.residentId, ""))}</span></td>
    <td><strong>${escapeHtml(cleanText(row.violation, "Not specified"))}</strong><span>${escapeHtml(cleanText(row.penalty, "No penalty recorded"))}</span></td>
    <td><strong>${escapeHtml(cleanText(row.status, "Recorded"))}</strong></td>
    <td>${escapeHtml(cleanText(row.notes, "—"))}</td>
  </tr>`).join("");

  const wastePointRowsHtml = input.wastePointRows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(cleanText(row.name, "Waste Drop-off Point"))}</strong></td>
    <td><strong>${escapeHtml(barangayText(row))}</strong><span>${escapeHtml(cleanText(row.landmark, "No landmark"))}</span></td>
    <td>${escapeHtml(cleanText(row.instructions, "No special instructions"))}</td>
    <td><strong>${row.active === false || String(row.active).toLowerCase() === "false" ? "Inactive" : "Active"}</strong></td>
    <td>${escapeHtml(formatDateTime(normalizeTimestamp(row.updatedAt ?? row.createdAt)))}</td>
  </tr>`).join("");

  const routeStatusRowsHtml = input.routeStatusRows.slice(0, 100).map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(formatDateTime(routeStatusTimestamp(row)))}</strong></td>
    <td><strong>${escapeHtml(cleanText(row.driverName, "Driver"))}</strong></td>
    <td><strong>${escapeHtml(cleanText(row.routeName, "Route not specified"))}</strong><span>${escapeHtml(cleanText(row.stop ?? row.barangay ?? row.purok, "No stop/area"))}</span></td>
    <td><strong>${escapeHtml(cleanText(row.status, "—"))}</strong></td>
    <td>${escapeHtml(cleanText(row.notes, "—"))}</td>
  </tr>`).join("");

  const activityRequestRowsHtml = input.activityRequestRows.slice(0, 100).map((row, index) => {
    const status = cleanText(row.status, "Pending");
    const normalized = status.toLowerCase();
    const meaning = ["sent", "delivered", "completed", "generated"].includes(normalized)
      ? "Processed and released"
      : normalized.includes("fail") || normalized.includes("error") || normalized.includes("reject")
        ? "Needs administrator retry/review"
        : "Awaiting administrator processing";
    return `<tr>
      <td class="num">${index + 1}</td>
      <td><strong>${escapeHtml(formatDateTime(normalizeTimestamp(row.requestedAt ?? row.createdAt)))}</strong></td>
      <td><strong>${escapeHtml(cleanText(row.driverName ?? row.name, "Driver"))}</strong><span>${escapeHtml(cleanText(row.driverId, ""))}</span></td>
      <td>${escapeHtml(cleanText(row.periodLabel ?? row.dateLabel ?? row.reportPeriod, "Requested activity period"))}</td>
      <td><strong>${escapeHtml(status)}</strong><span>${escapeHtml(formatDateTime(normalizeTimestamp(row.sentAt ?? row.updatedAt)))}</span></td>
      <td>${escapeHtml(meaning)}</td>
    </tr>`;
  }).join("");

  const scheduleRowsHtml = input.scheduleRows.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.barangay)} • ${escapeHtml(row.puroks.join(", ") || "All / unspecified Puroks")}</span></td>
    <td><strong>${escapeHtml(row.driverName)}</strong><span>${escapeHtml(row.truckId)} • ${escapeHtml(row.status)}</span></td>
    <td><strong>${row.trips} run${row.trips === 1 ? "" : "s"}</strong><span>${row.completed} completed • ${row.partial} partial</span></td>
    <td><strong>${escapeHtml(formatPercent(row.completionRate))}</strong><span>Last activity: ${escapeHtml(formatDateTime(row.lastActivity))}</span></td>
    <td><strong>${escapeHtml(row.assessment)}</strong></td>
  </tr>`).join("");

  const gpsHtml = input.gpsCards.slice(0, 20).map(({ collection, trace }, index) => `<div class="gps-card">
    <div class="gps-index">${index + 1}</div>
    ${routeMapHtml(trace.points)}
    <div class="gps-info"><strong>${escapeHtml(collection.routeName)}</strong><span>${escapeHtml(collection.barangay)} • ${escapeHtml(collection.driverName)} • ${escapeHtml(collection.truckId)}</span><span>${escapeHtml(formatDateTime(collection.timestamp))} • ${trace.points.length} recorded GPS points • ${escapeHtml(formatDistance(collection.distanceMeters))} • ${escapeHtml(formatDuration(collection.durationSeconds))}</span><span>Printed using the actual recorded GPS route over an OpenStreetMap base map.</span></div>
  </div>`).join("");

  const actionsHtml = input.managementActions.map((action, index) => `<li><b>${index + 1}</b><span>${escapeHtml(action)}</span></li>`).join("");
  const problemAreaRowsHtml = input.topProblemAreas.map((row, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td><strong>${escapeHtml(row.barangay)}</strong></td>
    <td>${row.complaints}</td>
    <td>${row.missedCollections}</td>
    <td>${row.openOperationalIssues}</td>
    <td><strong>${row.indicatorTotal}</strong></td>
    <td>${escapeHtml(row.primaryConcern)}</td>
  </tr>`).join("");

  const monthRowsHtml = [
    ["Collection runs", String(input.monthlyComparison.previous.collectionRuns), String(input.monthlyComparison.current.collectionRuns), signedCountChange(input.monthlyComparison.current.collectionRuns, input.monthlyComparison.previous.collectionRuns)],
    ["Completion rate", formatPercent(input.monthlyComparison.previous.completionRate), formatPercent(input.monthlyComparison.current.completionRate), signedPointChange(input.monthlyComparison.current.completionRate, input.monthlyComparison.previous.completionRate)],
    ["Complaints", String(input.monthlyComparison.previous.complaints), String(input.monthlyComparison.current.complaints), signedCountChange(input.monthlyComparison.current.complaints, input.monthlyComparison.previous.complaints)],
    ["Truck-full incidents", String(input.monthlyComparison.previous.truckFullEvents), String(input.monthlyComparison.current.truckFullEvents), signedCountChange(input.monthlyComparison.current.truckFullEvents, input.monthlyComparison.previous.truckFullEvents)],
    ["GPS verification rate", formatPercent(input.monthlyComparison.previous.gpsVerificationRate), formatPercent(input.monthlyComparison.current.gpsVerificationRate), signedPointChange(input.monthlyComparison.current.gpsVerificationRate, input.monthlyComparison.previous.gpsVerificationRate)],
    ["Attendance records", String(input.monthlyComparison.previous.attendanceTotal), String(input.monthlyComparison.current.attendanceTotal), signedCountChange(input.monthlyComparison.current.attendanceTotal, input.monthlyComparison.previous.attendanceTotal)],
    ["Late attendance", String(input.monthlyComparison.previous.attendanceLate), String(input.monthlyComparison.current.attendanceLate), signedCountChange(input.monthlyComparison.current.attendanceLate, input.monthlyComparison.previous.attendanceLate)],
    ["Incomplete attendance", String(input.monthlyComparison.previous.attendanceIncomplete), String(input.monthlyComparison.current.attendanceIncomplete), signedCountChange(input.monthlyComparison.current.attendanceIncomplete, input.monthlyComparison.previous.attendanceIncomplete)],
  ].map(([metric, previous, current, change]) => `<tr><td><strong>${escapeHtml(metric)}</strong></td><td>${escapeHtml(previous)}</td><td>${escapeHtml(current)}</td><td><strong>${escapeHtml(change)}</strong></td></tr>`).join("");

  const complaintChartHtml = barChartSvgHtml(
    "Complaint volume by Barangay",
    "Top Barangays in the selected report scope",
    input.complaintHotspots.slice(0, 6).map((row) => ({ label: row.barangay, value: row.total })),
  );
  const completionChartHtml = barChartSvgHtml(
    "Collection completion rate",
    "Current month vs previous month • Asia/Manila",
    [
      { label: input.monthlyComparison.previous.label, value: input.monthlyComparison.previous.completionRate },
      { label: input.monthlyComparison.current.label, value: input.monthlyComparison.current.completionRate },
    ],
    { maximum: 100, suffix: "%", decimals: 1 },
  );
  const attendanceChartHtml = barChartSvgHtml(
    `Driver attendance • ${input.monthlyComparison.current.label}`,
    "Exclusive classification of recorded duty attendance",
    [
      { label: "Present / on time", value: input.monthlyComparison.current.attendancePresent },
      { label: "Late", value: input.monthlyComparison.current.attendanceLate },
      { label: "Absent", value: input.monthlyComparison.current.attendanceAbsent },
      { label: "Incomplete punches", value: input.monthlyComparison.current.attendanceIncomplete },
    ],
  );
  const truckFullChartHtml = barChartSvgHtml(
    "Truck-full incidents by Barangay",
    "Recorded full-truck events in the selected report scope",
    [...input.barangayRows]
      .filter((row) => row.fullTruckEvents > 0)
      .sort((a, b) => b.fullTruckEvents - a.fullTruckEvents || a.barangay.localeCompare(b.barangay))
      .slice(0, 6)
      .map((row) => ({ label: row.barangay, value: row.fullTruckEvents })),
  );

  const include = (section: Exclude<ReportType, "complete">) => input.reportType === "complete" || input.reportType === section;
  const includeComplaintAnalysis = input.reportType === "complete" || input.reportType === "issues" || input.reportType === "complaints";
  const logoUrl = `${window.location.origin}/metrowaste-logo.jpg`;
  const reportTitle = input.reportType === "complete" ? "Full System Agency Operations Report" : `${reportTypeLabel(input.reportType)} Operations Report`;

  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(reportTitle)}</title><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff;color:#17251e}
    body{font-family:Arial,"Helvetica Neue",sans-serif;font-size:10.5pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{width:100%;max-width:190mm;margin:0 auto;padding:10mm 0 14mm}
    .document-head{display:grid;grid-template-columns:minmax(0,1fr) 48mm;gap:8mm;align-items:start;padding-bottom:6mm;border-bottom:2.5px solid #087a4b}
    .agency{display:flex;align-items:center;gap:3mm;margin-bottom:2mm;color:#087a4b;font-size:8.5pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .agency-mark{display:grid;place-items:center;width:8mm;height:8mm;border-radius:2.2mm;background:#087a4b;color:#fff;font-size:10pt;font-weight:900}
    h1{margin:0 0 2mm;color:#14291f;font-size:20pt;line-height:1.12;letter-spacing:-.02em}
    .subtitle{margin:0;color:#5e7167;font-size:9.7pt;line-height:1.45}
    .meta{display:grid;gap:2.3mm;padding:3.5mm;border:1px solid #dbe6df;border-radius:2.5mm;background:#f7faf8}
    .meta-row{display:grid;gap:.6mm}.meta span{color:#6c7c74;font-size:7.6pt;text-transform:uppercase;letter-spacing:.04em}.meta strong{color:#263d32;font-size:9pt}
    .basis{margin:4.5mm 0 0;padding:3.5mm 4mm;border:1px solid #cfe0f3;border-left:3px solid #2d73c9;border-radius:2.5mm;background:#f4f8fd;color:#425b70;font-size:9.1pt;line-height:1.5}.basis strong{color:#214f86}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2.5mm;margin:4.5mm 0}
    .kpi{min-height:23mm;padding:3.3mm;border:1px solid #dce6e0;border-radius:2.5mm;background:#fafcfb;break-inside:avoid}
    .kpi small,.kpi strong,.kpi span{display:block}.kpi small{color:#63756c;font-size:7.2pt;font-weight:800;text-transform:uppercase;letter-spacing:.035em}.kpi strong{margin:1mm 0;color:#14291f;font-size:15.5pt;line-height:1.1}.kpi span{color:#697b72;font-size:7.6pt;line-height:1.35}
    .section{margin-top:6mm;break-inside:auto}.section-head{display:flex;justify-content:space-between;align-items:end;gap:4mm;margin-bottom:2.5mm;padding-bottom:1.8mm;border-bottom:1px solid #bfcfc6;break-after:avoid}.section-head h2{margin:0;color:#173126;font-size:13pt;line-height:1.25}.section-head span{color:#697a72;font-size:8pt;text-align:right}
    .actions{padding:3.5mm 4mm;border:1px solid #cae6d5;border-left:3px solid #159451;border-radius:2.5mm;background:#f3fbf6}.actions ol{display:grid;gap:2.3mm;margin:0;padding:0;list-style:none}.actions li{display:flex;gap:2.5mm;align-items:flex-start;color:#334d40;font-size:9.2pt;line-height:1.45;break-inside:avoid}.actions b{display:grid;place-items:center;flex:0 0 6mm;width:6mm;height:6mm;border-radius:1.7mm;background:#087a4b;color:#fff;font-size:8pt}
    table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #d9e3dd;border-radius:2.2mm;overflow:hidden;font-size:8.4pt;line-height:1.35;table-layout:fixed}
    thead{display:table-header-group}th{padding:2.2mm 1.8mm;border-bottom:1px solid #cedad3;background:#f2f7f4;color:#4d6257;font-size:7.3pt;font-weight:800;text-align:left;text-transform:uppercase;letter-spacing:.025em;vertical-align:bottom}
    td{padding:2.3mm 1.8mm;border-bottom:1px solid #e4ebe7;color:#3d5147;vertical-align:top;overflow-wrap:anywhere}tbody tr:last-child td{border-bottom:0}tr{break-inside:avoid;page-break-inside:avoid}
    td strong,td span{display:block}td strong{color:#20372c;font-size:8.6pt;line-height:1.35}td span{margin-top:.7mm;color:#6b7d74;font-size:7.8pt;line-height:1.35}td p{margin:1.2mm 0 0;color:#445a4f;font-size:7.8pt;line-height:1.4}.num{width:8mm;text-align:center;color:#718179}
    .pill,.status{display:inline-flex!important;width:max-content;align-items:center;min-height:5.3mm;padding:0 2mm;border-radius:999px;font-size:7.2pt!important;font-weight:800}.pill.critical,.status.open{background:#fee2e2;color:#a91d1d}.pill.high{background:#ffedd5;color:#b8500c}.pill.monitor{background:#dbeafe;color:#1d4ed8}.pill.stable,.status.resolved{background:#dcfce7;color:#166534}.assessment-text{margin-top:1mm!important;font-weight:700;color:#314c3e!important}
    .capacity{display:grid;grid-template-columns:repeat(4,1fr);gap:2.5mm;margin-bottom:3mm}.capacity>div{padding:3mm;border:1px solid #dce6e0;border-radius:2.3mm;background:#f9fbfa;break-inside:avoid}.capacity small,.capacity strong{display:block}.capacity small{color:#65776e;font-size:7.5pt}.capacity strong{margin-top:1mm;color:#173126;font-size:14pt}
    .gps-grid{display:grid;grid-template-columns:1fr;gap:4mm}.gps-card{position:relative;overflow:hidden;border:1px solid #d9e3dd;border-radius:2.5mm;background:#fff;break-inside:avoid;page-break-inside:avoid}.gps-index{position:absolute;z-index:4;top:2.2mm;left:2.2mm;display:grid;place-items:center;width:7mm;height:7mm;border-radius:2mm;background:#183126;color:#fff;font-size:8pt;font-weight:900}.gps-map{position:relative;display:block;width:100%;height:68mm;border-bottom:1px solid #e3eae6;background:#eef4f0;overflow:hidden}.gps-map-tiles{position:absolute;inset:0}.gps-map-tiles img{position:absolute;width:256px;height:256px}.gps-overlay{position:absolute;inset:0;display:block;width:100%;height:100%}.gps-legend{position:absolute;left:3mm;bottom:3mm;display:inline-flex;align-items:center;gap:2.1mm;padding:1.4mm 2.3mm;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 1mm 2.5mm rgba(15,23,42,.12);color:#284034;font-size:7.1pt;font-weight:700}.gps-legend span{display:inline-block}.gps-legend .start,.gps-legend .end{width:3mm;height:3mm;border-radius:50%}.gps-legend .start{background:#16a34a}.gps-legend .end{background:#dc2626}.gps-legend .actual{margin-left:1mm;padding-left:2mm;border-left:1px solid #d7e1db}.gps-coords{padding:2mm 3mm;border-bottom:1px solid #edf2ef;background:#f8fbf9;color:#51645a;font-size:7.7pt;line-height:1.45}.gps-coords strong{color:#173126}.gps-coords span{display:inline-block;margin:0 1.4mm;color:#94a3b8}.gps-info{display:grid;gap:.8mm;padding:2.8mm 3mm 3mm}.gps-info strong{color:#20372c;font-size:9.1pt}.gps-info span{color:#6b7d74;font-size:7.8pt;line-height:1.4}.gps-empty{padding:8mm;text-align:center;border:1px dashed #cbd8d0;border-radius:2.5mm;color:#687970}
    .signoff{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin-top:14mm;break-inside:avoid}.signoff div{padding-top:2mm;border-top:1px solid #405148;color:#66776f;font-size:8.5pt;text-align:center}.footer{margin-top:7mm;padding-top:2.5mm;border-top:1px solid #dbe4df;color:#6d7d75;font-size:7.5pt;text-align:center}
    .collection-table th:nth-child(1){width:7mm}.collection-table th:nth-child(2){width:32mm}.collection-table th:nth-child(3){width:30mm}.collection-table th:nth-child(4){width:30mm}.collection-table th:nth-child(5){width:38mm}.collection-table th:nth-child(6){width:auto}
    .driver-table th:nth-child(1),.truck-table th:nth-child(1),.issue-table th:nth-child(1),.schedule-table th:nth-child(1){width:7mm}
    /* Formal readable agency-report overrides */
    body{font-size:9.4pt;line-height:1.45;color:#23352d}
    .formal-head{display:grid!important;grid-template-columns:1.2fr .95fr;gap:5mm 8mm;align-items:start;padding-bottom:5mm;border-bottom:2px solid #153d2d}
    .letterhead-brand{display:flex;align-items:center;gap:4mm}.print-logo{width:24mm;height:24mm;object-fit:contain}.agency-name{font-size:17pt;font-weight:950;letter-spacing:.04em;color:#123b2a}.agency-subname{margin-top:.5mm;font-size:8.5pt;font-weight:900;letter-spacing:.05em;color:#3d5147}.agency-system{margin-top:1.5mm;font-size:8pt;color:#6b7b73}
    .document-control{grid-column:1 / -1;padding:3.2mm 4mm;border:1px solid #d9e4de;border-radius:2mm;background:#f6faf8}.document-control span,.document-control strong,.document-control small{display:block}.document-control span{font-size:7.5pt;font-weight:900;letter-spacing:.12em;color:#15803d}.document-control strong{margin-top:1mm;font-size:15pt;color:#173126}.document-control small{margin-top:1mm;font-size:8.6pt;color:#63736b}
    .formal-meta{align-self:start;grid-column:2;grid-row:1}.formal-meta .meta-row{font-size:8pt}.basis{font-size:8.8pt;line-height:1.55;padding:3.5mm 4mm}
    .system-snapshot{display:grid;grid-template-columns:repeat(5,1fr);gap:2mm;margin:4mm 0 5mm}.system-snapshot>div{padding:2.5mm;border:1px solid #dde6e1;border-radius:1.7mm;background:#fbfdfc}.system-snapshot span,.system-snapshot strong,.system-snapshot small{display:block}.system-snapshot span{font-size:7pt;color:#6b7b73;text-transform:uppercase;font-weight:800}.system-snapshot strong{margin-top:.7mm;font-size:13pt;color:#173126}.system-snapshot small{margin-top:.5mm;font-size:7pt;color:#78877f}
    .section-head h2{font-size:11.5pt}.section-head span{font-size:7.8pt}.section{margin-top:5mm}.kpi small{font-size:7.8pt}.kpi strong{font-size:13.5pt}.kpi span{font-size:7.5pt}
    table{font-size:8.2pt}th{font-size:7.2pt;padding:2.2mm 2mm}td{padding:2.4mm 2mm;line-height:1.4}td strong{font-size:8.6pt}td span,td p{font-size:7.8pt}.complaint-table th:nth-child(1){width:7mm}.complaint-table th:nth-child(2){width:28mm}.complaint-table th:nth-child(3){width:25mm}.complaint-table th:nth-child(4){width:24mm}.complaint-table th:nth-child(5){width:18mm}.complaint-table th:nth-child(6){width:auto}.complaint-table th:nth-child(7){width:28mm}
    .subsection-title{margin:4mm 0 2mm;font-size:9.5pt;font-weight:900;color:#173126}.signoff{grid-template-columns:repeat(3,1fr);gap:10mm;margin-top:16mm}.signoff div{border:0;padding:0}.signoff div>span{display:block;height:9mm;border-bottom:1px solid #405148}.signoff strong,.signoff small{display:block;text-align:center}.signoff strong{margin-top:1.5mm;font-size:8.5pt}.signoff small{margin-top:.6mm;font-size:7.2pt;color:#6d7d75}.footer{display:grid;gap:.8mm}.footer strong{font-size:8pt;color:#30483c}.footer span{font-size:7.2pt}
    .print-avoid{break-inside:avoid;page-break-inside:avoid}
    .print-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm}.print-chart-card{overflow:hidden;border:1px solid #dce6e0;border-radius:2.4mm;background:#fff;break-inside:avoid;page-break-inside:avoid}.print-chart-title{display:grid;gap:.6mm;padding:2.6mm 3mm 1.8mm;border-bottom:1px solid #edf2ef;background:#f8fbf9}.print-chart-title strong{font-size:8.6pt;color:#173126}.print-chart-title span{font-size:7.2pt;color:#6b7d74}.print-chart-svg{display:block;width:100%;height:auto;padding:1.5mm 2mm 2mm}.chart-label{fill:#40554a;font-size:13px;font-weight:700}.chart-value{fill:#173126;font-size:13px;font-weight:900}.chart-track{fill:#edf3ef}.chart-bar{fill:#159451}.print-chart-empty{padding:8mm 4mm;color:#718178;font-size:8pt;text-align:center}.method-note{margin-top:2.5mm;padding:2.5mm 3mm;border-left:3px solid #159451;background:#f6faf8;color:#53675d;font-size:7.7pt;line-height:1.45}.problem-table th:nth-child(1){width:7mm}.problem-table th:nth-child(2){width:31mm}.problem-table th:nth-child(3),.problem-table th:nth-child(4),.problem-table th:nth-child(5),.problem-table th:nth-child(6){width:20mm}.month-table th:nth-child(1){width:55mm}
    @page{size:A4 portrait;margin:12mm 11mm 14mm}
    @media print{
      html,body{width:210mm;min-height:297mm}
      .page{max-width:none;padding:0}
      .section{break-inside:auto}
      .document-head,.basis,.kpi,.actions,.capacity>div,.gps-card,.signoff{break-inside:avoid;page-break-inside:avoid}
    }
  </style></head><body><main class="page">
    <header class="document-head formal-head">
      <div class="letterhead-brand">
        <img class="print-logo" src="${escapeHtml(logoUrl)}" alt="Metro Waste logo" />
        <div>
          <div class="agency-name">METROWASTE</div>
          <div class="agency-subname">SOLID WASTE MANAGEMENT CORP.</div>
          <div class="agency-system">Waste management service in Catbalogan</div>
          <div class="agency-system">WasteTrack • Agency Operations and Management Reporting</div>
        </div>
      </div>
      <div class="document-control">
        <span>OFFICIAL SYSTEM REPORT</span>
        <strong>${escapeHtml(reportTitle)}</strong>
        <small>${escapeHtml(input.subtitle)}</small>
      </div>
      <div class="meta formal-meta">
        <div class="meta-row"><span>Generated</span><strong>${escapeHtml(formatDateTime(input.generatedAt))}</strong></div>
        <div class="meta-row"><span>Last synchronized</span><strong>${escapeHtml(formatDateTime(input.lastUpdated))}</strong></div>
        <div class="meta-row"><span>Data source</span><strong>Firebase Realtime Database</strong></div>
      </div>
    </header>
    <div class="basis"><strong>Data integrity statement.</strong> This report is generated from live WasteTrack operational records. No demo or sample dataset is inserted. GPS map rendering may reduce the number of plotted points for print performance, but all report counts and management metrics are calculated from the actual stored system records.</div>
    <section class="system-snapshot print-avoid">
      <div><span>Drivers</span><strong>${input.systemSnapshot.drivers}</strong></div>
      <div><span>Residents</span><strong>${input.systemSnapshot.residents}</strong></div>
      <div><span>Active Routes</span><strong>${input.systemSnapshot.activeRoutes}</strong></div>
      <div><span>Service Areas</span><strong>${input.systemSnapshot.servicePuroks}</strong><small>${input.systemSnapshot.serviceBarangays} Barangays</small></div>
      <div><span>Schedules</span><strong>${input.systemSnapshot.activeSchedules}</strong></div>
      <div><span>Collection Runs</span><strong>${input.systemSnapshot.collectionRuns}</strong></div>
      <div><span>Complaints</span><strong>${input.systemSnapshot.complaints}</strong></div>
      <div><span>Open Issues</span><strong>${input.systemSnapshot.openIssues}</strong></div>
      <div><span>Notifications</span><strong>${input.systemSnapshot.notifications}</strong><small>${input.fullSystemSummary.notifications.unread} unread</small></div>
      <div><span>GPS Sessions</span><strong>${input.systemSnapshot.gpsSessions}</strong></div>
      <div><span>Attendance</span><strong>${input.systemSnapshot.attendanceRecords}</strong><small>${input.systemSnapshot.lateAttendance} late • ${input.systemSnapshot.incompleteAttendance} incomplete</small></div>
      <div><span>Compliance Cases</span><strong>${input.systemSnapshot.complianceViolations}</strong><small>${input.systemSnapshot.openViolations} unresolved</small></div>
      <div><span>Waste Points</span><strong>${input.systemSnapshot.wastePoints}</strong><small>${input.systemSnapshot.activeWastePoints} active</small></div>
      <div><span>Route Updates</span><strong>${input.systemSnapshot.routeStatusUpdates}</strong></div>
      <div><span>Activity Requests</span><strong>${input.systemSnapshot.activityReportRequests}</strong><small>${input.systemSnapshot.pendingActivityRequests} pending</small></div>
      <div><span>Generated Reports</span><strong>${input.systemSnapshot.activityReports}</strong></div>
    </section>
    <section class="kpis">
      <div class="kpi"><small>Collection Runs</small><strong>${input.summary.totalTrips}</strong><span>Recorded collection sessions</span></div>
      <div class="kpi"><small>Fully Completed</small><strong>${input.summary.completedTrips}</strong><span>${escapeHtml(formatPercent(input.summary.completionRate))} completion rate</span></div>
      <div class="kpi"><small>Follow-up Runs</small><strong>${input.summary.partialTrips + input.summary.missedTrips}</strong><span>${input.summary.followUpPuroks} uncollected Puroks</span></div>
      <div class="kpi"><small>Estimated Truck Load</small><strong>${input.summary.averageTruckLoad === null ? "—" : escapeHtml(formatPercent(input.summary.averageTruckLoad))}</strong><span>${input.summary.truckFullEvents} full-truck event${input.summary.truckFullEvents === 1 ? "" : "s"}</span></div>
      <div class="kpi"><small>Open Issues</small><strong>${input.summary.openIssues}</strong><span>Operational follow-up</span></div>
      <div class="kpi"><small>Active Schedules</small><strong>${input.summary.activeSchedules}</strong><span>${input.summary.trackingDrivers} tracking • ${input.summary.onlineDrivers} online</span></div>
      <div class="kpi"><small>GPS Verified</small><strong>${input.summary.gpsVerifiedTrips}</strong><span>${escapeHtml(formatPercent(input.summary.gpsVerificationRate))} of runs</span></div>
      <div class="kpi"><small>GPS Distance</small><strong>${escapeHtml(formatDistance(input.summary.totalDistanceMeters))}</strong><span>${escapeHtml(formatDuration(input.summary.totalDurationSeconds))} activity time</span></div>
    </section>
    <section class="section"><div class="section-head"><h2>Executive Management Actions</h2><span>Priority operational decision support</span></div><div class="actions"><ol>${actionsHtml}</ol></div></section>
    ${input.reportType === "complete" ? `<section class="section"><div class="section-head"><h2>Management Intelligence Dashboard</h2><span>SVG charts generated from actual system records</span></div><div class="print-chart-grid">${complaintChartHtml}${completionChartHtml}${attendanceChartHtml}${truckFullChartHtml}</div></section><section class="section"><div class="section-head"><h2>Top 5 Problem Areas</h2><span>Equal-weight indicator count: complaints + missed collections + open operational issues</span></div><table class="problem-table"><thead><tr><th>#</th><th>Barangay</th><th>Complaints</th><th>Missed</th><th>Open Issues</th><th>Total</th><th>Primary Concern</th></tr></thead><tbody>${problemAreaRowsHtml || `<tr><td colspan="7">No current problem indicator is recorded for the selected scope.</td></tr>`}</tbody></table><div class="method-note"><strong>Method:</strong> This ranking is a transparent administrative workload signal, not a disciplinary or severity score. One point is counted for each complaint, missed collection, and non-complaint open operational issue.</div></section><section class="section"><div class="section-head"><h2>Monthly Management Comparison</h2><span>${escapeHtml(input.monthlyComparison.current.label)} vs ${escapeHtml(input.monthlyComparison.previous.label)} • Asia/Manila</span></div><table class="month-table"><thead><tr><th>Metric</th><th>${escapeHtml(input.monthlyComparison.previous.label)}</th><th>${escapeHtml(input.monthlyComparison.current.label)}</th><th>Change</th></tr></thead><tbody>${monthRowsHtml}</tbody></table></section>` : ""}
    ${include("collection") ? `<section class="section"><div class="section-head"><h2>Barangay Operational Performance</h2><span>Collection, capacity, issues, schedules, and GPS</span></div><table class="collection-table"><thead><tr><th>#</th><th>Barangay</th><th>Service Runs</th><th>Completion / Load</th><th>Operations</th><th>Priority & Recommended Action</th></tr></thead><tbody>${areaRowsHtml(input.barangayRows,"barangay") || `<tr><td colspan="6">No Barangay data for the selected filters.</td></tr>`}</tbody></table></section><section class="section"><div class="section-head"><h2>Purok Operational Performance</h2><span>Detailed service-area follow-up</span></div><table class="collection-table"><thead><tr><th>#</th><th>Barangay / Purok</th><th>Service Runs</th><th>Completion / Load</th><th>Operations</th><th>Priority & Recommended Action</th></tr></thead><tbody>${areaRowsHtml(input.purokRows,"purok") || `<tr><td colspan="6">No Purok data for the selected filters.</td></tr>`}</tbody></table></section>` : ""}
    ${include("drivers") ? `<section class="section"><div class="section-head"><h2>Driver Activity & Service Performance</h2><span>Operational view; not a disciplinary score</span></div><table class="driver-table"><thead><tr><th>#</th><th>Driver / Area</th><th>Current Assignment</th><th>Collection Performance</th><th>Field Evidence</th><th>Issues / Assessment</th></tr></thead><tbody>${driverRowsHtml || `<tr><td colspan="6">No driver data for the selected filters.</td></tr>`}</tbody></table></section>` : ""}
    ${include("capacity") ? `<section class="section"><div class="section-head"><h2>Truck Capacity Utilization</h2><span>Driver-estimated operational truck load</span></div><div class="capacity"><div><small>1/4 Truck</small><strong>${input.capacityDistribution.quarter}</strong></div><div><small>1/2 Truck</small><strong>${input.capacityDistribution.half}</strong></div><div><small>3/4 Truck</small><strong>${input.capacityDistribution.threeQuarter}</strong></div><div><small>Full Truck</small><strong>${input.capacityDistribution.full}</strong></div></div><table class="truck-table"><thead><tr><th>#</th><th>Truck</th><th>Activity</th><th>Capacity</th><th>Coverage</th><th>Assessment</th></tr></thead><tbody>${truckRowsHtml || `<tr><td colspan="6">No truck data for the selected filters.</td></tr>`}</tbody></table></section>` : ""}
    ${includeComplaintAnalysis ? `<section class="section"><div class="section-head"><h2>Barangay Complaint Hotspots</h2><span>Complaint concentration based on complaint and resident-report records</span></div><table class="complaint-table"><thead><tr><th>#</th><th>Barangay</th><th>Complaint Volume</th><th>Case Status</th><th>High Impact</th><th>Most Common Category</th><th>Latest Complaint</th></tr></thead><tbody>${complaintHotspotRowsHtml || `<tr><td colspan="7">No complaint records for the selected filters.</td></tr>`}</tbody></table>${input.reportType === "complaints" ? `<div class="subsection-title">Complaint Record Detail</div><table class="issue-table"><thead><tr><th>#</th><th>Date</th><th>Service Area</th><th>Complaint / Severity</th><th>Status</th><th>Details</th></tr></thead><tbody>${complaintDetailRowsHtml || `<tr><td colspan="6">No complaint records for the selected filters.</td></tr>`}</tbody></table>` : ""}</section>` : ""}
    ${include("issues") ? `<section class="section"><div class="section-head"><h2>Operational Issue Register</h2><span>Resident, driver, complaint, and report issue records</span></div><table class="issue-table"><thead><tr><th>#</th><th>Date / Source</th><th>Service Area</th><th>Issue / Severity</th><th>Status</th><th>Details</th></tr></thead><tbody>${issueRowsHtml || `<tr><td colspan="6">No issues for the selected filters.</td></tr>`}</tbody></table></section>` : ""}
    ${include("schedules") ? `<section class="section"><div class="section-head"><h2>Schedule Performance & Coverage</h2><span>Current schedules compared with collection activity</span></div><table class="schedule-table"><thead><tr><th>#</th><th>Schedule / Area</th><th>Assignment</th><th>Service Activity</th><th>Completion</th><th>Assessment</th></tr></thead><tbody>${scheduleRowsHtml || `<tr><td colspan="6">No schedules for the selected filters.</td></tr>`}</tbody></table></section>` : ""}
    ${input.reportType === "complete" ? `<section class="section"><div class="section-head"><h2>Full System Administrative Control Summary</h2><span>Attendance, resident compliance, public-service infrastructure, route status, notifications, and driver report workflow</span></div><div class="capacity"><div><small>Attendance Records</small><strong>${input.fullSystemSummary.attendance.total}</strong><span>${input.fullSystemSummary.attendance.late} late • ${input.fullSystemSummary.attendance.incomplete} incomplete</span></div><div><small>Compliance Cases</small><strong>${input.fullSystemSummary.compliance.total}</strong><span>${input.fullSystemSummary.compliance.open} unresolved</span></div><div><small>Active Waste Points</small><strong>${input.fullSystemSummary.wastePoints.active}</strong><span>${input.fullSystemSummary.wastePoints.inactive} inactive</span></div><div><small>Pending Driver Reports</small><strong>${input.fullSystemSummary.activityReports.pending}</strong><span>${input.fullSystemSummary.activityReports.generatedReports} generated reports</span></div></div><div class="capacity"><div><small>Route Status Updates</small><strong>${input.fullSystemSummary.routeUpdates.total}</strong><span>${input.fullSystemSummary.routeUpdates.problem} needs review</span></div><div><small>Notifications</small><strong>${input.fullSystemSummary.notifications.total}</strong><span>${input.fullSystemSummary.notifications.unread} unread</span></div><div><small>Resident Alerts</small><strong>${input.fullSystemSummary.notifications.resident}</strong><span>Recorded recipient activity</span></div><div><small>Driver Alerts</small><strong>${input.fullSystemSummary.notifications.driver}</strong><span>Recorded recipient activity</span></div></div></section>
    <section class="section"><div class="section-head"><h2>Resident & Service Coverage by Barangay</h2><span>Population coverage, service configuration, schedules, collections, complaints, issues, and published waste points</span></div><table><thead><tr><th>#</th><th>Barangay</th><th>Residents</th><th>Service Coverage</th><th>Collection</th><th>Complaints / Issues</th><th>Waste Points</th><th>Assessment</th></tr></thead><tbody>${residentCoverageRowsHtml || `<tr><td colspan="8">No Barangay coverage data for the selected scope.</td></tr>`}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Driver Attendance & Duty Verification</h2><span>Recorded duty attendance, assignment, service area, time-in/time-out completeness, and status</span></div><table><thead><tr><th>#</th><th>Date</th><th>Driver / Vehicle</th><th>Schedule / Route</th><th>Service Area</th><th>Time In / Out</th><th>Duty / Status</th></tr></thead><tbody>${attendanceRowsHtml || `<tr><td colspan="7">No driver attendance records match the selected period.</td></tr>`}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Resident Compliance Register</h2><span>Violation, penalty, status, and unresolved resident compliance records</span></div><table><thead><tr><th>#</th><th>Date</th><th>Resident</th><th>Violation / Penalty</th><th>Status</th><th>Notes</th></tr></thead><tbody>${violationRowsHtml || `<tr><td colspan="6">No resident compliance records match the selected period.</td></tr>`}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Official Waste Drop-off Points</h2><span>Published public-service locations and their current operational visibility</span></div><table><thead><tr><th>#</th><th>Point</th><th>Barangay / Landmark</th><th>Instructions</th><th>Status</th><th>Last Update</th></tr></thead><tbody>${wastePointRowsHtml || `<tr><td colspan="6">No waste drop-off points match the selected scope.</td></tr>`}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Route Field Status Updates</h2><span>Driver-submitted or system-recorded field updates requiring operational awareness</span></div><table><thead><tr><th>#</th><th>Time</th><th>Driver</th><th>Route / Stop</th><th>Status</th><th>Notes</th></tr></thead><tbody>${routeStatusRowsHtml || `<tr><td colspan="6">No route-status updates match the selected period.</td></tr>`}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Driver Activity Report Workflow</h2><span>Requested reports, processing status, delivery status, and outstanding administrative work</span></div><table><thead><tr><th>#</th><th>Requested</th><th>Driver</th><th>Reporting Period</th><th>Status / Updated</th><th>Administrative Meaning</th></tr></thead><tbody>${activityRequestRowsHtml || `<tr><td colspan="6">No driver activity-report requests match the selected period.</td></tr>`}</tbody></table></section>` : ""}
    ${include("gps") ? `<section class="section"><div class="section-head"><h2>GPS Collection Activity</h2><span>Actual recorded GPS routes on map • green start • red end</span></div><div class="gps-grid">${gpsHtml || `<div class="gps-empty">No GPS route with at least two points matches the selected filters.</div>`}</div></section>` : ""}
    <div class="signoff"><div><span></span><strong>Prepared by</strong><small>WasteTrack System Administrator</small></div><div><span></span><strong>Reviewed by</strong><small>Operations Supervisor</small></div><div><span></span><strong>Approved by</strong><small>Authorized Agency Representative</small></div></div>
    <div class="footer"><strong>METROWASTE SOLID WASTE MANAGEMENT CORP.</strong><span>Waste management service in Catbalogan • WasteTrack Agency Operations Report • Generated from actual Firebase Realtime Database records</span></div>
  </main><script>window.onload=()=>window.setTimeout(()=>{window.focus();window.print()},300);<\/script></body></html>`);
  printWindow.document.close();
}
