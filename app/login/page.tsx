"use client";

import { FirebaseError } from "firebase/app";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { auth } from "../../lib/firebase";
import {
  authorizeAdmin,
  configureAuthPersistence,
  getSafeAdminDestination,
  redirectToAdminPage,
  signOutAdmin,
} from "../../lib/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginFormPage />
    </Suspense>
  );
}

function LoginFormPage() {
  const searchParams = useSearchParams();
  const requestedPath = searchParams.get("next");
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const signingInRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    let unsubscribe: () => void = () => {};

    configureAuthPersistence()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user || signingInRef.current) return;
          try {
            const authorization = await authorizeAdmin(user);
            if (!cancelled && authorization.allowed) {
              setLoading(true);
              redirectToAdminPage(requestedPath);
            }
          } catch {
            // The form remains available and will show a specific error on submit.
          }
        });
      });

    if (reason === "unauthorized") {
      setError("This account is valid, but it is not authorized to access the admin system.");
    } else if (reason === "session-error") {
      setError("Your session could not be verified. Please sign in again.");
    } else if (reason === "signed-out") {
      setNotice("You have signed out successfully. Your administrator session is now closed.");
    } else if (reason === "sign-in-required") {
      setNotice("Please sign in with an authorized administrator account to continue.");
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reason, requestedPath]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) return;

    const form = event.currentTarget;
    const cleanEmail = email.trim().toLowerCase();

    setError("");
    setNotice("");

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    signingInRef.current = true;
    setLoading(true);

    try {
      await configureAuthPersistence();
      const credential = await signInWithEmailAndPassword(
        auth,
        cleanEmail,
        password,
      );

      const authorization = await authorizeAdmin(credential.user);

      if (!authorization.allowed) {
        await signOutAdmin();
        setError(
          "This account is valid, but it is not authorized to access the admin system.",
        );
        return;
      }

      redirectToAdminPage(getSafeAdminDestination(requestedPath));
    } catch (unknownError: unknown) {
      const code =
        unknownError instanceof FirebaseError ? unknownError.code : undefined;

      setError(getFriendlyAuthError(code));
    } finally {
      signingInRef.current = false;
      setLoading(false);
    }
  }

  // The form is rendered only after hydration. This prevents browser
  // extensions from injecting attributes into SSR form controls before React
  // hydrates them (for example, fdprocessedid).
  if (!mounted) return <LoginLoading />;

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="WasteTrack administration">
        <div className="brand-shade" aria-hidden="true" />
        <div className="brand-grid" aria-hidden="true" />

        <div className="brand-content">
          <header className="brand-header">
            <LogoMark />

            <div>
              <p className="product-name">WasteTrack</p>
              <p className="product-subtitle">
                Catbalogan City Waste Management
              </p>
            </div>
          </header>

          <div className="brand-message">
            <span className="eyebrow">Operations Administration</span>
            <h1>
              One secure workspace for cleaner, coordinated city services.
            </h1>
            <p>
              Manage collection operations, route assignments, driver activity,
              resident records, and service notifications from a unified control
              center.
            </p>
          </div>

          <div className="capability-row" aria-label="System capabilities">
            <Capability icon={<LocationIcon />} label="Route oversight" />
            <Capability icon={<VehicleIcon />} label="Fleet monitoring" />
            <Capability icon={<BellIcon />} label="Service alerts" />
          </div>
        </div>
      </section>

      <section className="form-panel">
        <div className="form-shell">
          <div className="mobile-brand">
            <LogoMark compact />
            <div>
              <strong>WasteTrack</strong>
              <span>Administration</span>
            </div>
          </div>

          <div className="form-heading">
            <span>Authorized personnel only</span>
            <h2>Sign in to your account</h2>
            <p>Use your assigned administrator credentials to continue.</p>
          </div>

          <form
            className="login-form"
            onSubmit={handleSubmit}
            noValidate={false}
            aria-busy={loading}
          >
            {error ? (
              <div className="error-message" role="alert" aria-live="assertive">
                <ErrorIcon />
                <span>{error}</span>
              </div>
            ) : null}

            {notice ? (
              <div className="notice-message" role="status" aria-live="polite">
                <CheckIcon />
                <span>{notice}</span>
              </div>
            ) : null}

            <div className="field-group">
              <label htmlFor="email">Email address</label>
              <div className="input-shell">
                <MailIcon />
                <input
                  suppressHydrationWarning
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="admin@wastetrack.gov.ph"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError("");
                  }}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="password">Password</label>
                <span>Case-sensitive</span>
              </div>

              <div className="input-shell password-shell">
                <LockIcon />
                <input
                  suppressHydrationWarning
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError("");
                  }}
                  disabled={loading}
                  required
                />

                <button
                  suppressHydrationWarning
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <button
              suppressHydrationWarning
              className="submit-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Verifying account…
                </>
              ) : (
                <>
                  Sign in securely
                  <ArrowIcon />
                </>
              )}
            </button>
          </form>

          <div className="security-card">
            <ShieldIcon />
            <div>
              <strong>Protected administrative access</strong>
              <p>
                Authentication and administrator-role verification are required
                before dashboard access is granted.
              </p>
            </div>
          </div>

          <footer className="page-footer">
            <span>© 2026 WasteTrack</span>
            <span aria-hidden="true">•</span>
            <span>Catbalogan City Waste Management</span>
          </footer>
        </div>
      </section>

      <style jsx>{`
        :global(*) {
          box-sizing: border-box;
        }

        :global(html),
        :global(body) {
          margin: 0;
          min-height: 100%;
          background: #f4f7f5;
        }

        :global(body) {
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        :global(button),
        :global(input) {
          font: inherit;
        }

        .login-page {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: minmax(0, 1.08fr) minmax(430px, 0.92fr);
          color: #17231d;
          background: #f4f7f5;
        }

        .brand-panel {
          position: relative;
          min-height: 100dvh;
          overflow: hidden;
          isolation: isolate;
          background:
            linear-gradient(
              145deg,
              rgba(3, 64, 49, 0.94),
              rgba(9, 111, 80, 0.77)
            ),
            url("/login-bg.jpg") center / cover no-repeat;
        }

        .brand-shade {
          position: absolute;
          inset: 0;
          z-index: -2;
          background:
            radial-gradient(
              circle at 16% 18%,
              rgba(167, 243, 208, 0.23),
              transparent 27%
            ),
            radial-gradient(
              circle at 86% 82%,
              rgba(94, 234, 212, 0.16),
              transparent 34%
            ),
            linear-gradient(90deg, rgba(1, 41, 31, 0.72), rgba(3, 84, 60, 0.16));
        }

        .brand-grid {
          position: absolute;
          inset: 0;
          z-index: -1;
          opacity: 0.2;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.08) 1px,
              transparent 1px
            );
          background-size: 48px 48px;
          mask-image: linear-gradient(to bottom, black, transparent 86%);
        }

        .brand-content {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 64px;
          padding: clamp(34px, 5vw, 72px);
          color: #ffffff;
        }

        .brand-header {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .product-name,
        .product-subtitle {
          margin: 0;
        }

        .product-name {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.025em;
        }

        .product-subtitle {
          margin-top: 3px;
          color: rgba(236, 253, 245, 0.78);
          font-size: 13px;
        }

        .brand-message {
          max-width: 760px;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid rgba(209, 250, 229, 0.25);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.09);
          color: #bbf7d0;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
        }

        .brand-message h1 {
          max-width: 740px;
          margin: 22px 0 0;
          font-size: clamp(43px, 5.25vw, 72px);
          line-height: 1.01;
          letter-spacing: -0.055em;
          text-wrap: balance;
        }

        .brand-message p {
          max-width: 610px;
          margin: 24px 0 0;
          color: rgba(236, 253, 245, 0.82);
          font-size: 16px;
          line-height: 1.72;
        }

        .capability-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          max-width: 760px;
        }

        .form-panel {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 36px;
          background:
            radial-gradient(
              circle at 100% 0%,
              rgba(16, 185, 129, 0.1),
              transparent 28%
            ),
            #f4f7f5;
        }

        .form-shell {
          width: min(100%, 460px);
        }

        .mobile-brand {
          display: none;
          align-items: center;
          gap: 12px;
          margin-bottom: 34px;
        }

        .mobile-brand strong,
        .mobile-brand span {
          display: block;
        }

        .mobile-brand strong {
          color: #064e3b;
          font-size: 18px;
        }

        .mobile-brand span {
          margin-top: 2px;
          color: #6b7c73;
          font-size: 12px;
        }

        .form-heading > span {
          color: #07845f;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .form-heading h2 {
          margin: 12px 0 0;
          color: #17231d;
          font-size: clamp(32px, 4vw, 40px);
          line-height: 1.08;
          letter-spacing: -0.045em;
        }

        .form-heading p {
          margin: 10px 0 0;
          color: #66766d;
          font-size: 14px;
          line-height: 1.6;
        }

        .login-form {
          margin-top: 30px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .error-message {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 13px 14px;
          border: 1px solid #fecaca;
          border-radius: 14px;
          background: #fff4f4;
          color: #9f1d1d;
          font-size: 13px;
          font-weight: 650;
          line-height: 1.45;
        }

        .notice-message {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 13px 14px;
          border: 1px solid #a7f3d0;
          border-radius: 14px;
          background: #ecfdf5;
          color: #06664b;
          font-size: 13px;
          font-weight: 650;
          line-height: 1.45;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .field-group label {
          color: #31473c;
          font-size: 13px;
          font-weight: 750;
        }

        .field-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .field-label-row span {
          color: #8b9891;
          font-size: 11px;
        }

        .input-shell {
          position: relative;
          display: flex;
          align-items: center;
          min-height: 54px;
          border: 1px solid #d8e2dc;
          border-radius: 15px;
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(16, 24, 20, 0.03);
          transition:
            border-color 160ms ease,
            box-shadow 160ms ease,
            background 160ms ease;
        }

        .input-shell:focus-within {
          border-color: #11a779;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.11);
        }

        .input-shell input {
          width: 100%;
          height: 52px;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          padding: 0 14px 0 46px;
          color: #17231d;
          font-size: 14px;
        }

        .password-shell input {
          padding-right: 54px;
        }

        .input-shell input::placeholder {
          color: #a1aca6;
        }

        .input-shell input:disabled {
          cursor: not-allowed;
          opacity: 0.68;
        }

        .password-toggle {
          position: absolute;
          right: 8px;
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 11px;
          background: transparent;
          color: #6f8177;
          cursor: pointer;
          transition:
            background 150ms ease,
            color 150ms ease;
        }

        .password-toggle:hover:not(:disabled) {
          background: #edf8f3;
          color: #07845f;
        }

        .password-toggle:focus-visible,
        .submit-button:focus-visible {
          outline: 3px solid rgba(16, 185, 129, 0.25);
          outline-offset: 2px;
        }

        .password-toggle:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .submit-button {
          min-height: 54px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 2px;
          border: 0;
          border-radius: 15px;
          background: linear-gradient(135deg, #0aa574, #087a59);
          color: #ffffff;
          box-shadow: 0 14px 28px rgba(8, 122, 89, 0.22);
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          transition:
            transform 150ms ease,
            box-shadow 150ms ease,
            filter 150ms ease;
        }

        .submit-button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.05);
          box-shadow: 0 17px 32px rgba(8, 122, 89, 0.27);
        }

        .submit-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-button:disabled {
          cursor: not-allowed;
          filter: grayscale(0.2);
          opacity: 0.72;
          box-shadow: none;
        }

        .spinner {
          width: 17px;
          height: 17px;
          border: 2px solid rgba(255, 255, 255, 0.38);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 700ms linear infinite;
        }

        .security-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-top: 24px;
          padding: 15px;
          border: 1px solid #dbeae1;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.72);
        }

        .security-card strong {
          display: block;
          color: #29483a;
          font-size: 12px;
        }

        .security-card p {
          margin: 4px 0 0;
          color: #718078;
          font-size: 11px;
          line-height: 1.5;
        }

        .page-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 28px;
          color: #95a099;
          font-size: 11px;
          text-align: center;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }

        @media (max-width: 1080px) {
          .login-page {
            grid-template-columns: 1fr;
          }

          .brand-panel {
            display: none;
          }

          .form-panel {
            padding: 32px 22px;
          }

          .mobile-brand {
            display: flex;
          }
        }

        @media (max-width: 520px) {
          .form-panel {
            align-items: flex-start;
            padding: 24px 18px;
          }

          .form-shell {
            padding-top: 8px;
          }

          .form-heading h2 {
            font-size: 32px;
          }
        }
      `}</style>
    </main>
  );
}

