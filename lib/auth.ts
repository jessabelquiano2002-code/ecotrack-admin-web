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
    | "offline-cache"
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

const OFFLINE_AUTH_KEY = "wastetrack.admin.offline-authorization.v1";
const OFFLINE_AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CachedAdminAuthorization = {
  uid: string;
  verifiedAt: number;
  source: "custom-claim" | "server-policy";
};

function isAdminRole(value: unknown): boolean {
  return ADMIN_ROLE_VALUES.has(
    String(value || "").trim().toLowerCase(),
  );
}

function readCachedAuthorization(user: User): CachedAdminAuthorization | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OFFLINE_AUTH_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedAdminAuthorization>;
    if (cached.uid !== user.uid || typeof cached.verifiedAt !== "number") return null;
    if (Date.now() - cached.verifiedAt > OFFLINE_AUTH_MAX_AGE_MS) return null;
    if (cached.source !== "custom-claim" && cached.source !== "server-policy") return null;
    return cached as CachedAdminAuthorization;
  } catch {
    return null;
  }
}

function rememberAuthorization(user: User, source: CachedAdminAuthorization["source"]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify({
      uid: user.uid,
      verifiedAt: Date.now(),
      source,
    } satisfies CachedAdminAuthorization));
  } catch {
    // Browser storage can be disabled; online authorization still works.
  }
}

export function clearCachedAdminAuthorization(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OFFLINE_AUTH_KEY);
  } catch {
    // Best effort only.
  }
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
  const cached = readCachedAuthorization(user);
  const browserOffline = typeof navigator !== "undefined" && !navigator.onLine;

  // The web Firebase Auth session is persisted locally. While fully offline,
  // do not force a token refresh or call the Vercel API; use a recent admin
  // verification that was stored on this same browser profile instead.
  if (browserOffline) {
    if (cached) return { allowed: true, source: "offline-cache" };
    throw new Error("Offline administrator access has not been verified on this device yet.");
  }

  try {
    // Avoid the old `true` force-refresh: it made every page load depend on
    // network access even when Firebase already had a valid local token.
    const token = await getIdTokenResult(user, false);

    if (
      token.claims.admin === true ||
      isAdminRole(token.claims.role)
    ) {
      rememberAuthorization(user, "custom-claim");
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
      rememberAuthorization(user, "server-policy");
      return {
        allowed: true,
        source: "server-policy",
      };
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      clearCachedAdminAuthorization();
      return {
        allowed: false,
        source: "none",
      };
    }

    throw new Error(
      body?.error ||
        "Administrator verification is unavailable.",
    );
  } catch (error) {
    // Vercel/Firebase may be unreachable even while the browser still reports
    // navigator.onLine=true (for example, captive portal or DNS outage).
    if (cached) return { allowed: true, source: "offline-cache" };
    throw error;
  }
}

export async function signOutAdmin(): Promise<void> {
  clearCachedAdminAuthorization();
  try {
    const { clearOfflineDatabase } = await import("./offlineFirebaseDatabase");
    await clearOfflineDatabase();
  } catch {
    // Never block sign-out because local cache cleanup failed.
  }
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
