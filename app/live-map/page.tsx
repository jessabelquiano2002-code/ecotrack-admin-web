"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
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
  timestamp: number,
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
    bboxText,
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

function Icon({ children }: { children: ReactNode }) {
  return <span className="ui-icon">{children}</span>;
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

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 6v5h-5l2-2a7 7 0 1 0 1.2 7.2l1.8.9A9 9 0 1 1 17.6 7L20 6Z" />
  </svg>
);

const OfflineIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m3.3 2 18.7 18.7-1.4 1.4-3.2-3.2A9.7 9.7 0 0 1 12 20a9.9 9.9 0 0 1-9.4-6.8L1 12l1.6-1.2A9.8 9.8 0 0 1 4.5 7L1.9 4.4 3.3 2Zm7.8 7.8 2.6 2.6A2 2 0 0 0 11 9.8ZM12 4c3.9 0 7.4 2.3 9.4 6l1.6 2-1.6 2c-.5.8-1.1 1.5-1.8 2.2l-2.1-2.1A6 6 0 0 0 9.8 6.4L7.7 4.3A10 10 0 0 1 12 4Z" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.7 4a6.7 6.7 0 1 0 0 13.4A6.7 6.7 0 0 0 10.7 4Zm0 2a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm5.8 9.1 4.5 4.5-1.4 1.4-4.5-4.5 1.4-1.4Z" />
  </svg>
);

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" />
  </svg>
);

