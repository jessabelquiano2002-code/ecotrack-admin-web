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

/** Reads both the new explicit schedule.areas schema and older schedule fields. */
export function extractCoverageAreas(schedule = {}) {
  const explicit = objectValues(schedule.areas)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      barangay: String(item.barangay ?? item.assignedBarangay ?? "").trim(),
      purok: String(item.purok ?? item.assignedPurok ?? "").trim(),
    }))
    .filter((item) => normalizeBarangay(item.barangay));

  if (explicit.length) return dedupeAreas(explicit);

  const barangays = [
    ...stringsFrom(schedule.barangays),
    ...stringsFrom(schedule.barangayKeys).map((value) => value.replace(/_/g, " ")),
    ...stringsFrom(schedule.barangay),
    ...stringsFrom(schedule.assignedBarangay),
  ];
  const puroks = [
    ...stringsFrom(schedule.assignedPuroks),
    ...stringsFrom(schedule.puroks),
    ...stringsFrom(schedule.purok),
    ...stringsFrom(schedule.targetPurok),
  ].filter((value) => !/^all( puroks?)?$/i.test(value));

  const result = [];
  for (const barangay of barangays) {
    if (!puroks.length) result.push({ barangay, purok: "" });
    else for (const purok of puroks) result.push({ barangay, purok });
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

