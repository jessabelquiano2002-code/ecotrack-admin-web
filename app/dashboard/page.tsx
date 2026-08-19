"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
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
    schedule.timestamp ??
      schedule.scheduledAt ??
      schedule.date ??
      schedule.createdAt,
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

function IconWrap({ children }: { children: ReactNode }) {
  return <span className="ui-icon">{children}</span>;
}

const TruckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h11v10H3V5Zm12 4h3.6L22 12.5V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.3l-1.6-2H15Z" />
  </svg>
);

const UsersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8.5-1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM8 13c-4 0-7 2-7 4.7V21h14v-3.3C15 15 12 13 8 13Zm8.5-.5c-.8 0-1.6.1-2.3.3 1.8 1.1 2.8 2.7 2.8 4.7V21h6v-3.2c0-3-2.8-5.3-6.5-5.3Z" />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2 1.8 20h20.4L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V8h2v5Z" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.3 14.3-4-4 1.4-1.4 2.6 2.6 5.2-5.2 1.4 1.4-6.6 6.6Z" />
  </svg>
);

const RouteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9c0 5 12 2 12 6h-2c0-2-12 1-12-6h2Z" />
  </svg>
);

const MapIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2C8.4 2 5.5 4.9 5.5 8.5c0 4.7 6.5 13.5 6.5 13.5s6.5-8.8 6.5-13.5C18.5 4.9 15.6 2 12 2Zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
  </svg>
);

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm11 8H6v10h12V10ZM6 8h12V6H6v2Z" />
  </svg>
);

const SupportIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h3v-8H5a7 7 0 0 1 14 0h-4v8h2.2A4.8 4.8 0 0 1 13 21h-2v2h2a6.8 6.8 0 0 0 6.6-5.2A3 3 0 0 0 21 15v-4a9 9 0 0 0-9-9Z" />
  </svg>
);

