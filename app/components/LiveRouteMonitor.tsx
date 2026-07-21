"use client";

import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../lib/firebase";
import { normalizeCheckpoints, normalizeCoordinates, type LngLatTuple } from "../../lib/geo";

type RawRecord = Record<string, unknown>;
type RouteStatus = "Not Started" | "Ongoing" | "On Route" | "Deviated from Route" | "Partially Completed" | "Completed" | "Missed Route";
type Point = { lat: number; lng: number; timestamp: number; accuracy: number };

type Assignment = {
  key: string;
  driverId: string;
  driverName: string;
  truck: string;
  scheduleId: string;
  scheduleName: string;
  routeId: string;
  routeName: string;
  puroks: string[];
  barangay: string;
  latestLocation: Point | null;
  lastUpdate: number;
  status: RouteStatus;
  progress: number;
  sessionId: string;
  session: RawRecord | null;
};

const DEFAULT_CENTER: LngLatTuple = [124.886, 11.775];
const ROUTE_STATUSES: RouteStatus[] = ["Not Started", "Ongoing", "On Route", "Deviated from Route", "Partially Completed", "Completed", "Missed Route"];

function asRecords(value: unknown): Record<string, RawRecord> {
  return value && typeof value === "object" ? value as Record<string, RawRecord> : {};
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => item === true ? key : typeof item === "string" || typeof item === "number" ? String(item) : "").filter(Boolean);
  if (value) return [String(value)];
  return [];
}

function timestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function gpsPoint(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawRecord;
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, timestamp: timestamp(raw.timestamp ?? raw.lastUpdated), accuracy: Number(raw.accuracy || 0) };
}

function statusValue(value: unknown): RouteStatus {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized.includes("complete") && normalized.includes("partial")) return "Partially Completed";
  if (normalized === "completed" || normalized === "complete") return "Completed";
  if (normalized.includes("deviat") || normalized.includes("off route")) return "Deviated from Route";
  if (normalized.includes("miss")) return "Missed Route";
  if (normalized.includes("on route")) return "On Route";
  if (normalized.includes("ongoing") || normalized.includes("progress") || normalized.includes("started")) return "Ongoing";
  return "Not Started";
}

