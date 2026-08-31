"use client";

import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../lib/firebase";
import { getWasteTrackMapStyle } from "../../lib/mapStyle";

type RawRecord = Record<string, unknown>;
type Point = { lat: number; lng: number; timestamp: number; accuracy: number };

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
  rawPointCount: number;
};

const DEFAULT_CENTER: [number, number] = [124.886, 11.775];
const MAX_REASONABLE_ACCURACY_METERS = 100;
const ISOLATED_SPIKE_METERS = 250;
const RETURN_TO_ROUTE_METERS = 120;
const MAX_REASONABLE_SPEED_MPS = 27.8; // 100 km/h - generous for noisy GPS timestamps.

function asRecords(value: unknown): Record<string, RawRecord> {
  return value && typeof value === "object" ? (value as Record<string, RawRecord>) : {};
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((v) => v.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) =>
        item === true
          ? key
          : typeof item === "string" || typeof item === "number"
            ? String(item)
            : "",
      )
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return value ? [String(value).trim()].filter(Boolean) : [];
}

function timestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function gpsPoint(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as RawRecord;
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    lat,
    lng,
    timestamp: timestamp(raw.timestamp ?? raw.recordedAt ?? raw.lastUpdated),
    accuracy: Number(raw.accuracy || 0),
  };
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
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
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

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: Point, b: Point) {
  const earthRadius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function calculateTrackDistance(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function removeDuplicatePoints(points: Point[]) {
  if (points.length < 2) return points;

  const output: Point[] = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const previous = output[output.length - 1];
    const moved = distanceMeters(previous, current);
    const elapsed = Math.abs(current.timestamp - previous.timestamp);

    if (moved < 2 && elapsed < 15_000) continue;
    output.push(current);
  }

  return output;
}

function removeIsolatedSpikes(points: Point[]) {
  if (points.length < 3) return points;

  let working = [...points];

  // Two passes are enough to remove consecutive isolated GPS spikes without
  // over-smoothing the true traveled route.
  for (let pass = 0; pass < 2; pass += 1) {
    if (working.length < 3) break;

    const next: Point[] = [working[0]];

    for (let i = 1; i < working.length - 1; i += 1) {
      const before = next[next.length - 1];
      const current = working[i];
      const after = working[i + 1];

      const beforeToCurrent = distanceMeters(before, current);
      const currentToAfter = distanceMeters(current, after);
      const beforeToAfter = distanceMeters(before, after);

      const currentAccuracyBad =
        current.accuracy > 0 && current.accuracy > MAX_REASONABLE_ACCURACY_METERS;

      const looksLikeSpike =
        beforeToCurrent > ISOLATED_SPIKE_METERS &&
        currentToAfter > ISOLATED_SPIKE_METERS &&
        beforeToAfter < RETURN_TO_ROUTE_METERS;

      const detourRatio =
        beforeToAfter > 0
          ? (beforeToCurrent + currentToAfter) / beforeToAfter
          : Number.POSITIVE_INFINITY;

      const extremeDetour =
        beforeToCurrent > 180 &&
        currentToAfter > 180 &&
        beforeToAfter < 160 &&
        detourRatio > 5;

      if (looksLikeSpike || (currentAccuracyBad && extremeDetour)) continue;
      next.push(current);
    }

    next.push(working[working.length - 1]);
    working = next;
  }

  return working;
}

function removeImpossibleJumps(points: Point[]) {
  if (points.length < 2) return points;

  const accepted: Point[] = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const previous = accepted[accepted.length - 1];
    const meters = distanceMeters(previous, current);
    const elapsedSeconds = Math.max(1, Math.abs(current.timestamp - previous.timestamp) / 1000);
    const speed = meters / elapsedSeconds;
    const poorAccuracy =
      current.accuracy > 0 && current.accuracy > MAX_REASONABLE_ACCURACY_METERS;

    // Reject a point only when it is clearly a GPS teleport. Long gaps are
    // allowed because the phone can legitimately miss updates for a while.
    const shortGapTeleport =
      elapsedSeconds <= 120 &&
      meters > ISOLATED_SPIKE_METERS &&
      speed > MAX_REASONABLE_SPEED_MPS;

    const inaccurateJump = poorAccuracy && meters > 120 && elapsedSeconds <= 180;

    if (shortGapTeleport || inaccurateJump) continue;
    accepted.push(current);
  }

  return accepted;
}

