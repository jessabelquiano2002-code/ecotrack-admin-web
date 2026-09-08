"use client";

import Link from "next/link";
import Image from "next/image";
import {
  CSSProperties,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import "./dashboard-reference.css";
import hero3d from "./metrowaste-3d-hero.png";

type AnyRecord = Record<string, any>;

type DashboardEvent = {
  id: string;
  title: string;
  subtitle: string;
  timestamp: number;
  tone: "green" | "blue" | "amber" | "red";
};

type WeeklyBucket = {
  key: string;
  label: string;
  value: number;
};

const TIME_ZONE = "Asia/Manila";

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
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function statusOf(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function relativeTime(timestamp: number) {
  if (!timestamp) return "No timestamp";
  const diff = Math.max(0, Date.now() - timestamp);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (sec < 10) return "Just now";
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hour < 24) return `${hour}h ago`;
  if (day < 7) return `${day}d ago`;
  return new Date(timestamp).toLocaleDateString("en-PH");
}

function localDateKey(value: Date | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function localWeekday() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
  }).format(new Date());
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([key, item]) =>
        typeof item === "string" && item.trim() ? item.trim() : key.trim(),
      )
      .filter(Boolean);
  }
  return [];
}

function scheduleDueToday(schedule: any) {
  const status = statusOf(schedule.status || schedule.collectionStatus);
  if (
    ["inactive", "disabled", "archived", "cancelled", "canceled"].includes(status)
  ) {
    return false;
  }

  const configuredDays = Array.from(
    new Set(
      [
        ...normalizeStringList(schedule.scheduleDays),
        ...normalizeStringList(schedule.daysOfWeek),
        ...normalizeStringList(schedule.recurrence?.daysOfWeek),
        String(schedule.scheduleDay || "").trim(),
        String(schedule.dayOfWeek || "").trim(),
        String(schedule.recurrence?.dayOfWeek || "").trim(),
      ].filter(Boolean),
    ),
  );

  if (configuredDays.length) {
    const today = localWeekday().toLowerCase();
    return configuredDays.some((day) => day.toLowerCase() === today);
  }

  const timestamp = normalizeTimestamp(
    schedule.scheduledAt ?? schedule.date ?? schedule.collectionDate,
  );
  return timestamp ? localDateKey(timestamp) === localDateKey() : false;
}

function openIssue(issue: any) {
  const status = statusOf(issue.status || issue.issueStatus || issue.state);
  return ![
    "resolved",
    "closed",
    "completed",
    "done",
    "cancelled",
    "canceled",
  ].includes(status);
}