function LoginLoading() {
  return (
    <main aria-label="Loading WasteTrack administration" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f8fafc", color: "#0f172a", fontFamily: "Arial, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <strong style={{ display: "block", fontSize: 22 }}>WasteTrack</strong>
        <span style={{ display: "block", marginTop: 8, color: "#64748b" }}>Preparing secure sign-in…</span>
      </div>
    </main>
  );
}

function Capability({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="capability">
      <span className="capability-icon">{icon}</span>
      <span>{label}</span>

      <style jsx>{`
        .capability {
          min-height: 78px;
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 15px;
          border: 1px solid rgba(255, 255, 255, 0.17);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.09);
          color: rgba(255, 255, 255, 0.94);
          font-size: 13px;
          font-weight: 700;
          backdrop-filter: blur(12px);
        }

        .capability-icon {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: rgba(209, 250, 229, 0.13);
          color: #a7f3d0;
        }
      `}</style>
    </div>
  );
}

function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "logo compact" : "logo"} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M16 4.5c5.8 0 10.5 4.7 10.5 10.5S21.8 25.5 16 25.5 5.5 20.8 5.5 15 10.2 4.5 16 4.5Z"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path
          d="M10.7 17.9c4.9-.1 8.7-2.5 10.9-6.5.5 5.8-2.4 10.1-7.3 10.1-2.1 0-3.3-1.4-3.6-3.6Z"
          fill="currentColor"
        />
        <path
          d="M12.5 20.8c1.4-2.6 3.7-4.8 7-6.6"
          stroke="#064E3B"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>

      <style jsx>{`
        .logo {
          width: 50px;
          height: 50px;
          flex: 0 0 50px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255, 255, 255, 0.24);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.12);
          color: #d1fae5;
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.14);
          backdrop-filter: blur(12px);
        }

        .logo.compact {
          width: 44px;
          height: 44px;
          flex-basis: 44px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(145deg, #10a979, #087859);
          color: #ecfdf5;
          box-shadow: 0 12px 22px rgba(8, 122, 89, 0.2);
        }

        svg {
          width: 29px;
          height: 29px;
        }
      `}</style>
    </div>
  );
}

