import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LICENSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LICENSE_TYPES = new Set(["image/jpeg", "image/png"]);

type DriverFields = {
  name: string;
  email: string;
  phone: string;
  password: string;
  truck: string;
  licenseNumber: string;
  licenseExpirationDate: string;
};

type PreparedLicence = {
  contentType: "image/jpeg" | "image/png";
  size: number;
  base64: string;
};

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function readFields(formData: FormData): DriverFields {
  return {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    phone: String(formData.get("phone") || "").trim(),
    password: String(formData.get("password") || ""),
    truck: String(formData.get("truck") || "").trim(),
    licenseNumber: String(formData.get("licenseNumber") || "").trim(),
    licenseExpirationDate: String(
      formData.get("licenseExpirationDate") || "",
    ).trim(),
  };
}

function validateFields(
  fields: DriverFields,
  requirePassword: boolean,
): string | null {
  if (!fields.name || !fields.email || !fields.phone || !fields.truck) {
    return "Full name, email, contact number, and assigned vehicle are required.";
  }

  if (!fields.licenseNumber || !fields.licenseExpirationDate) {
    return "Licence number and licence expiration date are required.";
  }

  if (!/^\S+@\S+\.\S+$/.test(fields.email)) {
    return "Enter a valid email address, such as driver@example.com.";
  }

  if (requirePassword && fields.password.length < 6) {
    return "Password must contain at least 6 characters.";
  }

  const expiry = Date.parse(`${fields.licenseExpirationDate}T23:59:59`);
  if (!Number.isFinite(expiry)) {
    return "Enter a valid licence expiration date.";
  }

  return null;
}

function getLicenseFile(formData: FormData): File | null {
  const value = formData.get("licenseImage");

  return value instanceof File && value.size > 0 ? value : null;
}

function validateLicenseFile(
  file: File | null,
  required: boolean,
): string | null {
  if (!file) {
    return required ? "A driver licence image is required." : null;
  }

  if (!ALLOWED_LICENSE_TYPES.has(file.type)) {
    return "Licence image must be JPG, JPEG, or PNG.";
  }

  if (file.size > MAX_LICENSE_BYTES) {
    return "Licence image must not exceed 5 MB.";
  }

  return null;
}

function detectImageType(
  buffer: Buffer,
): PreparedLicence["contentType"] | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const pngSignature = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ];

  const isPng =
    buffer.length >= pngSignature.length &&
    pngSignature.every((byte, index) => buffer[index] === byte);

  return isPng ? "image/png" : null;
}

async function prepareLicence(file: File): Promise<PreparedLicence> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = detectImageType(buffer);

  if (!detectedType || detectedType !== file.type) {
    throw new ApiError(
      400,
      "Licence image contents must match a valid JPG, JPEG, or PNG file.",
    );
  }

  return {
    contentType: detectedType,
    size: buffer.length,
    base64: buffer.toString("base64"),
  };
}

async function loadAdminServices() {
  const firebaseAdmin = await import("../../../lib/firebase-admin");
  const serverAuth = await import("../../../lib/serverAuth");

  return {
    ...firebaseAdmin,
    ...serverAuth,
  };
}

function firebaseAdminError(error: unknown): ApiError {
  const code = String(
    (error as { code?: unknown })?.code || "",
  ).trim();

  const messages: Record<string, string> = {
    "auth/email-already-exists": "Email address is already registered.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-password":
      "Password must contain at least 6 characters.",
    "auth/invalid-uid": "The driver account ID is invalid.",
    "auth/user-not-found": "The driver account was not found.",
    "auth/id-token-expired":
      "Your administrator session expired. Sign in again.",
    "auth/argument-error":
      "The administrator session is invalid. Sign in again.",
    "auth/insufficient-permission":
      "Firebase Admin does not have permission to complete this operation.",
    "app/invalid-credential":
      "Firebase Admin credentials are missing or invalid.",
  };

  const status =
    code === "auth/email-already-exists"
      ? 409
      : code === "auth/id-token-expired" ||
          code === "auth/argument-error"
        ? 401
        : code === "auth/user-not-found"
          ? 404
          : code === "auth/insufficient-permission" ||
              code === "app/invalid-credential"
            ? 500
            : 400;

  const fallback =
    error instanceof Error && error.message
      ? error.message
      : "Firebase Admin request failed.";

  return new ApiError(
    status,
    messages[code] || fallback,
  );
}

