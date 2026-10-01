const ALLOWED_APPROACH_METERS = new Set([500, 1000, 2000, 3000, 4000, 5000]);

export const ARRIVAL_DISTANCE_METERS = 100;

/**
 * Keep server-side ARRIVED detection aligned with the Resident Android
 * TruckArrivalAlertPolicy.NEAR stage.  This is critical for closed-app
 * delivery because ResidentHomeActivity is not running to calculate distance.
 *
 * 500 m selected distance  -> 100 m arrival/near boundary
 * 1 km or more             -> 150 m arrival/near boundary
 */
export function arrivalDistanceMeters(configuredDistance) {
  const threshold = Math.max(100, Number(configuredDistance) || 500);
  return Math.min(150, Math.max(75, threshold * 0.20));
}

export function normalizeBarangay(value) {
  let key = String(value ?? "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/brgy/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  if (key === "13" || key === "poblacion13") key = "poblacion_13";
  if (key === "guindapunan" || key === "gundaponan") key = "guindaponan";
  return key;
}

export function normalizePurok(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return "";
  const digits = clean.replace(/[^0-9]/g, "");
  return digits ? `purok_${Number.parseInt(digits, 10)}` : clean
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function objectValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((item) => item != null);
  if (typeof value !== "object") return [value];

  const result = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === true) result.push(key);
    else if (item !== false && item != null) result.push(item);
  }
  return result;
}

function stringsFrom(value) {
  return objectValues(value)
    .flatMap((item) => {
      if (typeof item === "string" && /[,;|]/.test(item)) {
        return item.split(/[,;|]+/g);
      }
      return [item];
    })
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

/**
 * Reads coverage the same way /api/gps does, so both endpoints agree on which
 * Barangay/Purok a schedule serves:
 *   1) schedule.areas (explicit)
 *   2) route.areas   (explicit, stored on the route instead of the schedule)
 *   3) legacy arrays: schedule.barangays/barangay/... x schedule.puroks/...
 *      and finally route.barangays/barangay x route.puroks
 */
export function extractCoverageAreas(schedule = {}, route = {}) {
  schedule = schedule && typeof schedule === "object" ? schedule : {};
  route = route && typeof route === "object" ? route : {};

  const explicitFrom = (source) => objectValues(source)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      barangay: String(item.barangay ?? item.assignedBarangay ?? "").trim(),
      purok: String(item.purok ?? item.assignedPurok ?? "").trim(),
    }))
    .filter((item) => normalizeBarangay(item.barangay));

  const scheduleExplicit = explicitFrom(schedule.areas);
  if (scheduleExplicit.length) return dedupeAreas(scheduleExplicit);

  const routeExplicit = explicitFrom(route.areas);
  if (routeExplicit.length) return dedupeAreas(routeExplicit);

  const barangays = [
    ...stringsFrom(schedule.barangays),
    ...stringsFrom(schedule.barangayKeys).map((value) => value.replace(/_/g, " ")),
    ...stringsFrom(schedule.barangay),
    ...stringsFrom(schedule.assignedBarangay),
  ];
  // /api/gps falls back to the route's barangays when the schedule has none.
  if (!barangays.length) {
    barangays.push(
      ...stringsFrom(route.barangays),
      ...stringsFrom(route.barangay),
    );
  }

  const puroks = [
    ...stringsFrom(schedule.assignedPuroks),
    ...stringsFrom(schedule.puroks),
    ...stringsFrom(schedule.purok),
    ...stringsFrom(schedule.targetPurok),
  ];
  if (!puroks.length) puroks.push(...stringsFrom(route.puroks));
  const specificPuroks = puroks.filter((value) => !/^all( puroks?)?$/i.test(value));

  const result = [];
  for (const barangay of barangays) {
    if (!specificPuroks.length) result.push({ barangay, purok: "" });
    else for (const purok of specificPuroks) result.push({ barangay, purok });
  }
  return dedupeAreas(result);
}

