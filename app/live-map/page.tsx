"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type DriverLocation = {
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  name?: string;
  timestamp?: number | string;
  lastUpdated?: number | string;
  status?: string;
  assignedRouteId?: string;
  assignedRouteName?: string;
  assignedBarangays?: string[] | Record<string, string | boolean>;
};

type DriverProfile = {
  name?: string;
  status?: string;
  truck?: string;
  assignedRouteId?: string;
  assignedBarangays?: string[] | Record<string, string | boolean>;
};

type RouteData = {
  routeName?: string;
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
  scheduleDays?: string[] | Record<string, string | boolean>;
  assignedDriverName?: string;
};

type LiveDriver = {
  id: string;
  name: string;
  truck: string;
  lat: number;
  lng: number;
  status: "online" | "stale" | "offline";
  lastSeen: number;
  assignedRouteId: string;
  assignedRouteName: string;
  assignedBarangays: string[];
  assignedPuroks: string[];
  scheduleDays: string[];
};

type BBox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type StatusFilter = "all" | "online" | "stale" | "offline";

const DEFAULT_BBOX: BBox = {
  minLng: 124.84,
  minLat: 11.73,
  maxLng: 124.93,
  maxLat: 11.81,
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
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

    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) return parsedDate;
  }

  return 0;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, string | boolean>)
      .map(([key, val]) => {
        if (val === true) return key;
        if (typeof val === "string") return val;
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function getStatusFromTimestamp(
  locationStatus: string | undefined,
  driverStatus: string | undefined,
  timestamp: number
): LiveDriver["status"] {
  const locStatus = String(locationStatus || "").toLowerCase();
  const drvStatus = String(driverStatus || "").toLowerCase();

  if (locStatus === "offline" || drvStatus === "offline") return "offline";
  if (!timestamp) return "offline";

  const diffMs = Math.max(0, Date.now() - timestamp);

  if (diffMs <= 2 * 60 * 1000) return "online";
  if (diffMs <= 10 * 60 * 1000) return "stale";

  return "offline";
}

function formatLastSeen(timestamp: number) {
  if (!timestamp) return "No GPS update yet";

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return new Date(timestamp).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: LiveDriver["status"]) {
  if (status === "online") return "Live";
  if (status === "stale") return "Needs update";
  return "Offline";
}

function makeBBoxAroundDriver(driver: LiveDriver): BBox {
  return {
    minLng: driver.lng - 0.025,
    minLat: driver.lat - 0.018,
    maxLng: driver.lng + 0.025,
    maxLat: driver.lat + 0.018,
  };
}

function buildOpenStreetMapEmbedUrl(driver: LiveDriver | null) {
  const bbox = driver ? makeBBoxAroundDriver(driver) : DEFAULT_BBOX;
  const bboxText = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

  let url = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bboxText
  )}&layer=mapnik`;

  if (driver) {
    url += `&marker=${encodeURIComponent(`${driver.lat},${driver.lng}`)}`;
  }

  return url;
}

function buildOpenStreetMapExternalUrl(driver: LiveDriver | null) {
  if (!driver) return "https://www.openstreetmap.org";
  return `https://www.openstreetmap.org/?mlat=${driver.lat}&mlon=${driver.lng}#map=17/${driver.lat}/${driver.lng}`;
}

function joinText(items: string[], fallback = "Not assigned") {
  return items.length > 0 ? items.join(", ") : fallback;
}

