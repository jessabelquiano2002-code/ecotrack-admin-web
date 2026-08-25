"use client";

import { useEffect, useState } from "react";
import {
  startOfflineRuntime,
  subscribeOfflineState,
} from "@/lib/offlineFirebaseDatabase";

const WARM_ROUTES = [
  "/dashboard",
  "/drivers",
  "/routes",
  "/schedules",
  "/waste-points",
  "/live-map",
  "/issues",
  "/notifications",
  "/route-status",
  "/resident-compliance",
  "/analytics",
  "/agency-report",
  "/activity-requests",
  "/content-management",
  "/advertisements",
  "/profile",
  "/settings",
];

type State = {
  online: boolean;
  firebaseConnected: boolean;
  pendingWrites: number;
};

const INITIAL_STATE: State = {
  online: true,
  firebaseConnected: false,
  pendingWrites: 0,
};

const OFFLINE_CACHE_PREFIX = "wastetrack-offline-";

async function disableDevelopmentServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  // A production service worker left registered on localhost can cache Next.js
  // development assets and make HMR/compilation look extremely slow or stale.
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(OFFLINE_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
  }
}

function warmOfflineRoutes(registration: ServiceWorkerRegistration) {
  const worker = registration.active || registration.waiting || registration.installing;
  worker?.postMessage({ type: "WARM_ROUTES", routes: WARM_ROUTES });
}

export function OfflineRuntime() {
  const [state, setState] = useState<State>(INITIAL_STATE);

  useEffect(() => {
    const stopRuntime = startOfflineRuntime();
    const stopState = subscribeOfflineState(setState);

    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then(() => navigator.serviceWorker.ready)
          .then((registration) => {
            // Do not compete with the first page load. Give the dashboard a
            // short head start before warming the remaining offline routes.
            globalThis.setTimeout(() => warmOfflineRoutes(registration), 2500);
          })
          .catch(() => undefined);
      } else {
        void disableDevelopmentServiceWorkers();
      }
    }

    // Next.js App Router uses RSC fetches for client-side navigation. When the
    // device is offline, force same-origin links to perform a normal document
    // navigation instead so the service worker can serve the warmed HTML shell.
    const handleOfflineNavigation = (event: MouseEvent) => {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== "_self") return;
      if (target.hasAttribute("download")) return;

      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!url.pathname.startsWith("/")) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener("click", handleOfflineNavigation, true);

    return () => {
      document.removeEventListener("click", handleOfflineNavigation, true);
      stopState();
      stopRuntime();
    };
  }, []);

  const offline = !state.online || !state.firebaseConnected;
  if (!offline && state.pendingWrites === 0) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={offline ? "WasteTrack offline status" : "WasteTrack synchronization status"}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 420,
        padding: "13px 16px",
        border: `1px solid ${offline ? "#f4c66a" : "#b8dfc9"}`,
        borderRadius: 14,
        background: offline ? "#fff8e8" : "#effbf4",
        color: "#334155",
        boxShadow: "0 12px 28px rgba(15,23,42,.13)",
        fontSize: 14,
        lineHeight: 1.4,
        fontWeight: 750,
      }}
    >
      <span aria-hidden="true">{offline ? "●" : "↻"}</span>
      <span>
        {offline
          ? `Offline mode${state.pendingWrites ? ` • ${state.pendingWrites} change${state.pendingWrites === 1 ? "" : "s"} waiting to sync` : " • showing saved data"}`
          : `Back online • ${state.pendingWrites} change${state.pendingWrites === 1 ? "" : "s"} syncing`}
      </span>
    </aside>
  );
}
