"use client";

import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../lib/firebase";
import { getWasteTrackMapStyle } from "../../lib/mapStyle";

type RawRecord = Record<string, unknown>;
type Point = { lat: number; lng: number; timestamp: number; accuracy: number };

const MAX_REASONABLE_ACCURACY_METERS = 100;
const MIN_VISUAL_POINT_DISTANCE_METERS = 4;
const MAX_REASONABLE_SPEED_METERS_PER_SECOND = 45;

type FootprintRecord = {
  key: string;
  scheduleId: string;
  sessionId: string;
  driverId: string;
  driverName: string;
  truck: string;
  routeId: string;
  routeName: string;
  scheduleName: string;
  barangays: string[];
  puroks: string[];
  status: string;
  startTime: number;
  endTime: number;
  distanceMeters: number;
  durationSeconds: number;
  points: Point[];
};

const DEFAULT_CENTER: [number, number] = [124.886, 11.775];

function asRecords(value: unknown): Record<string, RawRecord> {
  return value && typeof value === "object" ? value as Record<string, RawRecord> : {};
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => item === true ? key : typeof item === "string" || typeof item === "number" ? String(item) : "")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return value ? [String(value).trim()].filter(Boolean) : [];
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
  return {
    lat,
    lng,
    timestamp: timestamp(raw.timestamp ?? raw.recordedAt ?? raw.lastUpdated),
    accuracy: Number(raw.accuracy || 0),
  };
}

function distanceMeters(a: Point, b: Point): number {
  const radius = 6_371_000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/**
 * Removes duplicate samples and obvious GPS jumps without changing valid travel.
 * This is display filtering only; the Firebase history remains untouched.
 */
function cleanGpsTrace(points: Point[]): Point[] {
  const ordered = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const accepted: Point[] = [];

  for (const point of ordered) {
    if (point.accuracy > MAX_REASONABLE_ACCURACY_METERS) continue;
    const previous = accepted.at(-1);
    if (!previous) {
      accepted.push(point);
      continue;
    }

    const distance = distanceMeters(previous, point);
    if (distance < MIN_VISUAL_POINT_DISTANCE_METERS) {
      // Keep the newest timestamp for a stationary truck, but do not draw another dot.
      accepted[accepted.length - 1] = point;
      continue;
    }

    const elapsedSeconds = Math.max(1, (point.timestamp - previous.timestamp) / 1000);
    const speed = distance / elapsedSeconds;
    if (point.timestamp && previous.timestamp && speed > MAX_REASONABLE_SPEED_METERS_PER_SECOND) continue;
    accepted.push(point);
  }

  // Never hide the whole trip when old devices did not record accuracy correctly.
  const reliable = accepted.length >= 2 ? accepted : ordered;
  if (reliable.length < 5) return reliable;

  const smoothed = reliable.map((point, index) => {
    if (index === 0 || index === reliable.length - 1) return point;
    const window = reliable.slice(Math.max(0, index - 2), Math.min(reliable.length, index + 3));
    const latitudes = window.map((item) => item.lat).sort((a, b) => a - b);
    const longitudes = window.map((item) => item.lng).sort((a, b) => a - b);
    const middle = Math.floor(window.length / 2);
    return { ...point, lat: latitudes[middle], lng: longitudes[middle] };
  });

  return smoothed.filter((point, index, values) =>
    index === 0 || index === values.length - 1 || distanceMeters(values[index - 1], point) >= 6
  );
}

function visibleMapPoints(points: Point[]): Point[] {
  if (points.length < 20) return points;
  const sortedLat = [...points].sort((a, b) => a.lat - b.lat);
  const sortedLng = [...points].sort((a, b) => a.lng - b.lng);
  const trim = Math.max(1, Math.floor(points.length * 0.05));
  const minLat = sortedLat[trim].lat;
  const maxLat = sortedLat[sortedLat.length - trim - 1].lat;
  const minLng = sortedLng[trim].lng;
  const maxLng = sortedLng[sortedLng.length - trim - 1].lng;
  const central = points.filter((point) => point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng);
  return central.length >= Math.ceil(points.length * 0.8) ? central : points;
}

function routeStatus(value: unknown): string {
  const text = String(value || "Ongoing").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (text.includes("partial")) return "Partially Completed";
  if (text.includes("complete") || text === "done" || text === "finished") return "Completed";
  if (text.includes("miss")) return "Missed Route";
  if (text.includes("deviat")) return "Deviated";
  if (text.includes("ongoing") || text.includes("progress") || text.includes("started")) return "Ongoing";
  return text ? text.replace(/\b\w/g, (c) => c.toUpperCase()) : "Ongoing";
}

function formatDateTime(value: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(value: number) {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString("en-PH", { month: "short", day: "2-digit", year: "numeric" });
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.max(0, Math.round(meters))} m`;
}

function formatDuration(seconds: number) {
  if (!seconds) return "0 min";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)} min`;
}

function setSource(map: MapLibreMap, id: string, data: any) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function emptyLine() {
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [] as number[][] } };
}

