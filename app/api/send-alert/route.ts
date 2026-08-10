import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

type TokenRecord = {
  token?: string;
  role?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  enabled?: boolean;
};

function normalizeBarangay(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay|brgy/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function normalizePurok(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";

  if (
    raw === "all" ||
    raw === "all purok" ||
    raw === "all puroks" ||
    raw === "all_purok" ||
    raw === "all_puroks"
  ) {
    return "all";
  }

  const digits = raw.replace(/[^0-9]/g, "");
  if (digits) return `purok_${Number(digits)}`;

  return raw
    .replace(/purok|prk|zone/g, "")
    .replace(/[^a-z0-9ñ]/g, "")
    .trim();
}

function flattenResidentTokenTree(value: unknown): TokenRecord[] {
  if (!value || typeof value !== "object") return [];

  const records: TokenRecord[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;

    const object = node as Record<string, unknown>;

    if (typeof object.token === "string" && object.token.trim()) {
      records.push(object as TokenRecord);
      return;
    }

    Object.values(object).forEach(visit);
  };

  visit(value);
  return records;
}

function matchesArea(
  item: TokenRecord,
  requestedBarangays: string[],
  requestedPuroks: string[],
) {
  const itemBarangay = normalizeBarangay(item.barangayKey || item.barangay);

  const barangayMatch =
    requestedBarangays.length === 0 ||
    requestedBarangays.includes(itemBarangay);

  if (!barangayMatch) return false;

  if (
    requestedPuroks.length === 0 ||
    requestedPuroks.includes("all")
  ) {
    return true;
  }

  return requestedPuroks.includes(normalizePurok(item.purok));
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json();

    const title = String(body.title || "").trim();
    const message = String(body.message || body.body || "").trim();
    const type = String(body.type || "alert").trim();
    const target = String(body.target || "resident").trim().toLowerCase();

    const barangayValues = [
      ...(Array.isArray(body.barangays) ? body.barangays : []),
      ...(body.barangay ? [body.barangay] : []),
    ];

    const purokValues = [
      ...(Array.isArray(body.puroks) ? body.puroks : []),
      ...(body.purok ? [body.purok] : []),
    ];

    const requestedBarangays = Array.from(
      new Set(
        barangayValues
          .map(normalizeBarangay)
          .filter(Boolean),
      ),
    );

    const requestedPuroks = Array.from(
      new Set(
        purokValues
          .map(normalizePurok)
          .filter(Boolean),
      ),
    );

    if (!title || !message) {
      return NextResponse.json(
        { error: "Title and message are required." },
        { status: 400 },
      );
    }

    /*
     * Read BOTH stores:
     *
     * 1. device_tokens/{deviceId}
     *    - canonical path used by the new Android registrar.
     *
     * 2. resident_fcm_tokens/{barangayKey}/{deviceId}
     *    - your existing Android app used this path.
     *
     * The old API only read device_tokens, so many resident phones could never
     * receive FCM even though a valid token existed in Firebase.
     */
    const [deviceTokensSnap, residentTokensSnap] = await Promise.all([
      adminDb.ref("device_tokens").get(),
      adminDb.ref("resident_fcm_tokens").get(),
    ]);

    const candidates: TokenRecord[] = [
      ...flattenResidentTokenTree(deviceTokensSnap.val()),
      ...flattenResidentTokenTree(residentTokensSnap.val()),
    ];

    const tokenSet = new Set<string>();

    candidates.forEach((item) => {
      const token = String(item.token || "").trim();
      if (!token) return;
      if (item.enabled === false) return;

      const role = String(item.role || "resident").trim().toLowerCase();
      const roleMatch =
        target === "all" ||
        target === "resident" && role === "resident" ||
        role === target;

      if (!roleMatch) return;
      if (!matchesArea(item, requestedBarangays, requestedPuroks)) return;

      tokenSet.add(token);
    });

    const tokens = Array.from(tokenSet);

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        warning:
          "No matching resident FCM tokens were found. Open the Resident app once after installing this patch so its phone token can register.",
      });
    }

    const chunks: string[][] = [];
    for (let i = 0; i < tokens.length; i += 500) {
      chunks.push(tokens.slice(i, i + 500));
    }

    let sent = 0;
    let failed = 0;

    for (const chunk of chunks) {
      /*
       * DATA-ONLY + HIGH priority is deliberate.
       *
       * It lets MyFirebaseMessagingService.onMessageReceived() create the
       * notification even while the resident is not using the app. This also
       * lets schedule messages call ResidentScheduleReminderCoordinator.resyncOnce().
       */
      const response = await adminMessaging.sendEachForMulticast({
        tokens: chunk,
        data: {
          title,
          message,
          body: message,
          type,
          target,
          barangay: String(body.barangay || ""),
          barangays: JSON.stringify(
            Array.isArray(body.barangays)
              ? body.barangays
              : body.barangay
                ? [body.barangay]
                : [],
          ),
          purok: String(body.purok || ""),
          puroks: JSON.stringify(
            Array.isArray(body.puroks)
              ? body.puroks
              : body.purok
                ? [body.purok]
                : [],
          ),
          scheduleId: String(body.scheduleId || ""),
          screen:
            type.toLowerCase().includes("schedule")
              ? "schedule"
              : type.toLowerCase().includes("approach") ||
                  type.toLowerCase().includes("truck")
                ? "home"
                : "notifications",
          timestamp: String(Date.now()),
        },
        android: {
          priority: "high",
          ttl: 60 * 60 * 1000,
        },
      });

      sent += response.successCount;
      failed += response.failureCount;
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      matchedTokens: tokens.length,
    });
  } catch (error: unknown) {
    const status = authErrorStatus(error);

    return NextResponse.json(
      {
        error:
          status === 500 && error instanceof Error
            ? error.message
            : "Not authorized.",
      },
      { status },
    );
  }
}
