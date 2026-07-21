"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type AnyRecord = Record<string, any>;

type DashboardEventType =
  | "driver"
  | "notification"
  | "issue"
  | "schedule"
  | "route";

type DashboardEvent = {
  id: string;
  type: DashboardEventType;
  title: string;
  subtitle: string;
  timestamp: number;
};

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function toArray(data: any): any[] {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.filter(Boolean).map((item, index) => ({
      id: item?.id ?? String(index),
      ...item,
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

function formatRelativeTime(timestamp: number) {
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

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDayKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function getStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getText(value: unknown, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isOpenIssue(issue: any) {
  const status = getStatus(issue.status || issue.issueStatus || issue.state);
  return !["resolved", "closed", "completed", "done", "cancelled"].includes(status);
}

function isCompletedSchedule(schedule: any) {
  const status = getStatus(schedule.status || schedule.collectionStatus);
  return ["completed", "done", "finished", "collected", "success"].includes(status);
}

function isUpcomingSchedule(schedule: any) {
  const timestamp = normalizeTimestamp(
    schedule.timestamp ?? schedule.scheduledAt ?? schedule.date ?? schedule.createdAt
  );

  if (!timestamp) {
    const status = getStatus(schedule.status);
    return !["completed", "done", "finished", "cancelled"].includes(status);
  }

  return timestamp >= startOfDay(new Date()).getTime();
}

function getEventBadge(type: DashboardEventType) {
  switch (type) {
    case "driver":
      return "GPS";
    case "issue":
      return "ISS";
    case "schedule":
      return "SCH";
    case "route":
      return "RTE";
    default:
      return "ALT";
  }
}

function getEventClass(type: DashboardEventType) {
  switch (type) {
    case "driver":
      return "green";
    case "issue":
      return "red";
    case "schedule":
      return "blue";
    case "route":
      return "amber";
    default:
      return "slate";
  }
}

export default function DashboardPage() {
  const [driversData, setDriversData] = useState<AnyRecord>({});
  const [driverLocationsData, setDriverLocationsData] = useState<AnyRecord>({});
  const [residentsData, setResidentsData] = useState<AnyRecord>({});
  const [usersData, setUsersData] = useState<AnyRecord>({});
  const [issuesData, setIssuesData] = useState<AnyRecord>({});
  const [reportIssuesData, setReportIssuesData] = useState<AnyRecord>({});
  const [notificationsData, setNotificationsData] = useState<AnyRecord>({});
  const [schedulesData, setSchedulesData] = useState<AnyRecord>({});
  const [routesData, setRoutesData] = useState<AnyRecord>({});
  const [routeUpdatesData, setRouteUpdatesData] = useState<AnyRecord>({});
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  useEffect(() => {
    const touch = () => setLastUpdated(Date.now());

    const unsubDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      setDriversData(snapshot.val() || {});
      touch();
    });

    const unsubDriverLocations = onValue(ref(db, "driver_locations"), (snapshot) => {
      setDriverLocationsData(snapshot.val() || {});
      touch();
    });

    const unsubResidents = onValue(ref(db, "residents"), (snapshot) => {
      setResidentsData(snapshot.val() || {});
      touch();
    });

    const unsubUsers = onValue(ref(db, "users"), (snapshot) => {
      setUsersData(snapshot.val() || {});
      touch();
    });

    const unsubIssues = onValue(ref(db, "issues"), (snapshot) => {
      setIssuesData(snapshot.val() || {});
      touch();
    });

    const unsubReportIssues = onValue(ref(db, "report_issues"), (snapshot) => {
      setReportIssuesData(snapshot.val() || {});
      touch();
    });

    const unsubNotifications = onValue(ref(db, "notifications"), (snapshot) => {
      setNotificationsData(snapshot.val() || {});
      touch();
    });

    const unsubSchedules = onValue(ref(db, "schedules"), (snapshot) => {
      setSchedulesData(snapshot.val() || {});
      touch();
    });

    const unsubRoutes = onValue(ref(db, "routes"), (snapshot) => {
      setRoutesData(snapshot.val() || {});
      touch();
    });

    const unsubRouteUpdates = onValue(ref(db, "route_status_updates"), (snapshot) => {
      setRouteUpdatesData(snapshot.val() || {});
      touch();
    });

    return () => {
      unsubDrivers();
      unsubDriverLocations();
      unsubResidents();
      unsubUsers();
      unsubIssues();
      unsubReportIssues();
      unsubNotifications();
      unsubSchedules();
      unsubRoutes();
      unsubRouteUpdates();
    };
  }, []);

  const drivers = useMemo(() => toArray(driversData), [driversData]);
  const driverLocations = useMemo(
    () => toArray(driverLocationsData),
    [driverLocationsData]
  );
  const residents = useMemo(() => toArray(residentsData), [residentsData]);
  const users = useMemo(() => toArray(usersData), [usersData]);
  const issues = useMemo(
    () => [...toArray(issuesData), ...toArray(reportIssuesData)],
    [issuesData, reportIssuesData]
  );
  const notifications = useMemo(
    () => toArray(notificationsData),
    [notificationsData]
  );
  const schedules = useMemo(() => toArray(schedulesData), [schedulesData]);
  const routes = useMemo(() => toArray(routesData), [routesData]);
  const routeUpdates = useMemo(() => toArray(routeUpdatesData), [routeUpdatesData]);

  const activeTrucks = useMemo(() => {
    const activeByLocation = driverLocations.filter((item) => {
      const status = getStatus(item.status);
      const timestamp = normalizeTimestamp(item.timestamp ?? item.lastUpdated ?? item.updatedAt);

      if (status === "offline") return false;
      if (!timestamp) return false;

      return Date.now() - timestamp <= 10 * 60 * 1000;
    }).length;

    if (activeByLocation > 0) return activeByLocation;

    return drivers.filter((item) => {
      const status = getStatus(item.status);
      return status === "online" || status === "active" || status === "live";
    }).length;
  }, [drivers, driverLocations]);

  const totalDrivers = drivers.length;

  const residentsCount = useMemo(() => {
    if (residents.length > 0) return residents.length;

    return users.filter((user) => {
      const role = getStatus(user.role || user.userType || user.type);
      return role === "resident";
    }).length;
  }, [residents, users]);

  const openIssues = useMemo(() => issues.filter(isOpenIssue).length, [issues]);

  const completedSchedules = useMemo(
    () => schedules.filter(isCompletedSchedule).length,
    [schedules]
  );

  const compliance = useMemo(() => {
    if (schedules.length === 0) return 0;
    return Math.round((completedSchedules / schedules.length) * 100);
  }, [completedSchedules, schedules.length]);

  const upcomingSchedules = useMemo(
    () => schedules.filter(isUpcomingSchedule).length,
    [schedules]
  );

  const assignedRoutes = useMemo(() => {
    return routes.filter((route) => {
      const status = getStatus(route.status || route.routeStatus);
      return !["inactive", "disabled", "archived", "cancelled"].includes(status);
    }).length;
  }, [routes]);

  const onlineText = totalDrivers
    ? `${activeTrucks} of ${totalDrivers} online/live`
    : "No driver accounts yet";

  const recentActivity = useMemo<DashboardEvent[]>(() => {
    const events: DashboardEvent[] = [];

    driverLocations.forEach((item) => {
      const timestamp = normalizeTimestamp(item.timestamp ?? item.lastUpdated ?? item.updatedAt);
      if (!timestamp) return;

      events.push({
        id: `loc-${item.id}`,
        type: "driver",
        title: item.name || item.driverName || "Driver GPS updated",
        subtitle:
          item.assignedRouteName ||
          item.routeName ||
          (Array.isArray(item.assignedBarangays)
            ? item.assignedBarangays.join(", ")
            : typeof item.assignedBarangays === "string"
              ? item.assignedBarangays
              : "Live location received"),
        timestamp,
      });
    });

    notifications.forEach((item) => {
      const timestamp = normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.date);
      if (!timestamp) return;

      events.push({
        id: `notif-${item.id}`,
        type: "notification",
        title: item.title || item.name || "Notification sent",
        subtitle: item.message || item.body || "Resident notification activity",
        timestamp,
      });
    });

    issues.forEach((item) => {
      const timestamp = normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt ?? item.date);
      if (!timestamp) return;

      events.push({
        id: `issue-${item.id}`,
        type: "issue",
        title: item.title || item.subject || item.issueType || "Issue submitted",
        subtitle:
          item.barangay ||
          item.location?.barangay ||
          item.description ||
          item.reporterName ||
          "Resident issue activity",
        timestamp,
      });
    });

    schedules.forEach((item) => {
      const timestamp = normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt ?? item.scheduledAt);
      if (!timestamp) return;

      events.push({
        id: `schedule-${item.id}`,
        type: "schedule",
        title: item.title || item.routeName || "Collection schedule updated",
        subtitle:
          item.barangay ||
          item.barangays?.join?.(", ") ||
          item.purokLabel ||
          "Schedule activity",
        timestamp,
      });
    });

    routeUpdates.forEach((item) => {
      const timestamp = normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt);
      if (!timestamp) return;

      events.push({
        id: `route-update-${item.id}`,
        type: "route",
        title: item.title || item.status || "Route status updated",
        subtitle: item.routeName || item.barangay || item.message || "Route activity",
        timestamp,
      });
    });

    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  }, [driverLocations, notifications, issues, schedules, routeUpdates]);

  const weeklyActivity = useMemo(() => {
    const today = new Date();
    const buckets: { key: string; label: string; value: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      buckets.push({
        key: getDayKey(d),
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        value: 0,
      });
    }

    const increaseBucket = (timestamp: number) => {
      if (!timestamp) return;
      const key = getDayKey(new Date(timestamp));
      const bucket = buckets.find((item) => item.key === key);
      if (bucket) bucket.value += 1;
    };

    driverLocations.forEach((item) => {
      increaseBucket(normalizeTimestamp(item.timestamp ?? item.lastUpdated ?? item.updatedAt));
    });

    notifications.forEach((item) => {
      increaseBucket(normalizeTimestamp(item.timestamp ?? item.createdAt));
    });

    issues.forEach((item) => {
      increaseBucket(normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt));
    });

    schedules.forEach((item) => {
      increaseBucket(normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt));
    });

    routeUpdates.forEach((item) => {
      increaseBucket(normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.updatedAt));
    });

    return {
      items: buckets,
      max: Math.max(...buckets.map((item) => item.value), 1),
      total: buckets.reduce((sum, item) => sum + item.value, 0),
    };
  }, [driverLocations, notifications, issues, schedules, routeUpdates]);

  return (
    <DashboardShell
      title="Dashboard"
      description="Realtime overview of EcoTrack operations"
      hidePageHeader
    >
      <section className="dashboard-page">
        <div className="hero-card">
          <div>
            <span className="hero-kicker">Operations Command Center</span>
            <h1>Waste collection overview</h1>
            <p>
              Monitor drivers, residents, schedules, route activity, and reported issues from one realtime dashboard.
            </p>
          </div>

          <div className="hero-status">
            <span className="pulse" />
            <div>
              <strong>Live database</strong>
              <small>Updated {formatRelativeTime(lastUpdated)}</small>
            </div>
          </div>
        </div>

        <div className="quick-actions">
          <Link href="/live-map">Open Live Map</Link>
          <Link href="/routes">Manage Routes</Link>
          <Link href="/users">View Users</Link>
          <Link href="/issues">Review Issues</Link>
        </div>

        <div className="metric-grid">
          <MetricCard
            label="Active Trucks"
            value={activeTrucks}
            helper={onlineText}
            tone="green"
            icon="🚚"
          />

          <MetricCard
            label="Residents"
            value={residentsCount}
            helper="Registered resident accounts"
            tone="blue"
            icon="🏘️"
          />

          <MetricCard
            label="Open Issues"
            value={openIssues}
            helper={openIssues > 0 ? "Needs admin review" : "No open issues"}
            tone={openIssues > 0 ? "red" : "green"}
            icon="⚠️"
          />

          <MetricCard
            label="Completion"
            value={`${compliance}%`}
            helper={`${completedSchedules} of ${schedules.length} schedules completed`}
            tone="dark"
            icon="✓"
          />
        </div>

        <div className="flow-grid">
          <div className="flow-card">
            <div className="flow-icon green">1</div>
            <div>
              <strong>Route planning</strong>
              <span>{assignedRoutes} active route{assignedRoutes === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="flow-card">
            <div className="flow-icon blue">2</div>
            <div>
              <strong>Driver tracking</strong>
              <span>{activeTrucks} truck{activeTrucks === 1 ? "" : "s"} reporting live</span>
            </div>
          </div>

          <div className="flow-card">
            <div className="flow-icon amber">3</div>
            <div>
              <strong>Collection schedules</strong>
              <span>{upcomingSchedules} upcoming or active schedule{upcomingSchedules === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="flow-card">
            <div className="flow-icon red">4</div>
            <div>
              <strong>Resident support</strong>
              <span>{openIssues} open issue{openIssues === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>

        <div className="content-grid">
          <section className="panel chart-panel">
            <div className="panel-header">
              <div>
                <span>Last 7 Days</span>
                <h2>Weekly activity</h2>
              </div>
              <strong>{weeklyActivity.total} total events</strong>
            </div>

            <div className="chart-wrap" aria-label="Weekly activity chart">
              <div className="chart-grid-lines">
                <span />
                <span />
                <span />
              </div>

              <div className="bar-chart">
                {weeklyActivity.items.map((item) => {
                  const height = Math.max(10, (item.value / weeklyActivity.max) * 100);

                  return (
                    <div className="bar-item" key={item.key}>
                      <div className="bar-value">{item.value}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ height: `${height}%` }} />
                      </div>
                      <div className="bar-label">{item.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="panel activity-panel">
            <div className="panel-header compact">
              <div>
                <span>Realtime Feed</span>
                <h2>Recent activity</h2>
              </div>
            </div>

            <div className="activity-list">
              {recentActivity.length === 0 ? (
                <div className="empty-state">
                  <strong>No recent activity yet</strong>
                  <p>Driver GPS updates, issues, alerts, and schedules will appear here.</p>
                </div>
              ) : (
                recentActivity.map((activity) => (
                  <article className="activity-item" key={activity.id}>
                    <div className={`activity-badge ${getEventClass(activity.type)}`}>
                      {getEventBadge(activity.type)}
                    </div>

                    <div className="activity-body">
                      <div className="activity-title-row">
                        <strong>{activity.title}</strong>
                        <time>{formatRelativeTime(activity.timestamp)}</time>
                      </div>
                      <p>{activity.subtitle}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </section>

      <style jsx>{`
        .dashboard-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: #0f172a;
        }

        .hero-card {
          position: relative;
          overflow: hidden;
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-end;
          border-radius: 28px;
          padding: 26px;
          border: 1px solid #dbeafe;
          background:
            radial-gradient(circle at top right, rgba(34, 197, 94, 0.22), transparent 35%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 44%, #ecfdf5 100%);
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        }

        .hero-card::before {
          content: "";
          position: absolute;
          inset: auto -70px -90px auto;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.16);
        }

        .hero-kicker {
          display: inline-flex;
          width: fit-content;
          border-radius: 999px;
          padding: 7px 11px;
          background: #ecfdf5;
          color: #047857;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .hero-card h1 {
          margin: 16px 0 0;
          font-size: clamp(28px, 4vw, 44px);
          line-height: 1;
          letter-spacing: -0.05em;
          color: #0f172a;
        }

        .hero-card p {
          max-width: 660px;
          margin: 12px 0 0;
          color: #475569;
          font-size: 15px;
          line-height: 1.6;
        }

        .hero-status {
          position: relative;
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 12px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid #e2e8f0;
          padding: 13px 15px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        }

        .pulse {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 0 7px rgba(34, 197, 94, 0.16);
        }

        .hero-status strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
        }

        .hero-status small {
          display: block;
          margin-top: 2px;
          color: #64748b;
          font-size: 12px;
        }

        .quick-actions {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .quick-actions a {
          min-height: 48px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #ffffff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
          transition: 0.18s ease;
        }

        .quick-actions a:hover {
          transform: translateY(-1px);
          border-color: #10b981;
          color: #047857;
          box-shadow: 0 16px 30px rgba(15, 23, 42, 0.08);
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .metric-card {
          position: relative;
          overflow: hidden;
          min-height: 150px;
          border-radius: 24px;
          padding: 20px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 14px 32px rgba(15, 23, 42, 0.06);
        }

        .metric-card::after {
          content: "";
          position: absolute;
          right: -40px;
          top: -40px;
          width: 112px;
          height: 112px;
          border-radius: 50%;
          background: #f1f5f9;
        }

        .metric-card.green::after { background: #dcfce7; }
        .metric-card.blue::after { background: #dbeafe; }
        .metric-card.red::after { background: #fee2e2; }
        .metric-card.dark {
          background: linear-gradient(135deg, #064e3b, #047857);
          border-color: #065f46;
          color: #ffffff;
        }
        .metric-card.dark::after { background: rgba(255, 255, 255, 0.12); }

        .metric-top {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .metric-label {
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
        }

        .metric-card.dark .metric-label,
        .metric-card.dark .metric-helper {
          color: #d1fae5;
        }

        .metric-icon {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 15px;
          background: #f8fafc;
          font-weight: 900;
        }

        .metric-card.dark .metric-icon {
          background: rgba(255, 255, 255, 0.14);
        }

        .metric-value {
          position: relative;
          z-index: 1;
          margin-top: 20px;
          color: inherit;
          font-size: 42px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .metric-helper {
          position: relative;
          z-index: 1;
          margin-top: 10px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.45;
        }

        .flow-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .flow-card {
          display: flex;
          gap: 12px;
          align-items: center;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 16px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
        }

        .flow-icon {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          font-weight: 950;
        }

        .flow-icon.green { background: #dcfce7; color: #047857; }
        .flow-icon.blue { background: #dbeafe; color: #1d4ed8; }
        .flow-icon.amber { background: #fef3c7; color: #92400e; }
        .flow-icon.red { background: #fee2e2; color: #b91c1c; }

        .flow-card strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
        }

        .flow-card span {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
        }

        .content-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(360px, 0.85fr);
          gap: 16px;
        }

        .panel {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 26px;
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          padding: 20px 22px 0;
        }

        .panel-header span {
          color: #059669;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .panel-header h2 {
          margin: 6px 0 0;
          color: #0f172a;
          font-size: 20px;
          letter-spacing: -0.03em;
        }

        .panel-header strong {
          border-radius: 999px;
          background: #f1f5f9;
          color: #334155;
          padding: 8px 11px;
          font-size: 12px;
          white-space: nowrap;
        }

        .panel-header.compact {
          padding-bottom: 12px;
        }

        .chart-wrap {
          position: relative;
          height: 360px;
          margin: 14px 22px 22px;
          border-radius: 20px;
          background: linear-gradient(180deg, #f8fafc, #ffffff);
          border: 1px solid #edf2f7;
          padding: 22px 18px 18px;
        }

        .chart-grid-lines {
          position: absolute;
          inset: 44px 18px 56px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          pointer-events: none;
        }

        .chart-grid-lines span {
          display: block;
          border-top: 1px dashed #dbe3ef;
        }

        .bar-chart {
          position: relative;
          z-index: 1;
          height: 100%;
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 14px;
          align-items: end;
        }

        .bar-item {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
        }

        .bar-value {
          min-height: 18px;
          color: #334155;
          font-size: 12px;
          font-weight: 900;
        }

        .bar-track {
          width: 100%;
          max-width: 46px;
          height: 230px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          border-radius: 999px;
          background: #eef2f7;
          padding: 4px;
        }

        .bar-fill {
          width: 100%;
          border-radius: 999px;
          background: linear-gradient(180deg, #22c55e, #059669);
          box-shadow: 0 10px 20px rgba(5, 150, 105, 0.24);
          transition: height 0.25s ease;
        }

        .bar-label {
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .activity-panel {
          min-height: 420px;
        }

        .activity-list {
          display: flex;
          flex-direction: column;
          padding: 0 18px 18px;
          max-height: 430px;
          overflow: auto;
        }

        .activity-item {
          display: flex;
          gap: 12px;
          padding: 14px 4px;
          border-bottom: 1px solid #edf2f7;
        }

        .activity-item:last-child {
          border-bottom: 0;
        }

        .activity-badge {
          width: 42px;
          height: 34px;
          flex: 0 0 42px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          font-size: 10px;
          font-weight: 950;
        }

        .activity-badge.green { background: #dcfce7; color: #047857; }
        .activity-badge.blue { background: #dbeafe; color: #1d4ed8; }
        .activity-badge.red { background: #fee2e2; color: #b91c1c; }
        .activity-badge.amber { background: #fef3c7; color: #92400e; }
        .activity-badge.slate { background: #f1f5f9; color: #475569; }

        .activity-body {
          min-width: 0;
          flex: 1;
        }

        .activity-title-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .activity-title-row strong {
          color: #0f172a;
          font-size: 13px;
          line-height: 1.35;
        }

        .activity-title-row time {
          flex: 0 0 auto;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .activity-body p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .empty-state {
          margin: 18px 0 0;
          border-radius: 18px;
          border: 1px dashed #cbd5e1;
          background: #f8fafc;
          padding: 28px;
          text-align: center;
        }

        .empty-state strong {
          display: block;
          color: #0f172a;
          font-size: 15px;
        }

        .empty-state p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        @media (max-width: 1180px) {
          .metric-grid,
          .flow-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .content-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .hero-card {
            flex-direction: column;
            align-items: flex-start;
            padding: 22px;
          }

          .hero-status {
            width: 100%;
          }

          .quick-actions,
          .metric-grid,
          .flow-grid {
            grid-template-columns: 1fr;
          }

          .chart-wrap {
            height: 320px;
            margin: 12px;
          }

          .bar-chart {
            gap: 8px;
          }

          .bar-track {
            max-width: 34px;
          }
        }
      `}</style>
    </DashboardShell>
  );
}

function MetricCard({
  label,
  value,
  helper,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "green" | "blue" | "red" | "dark";
  icon: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-helper">{helper}</div>
    </article>
  );
}
