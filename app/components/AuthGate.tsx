"use client";

import { onAuthStateChanged } from "firebase/auth";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { auth } from "../../lib/firebase";
import {
  authorizeAdmin,
  beginSignOutRedirect,
  configureAuthPersistence,
  isSignOutRedirectInProgress,
  redirectToLogin,
  signOutAdmin,
} from "../../lib/auth";
import { MetroWasteLoading } from "./MetroWasteLoading";

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);
  const [message, setMessage] = useState("Restoring secure session…");

  useEffect(() => {
    let cancelled = false;
    let unsub: () => void = () => {};

    // Every protected page starts from the same MetroWaste loading experience.
    setChecking(true);
    setMessage("Verifying administrator access…");

    configureAuthPersistence()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;

        unsub = onAuthStateChanged(auth, async (user) => {
          if (!user) {
            if (isSignOutRedirectInProgress()) return;

            if (!cancelled) {
              setIsAllowed(false);
              setChecking(true);
              setMessage("Sign-in required. Redirecting to secure login…");
              redirectToLogin({
                reason: "sign-in-required",
                next: pathname,
              });
            }
            return;
          }

          try {
            setMessage("Verifying administrator access…");

            const authorization = await authorizeAdmin(user);

            if (cancelled) return;

            if (!authorization.allowed) {
              beginSignOutRedirect();
              await signOutAdmin().catch(() => undefined);
              redirectToLogin({ reason: "unauthorized" });
              return;
            }

            setIsAllowed(true);
            setChecking(false);
          } catch {
            if (!cancelled) {
              setIsAllowed(false);
              setChecking(true);

              if (
                typeof navigator !== "undefined" &&
                !navigator.onLine
              ) {
                setMessage(
                  "Offline access is not verified on this device yet. Connect once, sign in, then MetroWaste can reopen offline.",
                );
                return;
              }

              setMessage(
                "Unable to verify the session. Redirecting to sign in…",
              );

              beginSignOutRedirect();
              await signOutAdmin().catch(() => undefined);

              redirectToLogin({ reason: "session-error" });
            }
          }
        });
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [pathname]);

  if (checking) {
    return (
      <MetroWasteLoading
        title="MetroWaste Administration"
        message={message}
      />
    );
  }

  if (!isAllowed) {
    return (
      <MetroWasteLoading
        title="MetroWaste Administration"
        message="Redirecting to secure login…"
      />
    );
  }

  return <>{children}</>;
}
