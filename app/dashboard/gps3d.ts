export type GpsPoint = {
  lat: number;
  lng: number;
  timestamp?: number;
  heading?: number;
  speedMps?: number;
  accuracyMeters?: number;
};

export type RouteSceneProjection = {
  x: number;
  z: number;
  yaw: number;
  fraction: number;
  crossTrackMeters: number;
};

const EARTH_RADIUS_M = 6_371_000;

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric !== undefined) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function validLatLng(lat: number | undefined, lng: number | undefined) {
  return (
    lat !== undefined &&
    lng !== undefined &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function parseArrayCoordinate(
  value: unknown,
  preferGeoJson = false,
): GpsPoint | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;

  const first = finiteNumber(value[0]);
  const second = finiteNumber(value[1]);
  if (first === undefined || second === undefined) return undefined;

  let lat: number;
  let lng: number;

  // GeoJSON uses [longitude, latitude]. If one element is > 90 degrees,
  // the ordering becomes unambiguous. Otherwise honor the caller hint.
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
    lng = first;
    lat = second;
  } else if (Math.abs(second) > 90 && Math.abs(first) <= 90) {
    lat = first;
    lng = second;
  } else if (preferGeoJson) {
    lng = first;
    lat = second;
  } else {
    lat = first;
    lng = second;
  }

  return validLatLng(lat, lng) ? { lat, lng } : undefined;
}

function parseObjectCoordinate(value: Record<string, unknown>): GpsPoint | undefined {
  const lat =
    finiteNumber(value.latitude) ??
    finiteNumber(value.lat) ??
    finiteNumber(value.y);

  const lng =
    finiteNumber(value.longitude) ??
    finiteNumber(value.lng) ??
    finiteNumber(value.lon) ??
    finiteNumber(value.long) ??
    finiteNumber(value.x);

  if (!validLatLng(lat, lng)) return undefined;

  const timestamp = normalizeTimestamp(
    value.timestamp ??
      value.locationTimestamp ??
      value.lastUpdated ??
      value.updatedAt ??
      value.time ??
      value.createdAt,
  );

  const heading =
    finiteNumber(value.heading) ??
    finiteNumber(value.bearing) ??
    finiteNumber(value.course) ??
    finiteNumber(value.direction);

  const speedMps =
    finiteNumber(value.speedMps) ??
    finiteNumber(value.speed) ??
    finiteNumber(value.velocity);

  const accuracyMeters =
    finiteNumber(value.accuracyMeters) ?? finiteNumber(value.accuracy);

  return {
    lat: lat!,
    lng: lng!,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(heading !== undefined ? { heading } : {}),
    ...(speedMps !== undefined ? { speedMps } : {}),
    ...(accuracyMeters !== undefined ? { accuracyMeters } : {}),
  };
}

/**
 * Extracts a GPS point from the field variants commonly used by Firebase apps.
 * Supported examples:
 * - { latitude, longitude }
 * - { lat, lng }
 * - { location: { latitude, longitude } }
 * - { gps: { lat, lng } }
 * - { coords: { latitude, longitude } }
 * - GeoJSON-like { coordinates: [lng, lat] }
 */
export function extractGpsPoint(value: unknown): GpsPoint | undefined {
  if (!value) return undefined;

  if (Array.isArray(value)) {
    return parseArrayCoordinate(value, false);
  }

  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const direct = parseObjectCoordinate(record);
  if (direct) return direct;

  const nestedKeys = [
    "location",
    "currentLocation",
    "lastLocation",
    "gps",
    "position",
    "coords",
    "coordinate",
  ];

  for (const key of nestedKeys) {
    const nested = record[key];
    if (!nested) continue;
    const parsed = extractGpsPoint(nested);
    if (parsed) {
      return {
        ...parsed,
        timestamp:
          parsed.timestamp ??
          normalizeTimestamp(
            record.timestamp ??
              record.lastUpdated ??
              record.updatedAt ??
              record.locationTimestamp,
          ),
      };
    }
  }

  if (Array.isArray(record.coordinates)) {
    const parsed = parseArrayCoordinate(record.coordinates, true);
    if (parsed) {
      return {
        ...parsed,
        timestamp: normalizeTimestamp(
          record.timestamp ?? record.lastUpdated ?? record.updatedAt,
        ),
      };
    }
  }

  return undefined;
}

function orderedValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  const entries = Object.entries(value as Record<string, unknown>);
  const numeric = entries.every(([key]) => /^\d+$/.test(key));

  if (numeric) {
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, item]) => item);
  }

  return entries.map(([, item]) => item);
}

function parsePointCollection(
  value: unknown,
  preferGeoJson = false,
): GpsPoint[] {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      return parsePointCollection(JSON.parse(value), preferGeoJson);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    const single = parseArrayCoordinate(value, preferGeoJson);
    if (single) return [single];

    return value
      .map((item) => {
        if (Array.isArray(item)) {
          return parseArrayCoordinate(item, preferGeoJson);
        }
        return extractGpsPoint(item);
      })
      .filter((item): item is GpsPoint => Boolean(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.coordinates)) {
      const coordinates = record.coordinates;
      const onePoint = parseArrayCoordinate(coordinates, true);
      if (onePoint) return [onePoint];
      return parsePointCollection(coordinates, true);
    }

    const direct = extractGpsPoint(record);
    if (direct) return [direct];

    return orderedValues(record)
      .map((item) => extractGpsPoint(item))
      .filter((item): item is GpsPoint => Boolean(item));
  }

  return [];
}

/**
 * Extract route coordinates without assuming one exact database schema.
 * The first usable route field wins.
 */
