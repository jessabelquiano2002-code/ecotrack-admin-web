import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireDriver } from "../../../lib/serverAuth";
import {
  distanceMeters,
  evaluateRouteCoverage,
  normalizeCheckpoints,
  normalizeCoordinates,
  routeDistanceMeters,
  type GpsPoint,
} from "../../../lib/geo";

const HISTORY_MIN_DISTANCE_METERS = 15;
const HISTORY_MAX_INTERVAL_MS = 20_000;
const MAX_ACCEPTED_ACCURACY_METERS = 100;
const BASE_ROUTE_TOLERANCE_METERS = 35;

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

const normalizePurok = (value: unknown) => String(value || "").trim().toLowerCase();

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(String).filter(Boolean);
  if (value) return [String(value)];
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    const body = (await request.json()) as RoutePointPayload;
    const scheduleId = String(body.scheduleId || "").trim();
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const accuracy = Math.max(0, Number(body.accuracy || 0));
    const timestamp = Number.isFinite(Number(body.timestamp)) ? Number(body.timestamp) : Date.now();

    if (!scheduleId) return NextResponse.json({ error: "scheduleId is required." }, { status: 400 });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "Valid GPS coordinates are required." }, { status: 400 });
    }

    const scheduleSnapshot = await adminDb.ref(`schedules/${scheduleId}`).get();
    if (!scheduleSnapshot.exists()) return NextResponse.json({ error: "Schedule was not found." }, { status: 404 });
    const schedule = scheduleSnapshot.val() as Record<string, unknown>;
    const assignedDriverId = String(schedule.assignedDriverId || schedule.driverId || "");
    if (assignedDriverId !== driver.uid) return NextResponse.json({ error: "This schedule is assigned to another driver." }, { status: 403 });

    const routeId = String(body.routeId || schedule.routeId || schedule.assignedRouteId || "");
    if (!routeId) return NextResponse.json({ error: "The schedule has no assigned route." }, { status: 409 });
    const routeSnapshot = await adminDb.ref(`routes/${routeId}`).get();
    if (!routeSnapshot.exists()) return NextResponse.json({ error: "Assigned route was not found." }, { status: 404 });
    const route = routeSnapshot.val() as Record<string, unknown>;
    const coordinates = normalizeCoordinates(route);
    const checkpoints = normalizeCheckpoints(route.checkpoints);
    if (coordinates.length < 2 || checkpoints.length < 2) {
      return NextResponse.json({ error: "The assigned route needs at least two GPS checkpoints." }, { status: 409 });
    }

    const activeRef = adminDb.ref(`active_route_sessions/${driver.uid}`);
    const activeSnapshot = await activeRef.get();
    let active = activeSnapshot.val() as { sessionId?: string; scheduleId?: string } | null;
    let sessionId = active?.scheduleId === scheduleId ? String(active.sessionId || "") : "";
    const now = Date.now();

    if (!sessionId) {
      sessionId = adminDb.ref(`route_sessions/${scheduleId}`).push().key || `session-${now}`;
      await adminDb.ref(`route_sessions/${scheduleId}/${sessionId}`).set({
        sessionId,
        scheduleId,
        routeId,
        driverId: driver.uid,
        driverName: schedule.driverName || "",
        truckId: schedule.truckId || "",
        assignedPuroks: schedule.assignedPuroks || schedule.puroks || [],
        status: "Ongoing",
        progress: 0,
        startTime: timestamp,
        createdAt: now,
        updatedAt: now,
      });
      active = { sessionId, scheduleId };
      await activeRef.set({ sessionId, scheduleId, routeId, startedAt: timestamp });
    }

    const sessionRef = adminDb.ref(`route_sessions/${scheduleId}/${sessionId}`);
    const sessionSnapshot = await sessionRef.get();
    const session = (sessionSnapshot.val() || {}) as Record<string, unknown>;
    const point: GpsPoint = { lat, lng, timestamp, accuracy };
    const lastRecorded = session.lastRecordedPoint as GpsPoint | undefined;
    const distanceFromLast = lastRecorded ? distanceMeters(lastRecorded, point) : Number.POSITIVE_INFINITY;
    const timeFromLast = lastRecorded?.timestamp ? timestamp - lastRecorded.timestamp : Number.POSITIVE_INFINITY;
    const accurateEnough = accuracy === 0 || accuracy <= MAX_ACCEPTED_ACCURACY_METERS;
    const shouldRecord = accurateEnough && (distanceFromLast >= HISTORY_MIN_DISTANCE_METERS || timeFromLast >= HISTORY_MAX_INTERVAL_MS);
    const tolerance = Math.max(BASE_ROUTE_TOLERANCE_METERS, Math.min(60, accuracy || BASE_ROUTE_TOLERANCE_METERS));

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
      locationQuality: accurateEnough ? "accepted" : "inaccurate",
    };
    await adminDb.ref(`driver_locations/${driver.uid}`).update(latestLocation);

    if (shouldRecord) {
      const pointRef = adminDb.ref(`gps_route_history/${scheduleId}/${sessionId}/points`).push();
      await pointRef.set({ ...latestLocation, pointId: pointRef.key, recordedAt: now });
    }

    const historySnapshot = await adminDb.ref(`gps_route_history/${scheduleId}/${sessionId}/points`).get();
    const historyData = (historySnapshot.val() || {}) as Record<string, Record<string, unknown>>;
    const historyPoints = Object.values(historyData)
      .map((raw): GpsPoint | null => {
        const pointLat = Number(raw.latitude ?? raw.lat);
        const pointLng = Number(raw.longitude ?? raw.lng);
        return Number.isFinite(pointLat) && Number.isFinite(pointLng)
          ? { lat: pointLat, lng: pointLng, timestamp: Number(raw.timestamp || 0), accuracy: Number(raw.accuracy || 0) }
          : null;
      })
      .filter((entry): entry is GpsPoint => entry !== null)
      .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));

    if (accurateEnough && (historyPoints.length === 0 || historyPoints.at(-1)?.timestamp !== timestamp)) {
      historyPoints.push(point);
    }

    const coverage = evaluateRouteCoverage({ coordinates, checkpoints, points: historyPoints, toleranceMeters: tolerance });
    const assignedPuroks = normalizeStringArray(schedule.assignedPuroks || schedule.puroks || route.puroks);
    const visitedPuroks = assignedPuroks.filter((purok) =>
      coverage.passedCheckpoints.some((index) => normalizePurok(checkpoints[index]?.purok) === normalizePurok(purok)),
    );
    const allPuroksVisited = assignedPuroks.length === 0 || visitedPuroks.length === assignedPuroks.length;
    const routePassed = coverage.progress === 100 && allPuroksVisited;
    const finishRequested = body.event === "finish";
    const status = routePassed
      ? "Completed"
      : finishRequested
        ? coverage.progress > 0
          ? "Partially Completed"
          : "Missed Route"
        : coverage.onRoute
          ? historyPoints.length <= 1
            ? "Ongoing"
            : "On Route"
          : "Deviated from Route";

    const travelledDistance = historyPoints.slice(1).reduce((sum, current, index) => sum + distanceMeters(historyPoints[index], current), 0);
    const startTime = Number(session.startTime || timestamp);
    const updates: Record<string, unknown> = {
      status,
      routeStatus: status,
      progress: coverage.progress,
      routeProgress: coverage.progress,
      passedSegments: Object.fromEntries(coverage.passedSegments.map((index) => [index, true])),
      passedCheckpoints: Object.fromEntries(coverage.passedCheckpoints.map((index) => [index, true])),
      visitedPuroks: Object.fromEntries(visitedPuroks.map((purok) => [purok, true])),
      assignedPuroks,
      allPuroksVisited,
      routePassed,
      toleranceMeters: tolerance,
      totalRouteDistanceMeters: Math.round(routeDistanceMeters(coordinates)),
      distanceTravelledMeters: Math.round(travelledDistance),
      durationSeconds: Math.max(0, Math.round((timestamp - startTime) / 1000)),
      lastLocation: latestLocation,
      lastRecordedPoint: shouldRecord ? point : session.lastRecordedPoint || null,
      lastUpdateTime: timestamp,
      updatedAt: now,
    };

    if (routePassed || finishRequested) {
      updates.completionTime = timestamp;
      updates.completedAt = timestamp;
      await activeRef.remove();
    }
    await sessionRef.update(updates);

    if (routePassed) {
      const dateKey = new Date(timestamp).toISOString().slice(0, 10);
      const recurringSchedule = schedule.isRecurring === true
        || String(schedule.scheduleType || "").toLowerCase() === "weekly"
        || String(schedule.repeat || "").toLowerCase() === "weekly";
      const report = {
        reportId: sessionId,
        scheduleId,
        routeId,
        routeName: route.routeName || schedule.title || "Collection route",
        scheduleName: schedule.title || "Collection schedule",
        driverId: driver.uid,
        driverName: schedule.driverName || "",
        truckId: schedule.truckId || "",
        barangay: schedule.barangay || "",
        puroks: assignedPuroks,
        status: "completed",
        collectionStatus: "completed",
        source: "gps_route_verification",
        routeProgress: 100,
        routePassed: true,
        visitedPuroks,
        startTime,
        completedAt: timestamp,
        distanceTravelledMeters: Math.round(travelledDistance),
        durationSeconds: Math.max(0, Math.round((timestamp - startTime) / 1000)),
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
      routeProgress: coverage.progress,
      routePassed,
      visitedPuroks,
      toleranceMeters: tolerance,
    });
  } catch (error: unknown) {
    const status = authErrorStatus(error);
    const message = error instanceof Error ? error.message : "Unable to record GPS point.";
    return NextResponse.json({ error: status === 500 ? message : "Not authorized." }, { status });
  }
}
