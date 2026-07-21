"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { LiveRouteMonitor } from "../components/LiveRouteMonitor";

type AnyItem = Record<string, any>;
type RangeFilter = "7d" | "30d" | "all";
type ReportSource = "Driver Update" | "Collection Report" | "Pickup Record" | "Missed Pickup";

type CollectionEvent = {
  id: string;
  source: ReportSource;
  routeName: string;
  driverName: string;
  barangay: string;
  purok: string;
  status: string;
  wasteType: string;
  remarks: string;
  timestamp: number;
};

type IssueEvent = {
  id: string;
  title: string;
  reporter: string;
  barangay: string;
  purok: string;
  status: string;
  timestamp: number;
};

type ScheduleRecord = {
  id: string;
  scheduleName: string;
  barangay: string;
  purok: string;
  day: string;
  time: string;
  status: string;
  timestamp: number;
};

type BarangayReport = {
  barangay: string;
  collections: number;
  completed: number;
  missed: number;
  pending: number;
  issues: number;
  openIssues: number;
  resolvedIssues: number;
  activeSchedules: number;
  healthScore: number;
};

function toArray(data: any): AnyItem[] {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.filter(Boolean).map((item, index) => ({
      id: item?.id || String(index),
      ...(typeof item === "object" && item !== null ? item : { value: item }),
    }));
  }

  if (typeof data === "object") {
    return Object.entries(data).map(([id, value]) => ({
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
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function getBestTimestamp(item: AnyItem): number {
  return normalizeTimestamp(
    item.timestamp ??
      item.createdAt ??
      item.updatedAt ??
      item.completedAt ??
      item.resolvedAt ??
      item.sentAt ??
      item.submittedAt ??
      item.reportedAt ??
      item.dateTime ??
      item.scheduleDateTime ??
      item.date ??
      item.time
  );
}

function normalizeStatus(value: unknown): string {
  const status = String(value || "").trim().toLowerCase();

  if (!status) return "pending";
  if (status.includes("complete") || status === "done" || status === "finished" || status === "collected") return "completed";
  if (status.includes("resolve") || status.includes("closed") || status.includes("fixed")) return "resolved";
  if (status.includes("progress") || status.includes("ongoing") || status.includes("active") || status.includes("assigned")) return "in progress";
  if (status.includes("miss") || status.includes("failed") || status.includes("fail") || status.includes("not collected")) return "missed";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("offline")) return "offline";
  if (status.includes("online") || status.includes("live")) return "online";
  if (status.includes("open") || status.includes("new")) return "open";

  return status;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanText(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim();
  return text.length > 0 && text.toLowerCase() !== "null" && text.toLowerCase() !== "undefined" ? text : fallback;
}

function getPurokText(item: AnyItem) {
  return cleanText(item.purokLabel ?? item.location?.purokLabel ?? item.purok ?? item.purokName ?? item.zone, "All Puroks");
}

function getBarangayText(item: AnyItem) {
  return cleanText(
    item.barangay ?? item.location?.barangay ?? item.assignedBarangay ?? item.addressBarangay ?? item.area ?? item.targetBarangay,
    "No barangay"
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-PH").format(value);
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "No timestamp";

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return new Date(timestamp).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) return "No timestamp";

  return new Date(timestamp).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function getLastNDays(count: number) {
  const today = new Date();
  const days: { key: string; label: string; collections: number; issues: number }[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    date.setHours(0, 0, 0, 0);

    days.push({
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
      collections: 0,
      issues: 0,
    });
  }

  return days;
}

function getRangeStart(range: RangeFilter) {
  if (range === "all") return 0;

  const date = new Date();
  date.setDate(date.getDate() - (range === "7d" ? 7 : 30));
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function statusClass(status: string) {
  const normalized = normalizeStatus(status);

  if (["completed", "resolved", "online"].includes(normalized)) return "success";
  if (["missed", "cancelled", "offline"].includes(normalized)) return "danger";
  if (["in progress"].includes(normalized)) return "info";
  if (["pending", "open"].includes(normalized)) return "warning";

  return "neutral";
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function buildCollectionEvent(item: AnyItem, source: ReportSource): CollectionEvent {
  const defaultStatus = source === "Missed Pickup" ? "missed" : item.status ?? item.collectionStatus ?? item.pickupStatus;

  return {
    id: `${source}:${String(item.id)}`,
    source,
    routeName: cleanText(item.routeName ?? item.route ?? item.assignedRouteName ?? item.scheduleName ?? item.collectionRoute, "Waste collection report"),
    driverName: cleanText(item.driverName ?? item.driver ?? item.assignedDriverName ?? item.name ?? item.collectorName, "Unassigned driver"),
    barangay: getBarangayText(item),
    purok: getPurokText(item),
    status: normalizeStatus(defaultStatus),
    wasteType: cleanText(item.wasteType ?? item.typeOfWaste ?? item.category, "General waste"),
    remarks: cleanText(item.remarks ?? item.note ?? item.message ?? item.description, "No remarks"),
    timestamp: getBestTimestamp(item),
  };
}

function buildIssueEvent(item: AnyItem, source: string): IssueEvent {
  return {
    id: `${source}:${String(item.id)}`,
    title: cleanText(item.title ?? item.subject ?? item.type ?? item.issueType ?? item.message ?? item.description, "Resident report"),
    reporter: cleanText(item.reporterName ?? item.residentName ?? item.fullName ?? item.name ?? item.email, "Resident"),
    barangay: getBarangayText(item),
    purok: getPurokText(item),
    status: normalizeStatus(item.status || item.issueStatus || "open"),
    timestamp: getBestTimestamp(item),
  };
}

export default function AnalyticsPage() {
  const [routeUpdatesData, setRouteUpdatesData] = useState<AnyItem[]>([]);
  const [collectionReportsData, setCollectionReportsData] = useState<AnyItem[]>([]);
  const [wasteCollectionReportsData, setWasteCollectionReportsData] = useState<AnyItem[]>([]);
  const [pickupRecordsData, setPickupRecordsData] = useState<AnyItem[]>([]);
  const [missedPickupsData, setMissedPickupsData] = useState<AnyItem[]>([]);
  const [residentIssuesData, setResidentIssuesData] = useState<AnyItem[]>([]);
  const [issuesData, setIssuesData] = useState<AnyItem[]>([]);
  const [reportIssuesData, setReportIssuesData] = useState<AnyItem[]>([]);
  const [complaintsData, setComplaintsData] = useState<AnyItem[]>([]);
  const [schedulesData, setSchedulesData] = useState<AnyItem[]>([]);
  const [notificationsData, setNotificationsData] = useState<AnyItem[]>([]);
  const [driverLocationsData, setDriverLocationsData] = useState<AnyItem[]>([]);
  const [driversData, setDriversData] = useState<AnyItem[]>([]);
  const [routesData, setRoutesData] = useState<AnyItem[]>([]);
  const [residentsData, setResidentsData] = useState<AnyItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  const [range, setRange] = useState<RangeFilter>("30d");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const updateTime = () => setLastUpdated(Date.now());

    const listen = (path: string, setter: (items: AnyItem[]) => void) =>
      onValue(ref(db, path), (snap) => {
        setter(toArray(snap.val()));
        updateTime();
      });

    const unsubscribers = [
      listen("route_status_updates", setRouteUpdatesData),
      listen("collection_reports", setCollectionReportsData),
      listen("waste_collection_reports", setWasteCollectionReportsData),
      listen("pickup_records", setPickupRecordsData),
      listen("missed_pickups", setMissedPickupsData),
      listen("resident_issues", setResidentIssuesData),
      listen("issues", setIssuesData),
      listen("report_issues", setReportIssuesData),
      listen("complaints", setComplaintsData),
      listen("schedules", setSchedulesData),
      listen("notifications", setNotificationsData),
      listen("driver_locations", setDriverLocationsData),
      listen("drivers", setDriversData),
      listen("routes", setRoutesData),
      listen("residents", setResidentsData),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const collections = useMemo<CollectionEvent[]>(() => {
    return [
      ...routeUpdatesData.map((item) => buildCollectionEvent(item, "Driver Update")),
      ...collectionReportsData.map((item) => buildCollectionEvent(item, "Collection Report")),
      ...wasteCollectionReportsData.map((item) => buildCollectionEvent(item, "Collection Report")),
      ...pickupRecordsData.map((item) => buildCollectionEvent(item, "Pickup Record")),
      ...missedPickupsData.map((item) => buildCollectionEvent(item, "Missed Pickup")),
    ]
      .filter((item) => item.timestamp > 0 || item.barangay !== "No barangay" || item.routeName !== "Waste collection report")
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [routeUpdatesData, collectionReportsData, wasteCollectionReportsData, pickupRecordsData, missedPickupsData]);

  const schedules = useMemo<ScheduleRecord[]>(() => {
    return schedulesData
      .map((item) => ({
        id: String(item.id),
        scheduleName: cleanText(item.scheduleName ?? item.routeName ?? item.title ?? item.name, "Collection schedule"),
        barangay: getBarangayText(item),
        purok: getPurokText(item),
        day: cleanText(item.scheduleDay ?? item.day ?? item.dayOfWeek, "Weekly"),
        time: cleanText(item.startTime ?? item.time ?? item.collectionTime, "No time"),
        status: normalizeStatus(item.status || "active"),
        timestamp: getBestTimestamp(item),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [schedulesData]);

  const issues = useMemo<IssueEvent[]>(() => {
    return [
      ...residentIssuesData.map((item) => buildIssueEvent(item, "resident_issues")),
      ...issuesData.map((item) => buildIssueEvent(item, "issues")),
      ...reportIssuesData.map((item) => buildIssueEvent(item, "report_issues")),
      ...complaintsData.map((item) => buildIssueEvent(item, "complaints")),
    ]
      .filter((item) => item.timestamp > 0 || item.title !== "Resident report")
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [residentIssuesData, issuesData, reportIssuesData, complaintsData]);

  const barangayOptions = useMemo(() => {
    const values = new Set<string>();

    collections.forEach((item) => item.barangay && values.add(item.barangay));
    schedules.forEach((item) => item.barangay && values.add(item.barangay));
    issues.forEach((item) => item.barangay && values.add(item.barangay));
    residentsData.forEach((item) => getBarangayText(item) !== "No barangay" && values.add(getBarangayText(item)));

    return Array.from(values).filter((item) => item && item !== "No barangay").sort();
  }, [collections, schedules, issues, residentsData]);

  const filtered = useMemo(() => {
    const start = getRangeStart(range);
    const keyword = search.trim().toLowerCase();

    const matchesCommon = (item: { barangay: string; timestamp: number }, fields: string[]) => {
      const inRange = range === "all" || item.timestamp >= start || item.timestamp === 0;
      const inBarangay = barangayFilter === "all" || item.barangay === barangayFilter;
      const inSearch = !keyword || fields.join(" ").toLowerCase().includes(keyword);
      return inRange && inBarangay && inSearch;
    };

    return {
      collections: collections.filter((item) =>
        matchesCommon(item, [item.source, item.routeName, item.driverName, item.barangay, item.purok, item.status, item.wasteType, item.remarks])
      ),
      issues: issues.filter((item) =>
        matchesCommon(item, [item.title, item.reporter, item.barangay, item.purok, item.status])
      ),
      schedules: schedules.filter((item) =>
        matchesCommon(item, [item.scheduleName, item.barangay, item.purok, item.day, item.time, item.status])
      ),
    };
  }, [collections, issues, schedules, range, barangayFilter, search]);

  const stats = useMemo(() => {
    const completed = filtered.collections.filter((item) => item.status === "completed").length;
    const missed = filtered.collections.filter((item) => item.status === "missed").length;
    const activeOrInProgress = filtered.collections.filter((item) => ["in progress", "pending", "open"].includes(item.status)).length;
    const resolvedIssues = filtered.issues.filter((item) => item.status === "resolved").length;
    const openIssues = filtered.issues.filter((item) => item.status !== "resolved" && item.status !== "closed").length;
    const activeSchedules = filtered.schedules.filter((item) => !["cancelled", "inactive", "deleted"].includes(item.status)).length;

    const onlineDriverIds = new Set<string>();

    driverLocationsData.forEach((item) => {
      const timestamp = getBestTimestamp(item);
      const status = normalizeStatus(item.status);
      const recent = timestamp > 0 && Date.now() - timestamp <= 10 * 60 * 1000;

      if (status !== "offline" && recent) {
        onlineDriverIds.add(String(item.driverId ?? item.id));
      }
    });

    driversData.forEach((item) => {
      if (normalizeStatus(item.status) === "online") {
        onlineDriverIds.add(String(item.id));
      }
    });

    const barangayCoverage = new Set<string>();
    [...filtered.collections, ...filtered.issues, ...filtered.schedules].forEach((item) => {
      if (item.barangay && item.barangay !== "No barangay") barangayCoverage.add(item.barangay);
    });

    return {
      totalWasteCollectionReports: filtered.collections.length,
      totalResidentReports: filtered.issues.length,
      totalOperationalRecords: filtered.collections.length + filtered.issues.length + filtered.schedules.length,
      completed,
      missed,
      activeOrInProgress,
      complianceRate: percent(completed, completed + missed + activeOrInProgress),
      openIssues,
      resolvedIssues,
      issueResolutionRate: percent(resolvedIssues, filtered.issues.length),
      activeSchedules,
      onlineDrivers: onlineDriverIds.size,
      registeredDrivers: driversData.length,
      registeredResidents: residentsData.length,
      routeCount: routesData.length,
      notifications: notificationsData.length,
      barangayCoverage: barangayCoverage.size,
    };
  }, [filtered, driverLocationsData, driversData, residentsData, routesData, notificationsData]);

  const dailyActivity = useMemo(() => {
    const dayCount = range === "7d" ? 7 : 14;
    const days = getLastNDays(dayCount);

    filtered.collections.forEach((item) => {
      if (!item.timestamp) return;
      const bucket = days.find((day) => day.key === getDayKey(item.timestamp));
      if (bucket) bucket.collections += 1;
    });

    filtered.issues.forEach((item) => {
      if (!item.timestamp) return;
      const bucket = days.find((day) => day.key === getDayKey(item.timestamp));
      if (bucket) bucket.issues += 1;
    });

    return days;
  }, [filtered, range]);

  const maxDaily = Math.max(1, ...dailyActivity.map((item) => Math.max(item.collections, item.issues)));

  const barangayReports = useMemo<BarangayReport[]>(() => {
    const map = new Map<string, BarangayReport>();

    const ensure = (barangay: string) => {
      const key = barangay && barangay !== "No barangay" ? barangay : "Unspecified";
      if (!map.has(key)) {
        map.set(key, {
          barangay: key,
          collections: 0,
          completed: 0,
          missed: 0,
          pending: 0,
          issues: 0,
          openIssues: 0,
          resolvedIssues: 0,
          activeSchedules: 0,
          healthScore: 0,
        });
      }
      return map.get(key)!;
    };

    filtered.collections.forEach((item) => {
      const row = ensure(item.barangay);
      row.collections += 1;
      if (item.status === "completed") row.completed += 1;
      else if (item.status === "missed") row.missed += 1;
      else row.pending += 1;
    });

    filtered.issues.forEach((item) => {
      const row = ensure(item.barangay);
      row.issues += 1;
      if (item.status === "resolved") row.resolvedIssues += 1;
      else row.openIssues += 1;
    });

    filtered.schedules.forEach((item) => {
      const row = ensure(item.barangay);
      if (!["cancelled", "inactive", "deleted"].includes(item.status)) row.activeSchedules += 1;
    });

    return Array.from(map.values())
      .map((row) => {
        const positive = row.completed + row.resolvedIssues;
        const risk = row.missed + row.openIssues + row.pending;
        const total = positive + risk;
        return {
          ...row,
          healthScore: total > 0 ? Math.max(0, Math.round((positive / total) * 100)) : 100,
        };
      })
      .sort((a, b) => b.collections + b.issues + b.activeSchedules - (a.collections + a.issues + a.activeSchedules));
  }, [filtered]);

  const collectionBreakdown = useMemo(() => buildBreakdown(filtered.collections), [filtered.collections]);
  const issueBreakdown = useMemo(() => buildBreakdown(filtered.issues), [filtered.issues]);
  const recentCollections = filtered.collections.slice(0, 8);
  const recentIssues = filtered.issues.slice(0, 8);

  const dataSources = [
    { label: "Route Status Updates", path: "route_status_updates", count: routeUpdatesData.length },
    { label: "Collection Reports", path: "collection_reports", count: collectionReportsData.length },
    { label: "Waste Collection Reports", path: "waste_collection_reports", count: wasteCollectionReportsData.length },
    { label: "Pickup Records", path: "pickup_records", count: pickupRecordsData.length },
    { label: "Missed Pickups", path: "missed_pickups", count: missedPickupsData.length },
    { label: "Resident Issues", path: "resident_issues", count: residentIssuesData.length },
    { label: "Reports / Complaints", path: "issues, report_issues, complaints", count: issuesData.length + reportIssuesData.length + complaintsData.length },
  ];

  const insightText = useMemo(() => {
    if (filtered.collections.length === 0 && filtered.issues.length === 0 && filtered.schedules.length === 0) {
      return "No live Firebase records matched the selected filters. This page does not use demo records.";
    }

    if (stats.openIssues > 0 && stats.missed > 0) {
      return "Missed pickups and open resident reports both need attention. Review the barangay table and recent reports first.";
    }

    if (stats.openIssues > 0) {
      return "There are resident reports still open. Prioritize follow-up and send resident notices when needed.";
    }

    if (stats.missed > 0) {
      return "There are missed waste collection records in the selected period. Check driver updates and route performance.";
    }

    return "Current live records show no missed pickups or unresolved resident reports in the selected view.";
  }, [filtered.collections.length, filtered.issues.length, filtered.schedules.length, stats.openIssues, stats.missed]);

  return (
    <DashboardShell
      title="Analytics"
      description="Live waste collection analytics from EcoTrack records"
      hidePageHeader
    >
      <div className="analytics-page">
        <section className="analytics-hero">
          <div className="hero-copy">
            <span className="eyebrow">Live Waste Collection Analytics</span>
            <h1>City waste collection reports dashboard</h1>
            <p>
              All available collection reports, driver route updates, missed pickups, schedules,
              resident complaints, and system notices are consolidated from Firebase records only.
            </p>
          </div>

          <div className="hero-side">
            <div className="hero-status">
              <span className="live-dot" />
              <div>
                <strong>Realtime Firebase</strong>
                <small>Updated {formatRelativeTime(lastUpdated)}</small>
              </div>
            </div>
            <div className="hero-total">
              <small>Total live records</small>
              <strong>{formatNumber(stats.totalOperationalRecords)}</strong>
            </div>
          </div>
        </section>

        <section className="filter-card">
          <div className="filter-group compact">
            <label>Period</label>
            <select value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All records</option>
            </select>
          </div>

          <div className="filter-group compact">
            <label>Barangay</label>
            <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)}>
              <option value="all">All barangays</option>
              {barangayOptions.map((barangay) => (
                <option key={barangay} value={barangay}>
                  {barangay}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group grow">
            <label>Search Records</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search barangay, route, driver, complaint, status, waste type..."
            />
          </div>

          <button
            className="reset-btn"
            type="button"
            onClick={() => {
              setRange("30d");
              setBarangayFilter("all");
              setSearch("");
            }}
          >
            Reset
          </button>
        </section>

        <section className="metric-grid primary">
          <MetricCard
            label="Waste Collection Reports"
            value={stats.totalWasteCollectionReports}
            note="Driver updates, pickups, missed pickups, and collection reports"
            tone="green"
          />
          <MetricCard
            label="Collection Compliance"
            value={`${stats.complianceRate}%`}
            note={`${formatNumber(stats.completed)} completed • ${formatNumber(stats.missed)} missed`}
            tone={stats.missed > 0 ? "amber" : "blue"}
          />
          <MetricCard
            label="Resident Reports"
            value={stats.totalResidentReports}
            note={`${formatNumber(stats.openIssues)} open • ${formatNumber(stats.resolvedIssues)} resolved`}
            tone={stats.openIssues > 0 ? "amber" : "green"}
          />
          <MetricCard
            label="Barangay Coverage"
            value={stats.barangayCoverage}
            note="Barangays with collection, schedule, or resident report records"
            tone="dark"
          />
        </section>

        <section className="metric-grid secondary">
          <SmallMetric label="Active Schedules" value={stats.activeSchedules} />
          <SmallMetric label="Routes" value={stats.routeCount} />
          <SmallMetric label="Residents" value={stats.registeredResidents} />
          <SmallMetric label="Drivers Online" value={`${stats.onlineDrivers}/${stats.registeredDrivers}`} />
          <SmallMetric label="Notifications" value={stats.notifications} />
          <SmallMetric label="Pending Updates" value={stats.activeOrInProgress} danger={stats.activeOrInProgress > 0} />
        </section>

        <LiveRouteMonitor />

        <section className="analytics-grid main-grid">
          <div className="panel wide">
            <PanelHeader
              title="Daily Waste Collection Activity"
              description="Collection records and resident reports based on selected filters"
            />

            {filtered.collections.length === 0 && filtered.issues.length === 0 ? (
              <EmptyState message="No live activity records matched the selected filters." />
            ) : (
              <div className="chart-area">
                {dailyActivity.map((day) => (
                  <div className="bar-column" key={day.key}>
                    <div className="bar-values">
                      <span>{day.collections}</span>
                      <span>{day.issues}</span>
                    </div>
                    <div className="bar-pair">
                      <div
                        className="bar collection"
                        style={{ height: `${Math.max(8, (day.collections / maxDaily) * 170)}px` }}
                        title={`${day.collections} collection records`}
                      />
                      <div
                        className="bar issue"
                        style={{ height: `${Math.max(8, (day.issues / maxDaily) * 170)}px` }}
                        title={`${day.issues} resident reports`}
                      />
                    </div>
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="chart-legend">
              <span><i className="collection-dot" /> Collection records</span>
              <span><i className="issue-dot" /> Resident reports</span>
            </div>
          </div>

          <div className="panel insight-panel">
            <PanelHeader title="Operations Readout" description="Automatic summary from live records" />

            <div className={`summary-box ${stats.openIssues > 0 || stats.missed > 0 ? "attention" : "stable"}`}>
              <strong>{stats.openIssues > 0 || stats.missed > 0 ? "Attention needed" : "Stable operations"}</strong>
              <p>{insightText}</p>
            </div>

            <div className="summary-list">
              <SummaryRow label="Completed collections" value={stats.completed} />
              <SummaryRow label="Missed pickups" value={stats.missed} danger={stats.missed > 0} />
              <SummaryRow label="Open resident reports" value={stats.openIssues} danger={stats.openIssues > 0} />
              <SummaryRow label="Issue resolution rate" value={`${stats.issueResolutionRate}%`} />
            </div>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            title="Barangay Waste Collection Report"
            description="Consolidated collection, schedule, and resident report counts per barangay"
          />

          {barangayReports.length === 0 ? (
            <EmptyState message="No barangay report data available for the selected filters." />
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Barangay</th>
                    <th>Collection Records</th>
                    <th>Completed</th>
                    <th>Missed</th>
                    <th>Open Reports</th>
                    <th>Active Schedules</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {barangayReports.map((row) => (
                    <tr key={row.barangay}>
                      <td>
                        <strong>{row.barangay}</strong>
                        <small>{row.issues} resident reports</small>
                      </td>
                      <td>{row.collections}</td>
                      <td>{row.completed}</td>
                      <td className={row.missed > 0 ? "danger-text" : ""}>{row.missed}</td>
                      <td className={row.openIssues > 0 ? "danger-text" : ""}>{row.openIssues}</td>
                      <td>{row.activeSchedules}</td>
                      <td>
                        <div className="health-cell">
                          <div className="health-track">
                            <span style={{ width: `${row.healthScore}%` }} />
                          </div>
                          <b>{row.healthScore}%</b>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="analytics-grid two-col">
          <StatusBreakdown title="Collection Status" items={collectionBreakdown} total={filtered.collections.length} />
          <StatusBreakdown title="Resident Report Status" items={issueBreakdown} total={filtered.issues.length} />
        </section>

        <section className="analytics-grid two-col bottom-grid">
          <div className="panel">
            <PanelHeader title="Recent Waste Collection Records" description="Latest actual collection activity from system reports" />
            {recentCollections.length === 0 ? (
              <EmptyState message="No recent waste collection records found." />
            ) : (
              <div className="records-list">
                {recentCollections.map((item) => (
                  <RecordRow
                    key={item.id}
                    title={item.routeName}
                    meta={`${item.source} • ${item.barangay} • ${item.purok} • ${item.driverName}`}
                    time={formatDateTime(item.timestamp)}
                    status={item.status}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <PanelHeader title="Recent Resident Reports" description="Newest complaints and issues submitted in the system" />
            {recentIssues.length === 0 ? (
              <EmptyState message="No recent resident reports found." />
            ) : (
              <div className="records-list">
                {recentIssues.map((item) => (
                  <RecordRow
                    key={item.id}
                    title={item.title}
                    meta={`${item.reporter} • ${item.barangay} • ${item.purok}`}
                    time={formatDateTime(item.timestamp)}
                    status={item.status}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel data-panel">
          <PanelHeader title="Live Data Sources" description="Actual Firebase paths used by this analytics page" />
          <div className="source-grid">
            {dataSources.map((source) => (
              <div className="source-card" key={source.path}>
                <span>{source.label}</span>
                <strong>{formatNumber(source.count)}</strong>
                <small>{source.path}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <style jsx global>{`
        .analytics-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .analytics-hero {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          gap: 24px;
          border-radius: 26px;
          padding: 26px;
          color: #ffffff;
          background:
            radial-gradient(circle at top right, rgba(167, 243, 208, 0.28), transparent 36%),
            linear-gradient(135deg, #052e2b 0%, #065f46 52%, #0f766e 100%);
          box-shadow: 0 24px 70px rgba(6, 95, 70, 0.2);
        }

        .hero-copy {
          min-width: 0;
        }

        .eyebrow {
          display: inline-flex;
          width: fit-content;
          padding: 7px 11px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.13);
          color: #bbf7d0;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .analytics-hero h1 {
          margin: 14px 0 0;
          max-width: 760px;
          font-size: clamp(28px, 4vw, 46px);
          line-height: 1.02;
          letter-spacing: -0.05em;
        }

        .analytics-hero p {
          max-width: 780px;
          margin: 12px 0 0;
          color: #dcfce7;
          line-height: 1.6;
          font-size: 14px;
        }

        .hero-side {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          width: 245px;
          flex: 0 0 245px;
        }

        .hero-status,
        .hero-total {
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(14px);
        }

        .hero-status {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .hero-status strong,
        .hero-status small,
        .hero-total strong,
        .hero-total small {
          display: block;
        }

        .hero-status small,
        .hero-total small {
          color: #d1fae5;
          margin-top: 3px;
          font-size: 12px;
        }

        .hero-total strong {
          margin-top: 5px;
          font-size: 30px;
          line-height: 1;
          letter-spacing: -0.04em;
        }

        .live-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 0 7px rgba(34, 197, 94, 0.18);
          flex: 0 0 12px;
        }

        .filter-card {
          display: flex;
          align-items: end;
          gap: 12px;
          padding: 14px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.045);
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-width: 170px;
        }

        .filter-group.compact {
          width: 175px;
        }

        .filter-group.grow {
          flex: 1;
        }

        .filter-group label {
          color: #475569;
          font-size: 11px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .filter-group select,
        .filter-group input {
          height: 42px;
          border: 1px solid #dbe3ef;
          border-radius: 13px;
          background: #f8fafc;
          color: #0f172a;
          padding: 0 12px;
          outline: none;
          font-size: 13px;
        }

        .filter-group select:focus,
        .filter-group input:focus {
          background: #ffffff;
          border-color: #10b981;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .reset-btn {
          height: 42px;
          border: 0;
          border-radius: 13px;
          background: #f1f5f9;
          color: #334155;
          padding: 0 16px;
          font-weight: 900;
          cursor: pointer;
        }

        .reset-btn:hover {
          background: #e2e8f0;
        }

        .metric-grid {
          display: grid;
          gap: 12px;
        }

        .metric-grid.primary {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .metric-grid.secondary {
          grid-template-columns: repeat(6, minmax(0, 1fr));
        }

        .metric-card,
        .small-metric,
        .panel {
          background: #ffffff;
          border: 1px solid #dce6f1;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.055);
        }

        .metric-card {
          position: relative;
          overflow: hidden;
          min-height: 92px;
          border-radius: 18px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 9px;
          isolation: isolate;
        }

        .metric-card::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: var(--tone, #10b981);
          opacity: 0.95;
        }

        .metric-card::after {
          content: "";
          position: absolute;
          right: -46px;
          top: -56px;
          width: 118px;
          height: 118px;
          border-radius: 999px;
          opacity: 0.1;
          background: var(--tone, #10b981);
          z-index: -1;
        }

        .metric-card.green { --tone: #10b981; }
        .metric-card.blue { --tone: #2563eb; }
        .metric-card.amber { --tone: #f59e0b; }
        .metric-card.dark { --tone: #0f172a; }

        .metric-main {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
        }

        .metric-label {
          min-width: 0;
          color: #334155;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.25;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .metric-value {
          flex: 0 0 auto;
          color: #071225;
          font-size: 28px;
          font-weight: 950;
          letter-spacing: -0.045em;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .metric-note {
          display: block;
          color: #64748b;
          font-size: 11.5px;
          font-weight: 700;
          line-height: 1.45;
        }

        .small-metric {
          min-height: 50px;
          border-radius: 15px;
          padding: 11px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .small-metric span {
          min-width: 0;
          color: #475569;
          font-size: 12.5px;
          font-weight: 800;
          line-height: 1.2;
        }

        .small-metric strong {
          flex: 0 0 auto;
          color: #071225;
          font-size: 18px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: -0.03em;
          font-variant-numeric: tabular-nums;
        }

        .small-metric.danger strong,
        .danger-text {
          color: #dc2626 !important;
        }

        .analytics-grid {
          display: grid;
          gap: 14px;
        }

        .main-grid {
          grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.8fr);
        }

        .two-col {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .panel {
          border-radius: 23px;
          padding: 19px;
          min-width: 0;
        }

        .panel-header {
          margin-bottom: 17px;
        }

        .panel-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
          letter-spacing: -0.02em;
        }

        .panel-header p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 12.5px;
          line-height: 1.45;
        }

        .chart-area {
          height: 250px;
          display: grid;
          grid-template-columns: repeat(14, minmax(34px, 1fr));
          gap: 12px;
          align-items: end;
          padding-top: 12px;
          border-top: 1px dashed #dbe3ef;
          overflow-x: auto;
        }

        .bar-column {
          height: 226px;
          display: flex;
          flex-direction: column;
          justify-content: end;
          align-items: center;
          gap: 8px;
        }

        .bar-values {
          min-height: 18px;
          display: flex;
          gap: 8px;
          color: #475569;
          font-size: 11px;
          font-weight: 900;
        }

        .bar-pair {
          height: 170px;
          display: flex;
          align-items: end;
          justify-content: center;
          gap: 4px;
        }

        .bar {
          width: 13px;
          border-radius: 999px 999px 4px 4px;
        }

        .bar.collection {
          background: linear-gradient(180deg, #22c55e, #16a34a);
        }

        .bar.issue {
          background: linear-gradient(180deg, #f59e0b, #d97706);
        }

        .bar-column small {
          color: #64748b;
          font-size: 11px;
          white-space: nowrap;
        }

        .chart-legend {
          display: flex;
          gap: 16px;
          margin-top: 14px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .chart-legend span {
          display: inline-flex;
          gap: 7px;
          align-items: center;
        }

        .chart-legend i {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .collection-dot { background: #22c55e; }
        .issue-dot { background: #f59e0b; }

        .summary-box {
          padding: 16px;
          border-radius: 18px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .summary-box.attention {
          background: #fffbeb;
          border-color: #fde68a;
        }

        .summary-box.stable {
          background: #f0fdf4;
          border-color: #bbf7d0;
        }

        .summary-box strong {
          display: block;
          color: #0f172a;
          font-size: 15px;
        }

        .summary-box p {
          margin: 8px 0 0;
          color: #475569;
          font-size: 13px;
          line-height: 1.55;
        }

        .summary-list {
          display: grid;
          gap: 10px;
          margin-top: 16px;
        }

        .summary-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 11px 0;
          border-bottom: 1px solid #edf2f7;
          color: #475569;
          font-size: 13px;
          font-weight: 750;
        }

        .summary-row strong {
          color: #0f172a;
          font-size: 16px;
        }

        .summary-row.danger strong {
          color: #dc2626;
        }

        .report-table-wrap {
          width: 100%;
          overflow-x: auto;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
        }

        .report-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 820px;
          background: #ffffff;
        }

        .report-table th {
          text-align: left;
          padding: 13px 14px;
          background: #f8fafc;
          color: #475569;
          font-size: 11px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid #e2e8f0;
        }

        .report-table td {
          padding: 13px 14px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
          border-bottom: 1px solid #eef2f7;
          vertical-align: middle;
        }

        .report-table tr:last-child td {
          border-bottom: 0;
        }

        .report-table td strong,
        .report-table td small {
          display: block;
        }

        .report-table td small {
          margin-top: 3px;
          color: #64748b;
          font-size: 11.5px;
          font-weight: 700;
        }

        .health-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 130px;
        }

        .health-track {
          width: 88px;
          height: 9px;
          overflow: hidden;
          border-radius: 999px;
          background: #e5edf6;
        }

        .health-track span {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #10b981, #22c55e);
        }

        .health-cell b {
          color: #0f172a;
          font-size: 12px;
        }

        .breakdown-list {
          display: grid;
          gap: 14px;
        }

        .breakdown-row {
          display: grid;
          grid-template-columns: 130px 1fr 46px;
          gap: 12px;
          align-items: center;
        }

        .breakdown-row label {
          color: #334155;
          font-size: 13px;
          font-weight: 850;
        }

        .breakdown-track {
          height: 12px;
          overflow: hidden;
          border-radius: 999px;
          background: #e5edf6;
        }

        .breakdown-fill {
          height: 100%;
          border-radius: 999px;
        }

        .breakdown-row strong {
          text-align: right;
          color: #0f172a;
          font-size: 13px;
        }

        .records-list {
          display: grid;
          gap: 10px;
        }

        .record-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px;
          border-radius: 17px;
          background: #f8fafc;
          border: 1px solid #edf2f7;
        }

        .record-row h3 {
          margin: 0;
          color: #0f172a;
          font-size: 14px;
          line-height: 1.25;
        }

        .record-row p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.35;
        }

        .record-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex: 0 0 auto;
        }

        .record-time {
          color: #94a3b8;
          font-size: 11px;
          font-weight: 750;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
        }

        .status-pill.success {
          background: #dcfce7;
          color: #166534;
        }

        .status-pill.danger {
          background: #fee2e2;
          color: #b91c1c;
        }

        .status-pill.warning {
          background: #fef3c7;
          color: #92400e;
        }

        .status-pill.info {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .status-pill.neutral {
          background: #f1f5f9;
          color: #475569;
        }

        .source-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .source-card {
          min-height: 86px;
          padding: 14px;
          border-radius: 17px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .source-card span,
        .source-card strong,
        .source-card small {
          display: block;
        }

        .source-card span {
          color: #334155;
          font-size: 12px;
          font-weight: 900;
        }

        .source-card strong {
          margin-top: 8px;
          color: #0f172a;
          font-size: 24px;
          line-height: 1;
          letter-spacing: -0.04em;
        }

        .source-card small {
          margin-top: 6px;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          word-break: break-word;
        }

        .empty-state {
          display: grid;
          place-items: center;
          min-height: 140px;
          border-radius: 18px;
          background: #f8fafc;
          color: #64748b;
          text-align: center;
          padding: 20px;
          border: 1px dashed #cbd5e1;
          font-size: 13px;
          font-weight: 750;
        }

        @media (max-width: 1240px) {
          .metric-grid.primary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .metric-grid.secondary,
          .source-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .main-grid,
          .two-col {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 820px) {
          .analytics-hero {
            flex-direction: column;
            padding: 22px;
          }

          .hero-side {
            width: 100%;
            flex: auto;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .filter-card {
            align-items: stretch;
            flex-direction: column;
          }

          .filter-group,
          .filter-group.compact {
            width: 100%;
            min-width: 0;
          }
        }

        @media (max-width: 640px) {
          .metric-grid.primary,
          .metric-grid.secondary,
          .source-grid,
          .hero-side {
            grid-template-columns: 1fr;
          }

          .record-row {
            align-items: flex-start;
            flex-direction: column;
          }

          .record-side {
            align-items: flex-start;
          }
        }
      `}</style>
    </DashboardShell>
  );
}

function buildBreakdown(items: { status: string }[]) {
  const map: Record<string, number> = {};

  items.forEach((item) => {
    const key = normalizeStatus(item.status);
    map[key] = (map[key] || 0) + 1;
  });

  return Object.entries(map)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  tone: "green" | "blue" | "amber" | "dark";
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-main">
        <span className="metric-label">{label}</span>
        <strong className="metric-value">{typeof value === "number" ? formatNumber(value) : value}</strong>
      </div>
      <small className="metric-note">{note}</small>
    </div>
  );
}

function SmallMetric({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={`small-metric ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}

function PanelHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

function SummaryRow({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={`summary-row ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}

function StatusBreakdown({ title, items, total }: { title: string; items: { status: string; count: number }[]; total: number }) {
  return (
    <div className="panel">
      <PanelHeader title={title} description="Distribution based on current filters" />
      {items.length === 0 ? (
        <EmptyState message="No status data available yet." />
      ) : (
        <div className="breakdown-list">
          {items.map((item) => {
            const value = percent(item.count, total);
            const cls = statusClass(item.status);

            return (
              <div className="breakdown-row" key={item.status}>
                <label>{titleCase(item.status)}</label>
                <div className="breakdown-track">
                  <div
                    className={`breakdown-fill ${cls}`}
                    style={{
                      width: `${Math.max(4, value)}%`,
                      background:
                        cls === "success"
                          ? "#16a34a"
                          : cls === "danger"
                          ? "#dc2626"
                          : cls === "warning"
                          ? "#d97706"
                          : cls === "info"
                          ? "#2563eb"
                          : "#64748b",
                    }}
                  />
                </div>
                <strong>{item.count}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordRow({
  title,
  meta,
  time,
  status,
}: {
  title: string;
  meta: string;
  time: string;
  status: string;
}) {
  return (
    <div className="record-row">
      <div>
        <h3>{title}</h3>
        <p>{meta}</p>
      </div>
      <div className="record-side">
        <span className={`status-pill ${statusClass(status)}`}>{titleCase(status)}</span>
        <span className="record-time">{time}</span>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}