export function extractRoutePoints(route: unknown): GpsPoint[] {
  if (!route || typeof route !== "object") return [];
  const record = route as Record<string, unknown>;

  const candidates: Array<{ value: unknown; geoJson?: boolean }> = [
    { value: (record.geometry as any)?.coordinates, geoJson: true },
    { value: (record.geoJson as any)?.geometry?.coordinates, geoJson: true },
    { value: record.coordinates, geoJson: true },
    { value: record.routePoints },
    { value: record.points },
    { value: record.waypoints },
    { value: record.path },
    { value: record.polyline },
    { value: record.stops },
  ];

  for (const candidate of candidates) {
    const points = parsePointCollection(candidate.value, candidate.geoJson);
    if (points.length >= 2) {
      const deduped: GpsPoint[] = [];
      points.forEach((point) => {
        const previous = deduped[deduped.length - 1];
        if (
          !previous ||
          Math.abs(previous.lat - point.lat) > 1e-8 ||
          Math.abs(previous.lng - point.lng) > 1e-8
        ) {
          deduped.push(point);
        }
      });
      if (deduped.length >= 2) return deduped;
    }
  }

  return [];
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toLocalMeters(point: GpsPoint, origin: GpsPoint) {
  const avgLat = degreesToRadians((point.lat + origin.lat) / 2);
  const east =
    degreesToRadians(point.lng - origin.lng) * EARTH_RADIUS_M * Math.cos(avgLat);
  const north = degreesToRadians(point.lat - origin.lat) * EARTH_RADIUS_M;
  return { x: east, z: north };
}

export function distanceMeters(a: GpsPoint, b: GpsPoint) {
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = degreesToRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function gpsDeltaMeters(from: GpsPoint, to: GpsPoint) {
  const local = toLocalMeters(to, from);
  return {
    east: local.x,
    north: local.z,
    distance: Math.hypot(local.x, local.z),
  };
}

/**
 * Project the live GPS point onto the route and transform the route into a
 * compact hero-scene coordinate system. The route is rotated so its overall
 * direction runs left-to-right, preserving turns while fitting the dashboard.
 */
export function projectGpsToRouteScene(
  gps: GpsPoint,
  route: GpsPoint[],
): RouteSceneProjection | undefined {
  if (route.length < 2) return undefined;

  const origin = route[0];
  const localRoute = route.map((point) => toLocalMeters(point, origin));
  const localGps = toLocalMeters(gps, origin);

  const cumulative: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < localRoute.length; i += 1) {
    totalLength += Math.hypot(
      localRoute[i].x - localRoute[i - 1].x,
      localRoute[i].z - localRoute[i - 1].z,
    );
    cumulative.push(totalLength);
  }
  if (totalLength < 0.5) return undefined;

  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestPoint = localRoute[0];
  let bestSegment = 0;
  let bestT = 0;

  for (let i = 0; i < localRoute.length - 1; i += 1) {
    const a = localRoute[i];
    const b = localRoute[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const lengthSq = vx * vx + vz * vz;
    if (lengthSq < 1e-9) continue;

    const t = Math.max(
      0,
      Math.min(
        1,
        ((localGps.x - a.x) * vx + (localGps.z - a.z) * vz) / lengthSq,
      ),
    );

    const px = a.x + vx * t;
    const pz = a.z + vz * t;
    const dx = localGps.x - px;
    const dz = localGps.z - pz;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPoint = { x: px, z: pz };
      bestSegment = i;
      bestT = t;
    }
  }

  const start = localRoute[0];
  const end = localRoute[localRoute.length - 1];
  let mainDx = end.x - start.x;
  let mainDz = end.z - start.z;

  if (Math.hypot(mainDx, mainDz) < 1) {
    const firstSegment = localRoute[1];
    mainDx = firstSegment.x - start.x;
    mainDz = firstSegment.z - start.z;
  }

  const routeAngle = Math.atan2(mainDz, mainDx);
  const cos = Math.cos(-routeAngle);
  const sin = Math.sin(-routeAngle);

  const rotate = (point: { x: number; z: number }) => ({
    x: point.x * cos - point.z * sin,
    z: point.x * sin + point.z * cos,
  });

  const rotatedRoute = localRoute.map(rotate);
  const rotatedPoint = rotate(bestPoint);

  const minX = Math.min(...rotatedRoute.map((point) => point.x));
  const maxX = Math.max(...rotatedRoute.map((point) => point.x));
  const minZ = Math.min(...rotatedRoute.map((point) => point.z));
  const maxZ = Math.max(...rotatedRoute.map((point) => point.z));

  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  const scale = Math.min(6.4 / width, 1.55 / depth);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const segmentA = rotate(localRoute[bestSegment]);
  const segmentB = rotate(localRoute[Math.min(bestSegment + 1, localRoute.length - 1)]);
  const directionX = segmentB.x - segmentA.x;
  const directionZ = segmentB.z - segmentA.z;

  // The truck model faces +X. Three.js positive Y rotation turns +X toward -Z.
  const yaw = Math.atan2(-directionZ, directionX);

  const segmentLength = Math.hypot(
    localRoute[bestSegment + 1].x - localRoute[bestSegment].x,
    localRoute[bestSegment + 1].z - localRoute[bestSegment].z,
  );
  const traveled = cumulative[bestSegment] + segmentLength * bestT;

  return {
    x: (rotatedPoint.x - centerX) * scale + 0.45,
    z: (rotatedPoint.z - centerZ) * scale + 0.35,
    yaw,
    fraction: Math.max(0, Math.min(1, traveled / totalLength)),
    crossTrackMeters: Math.sqrt(bestDistanceSq),
  };
}
