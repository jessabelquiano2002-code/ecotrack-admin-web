"use client";

import { onValue, push, ref, update } from "@/lib/offlineFirebaseDatabase";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { ScheduleDialog } from "../schedules/ScheduleDialog";
import { ScheduleIcon } from "../schedules/ScheduleIcons";
import styles from "../schedules/schedules.module.css";
import {
  CATBALOGAN_BOUNDARY_SOURCE,
  findOfficialBarangay,
  normalizePurokLabel as normalizeCatalogPurok,
} from "../service-areas/catalog";

type Driver = {
  id: string;
  name?: string;
  truck?: string;
  status?: string;
};

type RouteArea = {
  areaKey?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string;
  purokKey?: string;
  order?: number;
};

type ServicePurok = {
  name?: string;
  label?: string;
  purok?: string;
  purokKey?: string;
  configured?: boolean;
  active?: boolean;
  lat?: number;
  lng?: number;
};

type ServiceBarangay = {
  barangay?: string;
  barangayKey?: string;
  psgcCode?: string;
  centerLatitude?: number | string;
  centerLongitude?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  coordinateType?: string;
  coordinateSource?: string;
  purok?: string;
  purokKey?: string;
  configured?: boolean;
  active?: boolean;
  puroks?: Record<string, ServicePurok>;
};

type PurokLocationRecord = ServicePurok & {
  barangay?: string;
  barangayKey?: string;
};

type ConfiguredServiceArea = {
  id: string;
  barangay: string;
  barangayKey: string;
  purok: string;
  purokKey: string;
  psgcCode: string;
  centerLatitude: number;
  centerLongitude: number;
  coordinateSource: "service-areas" | "verified-catalog" | "catalog-fallback";
};

type BarangayMapPoint = {
  barangay: string;
  barangayKey: string;
  psgcCode: string;
  latitude: number;
  longitude: number;
  coordinateSource: "service-areas" | "verified-catalog" | "catalog-fallback";
};

type RouteRecord = {
  id: string;
  routeName?: string;
  barangay?: string;
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
  areas?: RouteArea[] | Record<string, RouteArea>;
  coverageByBarangay?: Record<string, {
    barangay: string;
    barangayKey: string;
    puroks: string[];
    purokKeys: string[];
    areas: RouteArea[];
  }>;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicle?: string;
  verified?: boolean;
  routeValidation?: { status?: string; verifiedAt?: number };
  status?: string;
  createdAt?: number;
  updatedAt?: number;
};

type ScheduleRecord = {
  id: string;
  routeId?: string;
  assignedRouteId?: string;
  status?: string;
};

type RouteForm = {
  routeName: string;
  assignedDriverId: string;
  assignedVehicle: string;
};

const EMPTY_FORM: RouteForm = {
  routeName: "",
  assignedDriverId: "",
  assignedVehicle: "",
};

function isValidMapCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) =>
        item === true ? key : typeof item === "string" ? item : "",
      )
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value ? [String(value).trim()].filter(Boolean) : [];
}

function orderedValues<T extends { order?: number }>(value: unknown): T[] {
  const list = Array.isArray(value)
    ? value.filter(Boolean)
    : Object.values(
        (value && typeof value === "object" ? value : {}) as Record<string, T>,
      );
  return (list as T[]).sort(
    (left, right) => Number(left.order || 0) - Number(right.order || 0),
  );
}

function makeBarangayKey(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay|brgy/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  if (["13", "poblacion13"].includes(key)) return "poblacion_13";
  if (["guindapunan", "gundaponan"].includes(key)) return "guindaponan";
  return key;
}

function makePurokKey(value: string): string {
  const number = value.match(/\d+/)?.[0];
  return number ? `purok_${Number(number)}` : "all";
}

function makeAreaKey(barangay: string, purok: string): string {
  return `${makeBarangayKey(barangay)}|${makePurokKey(purok)}`;
}

function getRouteAreas(route: RouteRecord): RouteArea[] {
  const explicit = orderedValues<RouteArea>(route.areas).filter(
    (area) => area.barangay && area.purok,
  );
  if (explicit.length) return explicit;

  const barangays = Array.from(
    new Set([route.barangay, ...normalizeArray(route.barangays)].filter(Boolean)),
  ) as string[];
  const puroks = normalizeArray(route.puroks);
  return barangays.flatMap((barangay) =>
    puroks.map((purok, order) => ({
      areaKey: makeAreaKey(barangay, purok),
      barangay,
      barangayKey: makeBarangayKey(barangay),
      purok,
      purokKey: makePurokKey(purok),
      order,
    })),
  );
}

function groupRouteAreasByBarangay(route: RouteRecord): Array<{ barangay: string; puroks: string[] }> {
  const groups = new Map<string, { barangay: string; puroks: string[] }>();
  getRouteAreas(route).forEach((area) => {
    const barangay = String(area.barangay || "").trim();
    const purok = String(area.purok || "").trim();
    if (!barangay) return;
    const key = makeBarangayKey(barangay);
    const current = groups.get(key) || { barangay, puroks: [] };
    if (purok && !current.puroks.includes(purok)) current.puroks.push(purok);
    groups.set(key, current);
  });
  return [...groups.values()].map((group) => ({
    ...group,
    puroks: group.puroks.sort(
      (left, right) => Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0),
    ),
  }));
}

const ROUTE_STEPS = [
  { label: "Service areas", hint: "Choose the Barangays", icon: "pin" as const },
  { label: "Purok coverage", hint: "Choose exact collection areas", icon: "route" as const },
  { label: "Driver & truck", hint: "Name and assign the route", icon: "users" as const },
  { label: "Map preview", hint: "Verify Barangay destinations", icon: "pin" as const },
  { label: "Review", hint: "Confirm before saving", icon: "check" as const },
] as const;

function isAssignmentReady(route: RouteRecord): boolean {
  const status = String(route.status || "ready").toLowerCase();
  return (
    route.verified === true &&
    route.routeValidation?.status === "verified" &&
    Boolean(route.assignedDriverId) &&
    getRouteAreas(route).length > 0 &&
    !["disabled", "inactive", "archived"].includes(status)
  );
}

