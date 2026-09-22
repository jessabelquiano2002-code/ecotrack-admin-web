import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LicenceSide = "front" | "back";

type DriverRecord = {
  licenseImageRef?: unknown;
  licenseImageBackRef?: unknown;
};

type StoredImage = {
  data?: unknown;
  encoding?: unknown;
  contentType?: unknown;
  size?: unknown;
};

function sanitizeDriverId(value: string | null): string {
  const driverId = String(value || "").trim();

  if (!driverId) {
    throw new Error("DRIVER_ID_REQUIRED");
  }

  /* Firebase Realtime Database keys cannot contain . # $ [ ] / */
  if (/[.#$\[\]/]/.test(driverId)) {
    throw new Error("DRIVER_ID_INVALID");
  }

  return driverId;
}

function sanitizeSide(value: string | null): LicenceSide {
  const side = String(value || "front").trim().toLowerCase();

  if (side !== "front" && side !== "back") {
    throw new Error("LICENCE_SIDE_INVALID");
  }

  return side;
}

function resolveImageReference(
  driverId: string,
  driver: DriverRecord | null,
  side: LicenceSide,
): string {
  const expectedReference =
    side === "back"
      ? `driver_license_images_back/${driverId}`
      : `driver_license_images/${driverId}`;

  const storedReference = String(
    side === "back"
      ? driver?.licenseImageBackRef || ""
      : driver?.licenseImageRef || "",
  ).trim();

  /*
   * Support older records where the reference field was not written,
   * but never allow a record to point outside its own protected path.
   */
  return storedReference === expectedReference
    ? storedReference
    : expectedReference;
}

function resolveContentType(value: unknown): "image/png" | "image/jpeg" {
  return String(value || "").toLowerCase() === "image/png"
    ? "image/png"
    : "image/jpeg";
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const driverId = sanitizeDriverId(
      request.nextUrl.searchParams.get("driverId"),
    );
    const side = sanitizeSide(request.nextUrl.searchParams.get("side"));

    const driverSnapshot = await adminDb
      .ref(`drivers/${driverId}`)
      .get();

    if (!driverSnapshot.exists()) {
      return NextResponse.json(
        { error: "Driver account was not found." },
        { status: 404 },
      );
    }

    const driver = driverSnapshot.val() as DriverRecord | null;
    const imageReference = resolveImageReference(driverId, driver, side);
    const imageSnapshot = await adminDb.ref(imageReference).get();

    if (!imageSnapshot.exists()) {
      return NextResponse.json(
        {
          error: `No ${side} licence image is stored for this driver.`,
        },
        { status: 404 },
      );
    }

    const image = imageSnapshot.val() as StoredImage | null;
    const encoding = String(image?.encoding || "").toLowerCase();
    const encodedData = String(image?.data || "").trim();

    if (!encodedData || encoding !== "base64") {
      return NextResponse.json(
        { error: `The stored ${side} licence image is invalid.` },
        { status: 422 },
      );
    }

    let buffer: Buffer;

    try {
      buffer = Buffer.from(encodedData, "base64");
    } catch {
      return NextResponse.json(
        { error: `The stored ${side} licence image could not be decoded.` },
        { status: 422 },
      );
    }

    const maximumBytes = 5 * 1024 * 1024;

    if (buffer.length === 0 || buffer.length > maximumBytes) {
      return NextResponse.json(
        { error: `The stored ${side} licence image has an invalid size.` },
        { status: 422 },
      );
    }

    const declaredSize = Number(image?.size || 0);

    if (
      Number.isFinite(declaredSize) &&
      declaredSize > 0 &&
      Math.abs(declaredSize - buffer.length) > 16
    ) {
      console.warn("Driver licence image size metadata does not match", {
        driverId,
        side,
        declaredSize,
        actualSize: buffer.length,
      });
    }

    const contentType = resolveContentType(image?.contentType);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="driver-${driverId}-licence-${side}.${contentType === "image/png" ? "png" : "jpg"}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unable to load licence image.";

    if (message === "DRIVER_ID_REQUIRED") {
      return NextResponse.json(
        { error: "Driver ID is required." },
        { status: 400 },
      );
    }

    if (message === "DRIVER_ID_INVALID") {
      return NextResponse.json(
        { error: "Driver ID is invalid." },
        { status: 400 },
      );
    }

    if (message === "LICENCE_SIDE_INVALID") {
      return NextResponse.json(
        { error: "Licence side must be front or back." },
        { status: 400 },
      );
    }

    const status = authErrorStatus(error);

    console.error("Driver licence API error:", error);

    return NextResponse.json(
      {
        error:
          status === 401 || status === 403
            ? "You are not authorized to view this licence image."
            : "Unable to load the driver licence image.",
      },
      { status },
    );
  }
}
