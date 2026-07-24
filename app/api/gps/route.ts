import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireDriver } from "../../../lib/serverAuth";
import { distanceMeters, type GpsPoint } from "../../../lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_MIN_DISTANCE_METERS = 15;
const HISTORY_MAX_INTERVAL_MS = 20_000;
const MAX_ACCEPTED_ACCURACY_METERS = 100;

type RoutePointPayload = {
  scheduleId?: string;
  routeId?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  event?: "point" | "finish";
};

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
    const accuracy = Math.max(0, Number(body.accuracy || 0));
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
    const routeBarangay = String(
      route.barangay ||
        (Array.isArray(route.barangays) ? route.barangays[0] : "") ||
        schedule.barangay ||
        "",
    );

    const assignedPuroks = normalizeStringArray(
      schedule.assignedPuroks || schedule.puroks || route.puroks,
    );

    const activeReference = adminDb.ref(
      `active_route_sessions/${driver.uid}`,
    );
    const activeSnapshot = await activeReference.get();
    const active = activeSnapshot.val() as {
      sessionId?: string;
      scheduleId?: string;
    } | null;

    let sessionId =
      active?.scheduleId === scheduleId
        ? String(active.sessionId || "")
        : "";

    const now = Date.now();

    if (!sessionId) {
      sessionId =
        adminDb.ref(`route_sessions/${scheduleId}`).push().key ||
        `session-${now}`;

      await adminDb.ref(`route_sessions/${scheduleId}/${sessionId}`).set({
        sessionId,
        scheduleId,
        routeId,
        routeName: route.routeName || schedule.routeName || "Collection route",
        routeType: "service-area",
        trackingMode: "barangay-purok",
        driverId: driver.uid,
        driverName: schedule.driverName || route.assignedDriverName || "",
        truckId: schedule.truckId || route.assignedVehicle || "",
        barangay: routeBarangay,
        assignedPuroks,
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
    }

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

    const lastRecorded = session.lastRecordedPoint as GpsPoint | undefined;
    const distanceFromLast = lastRecorded
      ? distanceMeters(lastRecorded, point)
      : Number.POSITIVE_INFINITY;
    const timeFromLast = lastRecorded?.timestamp
      ? timestamp - lastRecorded.timestamp
      : Number.POSITIVE_INFINITY;
    const accurateEnough =
      accuracy === 0 || accuracy <= MAX_ACCEPTED_ACCURACY_METERS;
    const shouldRecord =
      accurateEnough &&
      (distanceFromLast >= HISTORY_MIN_DISTANCE_METERS ||
        timeFromLast >= HISTORY_MAX_INTERVAL_MS);

    const latestLocation = {
      driverId: driver.uid,
      latitude: lat,
      longitude: lng,
      lat,
      lng,
      accuracy,
      speed: Number(body.speed || 0),
      heading: Number(body.heading || 0),
      timestamp,
      lastUpdated: now,
      scheduleId,
      routeId,
      sessionId,
      barangay: routeBarangay,
      puroks: assignedPuroks,
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
    const status = finishRequested ? "Completed" : "Ongoing";
    const progress = finishRequested ? 100 : 0;
    const visitedPuroks = finishRequested ? assignedPuroks : [];

    const updates: Record<string, unknown> = {
      status,
      routeStatus: status,
      progress,
      routeProgress: progress,
      routeType: "service-area",
      trackingMode: "barangay-purok",
      barangay: routeBarangay,
      assignedPuroks,
      visitedPuroks: Object.fromEntries(
        visitedPuroks.map((purok) => [purok, true]),
      ),
      routePassed: finishRequested,
      allPuroksVisited: finishRequested,
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

      const report = {
        reportId: sessionId,
        scheduleId,
        routeId,
        routeName:
          route.routeName || schedule.routeName || "Collection route",
        scheduleName: schedule.title || "Collection schedule",
        routeType: "service-area",
        trackingMode: "barangay-purok",
        driverId: driver.uid,
        driverName: schedule.driverName || route.assignedDriverName || "",
        truckId: schedule.truckId || route.assignedVehicle || "",
        barangay: routeBarangay,
        puroks: assignedPuroks,
        status: "completed",
        collectionStatus: "completed",
        source: "driver_gps_session",
        routeProgress: 100,
        routePassed: true,
        visitedPuroks: assignedPuroks,
        startTime,
        completedAt: timestamp,
        distanceTravelledMeters: Math.round(travelledDistance),
        durationSeconds: Math.max(
          0,
          Math.round((timestamp - startTime) / 1000),
        ),
        timestamp,
      };

      await Promise.all([
        adminDb.ref(`collection_reports/${sessionId}`).set(report),
        adminDb.ref(`schedules/${scheduleId}`).update({
          status: recurringSchedule ? "active" : "completed",
          lastRunStatus: "completed",
          lastCompletedAt: timestamp,
          lastCompletedDate: dateKey,
          lastCollectionReportId: sessionId,
          routeProgress: 100,
          routeStatus: "Completed",
          updatedAt: now,
        }),
      ]);
    }

    return NextResponse.json({
      success: true,
      recordedInHistory: shouldRecord,
      ignoredForAccuracy: !accurateEnough,
      sessionId,
      routeStatus: status,
      routeProgress: progress,
      routePassed: finishRequested,
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
