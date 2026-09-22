"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { LiveRouteMonitor } from "../components/LiveRouteMonitor";
import styles from "./live-map.module.css";

type RawRecord = Record<string, unknown>;
type DriverState = "online" | "stale" | "offline";

function timestamp(value: unknown): number {
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

function stateFrom(location: RawRecord, driver: RawRecord): DriverState {
  const explicit = String(location.status || driver.status || "").toLowerCase();
  if (explicit === "offline") return "offline";

  const lastSeen = timestamp(location.timestamp ?? location.lastUpdated);
  if (!lastSeen) return "offline";

  const age = Date.now() - lastSeen;
  if (age <= 2 * 60 * 1000) return "online";
  if (age <= 10 * 60 * 1000) return "stale";
  return "offline";
}

function relative(value: number) {
  if (!value) return "Waiting for data";

  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;

  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

function LiveDot() {
  return <span className={styles.liveDot} aria-hidden="true" />;
}

export default function LiveMapPage() {
  const [locations, setLocations] = useState<Record<string, RawRecord>>({});
  const [drivers, setDrivers] = useState<Record<string, RawRecord>>({});
  const [sessions, setSessions] = useState<Record<string, RawRecord>>({});
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const listen = (
      path: string,
      setter: (value: Record<string, RawRecord>) => void,
    ) =>
      onValue(ref(db, path), (snapshot) => {
        setter(snapshot.val() || {});
        setLastUpdated(Date.now());
      });

    const unsubs = [
      listen("driver_locations", setLocations),
      listen("drivers", setDrivers),
      listen("route_sessions", setSessions),
    ];

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const ids = new Set([...Object.keys(drivers), ...Object.keys(locations)]);
    let online = 0;
    let stale = 0;
    let offline = 0;

    ids.forEach((id) => {
      const state = stateFrom(locations[id] || {}, drivers[id] || {});
      if (state === "online") online += 1;
      else if (state === "stale") stale += 1;
      else offline += 1;
    });

    let historyCount = 0;
    Object.values(sessions).forEach((raw) => {
      historyCount += Object.keys(
        raw && typeof raw === "object" ? (raw as RawRecord) : {},
      ).length;
    });

    return {
      total: ids.size,
      online,
      stale,
      offline,
      historyCount,
    };
  }, [drivers, locations, sessions, clockTick]);

  return (
    <DashboardShell title="" description="" hidePageHeader>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headingBlock}>
            <div className={styles.breadcrumb}>Operations / GPS Monitoring</div>
            <div className={styles.titleRow}>
              <div>
                <h1>Live GPS Monitoring</h1>
                <p>
                  Track collection vehicles, verify route progress, and review GPS
                  evidence from one operations workspace.
                </p>
              </div>

              <div className={styles.syncStatus} role="status" aria-live="polite">
                <LiveDot />
                <div>
                  <strong>Realtime</strong>
                  <span>{relative(lastUpdated)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.statusStrip} aria-label="Live GPS summary">
            <div className={styles.statusItem}>
              <span>Tracked</span>
              <strong>{stats.total}</strong>
            </div>
            <div className={`${styles.statusItem} ${styles.statusLive}`}>
              <span>Live now</span>
              <strong>{stats.online}</strong>
            </div>
            <div className={`${styles.statusItem} ${styles.statusWarning}`}>
              <span>Needs update</span>
              <strong>{stats.stale}</strong>
            </div>
            <div className={styles.statusItem}>
              <span>Offline</span>
              <strong>{stats.offline}</strong>
            </div>
            <div className={styles.statusItem}>
              <span>GPS sessions</span>
              <strong>{stats.historyCount}</strong>
            </div>

            <div className={styles.legend} aria-label="Driver status legend">
              <span><i className={styles.legendLive} />Live</span>
              <span><i className={styles.legendStale} />Needs update</span>
              <span><i className={styles.legendOffline} />Offline</span>
            </div>
          </div>
        </header>

        <section className={styles.workspace} aria-label="Live route operations workspace">
          <LiveRouteMonitor />
        </section>
      </main>
    </DashboardShell>
  );
}
