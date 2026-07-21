import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const driverId = request.nextUrl.searchParams.get("driverId")?.trim();

    if (!driverId) {
      return NextResponse.json(
        { error: "Driver ID is required." },
        { status: 400 },
      );
    }

    const snapshot = await adminDb.ref(`drivers/${driverId}`).get();

    const driver = snapshot.val() as
      | {
          licenseImageRef?: string;
        }
      | null;

    const expectedRef = `driver_license_images/${driverId}`;

    if (
      !driver?.licenseImageRef ||
      driver.licenseImageRef !== expectedRef
    ) {
      return NextResponse.json(
        { error: "No licence image is stored for this driver." },
        { status: 404 },
      );
    }

    const imageSnapshot = await adminDb.ref(expectedRef).get();

    const image = imageSnapshot.val() as
      | {
          data?: string;
          encoding?: string;
          contentType?: string;
          size?: number;
        }
      | null;

    if (!image?.data || image.encoding !== "base64") {
      return NextResponse.json(
        { error: "No licence image is stored for this driver." },
        { status: 404 },
      );
    }

    const contentType =
      image.contentType === "image/png"
        ? "image/png"
        : "image/jpeg";

    const buffer = Buffer.from(image.data, "base64");

    if (
      buffer.length === 0 ||
      buffer.length > 5 * 1024 * 1024
    ) {
      return NextResponse.json(
        { error: "The stored licence image is invalid." },
        { status: 422 },
      );
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition":
          `inline; filename="driver-${driverId}-licence"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const status = authErrorStatus(error);

    return NextResponse.json(
      {
        error:
          status === 404
            ? "Licence image was not found."
            : status === 500
              ? "Unable to load licence image."
              : "Not authorized.",
      },
      { status },
    );
  }
}