function HeroTruckIllustration() {
  return (
    <svg className="hero-truck-svg" viewBox="0 0 520 210" aria-hidden="true">
      <defs>
        <linearGradient id="lmTruckBody" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#7be063" />
          <stop offset=".52" stopColor="#29b65f" />
          <stop offset="1" stopColor="#168a4a" />
        </linearGradient>
        <linearGradient id="lmTruckCab" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9ce583" />
          <stop offset="1" stopColor="#20a85a" />
        </linearGradient>
        <linearGradient id="lmGlass" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e7fff3" />
          <stop offset="1" stopColor="#6fbba5" />
        </linearGradient>
        <filter id="lmTruckShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#123826" floodOpacity=".28" />
        </filter>
      </defs>

      <g className="hero-city">
        <path d="M0 176V132h28v44M36 176V115h32v61M76 176V142h23v34M106 176V94h39v82M154 176V128h26v48M188 176V82h38v94M235 176V123h32v53M276 176V99h38v77M324 176V137h26v39M360 176V86h39v90M407 176V120h35v56M450 176V101h36v75M494 176V138h26" />
        <path d="M0 176h520" />
      </g>

      <path d="M0 181c120-10 227-10 334-1 78 6 135 5 186-4v34H0Z" fill="rgba(34, 122, 73, .12)" />

      <g className="truck-float" filter="url(#lmTruckShadow)">
        <path d="M150 65h188c18 0 32 14 32 32v58H148V75c0-6 2-10 2-10Z" fill="url(#lmTruckBody)" />
        <path d="M340 86h61c14 0 26 7 33 19l17 28v22h-89V95c0-5-4-9-9-9h-13Z" fill="url(#lmTruckCab)" />
        <path d="M375 98h30c8 0 14 4 18 10l10 17h-58V98Z" fill="url(#lmGlass)" />
        <path d="M151 77 184 53h169l-11 24H151Z" fill="#b8ee96" />
        <path d="M185 84h128" stroke="#dbffca" strokeWidth="5" strokeLinecap="round" opacity=".72" />
        <rect x="180" y="114" width="121" height="29" rx="6" fill="rgba(0, 84, 48, .45)" />
        <text x="240" y="128" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="900">METRO WASTE</text>
        <text x="240" y="139" textAnchor="middle" fill="#e3ffe9" fontSize="7" fontWeight="800" letterSpacing="2">CATBALOGAN</text>
        <path d="M147 155h305" stroke="#245643" strokeWidth="8" strokeLinecap="round" />
        <circle cx="207" cy="161" r="24" fill="#173b2b" />
        <circle cx="207" cy="161" r="11" fill="#a6b7af" />
        <circle cx="399" cy="161" r="24" fill="#173b2b" />
        <circle cx="399" cy="161" r="11" fill="#a6b7af" />
      </g>
    </svg>
  );
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
        const assignedRouteId = String(
          location.assignedRouteId || driverProfile.assignedRouteId || "",
        );
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

        const lastSeen = normalizeTimestamp(
          location.timestamp ?? location.lastUpdated,
        );

        return {
          id,
          name:
            location.name ||
            driverProfile.name ||
            route.assignedDriverName ||
            "Unnamed Driver",
          truck: driverProfile.truck || "No truck assigned",
          lat,
          lng,
          status: getStatusFromTimestamp(
            location.status,
            driverProfile.status,
            lastSeen,
          ),
          lastSeen,
          assignedRouteId,
          assignedRouteName:
            location.assignedRouteName ||
            route.routeName ||
            assignedRouteId ||
            "No route assigned",
          assignedBarangays,
          assignedPuroks: routePuroks,
          scheduleDays: routeDays,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const rank: Record<string, number> = {
          online: 0,
          stale: 1,
          offline: 2,
        };

        if (rank[a.status] !== rank[b.status]) {
          return rank[a.status] - rank[b.status];
        }

        return b.lastSeen - a.lastSeen;
      }) as LiveDriver[];
  }, [locations, driverProfiles, routes]);

  const filteredDrivers = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return liveDrivers.filter((driver) => {
      const matchesStatus =
        statusFilter === "all" || driver.status === statusFilter;

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
      return (
        liveDrivers.find((driver) => driver.id === selectedDriverId) || null
      );
    }

    return (
      liveDrivers.find((driver) => driver.status === "online") ||
      liveDrivers[0] ||
      null
    );
  }, [selectedDriverId, liveDrivers]);

  const mapUrl = useMemo(
    () => buildOpenStreetMapEmbedUrl(selectedDriver),
    [selectedDriver],
  );

  const externalMapUrl = useMemo(
    () => buildOpenStreetMapExternalUrl(selectedDriver),
    [selectedDriver],
  );

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
        <section className="live-hero reveal reveal-1">
          <div className="hero-copy">
            <span className="eyebrow">Operations Map</span>
            <h1>
              Live driver tracking
              <span className="title-live-dot" aria-hidden="true" />
            </h1>
            <p>
              Select a driver to view current GPS, assigned route, barangay
              coverage, and last update status.
            </p>
          </div>

          <div className="hero-illustration" aria-hidden="true">
            <HeroTruckIllustration />
          </div>

          <div className="sync-card">
            <div className="sync-icon">
              <RadioIcon />
            </div>
            <div>
              <strong>Realtime database</strong>
              <span>Connected</span>
              <small>Last refreshed {formatLastSeen(lastUpdated)}</small>
            </div>
          </div>
        </section>

        <section className="metrics-grid reveal reveal-2">
          <MetricCard
            label="Drivers with GPS"
            value={stats.total}
            helper="Total drivers"
            tone="green"
            icon={<TruckIcon />}
          />

          <MetricCard
            label="Live now"
            value={stats.online}
            helper="Currently active"
            tone="live"
            icon={<RadioIcon />}
          />

          <MetricCard
            label="Needs update"
            value={stats.stale}
            helper="Pending GPS refresh"
            tone="amber"
            icon={<RefreshIcon />}
          />

          <MetricCard
            label="Offline"
            value={stats.offline}
            helper="Not currently active"
            tone="slate"
            icon={<OfflineIcon />}
          />
        </section>

        <section className="map-workspace reveal reveal-3">
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
                    Showing: <strong>{selectedDriver.name}</strong>
                  </span>
                ) : (
                  <span>No driver selected</span>
                )}
              </div>

              <a
                href={externalMapUrl}
                target="_blank"
                rel="noreferrer"
                className="open-map-btn"
              >
                Open in OSM
                <Icon>
                  <ExternalIcon />
                </Icon>
              </a>
            </div>

            {!selectedDriver && (
              <div className="empty-map-card">
                <div className="empty-map-icon">
                  <PinIcon />
                </div>
                <strong>No GPS signal yet</strong>
                <span>
                  Ask the driver to log in, allow location permission, and keep
                  the driver app active.
                </span>
              </div>
            )}

            {selectedDriver && (
              <div className="floating-driver-card">
                <div className="floating-header">
                  <div className="avatar-truck">
                    <TruckIcon />
                  </div>

                  <div className="floating-copy">
                    <strong>{selectedDriver.name}</strong>
                    <span>{selectedDriver.truck}</span>
                  </div>

                  <span className={`status-badge ${selectedDriver.status}`}>
                    <span className="status-dot" />
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
                      {selectedDriver.lat.toFixed(5)},{" "}
                      {selectedDriver.lng.toFixed(5)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="map-legend" aria-label="Driver map status legend">
              <span>
                <i className="legend-icon live" />
                Live
              </span>
              <span>
                <i className="legend-icon recent" />
                Active (Recent)
              </span>
              <span>
                <i className="legend-icon stale" />
                Needs Update
              </span>
              <span>
                <i className="legend-icon offline" />
                Offline
              </span>
            </div>
          </div>

          <aside className="control-panel">
            <div className="panel-header">
              <div>
                <h2>Drivers</h2>
                <p>
                  {filteredDrivers.length} shown from {liveDrivers.length} total
                </p>
              </div>
            </div>

            <div className="search-control">
              <Icon>
                <SearchIcon />
              </Icon>
              <input
                placeholder="Search driver, route, barangay..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="filter-row">
              {(["all", "online", "stale", "offline"] as StatusFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    className={statusFilter === filter ? "active" : ""}
                    onClick={() => setStatusFilter(filter)}
                    type="button"
                  >
                    {filter !== "all" && (
                      <span className={`filter-dot ${filter}`} />
                    )}
                    {filter === "all" ? "All" : statusLabel(filter)}
                  </button>
                ),
              )}
            </div>

            <div className="driver-list">
              {filteredDrivers.length === 0 ? (
                <div className="empty-list">
                  <strong>No drivers found</strong>
                  <span>Try another search or status filter.</span>
                </div>
              ) : (
                filteredDrivers.map((driver, index) => (
                  <button
                    key={driver.id}
                    type="button"
                    className={`driver-row ${
                      selectedDriver?.id === driver.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedDriverId(driver.id)}
                    style={{ animationDelay: `${index * 45}ms` }}
                  >
                    <div className="driver-row-top">
                      <div
                        className={`driver-avatar avatar-${driver.status}`}
                      >
                        {getInitials(driver.name)}
                      </div>

                      <div className="driver-main">
                        <strong>{driver.name}</strong>
                        <span>{driver.assignedRouteName}</span>
                      </div>

                      <span className={`status-badge ${driver.status}`}>
                        <span className="status-dot" />
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

      <style jsx global>{`
        /*
         * METRO WASTE CATBALOGAN — LIVE MAP FINAL UI
         * UI-only redesign. Existing Firebase + OSM logic is preserved.
         */
        .live-map-page {
          width: 100%;
          max-width: 1680px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          color: #10231b;
        }

        .reveal {
          opacity: 0;
          transform: translateY(10px);
          animation: liveMapReveal .42s cubic-bezier(.2,.75,.25,1) forwards;
        }

        .reveal-1 { animation-delay: 20ms; }
        .reveal-2 { animation-delay: 80ms; }
        .reveal-3 { animation-delay: 140ms; }

        @keyframes liveMapReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .live-hero {
          position: relative;
          min-height: 210px;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, .92fr) minmax(430px, 1.08fr);
          align-items: stretch;
          border: 1px solid #d8e4dc;
          border-radius: 24px;
          background:
            radial-gradient(circle at 75% 18%, rgba(66, 190, 95, .10), transparent 28%),
            linear-gradient(115deg, #ffffff 0%, #f7fbf8 44%, #edf7f0 100%);
          box-shadow: 0 12px 32px rgba(16, 35, 27, .065);
        }

        .live-hero::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(255,255,255,.04), rgba(22,138,74,.03)),
            radial-gradient(circle at 17% 100%, rgba(22,138,74,.05), transparent 24%);
        }

        .hero-copy {
          position: relative;
          z-index: 4;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 25px 26px 28px;
        }

        .eyebrow {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          padding: 7px 11px;
          border-radius: 999px;
          background: #e7f6ec;
          color: #167b45;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .025em;
        }

        .hero-copy h1 {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 14px 0 0;
          color: #10231b;
          font-size: clamp(31px, 3vw, 43px);
          line-height: 1.03;
          font-weight: 950;
          letter-spacing: -.04em;
        }

        .title-live-dot {
          width: 10px;
          height: 10px;
          flex: 0 0 10px;
          border-radius: 50%;
          background: #168a4a;
          box-shadow: 0 0 0 7px rgba(22, 138, 74, .10);
        }

        .hero-copy p {
          max-width: 620px;
          margin: 12px 0 0;
          color: #596c62;
          font-size: 15px;
          line-height: 1.6;
        }

        .hero-illustration {
          position: relative;
          z-index: 2;
          min-height: 210px;
          display: flex;
          align-items: end;
          justify-content: flex-end;
          overflow: hidden;
        }

        .hero-illustration .hero-truck-svg {
          width: min(100%, 545px);
          height: auto;
          margin: 0 8px -1px 0;
        }

        .hero-city {
          stroke: #72c989;
          fill: none;
          opacity: .25;
          animation: liveCityGlow 4.6s ease-in-out infinite alternate;
        }

        .truck-float {
          transform-origin: 50% 70%;
          animation: liveTruckFloat 5.6s ease-in-out infinite;
        }

        @keyframes liveTruckFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        @keyframes liveCityGlow {
          from { opacity: .20; }
          to { opacity: .34; }
        }

        .sync-card {
          position: absolute;
          z-index: 6;
          top: 18px;
          right: 18px;
          min-width: 225px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid #d7e3dc;
          border-radius: 16px;
          background: rgba(255,255,255,.94);
          box-shadow: 0 10px 24px rgba(16,35,27,.08);
          backdrop-filter: blur(10px);
        }

        .sync-icon {
          width: 43px;
          height: 43px;
          flex: 0 0 43px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #e5f5ea;
          color: #168a4a;
        }

        .sync-icon svg {
          width: 22px !important;
          height: 22px !important;
          fill: currentColor;
        }

        .sync-card strong,
        .sync-card span,
        .sync-card small {
          display: block;
        }

        .sync-card strong {
          color: #173227;
          font-size: 13px;
        }

        .sync-card span {
          margin-top: 2px;
          color: #168a4a;
          font-size: 12px;
          font-weight: 850;
        }

        .sync-card small {
          margin-top: 3px;
          color: #687a70;
          font-size: 11px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .metric-card {
          --metric-color: #168a4a;
          --metric-soft: #e7f6ec;

          min-height: 112px;
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 17px 18px;
          border: 1px solid #dbe6df;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 8px 22px rgba(16,35,27,.05);
          transition:
            transform .15s ease,
            border-color .15s ease,
            box-shadow .15s ease;
        }

        .metric-card:hover {
          transform: translateY(-2px);
          border-color: #bcd2c4;
          box-shadow: 0 12px 28px rgba(16,35,27,.075);
        }

        .metric-card.green {
          --metric-color: #168a4a;
          --metric-soft: #e7f6ec;
        }

        .metric-card.live {
          --metric-color: #159a4d;
          --metric-soft: #e7f8ec;
        }

        .metric-card.amber {
          --metric-color: #ad6e0b;
          --metric-soft: #fff3da;
        }

        .metric-card.slate {
          --metric-color: #65756d;
          --metric-soft: #eff3f1;
        }

        .metric-icon {
          width: 51px;
          height: 51px;
          flex: 0 0 51px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--metric-color) 20%, #fff);
          background: var(--metric-soft);
          color: var(--metric-color);
        }

        .metric-icon svg {
          width: 25px !important;
          height: 25px !important;
          max-width: 25px !important;
          max-height: 25px !important;
          fill: currentColor;
        }

        .metric-copy {
          min-width: 0;
        }

        .metric-copy span,
        .metric-copy strong,
        .metric-copy small {
          display: block;
        }

        .metric-copy span {
          color: #344b3f;
          font-size: 14px;
          font-weight: 850;
        }

        .metric-copy strong {
          margin-top: 5px;
          color: #10231b;
          font-size: 30px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -.035em;
        }

        .metric-copy small {
          margin-top: 5px;
          color: #6a7b72;
          font-size: 12px;
        }

        .map-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 390px;
          gap: 16px;
          align-items: stretch;
        }

        .map-panel {
          position: relative;
          min-height: 690px;
          overflow: hidden;
          border: 1px solid #d9e3dd;
          border-radius: 24px;
          background: #dfe9e4;
          box-shadow: 0 14px 34px rgba(16,35,27,.075);
        }

        .map-iframe {
          position: absolute;
          inset: 0;
          z-index: 1;
          width: 100%;
          height: 100%;
          border: 0;
        }

        .map-panel::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(16,35,27,.08), transparent 19%),
            linear-gradient(0deg, rgba(16,35,27,.07), transparent 24%);
        }

        .map-topbar {
          position: absolute;
          z-index: 5;
          top: 16px;
          left: 16px;
          right: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .map-title-pill {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 0 15px;
          border: 1px solid rgba(215,226,219,.96);
          border-radius: 999px;
          background: rgba(255,255,255,.97);
          color: #42574c;
          font-size: 13px;
          box-shadow: 0 8px 22px rgba(16,35,27,.10);
          backdrop-filter: blur(9px);
        }

        .map-title-pill strong {
          color: #173227;
        }

        .open-map-btn {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 15px;
          border: 1px solid #168a4a;
          border-radius: 12px;
          background: #ffffff;
          color: #176c42;
          font-size: 13px;
          font-weight: 900;
          text-decoration: none;
          box-shadow: 0 8px 22px rgba(16,35,27,.09);
          transition:
            background .15s ease,
            color .15s ease,
            transform .15s ease;
        }

        .open-map-btn:hover {
          transform: translateY(-1px);
          background: #168a4a;
          color: #ffffff;
        }

        .open-map-btn .ui-icon {
          width: 17px;
          height: 17px;
        }

        .pulse-dot {
          width: 10px;
          height: 10px;
          flex: 0 0 10px;
          border-radius: 50%;
          background: #94a3b8;
        }

        .pulse-dot.online {
          background: #20a654;
          box-shadow: 0 0 0 6px rgba(32,166,84,.14);
        }

        .pulse-dot.stale {
          background: #e3a11b;
          box-shadow: 0 0 0 6px rgba(227,161,27,.13);
        }

        .floating-driver-card {
          position: absolute;
          z-index: 5;
          left: 16px;
          bottom: 48px;
          width: min(390px, calc(100% - 32px));
          border: 1px solid rgba(215,226,219,.97);
          border-radius: 20px;
          background: rgba(255,255,255,.97);
          padding: 17px;
          box-shadow: 0 18px 44px rgba(16,35,27,.16);
          backdrop-filter: blur(14px);
        }

        .floating-header {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .avatar-truck {
          width: 44px;
          height: 44px;
          flex: 0 0 44px;
          display: grid;
          place-items: center;
          border-radius: 13px;
          background: #e5f6ea;
          color: #168a4a;
        }

        .avatar-truck svg {
          width: 23px !important;
          height: 23px !important;
          fill: currentColor;
        }

        .floating-copy {
          min-width: 0;
          flex: 1;
        }

        .floating-copy strong,
        .floating-copy span {
          display: block;
        }

        .floating-copy strong {
          color: #173227;
          font-size: 16px;
        }

        .floating-copy span {
          margin-top: 3px;
          color: #65786d;
          font-size: 12px;
        }

        .status-badge {
          margin-left: auto;
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 9px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        .status-badge.online {
          background: #e5f6ea;
          color: #168347;
        }

        .status-badge.stale {
          background: #fff2d7;
          color: #a56a0d;
        }

        .status-badge.offline {
          background: #eef2f0;
          color: #697a71;
        }

        .detail-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .detail-grid div {
          min-width: 0;
          padding: 11px;
          border: 1px solid #e3ebe6;
          border-radius: 13px;
          background: #f8faf9;
        }

        .detail-grid small,
        .detail-grid strong {
          display: block;
        }

        .detail-grid small {
          margin-bottom: 4px;
          color: #72847a;
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: .035em;
        }

        .detail-grid strong {
          color: #20372b;
          font-size: 12px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .empty-map-card {
          position: absolute;
          z-index: 6;
          inset: auto 50% 50% auto;
          width: min(410px, calc(100% - 40px));
          transform: translate(50%, 50%);
          padding: 22px;
          border: 1px solid #d9e5dd;
          border-radius: 20px;
          background: rgba(255,255,255,.97);
          text-align: center;
          box-shadow: 0 18px 44px rgba(16,35,27,.15);
        }

        .empty-map-icon {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          margin: 0 auto 10px;
          border-radius: 14px;
          background: #e8f6ed;
          color: #168a4a;
        }

        .empty-map-icon svg {
          width: 24px !important;
          height: 24px !important;
          fill: currentColor;
        }

        .empty-map-card strong,
        .empty-map-card span {
          display: block;
        }

        .empty-map-card strong {
          color: #173227;
          font-size: 16px;
        }

        .empty-map-card span {
          margin-top: 6px;
          color: #607368;
          font-size: 13px;
          line-height: 1.5;
        }

        .map-legend {
          position: absolute;
          z-index: 5;
          left: 0;
          right: 0;
          bottom: 0;
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 18px;
          padding: 7px 12px;
          border-top: 1px solid rgba(211,223,216,.9);
          background: rgba(255,255,255,.94);
          color: #5a6c62;
          font-size: 11px;
          backdrop-filter: blur(10px);
        }

        .map-legend span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .legend-icon {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #94a3b8;
        }

        .legend-icon.live { background: #1da652; }
        .legend-icon.recent { background: #3b82f6; }
        .legend-icon.stale { background: #e6a51e; }
        .legend-icon.offline { background: #9aa6a0; }

        .control-panel {
          height: 690px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid #dbe6df;
          border-radius: 24px;
          background: #ffffff;
          box-shadow: 0 12px 30px rgba(16,35,27,.065);
        }

        .panel-header {
          padding: 19px 18px 13px;
          border-bottom: 1px solid #e6ede8;
        }

        .panel-header h2 {
          margin: 0;
          color: #10231b;
          font-size: 22px;
          line-height: 1.2;
          letter-spacing: -.03em;
        }

        .panel-header p {
          margin: 4px 0 0;
          color: #6c7d73;
          font-size: 12px;
        }

        .search-control {
          height: 44px;
          margin: 14px 14px 9px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 11px;
          border: 1px solid #dce6e0;
          border-radius: 13px;
          background: #f8faf9;
        }

        .search-control .ui-icon {
          width: 18px;
          height: 18px;
          color: #7e8f85;
        }

        .search-control input {
          width: 100%;
          border: 0;
          background: transparent;
          outline: none;
          color: #173227;
          font-size: 12px;
        }

        .search-control input::placeholder {
          color: #84938b;
        }

        .filter-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 7px;
          padding: 0 14px 12px;
        }

        .filter-row button {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border: 1px solid #e2e9e5;
          border-radius: 10px;
          background: #f3f6f4;
          color: #62746a;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            background .14s ease,
            border-color .14s ease,
            color .14s ease;
        }

        .filter-row button:hover {
          border-color: #c2d4c9;
        }

        .filter-row button.active {
          border-color: #8dc8a2;
          background: #e9f6ed;
          color: #147543;
        }

        .filter-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #94a3b8;
        }

        .filter-dot.online { background: #1da652; }
        .filter-dot.stale { background: #e6a51e; }
        .filter-dot.offline { background: #96a19b; }

        .driver-list {
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 0 14px 14px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #aec6b8 transparent;
        }

        .driver-list::-webkit-scrollbar {
          width: 6px;
        }

        .driver-list::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #aec6b8;
        }

        .driver-row {
          width: 100%;
          padding: 12px;
          border: 1px solid #e0e8e3;
          border-radius: 16px;
          background: #ffffff;
          text-align: left;
          cursor: pointer;
          opacity: 0;
          transform: translateY(5px);
          animation: driverRowIn .28s ease forwards;
          transition:
            transform .15s ease,
            border-color .15s ease,
            box-shadow .15s ease,
            background .15s ease;
        }

        @keyframes driverRowIn {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .driver-row:hover {
          transform: translateY(-1px);
          border-color: #acd1ba;
          box-shadow: 0 9px 20px rgba(16,35,27,.07);
        }

        .driver-row.selected {
          border-color: #49b76e;
          background: #f1fbf4;
          box-shadow: 0 9px 22px rgba(22,138,74,.09);
        }

        .driver-row-top {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .driver-avatar {
          width: 39px;
          height: 39px;
          flex: 0 0 39px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          color: #ffffff;
          font-size: 12px;
          font-weight: 950;
        }

        .driver-avatar.avatar-online { background: #168a4a; }
        .driver-avatar.avatar-stale { background: #c68613; }
        .driver-avatar.avatar-offline { background: #50675b; }

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
          color: #173227;
          font-size: 13px;
        }

        .driver-main span {
          margin-top: 3px;
          color: #6c7e74;
          font-size: 11px;
        }

        .driver-meta-grid {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 1fr .86fr;
          gap: 7px;
        }

        .driver-meta-grid div {
          min-width: 0;
          padding: 9px;
          border: 1px solid #e5ebe7;
          border-radius: 11px;
          background: #f8faf9;
        }

        .driver-meta-grid small,
        .driver-meta-grid span {
          display: block;
        }

        .driver-meta-grid small {
          margin-bottom: 4px;
          color: #7d8e84;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .driver-meta-grid span {
          overflow: hidden;
          color: #40564a;
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .empty-list {
          padding: 27px 15px;
          border: 1px dashed #cbd9d1;
          border-radius: 15px;
          background: #f8faf9;
          text-align: center;
        }

        .empty-list strong,
        .empty-list span {
          display: block;
        }

        .empty-list strong {
          color: #173227;
          font-size: 13px;
        }

        .empty-list span {
          margin-top: 5px;
          color: #687a70;
          font-size: 11px;
        }

        .ui-icon {
          display: inline-grid;
          place-items: center;
        }

        .ui-icon svg {
          display: block;
          width: 100% !important;
          height: 100% !important;
          fill: currentColor;
        }

        @media (max-width: 1180px) {
          .live-hero {
            grid-template-columns: 1fr 420px;
          }

          .metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .map-workspace {
            grid-template-columns: 1fr;
          }

          .control-panel {
            height: auto;
            max-height: 580px;
          }
        }

        @media (max-width: 900px) {
          .live-hero {
            grid-template-columns: 1fr;
          }

          .hero-copy {
            padding-bottom: 10px;
          }

          .hero-illustration {
            min-height: 170px;
          }

          .sync-card {
            top: auto;
            right: 14px;
            bottom: 14px;
          }
        }

        @media (max-width: 700px) {
          .live-map-page {
            gap: 13px;
          }

          .live-hero {
            border-radius: 18px;
          }

          .hero-copy {
            padding: 21px 17px 9px;
          }

          .hero-copy h1 {
            font-size: 32px;
          }

          .hero-copy p {
            font-size: 14px;
          }

          .sync-card {
            position: relative;
            right: auto;
            bottom: auto;
            margin: 0 14px 14px;
            width: calc(100% - 28px);
          }

          .hero-illustration {
            min-height: 150px;
          }

          .metrics-grid {
            grid-template-columns: 1fr;
          }

          .map-panel {
            min-height: 600px;
          }

          .map-topbar {
            align-items: stretch;
            flex-direction: column;
          }

          .map-title-pill,
          .open-map-btn {
            width: fit-content;
          }

          .floating-driver-card {
            bottom: 50px;
          }

          .detail-grid {
            grid-template-columns: 1fr;
          }

          .map-legend {
            gap: 10px;
            justify-content: flex-start;
            overflow-x: auto;
            flex-wrap: nowrap;
          }
        }

        @media (max-width: 520px) {
          .hero-copy h1 {
            font-size: 29px;
          }

          .floating-driver-card {
            left: 10px;
            width: calc(100% - 20px);
          }

          .filter-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .reveal,
          .truck-float,
          .hero-city,
          .driver-row {
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
}: {
  label: string;
  value: number;
  helper: string;
  tone: "green" | "live" | "amber" | "slate";
  icon: ReactNode;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </article>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "D";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
