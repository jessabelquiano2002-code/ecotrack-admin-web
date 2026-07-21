import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();

    const {
      title,
      message,
      barangay,      // single (old)
      barangays,     // 🔥 multiple (new)
      purok,
      target = "all"
    } = body;

    if (!title || !message) {
      return NextResponse.json(
        { error: "Title and message are required." },
        { status: 400 }
      );
    }

    const tokensSnap = await adminDb.ref("device_tokens").get();
    const tokenMap = tokensSnap.val() ?? {};

    const tokens: string[] = [];

    Object.values(tokenMap).forEach((item: any) => {
      if (!item?.token) return;

      const matchRole =
        target === "all" || item.role === target;

      // 🔥 NEW MULTI-BARANGAY LOGIC
      let matchBarangay = true;

      if (barangays && barangays.length > 0) {
        matchBarangay = barangays.includes(item.barangay);
      } else if (barangay) {
        matchBarangay = item.barangay === barangay;
      }

      const matchPurok =
        !purok || item.purok === purok;

      if (matchRole && matchBarangay && matchPurok) {
        tokens.push(item.token);
      }
    });

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        note: "No matching users found."
      });
    }

    // 🔥 FCM LIMIT HANDLING
    const chunks = [];
    for (let i = 0; i < tokens.length; i += 500) {
      chunks.push(tokens.slice(i, i + 500));
    }

    let totalSuccess = 0;
    let totalFail = 0;

    for (const chunk of chunks) {
      const response = await adminMessaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title,
          body: message
        },
        data: {
          barangays: JSON.stringify(barangays || []), // 🔥 pass array
          barangay: barangay || "",
          purok: purok || "",
          target,
          screen: "notifications"
        }
      });

      totalSuccess += response.successCount;
      totalFail += response.failureCount;
    }

    return NextResponse.json({
      ok: true,
      sent: totalSuccess,
      failed: totalFail
    });

  } catch (error: unknown) {
    const status = authErrorStatus(error);
    return NextResponse.json(
      { error: status === 500 && error instanceof Error ? error.message : "Not authorized." },
      { status }
    );
  }
}
