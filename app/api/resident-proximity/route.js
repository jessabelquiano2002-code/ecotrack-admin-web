import { NextResponse } from "next/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

import {
  approachDistanceMeters,
  distanceMeters,
  extractCoverageAreas,
  formatDistance,
  matchesCoverage,
  normalizeBarangay,
  normalizePurok,
  proximityStage,
  safeKey,
} from "./proximity-logic.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GPS_ACCURACY_METERS = 100;
const MAX_LOCATION_AGE_MS = 10 * 60 * 1000;
const MAX_RESIDENT_LIVE_LOCATION_AGE_MS = 2 * 60 * 1000;
const FCM_BATCH_SIZE = 500;

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    const json = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const account = JSON.parse(json);
    return {
      projectId: account.projectId || account.project_id,
      clientEmail: account.clientEmail || account.client_email,
      privateKey: String(account.privateKey || account.private_key || "").replace(/\\n/g, "\n"),
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  throw new Error(
    "Firebase Admin credentials are missing. Configure FIREBASE_SERVICE_ACCOUNT_JSON in Vercel.",
  );
}

function ensureFirebaseAdmin() {
  if (getApps().length) return;

  const databaseURL = (
    process.env.FIREBASE_DATABASE_URL
    || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
    || ""
  ).trim();
  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is missing in Vercel.");
  }

  initializeApp({
    credential: cert(readServiceAccount()),
    databaseURL,
  });
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function stringValue(...values) {
  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean && clean.toLowerCase() !== "null") return clean;
  }
  return "";
}

function booleanValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(true|1|yes|enabled)$/i.test(value.trim())) return true;
    if (/^(false|0|no|disabled)$/i.test(value.trim())) return false;
  }
  return fallback;
}

function routeMatchesSchedule(schedule, routeId) {
  const assignedRouteId = stringValue(
    schedule.routeId,
    schedule.assignedRouteId,
    schedule.route?.id,
  );
  return !assignedRouteId || assignedRouteId === routeId;
}

function isDriverActive(driver) {
  if (!driver || typeof driver !== "object") return false;
  if (driver.isActive === false || driver.enabled === false) return false;
  const status = stringValue(
    driver.accountStatus,
    driver.approvalStatus,
    driver.status,
  ).toLowerCase();
  return !["inactive", "disabled", "suspended", "rejected", "deleted"].includes(status);
}

function normalizedEvent(value) {
  const event = String(value ?? "point").trim().toLowerCase();
  return ["start", "point", "finish"].includes(event) ? event : "";
}

function tokenRecords(snapshotValue) {
  if (!snapshotValue || typeof snapshotValue !== "object") return [];
  return Object.entries(snapshotValue)
    .map(([deviceId, value]) => ({ deviceId, ...(value || {}) }))
    .filter((item) => stringValue(item.token));
}

function validResidentLocation(value) {
  if (!value || typeof value !== "object") return null;
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const updatedAt = Number(value.updatedAt ?? value.capturedAt ?? 0) || 0;
  return { latitude, longitude, updatedAt };
}

/**
 * Selects the resident's explicit alert-location mode.
 * LIVE uses a fresh foreground-service location when available and falls back
 * to the saved collection pin if Android has stopped updating the live point.
 * PINNED (and legacy residents with no saved mode) use collectionLocation.
 */
function configuredAlertLocation(resident) {
  const modeRaw = stringValue(
    resident?.alertLocation?.mode,
    resident?.alertLocationMode,
    "PINNED",
  ).toUpperCase();
  const mode = modeRaw === "LIVE" ? "LIVE" : "PINNED";

  const pinned = validResidentLocation(resident?.collectionLocation);
  if (mode !== "LIVE") {
    return pinned
      ? { ...pinned, mode: "PINNED", source: "pinned" }
      : null;
  }

  const live = validResidentLocation(resident?.liveLocation);
  const liveFresh = live
    && live.updatedAt > 0
    && Math.abs(Date.now() - live.updatedAt) <= MAX_RESIDENT_LIVE_LOCATION_AGE_MS;

  if (liveFresh) {
    return { ...live, mode: "LIVE", source: "live" };
  }

  return pinned
    ? { ...pinned, mode: "LIVE", source: "pinned_fallback" }
    : null;
}

