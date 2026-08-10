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

type DriverActivity = {
  key: string;
  driverId: string;
  driverName: string;
  truck: string;
  scheduleId: string;
  sessionId: string;
  scheduleName: string;
  routeId: string;
  routeName: string;
  barangay: string;
  puroks: string[];
  activityTime: number;
  startTime: number;
  endTime: number;
  status: RouteStatus;
  progress: number;
  distanceMeters: number;
  durationSeconds: number;
  assignedCoordinates: LngLatTuple[];
  actualPoints: Point[];
  data: RawRecord;
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

function formatActivityDay(value: number) {
  if (!value) return "Undated activity";
  const date = new Date(value);
  const today = new Date();
  const label = date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  const isToday = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return isToday ? `Today • ${label}` : label;
}

function formatTimeOnly(value: number) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
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
  const [openActivityDays, setOpenActivityDays] = useState<Set<string>>(new Set());

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

  const driverActivities = useMemo<DriverActivity[]>(() => {
    if (!selected) return [];

    const driver = drivers[selected.driverId] || {};

    return allSessions
      .flatMap<DriverActivity>((session) => {
        const schedule = schedules[session.scheduleId] || {};
        const sessionDriverId = String(
          session.data.driverId
          || schedule.assignedDriverId
          || schedule.driverId
          || ""
        );

        if (sessionDriverId !== selected.driverId) return [];

        const routeId = String(
          schedule.routeId
          || schedule.assignedRouteId
          || driver.assignedRouteId
          || ""
        );
        const route = routes[routeId] || {};

        const startTime = timestamp(
          session.data.startTime
          ?? session.data.createdAt
          ?? session.data.startedAt
        );
        const endTime = timestamp(
          session.data.completionTime
          ?? session.data.completedAt
          ?? session.data.endTime
        );
        const activityTime = startTime
          || endTime
          || timestamp(session.data.lastUpdateTime ?? session.data.updatedAt);

        return [{
          key: `${session.scheduleId}:${session.sessionId}`,
          driverId: selected.driverId,
          driverName: String(schedule.driverName || driver.name || selected.driverName || "Unnamed Driver"),
          truck: String(schedule.truckId || driver.truck || route.assignedVehicle || selected.truck || "No vehicle assigned"),
          scheduleId: session.scheduleId,
          sessionId: session.sessionId,
          scheduleName: String(schedule.title || schedule.scheduleName || "Collection schedule"),
          routeId,
          routeName: String(schedule.routeName || route.routeName || "No route assigned"),
          barangay: String(schedule.barangay || normalizeArray(route.barangays)[0] || "No barangay"),
          puroks: normalizeArray(schedule.assignedPuroks || schedule.puroks || route.puroks)
            .map((value) => value.toLowerCase().startsWith("purok") ? value : `Purok ${value}`),
          activityTime,
          startTime,
          endTime,
          status: statusValue(session.data.status ?? session.data.routeStatus),
          progress: Math.max(0, Math.min(100, Number(session.data.progress ?? session.data.routeProgress ?? 0))),
          distanceMeters: Number(session.data.distanceTravelledMeters || 0),
          durationSeconds: Number(session.data.durationSeconds || 0),
          assignedCoordinates: normalizeCoordinates(route),
          actualPoints: historyPoints(history, session.scheduleId, session.sessionId),
          data: session.data,
        }];
      })
      .sort((left, right) => right.activityTime - left.activityTime);
  }, [selected, allSessions, schedules, routes, drivers, history]);

  const activityGroups = useMemo(() => {
    const groups = new Map<string, DriverActivity[]>();

    driverActivities.forEach((activity) => {
      const key = dateKey(activity.activityTime) || "undated";
      const current = groups.get(key) || [];
      current.push(activity);
      groups.set(key, current);
    });

    return Array.from(groups.entries()).map(([key, activities]) => ({
      key,
      date: activities[0]?.activityTime || 0,
      activities,
    }));
  }, [driverActivities]);

  const openActivity = (activity: DriverActivity) => {
    const assignment = assignments.find(
      (item) => item.driverId === activity.driverId && item.scheduleId === activity.scheduleId
    );

    if (assignment) setSelectedKey(assignment.key);
    setSelectedSessionId(activity.sessionId);

    window.setTimeout(() => {
      document.getElementById("selected-operation")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };

  useEffect(() => {
    if (!selected || activityGroups.length === 0) {
      setOpenActivityDays(new Set());
      return;
    }

    setOpenActivityDays((current) => {
      const validKeys = new Set(activityGroups.map((group) => group.key));
      const next = new Set(Array.from(current).filter((key) => validKeys.has(key)));

      if (next.size === 0) next.add(activityGroups[0].key);
      return next;
    });
  }, [selected?.driverId, activityGroups]);

  const toggleActivityDay = (key: string) => {
    setOpenActivityDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
          <RouteMap coordinates={routeCoordinates} actualPoints={actualPoints} checkpoints={routeCheckpoints.map((point) => ({ lng: point.lng, lat: point.lat, purok: point.purok || "" }))} passedSegments={passedSegments} selectedLocation={selected?.latestLocation || fullActualPoints.at(-1) || null} status={selectedStatus} driverName={selected?.driverName || ""} truck={selected?.truck || ""} focusKey={`${selectedKey}:${selectedSessionId}`} />
          <div className="map-legend"><span><i className="assigned" />Assigned route</span><span><i className="travelled" />Actual GPS route</span><span><i className="passed" />Passed section</span><span><i className="remaining" />Unreached / missed</span></div>
          {loading && <div className="map-loading"><i />Loading live GPS data…</div>}
          {!loading && !selected && <div className="map-empty"><strong>No assigned drivers match the filters</strong><span>Change a filter or assign a driver and GPS route to a schedule.</span></div>}
        </div>

        <aside className="driver-panel"><div className="driver-panel-head"><div><h3>Drivers</h3><p>{filteredAssignments.length} assignment{filteredAssignments.length === 1 ? "" : "s"} shown</p></div></div><div className="monitor-driver-list">
          {filteredAssignments.map((item) => <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)} className={item.key === selected?.key ? "selected" : ""}><div className="driver-row-head"><span className="driver-initial">{item.driverName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{item.driverName}</strong><small>{item.truck}</small></div><Status status={item.status} /></div><div className="driver-row-meta"><span>{item.scheduleName}</span><span>{item.puroks.join(", ") || "No puroks"}</span><span>GPS: {formatDateTime(item.lastUpdate)}</span></div><div className="mini-progress"><i style={{ width: `${item.progress}%` }} /></div></button>)}
        </div></aside>
      </div>

      {selected && <div className="route-detail-grid" id="selected-operation">
        <div className="route-summary-card"><div className="route-title"><div><small>Selected operation</small><h3>{selected.routeName}</h3><p>{selected.driverName} • {selected.truck} • {selected.scheduleName}</p></div><Status status={selectedStatus} /></div><div className="route-progress"><div><strong>{progress}%</strong><span>assigned route completed</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div><div className="route-facts"><Fact label="Started" value={formatDateTime(timestamp(sessionData.startTime))} /><Fact label="Completed" value={formatDateTime(timestamp(sessionData.completionTime ?? sessionData.completedAt))} /><Fact label="Distance travelled" value={formatDistance(Number(sessionData.distanceTravelledMeters || 0))} /><Fact label="Duration" value={formatDuration(Number(sessionData.durationSeconds || 0))} /><Fact label="Last location" value={selected.latestLocation ? `${selected.latestLocation.lat.toFixed(5)}, ${selected.latestLocation.lng.toFixed(5)}` : "No GPS"} /><Fact label="Last update" value={formatDateTime(selected.lastUpdate)} /></div></div>
        <div className="purok-visit-card"><div><small>Assigned Puroks</small><h3>Visit verification</h3></div><div className="visit-list">{selected.puroks.length === 0 ? <p>No puroks assigned.</p> : selected.puroks.map((purok) => { const visited = visitedPuroks.some((value) => value.toLowerCase() === purok.toLowerCase()); return <div key={purok} className={visited ? "visited" : "pending"}><i>{visited ? "✓" : "–"}</i><span>{purok}</span><strong>{visited ? "Visited" : selectedStatus === "Completed" || selectedStatus === "Partially Completed" || selectedStatus === "Missed Route" ? "Missed" : "Pending"}</strong></div>; })}</div></div>
      </div>}


      {selected && <div className="driver-activity-card" id="driver-daily-activity">
        <div className="activity-card-head">
          <div>
            <small>Driver history</small>
            <h3>{selected.driverName} — Daily Activity</h3>
            <p>Open a date folder to view the barangay, assigned route, GPS activity map, and recorded trips.</p>
          </div>
          <button
            type="button"
            className="activity-print-all"
            disabled={driverActivities.length === 0}
            onClick={() => printDriverActivityReport(`${selected.driverName} — All Recorded Activity`, selected, driverActivities)}
          >
            Print all activity
          </button>
        </div>

        {activityGroups.length === 0 ? (
          <div className="activity-empty">
            <strong>No recorded daily activity yet.</strong>
            <span>Activities will appear here when route sessions are saved in Firebase.</span>
          </div>
        ) : (
          <div className="activity-folders">
            {activityGroups.map((group) => {
              const isOpen = openActivityDays.has(group.key);
              const barangays = Array.from(new Set(group.activities.map((activity) => activity.barangay).filter(Boolean)));
              const completed = group.activities.filter((activity) => activity.status === "Completed").length;

              return (
                <section className={`activity-folder ${isOpen ? "open" : ""}`} key={group.key}>
                  <div className="activity-folder-head">
                    <button
                      type="button"
                      className="activity-folder-toggle"
                      aria-expanded={isOpen}
                      onClick={() => toggleActivityDay(group.key)}
                    >
                      <span className="folder-icon" aria-hidden="true">{isOpen ? "📂" : "📁"}</span>

                      <span className="folder-title">
                        <strong>{formatActivityDay(group.date)}</strong>
                        <small>
                          {group.activities.length} activit{group.activities.length === 1 ? "y" : "ies"}
                          {" • "}
                          {barangays.length} barangay{barangays.length === 1 ? "" : "s"}
                          {" • "}
                          {completed} completed
                        </small>
                      </span>

                      <span className="folder-chevron" aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
                    </button>

                    <button
                      type="button"
                      className="folder-print"
                      onClick={() => printDriverActivityReport(
                        `${selected.driverName} — ${formatActivityDay(group.date)}`,
                        selected,
                        group.activities
                      )}
                    >
                      Print day
                    </button>
                  </div>

                  {isOpen && (
                    <div className="activity-folder-body">
                      <div className="activity-day-overview">
                        <div className="activity-map-card">
                          <div className="activity-map-head">
                            <div>
                              <small>GPS activity map</small>
                              <strong>{formatActivityDay(group.date)}</strong>
                            </div>
                            <span>Assigned route + actual GPS trail</span>
                          </div>

                          <ActivityDayMap
                            activities={group.activities}
                            focusKey={`${selected.driverId}:${group.key}`}
                          />

                          <div className="activity-map-legend">
                            <span><i className="assigned" />Assigned route</span>
                            <span><i className="actual" />Actual GPS trail</span>
                          </div>
                        </div>

                        <div className="activity-day-summary">
                          <div>
                            <small>Barangays</small>
                            <strong>{barangays.join(", ") || "No barangay recorded"}</strong>
                          </div>
                          <div>
                            <small>Total activities</small>
                            <strong>{group.activities.length}</strong>
                          </div>
                          <div>
                            <small>Completed</small>
                            <strong>{completed}</strong>
                          </div>
                          <div>
                            <small>Total distance</small>
                            <strong>{formatDistance(group.activities.reduce((sum, activity) => sum + activity.distanceMeters, 0))}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="activity-list">
                        {group.activities.map((activity) => (
                          <article
                            key={activity.key}
                            className={`activity-record ${activity.sessionId === selectedSessionId ? "selected" : ""}`}
                          >
                            <button
                              type="button"
                              className="activity-open"
                              onClick={() => openActivity(activity)}
                            >
                              <span className="activity-record-icon">🚛</span>

                              <span className="activity-main">
                                <span className="activity-brgy">Barangay {activity.barangay.replace(/^barangay\s+/i, "")}</span>
                                <strong>{activity.routeName}</strong>
                                <small>{activity.scheduleName}</small>
                              </span>

                              <span className="activity-time">
                                <strong>{formatTimeOnly(activity.startTime)} – {formatTimeOnly(activity.endTime)}</strong>
                                <small>{activity.truck}</small>
                              </span>

                              <span className="activity-status-wrap">
                                <Status status={activity.status} />
                                <small>{activity.progress}% complete</small>
                              </span>
                            </button>

                            <div className="activity-extra">
                              <span><b>Assigned route:</b> {activity.routeName}</span>
                              <span><b>Puroks:</b> {activity.puroks.join(", ") || "No puroks listed"}</span>
                              <span><b>Distance:</b> {formatDistance(activity.distanceMeters)}</span>
                              <span><b>Duration:</b> {formatDuration(activity.durationSeconds)}</span>
                              <span><b>GPS points:</b> {activity.actualPoints.length}</span>
                              <button
                                type="button"
                                onClick={() => printDriverActivityReport(
                                  `${activity.driverName} — ${formatActivityDay(activity.activityTime)}`,
                                  selected,
                                  [activity]
                                )}
                              >
                                Print activity
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>}

      {selected && <div className="route-replay"><div className="replay-heading"><div><small>Route history</small><h3>Replay recorded GPS points</h3></div><select value={selectedSession?.sessionId || ""} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="">No recorded session</option>{selectedSessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{formatDateTime(timestamp(session.data.startTime))} • {statusValue(session.data.status)}</option>)}</select></div><div className="replay-controls"><button type="button" disabled={fullActualPoints.length < 2} onClick={() => { if (replayIndex >= fullActualPoints.length - 1) setReplayIndex(0); setReplaying((current) => !current); }}>{replaying ? "Pause" : "Replay"}</button><input type="range" min={0} max={Math.max(0, fullActualPoints.length - 1)} value={Math.min(replayIndex, Math.max(0, fullActualPoints.length - 1))} onChange={(event) => { setReplaying(false); setReplayIndex(Number(event.target.value)); }} disabled={fullActualPoints.length === 0} /><span>{fullActualPoints.length === 0 ? "No GPS history" : `Point ${Math.min(replayIndex + 1, fullActualPoints.length)} of ${fullActualPoints.length}`}</span></div></div>}

      <style jsx global>{`
        .live-route-monitor{display:flex;flex-direction:column;gap:15px;padding-top:2px}.monitor-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.monitor-heading>div>span{color:#059669;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.monitor-heading h2{margin:6px 0 0;color:#0f172a;font-size:25px;letter-spacing:-.035em}.monitor-heading p{margin:5px 0 0;color:#64748b;font-size:13px}.monitor-sync{display:grid;grid-template-columns:auto 1fr;column-gap:9px;padding:11px 13px;border:1px solid #dbe4df;border-radius:14px;background:#f8faf9;min-width:160px}.monitor-sync i{grid-row:1/3;width:10px;height:10px;margin-top:4px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13)}.monitor-sync strong,.monitor-sync small{display:block}.monitor-sync strong{font-size:12px}.monitor-sync small{color:#64748b}.monitor-error{padding:12px;border:1px solid #fecaca;border-radius:13px;background:#fef2f2;color:#b91c1c}.monitor-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.monitor-metric{padding:13px 14px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}.monitor-metric small,.monitor-metric strong{display:block}.monitor-metric small{color:#64748b}.monitor-metric strong{margin-top:5px;font-size:24px;color:#0f172a}.monitor-metric.green{background:#f0fdf4}.monitor-metric.red{background:#fef2f2}.monitor-metric.blue{background:#eff6ff}.monitor-filters{display:grid;grid-template-columns:145px 145px minmax(180px,1fr) 180px minmax(190px,1.2fr) auto;gap:9px;padding:12px;border:1px solid #e2e8f0;border-radius:17px;background:#fff}.monitor-filters label{display:flex;flex-direction:column;gap:5px;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.monitor-filters input,.monitor-filters select{height:39px;min-width:0;border:1px solid #dbe3df;border-radius:11px;background:#f8faf9;color:#0f172a;padding:0 9px;font-size:12px}.monitor-filters>button{height:39px;align-self:end;border:0;border-radius:11px;background:#f1f5f9;color:#334155;font-weight:850}.monitor-workspace{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(290px,.75fr);min-height:540px;border:1px solid #dbe3df;border-radius:21px;overflow:hidden;background:#fff}.monitor-map-panel{position:relative;min-height:540px}.route-live-map{position:absolute;inset:0}.map-legend{position:absolute;z-index:2;left:14px;bottom:14px;display:flex;flex-wrap:wrap;gap:9px;padding:9px 11px;border-radius:13px;background:rgba(255,255,255,.94);box-shadow:0 8px 24px rgba(15,23,42,.14);font-size:10px;color:#475569}.map-legend span{display:flex;align-items:center;gap:5px}.map-legend i{width:24px;height:4px;border-radius:4px}.map-legend .assigned{background:#0f766e}.map-legend .travelled{background:#2563eb}.map-legend .passed{background:#22c55e}.map-legend .remaining{background:#f59e0b}.map-loading,.map-empty{position:absolute;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:7px;padding:17px;border-radius:16px;background:rgba(255,255,255,.95);box-shadow:0 12px 30px rgba(15,23,42,.16);text-align:center;color:#64748b}.map-loading i{width:27px;height:27px;border:3px solid #d1fae5;border-top-color:#059669;border-radius:50%;animation:monitor-spin .8s linear infinite}.map-empty strong{color:#0f172a}.driver-panel{border-left:1px solid #e2e8f0;background:#f8faf9;min-height:540px;display:flex;flex-direction:column}.driver-panel-head{padding:15px;border-bottom:1px solid #e2e8f0}.driver-panel-head h3{margin:0;color:#0f172a}.driver-panel-head p{margin:3px 0 0;color:#64748b;font-size:11px}.monitor-driver-list{padding:9px;overflow:auto;display:flex;flex-direction:column;gap:8px;max-height:490px}.monitor-driver-list>button{border:1px solid #e2e8f0;border-radius:15px;background:#fff;padding:11px;text-align:left;cursor:pointer}.monitor-driver-list>button.selected{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.11)}.driver-row-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px}.driver-initial{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#064e3b;color:#fff;font-weight:900}.driver-row-head strong,.driver-row-head small{display:block}.driver-row-head strong{color:#0f172a;font-size:12px}.driver-row-head small{margin-top:2px;color:#64748b;font-size:10px}.route-status{display:inline-flex;padding:5px 7px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:9px;font-weight:900;white-space:nowrap}.route-status.completed,.route-status.on-route{background:#dcfce7;color:#166534}.route-status.deviated-from-route,.route-status.missed-route{background:#fee2e2;color:#991b1b}.route-status.ongoing,.route-status.partially-completed{background:#fef3c7;color:#92400e}.driver-row-meta{display:flex;flex-direction:column;gap:3px;margin-top:8px;color:#64748b;font-size:10px}.mini-progress,.progress-track{height:6px;border-radius:999px;overflow:hidden;background:#e2e8f0}.mini-progress{margin-top:8px}.mini-progress i,.progress-track i{display:block;height:100%;background:linear-gradient(90deg,#059669,#22c55e)}.route-detail-grid{display:grid;grid-template-columns:1.55fr .75fr;gap:12px}.route-summary-card,.purok-visit-card,.route-replay{padding:16px;border:1px solid #e2e8f0;border-radius:18px;background:#fff}.route-title{display:flex;justify-content:space-between;gap:12px}.route-title small,.replay-heading small,.purok-visit-card>div>small{color:#059669;font-size:10px;font-weight:900;text-transform:uppercase}.route-title h3,.purok-visit-card h3,.replay-heading h3{margin:4px 0 0;color:#0f172a}.route-title p{margin:4px 0 0;color:#64748b;font-size:11px}.route-progress{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:13px;margin-top:14px}.route-progress strong,.route-progress span{display:block}.route-progress strong{font-size:24px;color:#0f172a}.route-progress span{color:#64748b;font-size:10px}.progress-track{height:9px}.route-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.route-fact{padding:9px;border-radius:11px;background:#f8fafc}.route-fact small,.route-fact strong{display:block}.route-fact small{color:#64748b;font-size:9px;text-transform:uppercase}.route-fact strong{margin-top:3px;color:#0f172a;font-size:11px;overflow-wrap:anywhere}.visit-list{display:flex;flex-direction:column;gap:7px;margin-top:12px;max-height:240px;overflow:auto}.visit-list>div{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:8px;border-radius:11px;background:#f8fafc}.visit-list i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:900}.visit-list .visited i{background:#dcfce7;color:#166534}.visit-list .pending i{background:#fef3c7;color:#92400e}.visit-list span{font-size:11px;color:#334155}.visit-list strong{font-size:9px;color:#64748b}.replay-heading{display:flex;justify-content:space-between;align-items:end;gap:12px}.replay-heading select{height:38px;max-width:360px;border:1px solid #dbe3df;border-radius:10px;padding:0 9px;background:#f8faf9}.replay-controls{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:12px}.replay-controls button{height:36px;border:0;border-radius:10px;background:#059669;color:#fff;padding:0 14px;font-weight:900}.replay-controls button:disabled{opacity:.5}.replay-controls span{color:#64748b;font-size:11px}.driver-activity-card{padding:16px;border:1px solid #e2e8f0;border-radius:18px;background:#fff}.activity-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.activity-card-head small{color:#059669;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.activity-card-head h3{margin:4px 0 0;color:#0f172a}.activity-card-head p{margin:5px 0 0;color:#64748b;font-size:11px}.activity-print-all,.folder-print,.activity-extra button{border:0;border-radius:10px;background:#0f172a;color:#fff;font-weight:850;cursor:pointer}.activity-print-all{height:38px;padding:0 14px}.activity-print-all:disabled{opacity:.45;cursor:not-allowed}.activity-empty{display:flex;flex-direction:column;gap:4px;margin-top:14px;padding:18px;border-radius:14px;background:#f8fafc;color:#64748b}.activity-empty strong{color:#0f172a}.activity-folders{display:flex;flex-direction:column;gap:10px;margin-top:15px}.activity-folder{border:1px solid #dbe3df;border-radius:15px;overflow:hidden;background:#fff;transition:border-color .2s ease,box-shadow .2s ease}.activity-folder.open{border-color:#86efac;box-shadow:0 0 0 3px rgba(34,197,94,.06)}.activity-folder-head{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:8px;background:#f8fafc}.activity-folder.open .activity-folder-head{background:#f0fdf4}.activity-folder-toggle{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;min-width:0;border:0;background:transparent;padding:4px 6px;text-align:left;cursor:pointer}.folder-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#fff;border:1px solid #e2e8f0;font-size:20px}.folder-title{display:flex;flex-direction:column;gap:2px;min-width:0}.folder-title strong{color:#0f172a;font-size:12px}.folder-title small{color:#64748b;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.folder-chevron{color:#64748b;font-size:14px}.folder-print{height:32px;padding:0 11px;font-size:10px}.activity-folder-body{border-top:1px solid #e2e8f0}.activity-day-overview{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(230px,.65fr);gap:12px;padding:12px;background:#fff}.activity-map-card{position:relative;min-height:290px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#eef2f7}.activity-map-head{position:absolute;z-index:3;left:10px;top:10px;display:flex;align-items:flex-end;justify-content:space-between;gap:15px;max-width:calc(100% - 20px);padding:7px 9px;border-radius:10px;background:rgba(255,255,255,.94);box-shadow:0 7px 22px rgba(15,23,42,.12)}.activity-map-head>div{display:flex;flex-direction:column;gap:2px}.activity-map-head small{color:#059669;font-size:8px;font-weight:900;text-transform:uppercase}.activity-map-head strong{font-size:10px;color:#0f172a}.activity-map-head>span{font-size:9px;color:#64748b}.activity-day-map{position:absolute;inset:0}.activity-map-legend{position:absolute;z-index:3;left:10px;bottom:10px;display:flex;gap:10px;padding:6px 8px;border-radius:9px;background:rgba(255,255,255,.94);box-shadow:0 7px 22px rgba(15,23,42,.12);font-size:9px;color:#475569}.activity-map-legend span{display:flex;align-items:center;gap:5px}.activity-map-legend i{width:20px;height:4px;border-radius:999px}.activity-map-legend .assigned{background:#0f766e}.activity-map-legend .actual{background:#2563eb}.activity-day-summary{display:grid;grid-template-columns:1fr 1fr;align-content:start;gap:8px}.activity-day-summary>div{padding:11px;border-radius:12px;background:#f8fafc;border:1px solid #eef2f7}.activity-day-summary small,.activity-day-summary strong{display:block}.activity-day-summary small{color:#64748b;font-size:9px;text-transform:uppercase}.activity-day-summary strong{margin-top:4px;color:#0f172a;font-size:11px;overflow-wrap:anywhere}.activity-list{display:flex;flex-direction:column;border-top:1px solid #eef2f7}.activity-record{border-bottom:1px solid #eef2f7;background:#fff}.activity-record:last-child{border-bottom:0}.activity-record.selected{background:#f0fdf4;box-shadow:inset 3px 0 0 #10b981}.activity-open{width:100%;display:grid;grid-template-columns:auto minmax(0,1.45fr) minmax(150px,.65fr) auto;align-items:center;gap:12px;padding:12px 13px;border:0;background:transparent;text-align:left;cursor:pointer}.activity-record-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#f1f5f9;border:1px solid #e2e8f0}.activity-main,.activity-time,.activity-status-wrap{display:flex;flex-direction:column;gap:3px}.activity-main strong{color:#0f172a;font-size:12px}.activity-main small,.activity-time small,.activity-status-wrap small{color:#64748b;font-size:10px}.activity-brgy{width:max-content;max-width:100%;padding:4px 7px;border-radius:999px;background:#dcfce7;color:#166534;font-size:9px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.activity-time strong{color:#334155;font-size:11px}.activity-status-wrap{align-items:flex-end}.activity-extra{display:grid;grid-template-columns:1.05fr 1.25fr .62fr .62fr .55fr auto;align-items:center;gap:8px;padding:9px 13px 11px 59px;border-top:1px dashed #e2e8f0;color:#64748b;font-size:9px}.activity-extra b{color:#334155}.activity-extra button{height:29px;padding:0 9px;font-size:9px;background:#059669}@media(max-width:1000px){.activity-day-overview{grid-template-columns:1fr}.activity-day-summary{grid-template-columns:repeat(4,1fr)}.activity-extra{grid-template-columns:1fr 1fr 1fr;padding-left:13px}}@media(max-width:760px){.activity-open{grid-template-columns:auto 1fr}.activity-time,.activity-status-wrap{grid-column:2}.activity-status-wrap{align-items:flex-start}.activity-day-summary{grid-template-columns:1fr 1fr}.activity-extra{grid-template-columns:1fr 1fr}.activity-map-head{align-items:flex-start;flex-direction:column;gap:3px}}@media(max-width:620px){.activity-card-head{flex-direction:column}.activity-print-all{width:100%}.activity-folder-head{grid-template-columns:1fr}.folder-print{width:100%}.activity-open{grid-template-columns:1fr}.activity-record-icon{display:none}.activity-time,.activity-status-wrap{grid-column:auto}.activity-extra{grid-template-columns:1fr;padding-left:13px}.activity-day-summary{grid-template-columns:1fr}.activity-map-card{min-height:260px}}.live-driver-marker-wrap{display:flex;flex-direction:column;align-items:center;gap:6px;transform:translateY(-10px)}.live-driver-label{max-width:220px;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.92);color:#fff;font-size:11px;font-weight:800;line-height:1.15;box-shadow:0 8px 24px rgba(15,23,42,.22);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.live-driver-sub{display:block;margin-top:2px;font-size:9px;font-weight:600;color:#cbd5e1;text-align:center}.live-driver-marker{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#0f172a;color:#fff;border:4px solid #fff;box-shadow:0 5px 16px rgba(15,23,42,.38);font-size:18px}@keyframes monitor-spin{to{transform:rotate(360deg)}}@media(max-width:1050px){.monitor-filters{grid-template-columns:repeat(3,1fr)}.monitor-workspace{grid-template-columns:1fr}.driver-panel{border-left:0;border-top:1px solid #e2e8f0;min-height:auto}.monitor-driver-list{max-height:320px}.route-detail-grid{grid-template-columns:1fr}}@media(max-width:700px){.monitor-heading{align-items:flex-start;flex-direction:column}.monitor-sync{width:100%}.monitor-metrics{grid-template-columns:1fr 1fr}.monitor-filters{grid-template-columns:1fr 1fr}.monitor-search{grid-column:1/-1}.monitor-workspace,.monitor-map-panel{min-height:440px}.route-facts{grid-template-columns:1fr 1fr}.replay-heading{align-items:stretch;flex-direction:column}.replay-heading select{max-width:none}.replay-controls{grid-template-columns:1fr}.map-legend{right:14px}}@media(max-width:480px){.monitor-filters,.monitor-metrics,.route-facts{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={`monitor-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>; }
function Status({ status }: { status: RouteStatus }) { return <span className={`route-status ${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="route-fact"><small>{label}</small><strong>{value}</strong></div>; }

function RouteMap({ coordinates, actualPoints, checkpoints, passedSegments, selectedLocation, status, driverName, truck, focusKey }: { coordinates: LngLatTuple[]; actualPoints: Point[]; checkpoints: Array<{ lng: number; lat: number; purok: string }>; passedSegments: Set<number>; selectedLocation: Point | null; status: RouteStatus; driverName: string; truck: string; focusKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    import("maplibre-gl").then((maplibregl) => {
      if (disposed || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        center: DEFAULT_CENTER,
        zoom: 13,

        // Allow full world zoom-out and very close zoom-in.
        minZoom: 0,
        maxZoom: 24,

        // Use a vector basemap instead of requesting high-zoom
        // raster tiles directly from tile.openstreetmap.org.
        style: "https://tiles.openfreemap.org/styles/liberty",
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");

      // Explicitly keep all normal zoom/pan interactions enabled.
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.dragPan.enable();
      map.keyboard.enable();
      map.touchZoomRotate.enable();
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
        const wrapper = document.createElement("div");
        wrapper.className = "live-driver-marker-wrap";

        const label = document.createElement("div");
        label.className = "live-driver-label";
        label.textContent = driverName || "Assigned Driver";

        if (truck) {
          const sub = document.createElement("span");
          sub.className = "live-driver-sub";
          sub.textContent = truck;
          label.appendChild(sub);
        }

        const element = document.createElement("div");
        element.className = "live-driver-marker";
        element.textContent = "🚚";

        wrapper.appendChild(label);
        wrapper.appendChild(element);

        markerRef.current = new maplibregl.Marker({
          element: wrapper,
          anchor: "bottom",
        })
          .setLngLat([selectedLocation.lng, selectedLocation.lat])
          .addTo(map);

        const popup = new maplibregl.Popup({
          offset: 24,
          closeButton: false,
          closeOnClick: false,
        }).setHTML(
          `<div style="font-size:12px;line-height:1.4;">
            <strong>${escapeHtml(driverName || "Assigned Driver")}</strong><br/>
            ${truck ? `<span>${escapeHtml(truck)}</span><br/>` : ""}
            <span>${selectedLocation.lat.toFixed(5)}, ${selectedLocation.lng.toFixed(5)}</span>
          </div>`
        );

        markerRef.current.setPopup(popup);
      });
    }
    const all = [...coordinates, ...actualPoints.map((point): LngLatTuple => [point.lng, point.lat]), ...(selectedLocation ? [[selectedLocation.lng, selectedLocation.lat] as LngLatTuple] : [])];
    if (all.length === 1) map.flyTo({ center: all[0], zoom: 16 });
    else if (all.length > 1) {
      const minLng = Math.min(...all.map((point) => point[0])); const maxLng = Math.max(...all.map((point) => point[0])); const minLat = Math.min(...all.map((point) => point[1])); const maxLat = Math.max(...all.map((point) => point[1]));
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 17, duration: 700 });
    }
  }, [ready, coordinates, actualPoints, checkpoints, passedSegments, selectedLocation, status, driverName, truck, focusKey]);

  return <div ref={containerRef} className="route-live-map" />;
}


function ActivityDayMap({ activities, focusKey }: { activities: DriverActivity[]; focusKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  const assignedFeatures = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: activities.flatMap((activity) =>
      activity.assignedCoordinates.length >= 2
        ? [{
            type: "Feature" as const,
            properties: { routeName: activity.routeName },
            geometry: {
              type: "LineString" as const,
              coordinates: activity.assignedCoordinates,
            },
          }]
        : []
    ),
  }), [activities]);

  const actualFeatures = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: activities.flatMap((activity) => {
      const coordinates = activity.actualPoints.map(
        (point): LngLatTuple => [point.lng, point.lat]
      );

      return coordinates.length >= 2
        ? [{
            type: "Feature" as const,
            properties: {
              routeName: activity.routeName,
              sessionId: activity.sessionId,
            },
            geometry: {
              type: "LineString" as const,
              coordinates,
            },
          }]
        : [];
    }),
  }), [activities]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;

    import("maplibre-gl").then((maplibregl) => {
      if (disposed || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        center: DEFAULT_CENTER,
        zoom: 13,
        minZoom: 0,
        maxZoom: 24,
        style: "https://tiles.openfreemap.org/styles/liberty",
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right"
      );

      map.on("load", () => {
        map.addSource("day-assigned-routes", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        map.addSource("day-actual-routes", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        map.addLayer({
          id: "day-assigned-routes",
          type: "line",
          source: "day-assigned-routes",
          paint: {
            "line-color": "#0f766e",
            "line-width": 5,
            "line-opacity": 0.8,
            "line-dasharray": [2, 1.5],
          },
        });

        map.addLayer({
          id: "day-actual-routes",
          type: "line",
          source: "day-actual-routes",
          paint: {
            "line-color": "#2563eb",
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });

        setReady(true);
      });

      mapRef.current = map;
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    setSource(map, "day-assigned-routes", assignedFeatures);
    setSource(map, "day-actual-routes", actualFeatures);

    const allCoordinates: LngLatTuple[] = [
      ...activities.flatMap((activity) => activity.assignedCoordinates),
      ...activities.flatMap((activity) =>
        activity.actualPoints.map((point): LngLatTuple => [point.lng, point.lat])
      ),
    ];

    if (allCoordinates.length === 1) {
      map.flyTo({ center: allCoordinates[0], zoom: 16 });
    } else if (allCoordinates.length > 1) {
      const minLng = Math.min(...allCoordinates.map((point) => point[0]));
      const maxLng = Math.max(...allCoordinates.map((point) => point[0]));
      const minLat = Math.min(...allCoordinates.map((point) => point[1]));
      const maxLat = Math.max(...allCoordinates.map((point) => point[1]));

      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 45, maxZoom: 17, duration: 0 }
      );
    }
  }, [ready, assignedFeatures, actualFeatures, activities, focusKey]);

  return <div ref={containerRef} className="activity-day-map" />;
}

async function printDriverActivityReport(title: string, driver: Assignment, activities: DriverActivity[]) {
  // Open immediately so the browser does not block the print window after async map capture.
  const printWindow = window.open("", "_blank", "width=1200,height=850");

  if (!printWindow) {
    window.alert("The print window was blocked. Please allow pop-ups for this site and try again.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Preparing map…</title>
        <style>
          body{
            font-family:Arial,Helvetica,sans-serif;
            display:grid;
            place-items:center;
            min-height:90vh;
            color:#0f172a;
            background:#f8fafc
          }
          .loading{
            width:min(460px,90vw);
            padding:26px;
            border:1px solid #dbe3df;
            border-radius:16px;
            background:#fff;
            text-align:center;
            box-shadow:0 12px 36px rgba(15,23,42,.08)
          }
          .spinner{
            width:34px;
            height:34px;
            margin:0 auto 14px;
            border:4px solid #d1fae5;
            border-top-color:#059669;
            border-radius:50%;
            animation:spin .8s linear infinite
          }
          p{margin:6px 0 0;color:#64748b;font-size:12px}
          @keyframes spin{to{transform:rotate(360deg)}}
        </style>
      </head>
      <body>
        <div class="loading">
          <div class="spinner"></div>
          <strong>Preparing the actual street map…</strong>
          <p>Please wait while the map, assigned route, and GPS trail are rendered for printing.</p>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();

  const groups = new Map<string, DriverActivity[]>();

  activities
    .slice()
    .sort((left, right) => right.activityTime - left.activityTime)
    .forEach((activity) => {
      const key = dateKey(activity.activityTime) || "undated";
      const group = groups.get(key) || [];
      group.push(activity);
      groups.set(key, group);
    });

  const groupedActivities = Array.from(groups.values());

  // Capture a real MapLibre/OpenFreeMap street map for every printed date.
  // If a browser/GPU/network issue prevents capture, the existing SVG route
  // diagram is used only as a fallback so printing still works.
  const mapImages = await Promise.all(
    groupedActivities.map(async (groupActivities) => {
      try {
        return await captureActualActivityMap(groupActivities);
      } catch (error) {
        console.error("Unable to capture printable activity map.", error);
        return "";
      }
    })
  );

  const sections = groupedActivities.map((groupActivities, groupIndex) => {
    const date = groupActivities[0]?.activityTime || 0;
    const barangays = Array.from(
      new Set(groupActivities.map((activity) => activity.barangay).filter(Boolean))
    );

    const rows = groupActivities.map((activity) => `
      <tr>
        <td>${escapeHtml(activity.barangay)}</td>
        <td>${escapeHtml(activity.routeName)}</td>
        <td>${escapeHtml(activity.scheduleName)}</td>
        <td>${escapeHtml(activity.puroks.join(", ") || "No puroks listed")}</td>
        <td>${escapeHtml(formatTimeOnly(activity.startTime))}</td>
        <td>${escapeHtml(formatTimeOnly(activity.endTime))}</td>
        <td>${escapeHtml(activity.status)}</td>
        <td>${activity.progress}%</td>
        <td>${escapeHtml(formatDistance(activity.distanceMeters))}</td>
        <td>${escapeHtml(formatDuration(activity.durationSeconds))}</td>
        <td>${activity.actualPoints.length}</td>
      </tr>
    `).join("");

    const mapImage = mapImages[groupIndex];

    const printableMap = mapImage
      ? `
        <div class="map-frame">
          <img
            class="actual-map-image"
            src="${mapImage}"
            alt="Actual street map showing the assigned route and GPS activity"
          />
          <div class="map-overlay-legend">
            <span><i class="assigned-line"></i>Assigned route</span>
            <span><i class="actual-line"></i>Actual GPS trail</span>
            <span><i class="start-dot"></i>Start</span>
            <span><i class="end-dot"></i>End</span>
          </div>
        </div>
      `
      : `
        <div class="fallback-note">
          <strong>The actual basemap could not be captured.</strong>
          <span>The route-only fallback is shown below.</span>
        </div>
        ${buildPrintActivityMapSvg(groupActivities)}
      `;

    return `
      <section class="day-section">
        <div class="day-head">
          <div>
            <h2>${escapeHtml(formatActivityDay(date))}</h2>
            <p>
              ${escapeHtml(barangays.join(", ") || "No barangay recorded")}
              • ${groupActivities.length} recorded activit${groupActivities.length === 1 ? "y" : "ies"}
            </p>
          </div>

          <div class="day-stat">
            ${escapeHtml(formatDistance(groupActivities.reduce((sum, activity) => sum + activity.distanceMeters, 0)))}
            <small>total distance</small>
          </div>
        </div>

        <div class="map-title">
          <div>
            <strong>Actual GPS Activity Map</strong>
            <span>Street basemap with assigned route and recorded GPS trail</span>
          </div>
          <small>Map data © OpenStreetMap contributors • OpenFreeMap</small>
        </div>

        ${printableMap}

        <table>
          <thead>
            <tr>
              <th>Barangay</th>
              <th>Assigned Route</th>
              <th>Schedule</th>
              <th>Puroks</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Distance</th>
              <th>Duration</th>
              <th>GPS Points</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }).join("");

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          *{box-sizing:border-box}

          body{
            font-family:Arial,Helvetica,sans-serif;
            margin:24px;
            color:#0f172a;
            background:#fff
          }

          .report-head{
            display:flex;
            justify-content:space-between;
            gap:24px;
            align-items:flex-start;
            border-bottom:2px solid #0f766e;
            padding-bottom:14px;
            margin-bottom:18px
          }

          .report-head h1{
            font-size:22px;
            margin:0 0 6px
          }

          .report-head p{
            margin:2px 0;
            color:#475569;
            font-size:11px
          }

          .badge{
            padding:7px 11px;
            border-radius:999px;
            background:#ecfdf5;
            color:#047857;
            font-weight:700;
            font-size:11px
          }

          .day-section{
            break-inside:avoid-page;
            page-break-inside:avoid;
            margin:0 0 22px
          }

          .day-section + .day-section{
            break-before:page;
            page-break-before:always
          }

          .day-head{
            display:flex;
            justify-content:space-between;
            align-items:flex-end;
            gap:18px;
            margin-bottom:8px
          }

          .day-head h2{
            margin:0;
            font-size:17px
          }

          .day-head p{
            margin:3px 0 0;
            color:#64748b;
            font-size:10px
          }

          .day-stat{
            text-align:right;
            font-size:14px;
            font-weight:800;
            color:#0f766e
          }

          .day-stat small{
            display:block;
            margin-top:2px;
            color:#64748b;
            font-size:8px;
            font-weight:600;
            text-transform:uppercase
          }

          .map-title{
            display:flex;
            justify-content:space-between;
            gap:16px;
            align-items:flex-end;
            margin:8px 0 7px
          }

          .map-title>div{
            display:flex;
            flex-direction:column;
            gap:2px
          }

          .map-title strong{
            color:#0f172a;
            font-size:11px
          }

          .map-title span,
          .map-title>small{
            color:#64748b;
            font-size:8px
          }

          .map-frame{
            position:relative;
            width:100%;
            height:310px;
            border:1px solid #cbd5e1;
            border-radius:10px;
            overflow:hidden;
            background:#eef2f7;
            margin-bottom:10px
          }

          .actual-map-image{
            display:block;
            width:100%;
            height:100%;
            object-fit:cover
          }

          .map-overlay-legend{
            position:absolute;
            right:10px;
            top:10px;
            display:flex;
            flex-wrap:wrap;
            gap:8px 11px;
            max-width:350px;
            padding:7px 9px;
            border:1px solid #dbe3df;
            border-radius:9px;
            background:rgba(255,255,255,.94);
            color:#334155;
            font-size:8px
          }

          .map-overlay-legend span{
            display:flex;
            align-items:center;
            gap:5px
          }

          .map-overlay-legend i{
            display:inline-block;
            flex:0 0 auto
          }

          .assigned-line{
            width:24px;
            height:0;
            border-top:4px dashed #0f766e
          }

          .actual-line{
            width:24px;
            height:4px;
            border-radius:999px;
            background:#2563eb
          }

          .start-dot,
          .end-dot{
            width:9px;
            height:9px;
            border-radius:50%;
            border:2px solid #fff;
            box-shadow:0 0 0 1px #94a3b8
          }

          .start-dot{background:#22c55e}
          .end-dot{background:#ef4444}

          .fallback-note{
            display:flex;
            flex-direction:column;
            gap:2px;
            padding:8px 10px;
            border:1px solid #fde68a;
            border-radius:9px;
            background:#fffbeb;
            color:#92400e;
            font-size:9px;
            margin-bottom:7px
          }

          .fallback-note strong{color:#78350f}

          .print-map{
            display:block;
            width:100%;
            height:280px;
            border:1px solid #cbd5e1;
            border-radius:10px;
            background:#f8fafc;
            margin-bottom:10px
          }

          table{
            width:100%;
            border-collapse:collapse;
            font-size:8.5px
          }

          th,td{
            border:1px solid #dbe3df;
            padding:6px;
            text-align:left;
            vertical-align:top
          }

          th{
            background:#f1f5f9;
            font-size:7.5px;
            text-transform:uppercase;
            color:#475569
          }

          tbody tr:nth-child(even){background:#f8fafc}

          .footer{
            margin-top:14px;
            color:#64748b;
            font-size:8px
          }

          @page{
            size:landscape;
            margin:10mm
          }
        </style>
      </head>

      <body>
        <div class="report-head">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p><strong>Driver:</strong> ${escapeHtml(driver.driverName)}</p>
            <p><strong>Vehicle:</strong> ${escapeHtml(driver.truck)}</p>
            <p><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString("en-PH"))}</p>
          </div>

          <div class="badge">
            ${activities.length} recorded activit${activities.length === 1 ? "y" : "ies"}
          </div>
        </div>

        ${sections}

        <div class="footer">
          Waste Management Analytics — Driver Daily Activity Report.
          The printed map uses the same MapLibre/OpenFreeMap street basemap as Analytics,
          overlaid with the assigned route and GPS history recorded for the selected date.
        </div>

        <script>
          window.onload = () => {
            window.setTimeout(() => {
              window.focus();
              window.print();
            }, 350);
          };
        <\/script>
      </body>
    </html>
  `);

  printWindow.document.close();
}

async function captureActualActivityMap(activities: DriverActivity[]): Promise<string> {
  const maplibregl = await import("maplibre-gl");

  const assignedFeatures = activities.flatMap((activity) =>
    activity.assignedCoordinates.length >= 2
      ? [{
          type: "Feature" as const,
          properties: {
            routeName: activity.routeName,
            activityKey: activity.key,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: activity.assignedCoordinates,
          },
        }]
      : []
  );

  const actualFeatures = activities.flatMap((activity) => {
    const coordinates = activity.actualPoints.map(
      (point): LngLatTuple => [point.lng, point.lat]
    );

    return coordinates.length >= 2
      ? [{
          type: "Feature" as const,
          properties: {
            routeName: activity.routeName,
            sessionId: activity.sessionId,
          },
          geometry: {
            type: "LineString" as const,
            coordinates,
          },
        }]
      : [];
  });

  const pointFeatures = activities.flatMap((activity) => {
    const coordinates = activity.actualPoints.map(
      (point): LngLatTuple => [point.lng, point.lat]
    );

    if (coordinates.length === 0) return [];

    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];

    return [
      {
        type: "Feature" as const,
        properties: { kind: "start" },
        geometry: {
          type: "Point" as const,
          coordinates: start,
        },
      },
      {
        type: "Feature" as const,
        properties: { kind: "end" },
        geometry: {
          type: "Point" as const,
          coordinates: end,
        },
      },
    ];
  });

  const allCoordinates: LngLatTuple[] = [
    ...activities.flatMap((activity) => activity.assignedCoordinates),
    ...activities.flatMap((activity) =>
      activity.actualPoints.map((point): LngLatTuple => [point.lng, point.lat])
    ),
  ];

  if (allCoordinates.length === 0) {
    throw new Error("No route or GPS coordinates are available for this activity.");
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1200px",
    height: "500px",
    pointerEvents: "none",
    opacity: "0",
    zIndex: "-1",
  });

  document.body.appendChild(host);

  let map: InstanceType<typeof maplibregl.Map> | null = null;

  try {
    map = new maplibregl.Map({
      container: host,
      center: DEFAULT_CENTER,
      zoom: 13,
      minZoom: 0,
      maxZoom: 24,
      style: "https://tiles.openfreemap.org/styles/liberty",
      attributionControl: false,

      // MapLibre's drawing buffer is normally discarded after rendering.
      // Keeping it allows the fully rendered street map canvas to be exported.
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out while loading the printable basemap.")),
        15000
      );

      map!.once("load", () => {
        window.clearTimeout(timeout);
        resolve();
      });

      map!.once("error", (event) => {
        // A style can emit recoverable resource errors, so only reject before
        // the style has loaded. Once loaded, idle below decides when capture is ready.
        if (!map!.isStyleLoaded()) {
          window.clearTimeout(timeout);
          reject(
            event.error instanceof Error
              ? event.error
              : new Error("The printable basemap could not be loaded.")
          );
        }
      });
    });

    map.addSource("print-assigned-routes", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: assignedFeatures,
      },
    });

    map.addSource("print-actual-routes", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: actualFeatures,
      },
    });

    map.addSource("print-route-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: pointFeatures,
      },
    });

    map.addLayer({
      id: "print-assigned-routes",
      type: "line",
      source: "print-assigned-routes",
      paint: {
        "line-color": "#0f766e",
        "line-width": 5,
        "line-opacity": 0.9,
        "line-dasharray": [2, 1.4],
      },
    });

    map.addLayer({
      id: "print-actual-routes",
      type: "line",
      source: "print-actual-routes",
      paint: {
        "line-color": "#2563eb",
        "line-width": 6,
        "line-opacity": 0.96,
      },
    });

    map.addLayer({
      id: "print-route-points",
      type: "circle",
      source: "print-route-points",
      paint: {
        "circle-radius": 7,
        "circle-color": [
          "case",
          ["==", ["get", "kind"], "start"],
          "#22c55e",
          "#ef4444",
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });

    if (allCoordinates.length === 1) {
      map.jumpTo({
        center: allCoordinates[0],
        zoom: 17,
      });
    } else {
      const minLng = Math.min(...allCoordinates.map((point) => point[0]));
      const maxLng = Math.max(...allCoordinates.map((point) => point[0]));
      const minLat = Math.min(...allCoordinates.map((point) => point[1]));
      const maxLat = Math.max(...allCoordinates.map((point) => point[1]));

      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        {
          padding: {
            top: 70,
            right: 80,
            bottom: 70,
            left: 80,
          },
          maxZoom: 18,
          duration: 0,
        }
      );
    }

    map.resize();
    map.triggerRepaint();

    await waitForPrintableMapIdle(map, 15000);

    // Give labels/glyphs one final paint frame after the map becomes idle.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    return map.getCanvas().toDataURL("image/png");
  } finally {
    map?.remove();
    host.remove();
  }
}

function waitForPrintableMapIdle(map: MapLibreMap, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    let finished = false;

    const timeout = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("Timed out waiting for printable map tiles to finish loading."));
    }, timeoutMs);

    map.once("idle", () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

function buildPrintActivityMapSvg(activities: DriverActivity[]) {
  const width = 1100;
  const height = 280;
  const padding = 34;

  const assignedLines = activities
    .map((activity) => activity.assignedCoordinates)
    .filter((coordinates) => coordinates.length >= 2);

  const actualLines = activities
    .map((activity) =>
      activity.actualPoints.map((point): LngLatTuple => [point.lng, point.lat])
    )
    .filter((coordinates) => coordinates.length >= 2);

  const allCoordinates = [...assignedLines.flat(), ...actualLines.flat()];

  if (allCoordinates.length === 0) {
    return `
      <svg class="print-map" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No GPS route map available">
        <rect width="${width}" height="${height}" fill="#f8fafc"/>
        <path d="M0 70H${width}M0 140H${width}M0 210H${width}" stroke="#e2e8f0" stroke-width="1"/>
        <path d="M220 0V${height}M440 0V${height}M660 0V${height}M880 0V${height}" stroke="#e2e8f0" stroke-width="1"/>
        <text x="${width / 2}" y="${height / 2 - 5}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#334155">No GPS route geometry available for this date</text>
        <text x="${width / 2}" y="${height / 2 + 18}" text-anchor="middle" font-family="Arial" font-size="11" fill="#64748b">The activity details are still included below.</text>
      </svg>
    `;
  }

  let minLng = Math.min(...allCoordinates.map((point) => point[0]));
  let maxLng = Math.max(...allCoordinates.map((point) => point[0]));
  let minLat = Math.min(...allCoordinates.map((point) => point[1]));
  let maxLat = Math.max(...allCoordinates.map((point) => point[1]));

  if (minLng === maxLng) {
    minLng -= 0.0005;
    maxLng += 0.0005;
  }

  if (minLat === maxLat) {
    minLat -= 0.0005;
    maxLat += 0.0005;
  }

  const project = ([lng, lat]: LngLatTuple) => {
    const x = padding + ((lng - minLng) / (maxLng - minLng)) * (width - padding * 2);
    const y = height - padding - ((lat - minLat) / (maxLat - minLat)) * (height - padding * 2);
    return [x, y] as const;
  };

  const polyline = (coordinates: LngLatTuple[]) =>
    coordinates
      .map((coordinate) => {
        const [x, y] = project(coordinate);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const assignedSvg = assignedLines
    .map((coordinates) => `
      <polyline
        points="${polyline(coordinates)}"
        fill="none"
        stroke="#0f766e"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-dasharray="11 8"
        opacity="0.82"
      />
    `)
    .join("");

  const actualSvg = actualLines
    .map((coordinates) => `
      <polyline
        points="${polyline(coordinates)}"
        fill="none"
        stroke="#2563eb"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.96"
      />
    `)
    .join("");

  const actualStart = actualLines[0]?.[0] || assignedLines[0]?.[0];
  const actualEndLine = actualLines.at(-1) || assignedLines.at(-1);
  const actualEnd = actualEndLine?.at(-1);

  const startMarker = actualStart
    ? (() => {
        const [x, y] = project(actualStart);
        return `<circle cx="${x}" cy="${y}" r="7" fill="#22c55e" stroke="#ffffff" stroke-width="3"/><text x="${x + 11}" y="${y - 9}" font-family="Arial" font-size="9" font-weight="700" fill="#166534">START</text>`;
      })()
    : "";

  const endMarker = actualEnd
    ? (() => {
        const [x, y] = project(actualEnd);
        return `<circle cx="${x}" cy="${y}" r="7" fill="#ef4444" stroke="#ffffff" stroke-width="3"/><text x="${x + 11}" y="${y - 9}" font-family="Arial" font-size="9" font-weight="700" fill="#991b1b">END</text>`;
      })()
    : "";

  return `
    <svg class="print-map" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GPS activity route map">
      <defs>
        <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M44 0H0V44" fill="none" stroke="#e2e8f0" stroke-width="1"/>
        </pattern>
      </defs>

      <rect width="${width}" height="${height}" fill="#f8fafc"/>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>

      <path d="M${padding} ${height / 2}H${width - padding}" stroke="#cbd5e1" stroke-width="8" opacity=".4"/>
      <path d="M${width / 2} ${padding}V${height - padding}" stroke="#cbd5e1" stroke-width="8" opacity=".4"/>

      ${assignedSvg}
      ${actualSvg}
      ${startMarker}
      ${endMarker}

      <g transform="translate(${width - 260},18)">
        <rect width="242" height="58" rx="9" fill="#ffffff" stroke="#dbe3df"/>
        <line x1="13" y1="19" x2="58" y2="19" stroke="#0f766e" stroke-width="5" stroke-dasharray="10 7"/>
        <text x="67" y="23" font-family="Arial" font-size="10" fill="#334155">Assigned route</text>
        <line x1="13" y1="40" x2="58" y2="40" stroke="#2563eb" stroke-width="5"/>
        <text x="67" y="44" font-family="Arial" font-size="10" fill="#334155">Actual GPS trail</text>
      </g>
    </svg>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emptyLine() { return { type: "FeatureCollection" as const, features: [] }; }
function lineData(coordinates: LngLatTuple[]) { return coordinates.length >= 2 ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } } : emptyLine(); }
function setSource(map: MapLibreMap, id: string, data: Parameters<GeoJSONSource["setData"]>[0]) { (map.getSource(id) as GeoJSONSource | undefined)?.setData(data); }