export default function LiveMapPage() {
  const [locations, setLocations] = useState<Record<string, DriverLocation>>({});
  const [driverProfiles, setDriverProfiles] = useState<Record<string, DriverProfile>>({});
  const [routes, setRoutes] = useState<Record<string, RouteData>>({});
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [, forceClockRefresh] = useState(0);

  useEffect(() => {
    const unsubLocations = onValue(ref(db, "driver_locations"), (snapshot) => {
      setLocations(snapshot.val() || {});
      setLastUpdated(Date.now());
    });

    const unsubDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      setDriverProfiles(snapshot.val() || {});
      setLastUpdated(Date.now());
    });

    const unsubRoutes = onValue(ref(db, "routes"), (snapshot) => {
      setRoutes(snapshot.val() || {});
      setLastUpdated(Date.now());
    });

    const refreshTimer = window.setInterval(() => {
      forceClockRefresh((value) => value + 1);
    }, 30_000);

    return () => {
      unsubLocations();
      unsubDrivers();
      unsubRoutes();
      window.clearInterval(refreshTimer);
    };
  }, []);

  const liveDrivers = useMemo<LiveDriver[]>(() => {
    return Object.entries(locations)
      .map(([id, location]) => {
        const lat = toNumber(location.latitude ?? location.lat);
        const lng = toNumber(location.longitude ?? location.lng);

        if (lat === null || lng === null) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

        const driverProfile = driverProfiles[id] || {};
        const assignedRouteId = String(location.assignedRouteId || driverProfile.assignedRouteId || "");
        const route = assignedRouteId ? routes[assignedRouteId] || {} : {};

        const locationBarangays = normalizeArray(location.assignedBarangays);
        const driverBarangays = normalizeArray(driverProfile.assignedBarangays);
        const routeBarangays = normalizeArray(route.barangays);
        const routePuroks = normalizeArray(route.puroks);
        const routeDays = normalizeArray(route.scheduleDays);

        const assignedBarangays =
          locationBarangays.length > 0
            ? locationBarangays
            : driverBarangays.length > 0
              ? driverBarangays
              : routeBarangays;

        const lastSeen = normalizeTimestamp(location.timestamp ?? location.lastUpdated);

        return {
          id,
          name: location.name || driverProfile.name || route.assignedDriverName || "Unnamed Driver",
          truck: driverProfile.truck || "No truck assigned",
          lat,
          lng,
          status: getStatusFromTimestamp(location.status, driverProfile.status, lastSeen),
          lastSeen,
          assignedRouteId,
          assignedRouteName:
            location.assignedRouteName || route.routeName || assignedRouteId || "No route assigned",
          assignedBarangays,
          assignedPuroks: routePuroks,
          scheduleDays: routeDays,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const rank: Record<string, number> = { online: 0, stale: 1, offline: 2 };

        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return b.lastSeen - a.lastSeen;
      }) as LiveDriver[];
  }, [locations, driverProfiles, routes]);

  const filteredDrivers = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return liveDrivers.filter((driver) => {
      const matchesStatus = statusFilter === "all" || driver.status === statusFilter;

      if (!matchesStatus) return false;
      if (!keyword) return true;

      const searchable = [
        driver.name,
        driver.truck,
        driver.assignedRouteName,
        driver.assignedBarangays.join(" "),
        driver.assignedPuroks.join(" "),
        driver.status,
        driver.id,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(keyword);
    });
  }, [liveDrivers, search, statusFilter]);

  const selectedDriver = useMemo(() => {
    if (selectedDriverId) {
      return liveDrivers.find((driver) => driver.id === selectedDriverId) || null;
    }

    return liveDrivers.find((driver) => driver.status === "online") || liveDrivers[0] || null;
  }, [selectedDriverId, liveDrivers]);

  const mapUrl = useMemo(() => buildOpenStreetMapEmbedUrl(selectedDriver), [selectedDriver]);
  const externalMapUrl = useMemo(() => buildOpenStreetMapExternalUrl(selectedDriver), [selectedDriver]);

  const stats = useMemo(() => {
    return {
      total: liveDrivers.length,
      online: liveDrivers.filter((driver) => driver.status === "online").length,
      stale: liveDrivers.filter((driver) => driver.status === "stale").length,
      offline: liveDrivers.filter((driver) => driver.status === "offline").length,
    };
  }, [liveDrivers]);

  return (
    <DashboardShell
      title="Live Map"
      description="Monitor driver GPS locations and route assignments in real time"
      hidePageHeader
    >
      <div className="live-map-page">
        <section className="live-hero">
          <div>
            <span className="eyebrow">Operations Map</span>
            <h1>Live driver tracking</h1>
            <p>
              Select a driver to view current GPS, assigned route, barangay coverage,
              and last update status.
            </p>
          </div>

          <div className="sync-card">
            <span className="sync-dot" />
            <div>
              <strong>Realtime database connected</strong>
              <small>Last refreshed {formatLastSeen(lastUpdated)}</small>
            </div>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard label="Drivers with GPS" value={stats.total} tone="neutral" />
          <MetricCard label="Live now" value={stats.online} tone="green" />
          <MetricCard label="Needs update" value={stats.stale} tone="amber" />
          <MetricCard label="Offline" value={stats.offline} tone="slate" />
        </section>

        <section className="map-workspace">
          <div className="map-panel">
            <iframe
              key={mapUrl}
              title="Driver current location map"
              src={mapUrl}
              className="map-iframe"
              loading="eager"
            />

            <div className="map-topbar">
              <div className="map-title-pill">
                <span className={`pulse-dot ${selectedDriver?.status || "offline"}`} />
                {selectedDriver ? (
                  <span>
                    Showing <strong>{selectedDriver.name}</strong>
                  </span>
                ) : (
                  <span>No driver selected</span>
                )}
              </div>

              <a href={externalMapUrl} target="_blank" rel="noreferrer" className="open-map-btn">
                Open in OSM
              </a>
            </div>

            {!selectedDriver && (
              <div className="empty-map-card">
                <strong>No GPS signal yet</strong>
                <span>
                  Ask the driver to log in, allow location permission, and keep the driver app active.
                </span>
              </div>
            )}

            {selectedDriver && (
              <div className="floating-driver-card">
                <div className="floating-header">
                  <div className="avatar-truck">🚚</div>
                  <div>
                    <strong>{selectedDriver.name}</strong>
                    <span>{selectedDriver.truck}</span>
                  </div>
                  <span className={`status-badge ${selectedDriver.status}`}>
                    {statusLabel(selectedDriver.status)}
                  </span>
                </div>

                <div className="detail-grid">
                  <div>
                    <small>Route</small>
                    <strong>{selectedDriver.assignedRouteName}</strong>
                  </div>
                  <div>
                    <small>Last GPS</small>
                    <strong>{formatLastSeen(selectedDriver.lastSeen)}</strong>
                  </div>
                  <div>
                    <small>Barangay</small>
                    <strong>{joinText(selectedDriver.assignedBarangays)}</strong>
                  </div>
                  <div>
                    <small>Coordinates</small>
                    <strong>
                      {selectedDriver.lat.toFixed(5)}, {selectedDriver.lng.toFixed(5)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="control-panel">
            <div className="panel-header">
              <div>
                <h2>Drivers</h2>
                <p>{filteredDrivers.length} shown from {liveDrivers.length} total</p>
              </div>
            </div>

            <div className="search-control">
              <span>⌕</span>
              <input
                placeholder="Search driver, route, barangay..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="filter-row">
              {(["all", "online", "stale", "offline"] as StatusFilter[]).map((filter) => (
                <button
                  key={filter}
                  className={statusFilter === filter ? "active" : ""}
                  onClick={() => setStatusFilter(filter)}
                  type="button"
                >
                  {filter === "all" ? "All" : statusLabel(filter)}
                </button>
              ))}
            </div>

            <div className="driver-list">
              {filteredDrivers.length === 0 ? (
                <div className="empty-list">
                  <strong>No drivers found</strong>
                  <span>Try another search or status filter.</span>
                </div>
              ) : (
                filteredDrivers.map((driver) => (
                  <button
                    key={driver.id}
                    type="button"
                    className={`driver-row ${selectedDriver?.id === driver.id ? "selected" : ""}`}
                    onClick={() => setSelectedDriverId(driver.id)}
                  >
                    <div className="driver-row-top">
                      <div className="driver-avatar">{getInitials(driver.name)}</div>
                      <div className="driver-main">
                        <strong>{driver.name}</strong>
                        <span>{driver.assignedRouteName}</span>
                      </div>
                      <span className={`status-badge ${driver.status}`}>
                        {statusLabel(driver.status)}
                      </span>
                    </div>

                    <div className="driver-meta-grid">
                      <div>
                        <small>Barangay</small>
                        <span>{joinText(driver.assignedBarangays)}</span>
                      </div>
                      <div>
                        <small>Last GPS</small>
                        <span>{formatLastSeen(driver.lastSeen)}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>

      <style jsx>{`
        .live-map-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .live-hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          padding: 22px;
          border-radius: 26px;
          background:
            radial-gradient(circle at top right, rgba(34, 197, 94, 0.16), transparent 34%),
            linear-gradient(135deg, #ffffff, #f8fafc);
          border: 1px solid #e5e7eb;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.06);
        }

        .eyebrow {
          display: inline-flex;
          padding: 7px 11px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 12px;
        }

        .live-hero h1 {
          margin: 0;
          color: #0f172a;
          font-size: 32px;
          letter-spacing: -0.04em;
        }

        .live-hero p {
          margin: 8px 0 0;
          color: #64748b;
          max-width: 680px;
          line-height: 1.55;
        }

        .sync-card {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 250px;
          padding: 13px 14px;
          border-radius: 18px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
        }

        .sync-dot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.14);
        }

        .sync-card strong,
        .sync-card small {
          display: block;
        }

        .sync-card strong {
          color: #0f172a;
          font-size: 13px;
        }

        .sync-card small {
          color: #64748b;
          margin-top: 2px;
          font-size: 12px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .metric-card {
          border-radius: 22px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 18px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.05);
        }

        .metric-card span {
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }

        .metric-card strong {
          display: block;
          margin-top: 10px;
          color: #0f172a;
          font-size: 34px;
          line-height: 1;
        }

        .metric-card.green strong { color: #059669; }
        .metric-card.amber strong { color: #d97706; }
        .metric-card.slate strong { color: #64748b; }

        .map-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 390px;
          gap: 18px;
          align-items: stretch;
        }

        .map-panel {
          position: relative;
          min-height: 680px;
          border-radius: 28px;
          overflow: hidden;
          background: #dbeafe;
          border: 1px solid #e5e7eb;
          box-shadow: 0 20px 54px rgba(15, 23, 42, 0.1);
        }

        .map-iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          z-index: 1;
        }

        .map-panel::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.18), transparent 26%),
            linear-gradient(0deg, rgba(15, 23, 42, 0.16), transparent 30%);
        }

        .map-topbar {
          position: absolute;
          top: 18px;
          left: 18px;
          right: 18px;
          z-index: 5;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .map-title-pill,
        .open-map-btn {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(226, 232, 240, 0.9);
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.14);
        }

        .map-title-pill {
          padding: 0 15px;
          color: #334155;
          font-size: 13px;
          gap: 9px;
        }

        .open-map-btn {
          padding: 0 16px;
          background: #059669;
          color: #ffffff;
          text-decoration: none;
          font-size: 13px;
          font-weight: 900;
          border-color: #059669;
        }

        .pulse-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #94a3b8;
        }

        .pulse-dot.online {
          background: #22c55e;
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.16);
        }

        .pulse-dot.stale {
          background: #f59e0b;
          box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.14);
        }

        .floating-driver-card {
          position: absolute;
          left: 18px;
          right: 18px;
          bottom: 18px;
          z-index: 5;
          max-width: 620px;
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.97);
          border: 1px solid #e5e7eb;
          padding: 18px;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
          backdrop-filter: blur(16px);
        }

        .floating-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .floating-header strong,
        .floating-header span {
          display: block;
        }

        .floating-header strong {
          color: #0f172a;
          font-size: 17px;
        }

        .floating-header span:not(.status-badge) {
          color: #64748b;
          font-size: 12px;
          margin-top: 2px;
        }

        .avatar-truck {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: #dcfce7;
          display: grid;
          place-items: center;
          font-size: 20px;
        }

        .status-badge {
          margin-left: auto;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .status-badge.online {
          background: #dcfce7;
          color: #166534;
        }

        .status-badge.stale {
          background: #fef3c7;
          color: #92400e;
        }

        .status-badge.offline {
          background: #f1f5f9;
          color: #475569;
        }

        .detail-grid {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .detail-grid div {
          border-radius: 16px;
          background: #f8fafc;
          border: 1px solid #eef2f7;
          padding: 12px;
        }

        .detail-grid small,
        .detail-grid strong {
          display: block;
        }

        .detail-grid small {
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
          margin-bottom: 5px;
        }

        .detail-grid strong {
          color: #0f172a;
          font-size: 12px;
          line-height: 1.35;
        }

        .empty-map-card {
          position: absolute;
          inset: auto 50% 50% auto;
          transform: translate(50%, 50%);
          z-index: 6;
          width: min(420px, calc(100% - 40px));
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.97);
          border: 1px solid #e5e7eb;
          padding: 22px;
          text-align: center;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
        }

        .empty-map-card strong,
        .empty-map-card span {
          display: block;
        }

        .empty-map-card strong {
          color: #0f172a;
          font-size: 17px;
          margin-bottom: 6px;
        }

        .empty-map-card span {
          color: #64748b;
          line-height: 1.5;
          font-size: 13px;
        }

        .control-panel {
          height: 680px;
          display: flex;
          flex-direction: column;
          border-radius: 28px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 20px 54px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }

        .panel-header {
          padding: 20px 20px 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .panel-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 22px;
          letter-spacing: -0.03em;
        }

        .panel-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .search-control {
          margin: 16px 16px 10px;
          height: 44px;
          border-radius: 15px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 0 12px;
        }

        .search-control span {
          color: #94a3b8;
          font-size: 18px;
        }

        .search-control input {
          width: 100%;
          border: 0;
          background: transparent;
          outline: none;
          color: #0f172a;
          font-size: 13px;
        }

        .filter-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          padding: 0 16px 14px;
        }

        .filter-row button {
          height: 34px;
          border: 0;
          border-radius: 12px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }

        .filter-row button.active {
          background: #ecfdf5;
          color: #047857;
        }

        .driver-list {
          padding: 0 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 11px;
          overflow-y: auto;
        }

        .driver-row {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 20px;
          padding: 13px;
          text-align: left;
          cursor: pointer;
          transition: 0.18s ease;
        }

        .driver-row:hover,
        .driver-row.selected {
          border-color: #10b981;
          box-shadow: 0 14px 30px rgba(16, 185, 129, 0.12);
          transform: translateY(-1px);
        }

        .driver-row.selected {
          background: #f0fdf4;
        }

        .driver-row-top {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .driver-avatar {
          width: 40px;
          height: 40px;
          flex: 0 0 40px;
          border-radius: 14px;
          background: #064e3b;
          color: #ffffff;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 13px;
        }

        .driver-main {
          min-width: 0;
          flex: 1;
        }

        .driver-main strong,
        .driver-main span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .driver-main strong {
          color: #0f172a;
          font-size: 14px;
        }

        .driver-main span {
          color: #64748b;
          margin-top: 3px;
          font-size: 12px;
        }

        .driver-meta-grid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 1fr 0.75fr;
          gap: 8px;
        }

        .driver-meta-grid div {
          padding: 10px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1px solid #eef2f7;
          min-width: 0;
        }

        .driver-meta-grid small,
        .driver-meta-grid span {
          display: block;
        }

        .driver-meta-grid small {
          color: #94a3b8;
          font-size: 10px;
          font-weight: 900;
          margin-bottom: 4px;
        }

        .driver-meta-grid span {
          color: #334155;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .empty-list {
          border-radius: 18px;
          border: 1px dashed #cbd5e1;
          background: #f8fafc;
          padding: 28px 16px;
          text-align: center;
        }

        .empty-list strong,
        .empty-list span {
          display: block;
        }

        .empty-list strong {
          color: #0f172a;
          margin-bottom: 5px;
        }

        .empty-list span {
          color: #64748b;
          font-size: 13px;
        }

        @media (max-width: 1180px) {
          .map-workspace {
            grid-template-columns: 1fr;
          }

          .control-panel {
            height: auto;
            max-height: 560px;
          }
        }

        @media (max-width: 760px) {
          .live-hero {
            flex-direction: column;
          }

          .sync-card {
            width: 100%;
          }

          .metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .map-panel {
            min-height: 560px;
          }

          .floating-driver-card {
            max-width: none;
          }

          .detail-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 520px) {
          .metrics-grid {
            grid-template-columns: 1fr;
          }

          .map-topbar {
            align-items: stretch;
            flex-direction: column;
          }

          .map-title-pill,
          .open-map-btn {
            justify-content: center;
          }
        }
      `}</style>
    </DashboardShell>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "green" | "amber" | "slate";
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "D";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