function dedupeAreas(areas) {
  const byKey = new Map();
  for (const area of areas) {
    const barangayKey = normalizeBarangay(area.barangay);
    const purokKey = normalizePurok(area.purok);
    if (!barangayKey) continue;
    const key = `${barangayKey}|${purokKey}`;
    if (!byKey.has(key)) byKey.set(key, { ...area, barangayKey, purokKey });
  }
  return [...byKey.values()];
}

export function matchesCoverage(tokenRecord, coverageAreas) {
  const barangayKey = normalizeBarangay(
    tokenRecord?.barangayKey || tokenRecord?.barangay,
  );
  const purokKey = normalizePurok(
    tokenRecord?.purokLabel || tokenRecord?.purok,
  );
  if (!barangayKey || !coverageAreas.length) return false;

  return coverageAreas.some((area) => {
    if (area.barangayKey !== barangayKey) return false;
    return !area.purokKey || !purokKey || area.purokKey === purokKey;
  });
}

export function approachDistanceMeters(tokenRecord) {
  const value = Number(tokenRecord?.approachDistanceMeters);
  return ALLOWED_APPROACH_METERS.has(value) ? value : 500;
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map(Number);
  if (!values.every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const [aLat, aLng, bLat, bLng] = values;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * sinLng * sinLng;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function proximityStage(distance, configuredDistance) {
  if (!Number.isFinite(distance) || distance < 0) return null;

  const threshold = Math.max(100, Number(configuredDistance) || 500);
  const arrivalThreshold = arrivalDistanceMeters(threshold);

  if (distance <= arrivalThreshold) return "arrived";
  if (distance <= threshold) return "approaching";
  return null;
}

export function formatDistance(distance) {
  const meters = Math.max(0, Math.round(Number(distance) || 0));
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
}

export function safeKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.#$\[\]/]/g, "_")
    .slice(0, 180);
}


export function manilaDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function overrideIsActive(override) {
  const status = String(override?.status || "active").trim().toLowerCase();
  return !["cancelled", "inactive", "removed"].includes(status);
}

function trimmed(value) {
  return String(value ?? "").trim();
}

/**
 * Resolves who is allowed to run this schedule on `dateKey` (Asia/Manila).
 * MUST stay identical to effectiveScheduleDriverId() in /api/gps/route.ts and
 * DriverAssignmentRepository.effectiveDriverId() in the driver app:
 *   1) exact driverOverrides/{dateKey} with a substituteDriverId
 *   2) any active override whose `date` or rangeStartDate..rangeEndDate matches
 *   3) assignedDriverId / driverId / defaultDriverId
 */
export function effectiveScheduleDriverId(schedule, dateKey) {
  const overrides =
    schedule && typeof schedule.driverOverrides === "object" && schedule.driverOverrides
      ? schedule.driverOverrides
      : {};

  const exact = overrides[dateKey];
  if (exact && typeof exact === "object" && overrideIsActive(exact)) {
    const exactDriver = trimmed(exact.substituteDriverId);
    if (exactDriver) return exactDriver;
  }

  let bestDriver = "";
  let bestCreatedAt = -1;
  for (const raw of Object.values(overrides)) {
    if (!raw || typeof raw !== "object" || !overrideIsActive(raw)) continue;
    const substitute = trimmed(raw.substituteDriverId);
    if (!substitute) continue;

    const explicitDate = trimmed(raw.date);
    const from = trimmed(raw.rangeStartDate);
    const until = trimmed(raw.rangeEndDate);
    const matches =
      explicitDate === dateKey
      || (from && until && dateKey >= from && dateKey <= until);
    if (!matches) continue;

    const createdAt = Number(raw.createdAt || 0);
    if (!bestDriver || createdAt >= bestCreatedAt) {
      bestDriver = substitute;
      bestCreatedAt = createdAt;
    }
  }
  if (bestDriver) return bestDriver;

  return trimmed(schedule?.assignedDriverId)
    || trimmed(schedule?.driverId)
    || trimmed(schedule?.defaultDriverId);
}
