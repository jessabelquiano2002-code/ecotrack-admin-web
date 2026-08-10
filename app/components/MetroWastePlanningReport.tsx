"use client";

import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";

type AnyItem = Record<string, any>;
type RangeFilter = "7d" | "30d" | "90d" | "all";
type PlanningScope = "barangay" | "purok";
type PlanningPriority = "High" | "Medium" | "Monitor" | "Stable";

type CollectionSignal = {
  id: string;
  source: string;
  barangay: string;
  puroks: string[];
  purokLabel: string;
  status: string;
  timestamp: number;
  wasteKg: number | null;
  truckLoadPercent: number | null;
  collectionCondition: string;
};

type IssueSignal = {
  id: string;
  barangay: string;
  puroks: string[];
  purokLabel: string;
  status: string;
  timestamp: number;
  issueType: string;
  severity: string;
  impactScore: number;
};

type ScheduleSignal = {
  id: string;
  barangay: string;
  puroks: string[];
  purokLabel: string;
  status: string;
  timestamp: number;
};

type PlanningArea = {
  key: string;
  barangay: string;
  purok: string;
  collections: number;
  completed: number;
  missed: number;
  pending: number;
  issues: number;
  openIssues: number;
  activeSchedules: number;
  measuredWasteKg: number;
  wasteMeasurements: number;
  highImpactIssues: number;
  capacityPressureEvents: number;
  demandScore: number;
  priority: PlanningPriority;
  recommendedAdditionalSchedules: number;
  recommendation: string;
  reasons: string[];
};

type PlanningReport = {
  barangays: PlanningArea[];
  puroks: PlanningArea[];
  hasWasteMeasurements: boolean;
  totalMeasuredWasteKg: number;
  highPriorityPuroks: number;
  suggestedExtraSlots: number;
  highImpactIssues: number;
  capacityPressureEvents: number;
};

function toArray(data: unknown): AnyItem[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter(Boolean).map((item, index) => ({
      id: item?.id || String(index),
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

function bestTimestamp(item: AnyItem) {
  return normalizeTimestamp(
    item.timestamp ??
      item.createdAt ??
      item.updatedAt ??
      item.completedAt ??
      item.reportedAt ??
      item.submittedAt ??
      item.dateTime ??
      item.date,
  );
}

function cleanText(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return fallback;
  return text;
}

function barangayText(item: AnyItem) {
  return cleanText(
    item.barangay ??
      item.location?.barangay ??
      item.assignedBarangay ??
      item.addressBarangay ??
      item.area ??
      item.targetBarangay,
    "No barangay",
  );
}

function normalizeTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item === true) return key;
        if (typeof item === "string" || typeof item === "number") return String(item);
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,;|]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value === null || value === undefined ? [] : [String(value).trim()].filter(Boolean);
}

function normalizePurok(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/all\s*purok/i.test(raw)) return "All Puroks";
  const number = raw.match(/\d+/)?.[0];
  return number ? `Purok ${Number(number)}` : raw;
}

function purokList(item: AnyItem) {
  const direct = item.assignedPuroks ?? item.puroks ?? item.location?.puroks;
  const values = normalizeTextArray(direct).map(normalizePurok).filter(Boolean);
  if (values.length > 0) return Array.from(new Set(values));

  const single = normalizePurok(
    item.purokLabel ?? item.location?.purokLabel ?? item.purok ?? item.purokName ?? item.zone,
  );
  return single && single !== "All Puroks" ? [single] : [];
}

function purokText(item: AnyItem) {
  const values = purokList(item);
  if (values.length > 0) return values.join(", ");
  return cleanText(item.purok ?? item.purokLabel ?? item.purokName ?? item.zone, "All Puroks");
}

function normalizeStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "pending";
  if (status.includes("complete") || status === "done" || status === "finished" || status === "collected") return "completed";
  if (status.includes("resolve") || status.includes("closed") || status.includes("fixed")) return "resolved";
  if (status.includes("miss") || status.includes("failed") || status.includes("not collected")) return "missed";
  if (status.includes("cancel") || status.includes("inactive") || status.includes("deleted")) return "cancelled";
  if (status.includes("progress") || status.includes("ongoing") || status.includes("active") || status.includes("assigned")) return "in progress";
  if (status.includes("open") || status.includes("new")) return "open";
  return status;
}

