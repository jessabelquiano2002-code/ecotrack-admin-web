import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireDriver } from "../../../lib/serverAuth";
import { distanceMeters, type GpsPoint } from "../../../lib/geo";
import { findOfficialBarangay } from "../../service-areas/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_MIN_DISTANCE_METERS = 8;
const HISTORY_MAX_INTERVAL_MS = 10_000;
const MAX_ACCEPTED_ACCURACY_METERS = 60;
const NAVIGATION_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NAVIGATION_MAX_WAYPOINTS = 25;
const NAVIGATION_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_ROUTING_API_BASE_URL = "https://router.project-osrm.org";

type RoutePointPayload = {
  scheduleId?: string;
  routeId?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  event?: "start" | "point" | "finish" | "navigation";
};

type RouteCoordinate = { lat: number; lng: number };
type ServiceStop = RouteCoordinate & {
  areaKey: string;
  barangay: string;
  purok: string;
  order: number;
};

type BarangayDestination = RouteCoordinate & {
  barangay: string;
  barangayKey: string;
  psgcCode: string;
  order: number;
};

type NavigationPlan = {
  routingAvailable: boolean;
  message: string;
  routeSource: string;
  distanceMeters: number;
  durationSeconds: number;
  coordinates: number[][];
  destination: {
    barangay: string;
    barangayKey: string;
    psgcCode: string;
    latitude: number;
    longitude: number;
  };
  waypoints: Array<{
    barangay: string;
    barangayKey: string;
    psgcCode: string;
    latitude: number;
    longitude: number;
    order: number;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeBarangayKey(value: unknown): string {
  const key = String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay|brgy/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  if (["13", "poblacion13", "poblacion_13"].includes(key)) return "poblacion_13";
  if (["guindapunan", "gundaponan"].includes(key)) return "guindaponan";
  return key;
}

function normalizePurokKey(value: unknown): string {
  const text = String(value || "").trim();
  const digits = text.match(/\d+/)?.[0];
  return digits ? `purok_${Number(digits)}` : "all";
}

function orderedValues(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(asRecord);
  }
  return Object.values(asRecord(value))
    .filter(Boolean)
    .map(asRecord)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function readRouteCoordinates(route: Record<string, unknown>): RouteCoordinate[] {
  const direct = Array.isArray(route.coordinates)
    ? route.coordinates
    : Array.isArray(asRecord(route.geometry).coordinates)
      ? (asRecord(route.geometry).coordinates as unknown[])
      : [];

  const coordinates = direct.flatMap<RouteCoordinate>((value) => {
    if (!Array.isArray(value) || value.length < 2) return [];
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{lat, lng}] : [];
  });

  if (coordinates.length > 0) return coordinates;

  return orderedValues(route.routePoints).flatMap<RouteCoordinate>((point) => {
    const lat = Number(point.lat ?? point.latitude);
    const lng = Number(point.lng ?? point.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{lat, lng}] : [];
  });
}

function readServiceStops(route: Record<string, unknown>): ServiceStop[] {
  const checkpointStops = orderedValues(route.checkpoints);
  const areaStops = orderedValues(route.areas).filter((area) => {
    const coordinateVerified = area.coordinateVerified;
    const coordinatePrecision = String(area.coordinatePrecision || "").toLowerCase();
    return coordinateVerified === true || coordinatePrecision === "purok";
  });
  const legacyStops = orderedValues(route.routePoints).filter(
    (point) => point.type === "service",
  );
  const rawStops = checkpointStops.length > 0
    ? checkpointStops
    : areaStops.length > 0
      ? areaStops
      : legacyStops;

  return rawStops.flatMap<ServiceStop>((stop, index) => {
    const lat = Number(stop.lat ?? stop.latitude);
    const lng = Number(stop.lng ?? stop.longitude);
    const barangay = String(stop.barangay || "").trim();
    const purok = String(stop.purok || "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !barangay) return [];
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
    const areaKey = String(
      stop.areaKey || `${normalizeBarangayKey(barangay)}|${normalizePurokKey(purok)}`,
    );
    return [{
      lat,
      lng,
      barangay,
      purok,
      areaKey,
      order: Number(stop.order ?? index),
    }];
  });
}


function readBarangayDestinations(
  route: Record<string, unknown>,
): BarangayDestination[] {
  return orderedValues(route.barangayDestinations).flatMap<BarangayDestination>(
    (destination, index) => {
      const lat = Number(destination.latitude ?? destination.lat);
      const lng = Number(destination.longitude ?? destination.lng);
      const barangay = String(destination.barangay || "").trim();
      if (
        !barangay ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return [];
      }
      return [{
        lat,
        lng,
        barangay,
        barangayKey: String(
          destination.barangayKey || normalizeBarangayKey(barangay),
        ),
        psgcCode: String(destination.psgcCode || ""),
        order: Number(destination.order ?? index),
      }];
    },
  );
}

function isValidMapCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    (Math.abs(lat) > 0.000001 || Math.abs(lng) > 0.000001);
}

function normalizePurokLabel(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const digits = text.match(/\d+/)?.[0];
  return digits ? `Purok ${Number(digits)}` : text;
}

function buildAssignedCoverageAreas(
  schedule: Record<string, unknown>,
  route: Record<string, unknown>,
  assignedBarangays: string[],
  assignedPuroks: string[],
  serviceStops: ServiceStop[],
): Record<string, unknown>[] {
  const normalizeAreas = (value: unknown) =>
    orderedValues(value).flatMap<Record<string, unknown>>((area, index) => {
      const barangay = String(
        area.barangay || assignedBarangays[0] || "",
      ).trim();
      const purok = normalizePurokLabel(
        area.purok ?? area.name ?? area.label,
      );
      if (!barangay || !purok) return [];
      return [{
        ...area,
        areaKey: String(
          area.areaKey ||
            `${normalizeBarangayKey(barangay)}|${normalizePurokKey(purok)}`,
        ),
        barangay,
        barangayKey: String(
          area.barangayKey || normalizeBarangayKey(barangay),
        ),
        purok,
        purokKey: String(area.purokKey || normalizePurokKey(purok)),
        order: Number(area.order ?? index),
      }];
    });

  const scheduleAreas = normalizeAreas(schedule.areas);
  if (scheduleAreas.length > 0) return scheduleAreas;

  const routeAreas = normalizeAreas(route.areas);
  if (routeAreas.length > 0) return routeAreas;

  if (serviceStops.length > 0) {
    return serviceStops.map((stop, index) => ({
      areaKey: stop.areaKey,
      barangay: stop.barangay,
      barangayKey: normalizeBarangayKey(stop.barangay),
      purok: normalizePurokLabel(stop.purok),
      purokKey: normalizePurokKey(stop.purok),
      order: Number(stop.order ?? index),
    }));
  }

  // Old MetroWaste schedules stored Barangays and Puroks in separate arrays.
  // Reconstruct the explicit coverage instead of treating it as a road route.
  let order = 0;
  return assignedBarangays.flatMap((barangay) =>
    assignedPuroks.flatMap<Record<string, unknown>>((rawPurok) => {
      const purok = normalizePurokLabel(rawPurok);
      if (!barangay || !purok) return [];
      const area = {
        areaKey: `${normalizeBarangayKey(barangay)}|${normalizePurokKey(purok)}`,
        barangay,
        barangayKey: normalizeBarangayKey(barangay),
        purok,
        purokKey: normalizePurokKey(purok),
        order,
      };
      order += 1;
      return [area];
    }),
  );
}

async function resolveBarangayDestinations(
  route: Record<string, unknown>,
  assignedBarangays: string[],
): Promise<BarangayDestination[]> {
  const stored = readBarangayDestinations(route);
  const storedByKey = new Map(
    stored.map((destination) => [
      normalizeBarangayKey(destination.barangayKey || destination.barangay),
      destination,
    ]),
  );
  const missingKeys = assignedBarangays
    .map(normalizeBarangayKey)
    .filter((key) => key && !storedByKey.has(key));

  let serviceRegistry: Record<string, unknown> = {};
  if (missingKeys.length > 0) {
    const snapshot = await adminDb.ref("service_areas").get();
    serviceRegistry = asRecord(snapshot.val());
  }

  const registryEntry = (barangayKey: string): Record<string, unknown> => {
    const direct = asRecord(serviceRegistry[barangayKey]);
    if (Object.keys(direct).length > 0) return direct;
    for (const [key, raw] of Object.entries(serviceRegistry)) {
      const record = asRecord(raw);
      if (
        normalizeBarangayKey(key) === barangayKey ||
        normalizeBarangayKey(record.barangay) === barangayKey ||
        normalizeBarangayKey(record.barangayKey) === barangayKey
      ) {
        return record;
      }
    }
    return {};
  };

  return assignedBarangays.flatMap<BarangayDestination>((barangay, order) => {
    const barangayKey = normalizeBarangayKey(barangay);
    const existing = storedByKey.get(barangayKey);
    if (existing) return [{ ...existing, order }];

    const serviceArea = registryEntry(barangayKey);
    const official = findOfficialBarangay(barangay);
    const storedLat = Number(
      serviceArea.centerLatitude ?? serviceArea.latitude ?? serviceArea.lat,
    );
    const storedLng = Number(
      serviceArea.centerLongitude ?? serviceArea.longitude ?? serviceArea.lng,
    );
    const officialLat = Number(official?.centerLatitude);
    const officialLng = Number(official?.centerLongitude);
    const officialIsNamedLocality =
      official?.coordinateType === "openstreetmap-locality";
    const storedIsNamedLocality =
      String(serviceArea.coordinateType || "") === "openstreetmap-locality";
    const preferOfficial = officialIsNamedLocality && !storedIsNamedLocality;
    const useStored = !preferOfficial && isValidMapCoordinate(storedLat, storedLng);
    const lat = useStored ? storedLat : officialLat;
    const lng = useStored ? storedLng : officialLng;
    if (!isValidMapCoordinate(lat, lng)) return [];

    return [{
      barangay: String(serviceArea.barangay || official?.name || barangay),
      barangayKey,
      psgcCode: String(serviceArea.psgcCode || official?.psgcCode || ""),
      lat,
      lng,
      order,
    }];
  });
}

async function upgradeLegacyCoverageRoute(
  routeId: string,
  scheduleId: string,
  route: Record<string, unknown>,
  schedule: Record<string, unknown>,
  assignedBarangays: string[],
  assignedPuroks: string[],
  assignedAreas: Record<string, unknown>[],
  destinations: BarangayDestination[],
): Promise<void> {
  const storedDestinationKeys = new Set(
    readBarangayDestinations(route).map((destination) =>
      normalizeBarangayKey(destination.barangayKey || destination.barangay),
    ),
  );
  const hasEveryDestination = assignedBarangays.every((barangay) =>
    storedDestinationKeys.has(normalizeBarangayKey(barangay)),
  );
  const routeValidation = asRecord(route.routeValidation || route.validation);
  const alreadyCurrent =
    isCoverageRoute(route) &&
    route.verified === true &&
    String(routeValidation.status || "").toLowerCase() === "verified" &&
    orderedValues(route.areas).length > 0 &&
    hasEveryDestination;
  const scheduleAlreadyCurrent =
    isCoverageRoute(schedule) && schedule.routeVerified === true;
  if (alreadyCurrent && scheduleAlreadyCurrent) return;

  const now = Date.now();
  const destinationPayload = destinations.map((destination) => ({
    barangay: destination.barangay,
    barangayKey: destination.barangayKey,
    psgcCode: destination.psgcCode,
    latitude: destination.lat,
    longitude: destination.lng,
    order: destination.order,
  }));
  const updates: Record<string, unknown> = {
    [`routes/${routeId}/routeModel`]: "service-area-live-gps",
    [`routes/${routeId}/routeType`]: "service-area-route",
    [`routes/${routeId}/trackingMode`]: "live-gps",
    [`routes/${routeId}/navigationMode`]: "api-gps-road-route",
    [`routes/${routeId}/coverageOnly`]: true,
    [`routes/${routeId}/requiresDrawnPath`]: false,
    [`routes/${routeId}/requiresManualPins`]: false,
    [`routes/${routeId}/manualPurokPinsRequired`]: false,
    [`routes/${routeId}/manualRoadPathRequired`]: false,
    [`routes/${routeId}/verified`]: true,
    [`routes/${routeId}/status`]: "ready",
    [`routes/${routeId}/barangay`]: assignedBarangays[0] || "",
    [`routes/${routeId}/barangays`]: assignedBarangays,
    [`routes/${routeId}/puroks`]: assignedPuroks.map(normalizePurokLabel),
    [`routes/${routeId}/areas`]: assignedAreas,
    [`routes/${routeId}/barangayDestinations`]: destinationPayload,
    [`routes/${routeId}/routeValidation/status`]: "verified",
    [`routes/${routeId}/routeValidation/method`]:
      "server-upgraded-service-area-live-gps",
    [`routes/${routeId}/routeValidation/verifiedAt`]: now,
    [`routes/${routeId}/routeValidation/coverageAreaCount`]: assignedAreas.length,
    [`routes/${routeId}/routeValidation/barangayPinCount`]: destinations.length,
    [`routes/${routeId}/updatedAt`]: now,
    [`schedules/${scheduleId}/routeModel`]: "service-area-live-gps",
    [`schedules/${scheduleId}/routeType`]: "service-area-route",
    [`schedules/${scheduleId}/trackingMode`]: "live-gps",
    [`schedules/${scheduleId}/routeVerified`]: true,
    [`schedules/${scheduleId}/barangay`]: assignedBarangays[0] || "",
    [`schedules/${scheduleId}/barangays`]: assignedBarangays,
    [`schedules/${scheduleId}/assignedPuroks`]:
      assignedPuroks.map(normalizePurokLabel),
    [`schedules/${scheduleId}/areas`]: assignedAreas,
    [`schedules/${scheduleId}/updatedAt`]: now,
  };

  await adminDb.ref().update(updates);
}

function coordinatePairsToRoute(
  value: unknown,
): RouteCoordinate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<RouteCoordinate>((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return [];
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return [];
    }
    return [{ lat, lng }];
  });
}

