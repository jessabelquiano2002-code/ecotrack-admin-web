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
  event?: "start" | "point" | "finish";
};

type RouteCoordinate = { lat: number; lng: number };
type ServiceStop = RouteCoordinate & {
  areaKey: string;
  barangay: string;
  purok: string;
  order: number;
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
  const rawStops = orderedValues(route.checkpoints).length > 0
    ? orderedValues(route.checkpoints)
    : orderedValues(route.routePoints).filter((point) => point.type === "service");

  return rawStops.flatMap<ServiceStop>((stop, index) => {
    const lat = Number(stop.lat ?? stop.latitude);
    const lng = Number(stop.lng ?? stop.longitude);
    const barangay = String(stop.barangay || "").trim();
    const purok = String(stop.purok || "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !barangay) return [];
    const areaKey = String(stop.areaKey ||
      `${normalizeBarangayKey(barangay)}|${normalizePurokKey(purok)}`);
    return [{lat, lng, barangay, purok, areaKey, order: Number(stop.order ?? index)}];
  });
}

function isVerifiedRoute(route: Record<string, unknown>, coordinates: RouteCoordinate[], stops: ServiceStop[]) {
  const validation = asRecord(route.routeValidation || route.validation);
  const withinCatbalogan = coordinates.every((point) =>
    point.lat >= 11.68 && point.lat <= 11.86 &&
    point.lng >= 124.80 && point.lng <= 124.97);
  return route.verified === true &&
    String(validation.status || "").toLowerCase() === "verified" &&
    coordinates.length >= 2 &&
    stops.length >= 2 &&
    withinCatbalogan;
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

    if (!isVerifiedRoute(route, routeCoordinates, serviceStops)) {
      return NextResponse.json(
        {
          error:
            "This route is not ready. An administrator must confirm an ordered road path and every service-stop pin before collection can start.",
        },
        { status: 409 },
      );
    }

    const routeBarangay = String(
      route.barangay ||
        (Array.isArray(route.barangays) ? route.barangays[0] : "") ||
        schedule.barangay ||
        "",
    );

    const assignedPuroks = normalizeStringArray(
      schedule.assignedPuroks || schedule.puroks || route.puroks,
    );
    const assignedBarangays = normalizeStringArray(
      schedule.barangays || route.barangays || routeBarangay,
    );
    const assignedAreas = orderedValues(schedule.areas).length > 0
      ? orderedValues(schedule.areas)
      : serviceStops.map((stop) => ({
          areaKey: stop.areaKey,
          barangay: stop.barangay,
          barangayKey: normalizeBarangayKey(stop.barangay),
          purok: stop.purok,
          purokKey: normalizePurokKey(stop.purok),
          order: stop.order,
        }));

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
        routeType: "verified-road-route",
        trackingMode: "verified-polyline",
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
          message: "Driver started the verified collection route.",
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

    const currentRoutePosition = routePosition(point, routeCoordinates);
    const allowedDeviationMeters = Math.max(75, Math.min(150, accuracy * 1.5));
    const onVerifiedRoute = accurateEnough &&
      currentRoutePosition.distanceMeters <= allowedDeviationMeters;
    const previousProgress = Math.max(
      0,
      Math.min(100, Number(session.progress || session.routeProgress || 0)),
    );
    const liveProgress = Math.max(
      previousProgress,
      onVerifiedRoute ? currentRoutePosition.progress : 0,
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
    const visitedPuroks = Array.from(new Set(
      serviceStops
        .filter((stop) => visitedAreaKeys.has(stop.areaKey) && stop.purok)
        .map((stop) => stop.purok),
    ));
    const allServiceStopsVisited = serviceStops.every((stop) =>
      visitedAreaKeys.has(stop.areaKey),
    );
    const routePassed = allServiceStopsVisited && liveProgress >= 90;
    const status = finishRequested
      ? routePassed
        ? "Completed"
        : "Partially Completed"
      : onVerifiedRoute
        ? "On Route"
        : accurateEnough
          ? "Deviated from Route"
          : "Ongoing";
    const progress = finishRequested && routePassed ? 100 : liveProgress;

    const lastRecorded = session.lastRecordedPoint as GpsPoint | undefined;
    const distanceFromLast = lastRecorded
      ? distanceMeters(lastRecorded, point)
      : Number.POSITIVE_INFINITY;
    const timeFromLast = lastRecorded?.timestamp
      ? timestamp - lastRecorded.timestamp
      : Number.POSITIVE_INFINITY;
    const shouldRecord =
      accurateEnough &&
      (distanceFromLast >= HISTORY_MIN_DISTANCE_METERS ||
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
      routeDeviationMeters: Math.round(currentRoutePosition.distanceMeters),
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
      routeType: "verified-road-route",
      trackingMode: "verified-polyline",
      barangay: routeBarangay,
      barangays: assignedBarangays,
      areas: assignedAreas,
      assignedPuroks,
      visitedAreas,
      visitedPuroks: Object.fromEntries(visitedPuroks.map((purok) => [purok, true])),
      routePassed,
      allPuroksVisited: allServiceStopsVisited,
      routeDeviationMeters: Math.round(currentRoutePosition.distanceMeters),
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
       * DriverMapActivity saves the driver's finish form here BEFORE it asks
       * RouteTrackingService to finish the GPS session. Persist that form into
       * collection_reports so historical reports do not depend on a temporary
       * pending summary. This uses Realtime Database only.
       */
      const pendingSummaryReference = adminDb.ref(
        `pending_collection_summaries/${driver.uid}/${scheduleId}`,
      );
      const pendingSummarySnapshot = await pendingSummaryReference.get();
      const pendingSummary = (pendingSummarySnapshot.val() || {}) as Record<
        string,
        unknown
      >;

      const reportedAssignedPuroks = normalizeStringArray(
        pendingSummary.assignedPuroks || pendingSummary.puroks || assignedPuroks,
      );
      const claimedPuroks = normalizeStringArray(
        pendingSummary.claimedPuroks ||
          pendingSummary.visitedPuroks ||
          assignedPuroks,
      );
      const unclaimedPuroks = normalizeStringArray(
        pendingSummary.unclaimedPuroks,
      );
      const pendingLoadValue = Number(pendingSummary.truckLoadPercent);
      const reportedTruckLoadPercent =
        Number.isFinite(pendingLoadValue) && pendingLoadValue >= 0
          ? Math.min(100, pendingLoadValue)
          : null;
      const completionReason = String(
        pendingSummary.completionReason ||
          (unclaimedPuroks.length > 0 ? "partial_collection" : "completed"),
      );
      const collectionCondition = String(
        pendingSummary.collectionCondition || "Normal collection",
      );
      const collectionStatus =
        !routePassed ||
        unclaimedPuroks.length > 0 ||
        completionReason.toLowerCase().includes("partial") ||
        completionReason.toLowerCase().includes("truck_full")
          ? "partially_completed"
          : "completed";

      const report = {
        reportId: sessionId,
        sessionId,
        scheduleId,
        routeId,
        routeName:
          route.routeName || schedule.routeName || "Collection route",
        scheduleName: schedule.title || "Collection schedule",
        routeType: "verified-road-route",
        trackingMode: "verified-polyline",
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
        allPuroksVisited: allServiceStopsVisited && unclaimedPuroks.length === 0,
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

      await Promise.all([
        adminDb.ref(`collection_reports/${sessionId}`).set(report),
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
