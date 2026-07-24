import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebase-admin";
import { authErrorStatus, requireAdmin } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Images are intentionally kept small because they are stored as Base64 in
 * Firebase Realtime Database. The admin page compresses images before upload,
 * and the API enforces the final limit again.
 */
const MAX_DATABASE_IMAGE_BYTES = 600 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type AdvertisementAudience =
  | "all_residents"
  | "barangay_all_purok"
  | "barangay_purok";

type StoredAdvertisementImage = {
  data?: unknown;
  encoding?: unknown;
  contentType?: unknown;
  size?: unknown;
};

function textValue(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

function makeBarangayKey(value?: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function makePurokKey(value?: string): string {
  const text = String(value || "").toLowerCase();
  const match = text.match(/\d+/);
  return match ? `purok_${match[0]}` : "";
}

function parseTimestamp(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.trunc(parsed)
    : fallback;
}

function isValidImageSignature(
  buffer: Buffer,
  contentType: string,
): boolean {
  if (contentType === "image/jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (contentType === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (contentType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
}

function normalizeStoredImage(value: StoredAdvertisementImage | null) {
  const data = String(value?.data || "").trim();
  const encoding = String(value?.encoding || "").trim();
  const contentType = String(value?.contentType || "").trim();
  const declaredSize = Number(value?.size || 0);

  if (!data || encoding !== "base64") {
    return null;
  }

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return null;
  }

  const buffer = Buffer.from(data, "base64");

  if (
    buffer.length <= 0 ||
    buffer.length > MAX_DATABASE_IMAGE_BYTES ||
    (declaredSize > 0 && declaredSize !== buffer.length) ||
    !isValidImageSignature(buffer, contentType)
  ) {
    return null;
  }

  return { buffer, contentType };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const id = request.nextUrl.searchParams.get("id")?.trim() || "";

    if (!id) {
      return NextResponse.json(
        { error: "Advertisement ID is required." },
        { status: 400 },
      );
    }

    const snapshot = await adminDb
      .ref(`resident_advertisement_images/${id}`)
      .get();

    const storedImage = normalizeStoredImage(
      snapshot.val() as StoredAdvertisementImage | null,
    );

    if (!storedImage) {
      return NextResponse.json(
        { error: "Advertisement image was not found." },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(storedImage.buffer), {
      status: 200,
      headers: {
        "Content-Type": storedImage.contentType,
        "Content-Length": String(storedImage.buffer.length),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    console.error("Load advertisement image failed:", error);

    const status = authErrorStatus(error);

    return NextResponse.json(
      {
        error:
          status === 401 || status === 403
            ? "Administrator authorization is required."
            : "Unable to load the advertisement image.",
      },
      { status: status >= 400 ? status : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const formData = await request.formData();

    const title = textValue(formData, "title");
    const message = textValue(formData, "message");
    const audience = textValue(
      formData,
      "audience",
    ) as AdvertisementAudience;
    const barangay = textValue(formData, "barangay");
    const purok = textValue(formData, "purok");
    const ctaLabel = textValue(formData, "ctaLabel");
    const ctaUrl = textValue(formData, "ctaUrl");
    const startAt = parseTimestamp(
      textValue(formData, "startAt"),
      Date.now(),
    );
    const endAt = parseTimestamp(textValue(formData, "endAt"), 0);
    const image = formData.get("image");

    if (!title) {
      return NextResponse.json(
        { error: "Advertisement title is required." },
        { status: 400 },
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Advertisement message is required." },
        { status: 400 },
      );
    }

    if (
      ![
        "all_residents",
        "barangay_all_purok",
        "barangay_purok",
      ].includes(audience)
    ) {
      return NextResponse.json(
        { error: "Advertisement audience is invalid." },
        { status: 400 },
      );
    }

    if (audience !== "all_residents" && !barangay) {
      return NextResponse.json(
        { error: "Target barangay is required." },
        { status: 400 },
      );
    }

    if (audience === "barangay_purok" && !purok) {
      return NextResponse.json(
        { error: "Target Purok is required." },
        { status: 400 },
      );
    }

    if (ctaUrl) {
      try {
        const parsed = new URL(ctaUrl);

        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("INVALID_PROTOCOL");
        }
      } catch {
        return NextResponse.json(
          { error: "Action URL must use http:// or https://." },
          { status: 400 },
        );
      }
    }

    if (endAt > 0 && endAt <= startAt) {
      return NextResponse.json(
        { error: "End date must be later than start date." },
        { status: 400 },
      );
    }

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Advertisement image is required." },
        { status: 400 },
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "Image must be JPG, PNG, or WebP." },
        { status: 415 },
      );
    }

    if (
      image.size <= 0 ||
      image.size > MAX_DATABASE_IMAGE_BYTES
    ) {
      return NextResponse.json(
        {
          error:
            "The optimized image must not exceed 600 KB. Choose a smaller image and try again.",
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());

    if (!isValidImageSignature(buffer, image.type)) {
      return NextResponse.json(
        { error: "The selected file is not a valid image." },
        { status: 415 },
      );
    }

    const recordRef = adminDb
      .ref("resident_advertisements")
      .push();
    const id = recordRef.key;

    if (!id) {
      throw new Error("Unable to allocate advertisement ID.");
    }

    const now = Date.now();
    const barangayKey = makeBarangayKey(barangay);
    const purokKey = makePurokKey(purok);
    const imageRef = `resident_advertisement_images/${id}`;

    const advertisementRecord = {
      title,
      message,
      imageRef,
      imageContentType: image.type,
      imageSize: buffer.length,
      imageStorage: "realtime-database",
      audience,
      barangay: audience === "all_residents" ? "" : barangay,
      barangayKey:
        audience === "all_residents" ? "" : barangayKey,
      purok: audience === "barangay_purok" ? purok : "",
      purokKey:
        audience === "barangay_purok" ? purokKey : "",
      ctaLabel,
      ctaUrl,
      active: true,
      status: "published",
      startAt,
      endAt,
      createdAt: now,
      updatedAt: now,
      createdBy: "administrator",
    };

    const imageRecord = {
      data: buffer.toString("base64"),
      encoding: "base64",
      contentType: image.type,
      size: buffer.length,
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.ref().update({
      [`resident_advertisements/${id}`]: advertisementRecord,
      [imageRef]: imageRecord,
    });

    return NextResponse.json(
      { success: true, id },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("Create advertisement failed:", error);

    const status = authErrorStatus(error);
    const message =
      error instanceof Error
        ? error.message
        : "Unable to create advertisement.";

    return NextResponse.json(
      {
        error:
          status === 401 || status === 403
            ? "Administrator authorization is required."
            : message,
      },
      { status: status >= 400 ? status : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as {
      id?: unknown;
      active?: unknown;
    };

    const id = String(body.id || "").trim();

    if (!id) {
      return NextResponse.json(
        { error: "Advertisement ID is required." },
        { status: 400 },
      );
    }

    if (typeof body.active !== "boolean") {
      return NextResponse.json(
        { error: "Active status must be true or false." },
        { status: 400 },
      );
    }

    const snapshot = await adminDb
      .ref(`resident_advertisements/${id}`)
      .get();

    if (!snapshot.exists()) {
      return NextResponse.json(
        { error: "Advertisement was not found." },
        { status: 404 },
      );
    }

    await adminDb
      .ref(`resident_advertisements/${id}`)
      .update({
        active: body.active,
        updatedAt: Date.now(),
      });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Update advertisement failed:", error);

    const status = authErrorStatus(error);

    return NextResponse.json(
      {
        error:
          status === 401 || status === 403
            ? "Administrator authorization is required."
            : "Unable to update advertisement.",
      },
      { status: status >= 400 ? status : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);

    const id = request.nextUrl.searchParams.get("id")?.trim() || "";

    if (!id) {
      return NextResponse.json(
        { error: "Advertisement ID is required." },
        { status: 400 },
      );
    }

    const recordSnapshot = await adminDb
      .ref(`resident_advertisements/${id}`)
      .get();

    if (!recordSnapshot.exists()) {
      return NextResponse.json(
        { error: "Advertisement was not found." },
        { status: 404 },
      );
    }

    await adminDb.ref().update({
      [`resident_advertisements/${id}`]: null,
      [`resident_advertisement_images/${id}`]: null,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Delete advertisement failed:", error);

    const status = authErrorStatus(error);

    return NextResponse.json(
      {
        error:
          status === 401 || status === 403
            ? "Administrator authorization is required."
            : "Unable to delete advertisement.",
      },
      { status: status >= 400 ? status : 500 },
    );
  }
}