function trimBadEdgePoint(points: Point[]) {
  if (points.length < 3) return points;
  let working = [...points];

  const firstGap = distanceMeters(working[0], working[1]);
  const nextGap = distanceMeters(working[1], working[2]);
  if (firstGap > 500 && nextGap < 140) working = working.slice(1);

  if (working.length >= 3) {
    const last = working.length - 1;
    const lastGap = distanceMeters(working[last - 1], working[last]);
    const priorGap = distanceMeters(working[last - 2], working[last - 1]);
    if (lastGap > 500 && priorGap < 140) working = working.slice(0, -1);
  }

  return working;
}

function cleanGpsTrack(rawPoints: Point[]) {
  const sorted = [...rawPoints].sort((a, b) => a.timestamp - b.timestamp);
  const deduped = removeDuplicatePoints(sorted);
  const noSpikes = removeIsolatedSpikes(deduped);
  const noTeleports = removeImpossibleJumps(noSpikes);
  const trimmed = trimBadEdgePoint(noTeleports);

  return trimmed.length >= 2 ? trimmed : rawPoints;
}

function setSource(map: MapLibreMap, id: string, data: any) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function emptyLine() {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: [] as number[][] },
  };
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

function pointCollection(points: Point[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point) => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Point" as const,
        coordinates: [point.lng, point.lat],
      },
    })),
  };
}