function getFriendlyAuthError(code?: string) {
  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-disabled":
      return "This administrator account has been disabled. Contact the system owner.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "The email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many unsuccessful attempts. Wait a moment before trying again.";
    case "auth/network-request-failed":
      return "A network error occurred. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled for this Firebase project.";
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}

function MailIcon() {
  return (
    <Icon path="M4 7.5 12 13l8-5.5M5.8 19h12.4A1.8 1.8 0 0 0 20 17.2V6.8A1.8 1.8 0 0 0 18.2 5H5.8A1.8 1.8 0 0 0 4 6.8v10.4A1.8 1.8 0 0 0 5.8 19Z" />
  );
}

function LockIcon() {
  return (
    <Icon path="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12a2 2 0 0 1 2 2v7H4v-7a2 2 0 0 1 2-2Zm6 4v2" />
  );
}

function LocationIcon() {
  return (
    <SmallIcon path="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Zm0-8.5A2.5 2.5 0 1 0 12 7a2.5 2.5 0 0 0 0 5.5Z" />
  );
}

function VehicleIcon() {
  return (
    <SmallIcon path="M5 16h14l-1.2-5.3A2 2 0 0 0 15.9 9H8.1a2 2 0 0 0-1.9 1.7L5 16Zm1 0v3m12-3v3M7.5 19h0m9 0h0M4 13H2m18 0h2" />
  );
}

function BellIcon() {
  return (
    <SmallIcon path="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Zm-8 10h4" />
  );
}

function ShieldIcon() {
  return (
    <span className="shield-icon" aria-hidden="true">
      <SmallIcon path="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Zm-3 9 2 2 4-4" />
      <style jsx>{`
        .shield-icon {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          display: grid;
          place-items: center;
          border-radius: 11px;
          background: #e8f7ef;
          color: #07845f;
        }
      `}</style>
    </span>
  );
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.3 2.3 4.9-5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <SmallIcon path="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
  );
}

function EyeOffIcon() {
  return (
    <SmallIcon path="m3 3 18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M6.7 6.7C4 8.6 2.5 12 2.5 12S6 18 12 18a9.8 9.8 0 0 0 3.2-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <span className="input-icon" aria-hidden="true">
      <SmallIcon path={path} />
      <style jsx>{`
        .input-icon {
          position: absolute;
          left: 15px;
          display: grid;
          place-items: center;
          color: #77877f;
          pointer-events: none;
        }
      `}</style>
    </span>
  );
}

function SmallIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