function lineData(points: Point[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: points.map((point) => [point.lng, point.lat]),
    },
  };
}

function historyPoints(historyData: Record<string, RawRecord>, scheduleId: string, sessionId: string): Point[] {
  const scheduleHistory = asRecords(historyData[scheduleId]);
  const sessionHistory = (scheduleHistory[sessionId] || {}) as RawRecord;
  const points = asRecords(sessionHistory.points || sessionHistory);
  return cleanGpsTrace(Object.values(points)
    .map(gpsPoint)
    .filter((point): point is Point => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp));
}

export function ActualRouteFootprintAnalytics() {
  const [sessions, setSessions] = useState<Record<string, RawRecord>>({});
  const [history, setHistory] = useState<Record<string, RawRecord>>({});
  const [schedules, setSchedules] = useState<Record<string, RawRecord>>({});
  const [routes, setRoutes] = useState<Record<string, RawRecord>>({});
  const [drivers, setDrivers] = useState<Record<string, RawRecord>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [driverFilter, setDriverFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const listen = (path: string, setter: (value: Record<string, RawRecord>) => void) =>
      onValue(ref(db, path), (snapshot) => setter(asRecords(snapshot.val())));
    const unsubscribers = [
      listen("route_sessions", setSessions),
      listen("gps_route_history", setHistory),
      listen("schedules", setSchedules),
      listen("routes", setRoutes),
      listen("drivers", setDrivers),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const footprints = useMemo<FootprintRecord[]>(() => {
    const records: FootprintRecord[] = [];
    Object.entries(sessions).forEach(([scheduleId, rawSessions]) => {
      Object.entries(asRecords(rawSessions)).forEach(([sessionId, data]) => {
        const points = historyPoints(history, scheduleId, sessionId);
        if (points.length < 2) return;
        const schedule = schedules[scheduleId] || {};
        const driverId = String(data.driverId || schedule.assignedDriverId || schedule.driverId || "");
        const driver = drivers[driverId] || {};
        const routeId = String(data.routeId || schedule.routeId || schedule.assignedRouteId || "");
        const route = routes[routeId] || {};
        const startTime = timestamp(data.startTime ?? data.createdAt ?? points[0]?.timestamp);
        const endTime = timestamp(data.completionTime ?? data.completedAt ?? data.endTime ?? points.at(-1)?.timestamp);
        const barangays = normalizeArray(data.barangays || route.barangays || schedule.barangays || schedule.barangay);
        const puroks = normalizeArray(data.assignedPuroks || data.puroks || route.puroks || schedule.assignedPuroks || schedule.puroks);
        records.push({
          key: `${scheduleId}:${sessionId}`,
          scheduleId,
          sessionId,
          driverId,
          driverName: String(data.driverName || schedule.driverName || driver.name || "Unnamed Driver"),
          truck: String(data.truckId || schedule.truckId || driver.truck || route.assignedVehicle || "No vehicle assigned"),
          routeId,
          routeName: String(data.routeName || schedule.routeName || route.routeName || "Collection route"),
          scheduleName: String(schedule.title || schedule.scheduleName || data.scheduleName || "Collection schedule"),
          barangays,
          puroks,
          status: routeStatus(data.status ?? data.routeStatus),
          startTime,
          endTime,
          distanceMeters: Number(data.distanceTravelledMeters || 0),
          durationSeconds: Number(data.durationSeconds || Math.max(0, Math.round((endTime - startTime) / 1000))),
          points,
        });
      });
    });
    return records.sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));
  }, [sessions, history, schedules, routes, drivers]);

  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    footprints.forEach((item) => item.driverId && map.set(item.driverId, item.driverName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [footprints]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return footprints.filter((item) => {
      if (driverFilter !== "all" && item.driverId !== driverFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return [
        item.driverName,
        item.truck,
        item.routeName,
        item.scheduleName,
        item.status,
        ...item.barangays,
        ...item.puroks,
      ].join(" ").toLowerCase().includes(keyword);
    });
  }, [footprints, driverFilter, statusFilter, search]);

  useEffect(() => {
    if (!selectedKey || !filtered.some((item) => item.key === selectedKey)) {
      setSelectedKey(filtered[0]?.key || "");
    }
  }, [filtered, selectedKey]);

  const selected = filtered.find((item) => item.key === selectedKey) || filtered[0] || null;

  const summary = useMemo(() => {
    const completed = footprints.filter((item) => item.status === "Completed").length;
    const totalDistance = footprints.reduce((sum, item) => sum + item.distanceMeters, 0);
    const gpsSamples = footprints.reduce((sum, item) => sum + item.points.length, 0);
    const uniqueDrivers = new Set(footprints.map((item) => item.driverId).filter(Boolean)).size;
    return { completed, totalDistance, gpsSamples, uniqueDrivers };
  }, [footprints]);

  return (
    <section className="footprint-analytics">
      <header className="footprint-heading">
        <div>
          <span>RECORDED GPS EVIDENCE</span>
          <h2>Driver travel footprints</h2>
          <p>
            This map uses the truck&apos;s stored GPS history only. The assigned route is intentionally hidden here so Analytics shows where the driver actually traveled.
          </p>
        </div>
        <div className="footprint-source-badge"><i /><div><strong>Actual GPS only</strong><small>gps_route_history</small></div></div>
      </header>

      <div className="footprint-metrics">
        <MiniMetric label="Recorded trips" value={footprints.length} />
        <MiniMetric label="Completed trips" value={summary.completed} tone="green" />
        <MiniMetric label="Drivers recorded" value={summary.uniqueDrivers} />
        <MiniMetric label="GPS samples stored" value={summary.gpsSamples} />
        <MiniMetric label="Actual distance" value={formatDistance(summary.totalDistance)} />
      </div>

      <div className="footprint-filters">
        <label><span>Driver</span><select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}><option value="all">All drivers</option>{driverOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option>Completed</option><option>Partially Completed</option><option>Missed Route</option><option>Ongoing</option><option>Deviated</option></select></label>
        <label className="footprint-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, route, barangay, purok..." /></label>
        <button type="button" onClick={() => { setDriverFilter("all"); setStatusFilter("all"); setSearch(""); }}>Reset</button>
      </div>

      <div className="footprint-workspace">
        <div className="footprint-map-card">
          {selected ? <ActualFootprintMap record={selected} /> : <div className="footprint-empty"><strong>No stored GPS footprint found</strong><span>Completed and active GPS sessions will appear here after at least two accepted location samples are stored.</span></div>}
          {selected && <div className="footprint-map-label"><span className="actual-line-swatch" /> <strong>Actual driver path</strong><small>No assigned-route line is displayed in Analytics.</small></div>}
        </div>

        <aside className="footprint-history-panel">
          <div className="footprint-panel-head"><div><h3>Stored trip history</h3><p>{filtered.length} trip{filtered.length === 1 ? "" : "s"} shown</p></div></div>
          <div className="footprint-list">
            {filtered.length === 0 ? <div className="footprint-list-empty">No trips match the current filters.</div> : filtered.map((item) => (
              <button key={item.key} type="button" className={selected?.key === item.key ? "selected" : ""} onClick={() => setSelectedKey(item.key)}>
                <div className="trip-row-top"><div><strong>{item.routeName}</strong><span>{item.driverName} • {item.truck}</span></div><StatusPill status={item.status} /></div>
                <div className="trip-row-meta"><span>{formatDate(item.endTime || item.startTime)}</span><span>{formatDistance(item.distanceMeters)}</span><span>{item.points.length} GPS pts</span></div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {selected && (
        <div className="footprint-selected-summary">
          <div className="selected-summary-title"><small>Selected footprint</small><h3>{selected.routeName}</h3><p>{selected.driverName} • {selected.scheduleName}</p></div>
          <Fact label="Started" value={formatDateTime(selected.startTime)} />
          <Fact label="Finished / latest" value={formatDateTime(selected.endTime)} />
          <Fact label="Actual distance" value={formatDistance(selected.distanceMeters)} />
          <Fact label="Duration" value={formatDuration(selected.durationSeconds)} />
          <Fact label="GPS samples" value={String(selected.points.length)} />
          <Fact label="Coverage" value={[...selected.barangays, ...selected.puroks].join(" • ") || "No coverage label"} />
        </div>
      )}

      <style jsx global>{`
        .footprint-analytics{width:100%;display:grid;gap:18px;padding:22px;border:1px solid #dbe6df;border-radius:22px;background:#fff;box-shadow:0 14px 36px rgba(16,35,27,.06);overflow:hidden}
        .footprint-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.footprint-heading>div:first-child{max-width:860px}.footprint-heading span{color:#148347;font-size:10px;font-weight:950;letter-spacing:.1em}.footprint-heading h2{margin:5px 0 0;color:#10231b;font-size:26px;letter-spacing:-.035em}.footprint-heading p{margin:7px 0 0;color:#62736a;font-size:13px;line-height:1.55}.footprint-source-badge{display:flex;align-items:center;gap:10px;min-width:185px;padding:11px 13px;border:1px solid #bfe2cc;border-radius:14px;background:#f0fbf4}.footprint-source-badge i{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.12)}.footprint-source-badge strong,.footprint-source-badge small{display:block}.footprint-source-badge strong{color:#176b3f;font-size:12px}.footprint-source-badge small{margin-top:2px;color:#6d7e75;font-size:10px}
        .footprint-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.footprint-mini-metric{display:grid;gap:5px;min-height:72px;padding:13px 14px;border:1px solid #e0e8e3;border-radius:15px;background:#f9fbfa}.footprint-mini-metric small{color:#6b7c72;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.footprint-mini-metric strong{color:#12271d;font-size:20px;letter-spacing:-.03em}.footprint-mini-metric.green{background:#f0fbf4;border-color:#c9e9d4}.footprint-mini-metric.green strong{color:#148347}
        .footprint-filters{display:grid;grid-template-columns:minmax(170px,.7fr) minmax(170px,.7fr) minmax(300px,1.6fr) 88px;gap:12px;align-items:end;padding:14px;border:1px solid #e0e9e3;border-radius:17px;background:#f7faf8}.footprint-filters label{display:grid;gap:6px;min-width:0}.footprint-filters label>span{color:#4e6257;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.footprint-filters select,.footprint-filters input{width:100%;height:43px;border:1px solid #cfdbd4;border-radius:11px;background:#fff;padding:0 12px;color:#173227;font-size:12px;outline:none}.footprint-filters select:focus,.footprint-filters input:focus{border-color:#35a861;box-shadow:0 0 0 4px rgba(22,138,74,.09)}.footprint-filters>button{height:43px;border:1px solid #d2ddd6;border-radius:11px;background:#fff;color:#40564a;font-weight:850;cursor:pointer}.footprint-filters>button:hover{border-color:#aed0ba;background:#eef7f1}
        .footprint-workspace{height:clamp(560px,68vh,700px);display:grid;grid-template-columns:minmax(0,1fr) minmax(380px,410px);border:1px solid #d8e3dc;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 10px 28px rgba(16,35,27,.055)}.footprint-map-card{position:relative;min-width:0;min-height:0;background:#e5ece8}.actual-footprint-map{position:absolute;inset:0}.footprint-map-label{position:absolute;z-index:5;left:16px;bottom:16px;display:grid;grid-template-columns:auto auto;column-gap:9px;row-gap:2px;align-items:center;padding:11px 13px;border:1px solid rgba(216,228,221,.96);border-radius:13px;background:rgba(255,255,255,.96);box-shadow:0 9px 24px rgba(16,35,27,.12);backdrop-filter:blur(8px)}.footprint-map-label strong{font-size:11px}.footprint-map-label small{grid-column:2;color:#6a7c72;font-size:9px}.actual-line-swatch{width:29px!important;height:4px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 2px #fff}.footprint-empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:24px}.footprint-empty strong{color:#173227}.footprint-empty span{max-width:430px;margin-top:6px;color:#6b7b72;font-size:12px;line-height:1.5}
        .footprint-history-panel{min-width:0;min-height:0;display:flex;flex-direction:column;border-left:1px solid #dfe8e2;background:#fbfdfc}.footprint-panel-head{position:relative;z-index:2;padding:18px 17px 15px;border-bottom:1px solid #e2eae5;background:#fff}.footprint-panel-head h3,.footprint-panel-head p{margin:0}.footprint-panel-head h3{font-size:18px;color:#10231b;letter-spacing:-.02em}.footprint-panel-head p{margin-top:4px;color:#718078;font-size:11px}.footprint-list{flex:1;display:flex;flex-direction:column;gap:9px;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px;scrollbar-width:thin;scrollbar-color:#b9c9bf transparent}.footprint-list>button{width:100%;display:grid;gap:10px;padding:13px;border:1px solid #dfe8e2;border-radius:14px;background:#fff;text-align:left;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}.footprint-list>button:hover{border-color:#9fcdb0;box-shadow:0 8px 20px rgba(16,35,27,.07);transform:translateY(-1px)}.footprint-list>button.selected{border-color:#25a959;background:#f0fbf4;box-shadow:inset 3px 0 0 #22a957,0 8px 20px rgba(22,138,74,.08)}.trip-row-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.trip-row-top>div{min-width:0}.trip-row-top strong,.trip-row-top span{display:block}.trip-row-top strong{overflow:hidden;color:#173227;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.trip-row-top span{margin-top:4px;overflow:hidden;color:#6c7d73;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.trip-row-meta{display:flex;flex-wrap:wrap;gap:6px}.trip-row-meta span{padding:5px 7px;border-radius:8px;background:#eef3f0;color:#53675c;font-size:9px;font-weight:800}.footprint-list-empty{padding:28px 16px;color:#718078;text-align:center;font-size:12px}
        .footprint-status{display:inline-flex;align-items:center;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900;white-space:nowrap;background:#edf1ef;color:#617168}.footprint-status.completed{background:#e4f7ea;color:#147844}.footprint-status.partially-completed{background:#fff4dc;color:#9b650c}.footprint-status.missed-route,.footprint-status.deviated{background:#fee8e8;color:#b42318}.footprint-status.ongoing{background:#e8f1ff;color:#245fbd}
        .footprint-selected-summary{display:grid;grid-template-columns:minmax(220px,1.35fr) repeat(5,minmax(125px,1fr));gap:10px;align-items:stretch}.selected-summary-title,.footprint-fact{padding:12px 13px;border:1px solid #e0e8e3;border-radius:14px;background:#f9fbfa;min-width:0}.selected-summary-title small,.footprint-fact small{display:block;color:#718078;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.selected-summary-title h3{margin:5px 0 0;color:#173227;font-size:15px}.selected-summary-title p{margin:4px 0 0;color:#65766c;font-size:10px}.footprint-fact strong{display:block;margin-top:5px;overflow-wrap:anywhere;color:#20362b;font-size:11px;line-height:1.35}
        .actual-start-marker,.actual-finish-marker{width:28px;height:28px;display:grid;place-items:center;border:3px solid #fff;border-radius:50%;color:#fff;font-size:12px;font-weight:950;box-shadow:0 4px 12px rgba(15,23,42,.25)}.actual-start-marker{background:#2563eb}.actual-finish-marker{background:#16a34a}
        @media(min-width:1500px){.footprint-workspace{grid-template-columns:minmax(0,1fr) 430px}}@media(max-width:1200px){.footprint-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.footprint-selected-summary{grid-template-columns:repeat(3,minmax(0,1fr))}.selected-summary-title{grid-column:1/-1}}@media(max-width:1050px){.footprint-workspace{height:auto;grid-template-columns:1fr}.footprint-map-card{min-height:520px}.footprint-history-panel{height:390px;border-left:0;border-top:1px solid #e1e8e4}.footprint-filters{grid-template-columns:1fr 1fr}.footprint-search{grid-column:1/-1}.footprint-filters>button{grid-column:1/-1}.footprint-heading{flex-direction:column}.footprint-source-badge{width:100%}}@media(max-width:650px){.footprint-analytics{padding:15px;border-radius:18px}.footprint-metrics,.footprint-selected-summary,.footprint-filters{grid-template-columns:1fr}.footprint-search,.footprint-filters>button{grid-column:auto}.footprint-map-card{min-height:430px}.footprint-history-panel{height:360px}}
      `}</style>
    </section>
  );
}

function MiniMetric({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return <div className={`footprint-mini-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="footprint-fact"><small>{label}</small><strong>{value}</strong></div>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`footprint-status ${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>;
}

function ActualFootprintMap({ record }: { record: FootprintRecord }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerRequestRef = useRef(0);
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
        minZoom: 0,
        maxZoom: 24,
        style: getWasteTrackMapStyle(),
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("load", () => {
        map.addSource("actual-footprint", { type: "geojson", data: emptyLine() });
        map.addSource("actual-samples", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "actual-footprint-shadow", type: "line", source: "actual-footprint", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": .92, "line-blur": .35 } });
        map.addLayer({ id: "actual-footprint", type: "line", source: "actual-footprint", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 3.25, "line-opacity": .92 } });
        map.addLayer({ id: "actual-samples", type: "circle", source: "actual-samples", paint: { "circle-radius": 1.65, "circle-color": "#1d4ed8", "circle-stroke-color": "#ffffff", "circle-stroke-width": .8, "circle-opacity": .42 } });
        setReady(true);
      });
      mapRef.current = map;
    });
    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSource(map, "actual-footprint", lineData(record.points));
    const sampleStep = Math.max(1, Math.ceil(record.points.length / 48));
    const samples = record.points.filter((_, index) => index % sampleStep === 0);
    setSource(map, "actual-samples", {
      type: "FeatureCollection",
      features: samples.map((point) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [point.lng, point.lat] } })),
    });
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const markerRequest = ++markerRequestRef.current;
    import("maplibre-gl").then((maplibregl) => {
      if (markerRequest !== markerRequestRef.current || mapRef.current !== map) return;
      const addMarker = (point: Point, cls: string, label: string) => {
        const element = document.createElement("div");
        element.className = cls;
        element.textContent = label;
        const marker = new maplibregl.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map);
        markersRef.current.push(marker);
      };
      if (record.points[0]) addMarker(record.points[0], "actual-start-marker", "S");
      if (record.points.at(-1)) addMarker(record.points.at(-1)!, "actual-finish-marker", "F");
    });

    const all = visibleMapPoints(record.points).map((point): [number, number] => [point.lng, point.lat]);
    if (all.length === 1) map.flyTo({ center: all[0], zoom: 16 });
    if (all.length > 1) {
      const minLng = Math.min(...all.map((p) => p[0]));
      const maxLng = Math.max(...all.map((p) => p[0]));
      const minLat = Math.min(...all.map((p) => p[1]));
      const maxLat = Math.max(...all.map((p) => p[1]));
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 55, maxZoom: 17, duration: 650 });
    }
  }, [ready, record]);

  return <div ref={containerRef} className="actual-footprint-map" />;
}