function historyPoints(
  historyData: Record<string, RawRecord>,
  scheduleId: string,
  sessionId: string,
): Point[] {
  const scheduleHistory = asRecords(historyData[scheduleId]);
  const sessionHistory = (scheduleHistory[sessionId] || {}) as RawRecord;
  const points = asRecords(sessionHistory.points || sessionHistory);

  return Object.values(points)
    .map(gpsPoint)
    .filter((point): point is Point => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function getCoverageText(record: FootprintRecord) {
  const barangays = record.barangays.join(", ");
  const puroks = record.puroks.join(", ");

  if (barangays && puroks) return `${barangays} • ${puroks}`;
  return barangays || puroks || "No coverage label";
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
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const listen = (
      path: string,
      setter: (value: Record<string, RawRecord>) => void,
    ) => onValue(ref(db, path), (snapshot) => setter(asRecords(snapshot.val())));

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
        const rawPoints = historyPoints(history, scheduleId, sessionId);
        if (rawPoints.length < 2) return;

        const points = cleanGpsTrack(rawPoints);
        if (points.length < 2) return;

        const schedule = schedules[scheduleId] || {};
        const driverId = String(
          data.driverId || schedule.assignedDriverId || schedule.driverId || "",
        );
        const driver = drivers[driverId] || {};
        const routeId = String(
          data.routeId || schedule.routeId || schedule.assignedRouteId || "",
        );
        const route = routes[routeId] || {};
        const lastPoint = points[points.length - 1];
        const startTime = timestamp(data.startTime ?? data.createdAt ?? points[0]?.timestamp);
        const endTime = timestamp(
          data.completionTime ??
            data.completedAt ??
            data.endTime ??
            lastPoint?.timestamp,
        );
        const barangays = normalizeArray(
          data.barangays || route.barangays || schedule.barangays || schedule.barangay,
        );
        const puroks = normalizeArray(
          data.assignedPuroks ||
            data.puroks ||
            route.puroks ||
            schedule.assignedPuroks ||
            schedule.puroks,
        );

        records.push({
          key: `${scheduleId}:${sessionId}`,
          scheduleId,
          sessionId,
          driverId,
          driverName: String(
            data.driverName ||
              schedule.driverName ||
              driver.name ||
              "Unnamed Driver",
          ),
          truck: String(
            data.truckId ||
              schedule.truckId ||
              driver.truck ||
              route.assignedVehicle ||
              "No vehicle assigned",
          ),
          routeId,
          routeName: String(
            data.routeName ||
              schedule.routeName ||
              route.routeName ||
              "Collection route",
          ),
          scheduleName: String(
            schedule.title ||
              schedule.scheduleName ||
              data.scheduleName ||
              "Collection schedule",
          ),
          barangays,
          puroks,
          status: routeStatus(data.status ?? data.routeStatus),
          startTime,
          endTime,
          distanceMeters: calculateTrackDistance(points),
          durationSeconds: Number(
            data.durationSeconds ||
              Math.max(0, Math.round((endTime - startTime) / 1000)),
          ),
          points,
          rawPointCount: rawPoints.length,
        });
      });
    });

    return records.sort(
      (a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime),
    );
  }, [sessions, history, schedules, routes, drivers]);

  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    footprints.forEach((item) => {
      if (item.driverId) map.set(item.driverId, item.driverName);
    });
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
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [footprints, driverFilter, statusFilter, search]);

  useEffect(() => {
    if (!selectedKey || !filtered.some((item) => item.key === selectedKey)) {
      setSelectedKey(filtered[0]?.key || "");
    }
  }, [filtered, selectedKey]);

  const selected =
    filtered.find((item) => item.key === selectedKey) || filtered[0] || null;

  const summary = useMemo(() => {
    const completed = footprints.filter((item) => item.status === "Completed").length;
    const totalDistance = footprints.reduce(
      (sum, item) => sum + item.distanceMeters,
      0,
    );
    const gpsSamples = footprints.reduce(
      (sum, item) => sum + item.points.length,
      0,
    );
    const uniqueDrivers = new Set(
      footprints.map((item) => item.driverId).filter(Boolean),
    ).size;

    return { completed, totalDistance, gpsSamples, uniqueDrivers };
  }, [footprints]);

  return (
    <section className="footprint-analytics">
      <header className="footprint-heading">
        <div>
          <span>RECORDED GPS EVIDENCE</span>
          <h2>Driver travel footprints</h2>
          <p>
            Review the truck&apos;s actual stored GPS footprint. Obvious GPS jump
            errors are removed from the display so the map stays focused on the
            route the driver really traveled.
          </p>
        </div>

        <div className="footprint-source-badge">
          <i />
          <div>
            <strong>Actual GPS only</strong>
            <small>gps_route_history</small>
          </div>
        </div>
      </header>

      <div className="footprint-metrics">
        <MiniMetric label="Recorded trips" value={footprints.length} />
        <MiniMetric label="Completed trips" value={summary.completed} tone="green" />
        <MiniMetric label="Drivers recorded" value={summary.uniqueDrivers} />
        <MiniMetric label="GPS samples stored" value={summary.gpsSamples} />
        <MiniMetric label="Actual distance" value={formatDistance(summary.totalDistance)} />
      </div>

      <div className="footprint-filters">
        <label>
          <span>Driver</span>
          <select
            value={driverFilter}
            onChange={(event) => setDriverFilter(event.target.value)}
          >
            <option value="all">All drivers</option>
            {driverOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option>Completed</option>
            <option>Partially Completed</option>
            <option>Missed Route</option>
            <option>Ongoing</option>
            <option>Deviated</option>
          </select>
        </label>

        <label className="footprint-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Driver, route, barangay, purok..."
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setDriverFilter("all");
            setStatusFilter("all");
            setSearch("");
          }}
        >
          Reset
        </button>
      </div>

      <div className="footprint-workspace">
        <div className="footprint-map-card">
          {selected ? (
            <>
              <ActualFootprintMap record={selected} />

              <div className="map-trip-summary">
                <div className="map-trip-copy">
                  <small>Selected footprint</small>
                  <strong>{selected.routeName}</strong>
                  <span>{selected.driverName} • {selected.truck}</span>
                </div>

                <div className="map-trip-facts">
                  <StatusPill status={selected.status} />
                  <div>
                    <b>{formatDistance(selected.distanceMeters)}</b>
                    <span>Actual distance</span>
                  </div>
                  <div>
                    <b>{selected.points.length}</b>
                    <span>Clean GPS pts</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`history-toggle ${historyOpen ? "active" : ""}`}
                onClick={() => setHistoryOpen((value) => !value)}
              >
                <span>
                  <b>Trip history</b>
                  <small>{filtered.length} stored trips</small>
                </span>
                <em>{historyOpen ? "×" : "⌄"}</em>
              </button>

              {historyOpen && (
                <aside className="footprint-history-drawer">
                  <div className="history-drawer-head">
                    <div>
                      <h3>Stored trip history</h3>
                      <p>{filtered.length} trip{filtered.length === 1 ? "" : "s"} shown</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(false)}
                      aria-label="Close trip history"
                    >
                      ×
                    </button>
                  </div>

                  <div className="footprint-list">
                    {filtered.length === 0 ? (
                      <div className="footprint-list-empty">
                        No trips match the current filters.
                      </div>
                    ) : (
                      filtered.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={selected?.key === item.key ? "selected" : ""}
                          onClick={() => {
                            setSelectedKey(item.key);
                            if (window.innerWidth < 760) setHistoryOpen(false);
                          }}
                        >
                          <div className="trip-row-top">
                            <div>
                              <strong>{item.routeName}</strong>
                              <span>{item.driverName} • {item.truck}</span>
                            </div>
                            <StatusPill status={item.status} />
                          </div>
                          <div className="trip-row-meta">
                            <span>{formatDate(item.endTime || item.startTime)}</span>
                            <span>{formatDistance(item.distanceMeters)}</span>
                            <span>{item.points.length} GPS pts</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </aside>
              )}

              <div className="footprint-map-label">
                <span className="actual-line-swatch" />
                <strong>Actual driver path</strong>
                <small>GPS spikes removed • start and finish preserved</small>
              </div>
            </>
          ) : (
            <div className="footprint-empty">
              <strong>No stored GPS footprint found</strong>
              <span>
                Completed and active GPS sessions will appear here after at
                least two accepted location samples are stored.
              </span>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="footprint-selected-summary">
          <div className="selected-summary-title">
            <small>Selected footprint</small>
            <h3>{selected.routeName}</h3>
            <p>{selected.driverName} • {selected.scheduleName}</p>
          </div>
          <Fact label="Started" value={formatDateTime(selected.startTime)} />
          <Fact label="Finished / latest" value={formatDateTime(selected.endTime)} />
          <Fact label="Actual distance" value={formatDistance(selected.distanceMeters)} />
          <Fact label="Duration" value={formatDuration(selected.durationSeconds)} />
          <Fact
            label="GPS quality"
            value={
              selected.rawPointCount === selected.points.length
                ? `${selected.points.length} accepted`
                : `${selected.points.length}/${selected.rawPointCount} accepted`
            }
          />
          <Fact label="Coverage" value={getCoverageText(selected)} />
        </div>
      )}

      <style jsx global>{`
        .footprint-analytics {
          display: grid;
          gap: 16px;
          padding: 22px;
          border: 1px solid #dbe6df;
          border-radius: 26px;
          background: #ffffff;
          box-shadow: 0 14px 34px rgba(16, 35, 27, 0.055);
        }

        .footprint-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
        }

        .footprint-heading > div:first-child {
          max-width: 900px;
        }

        .footprint-heading > div:first-child > span {
          color: #148347;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.11em;
        }

        .footprint-heading h2 {
          margin: 6px 0 0;
          color: #10231b;
          font-size: 28px;
          letter-spacing: -0.04em;
        }

        .footprint-heading p {
          margin: 8px 0 0;
          color: #62736a;
          font-size: 13px;
          line-height: 1.6;
        }

        .footprint-source-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 190px;
          padding: 12px 14px;
          border: 1px solid #c5e6d0;
          border-radius: 16px;
          background: #f0fbf4;
        }

        .footprint-source-badge i {
          width: 10px;
          height: 10px;
          flex: 0 0 10px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.12);
        }

        .footprint-source-badge strong,
        .footprint-source-badge small {
          display: block;
        }

        .footprint-source-badge strong {
          color: #176b3f;
          font-size: 12px;
        }

        .footprint-source-badge small {
          margin-top: 2px;
          color: #6d7e75;
          font-size: 10px;
        }

        .footprint-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
        }

        .footprint-mini-metric {
          display: grid;
          gap: 5px;
          min-height: 76px;
          padding: 14px;
          border: 1px solid #e0e8e3;
          border-radius: 16px;
          background: #f9fbfa;
        }

        .footprint-mini-metric small {
          color: #6b7c72;
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .footprint-mini-metric strong {
          color: #12271d;
          font-size: 20px;
          letter-spacing: -0.03em;
        }

        .footprint-mini-metric.green {
          background: #f0fbf4;
          border-color: #c9e9d4;
        }

        .footprint-mini-metric.green strong {
          color: #148347;
        }

        .footprint-filters {
          display: grid;
          grid-template-columns: 180px 180px minmax(240px, 1fr) auto;
          gap: 10px;
          align-items: end;
          padding: 12px;
          border: 1px solid #e3ebe6;
          border-radius: 16px;
          background: #f8faf9;
        }

        .footprint-filters label {
          display: grid;
          gap: 5px;
        }

        .footprint-filters label > span {
          color: #56695e;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .footprint-filters select,
        .footprint-filters input {
          height: 42px;
          border: 1px solid #d4dfd8;
          border-radius: 12px;
          background: #ffffff;
          padding: 0 12px;
          color: #173227;
          outline: none;
          font-size: 13px;
        }

        .footprint-filters select:focus,
        .footprint-filters input:focus {
          border-color: #48ad6b;
          box-shadow: 0 0 0 3px rgba(22, 138, 74, 0.08);
        }

        .footprint-filters > button {
          height: 42px;
          padding: 0 16px;
          border: 1px solid #d5dfd9;
          border-radius: 12px;
          background: #ffffff;
          color: #4e6257;
          font-weight: 850;
          cursor: pointer;
        }

        .footprint-filters > button:hover {
          background: #eef6f1;
        }

        .footprint-workspace {
          min-height: 640px;
          border: 1px solid #dce6e0;
          border-radius: 22px;
          overflow: hidden;
          background: #e8efeb;
        }

        .footprint-map-card {
          position: relative;
          min-height: 640px;
          background: #e5ece8;
        }

        .actual-footprint-map {
          position: absolute;
          inset: 0;
        }

        .map-trip-summary {
          position: absolute;
          z-index: 8;
          top: 16px;
          left: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          max-width: calc(100% - 240px);
          padding: 12px 14px;
          border: 1px solid rgba(215, 226, 219, 0.96);
          border-radius: 17px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 10px 26px rgba(16, 35, 27, 0.12);
          backdrop-filter: blur(10px);
        }

        .map-trip-copy {
          min-width: 0;
          padding-right: 14px;
          border-right: 1px solid #e6ece8;
        }

        .map-trip-copy small,
        .map-trip-copy strong,
        .map-trip-copy span {
          display: block;
        }

        .map-trip-copy small {
          color: #75867c;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .map-trip-copy strong {
          margin-top: 3px;
          overflow: hidden;
          color: #173227;
          font-size: 15px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .map-trip-copy span {
          margin-top: 3px;
          overflow: hidden;
          color: #65766c;
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .map-trip-facts {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .map-trip-facts > div {
          min-width: 86px;
        }

        .map-trip-facts b,
        .map-trip-facts span {
          display: block;
        }

        .map-trip-facts b {
          color: #173227;
          font-size: 13px;
        }

        .map-trip-facts span {
          margin-top: 2px;
          color: #76877d;
          font-size: 9px;
          font-weight: 800;
        }

        .history-toggle {
          position: absolute;
          z-index: 10;
          top: 16px;
          right: 16px;
          min-width: 185px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 10px 12px 10px 14px;
          border: 1px solid rgba(215, 226, 219, 0.97);
          border-radius: 15px;
          background: rgba(255, 255, 255, 0.96);
          color: #173227;
          box-shadow: 0 10px 26px rgba(16, 35, 27, 0.12);
          cursor: pointer;
          backdrop-filter: blur(10px);
        }

        .history-toggle.active {
          border-color: #8dc8a2;
          background: #f4fbf6;
        }

        .history-toggle span,
        .history-toggle b,
        .history-toggle small {
          display: block;
          text-align: left;
        }

        .history-toggle b {
          font-size: 12px;
        }

        .history-toggle small {
          margin-top: 2px;
          color: #718078;
          font-size: 9px;
        }

        .history-toggle em {
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          border-radius: 9px;
          background: #eff5f1;
          color: #52675b;
          font-size: 17px;
          font-style: normal;
          font-weight: 900;
        }

        .footprint-history-drawer {
          position: absolute;
          z-index: 12;
          top: 72px;
          right: 16px;
          bottom: 16px;
          width: min(390px, calc(100% - 32px));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(215, 226, 219, 0.98);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 20px 55px rgba(16, 35, 27, 0.19);
          backdrop-filter: blur(12px);
          animation: historyDrawerIn 0.18s ease both;
        }

        @keyframes historyDrawerIn {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .history-drawer-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 15px 15px 13px;
          border-bottom: 1px solid #e7ede9;
        }

        .history-drawer-head h3,
        .history-drawer-head p {
          margin: 0;
        }

        .history-drawer-head h3 {
          color: #10231b;
          font-size: 17px;
        }

        .history-drawer-head p {
          margin-top: 3px;
          color: #718078;
          font-size: 10px;
        }

        .history-drawer-head > button {
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 10px;
          background: #f0f4f2;
          color: #5d7065;
          font-size: 20px;
          cursor: pointer;
        }

        .history-drawer-head > button:hover {
          background: #e6eee9;
        }

        .footprint-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
          min-height: 0;
          overflow: auto;
          padding: 11px;
          scrollbar-width: thin;
          scrollbar-color: #b5c7bc transparent;
        }

        .footprint-list > button {
          width: 100%;
          display: grid;
          gap: 9px;
          padding: 12px;
          border: 1px solid #e1e8e4;
          border-radius: 14px;
          background: #ffffff;
          text-align: left;
          cursor: pointer;
          transition: 0.15s ease;
        }

        .footprint-list > button:hover {
          transform: translateY(-1px);
          border-color: #afd4bc;
          box-shadow: 0 7px 18px rgba(16, 35, 27, 0.06);
        }

        .footprint-list > button.selected {
          border-color: #38ad64;
          background: #f2fbf5;
          box-shadow: 0 8px 20px rgba(22, 138, 74, 0.08);
        }

        .trip-row-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }

        .trip-row-top > div {
          min-width: 0;
        }

        .trip-row-top strong,
        .trip-row-top span {
          display: block;
        }

        .trip-row-top strong {
          overflow: hidden;
          color: #173227;
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .trip-row-top span {
          margin-top: 3px;
          overflow: hidden;
          color: #6c7d73;
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .trip-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .trip-row-meta span {
          padding: 4px 7px;
          border-radius: 7px;
          background: #f0f4f2;
          color: #5b6e63;
          font-size: 9px;
          font-weight: 800;
        }

        .footprint-list-empty {
          padding: 24px 14px;
          color: #718078;
          text-align: center;
          font-size: 12px;
        }

        .footprint-status {
          display: inline-flex;
          align-items: center;
          padding: 5px 8px;
          border-radius: 999px;
          background: #edf1ef;
          color: #617168;
          font-size: 9px;
          font-weight: 900;
          white-space: nowrap;
        }

        .footprint-status.completed {
          background: #e4f7ea;
          color: #147844;
        }

        .footprint-status.partially-completed {
          background: #fff4dc;
          color: #9b650c;
        }

        .footprint-status.missed-route,
        .footprint-status.deviated {
          background: #fee8e8;
          color: #b42318;
        }

        .footprint-status.ongoing {
          background: #e8f1ff;
          color: #245fbd;
        }

        .footprint-map-label {
          position: absolute;
          z-index: 7;
          left: 16px;
          bottom: 16px;
          display: grid;
          grid-template-columns: auto auto;
          column-gap: 8px;
          row-gap: 2px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid rgba(216, 228, 221, 0.96);
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 8px 22px rgba(16, 35, 27, 0.1);
          backdrop-filter: blur(8px);
        }

        .footprint-map-label small {
          grid-column: 2;
          color: #6a7c72;
          font-size: 9px;
        }

        .actual-line-swatch {
          width: 30px !important;
          height: 5px;
          border-radius: 999px;
          background: linear-gradient(90deg, #0ea5e9, #2563eb);
        }

        .footprint-empty {
          position: absolute;
          inset: 0;
          display: grid;
          place-content: center;
          text-align: center;
          padding: 24px;
        }

        .footprint-empty strong {
          color: #173227;
        }

        .footprint-empty span {
          max-width: 430px;
          margin-top: 6px;
          color: #6b7b72;
          font-size: 12px;
          line-height: 1.5;
        }

        .footprint-selected-summary {
          display: grid;
          grid-template-columns: minmax(220px, 1.35fr) repeat(5, minmax(125px, 1fr));
          gap: 10px;
          align-items: stretch;
        }

        .selected-summary-title,
        .footprint-fact {
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid #e0e8e3;
          border-radius: 14px;
          background: #f9fbfa;
        }

        .selected-summary-title small,
        .footprint-fact small {
          display: block;
          color: #718078;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .selected-summary-title h3 {
          margin: 5px 0 0;
          color: #173227;
          font-size: 15px;
        }

        .selected-summary-title p {
          margin: 4px 0 0;
          color: #65766c;
          font-size: 10px;
        }

        .footprint-fact strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
          color: #20362b;
          font-size: 11px;
          line-height: 1.35;
        }

        .actual-start-marker,
        .actual-finish-marker {
          width: 31px;
          height: 31px;
          display: grid;
          place-items: center;
          border: 3px solid #ffffff;
          border-radius: 50%;
          color: #ffffff;
          font-size: 11px;
          font-weight: 950;
          box-shadow: 0 5px 14px rgba(15, 23, 42, 0.25);
        }

        .actual-start-marker {
          background: #0f82ff;
        }

        .actual-finish-marker {
          background: #16a34a;
        }

        @media (max-width: 1200px) {
          .footprint-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .footprint-selected-summary {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .selected-summary-title {
            grid-column: 1 / -1;
          }

          .map-trip-summary {
            max-width: calc(100% - 220px);
          }
        }

        @media (max-width: 980px) {
          .footprint-filters {
            grid-template-columns: 1fr 1fr;
          }

          .footprint-search,
          .footprint-filters > button {
            grid-column: 1 / -1;
          }

          .footprint-heading {
            flex-direction: column;
          }

          .footprint-source-badge {
            width: 100%;
          }

          .map-trip-summary {
            max-width: calc(100% - 32px);
            right: 16px;
            top: 76px;
          }
        }

        @media (max-width: 700px) {
          .footprint-metrics,
          .footprint-selected-summary,
          .footprint-filters {
            grid-template-columns: 1fr;
          }

          .footprint-search,
          .footprint-filters > button {
            grid-column: auto;
          }

          .footprint-map-card,
          .footprint-workspace {
            min-height: 560px;
          }

          .history-toggle {
            left: 12px;
            right: 12px;
            top: 12px;
            width: auto;
          }

          .map-trip-summary {
            left: 12px;
            right: 12px;
            top: 74px;
            max-width: none;
            align-items: flex-start;
            flex-direction: column;
          }

          .map-trip-copy {
            width: 100%;
            padding-right: 0;
            padding-bottom: 9px;
            border-right: 0;
            border-bottom: 1px solid #e6ece8;
          }

          .map-trip-facts {
            width: 100%;
            flex-wrap: wrap;
          }

          .footprint-history-drawer {
            top: 66px;
            left: 12px;
            right: 12px;
            bottom: 12px;
            width: auto;
          }

          .footprint-map-label {
            left: 12px;
            bottom: 12px;
          }
        }
      `}</style>
    </section>
  );
}