function HeroTruckIllustration() {
  return (
    <svg
      className="hero-truck-svg"
      viewBox="0 0 520 210"
      role="img"
      aria-label="Metro Waste collection truck illustration"
    >
      <defs>
        <linearGradient id="heroTruckBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#79ee59" />
          <stop offset=".55" stopColor="#22c55e" />
          <stop offset="1" stopColor="#058a50" />
        </linearGradient>
        <linearGradient id="heroTruckCab" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7eea6b" />
          <stop offset="1" stopColor="#0e9f58" />
        </linearGradient>
        <linearGradient id="heroGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d8fff2" stopOpacity=".95" />
          <stop offset="1" stopColor="#5fae9c" stopOpacity=".55" />
        </linearGradient>
        <filter id="truckShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#001a11" floodOpacity=".42" />
        </filter>
      </defs>

      <g className="hero-city" opacity=".28">
        <path d="M0 176V122h29v54M35 176V102h34v74M75 176V136h22v40M104 176V83h43v93M154 176V120h26v56M187 176V72h40v104M236 176V116h34v60M278 176V88h38v88M324 176V128h28v48M360 176V76h42v100M409 176V111h33v65M449 176V92h39v84M495 176V131h25" />
        <path d="M0 176h520" />
      </g>

      <path
        className="hero-road"
        d="M0 180C120 168 212 168 313 176c78 6 145 7 207-4v38H0Z"
        fill="rgba(0,0,0,.24)"
      />

      <g className="truck-float" filter="url(#truckShadow)">
        <path
          d="M163 60h180c17 0 31 13 31 30v64H154V70c0-6 4-10 9-10Z"
          fill="url(#heroTruckBody)"
        />
        <path
          d="M343 82h54c14 0 27 7 34 19l18 31v22h-87V91c0-5-4-9-9-9h-10Z"
          fill="url(#heroTruckCab)"
        />
        <path d="M374 95h31c8 0 14 4 18 10l11 19h-60V95Z" fill="url(#heroGlass)" />
        <path d="M152 74 185 50h168l-10 24H152Z" fill="#95f16e" opacity=".95" />
        <path d="M190 80h126" stroke="#caffae" strokeWidth="5" strokeLinecap="round" opacity=".65" />
        <path d="M185 104h146" stroke="#0a7049" strokeWidth="2" opacity=".55" />
        <rect x="181" y="115" width="112" height="29" rx="6" fill="rgba(0,72,43,.42)" />
        <text x="237" y="129" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="900">
          METRO WASTE
        </text>
        <text x="237" y="140" textAnchor="middle" fill="#d8ffe3" fontSize="7.5" fontWeight="800" letterSpacing="2">
          CATBALOGAN
        </text>
        <path d="M429 132h19" stroke="#d7ffe2" strokeWidth="4" strokeLinecap="round" />
        <circle cx="206" cy="160" r="24" fill="#06261b" />
        <circle cx="206" cy="160" r="11" fill="#a8b8b2" />
        <circle cx="397" cy="160" r="24" fill="#06261b" />
        <circle cx="397" cy="160" r="11" fill="#a8b8b2" />
        <path d="M148 154h302" stroke="#183e31" strokeWidth="8" strokeLinecap="round" />
        <path d="M345 63c18 8 28 14 42 31" stroke="#d4ffc2" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      </g>

      <g className="leaf leaf-one" fill="#4add5f" opacity=".7">
        <path d="M480 62c-15 2-24 11-26 26 16-2 25-11 26-26Z" />
      </g>
      <g className="leaf leaf-two" fill="#82ee6a" opacity=".55">
        <path d="M492 83c-11 0-19 7-23 19 12 0 20-7 23-19Z" />
      </g>
    </svg>
  );
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
    [driverLocationsData],
  );
  const residents = useMemo(() => toArray(residentsData), [residentsData]);
  const users = useMemo(() => toArray(usersData), [usersData]);
  const issues = useMemo(
    () => [...toArray(issuesData), ...toArray(reportIssuesData)],
    [issuesData, reportIssuesData],
  );
  const notifications = useMemo(
    () => toArray(notificationsData),
    [notificationsData],
  );
  const schedules = useMemo(() => toArray(schedulesData), [schedulesData]);
  const routes = useMemo(() => toArray(routesData), [routesData]);
  const routeUpdates = useMemo(
    () => toArray(routeUpdatesData),
    [routeUpdatesData],
  );

  const activeTrucks = useMemo(() => {
    const activeByLocation = driverLocations.filter((item) => {
      const status = getStatus(item.status);
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.lastUpdated ?? item.updatedAt,
      );

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
    [schedules],
  );

  const compliance = useMemo(() => {
    if (schedules.length === 0) return 0;
    return Math.round((completedSchedules / schedules.length) * 100);
  }, [completedSchedules, schedules.length]);

  const upcomingSchedules = useMemo(
    () => schedules.filter(isUpcomingSchedule).length,
    [schedules],
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
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.lastUpdated ?? item.updatedAt,
      );
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
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.createdAt ?? item.date,
      );
      if (!timestamp) return;

      events.push({
        id: `notif-${item.id}`,
        type: "notification",
        title: item.title || item.name || "Notification sent",
        subtitle:
          item.message || item.body || "Resident notification activity",
        timestamp,
      });
    });

    issues.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ??
          item.createdAt ??
          item.updatedAt ??
          item.date,
      );
      if (!timestamp) return;

      events.push({
        id: `issue-${item.id}`,
        type: "issue",
        title:
          item.title ||
          item.subject ||
          item.issueType ||
          "Issue submitted",
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
      const timestamp = normalizeTimestamp(
        item.timestamp ??
          item.createdAt ??
          item.updatedAt ??
          item.scheduledAt,
      );
      if (!timestamp) return;

      events.push({
        id: `schedule-${item.id}`,
        type: "schedule",
        title:
          item.title ||
          item.routeName ||
          "Collection schedule updated",
        subtitle:
          item.barangay ||
          item.barangays?.join?.(", ") ||
          item.purokLabel ||
          "Schedule activity",
        timestamp,
      });
    });

    routeUpdates.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.createdAt ?? item.updatedAt,
      );
      if (!timestamp) return;

      events.push({
        id: `route-update-${item.id}`,
        type: "route",
        title: item.title || item.status || "Route status updated",
        subtitle:
          item.routeName ||
          item.barangay ||
          item.message ||
          "Route activity",
        timestamp,
      });
    });

    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  }, [
    driverLocations,
    notifications,
    issues,
    schedules,
    routeUpdates,
  ]);

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
      increaseBucket(
        normalizeTimestamp(
          item.timestamp ?? item.lastUpdated ?? item.updatedAt,
        ),
      );
    });

    notifications.forEach((item) => {
      increaseBucket(
        normalizeTimestamp(item.timestamp ?? item.createdAt),
      );
    });

    issues.forEach((item) => {
      increaseBucket(
        normalizeTimestamp(
          item.timestamp ?? item.createdAt ?? item.updatedAt,
        ),
      );
    });

    schedules.forEach((item) => {
      increaseBucket(
        normalizeTimestamp(
          item.timestamp ?? item.createdAt ?? item.updatedAt,
        ),
      );
    });

    routeUpdates.forEach((item) => {
      increaseBucket(
        normalizeTimestamp(
          item.timestamp ?? item.createdAt ?? item.updatedAt,
        ),
      );
    });

    return {
      items: buckets,
      max: Math.max(...buckets.map((item) => item.value), 1),
      total: buckets.reduce((sum, item) => sum + item.value, 0),
    };
  }, [
    driverLocations,
    notifications,
    issues,
    schedules,
    routeUpdates,
  ]);

  return (
    <DashboardShell
      title="Dashboard"
      description="Realtime overview of WasteTrack operations"
      hidePageHeader
    >
      <section className="dashboard-page">
        <section className="dashboard-hero reveal reveal-1">
          <div className="hero-grid-overlay" aria-hidden="true" />

          <div className="hero-copy">
            <span className="hero-kicker">
              <span className="hero-kicker-dot" />
              Operations Command Center
            </span>

            <h1>Waste collection overview</h1>

            <p>
              Monitor drivers, residents, schedules, route activity, and
              reported issues from one realtime dashboard.
            </p>

            <div className="hero-actions">
              <Link href="/live-map" className="hero-primary">
                <IconWrap>
                  <MapIcon />
                </IconWrap>
                Open Live Map
              </Link>

              <Link href="/routes" className="hero-secondary">
                <IconWrap>
                  <RouteIcon />
                </IconWrap>
                Manage Routes
              </Link>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <HeroTruckIllustration />
          </div>

          <div className="hero-status">
            <span className="live-radar">
              <span />
            </span>
            <div>
              <strong>Live database</strong>
              <small>Updated {formatRelativeTime(lastUpdated)}</small>
            </div>
          </div>
        </section>

        <section className="metric-grid reveal reveal-2">
          <MetricCard
            label="Active Trucks"
            value={activeTrucks}
            helper={onlineText}
            tone="green"
            icon={<TruckIcon />}
          />

          <MetricCard
            label="Residents"
            value={residentsCount}
            helper="Registered resident accounts"
            tone="cyan"
            icon={<UsersIcon />}
          />

          <MetricCard
            label="Open Issues"
            value={openIssues}
            helper={
              openIssues > 0
                ? "Needs admin review"
                : "No open issues"
            }
            tone={openIssues > 0 ? "amber" : "green"}
            icon={<AlertIcon />}
          />

          <MetricCard
            label="Completion"
            value={`${compliance}%`}
            helper={`${completedSchedules} of ${schedules.length} schedules completed`}
            tone="emerald"
            icon={<CheckIcon />}
            progress={compliance}
          />
        </section>

        <section className="flow-grid reveal reveal-3">
          <FlowCard
            index="1"
            label="Route planning"
            helper={`${assignedRoutes} active route${assignedRoutes === 1 ? "" : "s"}`}
            tone="green"
            icon={<RouteIcon />}
          />

          <FlowCard
            index="2"
            label="Driver tracking"
            helper={`${activeTrucks} truck${activeTrucks === 1 ? "" : "s"} reporting live`}
            tone="blue"
            icon={<MapIcon />}
          />

          <FlowCard
            index="3"
            label="Collection schedules"
            helper={`${upcomingSchedules} upcoming or active schedule${upcomingSchedules === 1 ? "" : "s"}`}
            tone="amber"
            icon={<CalendarIcon />}
          />

          <FlowCard
            index="4"
            label="Resident support"
            helper={`${openIssues} open issue${openIssues === 1 ? "" : "s"}`}
            tone="red"
            icon={<SupportIcon />}
          />
        </section>

        <section className="dashboard-content-grid reveal reveal-4">
          <section className="dashboard-panel activity-chart-panel">
            <div className="panel-header">
              <div>
                <span>Last 7 Days</span>
                <h2>Weekly activity</h2>
                <p>
                  Realtime operational events recorded across WasteTrack.
                </p>
              </div>

              <div className="panel-total">
                <strong>{weeklyActivity.total}</strong>
                <span>total events</span>
              </div>
            </div>

            <div
              className="chart-wrap"
              aria-label="Weekly activity chart"
            >
              <div className="chart-axis" aria-hidden="true">
                <span>{weeklyActivity.max}</span>
                <span>{Math.round(weeklyActivity.max * 0.66)}</span>
                <span>{Math.round(weeklyActivity.max * 0.33)}</span>
                <span>0</span>
              </div>

              <div className="chart-grid-lines" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>

              <div className="bar-chart">
                {weeklyActivity.items.map((item, index) => {
                  const height =
                    item.value === 0
                      ? 4
                      : Math.max(
                          10,
                          (item.value / weeklyActivity.max) * 100,
                        );

                  return (
                    <div className="bar-item" key={item.key}>
                      <div className="bar-value">{item.value}</div>

                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            height: `${height}%`,
                            animationDelay: `${120 + index * 80}ms`,
                          }}
                        />
                      </div>

                      <div className="bar-label">{item.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="chart-summary-grid">
              <SummaryStat
                label="Active trucks"
                value={activeTrucks}
                helper="Realtime"
                tone="green"
              />
              <SummaryStat
                label="Open issues"
                value={openIssues}
                helper="Current"
                tone="amber"
              />
              <SummaryStat
                label="Residents"
                value={residentsCount}
                helper="Registered"
                tone="blue"
              />
            </div>
          </section>

          <section className="dashboard-panel realtime-panel">
            <div className="panel-header realtime-head">
              <div>
                <span>Realtime Feed</span>
                <h2>Recent activity</h2>
                <p>Latest operational updates from Firebase.</p>
              </div>

              <Link href="/notifications" className="view-all-link">
                View all
              </Link>
            </div>

            <div className="activity-list">
              {recentActivity.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <TruckIcon />
                  </div>
                  <strong>No recent activity yet</strong>
                  <p>
                    Driver GPS updates, issues, alerts, and schedules
                    will appear here.
                  </p>
                </div>
              ) : (
                recentActivity.map((activity, index) => (
                  <article
                    className="activity-item"
                    key={activity.id}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <div
                      className={`activity-badge ${getEventClass(
                        activity.type,
                      )}`}
                    >
                      {getEventBadge(activity.type)}
                    </div>

                    <div className="activity-body">
                      <div className="activity-title-row">
                        <strong>{activity.title}</strong>
                        <time>
                          {formatRelativeTime(activity.timestamp)}
                        </time>
                      </div>
                      <p>{activity.subtitle}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </section>

      <style jsx global>{`
        /*
         * FINAL ACCESSIBLE METRO WASTE DASHBOARD SHELL
         * Dark Metro/Catbalogan branding is kept in the sidebar and hero.
         * The working area is intentionally light for stronger readability.
         */
        .admin-shell {
          background: #f3f7f4 !important;
        }

        .admin-main {
          background: #f3f7f4 !important;
        }

        .admin-content {
          background:
            radial-gradient(circle at 88% 0%, rgba(22, 138, 74, .07), transparent 26%),
            linear-gradient(180deg, #f7faf8 0%, #f2f6f3 100%) !important;
          padding: 26px 28px 34px !important;
        }

        .admin-topbar {
          min-height: 76px !important;
          background: rgba(255, 255, 255, .97) !important;
          border-bottom: 1px solid #dbe6df !important;
          box-shadow: 0 6px 24px rgba(16, 35, 27, .055) !important;
          backdrop-filter: blur(16px) !important;
        }

        .admin-search-wrap {
          min-height: 48px !important;
          background: #ffffff !important;
          border: 1px solid #cddbd2 !important;
          box-shadow: 0 5px 16px rgba(16, 35, 27, .04) !important;
        }

        .admin-search-wrap:focus-within {
          border-color: #168a4a !important;
          box-shadow: 0 0 0 4px rgba(22, 138, 74, .13) !important;
        }

        .admin-search {
          color: #10231b !important;
          font-size: 15px !important;
        }

        .admin-search::placeholder {
          color: #66786f !important;
        }

        .admin-search-icon {
          color: #4d6658 !important;
        }

        .admin-search-shortcut {
          color: #42574c !important;
          background: #f4f7f5 !important;
          border-color: #d8e2dc !important;
          font-size: 12px !important;
        }

        .admin-icon-btn {
          width: 48px !important;
          height: 48px !important;
          background: #ffffff !important;
          border: 1px solid #d5e0d9 !important;
          color: #173b2b !important;
          box-shadow: 0 5px 16px rgba(16, 35, 27, .045) !important;
        }

        .admin-icon-btn:hover,
        .admin-profile-mini:hover {
          background: #eef7f1 !important;
          border-color: #b9d2c2 !important;
        }

        .admin-profile-name {
          color: #10231b !important;
          font-size: 15px !important;
        }

        .admin-profile-role,
        .admin-chevron {
          color: #596d62 !important;
        }

        .admin-mobile-menu {
          background: #ffffff !important;
          color: #174834 !important;
          border-color: #cfddd4 !important;
        }

        @media (max-width: 900px) {
          .admin-content {
            padding: 20px 16px 28px !important;
          }
        }
      `}</style>

      <style jsx global>{`
        /*
         * FINAL METRO WASTE CATBALOGAN DASHBOARD
         * Accessibility-oriented hybrid theme for administrators of all ages.
         * Main content: light, high contrast.
         * Brand/hero: Metro green.
         */

        :root {
          --mw-green-950: #063d2b;
          --mw-green-900: #084a34;
          --mw-green-800: #0d6241;
          --mw-green-700: #168a4a;
          --mw-green-600: #1f9d55;
          --mw-green-500: #29b65f;
          --mw-green-100: #e8f6ed;
          --mw-green-50: #f3faf5;

          --mw-text: #10231b;
          --mw-text-soft: #52665c;
          --mw-muted: #6b7d73;
          --mw-border: #d8e4dc;
          --mw-panel: #ffffff;
          --mw-bg: #f3f7f4;

          --mw-blue: #2563a8;
          --mw-blue-soft: #e9f2fc;
          --mw-amber: #a6670e;
          --mw-amber-soft: #fff3d7;
          --mw-red: #b53b32;
          --mw-red-soft: #fdecea;
        }

        .dashboard-page {
          position: relative;
          width: 100%;
          max-width: 1680px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: var(--mw-text);
        }

        .reveal {
          opacity: 0;
          transform: translateY(10px);
          animation: dashboardReveal 430ms cubic-bezier(.2,.75,.25,1) forwards;
        }

        .reveal-1 { animation-delay: 20ms; }
        .reveal-2 { animation-delay: 80ms; }
        .reveal-3 { animation-delay: 130ms; }
        .reveal-4 { animation-delay: 180ms; }

        @keyframes dashboardReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* =========================
           HERO / BRAND AREA
           ========================= */
        .dashboard-hero {
          position: relative;
          min-height: 262px;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.02fr) minmax(430px, .98fr);
          align-items: stretch;
          border: 1px solid rgba(68, 182, 103, .35);
          border-radius: 24px;
          background:
            radial-gradient(circle at 76% 15%, rgba(72, 214, 95, .14), transparent 28%),
            linear-gradient(105deg, #073f2c 0%, #064a33 44%, #043323 100%);
          box-shadow: 0 18px 42px rgba(13, 67, 45, .14);
        }

        .dashboard-hero::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(0,0,0,.03), rgba(0,0,0,.10)),
            radial-gradient(circle at 90% 50%, rgba(99, 235, 114, .10), transparent 26%);
        }

        .hero-grid-overlay {
          position: absolute;
          inset: 0;
          opacity: .12;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(112, 242, 148, .17) 1px, transparent 1px),
            linear-gradient(90deg, rgba(112, 242, 148, .17) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: linear-gradient(90deg, rgba(0,0,0,.85), transparent 76%);
        }

        .hero-copy {
          position: relative;
          z-index: 4;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 30px 30px 32px;
        }

        .hero-kicker {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 8px 12px;
          border: 1px solid rgba(91, 233, 111, .38);
          border-radius: 999px;
          background: rgba(33, 160, 79, .18);
          color: #b9ffc2;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .hero-kicker-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #59e96c;
          box-shadow: 0 0 0 5px rgba(89, 233, 108, .14);
        }

        .hero-copy h1 {
          margin: 18px 0 0;
          color: #ffffff;
          font-size: clamp(35px, 3.4vw, 50px);
          line-height: 1.02;
          font-weight: 950;
          letter-spacing: -.045em;
          text-shadow: 0 5px 22px rgba(0,0,0,.18);
        }

        .hero-copy p {
          max-width: 620px;
          margin: 15px 0 0;
          color: #e0efe6;
          font-size: 16px;
          line-height: 1.62;
          font-weight: 500;
        }

        .hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 11px;
          margin-top: 23px;
        }

        .hero-actions a {
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 0 17px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 850;
          text-decoration: none;
          transition:
            transform 150ms ease,
            box-shadow 150ms ease,
            background 150ms ease;
        }

        .hero-primary {
          border: 1px solid #43cf63;
          background: linear-gradient(135deg, #27b75a, #148a49);
          color: #ffffff;
          box-shadow: 0 10px 22px rgba(0, 0, 0, .15);
        }

        .hero-secondary {
          border: 1px solid rgba(255,255,255,.26);
          background: rgba(255,255,255,.09);
          color: #ffffff;
        }

        .hero-actions a:hover {
          transform: translateY(-2px);
        }

        .hero-primary:hover {
          background: linear-gradient(135deg, #31c965, #168a4a);
          box-shadow: 0 14px 26px rgba(0, 0, 0, .18);
        }

        .hero-secondary:hover {
          background: rgba(255,255,255,.15);
        }

        .hero-actions .ui-icon {
          width: 20px;
          height: 20px;
        }

        .hero-visual {
          position: relative;
          z-index: 2;
          min-height: 262px;
          display: flex;
          align-items: end;
          justify-content: flex-end;
          overflow: hidden;
        }

        .hero-visual::after {
          content: "";
          position: absolute;
          right: 7%;
          bottom: 12%;
          width: 68%;
          height: 25%;
          border-radius: 50%;
          background: rgba(92, 227, 105, .13);
          filter: blur(24px);
        }

        .hero-visual .hero-truck-svg {
          position: relative;
          z-index: 3;
          width: min(100%, 560px);
          height: auto;
          margin: 0 -4px -2px 0;
          overflow: visible;
        }

        .hero-visual .truck-float {
          transform-origin: 50% 70%;
          animation: truckFloat 5.6s ease-in-out infinite;
        }

        .hero-visual .hero-city {
          stroke: #77e087;
          fill: none;
          animation: cityGlow 4.4s ease-in-out infinite alternate;
        }

        .hero-visual .leaf-one {
          animation: leafDrift 5s ease-in-out infinite;
        }

        .hero-visual .leaf-two {
          animation: leafDrift 5.7s ease-in-out infinite reverse;
        }

        @keyframes truckFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        @keyframes cityGlow {
          from { opacity: .22; }
          to { opacity: .39; }
        }

        @keyframes leafDrift {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(-6px, -5px) rotate(-4deg); }
        }

        .hero-status {
          position: absolute;
          z-index: 6;
          right: 18px;
          top: 18px;
          display: flex;
          align-items: center;
          gap: 11px;
          min-height: 50px;
          padding: 9px 13px;
          border: 1px solid rgba(171, 255, 192, .26);
          border-radius: 14px;
          background: rgba(3, 48, 34, .88);
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 26px rgba(0, 20, 13, .18);
        }

        .live-radar {
          position: relative;
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: rgba(59, 215, 93, .13);
        }

        .live-radar::before,
        .live-radar::after {
          content: "";
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(83, 229, 108, .45);
          animation: radarPulse 2.2s ease-out infinite;
        }

        .live-radar::before {
          width: 18px;
          height: 18px;
        }

        .live-radar::after {
          width: 26px;
          height: 26px;
          animation-delay: .7s;
        }

        .live-radar span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #55e66b;
          box-shadow: 0 0 12px rgba(85, 230, 107, .75);
        }

        @keyframes radarPulse {
          0% { transform: scale(.62); opacity: .85; }
          100% { transform: scale(1.18); opacity: 0; }
        }

        .hero-status strong {
          display: block;
          color: #ffffff;
          font-size: 13px;
        }

        .hero-status small {
          display: block;
          margin-top: 3px;
          color: #d0e5d8;
          font-size: 11px;
        }

        /* =========================
           KPI CARDS
           ========================= */
        .metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .metric-card {
          --metric-color: #168a4a;
          --metric-soft: #e8f6ed;

          position: relative;
          min-height: 170px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 20px;
          border: 1px solid var(--mw-border);
          border-radius: 20px;
          background: #ffffff;
          box-shadow: 0 10px 28px rgba(16, 35, 27, .065);
          transition:
            transform 160ms ease,
            border-color 160ms ease,
            box-shadow 160ms ease;
        }

        .metric-card::after {
          content: "";
          position: absolute;
          width: 120px;
          height: 120px;
          right: -42px;
          top: -48px;
          border-radius: 50%;
          background: var(--metric-soft);
          opacity: .75;
          pointer-events: none;
        }

        .metric-card:hover {
          transform: translateY(-3px);
          border-color: #b9d3c2;
          box-shadow: 0 15px 34px rgba(16, 35, 27, .09);
        }

        .metric-card.green {
          --metric-color: #168a4a;
          --metric-soft: #e4f5e9;
        }

        .metric-card.cyan {
          --metric-color: #087f78;
          --metric-soft: #e2f5f3;
        }

        .metric-card.amber {
          --metric-color: #a6670e;
          --metric-soft: #fff2d8;
        }

        .metric-card.emerald {
          --metric-color: #117a52;
          --metric-soft: #e4f4ec;
        }

        .metric-top {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .metric-label {
          color: #2a4135;
          font-size: 15px;
          font-weight: 900;
          line-height: 1.3;
        }

        .metric-icon {
          width: 48px;
          height: 48px;
          flex: 0 0 48px;
          display: grid;
          place-items: center;
          border: 1px solid color-mix(in srgb, var(--metric-color) 22%, #ffffff);
          border-radius: 14px;
          background: var(--metric-soft);
          color: var(--metric-color);
        }

        .metric-icon svg {
          display: block;
          width: 24px !important;
          height: 24px !important;
          max-width: 24px !important;
          max-height: 24px !important;
          fill: currentColor;
        }

        .metric-value {
          position: relative;
          z-index: 2;
          margin-top: 15px;
          color: #10231b;
          font-size: 42px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -.045em;
        }

        .metric-helper {
          position: relative;
          z-index: 2;
          margin-top: 9px;
          max-width: calc(100% - 4px);
          color: #596c62;
          font-size: 14px;
          line-height: 1.45;
          font-weight: 550;
        }

        .metric-progress-wrap {
          position: absolute;
          right: 19px;
          bottom: 19px;
          width: 68px;
          height: 68px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: conic-gradient(
            var(--metric-color) calc(var(--progress) * 1%),
            #e4ebe7 0
          );
        }

        .metric-progress-wrap::after {
          content: "";
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: inset 0 0 0 1px #e2eae5;
        }

        .metric-progress-wrap span {
          position: absolute;
          z-index: 2;
          color: #1d3c2d;
          font-size: 11px;
          font-weight: 900;
        }

        /* =========================
           WORKFLOW CARDS
           ========================= */
        .flow-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 13px;
        }

        .flow-card {
          --flow-color: #168a4a;
          --flow-soft: #e8f6ed;

          min-height: 86px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 15px;
          border: 1px solid var(--mw-border);
          border-radius: 17px;
          background: #ffffff;
          box-shadow: 0 7px 20px rgba(16, 35, 27, .045);
          transition:
            transform 150ms ease,
            border-color 150ms ease,
            box-shadow 150ms ease;
        }

        .flow-card:hover {
          transform: translateY(-2px);
          border-color: #bbd2c4;
          box-shadow: 0 11px 24px rgba(16, 35, 27, .075);
        }

        .flow-card.green {
          --flow-color: #168a4a;
          --flow-soft: #e6f5ea;
        }

        .flow-card.blue {
          --flow-color: #2563a8;
          --flow-soft: #e9f2fc;
        }

        .flow-card.amber {
          --flow-color: #a6670e;
          --flow-soft: #fff2d8;
        }

        .flow-card.red {
          --flow-color: #b53b32;
          --flow-soft: #fdecea;
        }

        .flow-step {
          width: 44px;
          height: 44px;
          flex: 0 0 44px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: var(--flow-soft);
          color: var(--flow-color);
          font-size: 15px;
          font-weight: 950;
          border: 1px solid color-mix(in srgb, var(--flow-color) 22%, #ffffff);
        }

        .flow-icon {
          width: 25px;
          height: 25px;
          flex: 0 0 25px;
          display: grid;
          place-items: center;
          color: var(--flow-color);
        }

        .flow-icon svg {
          width: 23px !important;
          height: 23px !important;
          max-width: 23px !important;
          max-height: 23px !important;
          fill: currentColor;
        }

        .flow-copy {
          min-width: 0;
          flex: 1;
        }

        .flow-copy strong {
          display: block;
          color: #183226;
          font-size: 15px;
          line-height: 1.3;
        }

        .flow-copy span {
          display: block;
          margin-top: 4px;
          color: #607268;
          font-size: 13px;
          line-height: 1.4;
        }

        /* =========================
           PANELS
           ========================= */
        .dashboard-content-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.36fr) minmax(380px, .74fr);
          gap: 15px;
        }

        .dashboard-panel {
          overflow: hidden;
          border: 1px solid var(--mw-border);
          border-radius: 22px;
          background: #ffffff;
          box-shadow: 0 12px 32px rgba(16, 35, 27, .06);
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          padding: 22px 22px 0;
        }

        .panel-header > div:first-child > span {
          color: #168a4a;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: .075em;
          text-transform: uppercase;
        }

        .panel-header h2 {
          margin: 7px 0 0;
          color: #10231b;
          font-size: 23px;
          line-height: 1.2;
          letter-spacing: -.03em;
        }

        .panel-header p {
          margin: 7px 0 0;
          color: #66786f;
          font-size: 13px;
          line-height: 1.5;
        }

        .panel-total {
          min-width: 110px;
          min-height: 43px;
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 6px;
          padding: 10px 12px;
          border: 1px solid #dbe5df;
          border-radius: 12px;
          background: #f5f8f6;
        }

        .panel-total strong {
          color: #17382a;
          font-size: 16px;
        }

        .panel-total span {
          color: #61746a;
          font-size: 11px;
        }

        /* =========================
           WEEKLY CHART
           ========================= */
        .chart-wrap {
          position: relative;
          height: 350px;
          margin: 17px 22px 0;
          padding: 27px 18px 44px 48px;
          border: 1px solid #e1e9e4;
          border-radius: 18px;
          background:
            linear-gradient(180deg, #fbfdfb 0%, #f7faf8 100%);
        }

        .chart-axis {
          position: absolute;
          left: 13px;
          top: 27px;
          bottom: 45px;
          width: 31px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          color: #62766b;
          font-size: 11px;
          font-weight: 750;
        }

        .chart-grid-lines {
          position: absolute;
          inset: 31px 18px 47px 48px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          pointer-events: none;
        }

        .chart-grid-lines span {
          border-top: 1px dashed #d6e0da;
        }

        .bar-chart {
          position: relative;
          z-index: 2;
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
          gap: 8px;
        }

        .bar-value {
          min-height: 18px;
          color: #243d31;
          font-size: 12px;
          font-weight: 900;
        }

        .bar-track {
          width: 100%;
          max-width: 45px;
          height: 225px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          overflow: hidden;
          border-radius: 10px 10px 5px 5px;
          background: #e7eee9;
        }

        .bar-fill {
          width: 100%;
          min-height: 5px;
          border-radius: 10px 10px 5px 5px;
          background: linear-gradient(180deg, #43d566, #168a4a);
          box-shadow: 0 6px 14px rgba(22, 138, 74, .16);
          transform-origin: bottom;
          animation: barGrow 680ms cubic-bezier(.22,.75,.23,1) both;
        }

        @keyframes barGrow {
          from {
            transform: scaleY(.02);
            opacity: .35;
          }
          to {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        .bar-label {
          color: #4f6559;
          font-size: 12px;
          font-weight: 850;
        }

        .chart-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0;
          margin: 16px 22px 20px;
          overflow: hidden;
          border: 1px solid #dfe8e2;
          border-radius: 15px;
          background: #f8faf9;
        }

        .summary-stat {
          padding: 15px 16px;
        }

        .summary-stat + .summary-stat {
          border-left: 1px solid #e0e8e3;
        }

        .summary-stat small {
          display: block;
          color: #64776c;
          font-size: 12px;
        }

        .summary-stat strong {
          display: inline-block;
          margin-top: 5px;
          color: #10231b;
          font-size: 23px;
          letter-spacing: -.03em;
        }

        .summary-stat span {
          margin-left: 8px;
          color: var(--summary-color);
          font-size: 11px;
          font-weight: 900;
        }

        .summary-stat.green { --summary-color: #168a4a; }
        .summary-stat.amber { --summary-color: #9b620f; }
        .summary-stat.blue { --summary-color: #2563a8; }

        /* =========================
           REALTIME FEED
           ========================= */
        .realtime-head {
          align-items: center;
          padding-bottom: 12px;
        }

        .view-all-link {
          flex: 0 0 auto;
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 14px;
          border: 1px solid #cfdcd4;
          border-radius: 11px;
          background: #f7faf8;
          color: #214333;
          font-size: 13px;
          font-weight: 850;
          text-decoration: none;
          transition: background 150ms ease, border-color 150ms ease;
        }

        .view-all-link:hover {
          background: #eaf5ee;
          border-color: #afcbbb;
        }

        .activity-list {
          display: flex;
          flex-direction: column;
          max-height: 470px;
          padding: 0 17px 17px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #a7c4b2 transparent;
        }

        .activity-list::-webkit-scrollbar {
          width: 7px;
        }

        .activity-list::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #aac7b5;
        }

        .activity-item {
          display: flex;
          gap: 12px;
          min-height: 75px;
          padding: 14px 6px;
          border-bottom: 1px solid #e4ebe7;
          opacity: 0;
          transform: translateX(6px);
          animation: activityIn 340ms ease forwards;
        }

        @keyframes activityIn {
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .activity-item:last-child {
          border-bottom: 0;
        }

        .activity-badge {
          width: 43px;
          height: 34px;
          flex: 0 0 43px;
          display: grid;
          place-items: center;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .03em;
        }

        .activity-badge.green {
          background: #e5f6ea;
          color: #167c45;
          border: 1px solid #ccead6;
        }

        .activity-badge.blue {
          background: #e9f2fc;
          color: #2563a8;
          border: 1px solid #d4e5f8;
        }

        .activity-badge.red {
          background: #fdecea;
          color: #b53b32;
          border: 1px solid #f6d5d1;
        }

        .activity-badge.amber {
          background: #fff2d8;
          color: #9d650f;
          border: 1px solid #f6dfad;
        }

        .activity-badge.slate {
          background: #edf1ef;
          color: #53685d;
          border: 1px solid #dde5e0;
        }

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
          min-width: 0;
          color: #173226;
          font-size: 14px;
          line-height: 1.4;
        }

        .activity-title-row time {
          flex: 0 0 auto;
          color: #6a7c72;
          font-size: 11px;
          font-weight: 750;
          white-space: nowrap;
        }

        .activity-body p {
          margin: 5px 0 0;
          color: #5c7065;
          font-size: 13px;
          line-height: 1.45;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .empty-state {
          margin: 13px 0 0;
          padding: 40px 22px;
          text-align: center;
          border: 1px dashed #c4d5cb;
          border-radius: 15px;
          background: #f8faf9;
        }

        .empty-state-icon {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          margin: 0 auto 11px;
          border-radius: 14px;
          background: #e5f6ea;
          color: #168a4a;
        }

        .empty-state-icon svg {
          width: 24px !important;
          height: 24px !important;
          fill: currentColor;
        }

        .empty-state strong {
          display: block;
          color: #173226;
          font-size: 15px;
        }

        .empty-state p {
          margin: 6px auto 0;
          max-width: 300px;
          color: #607368;
          font-size: 13px;
          line-height: 1.5;
        }

        .ui-icon {
          display: inline-grid;
          place-items: center;
        }

        .ui-icon svg {
          display: block;
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
          fill: currentColor;
        }

        /* =========================
           RESPONSIVE
           ========================= */
        @media (max-width: 1260px) {
          .dashboard-hero {
            grid-template-columns: 1fr 430px;
          }

          .metric-grid,
          .flow-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .dashboard-content-grid {
            grid-template-columns: 1fr;
          }

          .realtime-panel {
            min-height: 430px;
          }
        }

        @media (max-width: 980px) {
          .dashboard-hero {
            grid-template-columns: 1fr;
          }

          .hero-copy {
            padding-bottom: 20px;
          }

          .hero-visual {
            min-height: 215px;
          }

          .hero-visual .hero-truck-svg {
            width: min(100%, 520px);
            margin-left: auto;
          }

          .hero-status {
            top: auto;
            bottom: 15px;
            left: 18px;
            right: auto;
          }
        }

        @media (max-width: 700px) {
          .dashboard-page {
            gap: 14px;
          }

          .dashboard-hero {
            border-radius: 18px;
          }

          .hero-copy {
            padding: 23px 18px 17px;
          }

          .hero-copy h1 {
            font-size: 35px;
          }

          .hero-copy p {
            font-size: 15px;
          }

          .hero-actions {
            flex-direction: column;
          }

          .hero-actions a {
            width: 100%;
          }

          .hero-visual {
            min-height: 190px;
          }

          .metric-grid,
          .flow-grid {
            grid-template-columns: 1fr;
          }

          .metric-card {
            min-height: 165px;
          }

          .dashboard-content-grid {
            gap: 14px;
          }

          .chart-wrap {
            height: 325px;
            margin-left: 12px;
            margin-right: 12px;
            padding-left: 40px;
          }

          .chart-grid-lines {
            left: 40px;
          }

          .bar-chart {
            gap: 7px;
          }

          .bar-track {
            max-width: 34px;
            height: 200px;
          }

          .chart-summary-grid {
            grid-template-columns: 1fr;
            margin-left: 12px;
            margin-right: 12px;
          }

          .summary-stat + .summary-stat {
            border-left: 0;
            border-top: 1px solid #e0e8e3;
          }

          .panel-header {
            padding-left: 15px;
            padding-right: 15px;
          }
        }

        /* Respect users who prefer less motion. */
        @media (prefers-reduced-motion: reduce) {
          .reveal,
          .hero-visual .truck-float,
          .hero-visual .hero-city,
          .hero-visual .leaf-one,
          .hero-visual .leaf-two,
          .live-radar::before,
          .live-radar::after,
          .bar-fill,
          .activity-item {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
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
  progress,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "green" | "cyan" | "amber" | "emerald";
  icon: ReactNode;
  progress?: number;
}) {
  const safeProgress = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <article
      className={`metric-card ${tone}`}
      style={
        progress === undefined
          ? undefined
          : ({ ["--progress" as string]: safeProgress } as React.CSSProperties)
      }
    >
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>

      <div>
        <div className="metric-value">{value}</div>
        <div className="metric-helper">{helper}</div>
      </div>

      {progress !== undefined && (
        <div className="metric-progress-wrap" aria-hidden="true">
          <span>{safeProgress}%</span>
        </div>
      )}
    </article>
  );
}

function FlowCard({
  index,
  label,
  helper,
  tone,
  icon,
}: {
  index: string;
  label: string;
  helper: string;
  tone: "green" | "blue" | "amber" | "red";
  icon: ReactNode;
}) {
  return (
    <article className={`flow-card ${tone}`}>
      <div className="flow-step">{index}</div>
      <div className="flow-icon">{icon}</div>
      <div className="flow-copy">
        <strong>{label}</strong>
        <span>{helper}</span>
      </div>
    </article>
  );
}

function SummaryStat({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "green" | "amber" | "blue";
}) {
  return (
    <div className={`summary-stat ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{helper}</span>
    </div>
  );
}
