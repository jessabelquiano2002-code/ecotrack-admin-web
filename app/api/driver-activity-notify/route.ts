import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { adminDb, adminMessaging } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotifyPayload = {
  driverId?: string;
  requestId?: string;
  periodLabel?: string;
  requestedDateDisplay?: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTokenFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  const values = [
    raw.fcmToken,
    raw.token,
    raw.deviceToken,
    raw.notificationToken,
    raw.messagingToken,
  ];

  const tokenMap = raw.fcmTokens || raw.tokens || raw.deviceTokens;
  if (tokenMap && typeof tokenMap === "object") {
    values.push(...Object.values(tokenMap as Record<string, unknown>));
  }

  return values.map(clean).filter(Boolean);
}

async function findDriverTokens(driverId: string): Promise<string[]> {
  const result = new Set<string>();

  // Common token fields directly below the driver profile.
  const driverSnapshot = await adminDb.ref(`drivers/${driverId}`).get();
  readTokenFields(driverSnapshot.val()).forEach((token) => result.add(token));

  // Compatibility with the existing WasteTrack device_tokens registry.
  const tokenSnapshot = await adminDb.ref("device_tokens").get();
  const tokenRecords = (tokenSnapshot.val() || {}) as Record<
    string,
    Record<string, unknown>
  >;

  Object.values(tokenRecords).forEach((item) => {
    const ownerId = clean(
      item.driverId || item.uid || item.userId || item.userUid || item.ownerId,
    );
    const role = clean(item.role || item.userType || item.accountType).toLowerCase();

    if (ownerId !== driverId) return;
    if (role && role !== "driver") return;

    readTokenFields(item).forEach((token) => result.add(token));
  });

  return Array.from(result);
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized request." },
        { status: 401 },
      );
    }

    const idToken = authorization.slice("Bearer ".length).trim();
    if (!idToken) {
      return NextResponse.json(
        { success: false, message: "Missing authentication token." },
        { status: 401 },
      );
    }

    // Verify that the call came from a signed-in Firebase account.
    // Your Activity Requests page is already restricted to administrators.
    await getAuth().verifyIdToken(idToken);

    const body = (await request.json()) as NotifyPayload;
    const driverId = clean(body.driverId);
    const requestId = clean(body.requestId);
    const periodLabel =
      clean(body.requestedDateDisplay) ||
      clean(body.periodLabel) ||
      "requested activity";

    if (!driverId || !requestId) {
      return NextResponse.json(
        {
          success: false,
          message: "driverId and requestId are required.",
        },
        { status: 400 },
      );
    }

    const tokens = await findDriverTokens(driverId);

    if (tokens.length === 0) {
      return NextResponse.json(
        {
          success: false,
          code: "NO_DRIVER_TOKEN",
          message:
            "The report was saved, but this driver has no registered FCM token yet.",
        },
        { status: 409 },
      );
    }

    const title = "Activity Report Ready";
    const message =
      `Your activity report for ${periodLabel} is ready. ` +
      "It includes the recorded GPS activity map. Tap to view or print.";

    const response = await adminMessaging.sendEachForMulticast({
      tokens: tokens.slice(0, 500),
      notification: {
        title,
        body: message,
      },
      data: {
        type: "driver_activity_report_ready",
        screen: "driver_activity_report",
        requestId,
        driverId,
        periodLabel,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "waste_alerts_sound_v3",
        },
      },
    });

    const failedTokens = response.responses
      .map((item, index) => ({ item, token: tokens[index] }))
      .filter(({ item }) => !item.success)
      .map(({ token }) => token);

    // Clean invalid tokens so future sends do not repeatedly fail.
    // This only touches Realtime Database; Firebase Storage is not used.
    if (failedTokens.length > 0) {
      console.warn("Some driver FCM tokens failed:", failedTokens.length);
    }

    if (response.successCount === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "FCM rejected all registered tokens for this driver.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error("Driver activity notification failed:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to send driver notification.",
      },
      { status: 500 },
    );
  }
}