"use client";

import { onValue, push, ref, update } from "@/lib/offlineFirebaseDatabase";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
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

  const serviceCoordinateCount = points.filter(
    (point) => point.coordinateSource === "service-areas",
  ).length;
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
  const [barangayMenuOpen, setBarangayMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const barangayPickerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        barangayPickerRef.current &&
        !barangayPickerRef.current.contains(target)
      ) {
        setBarangayMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

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
    setBarangayMenuOpen(false);
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
    setBarangayMenuOpen(false);
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
      setNotice(
        "Route assignment saved. The Driver will follow an automatic road route from live phone GPS through /api/gps; no manual Purok pins are required.",
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
    <DashboardShell
      title="Routes & Assignments"
      description="Assign a driver and truck to selected Barangays and Puroks. No map points are required."
    >
      <main className="route-page">
        {notice ? (
          <div className="notice">
            <span>✓ {notice}</span>
            <button type="button" onClick={() => setNotice("")}>×</button>
          </div>
        ) : null}

        <section className="route-summary">
          <div><span>Total assignments</span><strong>{routes.length}</strong></div>
          <div><span>Ready</span><strong>{routes.filter(isAssignmentReady).length}</strong></div>
          <div><span>Needs review</span><strong>{routes.filter((route) => !isAssignmentReady(route)).length}</strong></div>
        </section>

        <section className="route-card">
          <header className="toolbar">
            <div>
              <h2>Route assignments</h2>
              <p>Coverage is based only on the selected Barangays and Puroks.</p>
            </div>
            <div className="toolbar-actions">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search route or driver"
              />
              <button className="primary" type="button" onClick={openCreateEditor}>
                ＋ Create assignment
              </button>
            </div>
          </header>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Coverage</th>
                  <th>Driver / truck</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRoutes.length ? (
                  filteredRoutes.map((route) => {
                    const areas = getRouteAreas(route);
                    return (
                      <tr key={route.id}>
                        <td><strong>{route.routeName || "Unnamed assignment"}</strong><small>{route.id}</small></td>
                        <td><span>{areas.length} Barangay/Purok area{areas.length === 1 ? "" : "s"}</span><small>{normalizeArray(route.barangays).join(" • ") || route.barangay || "No coverage"}</small></td>
                        <td><strong>{route.assignedDriverName || "Unassigned"}</strong><small>{route.assignedVehicle || "No truck"}</small></td>
                        <td><span className={isAssignmentReady(route) ? "status ready" : "status review"}>{isAssignmentReady(route) ? "Ready" : "Needs review"}</span></td>
                        <td>{formatDate(route.updatedAt || route.createdAt)}</td>
                        <td><div className="row-actions"><button type="button" onClick={() => openEditEditor(route)}>Edit</button><button type="button" className="danger" onClick={() => void deleteRoute(route)}>Delete</button></div></td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={6} className="empty">No route assignments found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {editorOpen ? (
          <div
            className="modal"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeEditor();
            }}
          >
            <section
              className="editor"
              role="dialog"
              aria-modal="true"
              aria-label="Route assignment editor"
            >
              <header className="editor-head">
                <div>
                  <span>{editingRouteId ? "EDIT ROUTE" : "NEW ROUTE"}</span>
                  <h2>
                    {editingRouteId
                      ? "Edit service area route"
                      : "Create service area route"}
                  </h2>
                  <p>
                    Barangays and Puroks load directly from Service Areas. Select
                    the coverage, assign a driver, then verify it on the larger map.
                  </p>
                </div>
                <button
                  className="editor-close"
                  type="button"
                  onClick={closeEditor}
                  aria-label="Close route editor"
                >
                  ×
                </button>
              </header>

              <div className="editor-body">
                <div className="editor-form-column">
                  <div className="assignment-grid">
                  <label className="field route-name-field">
                    <span>Route name</span>
                    <input
                      value={form.routeName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          routeName: event.target.value,
                        }))
                      }
                      placeholder="Example: Canlapwas Purok 1–5"
                    />
                  </label>

                  <div className="field barangay-field">
                    <span>Barangays</span>
                    <div className="barangay-picker" ref={barangayPickerRef}>
                      <button
                        className="picker-trigger"
                        type="button"
                        onClick={() =>
                          setBarangayMenuOpen((current) => !current)
                        }
                        aria-expanded={barangayMenuOpen}
                        disabled={!configuredBarangays.length}
                      >
                        <strong>
                          {selectedBarangays.length
                            ? `${selectedBarangays.length} Barangay${selectedBarangays.length === 1 ? "" : "s"} selected`
                            : configuredBarangays.length
                              ? "Select Barangays"
                              : "No active Service Areas"}
                        </strong>
                        <span className="picker-meta">
                          {selectedBarangays.length ? (
                            <b>{selectedBarangays.length}</b>
                          ) : null}
                          <i>{barangayMenuOpen ? "⌃" : "⌄"}</i>
                        </span>
                      </button>

                      {selectedBarangays.length ? (
                        <div className="barangay-chips">
                          {selectedBarangays.map((barangay) => (
                            <button
                              type="button"
                              key={barangay}
                              onClick={() => toggleBarangay(barangay)}
                              title={`Remove ${barangay}`}
                            >
                              {barangay} <span>×</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {barangayMenuOpen ? (
                        <div className="barangay-menu">
                          <div className="barangay-menu-head">
                            <span>{configuredBarangays.length} from Service Areas</span>
                            <button type="button" onClick={toggleAllBarangays}>
                              {selectedBarangays.length === configuredBarangays.length
                                ? "Clear all"
                                : "Select all"}
                            </button>
                          </div>
                          <div className="barangay-options">
                            {configuredBarangays.map((barangay) => {
                              const selected = selectedBarangays.includes(barangay);
                              return (
                                <button
                                  type="button"
                                  className={selected ? "selected" : ""}
                                  key={barangay}
                                  onClick={() => toggleBarangay(barangay)}
                                >
                                  <span className="picker-check">
                                    {selected ? "✓" : ""}
                                  </span>
                                  <strong>{barangay}</strong>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <label className="field">
                    <span>Assigned driver</span>
                    <select
                      value={form.assignedDriverId}
                      onChange={(event) => {
                        const driver = drivers.find(
                          (item) => item.id === event.target.value,
                        );
                        setForm((current) => ({
                          ...current,
                          assignedDriverId: event.target.value,
                          assignedVehicle:
                            current.assignedVehicle || driver?.truck || "",
                        }));
                      }}
                    >
                      <option value="">Select driver</option>
                      {activeDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name || driver.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Truck / plate number</span>
                    <input
                      value={form.assignedVehicle}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          assignedVehicle: event.target.value,
                        }))
                      }
                      placeholder="Optional"
                    />
                  </label>
                </div>

                  <section className="purok-panel">
                    <header>
                      <div>
                        <h3>Actual Purok coverage per Barangay</h3>
                        <p>
                          {!selectedBarangays.length
                            ? "Select Barangays first. Actual Puroks are loaded from Service Areas."
                            : availableAreaIds.length
                              ? "Choose the exact Puroks for each Barangay. Different Barangays can have different Purok coverage."
                              : "No active local Puroks are configured for the selected Barangays."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={toggleAllAreas}
                        disabled={!availableAreaIds.length}
                      >
                        {availableAreaIds.length > 0 &&
                        selectedAreaIds.length === availableAreaIds.length
                          ? "Clear all"
                          : "Select all"}
                      </button>
                    </header>
                    <div className="purok-by-barangay-grid">
                      {availableAreasByBarangay.map((group) => (
                        <article className="purok-group-card" key={group.barangayKey}>
                          <div className="purok-group-head">
                            <strong>{group.barangay}</strong>
                            <small>{group.areas.length} active local Purok{group.areas.length === 1 ? "" : "s"}</small>
                          </div>
                          <div className="purok-grid">
                            {group.areas.length ? group.areas.map((area) => {
                              const selected = selectedAreaIds.includes(area.id);
                              return (
                                <button
                                  type="button"
                                  className={selected ? "selected" : ""}
                                  key={area.id}
                                  onClick={() => toggleArea(area.id)}
                                  title={`${area.barangay} • ${area.purok}`}
                                >
                                  <span>{selected ? "✓" : "+"}</span>
                                  {area.purok}
                                </button>
                              );
                            }) : <p className="no-local-puroks">No active Puroks. Add them in Service Areas.</p>}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <div className="service-area-source">
                    <span>✓</span>
                    <div>
                      <strong>Coverage source: Service Areas</strong>
                      <p>
                        Route Assignment does not create new Barangays or Puroks.
                        Add or activate them in Service Areas first.
                      </p>
                    </div>
                  </div>
                </div>

                <RouteMapPreview
                  points={selectedBarangayMapPoints}
                  selectedBarangayCount={selectedBarangays.length}
                />
              </div>

              <footer className="editor-foot">
                <div className="editor-selection-summary">
                  <strong>{selectedBarangays.length}</strong> Barangay
                  {selectedBarangays.length === 1 ? "" : "s"} ·{` `}
                  <strong>{selectedServiceAreas.length}</strong> Purok coverage
                  {selectedServiceAreas.length === 1 ? "" : "s"} ·{` `}
                  <strong>{selectedServiceAreas.length}</strong> coverage area
                  {selectedServiceAreas.length === 1 ? "" : "s"}
                </div>
                <div>
                  <button type="button" onClick={closeEditor}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      saving ||
                      !form.routeName.trim() ||
                      !form.assignedDriverId ||
                      !selectedServiceAreas.length
                    }
                    onClick={() => void saveRoute()}
                  >
                    {saving ? "Saving…" : "Save route assignment"}
                  </button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
      </main>

      <style jsx global>{`
        .route-page {
          max-width: 1500px;
          margin: 0 auto;
          display: grid;
          gap: 16px;
          color: #172a20;
        }

        .notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 15px;
          border: 1px solid #a7dfbd;
          border-radius: 12px;
          background: #f0fdf4;
          color: #166534;
        }

        .notice button {
          border: 0;
          background: transparent;
          font-size: 22px;
          cursor: pointer;
        }

        .route-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .route-summary div {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 18px;
          border: 1px solid #dce7e0;
          border-radius: 15px;
          background: #fff;
        }

        .route-summary span {
          color: #64776c;
          font-size: 12px;
          font-weight: 800;
        }

        .route-summary strong {
          order: -1;
          color: #168a4a;
          font-size: 27px;
        }

        .route-card {
          overflow: hidden;
          border: 1px solid #dce7e0;
          border-radius: 17px;
          background: #fff;
        }

        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 18px;
          border-bottom: 1px solid #e4ece7;
        }

        .toolbar h2,
        .toolbar p {
          margin: 0;
        }

        .toolbar p {
          margin-top: 5px;
          color: #718078;
          font-size: 13px;
        }

        .toolbar-actions {
          display: flex;
          gap: 10px;
        }

        .toolbar input {
          min-height: 44px;
          border: 1px solid #cedbd3;
          border-radius: 10px;
          padding: 0 12px;
          background: #fff;
          color: #16291f;
        }

        .primary {
          border: 1px solid #168a4a !important;
          background: #168a4a !important;
          color: #fff !important;
          font-weight: 850;
        }

        .toolbar button,
        .editor-foot button {
          min-height: 44px;
          border: 1px solid #d4dfd8;
          border-radius: 10px;
          padding: 0 15px;
          background: #fff;
          cursor: pointer;
        }

        .primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .table-wrap {
          overflow: auto;
        }

        .route-card table {
          width: 100%;
          border-collapse: collapse;
        }

        .route-card th,
        .route-card td {
          padding: 14px 16px;
          border-bottom: 1px solid #e8eeea;
          text-align: left;
          font-size: 13px;
        }

        .route-card th {
          color: #62736a;
          background: #f8fbf9;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .route-card td strong,
        .route-card td small {
          display: block;
        }

        .route-card td small {
          margin-top: 4px;
          color: #718078;
        }

        .status {
          display: inline-flex;
          padding: 6px 9px;
          border-radius: 999px;
          font-weight: 850;
        }

        .status.ready {
          background: #e8f7ee;
          color: #137744;
        }

        .status.review {
          background: #fff0e6;
          color: #b45309;
        }

        .row-actions {
          display: flex;
          gap: 7px;
        }

        .row-actions button {
          border: 1px solid #d4dfd8;
          border-radius: 8px;
          padding: 7px 9px;
          background: #fff;
          cursor: pointer;
        }

        .danger {
          color: #b42318 !important;
        }

        .empty {
          padding: 28px !important;
          color: #718078;
          text-align: center !important;
        }

        .modal {
          position: fixed;
          inset: 0;
          z-index: 999999;
          display: grid;
          place-items: center;
          padding: 10px;
          box-sizing: border-box;
          overflow: hidden;
          background: rgba(15, 27, 21, 0.58);
          backdrop-filter: blur(5px);
          overscroll-behavior: contain;
        }

        .editor {
          width: min(1680px, calc(100vw - 20px));
          height: calc(100% - 20px);
          max-width: none;
          max-height: calc(100% - 20px);
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) 72px;
          overflow: hidden;
          border: 1px solid #d6e2da;
          border-radius: 20px;
          background: #f8fbf9;
          box-shadow: 0 28px 90px rgba(7, 20, 13, 0.34);
        }

        .editor-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 16px 22px 14px;
          border-bottom: 1px solid #e2ebe5;
          background: #fff;
        }

        .editor-head > div {
          min-width: 0;
        }

        .editor-head > div > span {
          display: block;
          color: #168a4a;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .editor-head h2,
        .editor-head p {
          margin: 0;
        }

        .editor-head h2 {
          margin-top: 5px;
          color: #102b1d;
          font-size: 22px;
          line-height: 1.2;
        }

        .editor-head p {
          max-width: 900px;
          margin-top: 7px;
          color: #65776d;
          font-size: 13px;
          line-height: 1.45;
        }

        .editor-close {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 0;
          border-radius: 50%;
          background: #f1f5f2;
          color: #56665d;
          font-size: 20px;
          cursor: pointer;
        }

        .editor-close:hover {
          background: #e9efeb;
          color: #21362a;
        }

        .editor-body {
          min-height: 0;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(500px, 0.82fr) minmax(640px, 1.18fr);
          gap: 16px;
          padding: 16px;
          background: #f8fbf9;
        }

        .editor-form-column {
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          display: grid;
          align-content: start;
          gap: 14px;
          padding: 1px 6px 1px 1px;
          scrollbar-width: thin;
          scrollbar-color: #b8c9bf transparent;
        }

        .editor-form-column::-webkit-scrollbar {
          width: 7px;
        }

        .editor-form-column::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #b8c9bf;
        }

        .assignment-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 13px;
          align-items: start;
          padding: 16px;
          border: 1px solid #d9e5dd;
          border-radius: 15px;
          background: #fff;
        }

        .field {
          min-width: 0;
          display: grid;
          gap: 7px;
          color: #253d30;
          font-size: 11px;
          font-weight: 850;
        }

        .field > span {
          line-height: 1.2;
        }

        .field input,
        .field select,
        .picker-trigger {
          width: 100%;
          min-height: 45px;
          border: 1px solid #cbd9d1;
          border-radius: 10px;
          padding: 0 12px;
          outline: none;
          background: #fff;
          color: #172a20;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .field input::placeholder {
          color: #73827a;
        }

        .field input:focus,
        .field select:focus,
        .picker-trigger:focus-visible {
          border-color: #168a4a;
          box-shadow: 0 0 0 3px rgba(22, 138, 74, 0.1);
        }

        .route-name-field input {
          min-height: 45px;
          padding: 0 13px;
        }

        .barangay-picker {
          position: relative;
          min-width: 0;
          display: grid;
          gap: 7px;
        }

        .picker-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
        }

        .picker-trigger:disabled {
          cursor: not-allowed;
          background: #f7f9f8;
          color: #87958d;
        }

        .picker-trigger > strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        .picker-meta {
          display: flex;
          align-items: center;
          gap: 9px;
          flex: 0 0 auto;
        }

        .picker-meta b {
          min-width: 22px;
          height: 22px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: #eaf7ef;
          color: #168a4a;
          font-size: 10px;
        }

        .picker-meta i {
          color: #53665b;
          font-size: 14px;
          font-style: normal;
        }

        .barangay-chips {
          min-height: 27px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .barangay-chips button {
          min-height: 27px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #b9d4ff;
          border-radius: 999px;
          padding: 3px 9px;
          background: #edf5ff;
          color: #1752c5;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }

        .barangay-chips button span {
          font-size: 14px;
          line-height: 1;
        }

        .barangay-menu {
          position: absolute;
          top: 51px;
          left: 0;
          right: 0;
          z-index: 30;
          overflow: hidden;
          border: 1px solid #cbd9d1;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 16px 40px rgba(18, 46, 31, 0.18);
        }

        .barangay-menu-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 11px;
          border-bottom: 1px solid #e7ede9;
          background: #f8fbf9;
        }

        .barangay-menu-head span {
          color: #718078;
          font-size: 10px;
          font-weight: 800;
        }

        .barangay-menu-head button {
          border: 0;
          background: transparent;
          color: #168a4a;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .barangay-options {
          max-height: 235px;
          overflow: auto;
          padding: 6px;
        }

        .barangay-options > button {
          width: 100%;
          min-height: 38px;
          display: flex;
          align-items: center;
          gap: 9px;
          border: 0;
          border-radius: 8px;
          padding: 0 8px;
          background: #fff;
          color: #2f4338;
          text-align: left;
          cursor: pointer;
        }

        .barangay-options > button:hover,
        .barangay-options > button.selected {
          background: #f0f8f3;
          color: #126b3e;
        }

        .barangay-options > button strong {
          font-size: 12px;
        }

        .picker-check {
          width: 18px;
          height: 18px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 1px solid #bfd0c6;
          border-radius: 5px;
          color: #fff;
          font-size: 11px;
        }

        .barangay-options > button.selected .picker-check {
          border-color: #168a4a;
          background: #168a4a;
        }

        .purok-panel,
        .route-map-preview {
          overflow: hidden;
          border: 1px solid #d9e5dd;
          border-radius: 15px;
          background: #fff;
        }

        .purok-panel {
          padding: 15px;
          background: #fff;
        }

        .purok-panel > header,
        .route-map-preview > header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .purok-panel h3,
        .purok-panel p,
        .route-map-preview h3,
        .route-map-preview p {
          margin: 0;
        }

        .purok-panel h3,
        .route-map-preview h3 {
          color: #163124;
          font-size: 15px;
        }

        .purok-panel p,
        .route-map-preview p {
          margin-top: 5px;
          color: #6d7c74;
          font-size: 11px;
          line-height: 1.4;
        }

        .purok-panel > header > button,
        .route-map-preview > header > button {
          min-height: 38px;
          flex: 0 0 auto;
          border: 1px solid #d4dfd8;
          border-radius: 9px;
          padding: 0 12px;
          background: #fff;
          color: #253c30;
          font-size: 11px;
          font-weight: 850;
          cursor: pointer;
        }

        .route-map-preview > header > button:disabled,
        .purok-panel > header > button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .purok-by-barangay-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 14px;
        }

        .purok-group-card {
          min-width: 0;
          padding: 11px;
          border: 1px solid #e1e9e4;
          border-radius: 12px;
          background: #fbfdfc;
        }

        .purok-group-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .purok-group-head strong,
        .purok-group-head small {
          display: block;
        }

        .purok-group-head strong {
          color: #173227;
          font-size: 12px;
        }

        .purok-group-head small {
          color: #718078;
          font-size: 9px;
          text-align: right;
        }

        .purok-group-card .purok-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-top: 9px;
        }

        .no-local-puroks {
          grid-column: 1 / -1;
          margin: 0 !important;
          padding: 10px;
          border: 1px dashed #d5dfd8;
          border-radius: 9px;
          background: #fff;
          text-align: center;
        }

        .purok-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          margin-top: 14px;
        }

        .purok-grid > button {
          min-height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid #d5e0d9;
          border-radius: 9px;
          background: #fff;
          color: #243a2e;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }

        .purok-grid > button:hover {
          border-color: #a8c9b5;
          background: #f7fbf8;
        }

        .purok-grid > button.selected {
          border-color: #4ba976;
          background: #eaf7ef;
          color: #116b3d;
          box-shadow: inset 0 0 0 1px rgba(22, 138, 74, 0.08);
        }

        .purok-grid > button.unavailable,
        .purok-grid > button:disabled {
          border-style: dashed;
          border-color: #dfe6e1;
          background: #f7f9f8;
          color: #9aa69f;
          cursor: not-allowed;
          box-shadow: none;
        }

        .purok-grid > button span {
          font-size: 12px;
          line-height: 1;
        }

        .route-map-preview {
          min-width: 0;
          min-height: 0;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          box-shadow: 0 8px 28px rgba(22, 52, 35, 0.06);
        }

        .route-map-preview > header {
          padding: 16px 18px;
          background: #fff;
        }

        .route-map-preview h3 {
          font-size: 16px;
        }

        .route-map-canvas {
          width: 100%;
          height: 100%;
          min-height: 0;
          border-top: 1px solid #e4ebe6;
          background: #edf3ef;
        }

        .route-preview-marker {
          position: relative;
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border: 3px solid #fff;
          border-radius: 50%;
          background: #2868df;
          color: #fff;
          box-shadow: 0 3px 10px rgba(18, 55, 122, 0.34);
          cursor: pointer;
        }

        .route-preview-marker::after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -7px;
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #2868df;
          transform: translateX(-50%);
        }

        .route-preview-marker--primary {
          background: #18a85c;
          box-shadow: 0 3px 10px rgba(16, 113, 61, 0.34);
        }

        .route-preview-marker--primary::after {
          border-top-color: #18a85c;
        }

        .route-preview-marker span {
          position: relative;
          z-index: 1;
          font-size: 10px;
          font-weight: 900;
          line-height: 1;
        }

        .route-map-preview .maplibregl-ctrl-top-left {
          top: 8px;
          left: 8px;
        }

        .route-map-preview .maplibregl-ctrl-group {
          overflow: hidden;
          border-radius: 7px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
        }

        .service-area-source {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 13px;
          border: 1px solid #bcdcc8;
          border-radius: 12px;
          background: #f2fbf5;
        }

        .service-area-source > span {
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border-radius: 7px;
          background: #168a4a;
          color: #fff;
          font-size: 11px;
          font-weight: 900;
        }

        .service-area-source strong {
          display: block;
          color: #1a3b2a;
          font-size: 11px;
        }

        .service-area-source p {
          margin: 3px 0 0;
          color: #63766b;
          font-size: 10px;
          line-height: 1.4;
        }

        .editor-foot {
          position: relative;
          z-index: 80;
          min-height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 22px;
          border-top: 1px solid #d7e3dc;
          background: rgba(255, 255, 255, 0.99);
          box-shadow: 0 -10px 26px rgba(18, 46, 31, 0.08);
        }

        .editor-foot > div:last-child {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .editor-foot > div:last-child .primary {
          min-width: 205px;
        }

        .editor-foot > div:last-child .primary:disabled {
          opacity: 0.55;
          filter: saturate(0.8);
        }

        .editor-selection-summary {
          color: #738078;
          font-size: 11px;
        }

        .editor-selection-summary strong {
          color: #244032;
        }

        @media (max-height: 720px) and (min-width: 1121px) {
          .modal {
            padding: 6px;
          }

          .editor {
            width: calc(100vw - 12px);
            height: calc(100% - 12px);
            border-radius: 15px;
          }

          .editor-head {
            padding-top: 12px;
            padding-bottom: 11px;
          }

          .editor-head p {
            margin-top: 4px;
          }

          .editor-body {
            padding: 12px;
            gap: 12px;
          }
        }

        @media (max-width: 1120px) {
          .modal {
            padding: 8px;
          }

          .editor {
            width: calc(100vw - 16px);
            height: calc(100% - 16px);
            max-height: none;
          }

          .editor-body {
            overflow-y: auto;
            overflow-x: hidden;
            grid-template-columns: 1fr;
          }

          .editor-form-column {
            overflow: visible;
            padding-right: 1px;
          }

          .route-map-preview {
            min-height: 460px;
          }

          .route-map-canvas {
            height: 420px;
            min-height: 420px;
          }
        }

        @media (max-width: 900px) {
          .editor {
            grid-template-rows: auto minmax(0, 1fr) auto;
          }

          .route-summary,
          .assignment-grid {
            grid-template-columns: 1fr;
          }

          .toolbar,
          .toolbar-actions {
            align-items: stretch;
            flex-direction: column;
          }

          .purok-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .modal {
            padding: 8px;
          }

          .editor {
            width: 100%;
            height: calc(100% - 16px);
            max-height: none;
            border-radius: 14px;
          }

          .editor-head,
          .editor-body,
          .editor-foot {
            padding-left: 14px;
            padding-right: 14px;
          }

          .editor-foot {
            align-items: stretch;
            flex-direction: column;
          }

          .editor-foot > div:last-child {
            justify-content: flex-end;
          }

          .route-map-canvas {
            height: 330px;
            min-height: 330px;
          }
        }

        @media (max-width: 560px) {
          .purok-panel > header,
          .route-map-preview > header {
            align-items: stretch;
            flex-direction: column;
          }

          .purok-panel > header > button,
          .route-map-preview > header > button {
            width: fit-content;
          }

          .barangay-menu {
            position: fixed;
            top: 20%;
            left: 16px;
            right: 16px;
          }
        }
      `}</style>
    </DashboardShell>
  );
}