function jsonError(error: unknown, fallback: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  const code = String(
    (error as { code?: unknown })?.code || "",
  ).trim();

  if (code.startsWith("auth/") || code.startsWith("app/")) {
    const mapped = firebaseAdminError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status },
    );
  }

  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? Number((error as { status: number }).status)
      : 500;

  const message =
    error instanceof Error && error.message
      ? error.message
      : fallback;

  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  let createdUid = "";

  try {
    const { adminAuth, adminDb, requireAdmin } =
      await loadAdminServices();

    const administrator = await requireAdmin(request);

    const formData = await request.formData();
    const fields = readFields(formData);
    const licenseFile = getLicenseFile(formData);

    const validationError =
      validateFields(fields, true) ||
      validateLicenseFile(licenseFile, true);

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 },
      );
    }

    const licence = await prepareLicence(licenseFile!);

    const createdUser = await adminAuth.createUser({
      email: fields.email,
      password: fields.password,
      displayName: fields.name,
      disabled: false,
      emailVerified: false,
    });

    createdUid = createdUser.uid;

    const timestamp = Date.now();
    const licenseImageRef =
      `driver_license_images/${createdUid}`;

    const driverRecord = {
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      truck: fields.truck,
      vehicle: fields.truck,
      licenseNumber: fields.licenseNumber,
      licenseExpirationDate: fields.licenseExpirationDate,
      licenseImageRef,
      licenseImageContentType: licence.contentType,
      licenseImageSize: licence.size,
      licenseImageUpdatedAt: timestamp,
      status: "offline",
      role: "driver",
      enabled: true,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: administrator.uid,
    };

    await adminDb.ref().update({
      [`drivers/${createdUid}`]: driverRecord,
      [licenseImageRef]: {
        data: licence.base64,
        encoding: "base64",
        contentType: licence.contentType,
        size: licence.size,
        updatedAt: timestamp,
        updatedBy: administrator.uid,
      },
    });

    return NextResponse.json(
      {
        success: true,
        uid: createdUid,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (createdUid) {
      try {
        const { adminAuth, adminDb } =
          await loadAdminServices();

        await Promise.allSettled([
          adminAuth.deleteUser(createdUid),
          adminDb.ref().update({
            [`drivers/${createdUid}`]: null,
            [`driver_license_images/${createdUid}`]: null,
            [`driver_locations/${createdUid}`]: null,
          }),
        ]);
      } catch {
        // Ignore rollback errors so the original error is returned.
      }
    }

    return jsonError(
      error,
      "Unable to create driver. Check the Firebase Admin server configuration.",
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { adminAuth, adminDb, requireAdmin } =
      await loadAdminServices();

    const administrator = await requireAdmin(request);
    const formData = await request.formData();

    const driverId = String(
      formData.get("driverId") || "",
    ).trim();

    if (!driverId) {
      return NextResponse.json(
        { error: "Driver ID is required." },
        { status: 400 },
      );
    }

    const fields = readFields(formData);
    const licenseFile = getLicenseFile(formData);

    const validationError =
      validateFields(fields, false) ||
      validateLicenseFile(licenseFile, false);

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 },
      );
    }

    let licence: PreparedLicence | null = null;

    if (licenseFile) {
      licence = await prepareLicence(licenseFile);
    }

    const driverSnapshot = await adminDb
      .ref(`drivers/${driverId}`)
      .get();

    if (!driverSnapshot.exists()) {
      return NextResponse.json(
        { error: "Driver was not found." },
        { status: 404 },
      );
    }

    await adminAuth.updateUser(driverId, {
      email: fields.email,
      displayName: fields.name,
    });

    const timestamp = Date.now();

    const rootUpdate: Record<string, unknown> = {
      [`drivers/${driverId}/name`]: fields.name,
      [`drivers/${driverId}/email`]: fields.email,
      [`drivers/${driverId}/phone`]: fields.phone,
      [`drivers/${driverId}/truck`]: fields.truck,
      [`drivers/${driverId}/vehicle`]: fields.truck,
      [`drivers/${driverId}/licenseNumber`]:
        fields.licenseNumber,
      [`drivers/${driverId}/licenseExpirationDate`]:
        fields.licenseExpirationDate,
      [`drivers/${driverId}/updatedAt`]: timestamp,
      [`drivers/${driverId}/updatedBy`]:
        administrator.uid,
    };

    if (licence) {
      const licenseImageRef =
        `driver_license_images/${driverId}`;

      rootUpdate[
        `drivers/${driverId}/licenseImageRef`
      ] = licenseImageRef;

      rootUpdate[
        `drivers/${driverId}/licenseImageContentType`
      ] = licence.contentType;

      rootUpdate[
        `drivers/${driverId}/licenseImageSize`
      ] = licence.size;

      rootUpdate[
        `drivers/${driverId}/licenseImageUpdatedAt`
      ] = timestamp;

      rootUpdate[licenseImageRef] = {
        data: licence.base64,
        encoding: "base64",
        contentType: licence.contentType,
        size: licence.size,
        updatedAt: timestamp,
        updatedBy: administrator.uid,
      };
    }

    await adminDb.ref().update(rootUpdate);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return jsonError(
      error,
      "Unable to update driver. Check the Firebase Admin server configuration.",
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { adminAuth, adminDb, requireAdmin } =
      await loadAdminServices();

    await requireAdmin(request);

    const { driverId } = (await request.json()) as {
      driverId?: string;
    };

    const uid = String(driverId || "").trim();

    if (!uid) {
      return NextResponse.json(
        { error: "Driver ID is required." },
        { status: 400 },
      );
    }

    try {
      await adminAuth.deleteUser(uid);
    } catch (error: unknown) {
      if (
        (error as { code?: string }).code !==
        "auth/user-not-found"
      ) {
        throw error;
      }
    }

    await adminDb.ref().update({
      [`drivers/${uid}`]: null,
      [`driver_license_images/${uid}`]: null,
      [`driver_locations/${uid}`]: null,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return jsonError(
      error,
      "Unable to delete driver. Check the Firebase Admin server configuration.",
    );
  }
}