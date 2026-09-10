import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

type TokenRecord = {
  token?: string;
  role?: string;
  uid?: string;
  residentId?: string;
  deviceId?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  enabled?: boolean;
  soundEnabled?: boolean;
};

function buildDeviceIdentityIndex(...trees: unknown[]) {
  const index = new Map<string, string[]>();

  trees.forEach((tree) => {
    if (!tree || typeof tree !== "object") return;

    Object.entries(tree as Record<string, unknown>).forEach(([recordKey, raw]) => {
      if (!raw || typeof raw !== "object") return;
      const item = raw as Record<string, unknown>;
      const deviceId = String(item.deviceId || "").trim();
      if (!deviceId) return;

      const identities = [item.uid, item.residentId, recordKey]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      index.set(
        deviceId,
        Array.from(new Set([...(index.get(deviceId) || []), ...identities])),
      );
    });
  });

  return index;
}

function normalizeBarangay(value: unknown) {
  const key = String(value ?? "")
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

    const targetUidValues = [
      ...(Array.isArray(body.targetUids) ? body.targetUids : []),
      ...(body.targetUid ? [body.targetUid] : []),
      ...(body.targetResidentId ? [body.targetResidentId] : []),
    ];

    const requestedTargetUids = Array.from(
      new Set(
        targetUidValues
          .map((value) => String(value ?? "").trim())
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
    const [deviceTokensSnap, residentTokensSnap, residentsSnap, profilesSnap] = await Promise.all([
      adminDb.ref("device_tokens").get(),
      adminDb.ref("resident_fcm_tokens").get(),
      adminDb.ref("residents").get(),
      adminDb.ref("resident_profiles").get(),
    ]);

    const identitiesByDevice = buildDeviceIdentityIndex(
      residentsSnap.val(),
      profilesSnap.val(),
    );

    const candidates: TokenRecord[] = [
      ...flattenResidentTokenTree(deviceTokensSnap.val()),
      ...flattenResidentTokenTree(residentTokensSnap.val()),
    ];

    const tokenSet = new Set<string>();
    const soundPreferenceByToken = new Map<string, boolean>();

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

      if (requestedTargetUids.length > 0) {
        const tokenIdentities = [
          item.uid,
          item.residentId,
          ...(identitiesByDevice.get(String(item.deviceId || "").trim()) || []),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean);

        if (!tokenIdentities.some((value) => requestedTargetUids.includes(value))) return;
      } else if (!matchesArea(item, requestedBarangays, requestedPuroks)) {
        return;
      }

      tokenSet.add(token);
      // Last matching record wins; both token registries are already merged above.
      soundPreferenceByToken.set(token, item.soundEnabled !== false);
    });

    const tokens = Array.from(tokenSet);

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        warning:
          `No matching ${target} FCM tokens were found. Open the target app once so its phone token can register.`,
      });
    }

    const deliveryGroups: Array<{ tokens: string[]; soundEnabled: boolean }> =
      target === "resident"
        ? [
            {
              tokens: tokens.filter((token) => soundPreferenceByToken.get(token) !== false),
              soundEnabled: true,
            },
            {
              tokens: tokens.filter((token) => soundPreferenceByToken.get(token) === false),
              soundEnabled: false,
            },
          ].filter((group) => group.tokens.length > 0)
        : [{ tokens, soundEnabled: true }];

    let sent = 0;
    let failed = 0;

    for (const group of deliveryGroups) {
      for (let offset = 0; offset < group.tokens.length; offset += 500) {
        const chunk = group.tokens.slice(offset, offset + 500);
        const residentSystemNotification = target === "resident";

        /*
         * Resident pushes use NOTIFICATION + DATA.  Android can therefore show
         * them from the FCM SDK/system tray even when the app process is gone.
         * Driver pushes remain data-only because their custom Android service
         * owns assignment/voice handling.
         */
        const response = await adminMessaging.sendEachForMulticast({
          tokens: chunk,
          ...(residentSystemNotification
            ? { notification: { title, body: message } }
            : {}),
          data: {
          source: "admin",
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
          scheduleTitle: String(body.scheduleTitle || ""),
          routeId: String(body.routeId || ""),
          routeName: String(body.routeName || ""),
          substituteFrom: String(body.substituteFrom || ""),
          substituteUntil: String(body.substituteUntil || ""),
          affectedDates: JSON.stringify(
            Array.isArray(body.affectedDates) ? body.affectedDates : [],
          ),
          reason: String(body.reason || ""),
          assignmentRole: String(body.assignmentRole || ""),
          screen:
            target === "driver"
              ? "home"
              : type.toLowerCase().includes("schedule")
                ? "schedule"
                : type.toLowerCase().includes("approach") ||
                    type.toLowerCase().includes("truck")
                  ? "home"
                  : "notifications",
          timestamp: String(Date.now()),
          targetUid: requestedTargetUids.length === 1 ? requestedTargetUids[0] : "",
          targetUids: JSON.stringify(requestedTargetUids),
        },
          android: {
            priority: "high",
            ttl: 60 * 60 * 1000,
            ...(residentSystemNotification
              ? {
                  notification: {
                    channelId: group.soundEnabled
                      ? "waste_alerts_sound_v3"
                      : "waste_alerts_silent_v3",
                    icon: "ic_notification_truck",
                    priority: "high" as const,
                    visibility: "public" as const,
                    defaultSound: group.soundEnabled,
                    defaultVibrateTimings: group.soundEnabled,
                  },
                }
              : {}),
          },
        });

        sent += response.successCount;
        failed += response.failureCount;
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      matchedTokens: tokens.length,
      warning:
        failed > 0
          ? `${failed} registered device${failed === 1 ? "" : "s"} could not receive the push.`
          : "",
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