function formatDate(value?: number): string {
  return value
    ? new Date(value).toLocaleString("en-PH", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
}

type RouteMapPreviewProps = {
  points: BarangayMapPoint[];
  selectedBarangayCount: number;
};

function RouteMapPreview({
  points,
  selectedBarangayCount,
}: RouteMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const maplibreRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  const fitToPoints = useCallback(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;
    map.resize();

    if (!points.length) {
      map.easeTo({ center: [124.886, 11.78], zoom: 12, duration: 450 });
      return;
    }

    if (points.length === 1) {
      map.easeTo({
        center: [points[0].longitude, points[0].latitude],
        zoom: 15,
        duration: 450,
      });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) =>
      bounds.extend([point.longitude, point.latitude]),
    );
    map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 450 });
  }, [points]);

  useEffect(() => {
    let cancelled = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      maplibreRef.current = maplibregl;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        } as any,
        center: [124.886, 11.78],
        zoom: 12,
        attributionControl: { compact: true },
      });

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-left",
      );
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !maplibreRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    points.forEach((point, index) => {
      const markerElement = document.createElement("div");
      markerElement.className =
        index === 0
          ? "route-preview-marker route-preview-marker--primary"
          : "route-preview-marker";
      markerElement.setAttribute("aria-label", point.barangay);
      markerElement.innerHTML = `<span>${index + 1}</span>`;

      const sourceLabel =
        point.coordinateSource === "service-areas"
          ? "Service Areas"
          : point.coordinateSource === "verified-catalog"
            ? "OpenStreetMap verified locality"
            : "catalog fallback";
      const popup = new maplibreRef.current.Popup({
        offset: 22,
        closeButton: false,
      }).setText(
        `${point.barangay} • ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)} • ${sourceLabel}`,
      );

      const marker = new maplibreRef.current.Marker({
        element: markerElement,
        anchor: "bottom",
      })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(popup)
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    });

    fitToPoints();
  }, [ready, points, fitToPoints]);

  const verifiedCoordinateCount = points.filter(
    (point) =>
      point.coordinateSource === "service-areas" ||
      point.coordinateSource === "verified-catalog",
  ).length;

  return (
    <section className="route-map-preview">
      <header>
        <div>
          <h3>Barangay map preview</h3>
          <p>
            {selectedBarangayCount
              ? `Showing ${points.length} selected Barangay reference marker${points.length === 1 ? "" : "s"}. The location is loaded automatically from Service Areas.`
              : "Select one or more Barangays to preview the coordinates saved in Service Areas."}
          </p>
          {points.length > 0 && verifiedCoordinateCount !== points.length ? (
            <small>
              These are automatic Barangay reference points used only to build the road-route order. Admin does not need to add Purok pins.
            </small>
          ) : null}
        </div>
        <button type="button" onClick={fitToPoints} disabled={!ready}>
          Recenter map
        </button>
      </header>
      <div className="route-map-canvas" ref={containerRef} />
    </section>
  );
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [serviceRegistry, setServiceRegistry] = useState<
    Record<string, ServiceBarangay>
  >({});
  const [purokRegistry, setPurokRegistry] = useState<
    Record<string, Record<string, ServicePurok>>
  >({});
  const [purokLocations, setPurokLocations] = useState<
    Record<string, Record<string, PurokLocationRecord>>
  >({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [form, setForm] = useState<RouteForm>(EMPTY_FORM);
  const [selectedBarangays, setSelectedBarangays] = useState<string[]>([]);
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [routeAreaSearch, setRouteAreaSearch] = useState("");
  const [routeStep, setRouteStep] = useState(0);
  const [routeStepError, setRouteStepError] = useState("");
  const [notice, setNotice] = useState("");
  const routeStepHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const unsubscribeRoutes = onValue(ref(db, "routes"), (snapshot) => {
      const value = snapshot.val() || {};
      setRoutes(
        Object.entries(value)
          .map(([id, raw]) => ({ id, ...(raw as Omit<RouteRecord, "id">) }))
          .sort(
            (left, right) =>
              Number(right.updatedAt || 0) - Number(left.updatedAt || 0),
          ),
      );
    });
    const unsubscribeDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      const value = snapshot.val() || {};
      setDrivers(
        Object.entries(value).map(([id, raw]) => ({
          id,
          ...(raw as Omit<Driver, "id">),
        })),
      );
    });
    const unsubscribeSchedules = onValue(ref(db, "schedules"), (snapshot) => {
      const value = snapshot.val() || {};
      setSchedules(
        Object.entries(value).map(([id, raw]) => ({
          id,
          ...(raw as Omit<ScheduleRecord, "id">),
        })),
      );
    });
    const unsubscribeServiceAreas = onValue(
      ref(db, "service_areas"),
      (snapshot) => setServiceRegistry(snapshot.val() || {}),
    );
    const unsubscribePurokRegistry = onValue(
      ref(db, "purok_registry"),
      (snapshot) => setPurokRegistry(snapshot.val() || {}),
    );
    const unsubscribePurokLocations = onValue(
      ref(db, "purok_locations"),
      (snapshot) => setPurokLocations(snapshot.val() || {}),
    );

    return () => {
      unsubscribeRoutes();
      unsubscribeDrivers();
      unsubscribeSchedules();
      unsubscribeServiceAreas();
      unsubscribePurokRegistry();
      unsubscribePurokLocations();
    };
  }, []);

  const configuredServiceAreas = useMemo<ConfiguredServiceArea[]>(() => {
    const byId = new Map<string, ConfiguredServiceArea>();

    const addArea = (options: {
      rawBarangay: string;
      rawBarangayKey?: string;
      rawPurok: string;
      rawPurokKey?: string;
      psgcCode?: string;
      centerLatitude?: number | string;
      centerLongitude?: number | string;
      coordinateType?: string;
      coordinateSource?: string;
      active?: boolean;
    }) => {
      if (options.active === false) return;

      const barangayCandidate = String(
        options.rawBarangay || options.rawBarangayKey || "",
      )
        .replace(/_/g, " ")
        .trim();
      const official = findOfficialBarangay(barangayCandidate);
      const barangay = official?.name || barangayCandidate;
      if (!barangay) return;

      const barangayKey = makeBarangayKey(barangay);
      const purok = normalizeCatalogPurok(
        options.rawPurok ||
          String(options.rawPurokKey || "").replace(/_/g, " "),
      );
      const purokKey = makePurokKey(purok);
      if (!/^purok_(?:[1-9]|10)$/.test(purokKey)) return;

      const id = `${barangayKey}|${purokKey}`;
      if (byId.has(id)) return;

      const storedLatitude = Number(options.centerLatitude);
      const storedLongitude = Number(options.centerLongitude);
      const hasStoredCoordinates = isValidMapCoordinate(
        storedLatitude,
        storedLongitude,
      );
      const fallbackLatitude = Number(official?.centerLatitude);
      const fallbackLongitude = Number(official?.centerLongitude);
      const hasVerifiedCatalogCoordinate =
        official?.coordinateType === "openstreetmap-locality" &&
        isValidMapCoordinate(fallbackLatitude, fallbackLongitude);
      const storedCoordinateIsVerified =
        options.coordinateType === "openstreetmap-locality";
      const preferVerifiedCatalog =
        hasVerifiedCatalogCoordinate && !storedCoordinateIsVerified;

      const resolvedLatitude = preferVerifiedCatalog
        ? fallbackLatitude
        : hasStoredCoordinates
          ? storedLatitude
          : fallbackLatitude;
      const resolvedLongitude = preferVerifiedCatalog
        ? fallbackLongitude
        : hasStoredCoordinates
          ? storedLongitude
          : fallbackLongitude;
      const coordinateSource: ConfiguredServiceArea["coordinateSource"] =
        preferVerifiedCatalog
          ? "verified-catalog"
          : hasStoredCoordinates
            ? "service-areas"
            : "catalog-fallback";

      byId.set(id, {
        id,
        barangay,
        barangayKey,
        purok,
        purokKey,
        psgcCode: options.psgcCode || official?.psgcCode || "",
        centerLatitude: resolvedLatitude,
        centerLongitude: resolvedLongitude,
        coordinateSource,
      });
    };

    // Primary source: Service Areas. Supports both the current nested shape
    // service_areas/{barangayKey}/puroks/{purokKey} and older flat records.
    Object.entries(serviceRegistry).forEach(([registryKey, rawRecord]) => {
      if (!rawRecord || typeof rawRecord !== "object") return;
      const barangayRecord = rawRecord as ServiceBarangay;
      if (barangayRecord.active === false) return;

      const nestedPuroks = Object.entries(barangayRecord.puroks || {});
      if (nestedPuroks.length) {
        nestedPuroks.forEach(([registryPurokKey, rawPurok]) => {
          if (!rawPurok || typeof rawPurok !== "object") return;
          const purokRecord = rawPurok as ServicePurok;
          addArea({
            rawBarangay: barangayRecord.barangay || registryKey,
            rawBarangayKey: barangayRecord.barangayKey || registryKey,
            rawPurok:
              purokRecord.purok ||
              purokRecord.name ||
              purokRecord.label ||
              registryPurokKey,
            rawPurokKey: purokRecord.purokKey || registryPurokKey,
            psgcCode: barangayRecord.psgcCode,
            centerLatitude:
              barangayRecord.centerLatitude ??
              barangayRecord.latitude ??
              barangayRecord.lat ??
              purokRecord.lat,
            centerLongitude:
              barangayRecord.centerLongitude ??
              barangayRecord.longitude ??
              barangayRecord.lng ??
              purokRecord.lng,
            coordinateType: barangayRecord.coordinateType,
            coordinateSource: barangayRecord.coordinateSource,
            active: purokRecord.active,
          });
        });
        return;
      }

      if (barangayRecord.purok || barangayRecord.purokKey) {
        addArea({
          rawBarangay: barangayRecord.barangay || registryKey,
          rawBarangayKey: barangayRecord.barangayKey || registryKey,
          rawPurok: barangayRecord.purok || barangayRecord.purokKey || "",
          rawPurokKey: barangayRecord.purokKey,
          psgcCode: barangayRecord.psgcCode,
          centerLatitude:
            barangayRecord.centerLatitude ??
            barangayRecord.latitude ??
            barangayRecord.lat,
          centerLongitude:
            barangayRecord.centerLongitude ??
            barangayRecord.longitude ??
            barangayRecord.lng,
          coordinateType: barangayRecord.coordinateType,
          coordinateSource: barangayRecord.coordinateSource,
          active: barangayRecord.active,
        });
      }
    });

    // Compatibility fallback for databases created by earlier MetroWaste patches.
    // Service Areas mirrors configured entries into purok_registry. We only use
    // this source when service_areas itself produced no usable rows.
    if (byId.size === 0) {
      Object.entries(purokRegistry).forEach(([registryBarangayKey, rawPuroks]) => {
        if (!rawPuroks || typeof rawPuroks !== "object") return;
        Object.entries(rawPuroks).forEach(([registryPurokKey, rawPurok]) => {
          if (!rawPurok || typeof rawPurok !== "object") return;
          const purokRecord = rawPurok as ServicePurok;
          addArea({
            rawBarangay:
              findOfficialBarangay(registryBarangayKey.replace(/_/g, " "))
                ?.name || registryBarangayKey.replace(/_/g, " "),
            rawBarangayKey: registryBarangayKey,
            rawPurok:
              purokRecord.purok ||
              purokRecord.name ||
              purokRecord.label ||
              registryPurokKey,
            rawPurokKey: purokRecord.purokKey || registryPurokKey,
            active: purokRecord.active,
          });
        });
      });
    }

    // Last compatibility fallback: configured records mirrored to purok_locations.
    if (byId.size === 0) {
      Object.entries(purokLocations).forEach(
        ([registryBarangayKey, rawPuroks]) => {
          if (!rawPuroks || typeof rawPuroks !== "object") return;
          Object.entries(rawPuroks).forEach(
            ([registryPurokKey, rawPurok]) => {
              if (!rawPurok || typeof rawPurok !== "object") return;
              const purokRecord = rawPurok as PurokLocationRecord;
              if (purokRecord.configured !== true) return;
              addArea({
                rawBarangay:
                  purokRecord.barangay ||
                  findOfficialBarangay(
                    String(
                      purokRecord.barangayKey || registryBarangayKey,
                    ).replace(/_/g, " "),
                  )?.name ||
                  registryBarangayKey.replace(/_/g, " "),
                rawBarangayKey:
                  purokRecord.barangayKey || registryBarangayKey,
                rawPurok: purokRecord.purok || registryPurokKey,
                rawPurokKey: purokRecord.purokKey || registryPurokKey,
                active: purokRecord.active,
              });
            },
          );
        },
      );
    }

    return [...byId.values()].sort(
      (left, right) =>
        left.barangay.localeCompare(right.barangay) ||
        Number(left.purok.match(/\d+/)?.[0] || 0) -
          Number(right.purok.match(/\d+/)?.[0] || 0),
    );
  }, [purokLocations, purokRegistry, serviceRegistry]);

  const configuredBarangays = useMemo<string[]>(() => {
    const names: string[] = configuredServiceAreas.map(
      (area: ConfiguredServiceArea) => area.barangay,
    );
    return Array.from(new Set<string>(names)).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [configuredServiceAreas]);

  const selectedBarangayMapPoints = useMemo<BarangayMapPoint[]>(() => {
    return selectedBarangays.flatMap((barangay) => {
      const barangayKey = makeBarangayKey(barangay);
      const candidates = configuredServiceAreas.filter(
        (area) => area.barangayKey === barangayKey,
      );
      const areaWithStoredCoordinates = candidates.find(
        (area) =>
          area.coordinateSource === "service-areas" &&
          isValidMapCoordinate(area.centerLatitude, area.centerLongitude),
      );
      const areaWithFallbackCoordinates = candidates.find((area) =>
        isValidMapCoordinate(area.centerLatitude, area.centerLongitude),
      );
      const point = areaWithStoredCoordinates || areaWithFallbackCoordinates;
      if (!point) return [];

      return [
        {
          barangay: point.barangay,
          barangayKey: point.barangayKey,
          psgcCode: point.psgcCode,
          latitude: point.centerLatitude,
          longitude: point.centerLongitude,
          coordinateSource: point.coordinateSource,
        },
      ];
    });
  }, [configuredServiceAreas, selectedBarangays]);

  const availableAreasByBarangay = useMemo(() => {
    return selectedBarangays.map((barangay) => {
      const barangayKey = makeBarangayKey(barangay);
      const areas = configuredServiceAreas
        .filter((area) => area.barangayKey === barangayKey)
        .sort((left, right) =>
          Number(left.purok.match(/\d+/)?.[0] || 0) -
          Number(right.purok.match(/\d+/)?.[0] || 0),
        );
      return { barangay, barangayKey, areas };
    });
  }, [configuredServiceAreas, selectedBarangays]);

  const availableAreaIds = useMemo(
    () => availableAreasByBarangay.flatMap((group) => group.areas.map((area) => area.id)),
    [availableAreasByBarangay],
  );

  const selectedServiceAreas = useMemo<ConfiguredServiceArea[]>(() => {
    const configuredById = new Map(
      configuredServiceAreas.map((area) => [area.id, area]),
    );
    return selectedAreaIds
      .map((areaId) => configuredById.get(areaId))
      .filter((area): area is ConfiguredServiceArea => Boolean(area));
  }, [configuredServiceAreas, selectedAreaIds]);

  useEffect(() => {
    if (!configuredBarangays.length) {
      setSelectedBarangays([]);
      return;
    }
    setSelectedBarangays((current) =>
      current.filter((barangay) => configuredBarangays.includes(barangay)),
    );
  }, [configuredBarangays]);

  useEffect(() => {
    setSelectedAreaIds((current) =>
      current.filter((areaId) => availableAreaIds.includes(areaId)),
    );
  }, [availableAreaIds]);

  const activeDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          !["disabled", "inactive", "suspended"].includes(
            String(driver.status || "active").toLowerCase(),
          ),
      ),
    [drivers],
  );

  const visibleConfiguredBarangays = useMemo(() => {
    const query = routeAreaSearch.trim().toLowerCase();
    if (!query) return configuredBarangays;
    return configuredBarangays.filter((barangay) => barangay.toLowerCase().includes(query));
  }, [configuredBarangays, routeAreaSearch]);

  useEffect(() => {
    if (!editorOpen) return;
    routeStepHeadingRef.current?.focus();
    setRouteStepError("");
  }, [editorOpen, routeStep]);

  const filteredRoutes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return routes;
    return routes.filter((route) =>
      [route.routeName, route.assignedDriverName, ...normalizeArray(route.barangays)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [routes, search]);

  const resetEditor = () => {
    setEditingRouteId(null);
    setForm(EMPTY_FORM);
    setSelectedBarangays([]);
    setSelectedAreaIds([]);
    setRouteAreaSearch("");
    setRouteStep(0);
    setRouteStepError("");
    setSaving(false);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    resetEditor();
  };

  const openCreateEditor = () => {
    setNotice("");
    resetEditor();
    setEditorOpen(true);
  };

  const openEditEditor = (route: RouteRecord) => {
    const routeAreas = getRouteAreas(route);
    const routeBarangays = Array.from(
      new Set(
        [
          ...routeAreas.map((area) => area.barangay || ""),
          ...normalizeArray(route.barangays),
          route.barangay || "",
        ].filter(Boolean),
      ),
    );
    const routeAreaIds = routeAreas
      .map((area) =>
        area.areaKey ||
        `${makeBarangayKey(area.barangay || "")}|${makePurokKey(area.purok || "")}`,
      )
      .filter(Boolean);

    setNotice("");
    setEditingRouteId(route.id);
    setForm({
      routeName: route.routeName || "",
      assignedDriverId: route.assignedDriverId || "",
      assignedVehicle: route.assignedVehicle || "",
    });
    setSelectedBarangays(routeBarangays);
    setSelectedAreaIds(routeAreaIds);
    setRouteAreaSearch("");
    setRouteStep(0);
    setRouteStepError("");
    setEditorOpen(true);
  };

  const toggleBarangay = (barangay: string) => {
    setSelectedBarangays((current) =>
      current.includes(barangay)
        ? current.filter((item) => item !== barangay)
        : [...current, barangay],
    );
  };

  const toggleAllBarangays = () => {
    setSelectedBarangays((current) =>
      current.length === configuredBarangays.length
        ? []
        : [...configuredBarangays],
    );
  };

  const toggleArea = (areaId: string) => {
    if (!availableAreaIds.includes(areaId)) return;
    setSelectedAreaIds((current) =>
      current.includes(areaId)
        ? current.filter((id) => id !== areaId)
        : [...current, areaId],
    );
  };

  const toggleAllAreas = () => {
    if (!availableAreaIds.length) return;
    setSelectedAreaIds((current) =>
      current.length === availableAreaIds.length &&
      availableAreaIds.every((id) => current.includes(id))
        ? []
        : [...availableAreaIds],
    );
  };

  const selectedDriver = activeDrivers.find((driver) => driver.id === form.assignedDriverId);
  const hasPurokPerBarangay = selectedBarangays.length > 0 && selectedBarangays.every((barangay) =>
    selectedServiceAreas.some((area) => area.barangayKey === makeBarangayKey(barangay)),
  );
  const routeCanAdvance = [
    selectedBarangays.length > 0,
    selectedServiceAreas.length > 0 && hasPurokPerBarangay,
    Boolean(form.routeName.trim() && selectedDriver),
    selectedBarangayMapPoints.length === selectedBarangays.length && selectedBarangays.length > 0,
    true,
  ];
  const routeAllStepsValid = routeCanAdvance.slice(0, 4).every(Boolean);
  const highestRouteStep = (() => {
    const invalid = routeCanAdvance.slice(0, 4).findIndex((valid) => !valid);
    return invalid === -1 ? 4 : invalid;
  })();
  const nextRouteStep = () => {
    if (!routeCanAdvance[routeStep]) {
      setRouteStepError([
        "Choose at least one Barangay from Service Areas.",
        "Choose at least one Purok for every selected Barangay.",
        "Enter a route name and assign an active driver.",
        "Every selected Barangay needs a valid Service Area map coordinate.",
      ][routeStep] || "Complete the required route information.");
      return;
    }
    setRouteStep((current) => Math.min(current + 1, 4));
  };
  const requestCloseEditor = () => {
    if (saving) return;
    const dirty = Boolean(form.routeName.trim() || form.assignedDriverId || selectedBarangays.length || selectedAreaIds.length);
    if (!dirty || window.confirm("Discard unsaved route changes?")) closeEditor();
  };

  const sendRouteDriverPush = async ({
    driverId,
    title,
    message,
    routeId,
    routeName,
    assignmentRole,
  }: {
    driverId: string;
    title: string;
    message: string;
    routeId: string;
    routeName: string;
    assignmentRole: string;
  }) => {
    if (!driverId) return;
    try {
      const admin = auth.currentUser;
      if (!admin) return;
      const idToken = await admin.getIdToken();
      const response = await fetch("/api/send-alert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title,
          message,
          type: "driver_route_assignment",
          target: "driver",
          targetUid: driverId,
          routeId,
          routeName,
          assignmentRole,
        }),
      });
      if (!response.ok) {
        console.warn("Route saved, but driver push was not confirmed:", await response.text());
      }
    } catch (error) {
      console.warn("Route saved, but driver push failed:", error);
    }
  };

  const saveRoute = async () => {
    const routeName = form.routeName.trim();
    const driver = activeDrivers.find(
      (item) => item.id === form.assignedDriverId,
    );

    if (!routeName) return alert("Enter a route name.");
    if (!selectedBarangays.length) {
      return alert("Select at least one Barangay for this route.");
    }
    if (!selectedAreaIds.length) {
      return alert("Select at least one Barangay/Purok service area for route coverage.");
    }
    if (!driver) return alert("Assign an active driver.");
    if (!selectedServiceAreas.length) {
      return alert("Unable to build the selected route coverage from Service Areas.");
    }
    const uncoveredBarangays = selectedBarangays.filter((barangay) =>
      !selectedServiceAreas.some((area) => area.barangayKey === makeBarangayKey(barangay)),
    );
    if (uncoveredBarangays.length) {
      return alert(`Select at least one Purok for each Barangay. Missing: ${uncoveredBarangays.join(", ")}.`);
    }

    const areas = selectedServiceAreas.map((area, order) => ({
      areaKey: area.id,
      barangay: area.barangay,
      barangayKey: area.barangayKey,
      purok: area.purok,
      purokKey: area.purokKey,
      order,
    }));
    const barangays: string[] = Array.from(
      new Set(areas.map((area) => area.barangay).filter(Boolean)),
    );
    const puroks: string[] = Array.from(
      new Set(areas.map((area) => area.purok).filter(Boolean)),
    );
    const mapPointByBarangayKey = new Map(
      selectedBarangayMapPoints.map((point) => [point.barangayKey, point]),
    );
    const missingCoordinateBarangays = barangays.filter(
      (barangay) => !mapPointByBarangayKey.has(makeBarangayKey(barangay)),
    );
    if (missingCoordinateBarangays.length) {
      return alert(
        `Missing Service Area coordinates for: ${missingCoordinateBarangays.join(
          ", ",
        )}. Open Service Areas and re-add or update these Barangays first.`,
      );
    }

    const barangayDestinations = barangays.map((barangay, order) => {
      const barangayKey = makeBarangayKey(barangay);
      const point = mapPointByBarangayKey.get(barangayKey)!;
      const official = findOfficialBarangay(barangay);
      return {
        barangay: point.barangay,
        barangayKey: point.barangayKey,
        psgcCode: point.psgcCode,
        latitude: point.latitude,
        longitude: point.longitude,
        order,
        coordinateType:
          official?.coordinateType || "service-area-barangay-reference",
        coordinateSource:
          point.coordinateSource === "service-areas"
            ? "service_areas"
            : official?.coordinateSource || CATBALOGAN_BOUNDARY_SOURCE,
      };
    });
    const existing = editingRouteId
      ? routes.find((route) => route.id === editingRouteId)
      : undefined;
    const routeReference = editingRouteId
      ? ref(db, `routes/${editingRouteId}`)
      : push(ref(db, "routes"));
    const routeId = editingRouteId || routeReference.key;
    if (!routeId) return alert("Unable to create a route ID.");

    const now = Date.now();
    const vehicle = form.assignedVehicle.trim() || driver.truck || "";
    const coverageByBarangay = Object.fromEntries(
      barangays.map((barangay) => {
        const barangayKey = makeBarangayKey(barangay);
        const barangayAreas = areas.filter(
          (area) => area.barangayKey === barangayKey,
        );
        return [barangayKey, {
          barangay,
          barangayKey,
          puroks: barangayAreas.map((area) => area.purok).filter(Boolean),
          purokKeys: barangayAreas.map((area) => area.purokKey).filter(Boolean),
          areas: barangayAreas,
        }];
      }),
    );
    const payload = {
      routeName,
      barangay: barangays[0],
      barangayKey: makeBarangayKey(barangays[0]),
      barangays,
      barangayKeys: barangays.map(makeBarangayKey),
      puroks,
      purokKeys: puroks.map(makePurokKey),
      areas,
      coverageByBarangay,
      barangayDestinations,
      checkpoints: [],
      assignedDriverId: driver.id,
      assignedDriverName: driver.name || "Driver",
      assignedVehicle: vehicle,
      routeModel: "service-area-live-gps",
      routeType: "service-area-route",
      trackingMode: "live-gps",
      navigationMode: "api-gps-road-route",
      requiresDrawnPath: false,
      requiresManualPins: false,
      manualPurokPinsRequired: false,
      manualRoadPathRequired: false,
      coverageOnly: true,
      roadPointOnly: false,
      servicePinMode: "disabled",
      verified: true,
      routeValidation: {
        status: "verified",
        method: "admin-confirmed-coverage-auto-road",
        verifiedBy: auth.currentUser?.uid || "admin",
        verifiedAt: now,
        coordinateCount: 0,
        roadPointCount: 0,
        serviceStopCount: 0,
        barangayPinCount: barangayDestinations.length,
        coverageAreaCount: areas.length,
      },
      status: "ready",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const rootUpdates: Record<string, unknown> = {
      [`routes/${routeId}`]: payload,
      [`drivers/${driver.id}/assignedRouteId`]: routeId,
      [`drivers/${driver.id}/assignedRouteName`]: routeName,
      [`drivers/${driver.id}/assignedVehicle`]: vehicle,
    };

    barangays.forEach((barangay) => {
      const barangayKey = makeBarangayKey(barangay);
      const barangayAreas = areas.filter(
        (area) => area.barangayKey === barangayKey,
      );
      rootUpdates[`barangay_assignments/${barangayKey}/${routeId}`] = {
        routeId,
        routeName,
        driverId: driver.id,
        driverName: driver.name || "Driver",
        assignedVehicle: vehicle,
        barangay,
        barangayKey,
        areas: barangayAreas,
        destination: barangayDestinations.find(
          (destination) => destination.barangayKey === barangayKey,
        ),
        puroks: barangayAreas.map((area) => area.purok).filter(Boolean),
        coverageOnly: true,
        verified: true,
        updatedAt: now,
      };
    });

    if (existing?.assignedDriverId && existing.assignedDriverId !== driver.id) {
      rootUpdates[`drivers/${existing.assignedDriverId}/assignedRouteId`] = null;
      rootUpdates[`drivers/${existing.assignedDriverId}/assignedRouteName`] = null;
    }
    normalizeArray(existing?.barangays).forEach((barangay) => {
      if (!barangays.includes(barangay)) {
        rootUpdates[
          `barangay_assignments/${makeBarangayKey(barangay)}/${routeId}`
        ] = null;
      }
    });

    try {
      setSaving(true);
      await update(ref(db), rootUpdates);

      const coverageLabel = barangays
        .map((barangay) => {
          const barangayKey = makeBarangayKey(barangay);
          const barangayAreas = areas.filter((area) => area.barangayKey === barangayKey);
          return `${barangay}: ${barangayAreas.map((area) => area.purok).filter(Boolean).join(", ")}`;
        })
        .join(" • ");

      await sendRouteDriverPush({
        driverId: driver.id,
        title: existing ? "Route assignment updated" : "New route assigned",
        message: `${routeName}. Coverage: ${coverageLabel}. Truck: ${vehicle || "not recorded"}. Collection days and times will follow the active schedule assigned by Admin.`,
        routeId,
        routeName,
        assignmentRole: "regular_route_driver",
      });

      if (existing?.assignedDriverId && existing.assignedDriverId !== driver.id) {
        await sendRouteDriverPush({
          driverId: existing.assignedDriverId,
          title: "Route assignment changed",
          message: `You are no longer the regular driver assigned to ${existing.routeName || routeName}.`,
          routeId,
          routeName: existing.routeName || routeName,
          assignmentRole: "previous_route_driver",
        });
      }

      setNotice(
        "Route saved and ready for scheduling. The assigned driver was notified; live GPS still follows the active schedule through /api/gps.",
      );
      closeEditor();
    } catch (error) {
      console.error(error);
      alert(
        "Unable to save the route assignment. Check Firebase permissions and try again.",
      );
      setSaving(false);
    }
  };

  const deleteRoute = async (route: RouteRecord) => {
    const used = schedules.some(
      (schedule) =>
        (schedule.routeId || schedule.assignedRouteId) === route.id &&
        String(schedule.status || "active").toLowerCase() !== "cancelled",
    );
    if (used) {
      return alert(
        "This route is used by an active schedule. Reassign or cancel that schedule first.",
      );
    }
    if (!window.confirm(`Delete “${route.routeName || "this route"}”?`)) return;

    const updates: Record<string, unknown> = {
      [`routes/${route.id}`]: null,
    };
    if (route.assignedDriverId) {
      updates[`drivers/${route.assignedDriverId}/assignedRouteId`] = null;
      updates[`drivers/${route.assignedDriverId}/assignedRouteName`] = null;
    }
    normalizeArray(route.barangays).forEach((barangay) => {
      updates[
        `barangay_assignments/${makeBarangayKey(barangay)}/${route.id}`
      ] = null;
    });

    await update(ref(db), updates);
    setNotice("Route assignment deleted.");
  };

  return (
    <DashboardShell title={""} description={""}>
      <section className={styles.workspace} aria-labelledby="route-page-title">
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Collection operations</p>
            <h1 id="route-page-title">Routes & assignments</h1>
            <p className={styles.subtitle}>
              Build verified Barangay/Purok coverage, assign a regular driver and truck,
              and keep each route ready for scheduling and live GPS collection.
            </p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={openCreateEditor}>
            <ScheduleIcon name="plus" size={18} /> Create route
          </button>
        </div>

        {notice ? (
          <div className={styles.successNotice} role="status">
            <ScheduleIcon name="check" size={18} />
            <span>{notice}</span>
            <button type="button" className={styles.iconButton} aria-label="Dismiss confirmation" onClick={() => setNotice("")}>
              <ScheduleIcon name="close" size={18} />
            </button>
          </div>
        ) : null}

        <section className={styles.metrics} aria-label="Route overview">
          <div className={styles.metric}>
            <div className={styles.metricHeading}><span>Total routes</span><ScheduleIcon name="route" size={18} /></div>
            <strong className={styles.metricValue}>{routes.length}</strong>
            <span className={styles.metricCaption}>Saved route assignments</span>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricHeading}><span>Ready</span><ScheduleIcon name="check" size={18} /></div>
            <strong className={styles.metricValue}>{routes.filter(isAssignmentReady).length}</strong>
            <span className={styles.metricCaption}>Verified and driver-assigned</span>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricHeading}><span>Needs review</span><ScheduleIcon name="info" size={18} /></div>
            <strong className={styles.metricValue}>{routes.filter((route) => !isAssignmentReady(route)).length}</strong>
            <span className={styles.metricCaption}>Incomplete or inactive routes</span>
          </div>
          <div className={styles.metric}>
            <div className={styles.metricHeading}><span>Service Barangays</span><ScheduleIcon name="pin" size={18} /></div>
            <strong className={styles.metricValue}>{configuredBarangays.length}</strong>
            <span className={styles.metricCaption}>Available from Service Areas</span>
          </div>
        </section>

        <section className={styles.registry} aria-labelledby="route-registry-title">
          <div className={styles.registryIntro}>
            <div>
              <h2 id="route-registry-title">Route registry</h2>
              <p>Select a route to review its exact Purok coverage and regular assignment.</p>
            </div>
            <span className={styles.recordCount}>{filteredRoutes.length} of {routes.length}</span>
          </div>
          <div className={styles.registryTools}>
            <div />
            <label className={styles.searchField}>
              <ScheduleIcon name="search" size={18} />
              <span className={styles.srOnly}>Search routes</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search route, Barangay, or driver" />
            </label>
          </div>

          {filteredRoutes.length ? (
            <div className={styles.scheduleList}>
              {filteredRoutes.map((route) => {
                const areas = getRouteAreas(route);
                const groups = groupRouteAreasByBarangay(route);
                const barangays = groups.map((group) => group.barangay);
                const ready = isAssignmentReady(route);
                return (
                  <details className={styles.scheduleRow} key={route.id}>
                    <summary className={styles.scheduleSummary}>
                      <span className={styles.rowIcon}><ScheduleIcon name="route" /></span>
                      <span className={styles.rowIdentity}>
                        <strong>{route.routeName || "Unnamed route"}</strong>
                        <span>{barangays.join(" · ") || normalizeArray(route.barangays).join(" · ") || route.barangay || "Coverage not recorded"}</span>
                      </span>
                      <span className={styles.rowWhen}>
                        <strong>{areas.length} Purok area{areas.length === 1 ? "" : "s"}</strong>
                        <span>{route.assignedDriverName || "Driver not assigned"}{route.assignedVehicle ? ` · ${route.assignedVehicle}` : ""}</span>
                      </span>
                      <span className={styles.rowState}>
                        <span className={styles.statusBadge} data-active={ready}>
                          <span aria-hidden="true" />{ready ? "Ready" : "Needs review"}
                        </span>
                      </span>
                      <ScheduleIcon name="chevron" size={17} className={styles.rowChevron} />
                    </summary>
                    <div className={styles.scheduleDetail}>
                      <div className={styles.detailColumns}>
                        <section className={styles.detailSection} aria-label="Route coverage">
                          <h3><ScheduleIcon name="pin" size={17} /> Master route coverage</h3>
                          <div className={styles.coverageList}>
                            {groups.length ? groups.map((group) => (
                              <div className={styles.coverageRow} key={group.barangay}>
                                <strong>{group.barangay}</strong>
                                <span>{group.puroks.join(", ") || "Purok details not recorded"}</span>
                              </div>
                            )) : <p className={styles.subtitle}>No Barangay/Purok coverage recorded.</p>}
                          </div>
                        </section>
                        <section className={styles.detailSection} aria-label="Route assignment">
                          <h3><ScheduleIcon name="users" size={17} /> Regular assignment</h3>
                          <dl className={styles.facts}>
                            <div><dt>Driver</dt><dd>{route.assignedDriverName || "Not assigned"}</dd></div>
                            <div><dt>Truck / plate</dt><dd>{route.assignedVehicle || "Not recorded"}</dd></div>
                            <div><dt>Validation</dt><dd>{route.routeValidation?.status || "Not verified"}</dd></div>
                            <div><dt>Updated</dt><dd>{formatDate(route.updatedAt || route.createdAt)}</dd></div>
                          </dl>
                        </section>
                      </div>
                      <div className={styles.detailActions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => openEditEditor(route)}>
                          <ScheduleIcon name="route" size={17} /> Edit route
                        </button>
                        <button type="button" className={styles.dangerButton} onClick={() => void deleteRoute(route)}>
                          <ScheduleIcon name="trash" size={17} /> Delete route
                        </button>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <ScheduleIcon name="route" size={28} />
              <h3>{routes.length ? "No matching routes" : "No routes yet"}</h3>
              <p>{routes.length ? "Change the search to see other route assignments." : "Create a verified route before building a collection schedule."}</p>
              {routes.length ? <button type="button" className={styles.secondaryButton} onClick={() => setSearch("")}>Clear search</button> : null}
            </div>
          )}
          <div className={styles.registryFootnote}>
            <ScheduleIcon name="info" size={16} />
            <span>Routes are master coverage templates. Schedule-specific Purok selections are saved separately in the Schedule planner.</span>
          </div>
        </section>
      </section>

      {editorOpen ? (
        <ScheduleDialog fullScreen labelledBy="route-planner-title" busy={saving} onDismiss={requestCloseEditor}>
          <header className={styles.dialogHeader}>
            <div className={styles.dialogTitleGroup}>
              <span className={styles.brandMark}><ScheduleIcon name="route" size={22} /></span>
              <div>
                <span className={styles.eyebrow}>MetroWaste · Route planner</span>
                <h2 id="route-planner-title" data-dialog-heading tabIndex={-1}>{editingRouteId ? "Edit route assignment" : "Create a route assignment"}</h2>
              </div>
            </div>
            <button type="button" className={styles.iconButton} aria-label="Close route planner" disabled={saving} onClick={requestCloseEditor}>
              <ScheduleIcon name="close" />
            </button>
          </header>

          <div className={styles.plannerLayout}>
            <aside className={styles.plannerSidebar} aria-label="Route creation steps">
              <p className={styles.sidebarCaption}>Route setup</p>
              <ol className={styles.stepNav}>
                {ROUTE_STEPS.map((item, index) => (
                  <li key={item.label}>
                    <button type="button" className={styles.stepNavButton} aria-current={routeStep === index ? "step" : undefined}
                      disabled={saving || index > highestRouteStep} onClick={() => setRouteStep(index)}>
                      <span className={styles.stepNumber} data-complete={index < routeStep && routeCanAdvance[index]}>
                        {index < routeStep && routeCanAdvance[index] ? <ScheduleIcon name="check" size={16} /> : index + 1}
                      </span>
                      <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className={styles.sidebarNote}><ScheduleIcon name="info" size={18} />
                <p>The master route defines allowed Barangay/Purok coverage. Individual schedules can use a subset of these Puroks.</p>
              </div>
            </aside>

            <div className={styles.plannerScroll} key={routeStep}>
              <div className={styles.stepContent}>
                <div className={styles.stepTitle}>
                  <span className={styles.stepCounter}>Step {routeStep + 1} of {ROUTE_STEPS.length}</span>
                  <h2 ref={routeStepHeadingRef} tabIndex={-1}>{[
                    "Which Barangays belong to this route?",
                    "Which Puroks can this route serve?",
                    "Who is responsible for this route?",
                    "Are the Barangay destinations ready?",
                    "Does the route look correct?",
                  ][routeStep]}</h2>
                  <p>{[
                    "Choose one or more active Barangays from Service Areas.",
                    "Choose the exact Puroks allowed on this master route. Every selected Barangay needs at least one Purok.",
                    "Give the route a clear name, assign its regular driver, and confirm the truck or plate number.",
                    "Verify the automatic Barangay reference points used by the Driver map. No manual Purok pins are required.",
                    "Review master coverage and assignment before saving it for use by the Schedule planner.",
                  ][routeStep]}</p>
                </div>

                {routeStepError ? <div className={styles.errorNotice} role="alert"><ScheduleIcon name="info" size={18} />{routeStepError}</div> : null}

                <fieldset className={styles.formFields} disabled={saving}>
                  <legend className={styles.srOnly}>{ROUTE_STEPS[routeStep].label}</legend>

                  {routeStep === 0 ? <>
                    <label className={styles.searchField}>
                      <ScheduleIcon name="search" size={18} /><span className={styles.srOnly}>Find a Barangay</span>
                      <input type="search" value={routeAreaSearch} onChange={(event) => setRouteAreaSearch(event.target.value)} placeholder="Find a Barangay…" />
                    </label>
                    <div className={styles.selectionCaption}>
                      <span><strong>{selectedBarangays.length}</strong> Barangay{selectedBarangays.length === 1 ? "" : "s"} selected</span>
                      <button type="button" className={styles.textButton} disabled={!configuredBarangays.length} onClick={toggleAllBarangays}>
                        {selectedBarangays.length === configuredBarangays.length && configuredBarangays.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    <div className={styles.areaChoices}>
                      {visibleConfiguredBarangays.map((barangay) => {
                        const checked = selectedBarangays.includes(barangay);
                        return <label className={styles.choice} data-selected={checked} key={barangay}>
                          <input type="checkbox" checked={checked} onChange={() => toggleBarangay(barangay)} />
                          <span><strong>{barangay}</strong><small>Active Service Area</small></span>
                        </label>;
                      })}
                    </div>
                    {!visibleConfiguredBarangays.length ? <div className={styles.helpNotice}>
                      {configuredBarangays.length ? "No Barangay matches that search." : "No active Barangays/Puroks are configured in Service Areas."}
                    </div> : null}
                    {selectedBarangays.length ? <div className={styles.selectionReview}>
                      <strong>Selected Barangays</strong><p>{selectedBarangays.join(" · ")}</p>
                      <span>Continue to choose exact Purok coverage.</span>
                    </div> : null}
                  </> : null}

                  {routeStep === 1 ? <>
                    <div className={styles.contextLine}><ScheduleIcon name="pin" size={17} /><span>{selectedBarangays.join(" · ")}</span>
                      <button type="button" className={styles.textButton} onClick={() => setRouteStep(0)}>Change Barangays</button>
                    </div>
                    <div className={styles.selectionCaption}>
                      <span><strong>{selectedServiceAreas.length}</strong> Purok area{selectedServiceAreas.length === 1 ? "" : "s"} selected</span>
                      <button type="button" className={styles.textButton} disabled={!availableAreaIds.length} onClick={toggleAllAreas}>
                        {availableAreaIds.length > 0 && selectedAreaIds.length === availableAreaIds.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    <div className={styles.coverageEditor}>
                      {availableAreasByBarangay.map((group) => {
                        const selectedCount = group.areas.filter((area) => selectedAreaIds.includes(area.id)).length;
                        const allSelected = group.areas.length > 0 && selectedCount === group.areas.length;
                        return <section className={styles.coverageEditorGroup} key={group.barangayKey}>
                          <div className={styles.coverageEditorHead}>
                            <div><strong>{group.barangay}</strong><small>{selectedCount} of {group.areas.length} active Puroks selected</small></div>
                            <button type="button" className={styles.textButton} onClick={() => {
                              const ids = group.areas.map((area) => area.id);
                              setSelectedAreaIds((current) => {
                                const withoutGroup = current.filter((id) => !ids.includes(id));
                                return allSelected ? withoutGroup : [...withoutGroup, ...ids];
                              });
                            }}>{allSelected ? "Clear Barangay" : "Select Barangay"}</button>
                          </div>
                          <div className={styles.purokChoices}>
                            {group.areas.map((area) => {
                              const checked = selectedAreaIds.includes(area.id);
                              return <label className={styles.purokChoice} data-selected={checked} key={area.id}>
                                <input type="checkbox" checked={checked} onChange={() => toggleArea(area.id)} />
                                <span><strong>{area.purok}</strong><small>{group.barangay}</small></span>
                              </label>;
                            })}
                          </div>
                        </section>;
                      })}
                    </div>
                    <div className={styles.helpNotice}><ScheduleIcon name="info" size={20} /><div><strong>Source: Service Areas</strong>
                      <p>Routes do not create new Barangays or Puroks. Add or activate missing areas in Service Areas first.</p></div>
                    </div>
                  </> : null}

                  {routeStep === 2 ? <>
                    <div className={styles.contextLine}><ScheduleIcon name="route" size={17} /><span>{selectedBarangays.length} Barangay{selectedBarangays.length === 1 ? "" : "s"} · {selectedServiceAreas.length} Purok area{selectedServiceAreas.length === 1 ? "" : "s"}</span>
                      <button type="button" className={styles.textButton} onClick={() => setRouteStep(1)}>Change coverage</button>
                    </div>
                    <label className={styles.field}><span>Route name</span>
                      <input value={form.routeName} onChange={(event) => setForm((current) => ({ ...current, routeName: event.target.value }))} placeholder="Example: Bunuanan North Collection Route" />
                      <small>Use a clear operational name that admins and drivers can recognize.</small>
                    </label>
                    <div className={styles.twoFields}>
                      <label className={styles.field}><span>Regular driver</span>
                        <select value={form.assignedDriverId} onChange={(event) => {
                          const driver = activeDrivers.find((item) => item.id === event.target.value);
                          setForm((current) => ({ ...current, assignedDriverId: event.target.value, assignedVehicle: current.assignedVehicle || driver?.truck || "" }));
                        }}>
                          <option value="">Choose an active driver</option>
                          {activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name || driver.id}</option>)}
                        </select>
                        <small>This is the route default. A Schedule still saves its own assigned driver.</small>
                      </label>
                      <label className={styles.field}><span>Truck / plate <small>Optional if driver has a saved truck</small></span>
                        <input value={form.assignedVehicle} onChange={(event) => setForm((current) => ({ ...current, assignedVehicle: event.target.value }))} placeholder={selectedDriver?.truck || "Enter truck / plate"} />
                        <small>{selectedDriver?.truck ? `Driver profile truck: ${selectedDriver.truck}` : "Confirm the collection vehicle."}</small>
                      </label>
                    </div>
                    <div className={styles.neutralNotice}><ScheduleIcon name="users" size={20} /><p>Schedules created from this route remain authoritative for the Driver App: each schedule saves routeId, assignedDriverId, truckId, and its actual Purok areas.</p></div>
                  </> : null}

                  {routeStep === 3 ? <>
                    <div className={styles.contextLine}><ScheduleIcon name="pin" size={17} /><span>{selectedBarangays.length} Barangay destination{selectedBarangays.length === 1 ? "" : "s"}</span>
                      <button type="button" className={styles.textButton} onClick={() => setRouteStep(0)}>Change areas</button>
                    </div>
                    <div className="route-step-map">
                      <RouteMapPreview points={selectedBarangayMapPoints} selectedBarangayCount={selectedBarangays.length} />
                    </div>
                    {selectedBarangayMapPoints.length !== selectedBarangays.length ? <div className={styles.errorNotice} role="alert">
                      <ScheduleIcon name="info" size={18} />Some selected Barangays do not have valid coordinates. Update those Service Areas before saving this route.
                    </div> : <div className={styles.helpNotice}><ScheduleIcon name="check" size={20} /><div><strong>Destinations ready</strong><p>The Driver map can resolve the selected Barangay destinations. Purok pins are intentionally not required.</p></div></div>}
                  </> : null}

                  {routeStep === 4 ? <>
                    <div className={styles.reviewTitle}><ScheduleIcon name="route" size={25} />
                      <div><strong>{form.routeName.trim() || "Unnamed route"}</strong><span>Verified service-area route</span></div>
                    </div>
                    <section className={styles.reviewSection}>
                      <div className={styles.reviewHeading}><h3>Master coverage</h3><button type="button" className={styles.textButton} onClick={() => setRouteStep(1)}>Change</button></div>
                      <div className={styles.coverageList}>
                        {selectedBarangays.map((barangay) => {
                          const areas = selectedServiceAreas.filter((area) => area.barangayKey === makeBarangayKey(barangay));
                          return <div className={styles.coverageRow} key={barangay}><strong>{barangay}</strong><span>{areas.map((area) => area.purok).join(", ") || "No Purok selected"}</span></div>;
                        })}
                      </div>
                    </section>
                    <section className={styles.reviewSection}>
                      <div className={styles.reviewHeading}><h3>Regular assignment</h3><button type="button" className={styles.textButton} onClick={() => setRouteStep(2)}>Change</button></div>
                      <dl className={styles.facts}>
                        <div><dt>Driver</dt><dd>{selectedDriver?.name || "Not selected"}</dd></div>
                        <div><dt>Truck / plate</dt><dd>{form.assignedVehicle.trim() || selectedDriver?.truck || "Not recorded"}</dd></div>
                        <div><dt>Barangays</dt><dd>{selectedBarangays.length}</dd></div>
                        <div><dt>Purok areas</dt><dd>{selectedServiceAreas.length}</dd></div>
                        <div><dt>Tracking</dt><dd>Live GPS · service-area route</dd></div>
                      </dl>
                    </section>
                    <div className={styles.neutralNotice}><ScheduleIcon name="info" size={20} /><p>Saving updates the master route and Barangay assignments. Existing Schedule records keep their saved schedule-specific Purok coverage and driver assignment.</p></div>
                    {!routeAllStepsValid ? <div className={styles.errorNotice} role="alert">An earlier route selection changed. Review the previous steps before saving.</div> : null}
                  </> : null}
                </fieldset>
              </div>
            </div>
          </div>

          <footer className={styles.plannerFooter}>
            <span className={styles.footerProgress}>Step {routeStep + 1} of {ROUTE_STEPS.length} · {ROUTE_STEPS[routeStep].label}</span>
            <div className={styles.footerActions}>
              <button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => routeStep === 0 ? requestCloseEditor() : setRouteStep((current) => current - 1)}>
                {routeStep > 0 ? <ScheduleIcon name="arrowLeft" size={17} /> : null}{routeStep === 0 ? "Cancel" : "Back"}
              </button>
              {routeStep < 4 ? <button type="button" className={styles.primaryButton} disabled={saving} onClick={nextRouteStep}>Continue<ScheduleIcon name="arrowRight" size={17} /></button>
                : <button type="button" className={styles.primaryButton} disabled={saving || !routeAllStepsValid} onClick={() => void saveRoute()}>
                  {saving ? <span className={styles.spinner} aria-hidden="true" /> : <ScheduleIcon name="check" size={17} />}
                  {saving ? "Saving route…" : editingRouteId ? "Save route changes" : "Confirm & create"}
                </button>}
            </div>
          </footer>
        </ScheduleDialog>
      ) : null}

      <style jsx global>{`
        .route-step-map { min-height: 470px; }
        .route-step-map .route-map-preview { min-height: 470px; height: 470px; }
        .route-map-preview { min-width: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(0,1fr); border: 1px solid #dfe6e2; border-radius: 10px; background: #fff; }
        .route-map-preview > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 18px; background: #fff; }
        .route-map-preview h3, .route-map-preview p { margin: 0; }
        .route-map-preview h3 { color: #29483a; font-size: 15px; font-weight: 650; }
        .route-map-preview p { margin-top: 5px; color: #607068; font-size: 12px; line-height: 1.55; }
        .route-map-preview small { display: block; margin-top: 6px; color: #7a8b80; font-size: 10px; }
        .route-map-preview > header > button { min-height: 38px; flex: 0 0 auto; border: 1px solid #cfdad3; border-radius: 8px; padding: 0 12px; background: #fff; color: #29483a; font-size: 12px; font-weight: 600; cursor: pointer; }
        .route-map-preview > header > button:disabled { opacity: .5; cursor: not-allowed; }
        .route-map-canvas { width: 100%; height: 100%; min-height: 330px; border-top: 1px solid #e4ebe6; background: #edf3ef; }
        .route-preview-marker { position: relative; width: 30px; height: 30px; display: grid; place-items: center; border: 3px solid #fff; border-radius: 50%; background: #2868df; color: #fff; box-shadow: 0 3px 10px rgba(18,55,122,.34); cursor: pointer; }
        .route-preview-marker::after { content: ""; position: absolute; left: 50%; bottom: -7px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #2868df; transform: translateX(-50%); }
        .route-preview-marker--primary { background: #18a85c; box-shadow: 0 3px 10px rgba(16,113,61,.34); }
        .route-preview-marker--primary::after { border-top-color: #18a85c; }
        .route-preview-marker span { position: relative; z-index: 1; font-size: 10px; font-weight: 900; line-height: 1; }
        .route-map-preview .maplibregl-ctrl-top-left { top: 8px; left: 8px; }
        .route-map-preview .maplibregl-ctrl-group { overflow: hidden; border-radius: 7px; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
        @media (max-width: 800px) { .route-step-map, .route-step-map .route-map-preview { min-height: 390px; height: 390px; } }
        @media (max-width: 520px) {
          .route-map-preview > header { flex-direction: column; align-items: stretch; }
          .route-map-preview > header > button { width: fit-content; }
          .route-step-map, .route-step-map .route-map-preview { min-height: 340px; height: 340px; }
          .route-map-canvas { min-height: 250px; }
        }
      `}</style>
    </DashboardShell>
  );
}
