"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { LiveRouteMonitor } from "../components/LiveRouteMonitor";

type RawRecord = Record<string, unknown>;
type DriverState = "online" | "stale" | "offline";

function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
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

const TruckIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.2l-1.7-2H15Z" /></svg>;
const RadioIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
const HistoryIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-8.5 6H1l3.5-4L8 9H5.6A7 7 0 1 0 12 5v4l5 3-1 1.7-6-3.6V3h2Z"/></svg>;
const VerifyIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5.1 3.4 9.8 8 11 4.6-1.2 8-5.9 8-11V5l-8-3Zm-1.2 14.2-3.4-3.4 1.4-1.4 2 2 4.7-4.7 1.4 1.4-6.1 6.1Z"/></svg>;

export default function LiveMapPage() {
  const [locations, setLocations] = useState<Record<string, RawRecord>>({});
  const [drivers, setDrivers] = useState<Record<string, RawRecord>>({});
  const [sessions, setSessions] = useState<Record<string, RawRecord>>({});
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  useEffect(() => {
    const listen = (path: string, setter: (value: Record<string, RawRecord>) => void) =>
      onValue(ref(db, path), (snapshot) => { setter(snapshot.val() || {}); setLastUpdated(Date.now()); });
    const unsubs = [listen("driver_locations", setLocations), listen("drivers", setDrivers), listen("route_sessions", setSessions)];
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
    Object.values(sessions).forEach((raw) => { historyCount += Object.keys(raw && typeof raw === "object" ? raw as RawRecord : {}).length; });
    return { total: ids.size, online, stale, offline, historyCount };
  }, [drivers, locations, sessions]);

  return (
    <DashboardShell title="Live Map" description="Track drivers, verify assigned routes, and inspect stored GPS trip history." hidePageHeader>
      <div className="live-ops-page">
        <section className="live-ops-hero">
          <div>
            <span>GPS OPERATIONS CENTER</span>
            <h1>Live Map & Route Verification</h1>
            <p>
              One workspace for current truck GPS, assigned-route comparison, selected operations, driver history, and route replay.
              Analytics now keeps the completed actual GPS footprint separate for cleaner reporting.
            </p>
          </div>
          <div className="live-sync"><i/><div><strong>Realtime Firebase</strong><small>Updated {relative(lastUpdated)}</small></div></div>
        </section>

        <section className="live-ops-metrics">
          <Metric icon={<TruckIcon/>} label="Tracked drivers" value={stats.total} note="Drivers with profile or GPS" tone="green"/>
          <Metric icon={<RadioIcon/>} label="Live now" value={stats.online} note="GPS updated within 2 minutes" tone="live"/>
          <Metric icon={<VerifyIcon/>} label="Needs update" value={stats.stale} note={`${stats.offline} offline`} tone="amber"/>
          <Metric icon={<HistoryIcon/>} label="Stored sessions" value={stats.historyCount} note="Available for driver/route history" tone="blue"/>
        </section>

        <section className="live-workspace-intro">
          <div><span>LIVE OPERATIONS WORKSPACE</span><h2>Current position + verification + history</h2></div>
          <div className="workspace-guide"><b>1</b><span>Select driver</span><b>2</b><span>Inspect actual vs assigned</span><b>3</b><span>Open/replay history</span></div>
        </section>

        <LiveRouteMonitor />
      </div>

      <style jsx global>{`
        .live-ops-page{width:100%;max-width:1680px;margin:0 auto;display:grid;gap:16px;color:#10231b}.live-ops-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:24px 25px;border:1px solid #d8e4dc;border-radius:24px;background:radial-gradient(circle at 85% 15%,rgba(34,197,94,.12),transparent 25%),linear-gradient(120deg,#fff 0%,#f7fbf8 55%,#edf8f0 100%);box-shadow:0 12px 30px rgba(16,35,27,.055)}.live-ops-hero>div:first-child{max-width:890px}.live-ops-hero span,.live-workspace-intro>div:first-child>span{color:#168a4a;font-size:10px;font-weight:950;letter-spacing:.11em}.live-ops-hero h1{margin:6px 0 0;color:#10231b;font-size:clamp(30px,3vw,44px);line-height:1.05;letter-spacing:-.045em}.live-ops-hero p{margin:10px 0 0;color:#5f7167;font-size:14px;line-height:1.6}.live-sync{display:flex;align-items:center;gap:11px;min-width:205px;padding:12px 14px;border:1px solid #cce2d4;border-radius:15px;background:#fff;box-shadow:0 8px 20px rgba(16,35,27,.06)}.live-sync i{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 6px rgba(34,197,94,.12)}.live-sync strong,.live-sync small{display:block}.live-sync strong{font-size:12px;color:#17683e}.live-sync small{margin-top:3px;color:#718078;font-size:10px}.live-ops-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.live-ops-metric{--tone:#168a4a;--soft:#e9f7ee;display:flex;align-items:center;gap:13px;min-height:96px;padding:15px 16px;border:1px solid #dce6e0;border-radius:17px;background:#fff;box-shadow:0 8px 22px rgba(16,35,27,.045)}.live-ops-metric.live{--tone:#16a34a;--soft:#ecfdf3}.live-ops-metric.amber{--tone:#b7790d;--soft:#fff6df}.live-ops-metric.blue{--tone:#2563eb;--soft:#edf4ff}.live-ops-metric-icon{width:45px;height:45px;display:grid;place-items:center;flex:0 0 45px;border-radius:14px;background:var(--soft);color:var(--tone)}.live-ops-metric-icon svg{width:23px;height:23px;fill:currentColor}.live-ops-metric-copy span,.live-ops-metric-copy strong,.live-ops-metric-copy small{display:block}.live-ops-metric-copy span{color:#40564a;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.03em}.live-ops-metric-copy strong{margin-top:4px;color:#10231b;font-size:26px;line-height:1}.live-ops-metric-copy small{margin-top:4px;color:#718078;font-size:10px}.live-workspace-intro{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 17px;border:1px solid #dfe8e2;border-radius:16px;background:#fff}.live-workspace-intro h2{margin:4px 0 0;font-size:18px;letter-spacing:-.025em}.workspace-guide{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:#617268;font-size:10px;font-weight:800}.workspace-guide b{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#e8f6ed;color:#167a44}.workspace-guide span:not(:last-child){margin-right:7px}.live-ops-page .live-route-monitor{margin:0!important}
        @media(max-width:1000px){.live-ops-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.live-ops-hero,.live-workspace-intro{align-items:stretch;flex-direction:column}.live-sync{width:100%}}@media(max-width:620px){.live-ops-metrics{grid-template-columns:1fr}.live-ops-hero{padding:20px}.workspace-guide{display:grid;grid-template-columns:auto 1fr}}
      `}</style>
    </DashboardShell>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: number; note: string; tone: "green" | "live" | "amber" | "blue" }) {
  return <article className={`live-ops-metric ${tone}`}><div className="live-ops-metric-icon">{icon}</div><div className="live-ops-metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}