function upcomingSchedule(schedule: any) {
  const timestamp = normalizeTimestamp(
    schedule.timestamp ??
      schedule.scheduledAt ??
      schedule.date ??
      schedule.createdAt,
  );

  if (!timestamp) {
    const status = statusOf(schedule.status);
    return !["completed", "done", "finished", "cancelled", "canceled"].includes(
      status,
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return timestamp >= today.getTime();
}

function dayKey(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const Icon = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => <span className={`mw-icon ${className}`}>{children}</span>;

const TruckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h11v10H3V5Zm12 4h3.5l3.5 3.5V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.2l-1.6-2H15Z" />
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

const RouteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9c0 5 12 2 12 6h-2c0-2-12 1-12-6h2Z" />
  </svg>
);

const SupportIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h3v-8H5a7 7 0 0 1 14 0h-4v8h2.2A4.8 4.8 0 0 1 13 21h-2v2h2a6.8 6.8 0 0 0 6.6-5.2A3 3 0 0 0 21 15v-4a9 9 0 0 0-9-9Z" />
  </svg>
);

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
  const [collectionReportsData, setCollectionReportsData] =
    useState<AnyRecord>({});
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  useEffect(() => {
    const touch = () => setLastUpdated(Date.now());

    const subscriptions = [
      onValue(ref(db, "drivers"), (s) => {
        setDriversData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "driver_locations"), (s) => {
        setDriverLocationsData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "residents"), (s) => {
        setResidentsData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "users"), (s) => {
        setUsersData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "issues"), (s) => {
        setIssuesData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "report_issues"), (s) => {
        setReportIssuesData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "notifications"), (s) => {
        setNotificationsData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "schedules"), (s) => {
        setSchedulesData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "routes"), (s) => {
        setRoutesData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "route_status_updates"), (s) => {
        setRouteUpdatesData(s.val() || {});
        touch();
      }),
      onValue(ref(db, "collection_reports"), (s) => {
        setCollectionReportsData(s.val() || {});
        touch();
      }),
    ];

    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, []);

  const drivers = useMemo(() => toArray(driversData), [driversData]);
  const locations = useMemo(
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
    () =>
      toArray(notificationsData).filter((item) => item.adminVisible !== false),
    [notificationsData],
  );
  const schedules = useMemo(() => toArray(schedulesData), [schedulesData]);
  const routes = useMemo(() => toArray(routesData), [routesData]);
  const routeUpdates = useMemo(
    () => toArray(routeUpdatesData),
    [routeUpdatesData],
  );
  const collectionReports = useMemo(
    () => toArray(collectionReportsData),
    [collectionReportsData],
  );

  const activeTrucks = useMemo(() => {
    const now = Date.now();
    const liveLocations = locations.filter((item) => {
      const status = statusOf(item.status);
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.lastUpdated ?? item.updatedAt,
      );
      return (
        status !== "offline" &&
        timestamp > 0 &&
        now - timestamp <= 10 * 60 * 1000
      );
    });

    if (liveLocations.length) return liveLocations.length;

    return drivers.filter((driver) =>
      [
        "online",
        "active",
        "live",
        "collecting",
        "on route",
        "on_route",
        "in progress",
        "in_progress",
      ].includes(statusOf(driver.status)),
    ).length;
  }, [drivers, locations]);

  const residentsCount = useMemo(() => {
    if (residents.length) return residents.length;
    return users.filter((user) =>
      ["resident", "residents"].includes(
        statusOf(user.role || user.userType || user.type),
      ),
    ).length;
  }, [residents, users]);

  const openIssues = useMemo(
    () => issues.filter(openIssue).length,
    [issues],
  );

  const completion = useMemo(() => {
    const today = localDateKey();

    const reportsToday = collectionReports.filter((report) => {
      const timestamp = normalizeTimestamp(
        report.completedAt ??
          report.timestamp ??
          report.updatedAt ??
          report.createdAt,
      );
      return timestamp > 0 && localDateKey(timestamp) === today;
    });

    const latestBySchedule = new Map<string, any>();
    reportsToday.forEach((report) => {
      const id = String(report.scheduleId || "").trim();
      if (!id) return;
      const currentTime = normalizeTimestamp(
        report.completedAt ??
          report.timestamp ??
          report.updatedAt ??
          report.createdAt,
      );
      const previous = latestBySchedule.get(id);
      const previousTime = previous
        ? normalizeTimestamp(
            previous.completedAt ??
              previous.timestamp ??
              previous.updatedAt ??
              previous.createdAt,
          )
        : 0;

      if (!previous || currentTime >= previousTime) {
        latestBySchedule.set(id, report);
      }
    });

    const dueIds = new Set(
      schedules
        .filter(scheduleDueToday)
        .map((schedule) => String(schedule.id || "").trim())
        .filter(Boolean),
    );

    latestBySchedule.forEach((_, id) => dueIds.add(id));

    let completed = 0;
    let partial = 0;

    dueIds.forEach((id) => {
      const report = latestBySchedule.get(id);
      const status = statusOf(
        report?.collectionStatus ?? report?.status ?? report?.routeStatus,
      );

      if (
        ["completed", "complete", "done", "finished", "success"].includes(status)
      ) {
        completed += 1;
      } else if (
        [
          "partially_completed",
          "partially completed",
          "partial",
          "incomplete",
        ].includes(status)
      ) {
        partial += 1;
      }
    });

    const scheduled = dueIds.size;
    const pending = Math.max(0, scheduled - completed - partial);
    const percentage = scheduled
      ? Math.round((completed / scheduled) * 100)
      : 0;

    return { scheduled, completed, partial, pending, percentage };
  }, [collectionReports, schedules]);

  const upcomingSchedules = useMemo(
    () => schedules.filter(upcomingSchedule).length,
    [schedules],
  );

  const activeRoutes = useMemo(
    () =>
      routes.filter(
        (route) =>
          ![
            "inactive",
            "disabled",
            "archived",
            "cancelled",
            "canceled",
          ].includes(statusOf(route.status || route.routeStatus)),
      ).length,
    [routes],
  );

  const heroTruck = useMemo(() => {
    const now = Date.now();

    const liveLocation = [...locations]
      .filter((item) => {
        const timestamp = normalizeTimestamp(
          item.timestamp ?? item.lastUpdated ?? item.updatedAt,
        );
        return (
          statusOf(item.status) !== "offline" &&
          timestamp > 0 &&
          now - timestamp <= 10 * 60 * 1000
        );
      })
      .sort(
        (a, b) =>
          normalizeTimestamp(
            b.timestamp ?? b.lastUpdated ?? b.updatedAt,
          ) -
          normalizeTimestamp(
            a.timestamp ?? a.lastUpdated ?? a.updatedAt,
          ),
      )[0];

    const driver =
      liveLocation ||
      drivers.find((item) =>
        [
          "online",
          "active",
          "live",
          "collecting",
          "on route",
          "on_route",
        ].includes(statusOf(item.status)),
      );

    const truckNo =
      driver?.truckNumber ??
      driver?.vehicleNumber ??
      driver?.unitNumber ??
      driver?.truckId ??
      "";

    const truckName =
      driver?.truckName ||
      driver?.vehicleName ||
      (truckNo ? `Truck #${truckNo}` : "Metro Waste Fleet");

    const driverName =
      driver?.driverName || driver?.name || driver?.fullName || "Waiting for driver";

    const routeName =
      driver?.assignedRouteName ||
      driver?.routeName ||
      driver?.currentRouteName ||
      driver?.barangay ||
      "No active route";

    const rawEta =
      driver?.etaMinutes ??
      driver?.estimatedArrivalMinutes ??
      driver?.eta ??
      driver?.estimatedArrival;

    let eta = activeTrucks ? "Live GPS reporting" : "Waiting for driver";
    if (typeof rawEta === "number" && Number.isFinite(rawEta)) {
      eta = `ETA: ${Math.max(0, Math.round(rawEta))} minutes`;
    } else if (typeof rawEta === "string" && rawEta.trim()) {
      eta = /^eta\b/i.test(rawEta.trim())
        ? rawEta.trim()
        : `ETA: ${rawEta.trim()}`;
    }

    return {
      isLive: activeTrucks > 0,
      truckName,
      driverName,
      routeName,
      eta,
    };
  }, [activeTrucks, drivers, locations]);

  const recentActivity = useMemo<DashboardEvent[]>(() => {
    const events: DashboardEvent[] = [];

    locations.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.lastUpdated ?? item.updatedAt,
      );
      if (!timestamp) return;
      events.push({
        id: `gps-${item.id}`,
        title: item.driverName || item.name || "Driver GPS updated",
        subtitle:
          item.routeName ||
          item.assignedRouteName ||
          item.barangay ||
          "Live location received",
        timestamp,
        tone: "green",
      });
    });

    issues.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.createdAt ?? item.updatedAt,
      );
      if (!timestamp) return;
      events.push({
        id: `issue-${item.id}`,
        title: item.title || item.issueType || "Resident report received",
        subtitle:
          item.barangay ||
          item.reporterName ||
          item.description ||
          "Issue submitted",
        timestamp,
        tone: "red",
      });
    });

    routeUpdates.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.createdAt ?? item.updatedAt,
      );
      if (!timestamp) return;
      events.push({
        id: `route-${item.id}`,
        title: item.title || item.status || "Route updated",
        subtitle: item.routeName || item.barangay || "Route activity",
        timestamp,
        tone: "blue",
      });
    });

    notifications.forEach((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp ?? item.createdAt ?? item.date,
      );
      if (!timestamp) return;
      events.push({
        id: `notification-${item.id}`,
        title: item.title || "Notification sent",
        subtitle: item.message || item.body || "Notification activity",
        timestamp,
        tone: "amber",
      });
    });

    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  }, [issues, locations, notifications, routeUpdates]);

  const weekly = useMemo(() => {
    const today = new Date();
    const buckets: WeeklyBucket[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      buckets.push({
        key: dayKey(date),
        label: date.toLocaleDateString("en-US", { weekday: "short" }),
        value: 0,
      });
    }

    const add = (timestamp: number) => {
      if (!timestamp) return;
      const bucket = buckets.find(
        (item) => item.key === dayKey(new Date(timestamp)),
      );
      if (bucket) bucket.value += 1;
    };

    locations.forEach((item) =>
      add(
        normalizeTimestamp(
          item.timestamp ?? item.lastUpdated ?? item.updatedAt,
        ),
      ),
    );
    issues.forEach((item) =>
      add(
        normalizeTimestamp(
          item.timestamp ?? item.createdAt ?? item.updatedAt,
        ),
      ),
    );
    notifications.forEach((item) =>
      add(normalizeTimestamp(item.timestamp ?? item.createdAt)),
    );
    routeUpdates.forEach((item) =>
      add(
        normalizeTimestamp(
          item.timestamp ?? item.createdAt ?? item.updatedAt,
        ),
      ),
    );

    return {
      items: buckets,
      max: Math.max(1, ...buckets.map((item) => item.value)),
    };
  }, [issues, locations, notifications, routeUpdates]);

  return (
    <DashboardShell
      title="Dashboard"
      description="Live overview of MetroWaste operations"
      hidePageHeader
    >
      <main className="mw-reference-dashboard">
        <section className="mw-reference-hero">
          <div className="mw-hero-art" aria-hidden="true">
            <Image
              src={hero3d}
              alt=""
              fill
              priority
              sizes="(max-width: 900px) 100vw, 84vw"
              className="mw-hero-image"
            />
          </div>

          <div className="mw-hero-shade" aria-hidden="true" />

          <div className="mw-hero-copy">
            <span className="mw-kicker">ADMINISTRATOR DASHBOARD</span>

            <h1>
              Today&apos;s Collection
              <strong>Overview</strong>
            </h1>

            <p>
              Monitor today&apos;s schedule, confirm the assigned route and
              driver, then track collection work and resident concerns in real
              time.
            </p>

            <div className="mw-hero-actions">
              <Link href="/schedules" className="mw-btn mw-btn-primary">
                <Icon>
                  <CalendarIcon />
                </Icon>
                Start Check Schedules
                <b aria-hidden="true">→</b>
              </Link>

              <Link href="/live-map" className="mw-btn mw-btn-light">
                <Icon>
                  <MapIcon />
                </Icon>
                Track Trucks Live
              </Link>
            </div>
          </div>

          <aside
            className={`mw-live-card ${heroTruck.isLive ? "live" : "standby"}`}
          >
            <div className="mw-live-info">
              <div className="mw-live-title">
                <span className="mw-live-dot" />
                <strong>{heroTruck.truckName}</strong>
                <span className="mw-live-pill">
                  {heroTruck.isLive ? "On Route" : "Standby"}
                </span>
              </div>

              <LiveRow icon={<UsersIcon />} text={heroTruck.driverName} />
              <LiveRow icon={<MapIcon />} text={heroTruck.routeName} />
              <LiveRow
                icon={<span className="mw-clock">◷</span>}
                text={heroTruck.eta}
              />

              <div
                className="mw-live-progress"
                style={
                  {
                    "--mw-progress": `${completion.percentage}%`,
                  } as CSSProperties
                }
              >
                <span className="mw-live-progress-fill" />
                <b className="mw-progress-truck" aria-hidden="true">
                  <TruckIcon />
                </b>
              </div>
            </div>

            <div className="mw-live-progress-side">
              <span>Collection<br />Progress</span>
              <div
                className="mw-live-ring"
                style={
                  {
                    "--mw-progress": `${completion.percentage}%`,
                  } as CSSProperties
                }
              >
                <strong>{completion.percentage}%</strong>
              </div>
            </div>
          </aside>
        </section>

        <section className="mw-metrics">
          <MetricCard
            href="/live-map"
            label="Active Trucks"
            value={activeTrucks}
            helper={
              drivers.length
                ? `${activeTrucks} of ${drivers.length} online/live`
                : "No driver accounts yet"
            }
            icon={<TruckIcon />}
            tone="green"
          />

          <MetricCard
            href="/residents"
            label="Residents"
            value={residentsCount}
            helper="Registered resident accounts"
            icon={<UsersIcon />}
            tone="cyan"
          />

          <MetricCard
            href="/issues"
            label="Open Issues"
            value={openIssues}
            helper={openIssues ? "Needs admin review" : "No open issues"}
            icon={<AlertIcon />}
            tone="amber"
          />

          <MetricCard
            href="/reports"
            label="Completion"
            value={`${completion.percentage}%`}
            helper={
              completion.scheduled
                ? `${completion.completed} completed • ${completion.partial} partial • ${completion.pending} pending`
                : "No collection schedules due today"
            }
            icon={<CheckIcon />}
            tone="green"
          />
        </section>

        <section className="mw-workflow">
          <header>
            <span>DAILY ADMIN FLOW</span>
            <h2>Follow these steps from left to right</h2>
            <p>Select a step to open the correct page.</p>
          </header>

          <div className="mw-flow-grid">
            <FlowCard
              href="/schedules"
              number="1"
              title="Review schedules"
              helper={`${upcomingSchedules} upcoming or active schedules`}
              icon={<CalendarIcon />}
              tone="amber"
            />
            <FlowCard
              href="/routes"
              number="2"
              title="Confirm route & driver"
              helper={`${activeRoutes} active routes`}
              icon={<RouteIcon />}
              tone="green"
            />
            <FlowCard
              href="/live-map"
              number="3"
              title="Track live collection"
              helper={`${activeTrucks} trucks reporting live`}
              icon={<MapIcon />}
              tone="blue"
            />
            <FlowCard
              href="/issues"
              number="4"
              title="Resolve resident reports"
              helper={`${openIssues} open issues`}
              icon={<SupportIcon />}
              tone="red"
            />
          </div>
        </section>

        <section className="mw-lower-grid">
          <section className="mw-panel mw-performance-panel">
            <div className="mw-panel-head">
              <div>
                <span>LAST 7 DAYS</span>
                <h2>Collection Performance</h2>
              </div>
              <div className="mw-range">7D <span>⌄</span></div>
            </div>

            <div className="mw-chart">
              <div className="mw-chart-y" aria-hidden="true">
                <span>{weekly.max}</span>
                <span>{Math.round(weekly.max * 0.75)}</span>
                <span>{Math.round(weekly.max * 0.5)}</span>
                <span>{Math.round(weekly.max * 0.25)}</span>
                <span>0</span>
              </div>

              <div className="mw-chart-grid" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>

              <div className="mw-bars">
                {weekly.items.map((item) => {
                  const height =
                    item.value === 0
                      ? 4
                      : Math.max(12, (item.value / weekly.max) * 100);

                  return (
                    <div className="mw-bar-item" key={item.key}>
                      <div className="mw-bar-value">{item.value}</div>
                      <div className="mw-bar-track">
                        <span
                          className="mw-bar-fill"
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <strong>{item.label}</strong>
                    </div>
                  );
                })}
              </div>

              <div className="mw-chart-legend" aria-hidden="true">
                <span><i className="completed" /> Completed</span>
                <span><i className="partial" /> Partial</span>
                <span><i className="missed" /> Missed</span>
              </div>
            </div>
          </section>

          <section className="mw-panel mw-updates-panel">
            <div className="mw-panel-head">
              <div>
                <span>LATEST UPDATES</span>
                <h2>Recent system activities</h2>
              </div>
              <Link href="/notifications" className="mw-view-all">
                View All
              </Link>
            </div>

            <div className="mw-feed">
              {recentActivity.length ? (
                recentActivity.map((event) => (
                  <article className="mw-feed-row" key={event.id}>
                    <span className={`mw-feed-icon ${event.tone}`}>
                      {event.tone === "red" ? (
                        <AlertIcon />
                      ) : event.tone === "blue" ? (
                        <MapIcon />
                      ) : event.tone === "amber" ? (
                        <AlertIcon />
                      ) : (
                        <TruckIcon />
                      )}
                    </span>
                    <div className="mw-feed-copy">
                      <strong>{event.title}</strong>
                      <p>{event.subtitle}</p>
                    </div>
                    <time>{relativeTime(event.timestamp)}</time>
                    <b aria-hidden="true">›</b>
                  </article>
                ))
              ) : (
                <div className="mw-empty">
                  <Icon>
                    <TruckIcon />
                  </Icon>
                  <strong>No recent activity yet</strong>
                  <p>Live system activity will appear here.</p>
                </div>
              )}
            </div>
          </section>
        </section>
      </main>
    </DashboardShell>
  );
}

function LiveRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="mw-live-row">
      <Icon>{icon}</Icon>
      <span>{text}</span>
    </div>
  );
}

function MetricCard({
  href,
  label,
  value,
  helper,
  icon,
  tone,
}: {
  href: string;
  label: string;
  value: string | number;
  helper: string;
  icon: ReactNode;
  tone: "green" | "cyan" | "amber";
}) {
  return (
    <article className={`mw-metric ${tone}`}>
      <div className="mw-metric-head">
        <span className="mw-metric-icon">{icon}</span>
        <strong>{label}</strong>
        <span className="mw-metric-decor">{icon}</span>
      </div>

      <div className="mw-metric-value">{value}</div>
      <p>{helper}</p>

      <Link href={href} className="mw-metric-arrow" aria-label={`Open ${label}`}>
        →
      </Link>
    </article>
  );
}

function FlowCard({
  href,
  number,
  title,
  helper,
  icon,
  tone,
}: {
  href: string;
  number: string;
  title: string;
  helper: string;
  icon: ReactNode;
  tone: "amber" | "green" | "blue" | "red";
}) {
  return (
    <Link href={href} className={`mw-flow-card ${tone}`}>
      <span className="mw-flow-number">{number}</span>
      <span className="mw-flow-icon">{icon}</span>
      <span className="mw-flow-copy">
        <strong>{title}</strong>
        <small>{helper}</small>
      </span>
      <b aria-hidden="true">→</b>
    </Link>
  );
}
