"use client";

import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";

type AnyItem = Record<string, any>;
type RangeFilter = "today" | "7d" | "30d" | "90d" | "custom" | "all";
type ReportType = "complete" | "collection" | "drivers" | "capacity" | "issues" | "schedules" | "gps";
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
  puroks: string[];
  type: string;
  severity: string;
  status: string;
  details: string;
  timestamp: number;
  isOpen: boolean;
  isHighImpact: boolean;
};

type ScheduleRecord = {
  id: string;
  title: string;
  barangay: string;
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
  { value: "complete", label: "Complete System", description: "Executive, collection, drivers, trucks, issues, schedules and GPS." },
  { value: "collection", label: "Collection", description: "Barangay and Purok collection completion and follow-up." },
  { value: "drivers", label: "Driver", description: "Driver activity, completion, GPS and service coverage." },
  { value: "capacity", label: "Truck Capacity", description: "1/4, 1/2, 3/4 and Full truck operational pressure." },
  { value: "issues", label: "Issues", description: "Resident and driver operational issues and unresolved cases." },
  { value: "schedules", label: "Schedule", description: "Current schedule coverage and execution performance." },
  { value: "gps", label: "GPS Activity", description: "Actual recorded collection-session GPS route traces." },
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

function barangayText(item: AnyItem): string {
  return cleanText(
    item.barangay ??
      item.location?.barangay ??
      item.assignedBarangay ??
      item.addressBarangay ??
      item.targetBarangay ??
      item.area,
    "Unspecified Barangay",
  );
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
  const sample = points.length > 250 ? points.filter((_, index) => index % Math.ceil(points.length / 250) === 0 || index === points.length - 1) : points;
  const latitudes = sample.map((point) => point.latitude);
  const longitudes = sample.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const lngSpan = Math.max(maxLng - minLng, 0.00001);
  const pad = 18;
  const width = 360 - pad * 2;
  const height = 180 - pad * 2;
  const projected = sample.map((point) => ({
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

function routeSvgHtml(points: GpsPoint[]): string {
  const geometry = routeTraceGeometry(points);
  if (!geometry) return "<div class='gps-empty'>No GPS points available.</div>";
  return `
    <svg viewBox="0 0 360 180" class="gps-svg" role="img" aria-label="Recorded GPS collection route trace">
      <rect x="0" y="0" width="360" height="180" rx="12" fill="#f8fafc"/>
      <path d="M0 45H360M0 90H360M0 135H360M90 0V180M180 0V180M270 0V180" stroke="#e2e8f0" stroke-width="1"/>
      <path d="${geometry.path}" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${geometry.startX}" cy="${geometry.startY}" r="7" fill="#16a34a" stroke="#fff" stroke-width="3"/>
      <circle cx="${geometry.endX}" cy="${geometry.endY}" r="7" fill="#dc2626" stroke="#fff" stroke-width="3"/>
    </svg>`;
}

function RouteTrace({ points }: { points: GpsPoint[] }) {
  const geometry = routeTraceGeometry(points);
  if (!geometry) return <div className="ops-gps-empty">No GPS points available.</div>;
  return (
    <svg viewBox="0 0 360 180" className="ops-gps-svg" role="img" aria-label="Recorded GPS collection route trace">
      <rect x="0" y="0" width="360" height="180" rx="12" fill="#f8fafc" />
      <path d="M0 45H360M0 90H360M0 135H360M90 0V180M180 0V180M270 0V180" stroke="#e2e8f0" strokeWidth="1" />
      <path d={geometry.path} fill="none" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={geometry.startX} cy={geometry.startY} r="7" fill="#16a34a" stroke="#fff" strokeWidth="3" />
      <circle cx={geometry.endX} cy={geometry.endY} r="7" fill="#dc2626" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}

function reportTypeLabel(value: ReportType): string {
  return REPORT_TYPES.find((item) => item.value === value)?.label || "Complete System";
}

function reportIncludes(reportType: ReportType, section: Exclude<ReportType, "complete">): boolean {
  return reportType === "complete" || reportType === section;
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
  const [routeSessions, setRouteSessions] = useState<AnyItem[]>([]);
  const [activeRouteSessions, setActiveRouteSessions] = useState<AnyItem[]>([]);
  const [driverLocations, setDriverLocations] = useState<AnyItem[]>([]);
  const [gpsRaw, setGpsRaw] = useState<unknown>({});
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
    ...normalizedCollections.map((item) => item.barangay),
    ...normalizedIssues.map((item) => item.barangay),
    ...normalizedSchedules.map((item) => item.barangay),
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
    if (barangayFilter !== "all" && item.barangay !== barangayFilter) return false;
    if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
    if (truckFilter !== "all" && item.truckId !== truckFilter) return false;
    return true;
  }), [normalizedCollections, bounds, barangayFilter, driverFilter, truckFilter]);

  const filteredIssues = useMemo(() => normalizedIssues.filter((item) => {
    const dateMatch = item.timestamp ? timestampInBounds(item.timestamp, bounds) : item.isOpen;
    if (!dateMatch) return false;
    if (barangayFilter !== "all" && item.barangay !== barangayFilter) return false;
    if (driverFilter !== "all" && item.driverId && item.driverId !== driverFilter) return false;
    return true;
  }), [normalizedIssues, bounds, barangayFilter, driverFilter]);

  const filteredSchedules = useMemo(() => normalizedSchedules.filter((item) => {
    if (["cancelled", "inactive", "deleted"].includes(item.status)) return false;
    if (barangayFilter !== "all" && item.barangay !== barangayFilter) return false;
    if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
    if (truckFilter !== "all" && item.truckId !== truckFilter) return false;
    return true;
  }), [normalizedSchedules, barangayFilter, driverFilter, truckFilter]);

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

  const buildAreaRows = (scope: "barangay" | "purok"): AreaRow[] => {
    const keys = new Map<string, { barangay: string; purok: string }>();

    const register = (barangay: string, purok = "") => {
      const safeBarangay = barangay || "Unspecified Barangay";
      const safePurok = scope === "purok" ? (purok || "Unspecified Purok") : "";
      const key = scope === "barangay" ? safeBarangay : `${safeBarangay}::${safePurok}`;
      if (!keys.has(key)) keys.set(key, { barangay: safeBarangay, purok: safePurok });
    };

    filteredCollections.forEach((item) => {
      if (scope === "barangay") register(item.barangay);
      else {
        const targets = item.assignedPuroks.length > 0 ? item.assignedPuroks : item.claimedPuroks.length > 0 ? item.claimedPuroks : ["Unspecified Purok"];
        targets.forEach((purok) => register(item.barangay, purok));
      }
    });
    filteredIssues.forEach((item) => {
      if (scope === "barangay") register(item.barangay);
      else (item.puroks.length > 0 ? item.puroks : ["Unspecified Purok"]).forEach((purok) => register(item.barangay, purok));
    });
    filteredSchedules.forEach((item) => {
      if (scope === "barangay") register(item.barangay);
      else (item.puroks.length > 0 ? item.puroks : ["Unspecified Purok"]).forEach((purok) => register(item.barangay, purok));
    });

    return Array.from(keys.entries()).map(([key, area]) => {
      const collectionMatches = filteredCollections.filter((item) => {
        if (item.barangay !== area.barangay) return false;
        if (!area.purok) return true;
        const allPuroks = unique([...item.assignedPuroks, ...item.claimedPuroks, ...item.unclaimedPuroks]);
        return allPuroks.length === 0 || allPuroks.includes(area.purok);
      });
      const issueMatches = filteredIssues.filter((item) => {
        if (item.barangay !== area.barangay) return false;
        if (!area.purok) return true;
        return item.puroks.length === 0 || item.puroks.includes(area.purok);
      });
      const scheduleMatches = filteredSchedules.filter((item) => {
        if (item.barangay !== area.barangay) return false;
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
    if (summary.gpsVerificationRate < 80 && summary.totalTrips > 0) actions.push(`GPS verification is ${formatPercent(summary.gpsVerificationRate)}. Review trips without sufficient recorded GPS points before treating them as fully verified field activity.`);
    if (actions.length === 0) actions.push("Maintain the current operating plan and continue monitoring completion, capacity, GPS verification, issues, and schedule coverage.");
    return unique(actions).slice(0, 6);
  }, [barangayRows, summary]);

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
    <section className="ops-report-shell" aria-label="WasteTrack operations report generator">
      <div className="ops-hero">
        <div className="ops-hero-copy">
          <div className="ops-kicker"><span className="ops-live-dot" /> WASTETRACK • METRO WASTE</div>
          <h2>Operations Intelligence & Reporting</h2>
          <p>
            Generate management-ready reports from the records WasteTrack actually captures: collection completion,
            truck load, collected and uncollected Puroks, GPS activity, driver operations, issues, and schedule coverage.
          </p>
          <div className="ops-source-chips">
            <span><SourceIcon kind="database" />Realtime Database</span>
            <span><SourceIcon kind="cloudOff" />No Firebase Storage</span>
            <span><SourceIcon kind="shield" />Operational data only</span>
          </div>
        </div>
        <div className="ops-hero-actions">
          <button type="button" className="ops-primary" onClick={generateReport}>
            <ActionIcon kind="report" />
            Generate Operations Report
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
            <span>REPORT CONFIGURATION</span>
            <strong>Choose the management view you need</strong>
          </div>
          <div className="ops-updated">Last realtime update <b>{formatDateTime(lastUpdated)}</b></div>
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
              <div className="ops-kicker">GENERATED OPERATIONS REPORT</div>
              <h3>{reportTypeLabel(reportType)} Report</h3>
              <p>{reportSubtitle}</p>
            </div>
            <div className="ops-report-meta">
              <span>Generated</span>
              <strong>{formatDateTime(generatedAt)}</strong>
            </div>
          </header>

          <div className="ops-basis-note">
            <div className="ops-basis-icon">i</div>
            <div>
              <strong>Truck capacity measurement</strong>
              <p>
                WasteTrack does not measure collected waste in kilograms. At the end of each collection, the driver
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
            <div><strong>WasteTrack Operations Report</strong><span>Generated from Firebase Realtime Database operational records.</span></div>
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
}) {
  const printWindow = window.open("", "_blank", "width=1400,height=900");
  if (!printWindow) {
    window.alert("The print window was blocked. Allow pop-ups for this site and try again.");
    return;
  }

  const areaRowsHtml = (rows: AreaRow[], scope: "barangay" | "purok") => rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(row.barangay)}</strong>${scope === "purok" ? `<br/><span>${escapeHtml(row.purok)}</span>` : ""}</td>
      <td>${row.trips}</td><td>${row.completed}</td><td>${row.partial + row.missed}</td><td>${escapeHtml(formatPercent(row.completionRate))}</td>
      <td>${row.averageLoad === null ? "—" : escapeHtml(formatPercent(row.averageLoad))}</td><td>${row.fullTruckEvents}</td><td>${row.openIssues}</td><td>${row.activeSchedules}</td><td>${row.gpsTrips}/${row.trips}</td>
      <td><span class="pill ${row.priority.toLowerCase()}">${escapeHtml(row.priority)}</span></td>
      <td>${escapeHtml(row.reasons.join("; "))}<br/><span>${escapeHtml(row.recommendation)}</span></td>
    </tr>`).join("");

  const driverRowsHtml = input.driverRows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.driverName)}</strong><br/><span>${escapeHtml(row.barangays.join(", "))}</span></td><td>${escapeHtml(row.currentStatus)}${row.activeScheduleId ? `<br/><span>Schedule ${escapeHtml(row.activeScheduleId)}</span>` : ""}</td><td>${escapeHtml(row.trucks.join(", ") || "—")}</td><td>${row.lastGpsAt > 0 ? escapeHtml(formatDateTime(row.lastGpsAt)) : "—"}</td><td>${row.trips}</td><td>${row.completed}</td><td>${row.partial + row.missed}</td><td>${escapeHtml(formatPercent(row.completionRate))}</td><td>${row.averageLoad === null ? "—" : escapeHtml(formatPercent(row.averageLoad))}</td><td>${row.fullTruckEvents}</td><td>${row.gpsTrips}</td><td>${escapeHtml(formatDistance(row.distanceMeters))}</td><td>${row.openIssues}</td><td>${escapeHtml(row.assessment)}</td></tr>`).join("");

  const truckRowsHtml = input.truckRows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.truckId)}</strong></td><td>${row.trips}</td><td>${row.completed}</td><td>${row.partial}</td><td>${row.averageLoad === null ? "—" : escapeHtml(formatPercent(row.averageLoad))}</td><td>${row.fullTruckEvents}</td><td>${escapeHtml(row.barangays.join(", "))}</td><td>${escapeHtml(row.drivers.join(", "))}</td><td>${escapeHtml(formatDistance(row.distanceMeters))}</td><td>${escapeHtml(row.assessment)}</td></tr>`).join("");

  const issueRowsHtml = input.issueRows.slice(0, 100).map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(formatDateTime(row.timestamp))}</td><td>${escapeHtml(row.source)}</td><td><strong>${escapeHtml(row.barangay)}</strong><br/><span>${escapeHtml(row.puroks.join(", "))}</span></td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.severity)}</td><td>${escapeHtml(row.isOpen ? "Open" : "Resolved")}</td><td>${escapeHtml(row.details || "—")}</td></tr>`).join("");

  const scheduleRowsHtml = input.scheduleRows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.title)}</strong></td><td>${escapeHtml(row.barangay)}<br/><span>${escapeHtml(row.puroks.join(", ") || "All / unspecified Puroks")}</span></td><td>${escapeHtml(row.driverName)}</td><td>${escapeHtml(row.truckId)}</td><td>${escapeHtml(row.status)}</td><td>${row.trips}</td><td>${row.completed}</td><td>${row.partial}</td><td>${escapeHtml(formatPercent(row.completionRate))}</td><td>${escapeHtml(formatDateTime(row.lastActivity))}</td><td>${escapeHtml(row.assessment)}</td></tr>`).join("");

  const gpsHtml = input.gpsCards.slice(0, 20).map(({ collection, trace }, index) => `<div class="gps-card"><div class="gps-index">${index + 1}</div>${routeSvgHtml(trace.points)}<div class="gps-info"><strong>${escapeHtml(collection.routeName)}</strong><span>${escapeHtml(collection.barangay)} • ${escapeHtml(collection.driverName)} • ${escapeHtml(collection.truckId)}</span><span>${escapeHtml(formatDateTime(collection.timestamp))} • ${trace.points.length} points • ${escapeHtml(formatDistance(collection.distanceMeters))} • ${escapeHtml(formatDuration(collection.durationSeconds))}</span></div></div>`).join("");

  const actionsHtml = input.managementActions.map((action, index) => `<li><b>${index + 1}</b><span>${escapeHtml(action)}</span></li>`).join("");
  const include = (section: Exclude<ReportType, "complete">) => input.reportType === "complete" || input.reportType === section;

  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>WasteTrack Operations Report</title><style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#0f172a;background:#fff;font-size:9px}.page{padding:18mm 12mm}.head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #047857;padding-bottom:12px}.brand{font-size:8px;font-weight:900;letter-spacing:.12em;color:#047857}.head h1{margin:5px 0 4px;font-size:24px;letter-spacing:-.03em}.head p{margin:0;color:#64748b;line-height:1.45}.meta{text-align:right;color:#64748b}.meta strong{display:block;color:#0f172a;margin-top:3px}.basis{margin:11px 0;padding:10px 12px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;line-height:1.5}.basis strong{color:#1e40af}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:11px 0}.kpi{border:1px solid #e2e8f0;border-radius:8px;padding:9px;background:#f8fafc}.kpi small,.kpi strong,.kpi span{display:block}.kpi small{font-size:6px;font-weight:900;text-transform:uppercase;color:#64748b}.kpi strong{font-size:15px;margin:3px 0}.kpi span{font-size:6.5px;color:#64748b}.section{margin-top:15px;page-break-inside:auto}.section-head{display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid #cbd5e1;padding-bottom:5px;margin-bottom:7px}.section-head h2{margin:0;font-size:14px}.section-head span{color:#64748b;font-size:7px}.actions{background:#f0fdf4;border-left:4px solid #059669;padding:9px 11px;border-radius:6px}.actions ol{margin:0;padding:0;list-style:none;display:grid;gap:4px}.actions li{display:flex;gap:7px;line-height:1.45}.actions b{display:grid;place-items:center;flex:0 0 16px;height:16px;border-radius:5px;background:#047857;color:white;font-size:7px}table{width:100%;border-collapse:collapse;font-size:6.7px}th,td{border:1px solid #dbe3ea;padding:5px;text-align:left;vertical-align:top}th{background:#f1f5f9;color:#475569;font-size:5.8px;text-transform:uppercase}td span{color:#64748b}.pill{display:inline-block;border-radius:999px;padding:3px 5px;font-size:5.8px;font-weight:900}.pill.critical{background:#fee2e2;color:#b91c1c}.pill.high{background:#ffedd5;color:#c2410c}.pill.monitor{background:#dbeafe;color:#1d4ed8}.pill.stable{background:#dcfce7;color:#166534}.capacity{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:8px}.capacity div{border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#f8fafc}.capacity small,.capacity strong{display:block}.capacity small{color:#64748b}.capacity strong{font-size:15px;margin-top:3px}.gps-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.gps-card{position:relative;border:1px solid #dbe3ea;border-radius:8px;overflow:hidden;page-break-inside:avoid}.gps-index{position:absolute;z-index:2;left:7px;top:7px;width:18px;height:18px;border-radius:6px;background:#0f172a;color:#fff;display:grid;place-items:center;font-weight:900}.gps-svg{display:block;width:100%;height:125px}.gps-info{display:grid;gap:2px;padding:7px}.gps-info strong{font-size:8px}.gps-info span{color:#64748b;font-size:6.3px}.gps-empty{padding:20px;text-align:center}.signoff{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:30px}.signoff div{border-top:1px solid #0f172a;padding-top:5px;text-align:center;color:#64748b}.footer{margin-top:14px;padding-top:7px;border-top:1px solid #e2e8f0;color:#64748b;font-size:6px}
    /* Print readability: keep report text at 12px minimum */
    body{font-size:12px;line-height:1.45;color:#111827}
    .page{padding:10mm 8mm}
    .brand{font-size:12px}
    .head h1{font-size:28px}
    .head p,.meta,.meta strong{font-size:12px;line-height:1.45}
    .basis,.basis strong{font-size:12px;line-height:1.55}
    .kpi{padding:10px}
    .kpi small,.kpi span{font-size:12px;line-height:1.35}
    .kpi strong{font-size:20px}
    .section-head h2{font-size:18px}
    .section-head span{font-size:12px}
    .actions li,.actions li span,.actions b{font-size:12px;line-height:1.5}
    table{font-size:12px;line-height:1.35;table-layout:auto}
    th,td{font-size:12px;padding:5px 4px;line-height:1.35;overflow-wrap:anywhere;word-break:normal}
    th{font-size:12px;font-weight:800;background:#f1f5f9}
    td span{font-size:12px;line-height:1.35}
    .pill{font-size:12px;padding:3px 6px}
    .capacity small,.capacity strong{font-size:12px}
    .capacity strong{font-size:20px}
    .gps-info strong,.gps-info span{font-size:12px;line-height:1.4}
    .gps-index{font-size:12px;width:22px;height:22px}
    .gps-empty,.signoff div,.footer{font-size:12px;line-height:1.45}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    .gps-card{break-inside:avoid;page-break-inside:avoid}

    /* FINAL PRINT READABILITY — 14PX MINIMUM */
    body{font-size:14px;line-height:1.45}
    .brand{font-size:14px}
    .head h1{font-size:28px}
    .head p,.meta,.meta strong{font-size:14px}
    .basis,.basis strong{font-size:14px}
    .kpi small,.kpi span{font-size:14px}
    .kpi strong{font-size:22px}
    .section-head h2{font-size:20px}
    .section-head span{font-size:14px}
    .actions li,.actions li span,.actions b{font-size:14px}
    table,th,td,td span{font-size:14px;line-height:1.35}
    th{font-size:14px}
    .pill{font-size:14px;padding:4px 7px}
    .capacity small,.capacity strong{font-size:14px}
    .capacity strong{font-size:22px}
    .gps-info strong,.gps-info span{font-size:14px}
    .gps-index{font-size:14px}
    .gps-empty,.signoff div,.footer{font-size:14px}

        @page{size:A4 landscape;margin:7mm}
    @media print{
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .page{padding:3mm 1mm}
      .section{break-inside:auto}
      .gps-card{break-inside:avoid}
    }
  </style></head><body><div class="page">
    <div class="head"><div><div class="brand">WASTETRACK • METRO WASTE</div><h1>${escapeHtml(reportTypeLabel(input.reportType))} Operations Report</h1><p>${escapeHtml(input.subtitle)}</p></div><div class="meta">Generated<strong>${escapeHtml(formatDateTime(input.generatedAt))}</strong>Last realtime update<strong>${escapeHtml(formatDateTime(input.lastUpdated))}</strong></div></div>
    <div class="basis"><strong>Truck capacity measurement.</strong> WasteTrack does not measure collected waste in kilograms. Drivers estimate truck capacity as 1/4 (25%), 1/2 (50%), 3/4 (75%), or Full (100%) at collection completion. These operational capacity estimates are used with collection completion, uncollected Puroks, GPS route history, issues, and schedules.</div>
    <div class="kpis"><div class="kpi"><small>Collection Runs</small><strong>${input.summary.totalTrips}</strong><span>Recorded collection sessions</span></div><div class="kpi"><small>Fully Completed</small><strong>${input.summary.completedTrips}</strong><span>${escapeHtml(formatPercent(input.summary.completionRate))} completion rate</span></div><div class="kpi"><small>Follow-up Runs</small><strong>${input.summary.partialTrips + input.summary.missedTrips}</strong><span>${input.summary.followUpPuroks} uncollected Puroks</span></div><div class="kpi"><small>Estimated Truck Load</small><strong>${input.summary.averageTruckLoad === null ? "—" : escapeHtml(formatPercent(input.summary.averageTruckLoad))}</strong><span>${input.summary.truckFullEvents} full-truck event${input.summary.truckFullEvents === 1 ? "" : "s"}</span></div><div class="kpi"><small>Open Issues</small><strong>${input.summary.openIssues}</strong><span>Operational follow-up</span></div><div class="kpi"><small>Active Schedules</small><strong>${input.summary.activeSchedules}</strong><span>${input.summary.trackingDrivers} tracking now • ${input.summary.onlineDrivers} online</span></div><div class="kpi"><small>GPS Verified</small><strong>${input.summary.gpsVerifiedTrips}</strong><span>${escapeHtml(formatPercent(input.summary.gpsVerificationRate))} of runs</span></div><div class="kpi"><small>GPS Distance</small><strong>${escapeHtml(formatDistance(input.summary.totalDistanceMeters))}</strong><span>${escapeHtml(formatDuration(input.summary.totalDurationSeconds))} activity time</span></div></div>
    <div class="section"><div class="section-head"><h2>Executive Management Actions</h2><span>Operational decision support</span></div><div class="actions"><ol>${actionsHtml}</ol></div></div>
    ${include("collection") ? `<div class="section"><div class="section-head"><h2>Barangay Operational Performance</h2><span>Collection completion, capacity, issues and GPS</span></div><table><thead><tr><th>#</th><th>Barangay</th><th>Runs</th><th>Completed</th><th>Follow-up</th><th>Completion</th><th>Avg Est. Load</th><th>Full Truck</th><th>Open Issues</th><th>Schedules</th><th>GPS</th><th>Priority</th><th>Recommendation</th></tr></thead><tbody>${areaRowsHtml(input.barangayRows,"barangay") || `<tr><td colspan="13">No data.</td></tr>`}</tbody></table></div><div class="section"><div class="section-head"><h2>Purok Operational Performance</h2><span>Detailed service-area follow-up</span></div><table><thead><tr><th>#</th><th>Barangay / Purok</th><th>Runs</th><th>Completed</th><th>Follow-up</th><th>Completion</th><th>Avg Est. Load</th><th>Full Truck</th><th>Open Issues</th><th>Schedules</th><th>GPS</th><th>Priority</th><th>Recommendation</th></tr></thead><tbody>${areaRowsHtml(input.purokRows,"purok") || `<tr><td colspan="13">No data.</td></tr>`}</tbody></table></div>` : ""}
    ${include("drivers") ? `<div class="section"><div class="section-head"><h2>Driver Activity & Service Performance</h2><span>Realtime driver status + operational workload; not a disciplinary score</span></div><table><thead><tr><th>#</th><th>Driver</th><th>Live Status</th><th>Truck</th><th>Last GPS</th><th>Runs</th><th>Completed</th><th>Partial/Missed</th><th>Completion</th><th>Avg Est. Load</th><th>Full Truck</th><th>GPS</th><th>Distance</th><th>Open Issues</th><th>Assessment</th></tr></thead><tbody>${driverRowsHtml || `<tr><td colspan="15">No driver data.</td></tr>`}</tbody></table></div>` : ""}
    ${include("capacity") ? `<div class="section"><div class="section-head"><h2>Truck Capacity Utilization</h2><span>Driver-estimated truck capacity • 1/4, 1/2, 3/4, Full</span></div><div class="capacity"><div><small>1/4 Truck</small><strong>${input.capacityDistribution.quarter}</strong></div><div><small>1/2 Truck</small><strong>${input.capacityDistribution.half}</strong></div><div><small>3/4 Truck</small><strong>${input.capacityDistribution.threeQuarter}</strong></div><div><small>Full Truck</small><strong>${input.capacityDistribution.full}</strong></div></div><table><thead><tr><th>#</th><th>Truck</th><th>Runs</th><th>Completed</th><th>Partial</th><th>Avg Est. Load</th><th>Full Events</th><th>Barangays</th><th>Drivers</th><th>Distance</th><th>Assessment</th></tr></thead><tbody>${truckRowsHtml || `<tr><td colspan="11">No truck data.</td></tr>`}</tbody></table></div>` : ""}
    ${include("issues") ? `<div class="section"><div class="section-head"><h2>Operational Issue Register</h2><span>Driver, resident and complaint records</span></div><table><thead><tr><th>#</th><th>Date</th><th>Source</th><th>Area</th><th>Issue</th><th>Severity</th><th>Status</th><th>Details</th></tr></thead><tbody>${issueRowsHtml || `<tr><td colspan="8">No issues.</td></tr>`}</tbody></table></div>` : ""}
    ${include("schedules") ? `<div class="section"><div class="section-head"><h2>Schedule Performance & Coverage</h2><span>Current schedules versus selected-period collection activity</span></div><table><thead><tr><th>#</th><th>Schedule</th><th>Service Area</th><th>Driver</th><th>Truck</th><th>Status</th><th>Runs</th><th>Completed</th><th>Partial</th><th>Completion</th><th>Last Activity</th><th>Assessment</th></tr></thead><tbody>${scheduleRowsHtml || `<tr><td colspan="12">No schedules.</td></tr>`}</tbody></table></div>` : ""}
    ${include("gps") ? `<div class="section"><div class="section-head"><h2>GPS Collection Activity</h2><span>Actual route traces from Realtime Database • Green start • Red end</span></div><div class="gps-grid">${gpsHtml || `<div class="gps-empty">No GPS route with at least two points matches the selected filters.</div>`}</div></div>` : ""}
    <div class="signoff"><div>Prepared / Reviewed by</div><div>Metro Waste Authorized Representative</div></div><div class="footer">WasteTrack Operations Report • Generated from Firebase Realtime Database • No Firebase Storage required for this report.</div>
  </div><script>window.onload=()=>window.setTimeout(()=>{window.focus();window.print()},350);<\/script></body></html>`);
  printWindow.document.close();
}