function MiniMetric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className={`footprint-mini-metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="footprint-fact">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`footprint-status ${statusClass(status)}`}>{status}</span>;
}

function ActualFootprintMap({ record }: { record: FootprintRecord }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
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
        map.addSource("actual-footprint", {
          type: "geojson",
          data: emptyLine(),
          lineMetrics: true,
        });

        map.addSource("actual-samples", {
          type: "geojson",
          data: pointCollection([]),
        });

        map.addLayer({
          id: "actual-footprint-shadow",
          type: "line",
          source: "actual-footprint",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 10,
            "line-opacity": 0.92,
          },
        });

        map.addLayer({
          id: "actual-footprint-line",
          type: "line",
          source: "actual-footprint",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-width": 6,
            "line-opacity": 0.98,
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "#0ea5e9",
              1,
              "#2563eb",
            ],
          },
        });

        // GPS samples are useful when zoomed in, but hiding them at city zoom
        // keeps the route looking clean instead of noisy.
        map.addLayer({
          id: "actual-samples",
          type: "circle",
          source: "actual-samples",
          minzoom: 15,
          paint: {
            "circle-radius": 2.6,
            "circle-color": "#1d4ed8",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.52,
          },
        });

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

    const sampleStep = Math.max(1, Math.floor(record.points.length / 100));
    const samples = record.points.filter((_, index) => index % sampleStep === 0);
    setSource(map, "actual-samples", pointCollection(samples));

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    import("maplibre-gl").then((maplibregl) => {
      const addMarker = (point: Point, cls: string, label: string) => {
        const element = document.createElement("div");
        element.className = cls;
        element.textContent = label;
        const marker = new maplibregl.Marker({ element })
          .setLngLat([point.lng, point.lat])
          .addTo(map);
        markersRef.current.push(marker);
      };

      const firstPoint = record.points[0];
      const lastPoint = record.points[record.points.length - 1];
      if (firstPoint) addMarker(firstPoint, "actual-start-marker", "S");
      if (lastPoint) addMarker(lastPoint, "actual-finish-marker", "F");
    });

    const all = record.points.map(
      (point): [number, number] => [point.lng, point.lat],
    );

    if (all.length === 1) {
      map.flyTo({ center: all[0], zoom: 16 });
      return;
    }

    if (all.length > 1) {
      const minLng = Math.min(...all.map((point) => point[0]));
      const maxLng = Math.max(...all.map((point) => point[0]));
      const minLat = Math.min(...all.map((point) => point[1]));
      const maxLat = Math.max(...all.map((point) => point[1]));

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 100, right: 80, bottom: 80, left: 80 },
          maxZoom: 17,
          duration: 650,
        },
      );
    }
  }, [ready, record]);

  return <div ref={containerRef} className="actual-footprint-map" />;
}
