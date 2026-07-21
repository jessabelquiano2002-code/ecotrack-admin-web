export type LngLatTuple = [number, number];

export type RouteCheckpoint = {
  id?: string;
  lat: number;
  lng: number;
  label?: string;
  purok?: string;
};

export type GpsPoint = {
  lat: number;
  lng: number;
  timestamp?: number;
  accuracy?: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

const radians = (value: number) => (value * Math.PI) / 180;

export function distanceMeters(left: GpsPoint, right: GpsPoint): number {
  const dLat = radians(right.lat - left.lat);
  const dLng = radians(right.lng - left.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(left.lat)) *
      Math.cos(radians(right.lat)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function project(point: GpsPoint, referenceLatitude: number) {
  return {
    x: radians(point.lng) * EARTH_RADIUS_METERS * Math.cos(radians(referenceLatitude)),
    y: radians(point.lat) * EARTH_RADIUS_METERS,
  };
}

export function distanceToSegmentMeters(
  point: GpsPoint,
  start: GpsPoint,
  end: GpsPoint,
): number {
  const referenceLatitude = (point.lat + start.lat + end.lat) / 3;
  const p = project(point, referenceLatitude);
  const a = project(start, referenceLatitude);
  const b = project(end, referenceLatitude);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const ratio = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy));
}

export function normalizeCoordinates(route: Record<string, unknown> | null | undefined): LngLatTuple[] {
  if (!route) return [];
  const geometry = route.geometry as { coordinates?: unknown } | undefined;
  const candidates = route.coordinates ?? route.routeCoordinates ?? route.path ?? geometry?.coordinates;

  if (Array.isArray(candidates)) {
    return candidates
      .map((entry): LngLatTuple | null => {
        if (Array.isArray(entry) && entry.length >= 2) {
          const lng = Number(entry[0]);
          const lat = Number(entry[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
        }
        if (entry && typeof entry === "object") {
          const raw = entry as Record<string, unknown>;
          const lat = Number(raw.lat ?? raw.latitude);
          const lng = Number(raw.lng ?? raw.longitude);
          return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
        }
        return null;
      })
      .filter((entry): entry is LngLatTuple => entry !== null);
  }

  const checkpoints = normalizeCheckpoints(route.checkpoints);
  return checkpoints.map((checkpoint) => [checkpoint.lng, checkpoint.lat]);
}

export function normalizeCheckpoints(value: unknown): RouteCheckpoint[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];

  return list
    .map((entry, index): RouteCheckpoint | null => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const lat = Number(raw.lat ?? raw.latitude);
      const lng = Number(raw.lng ?? raw.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: String(raw.id || `checkpoint-${index + 1}`),
        lat,
        lng,
        label: String(raw.label || `Checkpoint ${index + 1}`),
        purok: String(raw.purok || ""),
      };
    })
    .filter((entry): entry is RouteCheckpoint => entry !== null);
}

export function routeDistanceMeters(coordinates: LngLatTuple[]): number {
  return coordinates.slice(1).reduce((sum, coordinate, index) => {
    const previous = coordinates[index];
    return sum + distanceMeters(
      { lat: previous[1], lng: previous[0] },
      { lat: coordinate[1], lng: coordinate[0] },
    );
  }, 0);
}

export function nearestRouteDistanceMeters(point: GpsPoint, coordinates: LngLatTuple[]): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  if (coordinates.length === 1) {
    return distanceMeters(point, { lat: coordinates[0][1], lng: coordinates[0][0] });
  }
  return Math.min(
    ...coordinates.slice(1).map((coordinate, index) =>
      distanceToSegmentMeters(
        point,
        { lat: coordinates[index][1], lng: coordinates[index][0] },
        { lat: coordinate[1], lng: coordinate[0] },
      ),
    ),
  );
}

export function evaluateRouteCoverage({
  coordinates,
  checkpoints,
  points,
  toleranceMeters,
}: {
  coordinates: LngLatTuple[];
  checkpoints: RouteCheckpoint[];
  points: GpsPoint[];
  toleranceMeters: number;
}) {
  const passedSegments: number[] = [];
  for (let index = 0; index < Math.max(0, coordinates.length - 1); index += 1) {
    const start = { lat: coordinates[index][1], lng: coordinates[index][0] };
    const end = { lat: coordinates[index + 1][1], lng: coordinates[index + 1][0] };
    if (points.some((point) => distanceToSegmentMeters(point, start, end) <= toleranceMeters)) {
      passedSegments.push(index);
    }
  }

  const passedCheckpoints = checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) =>
      points.some((point) => distanceMeters(point, checkpoint) <= toleranceMeters),
    )
    .map(({ index }) => index);

  const totalUnits = Math.max(1, Math.max(0, coordinates.length - 1) + checkpoints.length);
  const passedUnits = passedSegments.length + passedCheckpoints.length;
  const progress = Math.min(100, Math.round((passedUnits / totalUnits) * 100));
  const currentPoint = points.at(-1);
  const currentDistance = currentPoint
    ? nearestRouteDistanceMeters(currentPoint, coordinates)
    : Number.POSITIVE_INFINITY;

  return {
    passedSegments,
    passedCheckpoints,
    progress,
    currentDistance,
    onRoute: Number.isFinite(currentDistance) && currentDistance <= toleranceMeters,
  };
}
