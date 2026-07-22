import type { DecodedIdToken } from "firebase-admin/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  adminAuth,
  adminDb,
} from "../../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLE_VALUES = new Set([
  "admin",
  "administrator",
  "system admin",
  "system administrator",
  "super admin",
]);

function isAdminRole(value: unknown): boolean {
  return ADMIN_ROLE_VALUES.has(
    String(value ?? "").trim().toLowerCase(),
  );
}

function getAllowedAdminEmails(): Set<string> {
  const value = process.env.FIREBASE_ADMIN_EMAILS ?? "";

  return new Set(
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isEnabledAdminRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as {
    active?: boolean;
    enabled?: boolean;
    role?: unknown;
  };

  return (
    record.active !== false &&
    record.enabled !== false &&
    (
      record.active === true ||
      record.enabled === true ||
      isAdminRole(record.role)
    )
  );
}

function isEnabledLegacyProfile(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as {
    active?: boolean;
    role?: unknown;
  };

  return (
    profile.active !== false &&
    isAdminRole(profile.role)
  );
}

export async function POST(request: NextRequest) {
  try {
    const authorizationHeader =
      request.headers.get("authorization");

    if (
      !authorizationHeader ||
      !authorizationHeader.startsWith("Bearer ")
    ) {
      return NextResponse.json(
        {
          allowed: false,
          error: "Missing Firebase ID token.",
        },
        { status: 401 },
      );
    }

    const idToken = authorizationHeader
      .slice("Bearer ".length)
      .trim();

    if (!idToken) {
      return NextResponse.json(
        {
          allowed: false,
          error: "Missing Firebase ID token.",
        },
        { status: 401 },
      );
    }

    let decodedToken: DecodedIdToken;

    try {
      decodedToken = await adminAuth.verifyIdToken(
        idToken,
        true,
      );
    } catch (error: unknown) {
      console.error(
        "Firebase ID-token verification failed:",
        error,
      );

      return NextResponse.json(
        {
          allowed: false,
          error: "Invalid or expired sign-in session.",
        },
        { status: 401 },
      );
    }

    const email = String(decodedToken.email ?? "")
      .trim()
      .toLowerCase();

    const allowedEmails = getAllowedAdminEmails();

    const allowedByEmail =
      email.length > 0 &&
      allowedEmails.has(email);

    const allowedByClaim =
      decodedToken.admin === true ||
      isAdminRole(decodedToken.role);

    if (allowedByClaim || allowedByEmail) {
      return NextResponse.json(
        {
          allowed: true,
          email,
          source: allowedByClaim
            ? "custom-claim"
            : "email-allowlist",
        },
        { status: 200 },
      );
    }

    const [
      adminSnapshot,
      legacyProfileSnapshot,
    ] = await Promise.all([
      adminDb
        .ref(`admins/${decodedToken.uid}`)
        .get(),

      adminDb
        .ref(`adminProfile/${decodedToken.uid}`)
        .get(),
    ]);

    const allowedByAdminRecord =
      isEnabledAdminRecord(adminSnapshot.val());

    const allowedByLegacyProfile =
      isEnabledLegacyProfile(
        legacyProfileSnapshot.val(),
      );

    if (
      !allowedByAdminRecord &&
      !allowedByLegacyProfile
    ) {
      return NextResponse.json(
        {
          allowed: false,
          error: "This account is not authorized.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        email,
        source: allowedByAdminRecord
          ? "admins-record"
          : "legacy-admin-profile",
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error(
      "Admin authorization failed:",
      error,
    );

    return NextResponse.json(
      {
        allowed: false,
        error:
          "The server could not verify administrator access.",
      },
      { status: 500 },
    );
  }
}