function formatDateTime(value: number) {
  if (!value) return "No GPS update";
  return new Date(value).toLocaleString("en-PH", { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDuration(seconds: number) {
  if (!seconds) return "0 min";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)} min`;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function dateKey(value: number) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function historyPoints(historyData: Record<string, RawRecord>, scheduleId: string, sessionId: string): Point[] {
  const scheduleHistory = asRecords(historyData[scheduleId]);
  const sessionHistory = (scheduleHistory[sessionId] || {}) as RawRecord;
  const points = asRecords(sessionHistory.points || sessionHistory);
  return Object.values(points).map(gpsPoint).filter((point): point is Point => point !== null).sort((left, right) => left.timestamp - right.timestamp);
}

function passedIndexSet(value: unknown) {
  if (Array.isArray(value)) return new Set(value.map(Number).filter(Number.isFinite));
  if (value && typeof value === "object") return new Set(Object.entries(value as Record<string, unknown>).filter(([, passed]) => passed === true).map(([index]) => Number(index)).filter(Number.isFinite));
  return new Set<number>();
}

export function LiveRouteMonitor() {
  const [drivers, setDrivers] = useState<Record<string, RawRecord>>({});
  const [schedules, setSchedules] = useState<Record<string, RawRecord>>({});
  const [routes, setRoutes] = useState<Record<string, RawRecord>>({});
  const [locations, setLocations] = useState<Record<string, RawRecord>>({});
  const [sessions, setSessions] = useState<Record<string, RawRecord>>({});
  const [history, setHistory] = useState<Record<string, RawRecord>>({});
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [purokFilter, setPurokFilter] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    const listen = (path: string, setter: (value: Record<string, RawRecord>) => void) => onValue(ref(db, path), (snapshot) => { setter(asRecords(snapshot.val())); setLoading(false); }, (error) => { setDataError(error.message || `Unable to read ${path}.`); setLoading(false); });
    const unsubscribers = [
      listen("drivers", setDrivers), listen("schedules", setSchedules), listen("routes", setRoutes),
      listen("driver_locations", setLocations), listen("route_sessions", setSessions), listen("gps_route_history", setHistory),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const allSessions = useMemo(() => {
    const result: Array<{ scheduleId: string; sessionId: string; data: RawRecord }> = [];
    Object.entries(sessions).forEach(([scheduleId, scheduleSessions]) => {
      Object.entries(asRecords(scheduleSessions)).forEach(([sessionId, data]) => result.push({ scheduleId, sessionId, data }));
    });
    return result.sort((left, right) => timestamp(right.data.startTime ?? right.data.createdAt) - timestamp(left.data.startTime ?? left.data.createdAt));
  }, [sessions]);

  const assignments = useMemo<Assignment[]>(() => {
    return Object.entries(schedules).flatMap<Assignment>(([scheduleId, schedule]) => {
      const driverId = String(schedule.assignedDriverId || schedule.driverId || "");
      if (!driverId) return [];
      const driver = drivers[driverId] || {};
      const routeId = String(schedule.routeId || schedule.assignedRouteId || driver.assignedRouteId || "");
      const route = routes[routeId] || {};
      const scheduleSessions = allSessions.filter((session) => session.scheduleId === scheduleId && String(session.data.driverId || driverId) === driverId);
      const currentSession = scheduleSessions.find((item) => !["Completed", "Partially Completed", "Missed Route"].includes(statusValue(item.data.status))) || scheduleSessions[0];
      const location = gpsPoint(locations[driverId]);
      const sessionLocation = gpsPoint(currentSession?.data.lastLocation);
      const latestLocation = location || sessionLocation;
      const sessionStatus = currentSession ? statusValue(currentSession.data.status ?? currentSession.data.routeStatus) : "Not Started";
      return [{
        key: `${driverId}:${scheduleId}`,
        driverId,
        driverName: String(schedule.driverName || driver.name || "Unnamed Driver"),
        truck: String(schedule.truckId || driver.truck || route.assignedVehicle || "No vehicle assigned"),
        scheduleId,
        scheduleName: String(schedule.title || schedule.scheduleName || "Collection schedule"),
        routeId,
        routeName: String(schedule.routeName || route.routeName || "No route assigned"),
        puroks: normalizeArray(schedule.assignedPuroks || schedule.puroks || route.puroks).map((value) => value.toLowerCase().startsWith("purok") ? value : `Purok ${value}`),
        barangay: String(schedule.barangay || normalizeArray(route.barangays)[0] || "No barangay"),
        latestLocation,
        lastUpdate: latestLocation?.timestamp || timestamp(currentSession?.data.lastUpdateTime),
        status: sessionStatus,
        progress: Math.max(0, Math.min(100, Number(currentSession?.data.progress ?? currentSession?.data.routeProgress ?? 0))),
        sessionId: currentSession?.sessionId || "",
        session: currentSession?.data ?? null,
      }];
    });
  }, [schedules, drivers, routes, locations, allSessions]);

  const purokOptions = useMemo(() => Array.from(new Set(assignments.flatMap((item) => item.puroks))).sort(), [assignments]);
  const filteredAssignments = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return assignments.filter((item) => {
      const itemSessions = allSessions.filter((session) => session.scheduleId === item.scheduleId && String(session.data.driverId || item.driverId) === item.driverId);
      const matchesDate = !dateFilter || itemSessions.some((session) => dateKey(timestamp(session.data.startTime ?? session.data.createdAt)) === dateFilter);
      const matchesPurok = !purokFilter || item.puroks.includes(purokFilter);
      const matchesSchedule = !scheduleFilter || item.scheduleId === scheduleFilter;
      const matchesStatus = !statusFilter || item.status === statusFilter;
      const matchesSearch = !keyword || [item.driverName, item.truck, item.scheduleName, item.routeName, item.barangay, ...item.puroks].join(" ").toLowerCase().includes(keyword);
      return matchesDate && matchesPurok && matchesSchedule && matchesStatus && matchesSearch;
    });
  }, [assignments, allSessions, dateFilter, purokFilter, scheduleFilter, statusFilter, search]);

  useEffect(() => {
    if (!selectedKey || !assignments.some((item) => item.key === selectedKey)) setSelectedKey(filteredAssignments[0]?.key || assignments[0]?.key || "");
  }, [selectedKey, assignments, filteredAssignments]);

  const selected = assignments.find((item) => item.key === selectedKey) || filteredAssignments[0] || null;
  const selectedSessions = useMemo(() => selected ? allSessions.filter((session) => session.scheduleId === selected.scheduleId && String(session.data.driverId || selected.driverId) === selected.driverId) : [], [selected, allSessions]);

  useEffect(() => {
    if (!selected) { setSelectedSessionId(""); return; }
    const requested = new URLSearchParams(window.location.search).get("schedule");
    if (requested && requested !== selected.scheduleId) {
      const requestedAssignment = assignments.find((item) => item.scheduleId === requested);
      if (requestedAssignment) { setSelectedKey(requestedAssignment.key); return; }
    }
    if (!selectedSessionId || !selectedSessions.some((session) => session.sessionId === selectedSessionId)) setSelectedSessionId(selected.sessionId || selectedSessions[0]?.sessionId || "");
  }, [selected, selectedSessionId, selectedSessions, assignments]);

  const selectedSession = selectedSessions.find((item) => item.sessionId === selectedSessionId) || selectedSessions[0] || null;
  const selectedRoute = selected ? routes[selected.routeId] || {} : {};
  const routeCoordinates = useMemo(() => normalizeCoordinates(selectedRoute), [selectedRoute]);
  const routeCheckpoints = useMemo(() => normalizeCheckpoints(selectedRoute.checkpoints), [selectedRoute]);
  const fullActualPoints = useMemo(() => selected && selectedSession ? historyPoints(history, selected.scheduleId, selectedSession.sessionId) : [], [history, selected, selectedSession]);

  useEffect(() => { setReplayIndex(Math.max(0, fullActualPoints.length - 1)); setReplaying(false); }, [selectedKey, selectedSessionId, fullActualPoints.length]);
  useEffect(() => {
    if (!replaying || fullActualPoints.length < 2) return;
    const timer = window.setInterval(() => setReplayIndex((current) => {
      if (current >= fullActualPoints.length - 1) { setReplaying(false); return current; }
      return current + 1;
    }), 450);
    return () => window.clearInterval(timer);
  }, [replaying, fullActualPoints.length]);

  const actualPoints = fullActualPoints.slice(0, Math.min(fullActualPoints.length, replayIndex + 1));
  const sessionData = selectedSession?.data || selected?.session || {};
  const passedSegments = passedIndexSet(sessionData.passedSegments);
  const selectedStatus = selectedSession ? statusValue(sessionData.status ?? sessionData.routeStatus) : selected?.status || "Not Started";
  const progress = Math.max(0, Math.min(100, Number(sessionData.progress ?? sessionData.routeProgress ?? selected?.progress ?? 0)));
  const visitedPuroks = normalizeArray(sessionData.visitedPuroks);
  const stats = useMemo(() => ({
    assigned: assignments.length,
    active: assignments.filter((item) => ["Ongoing", "On Route", "Deviated from Route"].includes(item.status)).length,
    deviated: assignments.filter((item) => item.status === "Deviated from Route").length,
    completed: assignments.filter((item) => item.status === "Completed").length,
  }), [assignments]);

  return (
    <section className="live-route-monitor" aria-label="Live driver route monitoring">
      <div className="monitor-heading"><div><span>GPS Route Oversight</span><h2>Live Map & Route Verification</h2><p>Compare the assigned route with actual GPS history, inspect missed sections, and replay completed trips.</p></div><div className="monitor-sync"><i /><strong>Realtime</strong><small>{assignments.length} assigned driver{assignments.length === 1 ? "" : "s"}</small></div></div>
      {dataError && <div className="monitor-error" role="alert">{dataError}</div>}
      <div className="monitor-metrics"><Metric label="Assigned" value={stats.assigned} /><Metric label="Active now" value={stats.active} tone="green" /><Metric label="Deviated" value={stats.deviated} tone="red" /><Metric label="Completed" value={stats.completed} tone="blue" /></div>

      <div className="monitor-filters">
        <label>Date<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
        <label>Purok<select value={purokFilter} onChange={(event) => setPurokFilter(event.target.value)}><option value="">All puroks</option>{purokOptions.map((purok) => <option key={purok}>{purok}</option>)}</select></label>
        <label>Schedule<select value={scheduleFilter} onChange={(event) => setScheduleFilter(event.target.value)}><option value="">All schedules</option>{assignments.map((item) => <option key={item.key} value={item.scheduleId}>{item.scheduleName}</option>)}</select></label>
        <label>Route status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{ROUTE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="monitor-search">Driver search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, vehicle, route…" /></label>
        <button type="button" onClick={() => { setDateFilter(""); setPurokFilter(""); setScheduleFilter(""); setStatusFilter(""); setSearch(""); }}>Reset</button>
      </div>

      <div className="monitor-workspace">
        <div className="monitor-map-panel">
          <RouteMap coordinates={routeCoordinates} actualPoints={actualPoints} checkpoints={routeCheckpoints.map((point) => ({ lng: point.lng, lat: point.lat, purok: point.purok || "" }))} passedSegments={passedSegments} selectedLocation={selected?.latestLocation || fullActualPoints.at(-1) || null} status={selectedStatus} focusKey={`${selectedKey}:${selectedSessionId}`} />
          <div className="map-legend"><span><i className="assigned" />Assigned route</span><span><i className="travelled" />Actual GPS route</span><span><i className="passed" />Passed section</span><span><i className="remaining" />Unreached / missed</span></div>
          {loading && <div className="map-loading"><i />Loading live GPS data…</div>}
          {!loading && !selected && <div className="map-empty"><strong>No assigned drivers match the filters</strong><span>Change a filter or assign a driver and GPS route to a schedule.</span></div>}
        </div>

        <aside className="driver-panel"><div className="driver-panel-head"><div><h3>Drivers</h3><p>{filteredAssignments.length} assignment{filteredAssignments.length === 1 ? "" : "s"} shown</p></div></div><div className="monitor-driver-list">
          {filteredAssignments.map((item) => <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)} className={item.key === selected?.key ? "selected" : ""}><div className="driver-row-head"><span className="driver-initial">{item.driverName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{item.driverName}</strong><small>{item.truck}</small></div><Status status={item.status} /></div><div className="driver-row-meta"><span>{item.scheduleName}</span><span>{item.puroks.join(", ") || "No puroks"}</span><span>GPS: {formatDateTime(item.lastUpdate)}</span></div><div className="mini-progress"><i style={{ width: `${item.progress}%` }} /></div></button>)}
        </div></aside>
      </div>

      {selected && <div className="route-detail-grid">
        <div className="route-summary-card"><div className="route-title"><div><small>Selected operation</small><h3>{selected.routeName}</h3><p>{selected.driverName} • {selected.truck} • {selected.scheduleName}</p></div><Status status={selectedStatus} /></div><div className="route-progress"><div><strong>{progress}%</strong><span>assigned route completed</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div><div className="route-facts"><Fact label="Started" value={formatDateTime(timestamp(sessionData.startTime))} /><Fact label="Completed" value={formatDateTime(timestamp(sessionData.completionTime ?? sessionData.completedAt))} /><Fact label="Distance travelled" value={formatDistance(Number(sessionData.distanceTravelledMeters || 0))} /><Fact label="Duration" value={formatDuration(Number(sessionData.durationSeconds || 0))} /><Fact label="Last location" value={selected.latestLocation ? `${selected.latestLocation.lat.toFixed(5)}, ${selected.latestLocation.lng.toFixed(5)}` : "No GPS"} /><Fact label="Last update" value={formatDateTime(selected.lastUpdate)} /></div></div>
        <div className="purok-visit-card"><div><small>Assigned Puroks</small><h3>Visit verification</h3></div><div className="visit-list">{selected.puroks.length === 0 ? <p>No puroks assigned.</p> : selected.puroks.map((purok) => { const visited = visitedPuroks.some((value) => value.toLowerCase() === purok.toLowerCase()); return <div key={purok} className={visited ? "visited" : "pending"}><i>{visited ? "✓" : "–"}</i><span>{purok}</span><strong>{visited ? "Visited" : selectedStatus === "Completed" || selectedStatus === "Partially Completed" || selectedStatus === "Missed Route" ? "Missed" : "Pending"}</strong></div>; })}</div></div>
      </div>}

      {selected && <div className="route-replay"><div className="replay-heading"><div><small>Route history</small><h3>Replay recorded GPS points</h3></div><select value={selectedSession?.sessionId || ""} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="">No recorded session</option>{selectedSessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{formatDateTime(timestamp(session.data.startTime))} • {statusValue(session.data.status)}</option>)}</select></div><div className="replay-controls"><button type="button" disabled={fullActualPoints.length < 2} onClick={() => { if (replayIndex >= fullActualPoints.length - 1) setReplayIndex(0); setReplaying((current) => !current); }}>{replaying ? "Pause" : "Replay"}</button><input type="range" min={0} max={Math.max(0, fullActualPoints.length - 1)} value={Math.min(replayIndex, Math.max(0, fullActualPoints.length - 1))} onChange={(event) => { setReplaying(false); setReplayIndex(Number(event.target.value)); }} disabled={fullActualPoints.length === 0} /><span>{fullActualPoints.length === 0 ? "No GPS history" : `Point ${Math.min(replayIndex + 1, fullActualPoints.length)} of ${fullActualPoints.length}`}</span></div></div>}

      <style jsx global>{`
        .live-route-monitor{display:flex;flex-direction:column;gap:15px;padding-top:2px}.monitor-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.monitor-heading>div>span{color:#059669;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.monitor-heading h2{margin:6px 0 0;color:#0f172a;font-size:25px;letter-spacing:-.035em}.monitor-heading p{margin:5px 0 0;color:#64748b;font-size:13px}.monitor-sync{display:grid;grid-template-columns:auto 1fr;column-gap:9px;padding:11px 13px;border:1px solid #dbe4df;border-radius:14px;background:#f8faf9;min-width:160px}.monitor-sync i{grid-row:1/3;width:10px;height:10px;margin-top:4px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13)}.monitor-sync strong,.monitor-sync small{display:block}.monitor-sync strong{font-size:12px}.monitor-sync small{color:#64748b}.monitor-error{padding:12px;border:1px solid #fecaca;border-radius:13px;background:#fef2f2;color:#b91c1c}.monitor-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.monitor-metric{padding:13px 14px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}.monitor-metric small,.monitor-metric strong{display:block}.monitor-metric small{color:#64748b}.monitor-metric strong{margin-top:5px;font-size:24px;color:#0f172a}.monitor-metric.green{background:#f0fdf4}.monitor-metric.red{background:#fef2f2}.monitor-metric.blue{background:#eff6ff}.monitor-filters{display:grid;grid-template-columns:145px 145px minmax(180px,1fr) 180px minmax(190px,1.2fr) auto;gap:9px;padding:12px;border:1px solid #e2e8f0;border-radius:17px;background:#fff}.monitor-filters label{display:flex;flex-direction:column;gap:5px;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.monitor-filters input,.monitor-filters select{height:39px;min-width:0;border:1px solid #dbe3df;border-radius:11px;background:#f8faf9;color:#0f172a;padding:0 9px;font-size:12px}.monitor-filters>button{height:39px;align-self:end;border:0;border-radius:11px;background:#f1f5f9;color:#334155;font-weight:850}.monitor-workspace{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(290px,.75fr);min-height:540px;border:1px solid #dbe3df;border-radius:21px;overflow:hidden;background:#fff}.monitor-map-panel{position:relative;min-height:540px}.route-live-map{position:absolute;inset:0}.map-legend{position:absolute;z-index:2;left:14px;bottom:14px;display:flex;flex-wrap:wrap;gap:9px;padding:9px 11px;border-radius:13px;background:rgba(255,255,255,.94);box-shadow:0 8px 24px rgba(15,23,42,.14);font-size:10px;color:#475569}.map-legend span{display:flex;align-items:center;gap:5px}.map-legend i{width:24px;height:4px;border-radius:4px}.map-legend .assigned{background:#0f766e}.map-legend .travelled{background:#2563eb}.map-legend .passed{background:#22c55e}.map-legend .remaining{background:#f59e0b}.map-loading,.map-empty{position:absolute;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:7px;padding:17px;border-radius:16px;background:rgba(255,255,255,.95);box-shadow:0 12px 30px rgba(15,23,42,.16);text-align:center;color:#64748b}.map-loading i{width:27px;height:27px;border:3px solid #d1fae5;border-top-color:#059669;border-radius:50%;animation:monitor-spin .8s linear infinite}.map-empty strong{color:#0f172a}.driver-panel{border-left:1px solid #e2e8f0;background:#f8faf9;min-height:540px;display:flex;flex-direction:column}.driver-panel-head{padding:15px;border-bottom:1px solid #e2e8f0}.driver-panel-head h3{margin:0;color:#0f172a}.driver-panel-head p{margin:3px 0 0;color:#64748b;font-size:11px}.monitor-driver-list{padding:9px;overflow:auto;display:flex;flex-direction:column;gap:8px;max-height:490px}.monitor-driver-list>button{border:1px solid #e2e8f0;border-radius:15px;background:#fff;padding:11px;text-align:left;cursor:pointer}.monitor-driver-list>button.selected{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.11)}.driver-row-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px}.driver-initial{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#064e3b;color:#fff;font-weight:900}.driver-row-head strong,.driver-row-head small{display:block}.driver-row-head strong{color:#0f172a;font-size:12px}.driver-row-head small{margin-top:2px;color:#64748b;font-size:10px}.route-status{display:inline-flex;padding:5px 7px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:9px;font-weight:900;white-space:nowrap}.route-status.completed,.route-status.on-route{background:#dcfce7;color:#166534}.route-status.deviated-from-route,.route-status.missed-route{background:#fee2e2;color:#991b1b}.route-status.ongoing,.route-status.partially-completed{background:#fef3c7;color:#92400e}.driver-row-meta{display:flex;flex-direction:column;gap:3px;margin-top:8px;color:#64748b;font-size:10px}.mini-progress,.progress-track{height:6px;border-radius:999px;overflow:hidden;background:#e2e8f0}.mini-progress{margin-top:8px}.mini-progress i,.progress-track i{display:block;height:100%;background:linear-gradient(90deg,#059669,#22c55e)}.route-detail-grid{display:grid;grid-template-columns:1.55fr .75fr;gap:12px}.route-summary-card,.purok-visit-card,.route-replay{padding:16px;border:1px solid #e2e8f0;border-radius:18px;background:#fff}.route-title{display:flex;justify-content:space-between;gap:12px}.route-title small,.replay-heading small,.purok-visit-card>div>small{color:#059669;font-size:10px;font-weight:900;text-transform:uppercase}.route-title h3,.purok-visit-card h3,.replay-heading h3{margin:4px 0 0;color:#0f172a}.route-title p{margin:4px 0 0;color:#64748b;font-size:11px}.route-progress{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:13px;margin-top:14px}.route-progress strong,.route-progress span{display:block}.route-progress strong{font-size:24px;color:#0f172a}.route-progress span{color:#64748b;font-size:10px}.progress-track{height:9px}.route-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.route-fact{padding:9px;border-radius:11px;background:#f8fafc}.route-fact small,.route-fact strong{display:block}.route-fact small{color:#64748b;font-size:9px;text-transform:uppercase}.route-fact strong{margin-top:3px;color:#0f172a;font-size:11px;overflow-wrap:anywhere}.visit-list{display:flex;flex-direction:column;gap:7px;margin-top:12px;max-height:240px;overflow:auto}.visit-list>div{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:8px;border-radius:11px;background:#f8fafc}.visit-list i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:900}.visit-list .visited i{background:#dcfce7;color:#166534}.visit-list .pending i{background:#fef3c7;color:#92400e}.visit-list span{font-size:11px;color:#334155}.visit-list strong{font-size:9px;color:#64748b}.replay-heading{display:flex;justify-content:space-between;align-items:end;gap:12px}.replay-heading select{height:38px;max-width:360px;border:1px solid #dbe3df;border-radius:10px;padding:0 9px;background:#f8faf9}.replay-controls{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:12px}.replay-controls button{height:36px;border:0;border-radius:10px;background:#059669;color:#fff;padding:0 14px;font-weight:900}.replay-controls button:disabled{opacity:.5}.replay-controls span{color:#64748b;font-size:11px}.live-driver-marker{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#0f172a;color:#fff;border:4px solid #fff;box-shadow:0 5px 16px rgba(15,23,42,.38);font-size:18px}@keyframes monitor-spin{to{transform:rotate(360deg)}}@media(max-width:1050px){.monitor-filters{grid-template-columns:repeat(3,1fr)}.monitor-workspace{grid-template-columns:1fr}.driver-panel{border-left:0;border-top:1px solid #e2e8f0;min-height:auto}.monitor-driver-list{max-height:320px}.route-detail-grid{grid-template-columns:1fr}}@media(max-width:700px){.monitor-heading{align-items:flex-start;flex-direction:column}.monitor-sync{width:100%}.monitor-metrics{grid-template-columns:1fr 1fr}.monitor-filters{grid-template-columns:1fr 1fr}.monitor-search{grid-column:1/-1}.monitor-workspace,.monitor-map-panel{min-height:440px}.route-facts{grid-template-columns:1fr 1fr}.replay-heading{align-items:stretch;flex-direction:column}.replay-heading select{max-width:none}.replay-controls{grid-template-columns:1fr}.map-legend{right:14px}}@media(max-width:480px){.monitor-filters,.monitor-metrics,.route-facts{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={`monitor-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>; }
function Status({ status }: { status: RouteStatus }) { return <span className={`route-status ${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="route-fact"><small>{label}</small><strong>{value}</strong></div>; }

function RouteMap({ coordinates, actualPoints, checkpoints, passedSegments, selectedLocation, status, focusKey }: { coordinates: LngLatTuple[]; actualPoints: Point[]; checkpoints: Array<{ lng: number; lat: number; purok: string }>; passedSegments: Set<number>; selectedLocation: Point | null; status: RouteStatus; focusKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    import("maplibre-gl").then((maplibregl) => {
      if (disposed || !containerRef.current) return;
      const map = new maplibregl.Map({ container: containerRef.current, center: DEFAULT_CENTER, zoom: 13, style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] } });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("load", () => {
        map.addSource("assigned-route", { type: "geojson", data: emptyLine() });
        map.addSource("route-segments", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("actual-route", { type: "geojson", data: emptyLine() });
        map.addSource("route-checkpoints", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "assigned-route", type: "line", source: "assigned-route", paint: { "line-color": "#0f766e", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": .75 } });
        map.addLayer({ id: "route-remaining", type: "line", source: "route-segments", filter: ["==", ["get", "passed"], false], paint: { "line-color": ["get", "color"], "line-width": 6, "line-dasharray": [2, 1.4] } });
        map.addLayer({ id: "route-passed", type: "line", source: "route-segments", filter: ["==", ["get", "passed"], true], paint: { "line-color": "#22c55e", "line-width": 7 } });
        map.addLayer({ id: "actual-route", type: "line", source: "actual-route", paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": .92 } });
        map.addLayer({ id: "route-checkpoints", type: "circle", source: "route-checkpoints", paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-width": 3, "circle-stroke-color": "#059669" } });
        setReady(true);
      });
      mapRef.current = map;
    });
    return () => { disposed = true; markerRef.current?.remove(); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const remainingColor = ["Completed", "Partially Completed", "Missed Route"].includes(status) ? "#ef4444" : "#f59e0b";
    setSource(map, "assigned-route", lineData(coordinates));
    setSource(map, "route-segments", { type: "FeatureCollection", features: coordinates.slice(1).map((coordinate, index) => ({ type: "Feature", properties: { passed: passedSegments.has(index), color: remainingColor }, geometry: { type: "LineString", coordinates: [coordinates[index], coordinate] } })) });
    setSource(map, "actual-route", lineData(actualPoints.map((point): LngLatTuple => [point.lng, point.lat])));
    setSource(map, "route-checkpoints", { type: "FeatureCollection", features: checkpoints.map((point) => ({ type: "Feature", properties: { purok: point.purok }, geometry: { type: "Point", coordinates: [point.lng, point.lat] } })) });
    markerRef.current?.remove();
    if (selectedLocation) {
      import("maplibre-gl").then((maplibregl) => {
        const element = document.createElement("div"); element.className = "live-driver-marker"; element.textContent = "🚚";
        markerRef.current = new maplibregl.Marker({ element }).setLngLat([selectedLocation.lng, selectedLocation.lat]).addTo(map);
      });
    }
    const all = [...coordinates, ...actualPoints.map((point): LngLatTuple => [point.lng, point.lat]), ...(selectedLocation ? [[selectedLocation.lng, selectedLocation.lat] as LngLatTuple] : [])];
    if (all.length === 1) map.flyTo({ center: all[0], zoom: 16 });
    else if (all.length > 1) {
      const minLng = Math.min(...all.map((point) => point[0])); const maxLng = Math.max(...all.map((point) => point[0])); const minLat = Math.min(...all.map((point) => point[1])); const maxLat = Math.max(...all.map((point) => point[1]));
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 17, duration: 700 });
    }
  }, [ready, coordinates, actualPoints, checkpoints, passedSegments, selectedLocation, status, focusKey]);

  return <div ref={containerRef} className="route-live-map" />;
}

function emptyLine() { return { type: "FeatureCollection" as const, features: [] }; }
function lineData(coordinates: LngLatTuple[]) { return coordinates.length >= 2 ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } } : emptyLine(); }
function setSource(map: MapLibreMap, id: string, data: Parameters<GeoJSONSource["setData"]>[0]) { (map.getSource(id) as GeoJSONSource | undefined)?.setData(data); }