function navigationCacheRoute(
  cache: Record<string, unknown>,
  routeId: string,
  now: number,
): RouteCoordinate[] {
  if (String(cache.routeId || "") !== routeId) return [];
  const generatedAt = Number(cache.generatedAt || 0);
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt <= 0 ||
    now - generatedAt > NAVIGATION_CACHE_MAX_AGE_MS
  ) {
    return [];
  }
  if (cache.routingAvailable !== true) return [];
  return coordinatePairsToRoute(cache.coordinates);
}

function uniqueNavigationWaypoints(
  start: RouteCoordinate,
  destinations: BarangayDestination[],
): Array<RouteCoordinate & { barangay: string; order: number }> {
  const raw: Array<RouteCoordinate & { barangay: string; order: number }> = [
    { ...start, barangay: "Current truck location", order: -1 },
    ...destinations.map((destination) => ({
      lat: destination.lat,
      lng: destination.lng,
      barangay: destination.barangay,
      order: destination.order,
    })),
  ];

  const result: Array<RouteCoordinate & { barangay: string; order: number }> = [];
  raw.forEach((candidate) => {
    const previous = result.at(-1);
    if (!previous) {
      result.push(candidate);
      return;
    }
    const separation = distanceMeters(
      { lat: previous.lat, lng: previous.lng, timestamp: 0, accuracy: 0 },
      { lat: candidate.lat, lng: candidate.lng, timestamp: 0, accuracy: 0 },
    );
    if (separation >= 20) result.push(candidate);
  });
  return result.slice(0, NAVIGATION_MAX_WAYPOINTS);
}


