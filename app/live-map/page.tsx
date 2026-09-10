"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { LiveRouteMonitor } from "../components/LiveRouteMonitor";

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
  if (!value) return "waiting for data";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

const TruckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.2l-1.7-2H15Z" />
  </svg>
);

const RadioIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3a9 9 0 1 1-8.5 6H1l3.5-4L8 9H5.6A7 7 0 1 0 12 5v4l5 3-1 1.7-6-3.6V3h2Z" />
  </svg>
);

const VerifyIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2 4 5v6c0 5.1 3.4 9.8 8 11 4.6-1.2 8-5.9 8-11V5l-8-3Zm-1.2 14.2-3.4-3.4 1.4-1.4 2 2 4.7-4.7 1.4 1.4-6.1 6.1Z" />
  </svg>
);

export default function LiveMapPage() {
  const [locations, setLocations] = useState<Record<string, RawRecord>>({});
  const [drivers, setDrivers] = useState<Record<string, RawRecord>>({});
  const [sessions, setSessions] = useState<Record<string, RawRecord>>({});
  const [lastUpdated, setLastUpdated] = useState(Date.now());

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

    return { total: ids.size, online, stale, offline, historyCount };
  }, [drivers, locations, sessions]);

  return (
    <DashboardShell title="" description="" hidePageHeader>
      <main className="office-live-page">
        <header className="office-live-header">
          <div className="office-live-title">
            <span className="office-live-eyebrow">Operations / GPS Monitoring</span>
            <h1>Live Map</h1>
            <p>
              Monitor active collection vehicles, verify route progress, and review
              recorded GPS activity from one workspace.
            </p>
          </div>

          <div className="office-live-sync" role="status" aria-live="polite">
            <span className="office-live-sync-dot" />
            <div>
              <strong>Realtime monitoring</strong>
              <small>Last data update {relative(lastUpdated)}</small>
            </div>
          </div>
        </header>

        <section className="office-live-metrics" aria-label="GPS operations summary">
          <SummaryMetric
            icon={<TruckIcon />}
            label="Tracked drivers"
            value={stats.total}
            note="Profiles with GPS or assignments"
          />
          <SummaryMetric
            icon={<RadioIcon />}
            label="Live now"
            value={stats.online}
            note="GPS updated within 2 minutes"
            tone="success"
          />
          <SummaryMetric
            icon={<VerifyIcon />}
            label="Needs attention"
            value={stats.stale}
            note={`${stats.offline} driver${stats.offline === 1 ? "" : "s"} offline`}
            tone="warning"
          />
          <SummaryMetric
            icon={<HistoryIcon />}
            label="Recorded sessions"
            value={stats.historyCount}
            note="Available for verification and replay"
            tone="info"
          />
        </section>

        <section className="office-live-section-head">
          <div>
            <span>Operations workspace</span>
            <h2>Vehicle position and route verification</h2>
            <p>Select a driver, inspect the live route, then review collection history below.</p>
          </div>
          <div className="office-live-key">
            <span><i className="live-key-dot live" />Live</span>
            <span><i className="live-key-dot stale" />Needs update</span>
            <span><i className="live-key-dot offline" />Offline</span>
          </div>
        </section>

        <LiveRouteMonitor />

        <style jsx global>{`
          .office-live-page {
            width: min(100%, 1640px);
            margin: 0 auto;
            padding: 8px 4px 40px;
            display: grid;
            gap: 18px;
            color: #1c2a23;
            font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
          }

          .office-live-page *,
          .office-live-page *::before,
          .office-live-page *::after {
            box-sizing: border-box;
          }

          .office-live-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 28px;
            padding: 4px 0 2px;
          }

          .office-live-title {
            min-width: 0;
          }

          .office-live-eyebrow,
          .office-live-section-head > div:first-child > span {
            display: block;
            color: #147a48;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .office-live-header h1 {
            margin: 5px 0 0;
            color: #142219;
            font-size: clamp(30px, 2.5vw, 38px);
            line-height: 1.15;
            letter-spacing: -.035em;
            font-weight: 720;
          }

          .office-live-header p {
            max-width: 760px;
            margin: 7px 0 0;
            color: #64736b;
            font-size: 14px;
            line-height: 1.55;
          }

          .office-live-sync {
            min-width: 220px;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            border: 1px solid #d9e4dd;
            border-radius: 12px;
            background: #fff;
          }

          .office-live-sync-dot {
            width: 9px;
            height: 9px;
            flex: 0 0 9px;
            border-radius: 50%;
            background: #18a558;
            box-shadow: 0 0 0 5px rgba(24, 165, 88, .11);
          }

          .office-live-sync strong,
          .office-live-sync small {
            display: block;
          }

          .office-live-sync strong {
            color: #234336;
            font-size: 13px;
            font-weight: 700;
          }

          .office-live-sync small {
            margin-top: 3px;
            color: #78867f;
            font-size: 11px;
          }

          .office-live-metrics {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }

          .office-live-metric {
            --metric-accent: #147a48;
            min-width: 0;
            min-height: 92px;
            display: grid;
            grid-template-columns: 42px minmax(0, 1fr);
            align-items: center;
            gap: 13px;
            padding: 15px 16px;
            border: 1px solid #dfe6e2;
            border-radius: 12px;
            background: #fff;
          }

          .office-live-metric[data-tone="success"] { --metric-accent: #12834d; }
          .office-live-metric[data-tone="warning"] { --metric-accent: #a9660e; }
          .office-live-metric[data-tone="info"] { --metric-accent: #315fa8; }

          .office-live-metric-icon {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            border-radius: 10px;
            background: #f1f6f3;
            color: var(--metric-accent);
          }

          .office-live-metric[data-tone="warning"] .office-live-metric-icon { background: #fff8e9; }
          .office-live-metric[data-tone="info"] .office-live-metric-icon { background: #eef4fb; }

          .office-live-metric-icon svg {
            width: 21px;
            height: 21px;
            fill: currentColor;
          }

          .office-live-metric-copy {
            min-width: 0;
          }

          .office-live-metric-copy > span,
          .office-live-metric-copy > strong,
          .office-live-metric-copy > small {
            display: block;
          }

          .office-live-metric-copy > span {
            color: #53635b;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .04em;
          }

          .office-live-metric-copy > strong {
            margin-top: 3px;
            color: #17261e;
            font-size: 25px;
            line-height: 1.1;
            font-weight: 720;
          }

          .office-live-metric-copy > small {
            margin-top: 4px;
            color: #7a8881;
            font-size: 10px;
            line-height: 1.35;
          }

          .office-live-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding: 14px 16px;
            border: 1px solid #dfe6e2;
            border-radius: 12px;
            background: #fff;
          }

          .office-live-section-head h2 {
            margin: 4px 0 0;
            color: #1b2b22;
            font-size: 18px;
            line-height: 1.35;
            font-weight: 700;
          }

          .office-live-section-head p {
            margin: 4px 0 0;
            color: #708078;
            font-size: 12px;
          }

          .office-live-key {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-wrap: wrap;
            color: #617169;
            font-size: 11px;
            font-weight: 650;
          }

          .office-live-key > span {
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }

          .live-key-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #98a39d;
          }

          .live-key-dot.live { background: #1ca65b; }
          .live-key-dot.stale { background: #d58a1f; }
          .live-key-dot.offline { background: #9ca3aa; }

          /* Remove duplicate presentation already supplied by this page. */
          .office-live-page .live-route-monitor > .monitor-heading,
          .office-live-page .live-route-monitor > .monitor-metrics {
            display: none !important;
          }

          .office-live-page .live-route-monitor {
            gap: 14px !important;
            padding-top: 0 !important;
          }

          /* Office-style filter toolbar */
          .office-live-page .monitor-filters {
            display: grid !important;
            grid-template-columns: 145px 145px minmax(190px, 1fr) 175px minmax(220px, 1.2fr) auto !important;
            gap: 12px !important;
            padding: 14px !important;
            border: 1px solid #dfe6e2 !important;
            border-radius: 12px !important;
            background: #fff !important;
            box-shadow: none !important;
          }

          .office-live-page .monitor-filters label {
            gap: 6px !important;
            color: #5e6e66 !important;
            font-size: 10px !important;
            font-weight: 750 !important;
            letter-spacing: .045em !important;
          }

          .office-live-page .monitor-filters input,
          .office-live-page .monitor-filters select {
            height: 42px !important;
            border: 1px solid #d6dfda !important;
            border-radius: 8px !important;
            background: #fff !important;
            color: #213129 !important;
            padding: 0 10px !important;
            font-size: 13px !important;
            outline: none !important;
            box-shadow: none !important;
          }

          .office-live-page .monitor-filters input:focus,
          .office-live-page .monitor-filters select:focus {
            border-color: #4a9b70 !important;
            box-shadow: 0 0 0 3px rgba(20, 122, 72, .08) !important;
          }

          .office-live-page .monitor-filters > button {
            height: 42px !important;
            align-self: end !important;
            padding: 0 15px !important;
            border: 1px solid #d7dfdb !important;
            border-radius: 8px !important;
            background: #f7f9f8 !important;
            color: #405149 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
          }

          .office-live-page .monitor-filters > button:hover {
            background: #eef3f0 !important;
          }

          /* Main command-center workspace */
          .office-live-page .monitor-workspace.approved-workspace {
            grid-template-columns: minmax(0, 2.2fr) 340px !important;
            min-height: 660px !important;
            border: 1px solid #dce4df !important;
            border-radius: 14px !important;
            background: #fff !important;
            box-shadow: none !important;
            overflow: hidden !important;
          }

          .office-live-page .monitor-map-panel,
          .office-live-page .approved-workspace .monitor-map-panel {
            min-height: 660px !important;
            background: #edf2ef !important;
          }

          .office-live-page .route-live-map {
            background: #edf2ef !important;
          }

          .office-live-page .approved-operation-panel {
            min-height: 660px !important;
            padding: 0 !important;
            border-left: 1px solid #dce4df !important;
            background: #fff !important;
            overflow-y: auto !important;
          }

          .office-live-page .approved-operation-head {
            position: sticky;
            top: 0;
            z-index: 5;
            padding: 18px 18px 14px !important;
            border-bottom: 1px solid #e5ebe7 !important;
            background: rgba(255, 255, 255, .98) !important;
          }

          .office-live-page .approved-operation-head h3 {
            margin: 0 !important;
            color: #1d2d24 !important;
            font-size: 16px !important;
            font-weight: 720 !important;
          }

          .office-live-page .approved-operation-head p {
            margin: 4px 0 0 !important;
            color: #7a8881 !important;
            font-size: 11px !important;
            line-height: 1.45 !important;
          }

          .office-live-page .approved-driver-card {
            margin: 16px !important;
            padding: 15px !important;
            border: 1px solid #dbe4df !important;
            border-radius: 12px !important;
            background: #fff !important;
            box-shadow: none !important;
          }

          .office-live-page .approved-driver-head {
            gap: 10px !important;
          }

          .office-live-page .approved-avatar {
            width: 42px !important;
            height: 42px !important;
            flex: 0 0 42px !important;
            border-radius: 10px !important;
            background: #e6f3eb !important;
            color: #147a48 !important;
            font-size: 12px !important;
          }

          .office-live-page .approved-driver-head > div strong {
            color: #1f3027 !important;
            font-size: 14px !important;
          }

          .office-live-page .approved-driver-head > div small {
            margin-top: 3px !important;
            color: #728179 !important;
            font-size: 10px !important;
          }

          .office-live-page .approved-progress {
            height: 7px !important;
            margin-top: 14px !important;
            background: #e8edea !important;
          }

          .office-live-page .approved-progress i,
          .office-live-page .progress-track i,
          .office-live-page .mini-progress i {
            background: #1b8b51 !important;
          }

          .office-live-page .approved-facts {
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            margin-top: 13px !important;
          }

          .office-live-page .approved-facts .route-fact {
            padding: 10px !important;
            border: 1px solid #edf0ee !important;
            border-radius: 9px !important;
            background: #f8faf9 !important;
          }

          .office-live-page .approved-timeline {
            margin: 0 16px 18px !important;
            padding: 14px 14px 4px !important;
            border-top: 1px solid #edf0ee !important;
          }

          /* Map controls are compact and aligned */
          .office-live-page .approved-map-tools {
            left: 14px !important;
            top: 14px !important;
            gap: 8px !important;
          }

          .office-live-page .approved-map-tools label,
          .office-live-page .approved-map-tools button {
            border: 1px solid #d7e0da !important;
            border-radius: 9px !important;
            background: rgba(255, 255, 255, .97) !important;
            box-shadow: 0 4px 14px rgba(15, 23, 42, .09) !important;
          }

          .office-live-page .approved-map-tools label {
            padding: 7px 10px !important;
          }

          .office-live-page .approved-map-tools select {
            min-width: 220px !important;
            font-size: 12px !important;
          }

          .office-live-page .approved-map-tools button {
            height: 44px !important;
            padding: 0 13px !important;
            color: #2d4136 !important;
            font-size: 12px !important;
          }

          .office-live-page .map-legend {
            left: 14px !important;
            right: auto !important;
            bottom: 14px !important;
            gap: 12px !important;
            padding: 9px 11px !important;
            border: 1px solid #dde4e0 !important;
            border-radius: 9px !important;
            background: rgba(255, 255, 255, .96) !important;
            box-shadow: 0 4px 14px rgba(15, 23, 42, .09) !important;
            color: #53635b !important;
            font-size: 9px !important;
          }

          /* Lower verification blocks */
          .office-live-page .route-detail-grid {
            grid-template-columns: minmax(0, 1.55fr) minmax(300px, .65fr) !important;
            gap: 12px !important;
          }

          .office-live-page .route-summary-card,
          .office-live-page .purok-visit-card,
          .office-live-page .driver-activity-card,
          .office-live-page .route-replay {
            border: 1px solid #dfe6e2 !important;
            border-radius: 12px !important;
            background: #fff !important;
            box-shadow: none !important;
          }

          .office-live-page .route-summary-card,
          .office-live-page .purok-visit-card,
          .office-live-page .route-replay,
          .office-live-page .driver-activity-card {
            padding: 16px !important;
          }

          .office-live-page .route-title h3,
          .office-live-page .purok-visit-card h3,
          .office-live-page .replay-heading h3,
          .office-live-page .activity-card-head h3 {
            color: #1e2e25 !important;
            font-size: 16px !important;
            font-weight: 700 !important;
          }

          .office-live-page .route-title small,
          .office-live-page .replay-heading small,
          .office-live-page .purok-visit-card > div > small,
          .office-live-page .activity-card-head small {
            color: #147a48 !important;
            font-size: 9px !important;
            font-weight: 800 !important;
            letter-spacing: .05em !important;
          }

          .office-live-page .route-facts {
            gap: 8px !important;
          }

          .office-live-page .route-fact {
            border: 1px solid #edf0ee !important;
            border-radius: 9px !important;
            background: #f8faf9 !important;
          }

          .office-live-page .visit-list > div {
            border: 1px solid #edf0ee !important;
            border-radius: 9px !important;
            background: #fafbfa !important;
          }

          /* Daily history becomes a records section rather than a card wall */
          .office-live-page .driver-activity-card {
            padding: 0 !important;
            overflow: hidden !important;
          }

          .office-live-page .activity-card-head {
            padding: 17px 18px !important;
            border-bottom: 1px solid #e7ece9 !important;
            background: #fff !important;
          }

          .office-live-page .activity-card-head p {
            max-width: 820px !important;
            color: #718078 !important;
            font-size: 11px !important;
            line-height: 1.5 !important;
          }

          .office-live-page .activity-print-all,
          .office-live-page .folder-print,
          .office-live-page .activity-extra button {
            border-radius: 8px !important;
            background: #243b30 !important;
            font-size: 11px !important;
          }

          .office-live-page .activity-folders {
            gap: 0 !important;
            margin-top: 0 !important;
          }

          .office-live-page .activity-folder {
            border: 0 !important;
            border-bottom: 1px solid #e8edea !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }

          .office-live-page .activity-folder:last-child {
            border-bottom: 0 !important;
          }

          .office-live-page .activity-folder-head {
            padding: 10px 14px !important;
            background: #fbfcfb !important;
          }

          .office-live-page .activity-folder.open .activity-folder-head {
            background: #f5f8f6 !important;
          }

          .office-live-page .folder-icon,
          .office-live-page .activity-record-icon {
            border-radius: 8px !important;
            background: #eef3f0 !important;
            border-color: #dfe6e2 !important;
          }

          .office-live-page .activity-day-overview {
            gap: 14px !important;
            padding: 14px !important;
          }

          .office-live-page .activity-map-card {
            min-height: 360px !important;
            border-radius: 10px !important;
          }

          .office-live-page .activity-day-summary > div {
            border: 1px solid #e8edea !important;
            border-radius: 9px !important;
            background: #fafbfa !important;
          }

          .office-live-page .activity-record.selected {
            background: #f3f8f5 !important;
            box-shadow: inset 3px 0 0 #238b54 !important;
          }

          .office-live-page .route-replay {
            margin-bottom: 0 !important;
          }

          .office-live-page .replay-heading select {
            height: 40px !important;
            border-radius: 8px !important;
            background: #fff !important;
            font-size: 12px !important;
          }

          .office-live-page .replay-controls button {
            border-radius: 8px !important;
            background: #147a48 !important;
          }

          .office-live-page .route-status {
            border-radius: 999px !important;
            padding: 5px 8px !important;
            font-size: 9px !important;
            font-weight: 800 !important;
          }

          .office-live-page .live-driver-label {
            border-radius: 8px !important;
            background: rgba(25, 42, 33, .94) !important;
            font-size: 10px !important;
          }

          .office-live-page .live-driver-marker {
            width: 36px !important;
            height: 36px !important;
            background: #1f6f45 !important;
            font-size: 16px !important;
          }

          @media (max-width: 1160px) {
            .office-live-metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .office-live-page .monitor-filters {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            }

            .office-live-page .monitor-workspace.approved-workspace {
              grid-template-columns: 1fr !important;
            }

            .office-live-page .approved-operation-panel {
              min-height: auto !important;
              border-left: 0 !important;
              border-top: 1px solid #dce4df !important;
            }

            .office-live-page .approved-facts {
              grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 760px) {
            .office-live-page {
              gap: 14px;
              padding-inline: 0;
            }

            .office-live-header,
            .office-live-section-head {
              align-items: stretch;
              flex-direction: column;
            }

            .office-live-sync {
              width: 100%;
            }

            .office-live-metrics {
              grid-template-columns: 1fr 1fr;
            }

            .office-live-page .monitor-filters {
              grid-template-columns: 1fr 1fr !important;
            }

            .office-live-page .monitor-search {
              grid-column: 1 / -1 !important;
            }

            .office-live-page .monitor-map-panel,
            .office-live-page .approved-workspace .monitor-map-panel {
              min-height: 500px !important;
            }

            .office-live-page .approved-map-tools {
              left: 12px !important;
              right: 12px !important;
              align-items: stretch !important;
              flex-direction: column !important;
            }

            .office-live-page .approved-map-tools label,
            .office-live-page .approved-map-tools button {
              width: 100% !important;
            }

            .office-live-page .approved-map-tools select {
              min-width: 0 !important;
              width: 100% !important;
            }

            .office-live-page .map-legend {
              right: 12px !important;
              flex-wrap: wrap !important;
            }

            .office-live-page .route-detail-grid {
              grid-template-columns: 1fr !important;
            }

            .office-live-page .approved-facts {
              grid-template-columns: 1fr 1fr !important;
            }
          }

          @media (max-width: 520px) {
            .office-live-metrics {
              grid-template-columns: 1fr;
            }

            .office-live-page .monitor-filters {
              grid-template-columns: 1fr !important;
            }

            .office-live-page .monitor-search {
              grid-column: auto !important;
            }

            .office-live-page .approved-facts {
              grid-template-columns: 1fr 1fr !important;
            }
          }
        `}</style>
      </main>
    </DashboardShell>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  note,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  note: string;
  tone?: "default" | "success" | "warning" | "info";
}) {
  return (
    <article className="office-live-metric" data-tone={tone}>
      <div className="office-live-metric-icon">{icon}</div>
      <div className="office-live-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