function coverageLabel(areas) {
  const labels = [];
  for (const area of areas) {
    const barangay = String(area.barangay || "").trim();
    const purok = String(area.purok || "").trim();
    const label = [barangay, purok].filter(Boolean).join(" / ");
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (!labels.length) return "your assigned area";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more area(s)`;
}

function alertLocationLabel(candidate) {
  if (candidate.locationSource === "live") return "your current live location";
  if (candidate.locationSource === "pinned_fallback") return "your saved collection point";
  return "your pinned collection location";
}

function candidateMessage(candidate, routeName, areas) {
  const driverName = candidate.driverName || "MetroWaste driver";
  if (candidate.stage === "started") {
    return {
      type: "collection_started",
      title: "Collection started",
      message: `${driverName} has started the collection route for ${coverageLabel(areas)}. Please prepare your waste.`,
      ttl: 60 * 60 * 1000,
    };
  }
  if (candidate.stage === "finished") {
    return {
      type: "collection_completed",
      title: "Collection route completed",
      message: `${driverName} has completed ${routeName || "the assigned collection route"}.`,
      ttl: 60 * 60 * 1000,
    };
  }
  if (candidate.stage === "arrived") {
    return {
      type: "truck_arrival",
      title: "MetroWaste truck has arrived",
      message: `${driverName} is now near ${alertLocationLabel(candidate)}. Please bring your properly prepared waste to the designated collection point.`,
      ttl: 10 * 60 * 1000,
    };
  }
  return {
    type: "truck_approaching",
    title: "MetroWaste truck is approaching",
    message: `${driverName} is approximately ${formatDistance(candidate.distance)} from ${alertLocationLabel(candidate)}. Please prepare your properly segregated waste for collection.`,
    ttl: 15 * 60 * 1000,
  };
}

function statePath(sessionId, deviceId, stage) {
  return `push_delivery_state/${safeKey(sessionId)}/${safeKey(deviceId)}/${safeKey(stage)}`;
}

async function claimCandidate(database, candidate, context) {
  const path = statePath(context.sessionId, candidate.deviceId, candidate.stage);
  const reference = database.ref(path);
  const now = Date.now();
  const result = await reference.transaction((current) => {
    if (current != null) return;
    return {
      claimedAt: now,
      driverId: context.driverId,
      scheduleId: context.scheduleId,
      routeId: context.routeId,
      stage: candidate.stage,
    };
  }, undefined, false);
  return result.committed ? { ...candidate, statePath: path } : null;
}

async function buildCandidates({
  database,
  devices,
  coverageAreas,
  event,
  latitude,
  longitude,
  accuracy,
  driverName,
}) {
  const candidates = [];
  const matching = devices.filter((device) => {
    if (String(device.role || "resident").toLowerCase() !== "resident") return false;
    if (!booleanValue(device.enabled, true)) return false;
    return matchesCoverage(device, coverageAreas);
  });

  // Start is also attempted on ordinary points. The RTDB transaction makes it
  // one-time and recovers automatically if the first driver request was lost.
  if (event === "start" || event === "point") {
    for (const device of matching) {
      if (!booleanValue(device.collectionEnabled, true)) continue;
      candidates.push({ ...device, stage: "started", driverName });
    }
  }

  if (event === "finish") {
    for (const device of matching) {
      if (!booleanValue(device.collectionEnabled, true)) continue;
      candidates.push({ ...device, stage: "finished", driverName });
    }
    return candidates;
  }

  if (event !== "point" || accuracy > MAX_GPS_ACCURACY_METERS) return candidates;

  const residents = new Map();
  const residentIds = [...new Set(matching
    .map((device) => stringValue(device.residentId, device.uid))
    .filter(Boolean))];

  await Promise.all(residentIds.map(async (residentId) => {
    const snapshot = await database.ref(`residents/${safeKey(residentId)}`).get();
    residents.set(residentId, snapshot.val());
  }));

  for (const device of matching) {
    if (!booleanValue(device.approachEnabled, true)) continue;
    const residentId = stringValue(device.residentId, device.uid);
    if (!residentId) continue;
    const location = configuredAlertLocation(residents.get(residentId));
    if (!location) continue;

    const distance = distanceMeters(
      latitude,
      longitude,
      location.latitude,
      location.longitude,
    );
    const threshold = approachDistanceMeters(device);
    const stage = proximityStage(distance, threshold);
    if (!stage) continue;

    candidates.push({
      ...device,
      residentId,
      stage,
      distance,
      threshold,
      driverName,
      locationMode: location.mode,
      locationSource: location.source,
    });
  }

  return candidates;
}

async function sendClaimedCandidates({ database, claimed, context, coverageAreas, routeName }) {
  let sent = 0;
  let failed = 0;
  const updates = {};
  const recordedNotifications = new Set();

  for (let offset = 0; offset < claimed.length; offset += FCM_BATCH_SIZE) {
    const batch = claimed.slice(offset, offset + FCM_BATCH_SIZE);
    const messages = batch.map((candidate) => {
      const content = candidateMessage(candidate, routeName, coverageAreas);
      return {
        token: stringValue(candidate.token),
        data: {
          type: content.type,
          title: content.title,
          message: content.message,
          body: content.message,
          sessionId: context.sessionId,
          scheduleId: context.scheduleId,
          routeId: context.routeId,
          driverId: context.driverId,
          stage: candidate.stage,
          distanceMeters: Number.isFinite(candidate.distance)
            ? String(Math.round(candidate.distance))
            : "",
          triggerDistanceMeters: candidate.threshold ? String(candidate.threshold) : "",
          alertLocationMode: stringValue(candidate.locationMode),
          alertLocationSource: stringValue(candidate.locationSource),
          timestamp: String(Date.now()),
        },
        android: {
          priority: "high",
          ttl: content.ttl,
          directBootOk: true,
          collapseKey: `metrowaste-${safeKey(context.sessionId)}-${candidate.stage}`,
        },
      };
    });

    const response = await getMessaging().sendEach(messages);
    response.responses.forEach((item, index) => {
      const candidate = batch[index];
      const content = candidateMessage(candidate, routeName, coverageAreas);
      const now = Date.now();

      if (item.success) {
        sent += 1;
        updates[`${candidate.statePath}/sentAt`] = now;
        updates[`${candidate.statePath}/messageId`] = item.messageId || "";

        const notificationOwner = stringValue(
          candidate.residentId,
          candidate.uid,
          candidate.deviceId,
        );
        const notificationDedupeKey = `${notificationOwner}|${candidate.stage}`;
        const notificationId = recordedNotifications.has(notificationDedupeKey)
          ? null
          : database.ref("notifications").push().key;
        if (notificationId) {
          recordedNotifications.add(notificationDedupeKey);
          updates[`notifications/${notificationId}`] = {
            id: notificationId,
            title: content.title,
            message: content.message,
            type: content.type,
            alertStage: candidate.stage,
            targetType: "resident",
            targetResidentId: stringValue(candidate.residentId, candidate.uid),
            targetUid: stringValue(candidate.uid, candidate.residentId),
            barangay: stringValue(candidate.barangay),
            barangayKey: normalizeBarangay(candidate.barangayKey || candidate.barangay),
            purok: stringValue(candidate.purokLabel, candidate.purok),
            purokKey: normalizePurok(candidate.purokLabel || candidate.purok),
            driverId: context.driverId,
            scheduleId: context.scheduleId,
            routeId: context.routeId,
            sessionId: context.sessionId,
            distanceMeters: Number.isFinite(candidate.distance)
              ? Math.round(candidate.distance)
              : null,
            triggerDistanceMeters: candidate.threshold || null,
            alertLocationMode: stringValue(candidate.locationMode),
            alertLocationSource: stringValue(candidate.locationSource),
            seen: false,
            timestamp: now,
            createdAt: now,
            source: "vercel_fcm_dispatcher",
          };
        }
      } else {
        failed += 1;
        updates[candidate.statePath] = null;
        const code = item.error?.code || "";
        if (code === "messaging/registration-token-not-registered"
            || code === "messaging/invalid-registration-token") {
          const devicePath = `device_tokens/${safeKey(candidate.deviceId)}`;
          updates[`${devicePath}/enabled`] = false;
          updates[`${devicePath}/disabledReason`] = code;
          updates[`${devicePath}/updatedAt`] = now;

          const barangayKey = normalizeBarangay(
            candidate.barangayKey || candidate.barangay,
          );
          if (barangayKey) {
            const legacyPath = `resident_fcm_tokens/${safeKey(barangayKey)}/${safeKey(candidate.deviceId)}`;
            updates[`${legacyPath}/enabled`] = false;
            updates[`${legacyPath}/disabledReason`] = code;
            updates[`${legacyPath}/updatedAt`] = now;
          }
        }
      }
    });
  }

  if (Object.keys(updates).length) await database.ref().update(updates);
  return { sent, failed };
}

export async function POST(request) {
  try {
    ensureFirebaseAdmin();

    const token = bearerToken(request);
    if (!token) return NextResponse.json({ error: "Driver authentication is required." }, { status: 401 });

    const decoded = await getAuth().verifyIdToken(token);
    const driverId = decoded.uid;
    const body = await request.json();

    const scheduleId = stringValue(body.scheduleId);
    const routeId = stringValue(body.routeId);
    const sessionId = stringValue(body.sessionId);
    const event = normalizedEvent(body.event);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracy = Math.max(0, Number(body.accuracy) || 0);
    const timestamp = Number(body.timestamp) || Date.now();

    if (!scheduleId || !routeId || !sessionId || !event) {
      return NextResponse.json({ error: "scheduleId, routeId, sessionId and a valid event are required." }, { status: 400 });
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: "A valid GPS coordinate is required." }, { status: 400 });
    }
    if (Math.abs(Date.now() - timestamp) > MAX_LOCATION_AGE_MS) {
      return NextResponse.json({ error: "The GPS update is too old." }, { status: 400 });
    }

    const database = getDatabase();
    const [driverSnapshot, scheduleSnapshot, routeSnapshot] = await Promise.all([
      database.ref(`drivers/${safeKey(driverId)}`).get(),
      database.ref(`schedules/${safeKey(scheduleId)}`).get(),
      database.ref(`routes/${safeKey(routeId)}`).get(),
    ]);

    const driver = driverSnapshot.val();
    const schedule = scheduleSnapshot.val();
    if (!isDriverActive(driver)) {
      return NextResponse.json({ error: "The driver account is inactive or unavailable." }, { status: 403 });
    }
    if (!schedule || typeof schedule !== "object") {
      return NextResponse.json({ error: "The assigned schedule was not found." }, { status: 404 });
    }

    const assignedDriverId = stringValue(
      schedule.assignedDriverId,
      schedule.driverId,
      schedule.driverUid,
    );
    if (!assignedDriverId || assignedDriverId !== driverId) {
      return NextResponse.json({ error: "This schedule is not assigned to the signed-in driver." }, { status: 403 });
    }
    if (!routeMatchesSchedule(schedule, routeId)) {
      return NextResponse.json({ error: "The route does not match the assigned schedule." }, { status: 409 });
    }

    const coverageAreas = extractCoverageAreas(schedule);
    if (!coverageAreas.length) {
      return NextResponse.json({
        accepted: true,
        sent: 0,
        failed: 0,
        reason: "The schedule has no Barangay/Purok coverage.",
      });
    }

    const route = routeSnapshot.val() || {};
    const routeName = stringValue(route.routeName, route.name, schedule.title);
    const driverName = stringValue(driver.name, driver.fullName, decoded.name, "MetroWaste driver");
    const coverageBarangays = [...new Set(
      coverageAreas.map((area) => area.barangayKey).filter(Boolean),
    )];
    /*
     * BACKGROUND PUSH COMPATIBILITY
     *
     * The previous MetroWaste build that successfully notified residents while
     * the app was not open used resident_fcm_tokens/{barangayKey}. Keep that
     * proven registry as the PRIMARY source. Only fall back to device_tokens if
     * no Barangay-scoped token records are available.
     */
    const tokenSnapshots = await Promise.all(coverageBarangays.map((barangayKey) =>
      database.ref(`resident_fcm_tokens/${safeKey(barangayKey)}`).get(),
    ));

    const tokenMap = {};
    tokenSnapshots.forEach((snapshot) => {
      const value = snapshot.val();
      if (!value || typeof value !== "object") return;
      Object.assign(tokenMap, value);
    });

    let devices = tokenRecords(tokenMap);

    if (!devices.length) {
      const canonicalTokenSnapshot = await database.ref("device_tokens").get();
      devices = tokenRecords(canonicalTokenSnapshot.val());
    }

    const candidates = await buildCandidates({
      database,
      devices,
      coverageAreas,
      event,
      latitude,
      longitude,
      accuracy,
      driverName,
    });

    const context = { driverId, scheduleId, routeId, sessionId };
    const claimed = (await Promise.all(
      candidates.map((candidate) => claimCandidate(database, candidate, context)),
    )).filter(Boolean);

    if (!claimed.length) {
      return NextResponse.json({ accepted: true, sent: 0, failed: 0, deduplicated: true });
    }

    const result = await sendClaimedCandidates({
      database,
      claimed,
      context,
      coverageAreas,
      routeName,
    });

    return NextResponse.json({
      accepted: true,
      event,
      evaluatedDevices: devices.length,
      claimed: claimed.length,
      ...result,
    });
  } catch (error) {
    console.error("Resident proximity dispatch failed", error);
    const message = error instanceof Error ? error.message : "Resident notification failed.";
    const status = /credentials|database_url/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
