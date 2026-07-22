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

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);
  const [message, setMessage] = useState("Restoring secure session…");

  useEffect(() => {
    let cancelled = false;
    let unsub: () => void = () => {};

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
              redirectToLogin({ reason: "sign-in-required", next: pathname });
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
              setMessage("Unable to verify the session. Redirecting to sign in…");
              setChecking(true);
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
    return <AuthStatusScreen message={message} />;
  }

  if (!isAllowed) {
    return <AuthStatusScreen message="Redirecting to secure login…" />;
  }

  return <>{children}</>;
}

function AuthStatusScreen({ message }: { message: string }) {
  return (
    <main className="auth-loading" aria-live="polite" aria-busy="true">
      <span className="auth-logo" aria-hidden="true">E</span>
      <strong>WasteTrack Administration</strong>
      <p>{message}</p>
      <span className="auth-progress" aria-hidden="true"><i /></span>
      <style jsx>{`
        .auth-loading {
          min-height: 100dvh;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 11px;
          padding: 24px;
          background:
            radial-gradient(circle at 50% 20%, rgba(16, 185, 129, 0.12), transparent 30%),
            #f4f7f5;
          color: #0f172a;
          text-align: center;
        }
        .auth-logo {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          margin-bottom: 5px;
          border-radius: 15px;
          background: linear-gradient(145deg, #0aa574, #087a59);
          color: #ffffff;
          box-shadow: 0 14px 28px rgba(8, 122, 89, 0.22);
          font-size: 20px;
          font-weight: 900;
        }
        .auth-loading strong { font-size: 20px; letter-spacing: -0.02em; }
        .auth-loading p { margin: 0; color: #64748b; font-size: 13px; }
        .auth-progress {
          width: 180px;
          height: 4px;
          overflow: hidden;
          margin-top: 7px;
          border-radius: 999px;
          background: #dbe9e1;
        }
        .auth-progress i {
          display: block;
          width: 45%;
          height: 100%;
          border-radius: inherit;
          background: #0aa574;
          animation: progress 1s ease-in-out infinite alternate;
        }
        @keyframes progress {
          from { transform: translateX(-25%); }
          to { transform: translateX(145%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-progress i { animation: none; width: 100%; }
        }
      `}</style>
    </main>
  );
}