function explicitWasteKg(item: AnyItem): number | null {
  // Only fields whose names explicitly state kilograms are used. We intentionally
  // do not treat generic "weight" or collection counts as kilograms.
  const candidates = [
    item.wasteKg,
    item.weightKg,
    item.wasteWeightKg,
    item.collectedWeightKg,
    item.collectionWeightKg,
    item.totalWasteKg,
    item.totalWeightKg,
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

function explicitTruckLoadPercent(item: AnyItem): number | null {
  const candidates = [
    item.truckLoadPercent,
    item.loadPercent,
    item.vehicleLoadPercent,
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) return numeric;
  }
  return null;
}

function issueImpactScore(item: AnyItem): number {
  const explicit = Number(item.agencyImpactScore);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(10, explicit);

  const severity = String(item.severity || item.priority || "").toLowerCase();
  if (severity.includes("critical")) return 9;
  if (severity.includes("high")) return 7;
  if (severity.includes("moderate") || severity.includes("medium")) return 4;

  const issue = String(item.issueType || item.type || item.category || "").toLowerCase();
  if (issue.includes("breakdown") || issue.includes("accident") || issue.includes("hazard")) return 9;
  if (issue.includes("overflow") || issue.includes("missed") || issue.includes("illegal dumping")) return 7;
  return 2;
}

function isCapacityPressure(item: CollectionSignal) {
  const condition = item.collectionCondition.toLowerCase();
  return (item.truckLoadPercent !== null && item.truckLoadPercent >= 90)
    || condition.includes("heavy")
    || condition.includes("overflow")
    || condition.includes("extra trip")
    || condition.includes("capacity");
}

function rangeStart(range: RangeFilter) {
  if (range === "all") return 0;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function rangeLabel(range: RangeFilter) {
  if (range === "7d") return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  if (range === "90d") return "Last 90 days";
  return "All available records";
}

function priorityRank(priority: PlanningPriority) {
  return priority === "High" ? 4 : priority === "Medium" ? 3 : priority === "Monitor" ? 2 : 1;
}

function formatWasteKg(value: number, measurements: number) {
  if (measurements <= 0) return "Not recorded";
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(value)} kg`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: number) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MetroWastePlanningReport() {
  const [routeUpdates, setRouteUpdates] = useState<AnyItem[]>([]);
  const [collectionReports, setCollectionReports] = useState<AnyItem[]>([]);
  const [wasteCollectionReports, setWasteCollectionReports] = useState<AnyItem[]>([]);
  const [pickupRecords, setPickupRecords] = useState<AnyItem[]>([]);
  const [missedPickups, setMissedPickups] = useState<AnyItem[]>([]);
  const [residentIssues, setResidentIssues] = useState<AnyItem[]>([]);
  const [issues, setIssues] = useState<AnyItem[]>([]);
  const [reportIssues, setReportIssues] = useState<AnyItem[]>([]);
  const [complaints, setComplaints] = useState<AnyItem[]>([]);
  const [schedules, setSchedules] = useState<AnyItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [range, setRange] = useState<RangeFilter>("30d");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [scope, setScope] = useState<PlanningScope>("barangay");
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    const listen = (path: string, setter: (items: AnyItem[]) => void) =>
      onValue(ref(db, path), (snapshot) => {
        setter(toArray(snapshot.val()));
        setLastUpdated(Date.now());
      });

    const unsubscribers = [
      listen("route_status_updates", setRouteUpdates),
      listen("collection_reports", setCollectionReports),
      listen("waste_collection_reports", setWasteCollectionReports),
      listen("pickup_records", setPickupRecords),
      listen("missed_pickups", setMissedPickups),
      listen("resident_issues", setResidentIssues),
      listen("issues", setIssues),
      listen("report_issues", setReportIssues),
      listen("complaints", setComplaints),
      listen("schedules", setSchedules),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const collections = useMemo<CollectionSignal[]>(() => {
    const build = (item: AnyItem, source: string, forceMissed = false): CollectionSignal => ({
      id: `${source}:${String(item.id)}`,
      source,
      barangay: barangayText(item),
      puroks: purokList(item),
      purokLabel: purokText(item),
      status: forceMissed ? "missed" : normalizeStatus(item.status ?? item.collectionStatus ?? item.pickupStatus),
      timestamp: bestTimestamp(item),
      wasteKg: explicitWasteKg(item),
      truckLoadPercent: explicitTruckLoadPercent(item),
      collectionCondition: cleanText(item.collectionCondition ?? item.fieldCondition, ""),
    });

    return [
      ...routeUpdates.map((item) => build(item, "Driver Update")),
      ...collectionReports.map((item) => build(item, "Collection Report")),
      ...wasteCollectionReports.map((item) => build(item, "Waste Collection Report")),
      ...pickupRecords.map((item) => build(item, "Pickup Record")),
      ...missedPickups.map((item) => build(item, "Missed Pickup", true)),
    ];
  }, [routeUpdates, collectionReports, wasteCollectionReports, pickupRecords, missedPickups]);

  const issueSignals = useMemo<IssueSignal[]>(() => {
    const build = (item: AnyItem, source: string): IssueSignal => ({
      id: `${source}:${String(item.id)}`,
      barangay: barangayText(item),
      puroks: purokList(item),
      purokLabel: purokText(item),
      status: normalizeStatus(item.status ?? item.issueStatus ?? "open"),
      timestamp: bestTimestamp(item),
      issueType: cleanText(item.issueType ?? item.type ?? item.category, "General issue"),
      severity: cleanText(item.severity ?? item.priority, "Normal"),
      impactScore: issueImpactScore(item),
    });

    return [
      ...residentIssues.map((item) => build(item, "resident_issues")),
      ...issues.map((item) => build(item, "issues")),
      ...reportIssues.map((item) => build(item, "report_issues")),
      ...complaints.map((item) => build(item, "complaints")),
    ];
  }, [residentIssues, issues, reportIssues, complaints]);

  const scheduleSignals = useMemo<ScheduleSignal[]>(() => schedules.map((item) => ({
    id: String(item.id),
    barangay: barangayText(item),
    puroks: purokList(item),
    purokLabel: purokText(item),
    status: normalizeStatus(item.status ?? "active"),
    timestamp: bestTimestamp(item),
  })), [schedules]);

  const barangayOptions = useMemo(() => {
    const values = new Set<string>();
    collections.forEach((item) => item.barangay !== "No barangay" && values.add(item.barangay));
    issueSignals.forEach((item) => item.barangay !== "No barangay" && values.add(item.barangay));
    scheduleSignals.forEach((item) => item.barangay !== "No barangay" && values.add(item.barangay));
    return Array.from(values).sort();
  }, [collections, issueSignals, scheduleSignals]);

  const filtered = useMemo(() => {
    const start = rangeStart(range);
    const match = (item: { timestamp: number; barangay: string }) => {
      const inRange = range === "all" || item.timestamp === 0 || item.timestamp >= start;
      const inBarangay = barangayFilter === "all" || item.barangay === barangayFilter;
      return inRange && inBarangay;
    };

    return {
      collections: collections.filter(match),
      issues: issueSignals.filter(match),
      schedules: scheduleSignals.filter(match),
    };
  }, [collections, issueSignals, scheduleSignals, range, barangayFilter]);

  const report = useMemo<PlanningReport>(() => {
    const buildRows = (planningScope: PlanningScope): PlanningArea[] => {
      type MutableRow = Omit<PlanningArea, "demandScore" | "priority" | "recommendedAdditionalSchedules" | "recommendation" | "reasons">;
      const rows = new Map<string, MutableRow>();

      const ensure = (barangayRaw: string, purokRaw = "") => {
        const barangay = barangayRaw && barangayRaw !== "No barangay" ? barangayRaw : "Unspecified";
        const purok = planningScope === "purok" ? (purokRaw || "Unspecified Purok") : "";
        const key = planningScope === "barangay" ? barangay : `${barangay}::${purok}`;

        if (!rows.has(key)) {
          rows.set(key, {
            key,
            barangay,
            purok,
            collections: 0,
            completed: 0,
            missed: 0,
            pending: 0,
            issues: 0,
            openIssues: 0,
            activeSchedules: 0,
            measuredWasteKg: 0,
            wasteMeasurements: 0,
            highImpactIssues: 0,
            capacityPressureEvents: 0,
          });
        }
        return rows.get(key)!;
      };

      filtered.collections.forEach((item) => {
        const targets = planningScope === "barangay"
          ? [""]
          : item.puroks.length > 0
            ? item.puroks
            : [item.purokLabel || "Unspecified Purok"];

        targets.forEach((purok) => {
          const row = ensure(item.barangay, purok);
          row.collections += 1;
          if (item.status === "completed") row.completed += 1;
          else if (item.status === "missed") row.missed += 1;
          else row.pending += 1;

          // Full truck weight is safe at Barangay level. At Purok level, the
          // same weight is used only if the record identifies one Purok.
          const canAttributeWaste = planningScope === "barangay" || item.puroks.length <= 1;
          if (canAttributeWaste && item.wasteKg !== null) {
            row.measuredWasteKg += item.wasteKg;
            row.wasteMeasurements += 1;
          }
          if (isCapacityPressure(item)) {
            row.capacityPressureEvents += 1;
          }
        });
      });

      filtered.issues.forEach((item) => {
        const targets = planningScope === "barangay"
          ? [""]
          : item.puroks.length > 0
            ? item.puroks
            : [item.purokLabel || "Unspecified Purok"];

        targets.forEach((purok) => {
          const row = ensure(item.barangay, purok);
          row.issues += 1;
          if (item.status !== "resolved" && item.status !== "closed") row.openIssues += 1;
          if (item.impactScore >= 7) row.highImpactIssues += 1;
        });
      });

      filtered.schedules.forEach((item) => {
        if (["cancelled", "inactive", "deleted"].includes(item.status)) return;
        const targets = planningScope === "barangay"
          ? [""]
          : item.puroks.length > 0
            ? item.puroks
            : [item.purokLabel || "Unspecified Purok"];
        targets.forEach((purok) => ensure(item.barangay, purok).activeSchedules += 1);
      });

      const baseRows = Array.from(rows.values());
      const measuredRows = baseRows.filter((row) => row.wasteMeasurements > 0).sort((a, b) => a.measuredWasteKg - b.measuredWasteKg);
      const medianWaste = measuredRows.length > 0
        ? measuredRows[Math.floor((measuredRows.length - 1) / 2)].measuredWasteKg
        : 0;
      const maxWaste = measuredRows.at(-1)?.measuredWasteKg || 0;

      return baseRows
        .map<PlanningArea>((row) => {
          const riskScore =
            row.missed * 5
            + row.openIssues * 3
            + row.highImpactIssues * 4
            + row.pending * 2
            + row.capacityPressureEvents * 3;
          const activityScore = Math.min(12, row.collections);
          const wastePressure = row.wasteMeasurements > 0 && maxWaste > 0
            ? Math.round((row.measuredWasteKg / maxWaste) * 12)
            : 0;
          const demandScore = riskScore + activityScore + wastePressure;

          const highMeasuredWaste = row.wasteMeasurements > 0
            && medianWaste > 0
            && row.measuredWasteKg >= medianWaste * 1.5;

          let extra = 0;
          if (
            row.missed >= 3
            || row.highImpactIssues >= 3
            || row.capacityPressureEvents >= 3
            || row.openIssues >= 5
            || (highMeasuredWaste && (row.missed >= 1 || row.capacityPressureEvents >= 1))
          ) {
            extra = 2;
          } else if (
            row.missed >= 1
            || row.highImpactIssues >= 1
            || row.capacityPressureEvents >= 1
            || row.openIssues >= 2
            || row.pending >= 3
            || highMeasuredWaste
          ) {
            extra = 1;
          }

          let priority: PlanningPriority = "Stable";
          if (extra >= 2 || demandScore >= 20) priority = "High";
          else if (extra === 1 || demandScore >= 12) priority = "Medium";
          else if (row.openIssues > 0 || row.pending > 0 || demandScore >= 6) priority = "Monitor";

          const reasons: string[] = [];
          if (row.wasteMeasurements > 0) reasons.push(`${formatWasteKg(row.measuredWasteKg, row.wasteMeasurements)} measured waste`);
          if (row.missed > 0) reasons.push(`${row.missed} missed pickup${row.missed === 1 ? "" : "s"}`);
          if (row.openIssues > 0) reasons.push(`${row.openIssues} open service report${row.openIssues === 1 ? "" : "s"}`);
          if (row.highImpactIssues > 0) reasons.push(`${row.highImpactIssues} high-impact issue${row.highImpactIssues === 1 ? "" : "s"}`);
          if (row.capacityPressureEvents > 0) reasons.push(`${row.capacityPressureEvents} truck-capacity / heavy-volume event${row.capacityPressureEvents === 1 ? "" : "s"}`);
          if (row.pending > 0) reasons.push(`${row.pending} pending collection record${row.pending === 1 ? "" : "s"}`);
          if (row.activeSchedules === 0) reasons.push("no active schedule recorded");
          if (reasons.length === 0) reasons.push("no current service-pressure signal");

          const area = planningScope === "barangay" ? row.barangay : `${row.barangay} — ${row.purok}`;
          const recommendation = extra > 0
            ? `Consider ${extra} additional weekly collection slot${extra === 1 ? "" : "s"} for ${area}; validate truck, staffing, and route capacity, then review results after 2–4 weeks.`
            : priority === "Monitor"
              ? `Maintain the current schedule for ${area} and monitor missed pickups and resident reports.`
              : `Maintain the current collection plan for ${area}.`;

          return {
            ...row,
            demandScore,
            priority,
            recommendedAdditionalSchedules: extra,
            recommendation,
            reasons,
          };
        })
        .sort((a, b) =>
          priorityRank(b.priority) - priorityRank(a.priority)
          || b.recommendedAdditionalSchedules - a.recommendedAdditionalSchedules
          || b.measuredWasteKg - a.measuredWasteKg
          || b.demandScore - a.demandScore,
        );
    };

    const barangays = buildRows("barangay");
    const puroks = buildRows("purok");
    const measured = filtered.collections.filter((item) => item.wasteKg !== null);

    return {
      barangays,
      puroks,
      hasWasteMeasurements: measured.length > 0,
      totalMeasuredWasteKg: measured.reduce((sum, item) => sum + (item.wasteKg || 0), 0),
      highPriorityPuroks: puroks.filter((item) => item.priority === "High").length,
      suggestedExtraSlots: puroks.reduce((sum, item) => sum + item.recommendedAdditionalSchedules, 0),
      highImpactIssues: puroks.reduce((sum, item) => sum + item.highImpactIssues, 0),
      capacityPressureEvents: puroks.reduce((sum, item) => sum + item.capacityPressureEvents, 0),
    };
  }, [filtered]);

  const rows = scope === "barangay" ? report.barangays : report.puroks;
  const topArea = rows[0];

  const planSchedule = (row: PlanningArea) => {
    const params = new URLSearchParams({
      source: "agency-report",
      barangay: row.barangay,
      recommendedSlots: String(Math.max(1, row.recommendedAdditionalSchedules)),
    });
    if (scope === "purok" && row.purok && !/unspecified/i.test(row.purok)) params.set("purok", row.purok);
    window.location.href = `/schedules?${params.toString()}`;
  };

  return (
    <section className="mwpr-shell" aria-label="Metro Waste planning report">
      <div className="mwpr-head">
        <div>
          <span>Decision Support for Metro Waste</span>
          <h2>Waste Collection Planning & Schedule Recommendation Report</h2>
          <p>
            Turn verified collection weight, truck-capacity pressure, GPS-completed collections, resident reports, driver operational issues, and active schedules into a printable action report for Metro Waste.
          </p>
        </div>
        <div className="mwpr-actions">
          <button type="button" className="mwpr-generate" onClick={() => setGenerated((current) => !current)}>
            {generated ? "Hide Report" : "Generate Agency Report"}
          </button>
          <button
            type="button"
            className="mwpr-print"
            disabled={!generated || report.barangays.length === 0}
            onClick={() => printMetroWasteReport(report, range, barangayFilter, lastUpdated)}
          >
            Print Report
          </button>
        </div>
      </div>

      <div className="mwpr-controls">
        <label>
          Report period
          <select value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All records</option>
          </select>
        </label>
        <label>
          Barangay
          <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)}>
            <option value="all">All barangays</option>
            {barangayOptions.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
          </select>
        </label>
        <div className="mwpr-control-note">
          <strong>Last updated</strong>
          <span>{formatDateTime(lastUpdated)}</span>
        </div>
      </div>

      {generated && (
        <div className="mwpr-report">
          <div className={`mwpr-data-note ${report.hasWasteMeasurements ? "ok" : "warn"}`}>
            <strong>{report.hasWasteMeasurements ? "Verified waste-weight data detected" : "Data-quality note"}</strong>
            <p>
              {report.hasWasteMeasurements
                ? `Explicit kilogram fields were found. Total measured waste in this report view is ${formatWasteKg(report.totalMeasuredWasteKg, 1)}.`
                : "The current project data does not contain a verified waste-weight field in kilograms. This report therefore identifies highest operational demand—not the literal highest waste tonnage. Add a wasteKg field at collection completion to make true 'most waste' ranking possible."}
            </p>
          </div>

          <div className="mwpr-summary">
            <article><small>High-priority Puroks</small><strong>{report.highPriorityPuroks}</strong></article>
            <article><small>Suggested extra weekly slots</small><strong>{report.suggestedExtraSlots}</strong></article>
            <article><small>Measured waste</small><strong>{report.hasWasteMeasurements ? formatWasteKg(report.totalMeasuredWasteKg, 1) : "Not recorded"}</strong></article>
            <article><small>High-impact issues</small><strong>{report.highImpactIssues}</strong></article>
            <article><small>Capacity pressure events</small><strong>{report.capacityPressureEvents}</strong></article>
            <article><small>Top current priority</small><strong>{topArea ? (scope === "barangay" ? topArea.barangay : `${topArea.barangay} / ${topArea.purok}`) : "No data"}</strong></article>
          </div>

          <div className="mwpr-toolbar">
            <div className="mwpr-tabs">
              <button type="button" className={scope === "barangay" ? "active" : ""} onClick={() => setScope("barangay")}>Barangay priorities</button>
              <button type="button" className={scope === "purok" ? "active" : ""} onClick={() => setScope("purok")}>Purok priorities</button>
            </div>
            <span>{rows.length} area{rows.length === 1 ? "" : "s"} analyzed • {rangeLabel(range)}</span>
          </div>

          {rows.length === 0 ? (
            <div className="mwpr-empty">No records are available for this report selection.</div>
          ) : (
            <div className="mwpr-table-wrap">
              <table className="mwpr-table">
                <thead>
                  <tr>
                    <th>Priority Area</th>
                    <th>Measured Waste</th>
                    <th>Collections</th>
                    <th>Missed</th>
                    <th>Open Reports</th>
                    <th>High-impact Issues</th>
                    <th>Capacity Pressure</th>
                    <th>Active Schedules</th>
                    <th>Priority</th>
                    <th>Recommendation</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td><strong>{row.barangay}</strong>{scope === "purok" && <small>{row.purok}</small>}</td>
                      <td><strong>{formatWasteKg(row.measuredWasteKg, row.wasteMeasurements)}</strong>{row.wasteMeasurements > 0 && <small>{row.wasteMeasurements} measured record{row.wasteMeasurements === 1 ? "" : "s"}</small>}</td>
                      <td>{row.collections}</td>
                      <td className={row.missed > 0 ? "mwpr-danger" : ""}>{row.missed}</td>
                      <td className={row.openIssues > 0 ? "mwpr-danger" : ""}>{row.openIssues}</td>
                      <td className={row.highImpactIssues > 0 ? "mwpr-danger" : ""}>{row.highImpactIssues}</td>
                      <td className={row.capacityPressureEvents > 0 ? "mwpr-danger" : ""}>{row.capacityPressureEvents}</td>
                      <td>{row.activeSchedules}</td>
                      <td><span className={`mwpr-priority ${row.priority.toLowerCase()}`}>{row.priority}</span></td>
                      <td className="mwpr-recommendation">
                        <strong>{row.recommendedAdditionalSchedules > 0 ? `Consider +${row.recommendedAdditionalSchedules} weekly slot${row.recommendedAdditionalSchedules === 1 ? "" : "s"}` : "Maintain / monitor"}</strong>
                        <small>{row.reasons.join(" • ")}</small>
                        <p>{row.recommendation}</p>
                      </td>
                      <td><button type="button" className="mwpr-plan" onClick={() => planSchedule(row)}>Plan Schedule</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mwpr-method">
            <strong>Recommendation logic</strong>
            <p>
              This is a configurable decision-support heuristic, not an automatic Metro Waste policy. It combines verified waste kilograms, missed pickups, high-impact resident/driver issues, truck-capacity or heavy-volume events, pending collections, collection activity, and current schedule coverage. Any recommended schedule must still be reviewed for driver availability, vehicle capacity, route coverage, traffic, disposal-site constraints, and field validation.
            </p>
          </div>
        </div>
      )}

      <style jsx global>{`
        .mwpr-shell{border:1px solid #cfe6dc;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.055)}
        .mwpr-head{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:20px;background:linear-gradient(135deg,#f0fdf4,#fff 60%,#eff6ff)}
        .mwpr-head>div:first-child>span{color:#047857;font-size:10px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}.mwpr-head h2{margin:5px 0 0;color:#0f172a;font-size:22px;letter-spacing:-.03em}.mwpr-head p{max-width:850px;margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.55}
        .mwpr-actions{display:flex;gap:9px;flex:0 0 auto}.mwpr-actions button,.mwpr-tabs button,.mwpr-plan{border:0;cursor:pointer;font-weight:900}.mwpr-generate,.mwpr-print{height:40px;padding:0 14px;border-radius:12px}.mwpr-generate{background:#047857;color:#fff}.mwpr-print{background:#0f172a;color:#fff}.mwpr-print:disabled{opacity:.4;cursor:not-allowed}
        .mwpr-controls{display:grid;grid-template-columns:180px 220px 1fr;gap:10px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#fbfdfc}.mwpr-controls label{display:flex;flex-direction:column;gap:5px;color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.mwpr-controls select{height:38px;border:1px solid #dbe3df;border-radius:10px;background:#fff;padding:0 9px;color:#0f172a}.mwpr-control-note{display:flex;justify-content:flex-end;align-items:flex-end;flex-direction:column;color:#64748b;font-size:9px}.mwpr-control-note strong{color:#334155}
        .mwpr-report{display:flex;flex-direction:column;gap:12px;padding:16px;border-top:1px solid #e2e8f0}.mwpr-data-note{padding:12px 14px;border-radius:13px;border:1px solid}.mwpr-data-note strong{font-size:11px;color:#0f172a}.mwpr-data-note p{margin:4px 0 0;font-size:10px;line-height:1.5}.mwpr-data-note.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}.mwpr-data-note.ok{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
        .mwpr-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.mwpr-summary article{padding:12px;border-radius:13px;background:#f8fafc;border:1px solid #e2e8f0}.mwpr-summary small,.mwpr-summary strong{display:block}.mwpr-summary small{color:#64748b;font-size:8px;font-weight:850;text-transform:uppercase}.mwpr-summary strong{margin-top:4px;color:#0f172a;font-size:15px;overflow-wrap:anywhere}
        .mwpr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.mwpr-toolbar>span{color:#64748b;font-size:9px}.mwpr-tabs{display:inline-flex;padding:4px;gap:3px;border-radius:10px;background:#f1f5f9}.mwpr-tabs button{height:31px;padding:0 10px;border-radius:8px;background:transparent;color:#64748b;font-size:9px}.mwpr-tabs button.active{background:#fff;color:#047857;box-shadow:0 2px 8px rgba(15,23,42,.08)}
        .mwpr-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:13px}.mwpr-table{width:100%;min-width:1100px;border-collapse:collapse;font-size:9px}.mwpr-table th,.mwpr-table td{padding:10px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}.mwpr-table th{background:#f8fafc;color:#64748b;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em}.mwpr-table td>strong,.mwpr-table td>small{display:block}.mwpr-table td>small{margin-top:3px;color:#64748b;font-size:7.5px}.mwpr-danger{color:#b91c1c;font-weight:900}.mwpr-priority{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:7.5px;font-weight:950}.mwpr-priority.high{background:#fee2e2;color:#b91c1c}.mwpr-priority.medium{background:#fef3c7;color:#92400e}.mwpr-priority.monitor{background:#dbeafe;color:#1d4ed8}.mwpr-priority.stable{background:#dcfce7;color:#166534}.mwpr-recommendation{min-width:300px}.mwpr-recommendation strong{color:#0f172a}.mwpr-recommendation p{margin:5px 0 0;color:#475569;line-height:1.45}.mwpr-plan{height:31px;padding:0 10px;border-radius:9px;background:#059669;color:#fff;font-size:8px;white-space:nowrap}
        .mwpr-method{padding:12px 14px;border-radius:13px;background:#f8fafc;border:1px dashed #cbd5e1}.mwpr-method strong{color:#0f172a;font-size:10px}.mwpr-method p{margin:5px 0 0;color:#64748b;font-size:9px;line-height:1.55}.mwpr-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:13px;background:#f8fafc;color:#64748b;text-align:center;font-size:10px}
        @media(max-width:1100px){.mwpr-summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:900px){.mwpr-head,.mwpr-toolbar{align-items:stretch;flex-direction:column}.mwpr-actions{width:100%}.mwpr-actions button{flex:1}.mwpr-controls{grid-template-columns:1fr 1fr}.mwpr-control-note{grid-column:1/-1;align-items:flex-start}.mwpr-summary{grid-template-columns:1fr 1fr}}
        @media(max-width:600px){.mwpr-actions{flex-direction:column}.mwpr-controls,.mwpr-summary{grid-template-columns:1fr}.mwpr-control-note{grid-column:auto}}
      `}</style>
    </section>
  );
}

function printMetroWasteReport(report: PlanningReport, range: RangeFilter, barangayFilter: string, lastUpdated: number) {
  const printWindow = window.open("", "_blank", "width=1200,height=850");
  if (!printWindow) {
    window.alert("The print window was blocked. Please allow pop-ups for this site and try again.");
    return;
  }

  const rowsHtml = (rows: PlanningArea[], scope: PlanningScope) => rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(row.barangay)}</strong>${scope === "purok" ? `<br/><span>${escapeHtml(row.purok)}</span>` : ""}</td>
      <td>${escapeHtml(formatWasteKg(row.measuredWasteKg, row.wasteMeasurements))}</td>
      <td>${row.collections}</td>
      <td>${row.missed}</td>
      <td>${row.openIssues}</td>
      <td>${row.highImpactIssues}</td>
      <td>${row.capacityPressureEvents}</td>
      <td>${row.activeSchedules}</td>
      <td><b class="priority ${row.priority.toLowerCase()}">${escapeHtml(row.priority)}</b></td>
      <td>${row.recommendedAdditionalSchedules > 0 ? `+${row.recommendedAdditionalSchedules} weekly slot${row.recommendedAdditionalSchedules === 1 ? "" : "s"}` : "Maintain / monitor"}</td>
      <td>${escapeHtml(row.reasons.join("; "))}</td>
      <td>${escapeHtml(row.recommendation)}</td>
    </tr>
  `).join("");

  const topBarangay = report.barangays[0];
  const topPurok = report.puroks[0];
  const dataStatement = report.hasWasteMeasurements
    ? `Verified kilogram fields were found. Total measured waste in this report view: ${formatWasteKg(report.totalMeasuredWasteKg, 1)}.`
    : "No verified kilogram field was found. The report ranks operational service demand and does not claim actual waste tonnage.";

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Metro Waste Planning Report</title>
        <style>
          *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#0f172a;background:#fff}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #047857;padding-bottom:13px}.head h1{margin:0;font-size:22px}.head p{margin:4px 0 0;color:#475569;font-size:9px}.brand{padding:7px 11px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:800;font-size:9px;height:max-content}.basis,.note,.method{margin:10px 0;padding:9px 11px;border-radius:8px;font-size:8px;line-height:1.5}.basis{background:#f8fafc;border:1px solid #e2e8f0;color:#475569}.note{background:${report.hasWasteMeasurements ? '#ecfdf5' : '#fffbeb'};border:1px solid ${report.hasWasteMeasurements ? '#a7f3d0' : '#fde68a'};color:${report.hasWasteMeasurements ? '#047857' : '#92400e'}}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:10px 0 14px}.summary div{padding:9px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}.summary small,.summary strong{display:block}.summary small{font-size:6.5px;text-transform:uppercase;color:#64748b}.summary strong{margin-top:3px;font-size:12px}h2{font-size:14px;margin:13px 0 6px}.executive{padding:9px 11px;border-left:4px solid #059669;background:#f0fdf4;font-size:8px;line-height:1.5}table{width:100%;border-collapse:collapse;font-size:7px;margin-bottom:12px}th,td{border:1px solid #dbe3df;padding:5px;text-align:left;vertical-align:top}th{background:#f1f5f9;color:#475569;font-size:6.3px;text-transform:uppercase}td span{color:#64748b}.priority{display:inline-block;padding:3px 5px;border-radius:999px;font-size:6px}.priority.high{background:#fee2e2;color:#b91c1c}.priority.medium{background:#fef3c7;color:#92400e}.priority.monitor{background:#dbeafe;color:#1d4ed8}.priority.stable{background:#dcfce7;color:#166534}.method{border:1px dashed #94a3b8;color:#475569}.method strong{color:#0f172a}.signoff{display:grid;grid-template-columns:1fr 1fr;gap:55px;margin-top:27px}.signoff div{border-top:1px solid #0f172a;padding-top:5px;text-align:center;font-size:7px;color:#475569}.footer{margin-top:12px;font-size:6.5px;color:#64748b}@page{size:landscape;margin:10mm}
        </style>
      </head>
      <body>
        <div class="head"><div><h1>Metro Waste Collection Planning & Recommendation Report</h1><p>Decision-support output generated from WasteTrack operational records.</p><p>Generated: ${escapeHtml(new Date().toLocaleString("en-PH"))} • Last data update: ${escapeHtml(formatDateTime(lastUpdated))}</p></div><div class="brand">METRO WASTE</div></div>
        <div class="basis"><strong>Report basis:</strong> ${escapeHtml(rangeLabel(range))} • Barangay: ${escapeHtml(barangayFilter === "all" ? "All Barangays" : barangayFilter)}</div>
        <div class="note"><strong>Data-quality statement:</strong> ${escapeHtml(dataStatement)}</div>
        <div class="summary"><div><small>High-priority Puroks</small><strong>${report.highPriorityPuroks}</strong></div><div><small>Suggested extra weekly slots</small><strong>${report.suggestedExtraSlots}</strong></div><div><small>Measured waste</small><strong>${escapeHtml(report.hasWasteMeasurements ? formatWasteKg(report.totalMeasuredWasteKg, 1) : "Not recorded")}</strong></div><div><small>High-impact issues</small><strong>${report.highImpactIssues}</strong></div><div><small>Capacity pressure</small><strong>${report.capacityPressureEvents}</strong></div><div><small>Barangays analyzed</small><strong>${report.barangays.length}</strong></div></div>
        <h2>Executive Planning Readout</h2><div class="executive">${topBarangay ? `<strong>Highest Barangay priority:</strong> ${escapeHtml(topBarangay.barangay)} — ${escapeHtml(topBarangay.recommendation)}<br/>` : ""}${topPurok ? `<strong>Highest Purok priority:</strong> ${escapeHtml(topPurok.barangay)} / ${escapeHtml(topPurok.purok)} — ${escapeHtml(topPurok.recommendation)}` : "No Purok-level data available."}</div>
        <h2>Barangay Priorities</h2><table><thead><tr><th>#</th><th>Barangay</th><th>Measured Waste</th><th>Collections</th><th>Missed</th><th>Open Reports</th><th>High-impact Issues</th><th>Capacity Pressure</th><th>Schedules</th><th>Priority</th><th>Schedule Action</th><th>Evidence</th><th>Recommendation</th></tr></thead><tbody>${rowsHtml(report.barangays, "barangay") || '<tr><td colspan="13">No Barangay data available.</td></tr>'}</tbody></table>
        <h2>Purok Priorities</h2><table><thead><tr><th>#</th><th>Barangay / Purok</th><th>Measured Waste</th><th>Collections</th><th>Missed</th><th>Open Reports</th><th>High-impact Issues</th><th>Capacity Pressure</th><th>Schedules</th><th>Priority</th><th>Schedule Action</th><th>Evidence</th><th>Recommendation</th></tr></thead><tbody>${rowsHtml(report.puroks, "purok") || '<tr><td colspan="13">No Purok data available.</td></tr>'}</tbody></table>
        <div class="method"><strong>Methodology and limitation.</strong> The recommendation is a configurable decision-support heuristic, not an adopted Metro Waste policy. Missed pickups, high-impact resident/driver issues, and truck-capacity or heavy-volume events are strong signals; pending collections and collection activity provide supporting evidence. Verified kilogram measurements, when present, contribute directly to the demand ranking. Before approving any extra schedule, Metro Waste should validate truck capacity, staffing, route coverage, traffic, disposal-site constraints, and field conditions.</div>
        <div class="signoff"><div>Prepared / Reviewed by</div><div>Metro Waste Authorized Representative</div></div><div class="footer">WasteTrack Agency Reports • Metro Waste decision-support report</div>
        <script>window.onload=()=>{window.setTimeout(()=>{window.focus();window.print()},250)};<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
