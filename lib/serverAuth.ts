import type { DecodedIdToken } from "firebase-admin/auth";
import type { NextRequest } from "next/server";
import { adminAuth, adminDb } from "./firebase-admin";

const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "system admin",
  "system administrator",
  "super admin",
]);

function isAdminRole(value: unknown): boolean {
  return ADMIN_ROLES.has(String(value || "").trim().toLowerCase());
}

function readBearerToken(request: NextRequest | Request): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error("AUTH_REQUIRED");
  return match[1];
}

export async function requireAuthenticatedUser(
  request: NextRequest | Request,
): Promise<DecodedIdToken> {
  const token = readBearerToken(request);
  return adminAuth.verifyIdToken(token, true);
}

export async function requireAdmin(
  request: NextRequest | Request,
): Promise<DecodedIdToken> {
  const decoded = await requireAuthenticatedUser(request);
  if (decoded.admin === true || isAdminRole(decoded.role)) return decoded;

  const configuredEmails = new Set(
    String(process.env.FIREBASE_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (decoded.email && configuredEmails.has(decoded.email.toLowerCase())) return decoded;

  const [adminSnapshot, legacyProfileSnapshot] = await Promise.all([
    adminDb.ref(`admins/${decoded.uid}`).get(),
    adminDb.ref(`adminProfile/${decoded.uid}`).get(),
  ]);

  const adminRecord = adminSnapshot.val() as
    | { active?: boolean; enabled?: boolean; role?: unknown }
    | null;
  if (
    adminRecord &&
    adminRecord.active !== false &&
    adminRecord.enabled !== false &&
    (adminRecord.active === true || adminRecord.enabled === true || isAdminRole(adminRecord.role))
  ) {
    return decoded;
  }

  const legacyProfile = legacyProfileSnapshot.val() as
    | { active?: boolean; role?: unknown }
    | null;
  if (legacyProfile && legacyProfile.active !== false && isAdminRole(legacyProfile.role)) {
    return decoded;
  }

  throw new Error("ADMIN_REQUIRED");
}

export async function requireDriver(
  request: NextRequest | Request,
): Promise<DecodedIdToken> {
  const decoded = await requireAuthenticatedUser(request);
  if (String(decoded.role || "").toLowerCase() === "driver") return decoded;

  const driver = await adminDb.ref(`drivers/${decoded.uid}`).get();
  if (driver.exists()) return decoded;
  throw new Error("DRIVER_REQUIRED");
}

export function authErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED" || message.includes("ID token")) return 401;
  if (message === "ADMIN_REQUIRED" || message === "DRIVER_REQUIRED") return 403;
  return 500;
}
