import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  driverId?: string;
  messageId?: string;
  message?: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTokenFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  const values: unknown[] = [
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
  const [driverSnapshot, tokenSnapshot] = await Promise.all([
    adminDb.ref(`drivers/${driverId}`).get(),
    adminDb.ref("device_tokens").get(),
  ]);

  readTokenFields(driverSnapshot.val()).forEach((token) => result.add(token));

  const tokenRecords = (tokenSnapshot.val() || {}) as Record<string, Record<string, unknown>>;
  Object.values(tokenRecords).forEach((item) => {
    const ownerId = clean(item.driverId || item.uid || item.userId || item.userUid || item.ownerId);
    const role = clean(item.role || item.userType || item.accountType).toLowerCase();
    if (ownerId !== driverId) return;
    if (role && role !== "driver") return;
    readTokenFields(item).forEach((token) => result.add(token));
  });

  return Array.from(result);
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = (await request.json()) as Payload;
    const driverId = clean(body.driverId);
    const messageId = clean(body.messageId);
    const message = clean(body.message);

    if (!driverId || !messageId || !message) {
      return NextResponse.json(
        { ok: false, message: "driverId, messageId, and message are required." },
        { status: 400 },
      );
    }

    const safeMessage = message.length > 180 ? `${message.slice(0, 177)}...` : message;
    const tokens = await findDriverTokens(driverId);

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        warning: "Message was saved, but this driver has no registered notification token yet.",
      });
    }

    const response = await adminMessaging.sendEachForMulticast({
      tokens: tokens.slice(0, 500),
      data: {
        source: "admin",
        type: "driver_chat_message",
        screen: "driver_chat",
        title: "WasteTrack Admin",
        message: safeMessage,
        body: safeMessage,
        driverId,
        messageId,
        timestamp: String(Date.now()),
      },
      android: {
        priority: "high",
        ttl: 60 * 60 * 1000,
      },
    });

    return NextResponse.json({
      ok: true,
      sent: response.successCount,
      failed: response.failureCount,
      warning: response.successCount === 0
        ? "Message was saved, but all registered driver push tokens failed."
        : "",
    });
  } catch (error: unknown) {
    console.error("Driver chat notification failed:", error);
    const status = authErrorStatus(error);
    return NextResponse.json(
      {
        ok: false,
        message: status === 500 && error instanceof Error ? error.message : "Not authorized.",
      },
      { status },
    );
  }
}
