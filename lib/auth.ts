import {
  browserLocalPersistence,
  getIdTokenResult,
  setPersistence,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

export type AdminAuthorization = {
  allowed: boolean;
  source:
    | "custom-claim"
    | "server-policy"
    | "admins-record"
    | "legacy-admin-profile"
    | "none";
};

export type LoginRedirectReason =
  | "signed-out"
  | "sign-in-required"
  | "unauthorized"
  | "session-error";

let signOutRedirectInProgress = false;

const ADMIN_ROLE_VALUES = new Set([
  "admin",
  "administrator",
  "system admin",
  "system administrator",
  "super admin",
]);

function isAdminRole(value: unknown): boolean {
  return ADMIN_ROLE_VALUES.has(
    String(value || "").trim().toLowerCase(),
  );
}

export async function configureAuthPersistence(): Promise<void> {
  await setPersistence(
    auth,
    browserLocalPersistence,
  );
}

export async function authorizeAdmin(
  user: User,
): Promise<AdminAuthorization> {
  const token = await getIdTokenResult(user, true);

  if (
    token.claims.admin === true ||
    isAdminRole(token.claims.role)
  ) {
    return {
      allowed: true,
      source: "custom-claim",
    };
  }

  const response = await fetch(
    "/api/auth/authorize",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${await user.getIdToken()}`,
      },
      cache: "no-store",
    },
  );

  const body = (
    await response.json().catch(() => null)
  ) as {
    allowed?: boolean;
    error?: string;
  } | null;

  if (
    response.ok &&
    body?.allowed === true
  ) {
    return {
      allowed: true,
      source: "server-policy",
    };
  }

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return {
      allowed: false,
      source: "none",
    };
  }

  throw new Error(
    body?.error ||
      "Administrator verification is unavailable.",
  );
}

export async function signOutAdmin(): Promise<void> {
  await signOut(auth);
}

export function beginSignOutRedirect(): void {
  signOutRedirectInProgress = true;
}

export function cancelSignOutRedirect(): void {
  signOutRedirectInProgress = false;
}

export function isSignOutRedirectInProgress(): boolean {
  return signOutRedirectInProgress;
}

export function getSafeAdminDestination(
  value: string | null | undefined,
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/dashboard";
  }

  if (
    value === "/" ||
    value === "/login" ||
    value.startsWith("/login?")
  ) {
    return "/dashboard";
  }

  return value;
}

export function redirectToLogin(
  options: {
    reason?: LoginRedirectReason;
    next?: string;
  } = {},
): void {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams();

  if (options.reason) {
    params.set("reason", options.reason);
  }

  if (options.next) {
    params.set(
      "next",
      getSafeAdminDestination(options.next),
    );
  }

  const query = params.toString();

  window.location.replace(
    query
      ? `/login?${query}`
      : "/login",
  );
}

export function redirectToAdminPage(
  path: string | null | undefined,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.location.replace(
    getSafeAdminDestination(path),
  );
}