function polylineLengthMeters(route: RouteCoordinate[]): number {
  return route.slice(1).reduce((sum, current, index) => {
    const previous = route[index];
    return sum + distanceMeters(
      { lat: previous.lat, lng: previous.lng, timestamp: 0, accuracy: 0 },
      { lat: current.lat, lng: current.lng, timestamp: 0, accuracy: 0 },
    );
  }, 0);
}

function remainingCachedNavigationPlan(
  cache: Record<string, unknown>,
  routeId: string,
  start: RouteCoordinate,
  now: number,
  assignedBarangays: string[],
): NavigationPlan | null {
  const expectedBarangayKeys = assignedBarangays
    .map(normalizeBarangayKey)
    .filter(Boolean);
  const cachedBarangayKeys = normalizeStringArray(cache.assignedBarangayKeys)
    .map(normalizeBarangayKey)
    .filter(Boolean);
  if (expectedBarangayKeys.length > 0) {
    const sameCoverage = expectedBarangayKeys.length === cachedBarangayKeys.length
      && expectedBarangayKeys.every((key, index) => cachedBarangayKeys[index] === key);
    if (!sameCoverage) return null;
  }

  const cachedRoute = navigationCacheRoute(cache, routeId, now);
  if (cachedRoute.length < 2) return null;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  cachedRoute.forEach((coordinate, index) => {
    const distance = distanceMeters(
      { lat: start.lat, lng: start.lng, timestamp: 0, accuracy: 0 },
      { lat: coordinate.lat, lng: coordinate.lng, timestamp: 0, accuracy: 0 },
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  // If the truck is still reasonably close to the generated road, trim the
  // already-travelled portion instead of routing back through earlier areas.
  if (nearestDistance > 600) return null;

  const sliceStart = Math.max(0, nearestIndex - 1);
  const remaining = cachedRoute.slice(sliceStart);
  if (remaining.length < 2) return null;

  const destinationRaw = asRecord(cache.destination);
  const destinationLatitude = Number(
    destinationRaw.latitude ?? destinationRaw.lat,
  );
  const destinationLongitude = Number(
    destinationRaw.longitude ?? destinationRaw.lng,
  );
  if (
    !Number.isFinite(destinationLatitude) ||
    !Number.isFinite(destinationLongitude)
  ) {
    return null;
  }

  const totalPolyline = Math.max(1, polylineLengthMeters(cachedRoute));
  const remainingPolyline = polylineLengthMeters(remaining);
  const ratio = Math.max(0, Math.min(1, remainingPolyline / totalPolyline));
  const cachedDistance = Math.max(0, Number(cache.distanceMeters || 0));
  const cachedDuration = Math.max(0, Number(cache.durationSeconds || 0));

  return {
    routingAvailable: true,
    message: "Road route refreshed from the truck's current GPS position.",
    routeSource: String(cache.routeSource || "osrm"),
    distanceMeters: cachedDistance > 0
      ? cachedDistance * ratio
      : remainingPolyline,
    durationSeconds: cachedDuration > 0
      ? cachedDuration * ratio
      : 0,
    coordinates: remaining.map((coordinate) => [
      coordinate.lng,
      coordinate.lat,
    ]),
    destination: {
      barangay: String(destinationRaw.barangay || "Assigned area"),
      barangayKey: String(destinationRaw.barangayKey || ""),
      psgcCode: String(destinationRaw.psgcCode || ""),
      latitude: destinationLatitude,
      longitude: destinationLongitude,
    },
    waypoints: orderedValues(cache.waypoints).map((waypoint, index) => ({
      barangay: String(waypoint.barangay || ""),
      barangayKey: String(waypoint.barangayKey || normalizeBarangayKey(waypoint.barangay)),
      psgcCode: String(waypoint.psgcCode || ""),
      latitude: Number(waypoint.latitude ?? waypoint.lat),
      longitude: Number(waypoint.longitude ?? waypoint.lng),
      order: Number(waypoint.order ?? index),
    })).filter((waypoint) =>
      waypoint.barangay &&
      Number.isFinite(waypoint.latitude) &&
      Number.isFinite(waypoint.longitude),
    ),
  };
}

async function buildRoadNavigationPlan(
  start: RouteCoordinate,
  route: Record<string, unknown>,
  assignedBarangays: string[],
): Promise<NavigationPlan> {
  const routeDestinations = readBarangayDestinations(route);
  const assignedKeys = new Set(
    assignedBarangays.map(normalizeBarangayKey).filter(Boolean),
  );
  const destinations = assignedKeys.size > 0
    ? routeDestinations.filter((destination) =>
        assignedKeys.has(normalizeBarangayKey(destination.barangayKey || destination.barangay)),
      )
    : routeDestinations;
  const fallbackDestination = destinations.at(-1);
  if (!fallbackDestination) {
    return {
      routingAvailable: false,
      message:
        "This assignment has no automatic Barangay route references. Re-save the route in Admin.",
      routeSource: "none",
      distanceMeters: 0,
      durationSeconds: 0,
      coordinates: [],
      destination: {
        barangay: "Assigned area",
        barangayKey: "",
        psgcCode: "",
        latitude: start.lat,
        longitude: start.lng,
      },
      waypoints: [],
    };
  }

  const waypoints = uniqueNavigationWaypoints(start, destinations);
  if (waypoints.length < 2) {
    return {
      routingAvailable: false,
      message: "The truck is already at the final assigned Barangay reference.",
      routeSource: "none",
      distanceMeters: 0,
      durationSeconds: 0,
      coordinates: [],
      destination: {
        barangay: fallbackDestination.barangay,
        barangayKey: fallbackDestination.barangayKey,
        psgcCode: fallbackDestination.psgcCode,
        latitude: fallbackDestination.lat,
        longitude: fallbackDestination.lng,
      },
      waypoints: destinations.map((destination) => ({
        barangay: destination.barangay,
        barangayKey: destination.barangayKey,
        psgcCode: destination.psgcCode,
        latitude: destination.lat,
        longitude: destination.lng,
        order: destination.order,
      })),
    };
  }

  const routingBase = (
    process.env.ROUTING_API_BASE_URL || DEFAULT_ROUTING_API_BASE_URL
  ).replace(/\/+$/, "");
  const coordinatePath = waypoints
    .map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
    .join(";");
  const routingUrl =
    `${routingBase}/route/v1/driving/${coordinatePath}` +
    "?alternatives=false&steps=false&geometries=geojson&overview=full&continue_straight=true";

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    NAVIGATION_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(routingUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "MetroWaste-Capstone/1.0 route-navigation",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Routing service HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (String(payload.code || "") !== "Ok") {
      throw new Error(String(payload.code || "NoRoute"));
    }

    const routes = Array.isArray(payload.routes) ? payload.routes : [];
    const firstRoute = asRecord(routes[0]);
    const geometry = asRecord(firstRoute.geometry);
    const coordinates = Array.isArray(geometry.coordinates)
      ? (geometry.coordinates as unknown[])
          .flatMap<number[]>((pair) => {
            if (!Array.isArray(pair) || pair.length < 2) return [];
            const lng = Number(pair[0]);
            const lat = Number(pair[1]);
            return Number.isFinite(lat) && Number.isFinite(lng)
              ? [[lng, lat]]
              : [];
          })
      : [];

    if (coordinates.length < 2) {
      throw new Error("Routing service returned incomplete road geometry.");
    }

    return {
      routingAvailable: true,
      message: `Road route ready through ${destinations
        .map((destination) => destination.barangay)
        .join(" → ")} using OSRM/OpenStreetMap routing.`,
      routeSource: "osrm",
      distanceMeters: Math.max(0, Number(firstRoute.distance || 0)),
      durationSeconds: Math.max(0, Number(firstRoute.duration || 0)),
      coordinates,
      destination: {
        barangay: fallbackDestination.barangay,
        barangayKey: fallbackDestination.barangayKey,
        psgcCode: fallbackDestination.psgcCode,
        latitude: fallbackDestination.lat,
        longitude: fallbackDestination.lng,
      },
      waypoints: destinations.map((destination) => ({
        barangay: destination.barangay,
        barangayKey: destination.barangayKey,
        psgcCode: destination.psgcCode,
        latitude: destination.lat,
        longitude: destination.lng,
        order: destination.order,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Road routing timed out. Live GPS tracking is still available."
        : `Road routing is temporarily unavailable${
            error instanceof Error && error.message
              ? ` (${error.message})`
              : ""
          }. Live GPS tracking is still available.`;

    return {
      routingAvailable: false,
      message,
      routeSource: "unavailable",
      distanceMeters: 0,
      durationSeconds: 0,
      coordinates: [],
      destination: {
        barangay: fallbackDestination.barangay,
        barangayKey: fallbackDestination.barangayKey,
        psgcCode: fallbackDestination.psgcCode,
        latitude: fallbackDestination.lat,
        longitude: fallbackDestination.lng,
      },
      waypoints: destinations.map((destination) => ({
        barangay: destination.barangay,
        barangayKey: destination.barangayKey,
        psgcCode: destination.psgcCode,
        latitude: destination.lat,
        longitude: destination.lng,
        order: destination.order,
      })),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isCoverageRoute(route: Record<string, unknown>): boolean {
  const routeType = String(route.routeType || "").toLowerCase();
  const trackingMode = String(route.trackingMode || "").toLowerCase();
  const routeModel = String(route.routeModel || "").toLowerCase();
  return route.coverageOnly === true ||
    route.requiresDrawnPath === false ||
    route.manualRoadPathRequired === false ||
    route.manualPurokPinsRequired === false ||
    routeType === "service-area-route" ||
    trackingMode === "live-gps" ||
    routeModel === "service-area-live-gps";
}

function isVerifiedRoadRoute(
  route: Record<string, unknown>,
  coordinates: RouteCoordinate[],
  stops: ServiceStop[],
): boolean {
  const validation = asRecord(route.routeValidation || route.validation);
  const validCoordinates = coordinates.every((point) =>
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180,
  );
  return route.verified === true &&
    String(validation.status || "").toLowerCase() === "verified" &&
    coordinates.length >= 2 &&
    stops.length >= 2 &&
    validCoordinates;
}

function isVerifiedCoverageRoute(
  areas: Record<string, unknown>[],
): boolean {
  // A driver-authenticated schedule with explicit Barangay/Purok coverage is
  // sufficient for live-GPS collection. A hand-drawn road or Purok pin is not.
  return areas.some((area) => Boolean(area.barangay) && Boolean(area.purok));
}

function nearestServiceStopDistance(
  point: RouteCoordinate,
  stops: ServiceStop[],
): number {
  if (!stops.length) return 0;
  return stops.reduce((nearest, stop) => {
    const distance = distanceMeters(
      { lat: point.lat, lng: point.lng, timestamp: 0, accuracy: 0 },
      { lat: stop.lat, lng: stop.lng, timestamp: 0, accuracy: 0 },
    );
    return Math.min(nearest, distance);
  }, Number.POSITIVE_INFINITY);
}

function routePosition(point: RouteCoordinate, route: RouteCoordinate[]) {
  if (route.length < 2) return {distanceMeters: Number.POSITIVE_INFINITY, progress: 0};

  const latitudeRadians = point.lat * Math.PI / 180;
  const xScale = 111_320 * Math.cos(latitudeRadians);
  const yScale = 110_540;
  const segments = route.slice(1).map((end, index) => {
    const start = route[index];
    const ax = (start.lng - point.lng) * xScale;
    const ay = (start.lat - point.lat) * yScale;
    const bx = (end.lng - point.lng) * xScale;
    const by = (end.lat - point.lat) * yScale;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
    return {
      distance: Math.hypot(ax + t * dx, ay + t * dy),
      length,
      t,
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let completedLength = 0;
  let best = {distanceMeters: Number.POSITIVE_INFINITY, progress: 0};
  segments.forEach((segment) => {
    if (segment.distance < best.distanceMeters) {
      best = {
        distanceMeters: segment.distance,
        progress: totalLength > 0
          ? Math.round(((completedLength + segment.length * segment.t) / totalLength) * 100)
          : 0,
      };
    }
    completedLength += segment.length;
  });
  return best;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item === true) return key;
        if (typeof item === "string" || typeof item === "number") {
          return String(item);
        }
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value ? [String(value).trim()].filter(Boolean) : [];
}

function firstNonEmptyStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const normalized = normalizeStringArray(value);
    if (normalized.length > 0) return normalized;
  }
  return [];
}

function readGpsPoint(raw: Record<string, unknown>): GpsPoint | null {
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    timestamp: Number(raw.timestamp || 0),
    accuracy: Number(raw.accuracy || 0),
  };
}

export async function POST(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    const body = (await request.json()) as RoutePointPayload;

    const scheduleId = String(body.scheduleId || "").trim();
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const rawAccuracy = Number(body.accuracy || 0);
    const accuracy = Number.isFinite(rawAccuracy) ? Math.max(0, rawAccuracy) : 0;
    const timestamp = Number.isFinite(Number(body.timestamp))
      ? Number(body.timestamp)
      : Date.now();
    const finishRequested = body.event === "finish";

    if (!scheduleId) {
      return NextResponse.json(
        { error: "scheduleId is required." },
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json(
        { error: "Valid GPS coordinates are required." },
        { status: 400 },
      );
    }

    const scheduleSnapshot = await adminDb
      .ref(`schedules/${scheduleId}`)
      .get();

    if (!scheduleSnapshot.exists()) {
      return NextResponse.json(
        { error: "Schedule was not found." },
        { status: 404 },
      );
    }

    const schedule = scheduleSnapshot.val() as Record<string, unknown>;
    const assignedDriverId = String(
      schedule.assignedDriverId || schedule.driverId || "",
    );

    if (assignedDriverId !== driver.uid) {
      return NextResponse.json(
        { error: "This schedule is assigned to another driver." },
        { status: 403 },
      );
    }

    const routeId = String(
      body.routeId || schedule.routeId || schedule.assignedRouteId || "",
    );

    if (!routeId) {
      return NextResponse.json(
        { error: "The schedule has no assigned route." },
        { status: 409 },
      );
    }

    const routeSnapshot = await adminDb.ref(`routes/${routeId}`).get();

    if (!routeSnapshot.exists()) {
      return NextResponse.json(
        { error: "Assigned route was not found." },
        { status: 404 },
      );
    }

    const route = routeSnapshot.val() as Record<string, unknown>;
    const routeCoordinates = readRouteCoordinates(route);
    const serviceStops = readServiceStops(route);

    const routeBarangay = String(
      route.barangay ||
        (Array.isArray(route.barangays) ? route.barangays[0] : "") ||
        schedule.barangay ||
        "",
    );

    const assignedPuroks = firstNonEmptyStringArray(
      schedule.assignedPuroks,
      schedule.puroks,
      route.puroks,
    );
    const assignedBarangays = firstNonEmptyStringArray(
      schedule.barangays,
      schedule.barangay,
      route.barangays,
      routeBarangay,
    );
    const assignedAreas = buildAssignedCoverageAreas(
      schedule,
      route,
      assignedBarangays,
      assignedPuroks,
      serviceStops,
    );
    const coverageRoute =
      isCoverageRoute(route) ||
      isCoverageRoute(schedule) ||
      isVerifiedCoverageRoute(assignedAreas);
    const barangayDestinations = coverageRoute
      ? await resolveBarangayDestinations(route, assignedBarangays)
      : readBarangayDestinations(route);
    const effectiveRoute: Record<string, unknown> = coverageRoute
      ? {
          ...route,
          routeModel: "service-area-live-gps",
          routeType: "service-area-route",
          trackingMode: "live-gps",
          coverageOnly: true,
          requiresDrawnPath: false,
          verified: true,
          areas: assignedAreas,
          barangays: assignedBarangays,
          puroks: assignedPuroks,
          barangayDestinations: barangayDestinations.map((destination) => ({
            barangay: destination.barangay,
            barangayKey: destination.barangayKey,
            psgcCode: destination.psgcCode,
            latitude: destination.lat,
            longitude: destination.lng,
            order: destination.order,
          })),
          routeValidation: {
            ...asRecord(route.routeValidation || route.validation),
            status: "verified",
          },
        }
      : route;

    const routeReady = coverageRoute
      ? isVerifiedCoverageRoute(assignedAreas) && barangayDestinations.length > 0
      : isVerifiedRoadRoute(route, routeCoordinates, serviceStops);

    if (!routeReady) {
      return NextResponse.json(
        {
          error: coverageRoute
            ? "This service-area route has no usable Barangay/Purok coverage. Update the route assignment and try again."
            : "This road route is not ready. The administrator must verify an ordered road path and the service-stop pins before collection can start.",
        },
        { status: 409 },
      );
    }

    if (coverageRoute) {
      await upgradeLegacyCoverageRoute(
        routeId,
        scheduleId,
        route,
        schedule,
        assignedBarangays,
        assignedPuroks,
        assignedAreas,
        barangayDestinations,
      );
    }

    if (body.event === "navigation") {
      const navigationReference = adminDb.ref(
        `driver_navigation/${driver.uid}/${scheduleId}`,
      );
      const generatedAt = Date.now();
      const previousNavigationSnapshot = await navigationReference.get();
      const previousNavigation = asRecord(previousNavigationSnapshot.val());
      const navigationPlan =
        remainingCachedNavigationPlan(
          previousNavigation,
          routeId,
          { lat, lng },
          generatedAt,
          assignedBarangays,
        ) || await buildRoadNavigationPlan(
          { lat, lng },
          effectiveRoute,
          assignedBarangays,
        );

      await navigationReference.set({
        ...navigationPlan,
        driverId: driver.uid,
        scheduleId,
        routeId,
        routeName: String(
          route.routeName || schedule.routeName || "Collection route",
        ),
        assignedBarangayKeys: assignedBarangays.map(normalizeBarangayKey),
        generatedAt,
        startLatitude: lat,
        startLongitude: lng,
        updatedAt: generatedAt,
      });

      return NextResponse.json({
        success: true,
        scheduleId,
        routeId,
        generatedAt,
        ...navigationPlan,
      });
    }

    const effectiveRouteType = coverageRoute
      ? "service-area-route"
      : "verified-road-route";
    const effectiveTrackingMode = coverageRoute
      ? "live-gps"
      : "verified-polyline";

    const activeReference = adminDb.ref(
      `active_route_sessions/${driver.uid}`,
    );
    const activeSnapshot = await activeReference.get();
    const active = activeSnapshot.val() as {
      sessionId?: string;
      scheduleId?: string;
      startedAt?: number;
    } | null;

    if (active?.scheduleId && active.scheduleId !== scheduleId) {
      return NextResponse.json(
        {
          error:
            "Another collection session is already active for this driver. Finish it before starting a different route.",
        },
        { status: 409 },
      );
    }

    let sessionId =
      active?.scheduleId === scheduleId
        ? String(active.sessionId || "")
        : "";

    const now = Date.now();

    const navigationCacheSnapshot = await adminDb
      .ref(`driver_navigation/${driver.uid}/${scheduleId}`)
      .get();
    const navigationCache = asRecord(navigationCacheSnapshot.val());
    const cachedNavigationRoute = navigationCacheRoute(
      navigationCache,
      routeId,
      now,
    );
    const trackingRouteCoordinates =
      coverageRoute && cachedNavigationRoute.length >= 2
        ? cachedNavigationRoute
        : routeCoordinates;
    const navigationBackedCoverage =
      coverageRoute && cachedNavigationRoute.length >= 2;

    const isNewSession = !sessionId;
    if (isNewSession) {
      sessionId =
        adminDb.ref(`route_sessions/${scheduleId}`).push().key ||
        `session-${now}`;

      await adminDb.ref(`route_sessions/${scheduleId}/${sessionId}`).set({
        sessionId,
        scheduleId,
        routeId,
        routeName: route.routeName || schedule.routeName || "Collection route",
        routeType: effectiveRouteType,
        trackingMode: effectiveTrackingMode,
        navigationRoutingAvailable: navigationBackedCoverage,
        navigationRouteSource: String(navigationCache.routeSource || ""),
        navigationGeneratedAt: Number(navigationCache.generatedAt || 0),
        navigationCoordinates: navigationBackedCoverage
          ? cachedNavigationRoute.map((coordinate) => [coordinate.lng, coordinate.lat])
          : [],
        driverId: driver.uid,
        driverName: schedule.driverName || route.assignedDriverName || "",
        truckId: schedule.truckId || route.assignedVehicle || "",
        barangay: routeBarangay,
        barangays: assignedBarangays,
        assignedPuroks,
        areas: assignedAreas,
        serviceStopCount: serviceStops.length,
        visitedAreas: {},
        status: "Ongoing",
        progress: 0,
        startTime: timestamp,
        createdAt: now,
        updatedAt: now,
      });

      await activeReference.set({
        sessionId,
        scheduleId,
        routeId,
        startedAt: timestamp,
      });

      const statusKey = adminDb.ref("route_status_updates").push().key;
      if (statusKey) {
        await adminDb.ref(`route_status_updates/${statusKey}`).set({
          event: "collection_started",
          status: "Ongoing",
          sessionId,
          scheduleId,
          routeId,
          routeName: route.routeName || schedule.routeName || "Collection route",
          driverId: driver.uid,
          driverName: schedule.driverName || route.assignedDriverName || "",
          truckId: schedule.truckId || route.assignedVehicle || "",
          barangay: routeBarangay,
          barangays: assignedBarangays,
          assignedPuroks,
          areas: assignedAreas,
          message: coverageRoute
            ? "Driver started live GPS collection for the assigned service areas."
            : "Driver started the verified collection route.",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const refreshedActiveSnapshot = await activeReference.get();
    const refreshedActive = refreshedActiveSnapshot.val() as {
      sessionId?: string;
      scheduleId?: string;
      startedAt?: number;
    } | null;

    const activeSessionStartedAt = Number(
      refreshedActive?.startedAt || timestamp,
    );

    const sessionReference = adminDb.ref(
      `route_sessions/${scheduleId}/${sessionId}`,
    );
    const sessionSnapshot = await sessionReference.get();
    const session = (sessionSnapshot.val() || {}) as Record<string, unknown>;

    const point: GpsPoint = {
      lat,
      lng,
      timestamp,
      accuracy,
    };

    const accurateEnough =
      accuracy === 0 || accuracy <= MAX_ACCEPTED_ACCURACY_METERS;

    const pendingSummaryReference = adminDb.ref(
      `pending_collection_summaries/${driver.uid}/${scheduleId}`,
    );
    let pendingSummary: Record<string, unknown> = {};
    if (finishRequested) {
      const pendingSummarySnapshot = await pendingSummaryReference.get();
      pendingSummary = (pendingSummarySnapshot.val() || {}) as Record<
        string,
        unknown
      >;
    }

    const reportedAssignedPuroks = normalizeStringArray(
      pendingSummary.assignedPuroks || pendingSummary.puroks || assignedPuroks,
    );
    const claimedPuroks = normalizeStringArray(
      pendingSummary.claimedPuroks ||
        pendingSummary.visitedPuroks ||
        (finishRequested ? assignedPuroks : []),
    );
    const unclaimedPuroks = normalizeStringArray(pendingSummary.unclaimedPuroks);
    const completionReason = String(
      pendingSummary.completionReason ||
        (unclaimedPuroks.length > 0 ? "partial_collection" : "completed"),
    );
    const collectionCondition = String(
      pendingSummary.collectionCondition || "Normal collection",
    );
    const pendingLoadValue = Number(pendingSummary.truckLoadPercent);
    const reportedTruckLoadPercent =
      Number.isFinite(pendingLoadValue) && pendingLoadValue >= 0
        ? Math.min(100, pendingLoadValue)
        : null;
    const completionIsPartial =
      unclaimedPuroks.length > 0 ||
      completionReason.toLowerCase().includes("partial") ||
      completionReason.toLowerCase().includes("truck_full");

    const currentRoutePosition = navigationBackedCoverage || !coverageRoute
      ? routePosition(point, trackingRouteCoordinates)
      : {
          distanceMeters: nearestServiceStopDistance(point, serviceStops),
          progress: 0,
        };
    const allowedDeviationMeters = Math.max(75, Math.min(150, accuracy * 1.5));
    const onVerifiedRoute = navigationBackedCoverage || !coverageRoute
      ? accurateEnough &&
        currentRoutePosition.distanceMeters <= allowedDeviationMeters
      : accurateEnough;
    const previousProgress = Math.max(
      0,
      Math.min(100, Number(session.progress || session.routeProgress || 0)),
    );

    const visitedAreas = {
      ...asRecord(session.visitedAreas),
    };
    const serviceStopRadiusMeters = Math.max(60, Math.min(120, accuracy + 50));
    if (accurateEnough) {
      serviceStops.forEach((stop) => {
        if (distanceMeters(point, {
          lat: stop.lat,
          lng: stop.lng,
          timestamp,
          accuracy: 0,
        }) <= serviceStopRadiusMeters) {
          visitedAreas[stop.areaKey] = true;
        }
      });
    }
    const visitedAreaKeys = new Set(
      Object.entries(visitedAreas)
        .filter(([, visited]) => visited === true)
        .map(([key]) => key),
    );
    const spatialVisitedPuroks = Array.from(new Set(
      serviceStops
        .filter((stop) => visitedAreaKeys.has(stop.areaKey) && stop.purok)
        .map((stop) => stop.purok),
    ));
    const allServiceStopsVisited = serviceStops.length > 0 &&
      serviceStops.every((stop) => visitedAreaKeys.has(stop.areaKey));
    const coverageSpatialProgress = serviceStops.length > 0
      ? Math.round((visitedAreaKeys.size / serviceStops.length) * 100)
      : previousProgress;
    const liveProgress = coverageRoute
      ? navigationBackedCoverage
        ? Math.max(
            previousProgress,
            onVerifiedRoute ? currentRoutePosition.progress : 0,
          )
        : Math.max(previousProgress, Math.min(100, coverageSpatialProgress))
      : Math.max(
          previousProgress,
          onVerifiedRoute ? currentRoutePosition.progress : 0,
        );

    const assignedCount = Math.max(
      reportedAssignedPuroks.length,
      assignedPuroks.length,
    );
    const claimedCount = new Set(claimedPuroks).size;
    const coverageClaimComplete = assignedCount === 0 || claimedCount >= assignedCount;
    const finishCoverageProgress = assignedCount > 0
      ? Math.max(0, Math.min(100, Math.round((claimedCount / assignedCount) * 100)))
      : completionIsPartial
        ? Math.min(99, liveProgress)
        : 100;

    const routePassed = coverageRoute
      ? finishRequested && !completionIsPartial && coverageClaimComplete
      : allServiceStopsVisited && liveProgress >= 90;
    const status = finishRequested
      ? routePassed
        ? "Completed"
        : "Partially Completed"
      : coverageRoute
        ? navigationBackedCoverage
          ? onVerifiedRoute
            ? "On Route"
            : accurateEnough
              ? "Deviated from Route"
              : "Ongoing"
          : accurateEnough
            ? "On Route"
            : "Ongoing"
        : onVerifiedRoute
          ? "On Route"
          : accurateEnough
            ? "Deviated from Route"
            : "Ongoing";
    const progress = finishRequested
      ? coverageRoute
        ? routePassed
          ? 100
          : finishCoverageProgress
        : routePassed
          ? 100
          : liveProgress
      : liveProgress;
    const visitedPuroks = finishRequested && coverageRoute
      ? claimedPuroks
      : spatialVisitedPuroks;
    const routeDeviationMeters = navigationBackedCoverage || !coverageRoute
      ? Math.round(currentRoutePosition.distanceMeters)
      : 0;
    const nearestServiceAreaMeters = coverageRoute && serviceStops.length > 0
      ? Math.round(currentRoutePosition.distanceMeters)
      : null;

    const lastRecorded = session.lastRecordedPoint as GpsPoint | undefined;
    const distanceFromLast = lastRecorded
      ? distanceMeters(lastRecorded, point)
      : Number.POSITIVE_INFINITY;
    const timeFromLast = lastRecorded?.timestamp
      ? timestamp - lastRecorded.timestamp
      : Number.POSITIVE_INFINITY;
    const shouldRecord =
      accurateEnough &&
      (finishRequested ||
        body.event === "start" ||
        distanceFromLast >= HISTORY_MIN_DISTANCE_METERS ||
        timeFromLast >= HISTORY_MAX_INTERVAL_MS);

    const latestLocation = {
      driverId: driver.uid,
      driverName: String(
        schedule.driverName || route.assignedDriverName || "Assigned Driver",
      ),
      truckId: String(schedule.truckId || route.assignedVehicle || ""),
      routeName: String(
        route.routeName || schedule.routeName || "Collection route",
      ),
      latitude: lat,
      longitude: lng,
      lat,
      lng,
      accuracy,
      speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : 0,
      heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : 0,
      timestamp,
      lastUpdated: now,
      scheduleId,
      routeId,
      sessionId,
      startedAt: activeSessionStartedAt,
      barangay: routeBarangay,
      barangays: assignedBarangays,
      puroks: assignedPuroks,
      assignedPuroks,
      areas: assignedAreas,

      // Resident apps use this as the authoritative switch:
      // true from Start Collection until the driver presses Finish & Verify.
      trackingActive: !finishRequested,
      routeStatus: status,
      status,
      routeProgress: progress,
      progress,
      navigationRoutingAvailable: navigationBackedCoverage,
      navigationRouteSource: String(navigationCache.routeSource || ""),
      navigationGeneratedAt: Number(navigationCache.generatedAt || 0),
      routeDeviationMeters,
      nearestServiceAreaMeters,
      onVerifiedRoute,
      visitedAreas,
      visitedPuroks,
      finishedAt: finishRequested ? timestamp : null,

      locationQuality: accurateEnough ? "accepted" : "inaccurate",
    };

    await adminDb
      .ref(`driver_locations/${driver.uid}`)
      .update(latestLocation);

    if (shouldRecord) {
      const pointReference = adminDb
        .ref(`gps_route_history/${scheduleId}/${sessionId}/points`)
        .push();

      await pointReference.set({
        ...latestLocation,
        pointId: pointReference.key,
        recordedAt: now,
      });
    }

    const historySnapshot = await adminDb
      .ref(`gps_route_history/${scheduleId}/${sessionId}/points`)
      .get();

    const historyData = (historySnapshot.val() || {}) as Record<
      string,
      Record<string, unknown>
    >;

    const historyPoints = Object.values(historyData)
      .map(readGpsPoint)
      .filter((entry): entry is GpsPoint => entry !== null)
      .sort(
        (left, right) =>
          Number(left.timestamp || 0) - Number(right.timestamp || 0),
      );

    if (
      accurateEnough &&
      (historyPoints.length === 0 ||
        historyPoints.at(-1)?.timestamp !== timestamp)
    ) {
      historyPoints.push(point);
    }

    const travelledDistance = historyPoints
      .slice(1)
      .reduce(
        (sum, current, index) =>
          sum + distanceMeters(historyPoints[index], current),
        0,
      );

    const startTime = Number(session.startTime || timestamp);

    const updates: Record<string, unknown> = {
      status,
      routeStatus: status,
      progress,
      routeProgress: progress,
      routeType: effectiveRouteType,
      trackingMode: effectiveTrackingMode,
      navigationRoutingAvailable: navigationBackedCoverage,
      navigationRouteSource: String(navigationCache.routeSource || ""),
      navigationGeneratedAt: Number(navigationCache.generatedAt || 0),
      navigationCoordinates: navigationBackedCoverage
        ? cachedNavigationRoute.map((coordinate) => [coordinate.lng, coordinate.lat])
        : session.navigationCoordinates || [],
      barangay: routeBarangay,
      barangays: assignedBarangays,
      areas: assignedAreas,
      assignedPuroks,
      visitedAreas,
      visitedPuroks: Object.fromEntries(visitedPuroks.map((purok) => [purok, true])),
      routePassed,
      allPuroksVisited: coverageRoute
        ? finishRequested
          ? routePassed
          : allServiceStopsVisited
        : allServiceStopsVisited,
      routeDeviationMeters,
      nearestServiceAreaMeters,
      onVerifiedRoute,
      distanceTravelledMeters: Math.round(travelledDistance),
      durationSeconds: Math.max(
        0,
        Math.round((timestamp - startTime) / 1000),
      ),
      lastLocation: latestLocation,
      lastRecordedPoint: shouldRecord
        ? point
        : session.lastRecordedPoint || null,
      lastUpdateTime: timestamp,
      updatedAt: now,
    };

    if (finishRequested) {
      updates.completionTime = timestamp;
      updates.completedAt = timestamp;
      await activeReference.remove();
    }

    await sessionReference.update(updates);

    if (finishRequested) {
      const dateKey = new Date(timestamp).toISOString().slice(0, 10);
      const recurringSchedule =
        schedule.isRecurring === true ||
        String(schedule.scheduleType || "").toLowerCase() === "weekly" ||
        String(schedule.repeat || "").toLowerCase() === "weekly";

      /*
       * DriverMapActivity saves the driver's finish form before it asks the
       * tracking service to finish. The pending summary was loaded above so
       * service-area routes can determine Completed vs Partially Completed
       * without requiring an artificial road polyline or fake Purok pins.
       */
      const collectionStatus = routePassed ? "completed" : "partially_completed";

      const report = {
        reportId: sessionId,
        sessionId,
        scheduleId,
        routeId,
        routeName:
          route.routeName || schedule.routeName || "Collection route",
        scheduleName: schedule.title || "Collection schedule",
        routeType: effectiveRouteType,
        trackingMode: effectiveTrackingMode,
        driverId: driver.uid,
        driverName:
          String(pendingSummary.driverName || "") ||
          schedule.driverName ||
          route.assignedDriverName ||
          "",
        truckId:
          String(pendingSummary.truckId || pendingSummary.truck || "") ||
          schedule.truckId ||
          route.assignedVehicle ||
          "",
        barangay: String(pendingSummary.barangay || routeBarangay),
        assignedPuroks: reportedAssignedPuroks,
        puroks: reportedAssignedPuroks,
        claimedPuroks,
        visitedPuroks: claimedPuroks,
        unclaimedPuroks,
        status: collectionStatus,
        collectionStatus,
        source: "driver_gps_session",
        routeProgress: progress,
        routePassed,
        allPuroksVisited: coverageRoute
          ? routePassed
          : allServiceStopsVisited && unclaimedPuroks.length === 0,
        wasteType: String(pendingSummary.wasteType || ""),
        truckLoadFraction: String(pendingSummary.truckLoadFraction || ""),
        truckLoadLabel: String(pendingSummary.truckLoadLabel || ""),
        truckLoadPercent: reportedTruckLoadPercent,
        completionReason,
        collectionCondition,
        driverNotes: String(pendingSummary.driverNotes || ""),
        startTime,
        completedAt: timestamp,
        distanceTravelledMeters: Math.round(travelledDistance),
        durationSeconds: Math.max(
          0,
          Math.round((timestamp - startTime) / 1000),
        ),
        gpsHistoryPath: `gps_route_history/${scheduleId}/${sessionId}/points`,
        gpsPointCount: historyPoints.length,
        timestamp,
      };

      const footprintSummary = {
        sessionId,
        scheduleId,
        routeId,
        routeName: route.routeName || schedule.routeName || "Collection route",
        scheduleName: schedule.title || "Collection schedule",
        driverId: driver.uid,
        driverName: report.driverName,
        truckId: report.truckId,
        barangay: report.barangay,
        barangays: assignedBarangays,
        puroks: reportedAssignedPuroks,
        status: collectionStatus,
        source: "actual_driver_gps",
        startTime,
        completedAt: timestamp,
        distanceTravelledMeters: Math.round(travelledDistance),
        durationSeconds: Math.max(0, Math.round((timestamp - startTime) / 1000)),
        gpsPointCount: historyPoints.length,
        gpsHistoryPath: `gps_route_history/${scheduleId}/${sessionId}/points`,
        startLocation: historyPoints[0] || point,
        finishLocation: historyPoints.at(-1) || point,
        updatedAt: now,
      };

      await Promise.all([
        adminDb.ref(`collection_reports/${sessionId}`).set(report),
        adminDb.ref(`route_footprints/${sessionId}`).set(footprintSummary),
        adminDb.ref(`schedules/${scheduleId}`).update({
          status: recurringSchedule ? "active" : "completed",
          lastRunStatus: collectionStatus,
          lastCompletedAt: timestamp,
          lastCompletedDate: dateKey,
          lastCollectionReportId: sessionId,
          routeProgress: progress,
          routeStatus:
            collectionStatus === "partially_completed" || !routePassed
              ? "Partially Completed"
              : "Completed",
          updatedAt: now,
        }),
      ]);

      // The operational summary is now safely persisted in collection_reports.
      // Remove the temporary per-schedule summary so a future recurring run
      // cannot accidentally reuse stale truck-load or Purok data.
      await pendingSummaryReference.remove();
    }

    return NextResponse.json({
      success: true,
      recordedInHistory: shouldRecord,
      ignoredForAccuracy: !accurateEnough,
      sessionId,
      routeStatus: status,
      routeProgress: progress,
      routePassed,
      navigationRoutingAvailable: navigationBackedCoverage,
      routeDeviationMeters,
      visitedPuroks,
      distanceTravelledMeters: Math.round(travelledDistance),
    });
  } catch (error: unknown) {
    const status = authErrorStatus(error);
    const message =
      error instanceof Error ? error.message : "Unable to record GPS point.";

    return NextResponse.json(
      {
        error: status === 500 ? message : "Not authorized.",
      },
      { status },
    );
  }
}
