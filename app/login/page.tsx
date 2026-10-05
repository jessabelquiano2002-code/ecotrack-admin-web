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
    <Suspense
      fallback={
        <LoginLoading
          message="Preparing secure sign-in…"
          detail="Loading the MetroWaste administration portal."
        />
      }
    >
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
            // Keep the sign-in form available.
            // Submit will display a specific authentication error when needed.
          }
        });
      });

    if (reason === "unauthorized") {
      setError(
        "This account is valid, but it is not authorized to access the admin system.",
      );
    } else if (reason === "session-error") {
      setError("Your session could not be verified. Please sign in again.");
    } else if (reason === "signed-out") {
      setNotice(
        "You have signed out successfully. Your administrator session is now closed.",
      );
    } else if (reason === "sign-in-required") {
      setNotice(
        "Please sign in with an authorized administrator account to continue.",
      );
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

  if (!mounted) {
    return (
      <LoginLoading
        message="Preparing secure sign-in…"
        detail="Loading MetroWaste administrative services."
      />
    );
  }

  /*
   * The full-screen loader appears while:
   * - an existing administrator session is being redirected, or
   * - submitted credentials are being authenticated / role-verified.
   *
   * This replaces the plain static verification screen with the animated
   * MetroWaste truck while preserving the authentication logic above.
   */
  if (loading) {
    return (
      <LoginLoading
        message="Verifying administrator access…"
        detail="Checking your account and preparing the operations dashboard."
      />
    );
  }

  return (
    <main className="login-page">
      {/* Approved MetroWaste/Catbalogan truck visual. */}
      <section
        className="visual-panel"
        aria-label="MetroWaste operations administration"
      >
        <img
          className="approved-visual"
          src="/login-approved-left.png"
          alt="MetroWaste operations administration for Catbalogan City"
        />
      </section>

      <section className="access-panel">
        <div className="mobile-brand">
          <img src="/metrowaste-logo.jpg" alt="MetroWaste logo" />
          <div>
            <strong>Metrowaste</strong>
            <span>Solid Waste Management Corp.</span>
            <small>Waste management service in Catbalogan</small>
          </div>
        </div>

        <div className="access-column">
          <section className="login-card" aria-labelledby="login-title">
            <header className="login-heading">
              <div className="authorized-label">
                <LockBadgeIcon />
                <span>Authorized personnel only</span>
              </div>

              <h1 id="login-title">
                Sign in to MetroWaste
                <br />
                Administration
              </h1>

              <p>
                Enter your assigned administrator credentials to continue.
              </p>
            </header>

            <form
              className="login-form"
              onSubmit={handleSubmit}
              aria-busy={loading}
            >
              {error ? (
                <div
                  className="message error"
                  role="alert"
                  aria-live="assertive"
                >
                  <ErrorIcon />
                  <div>
                    <strong>Unable to sign in</strong>
                    <span>{error}</span>
                  </div>
                </div>
              ) : null}

              {notice ? (
                <div
                  className="message notice"
                  role="status"
                  aria-live="polite"
                >
                  <CheckIcon />
                  <div>
                    <strong>Account information</strong>
                    <span>{notice}</span>
                  </div>
                </div>
              ) : null}

              <div className="field-group">
                <label htmlFor="email">Email address</label>

                <div className="input-shell">
                  <span className="input-icon">
                    <MailIcon />
                  </span>

                  <input
                    suppressHydrationWarning
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Enter your email address"
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
                  <span className="input-icon">
                    <LockIcon />
                  </span>

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
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={loading}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
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
                Sign in securely
                <ArrowIcon />
              </button>
            </form>

            <div className="security-card">
              <div className="security-icon">
                <ShieldIcon />
              </div>

              <div>
                <strong>Protected administrative access</strong>
                <p>
                  Authorized MetroWaste personnel only. Account and
                  administrator-role verification are required before dashboard
                  access is granted.
                </p>
              </div>
            </div>

            <div className="support-row">
              <div className="support-icon">
                <HeadsetIcon />
              </div>

              <div>
                <strong>Need assistance?</strong>
                <span>Contact the system administrator.</span>
              </div>
            </div>
          </section>

          <footer className="page-footer">
            <span>© 2026 Metrowaste Solid Waste Management Corp.</span>
            <small>Waste management service in Catbalogan</small>
          </footer>
        </div>
      </section>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          min-height: 100%;
          background: #f6faf8;
        }

        body {
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
          color: #102238;
        }

        button,
        input {
          font: inherit;
        }

        .login-page {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: 57.55% 42.45%;
          overflow: hidden;
          background: #f6faf8;
        }

        .visual-panel {
          position: relative;
          min-width: 0;
          min-height: 100dvh;
          overflow: hidden;
          background: #00543e;
        }

        .approved-visual {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          object-position: center center;
        }

        .access-panel {
          min-width: 0;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 44px 34px;
          background:
            radial-gradient(
              circle at 100% 0%,
              rgba(10, 143, 87, 0.07),
              transparent 34%
            ),
            linear-gradient(180deg, #fbfdfc 0%, #f4f8f6 100%);
        }

        .access-column {
          width: min(100%, 560px);
          display: grid;
          gap: 22px;
        }

        .mobile-brand {
          display: none;
        }

        .login-card {
          padding: 46px 42px 42px;
          border: 1px solid #e0e8e4;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 18px 52px rgba(18, 49, 34, 0.11);
        }

        .authorized-label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          color: #087d4b;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .authorized-label svg {
          width: 18px;
          height: 18px;
        }

        .login-heading h1 {
          margin: 25px 0 0;
          color: #102238;
          font-size: clamp(35px, 3vw, 44px);
          line-height: 1.04;
          letter-spacing: -0.045em;
          font-weight: 900;
        }

        .login-heading p {
          margin: 14px 0 0;
          color: #607187;
          font-size: 15px;
          line-height: 1.55;
        }

        .login-form {
          display: grid;
          gap: 18px;
          margin-top: 31px;
        }

        .message {
          display: grid;
          grid-template-columns: 20px 1fr;
          gap: 10px;
          align-items: start;
          padding: 13px 14px;
          border-radius: 10px;
          font-size: 12px;
          line-height: 1.45;
        }

        .message strong,
        .message span {
          display: block;
        }

        .message span {
          margin-top: 2px;
        }

        .message.error {
          border: 1px solid #fecaca;
          background: #fff6f6;
          color: #9f1d1d;
        }

        .message.notice {
          border: 1px solid #b9ead0;
          background: #f0fbf5;
          color: #086940;
        }

        .field-group {
          display: grid;
          gap: 8px;
        }

        .field-group label {
          color: #17283c;
          font-size: 14px;
          font-weight: 800;
        }

        .field-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .field-label-row span {
          color: #8491a0;
          font-size: 11px;
        }

        .input-shell {
          position: relative;
          display: flex;
          align-items: center;
          min-height: 58px;
          border: 1px solid #ccd7de;
          border-radius: 9px;
          background: #fff;
          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease;
        }

        .input-shell:focus-within {
          border-color: #098a53;
          box-shadow: 0 0 0 3px rgba(9, 138, 83, 0.1);
        }

        .input-icon {
          position: absolute;
          left: 17px;
          display: grid;
          place-items: center;
          color: #5d7183;
          pointer-events: none;
        }

        .input-icon svg {
          width: 21px;
          height: 21px;
        }

        .input-shell input {
          width: 100%;
          height: 56px;
          border: 0;
          outline: 0;
          background: transparent;
          padding: 0 16px 0 53px;
          color: #17283c;
          font-size: 15px;
        }

        .input-shell input::placeholder {
          color: #98a6b3;
        }

        .input-shell input:disabled {
          cursor: not-allowed;
          opacity: 0.66;
        }

        .password-shell input {
          padding-right: 58px;
        }

        .password-toggle {
          position: absolute;
          right: 8px;
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 9px;
          background: transparent;
          color: #587082;
          cursor: pointer;
        }

        .password-toggle:hover:not(:disabled) {
          background: #eef7f2;
          color: #087d4b;
        }

        .password-toggle svg {
          width: 22px;
          height: 22px;
        }

        .submit-button {
          min-height: 58px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          margin-top: 1px;
          border: 0;
          border-radius: 9px;
          background: linear-gradient(135deg, #079653, #087c47);
          color: #fff;
          box-shadow: 0 10px 24px rgba(8, 124, 71, 0.18);
          font-size: 16px;
          font-weight: 850;
          cursor: pointer;
          transition:
            transform 0.15s ease,
            box-shadow 0.15s ease;
        }

        .submit-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 30px rgba(8, 124, 71, 0.23);
        }

        .submit-button:disabled {
          cursor: not-allowed;
          opacity: 0.72;
          box-shadow: none;
        }

        .submit-button svg {
          width: 21px;
          height: 21px;
        }

        .security-card {
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr);
          gap: 14px;
          align-items: start;
          margin-top: 23px;
          padding: 17px 18px;
          border: 1px solid #cde6d9;
          border-radius: 11px;
          background: linear-gradient(135deg, #effaf5, #f7fbf9);
        }

        .security-icon {
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          color: #08a55f;
        }

        .security-icon svg {
          width: 39px;
          height: 39px;
          fill: currentColor;
        }

        .security-card strong {
          display: block;
          color: #17283c;
          font-size: 13px;
        }

        .security-card p {
          margin: 4px 0 0;
          color: #607188;
          font-size: 12px;
          line-height: 1.48;
        }

        .support-row {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr);
          gap: 13px;
          align-items: center;
          margin-top: 22px;
          padding-top: 19px;
          border-top: 1px solid #d8e1e6;
        }

        .support-icon {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          color: #087d4b;
        }

        .support-icon svg {
          width: 31px;
          height: 31px;
        }

        .support-row strong,
        .support-row span {
          display: block;
        }

        .support-row strong {
          color: #26384c;
          font-size: 12px;
        }

        .support-row span {
          margin-top: 2px;
          color: #64748b;
          font-size: 12px;
        }

        .page-footer {
          display: grid;
          justify-items: center;
          gap: 4px;
          color: #66758a;
          text-align: center;
          font-size: 11px;
          line-height: 1.35;
        }

        .page-footer small {
          font-size: 10px;
        }

        @media (max-width: 1180px) {
          .login-page {
            grid-template-columns: 54% 46%;
          }

          .access-panel {
            padding-left: 28px;
            padding-right: 28px;
          }

          .login-card {
            padding-left: 32px;
            padding-right: 32px;
          }
        }

        @media (max-width: 920px) {
          .login-page {
            grid-template-columns: 1fr;
            overflow: auto;
          }

          .visual-panel {
            display: none;
          }

          .access-panel {
            min-height: 100dvh;
            align-items: flex-start;
            padding: 28px 20px 32px;
          }

          .mobile-brand {
            display: flex;
            align-items: center;
            gap: 13px;
            margin-bottom: 18px;
          }

          .mobile-brand img {
            width: 62px;
            height: 62px;
            border-radius: 50%;
            object-fit: contain;
            background: #fff;
          }

          .mobile-brand strong,
          .mobile-brand span,
          .mobile-brand small {
            display: block;
          }

          .mobile-brand strong {
            color: #0b5d3c;
            font-size: 21px;
          }

          .mobile-brand span {
            margin-top: 1px;
            color: #27473a;
            font-size: 13px;
            font-weight: 700;
          }

          .mobile-brand small {
            margin-top: 2px;
            color: #6b7c73;
            font-size: 11px;
          }
        }

        @media (max-width: 560px) {
          .access-panel {
            padding: 20px 14px 26px;
          }

          .login-card {
            padding: 27px 20px;
            border-radius: 15px;
          }

          .login-heading h1 {
            margin-top: 19px;
            font-size: 31px;
          }

          .login-heading p {
            font-size: 13px;
          }

          .input-shell {
            min-height: 54px;
          }

          .input-shell input {
            height: 52px;
            font-size: 14px;
          }

          .submit-button {
            min-height: 54px;
            font-size: 14px;
          }

          .security-card {
            grid-template-columns: 40px 1fr;
            padding: 14px;
          }

          .security-icon {
            width: 40px;
            height: 40px;
          }

          .security-icon svg {
            width: 34px;
            height: 34px;
          }
        }
      `}</style>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  3D-STYLE METROWASTE TRUCK LOADING SCREEN                                  */
/* -------------------------------------------------------------------------- */

function LoginLoading({
  message,
  detail,
}: {
  message: string;
  detail: string;
}) {
  return (
    <main
      className="loading-page"
      aria-label="Loading MetroWaste administration"
    >
      <div className="loading-glow loading-glow-a" aria-hidden="true" />
      <div className="loading-glow loading-glow-b" aria-hidden="true" />

      <section className="loading-shell">
        <header className="loading-brand">
          <img src="/metrowaste-logo.jpg" alt="MetroWaste logo" />
          <div>
            <strong>MetroWaste Administration</strong>
            <span>Solid Waste Management Corp.</span>
          </div>
        </header>

        <div className="truck-scene" aria-hidden="true">
          <div className="scene-sky">
            <span className="scene-cloud cloud-a" />
            <span className="scene-cloud cloud-b" />
          </div>

          <div className="scene-horizon">
            <span className="hill hill-one" />
            <span className="hill hill-two" />
            <span className="city city-a" />
            <span className="city city-b" />
            <span className="city city-c" />
          </div>

          <div className="road-perspective">
            <div className="road-surface">
              <div className="road-center-lines">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          <div className="truck-shadow" />

          <div className="truck-driver">
            <div className="truck-3d">
              <div className="truck-box">
                <div className="truck-box-side">
                  <img src="/metrowaste-logo.jpg" alt="" />
                  <span>METROWASTE</span>
                </div>

                <div className="truck-box-top" />
                <div className="truck-box-back" />
              </div>

              <div className="truck-cab">
                <div className="cab-side">
                  <div className="cab-window" />
                  <div className="cab-door-line" />
                  <div className="cab-handle" />
                </div>

                <div className="cab-front">
                  <div className="windshield" />
                  <span className="headlight headlight-top" />
                  <span className="headlight headlight-bottom" />
                </div>

                <div className="cab-roof" />
              </div>

              <div className="truck-chassis" />

              <div className="wheel wheel-back">
                <div className="wheel-rim" />
              </div>

              <div className="wheel wheel-middle">
                <div className="wheel-rim" />
              </div>

              <div className="wheel wheel-front">
                <div className="wheel-rim" />
              </div>
            </div>
          </div>
        </div>

        <div className="loading-copy">
          <h1>{message}</h1>
          <p>{detail}</p>
        </div>

        <div className="loading-progress" aria-hidden="true">
          <span />
        </div>

        <div className="loading-status">
          <span className="status-dot" />
          <span>MetroWaste secure system</span>
        </div>
      </section>

      <style jsx global>{`
        .loading-page {
          min-height: 100dvh;
          position: relative;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: 24px;
          background:
            radial-gradient(
              circle at 18% 16%,
              rgba(16, 185, 129, 0.15),
              transparent 31%
            ),
            radial-gradient(
              circle at 88% 85%,
              rgba(5, 116, 77, 0.1),
              transparent 34%
            ),
            linear-gradient(180deg, #f6fbf8 0%, #edf6f1 100%);
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
          color: #102238;
        }

        .loading-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(20px);
          pointer-events: none;
          opacity: 0.5;
        }

        .loading-glow-a {
          width: 360px;
          height: 360px;
          left: -130px;
          top: -110px;
          background: rgba(14, 165, 105, 0.12);
        }

        .loading-glow-b {
          width: 320px;
          height: 320px;
          right: -90px;
          bottom: -120px;
          background: rgba(5, 111, 74, 0.1);
        }

        .loading-shell {
          width: min(100%, 760px);
          position: relative;
          z-index: 2;
          display: grid;
          justify-items: center;
          padding: 28px 32px 30px;
          border: 1px solid rgba(210, 227, 218, 0.92);
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.84);
          box-shadow:
            0 30px 80px rgba(19, 57, 39, 0.11),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(12px);
        }

        .loading-brand {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }

        .loading-brand img {
          width: 54px;
          height: 54px;
          flex: 0 0 54px;
          border-radius: 50%;
          object-fit: contain;
          background: #fff;
          box-shadow: 0 8px 18px rgba(17, 52, 34, 0.11);
        }

        .loading-brand div {
          min-width: 0;
        }

        .loading-brand strong,
        .loading-brand span {
          display: block;
        }

        .loading-brand strong {
          color: #123626;
          font-size: 18px;
          line-height: 1.2;
          font-weight: 900;
        }

        .loading-brand span {
          margin-top: 2px;
          color: #6b7d73;
          font-size: 11px;
          line-height: 1.3;
        }

        .truck-scene {
          position: relative;
          width: min(100%, 680px);
          height: 280px;
          margin-top: 18px;
          overflow: hidden;
          perspective: 1000px;
          perspective-origin: 50% 35%;
          border-radius: 22px;
          background:
            linear-gradient(
              180deg,
              #eaf8f1 0%,
              #f6fbf8 45%,
              #d8eadf 46%,
              #c6ddd0 100%
            );
          box-shadow:
            inset 0 0 0 1px rgba(127, 165, 145, 0.18),
            0 12px 30px rgba(18, 58, 38, 0.05);
        }

        .scene-sky,
        .scene-horizon,
        .road-perspective {
          position: absolute;
          inset: 0;
        }

        .scene-cloud {
          position: absolute;
          height: 18px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.72);
          filter: blur(0.4px);
        }

        .cloud-a {
          width: 84px;
          top: 38px;
          left: 13%;
          animation: cloudFloatA 10s ease-in-out infinite alternate;
        }

        .cloud-b {
          width: 112px;
          top: 59px;
          right: 11%;
          opacity: 0.55;
          animation: cloudFloatB 13s ease-in-out infinite alternate;
        }

        .scene-horizon {
          top: auto;
          height: 120px;
          bottom: 66px;
        }

        .hill {
          position: absolute;
          bottom: 0;
          border-radius: 50% 50% 0 0;
          background: linear-gradient(
            180deg,
            rgba(33, 121, 77, 0.37),
            rgba(25, 91, 62, 0.56)
          );
        }

        .hill-one {
          width: 420px;
          height: 98px;
          left: -70px;
          transform: skewX(-9deg);
        }

        .hill-two {
          width: 470px;
          height: 82px;
          right: -86px;
          opacity: 0.77;
          transform: skewX(10deg);
        }

        .city {
          position: absolute;
          bottom: 6px;
          width: 25px;
          border-radius: 3px 3px 0 0;
          background: rgba(61, 105, 82, 0.47);
          box-shadow:
            35px 5px 0 rgba(60, 105, 82, 0.36),
            67px -8px 0 rgba(60, 105, 82, 0.43),
            96px 0 0 rgba(60, 105, 82, 0.33),
            133px -13px 0 rgba(60, 105, 82, 0.4);
        }

        .city-a {
          height: 38px;
          left: 16%;
        }

        .city-b {
          height: 51px;
          left: 48%;
          transform: scale(0.75);
          opacity: 0.62;
        }

        .city-c {
          height: 42px;
          right: 19%;
          transform: scale(0.82);
          opacity: 0.7;
        }

        .road-perspective {
          top: auto;
          bottom: -28px;
          height: 145px;
          transform: rotateX(62deg);
          transform-origin: bottom center;
        }

        .road-surface {
          position: absolute;
          inset: 0 7%;
          overflow: hidden;
          background:
            linear-gradient(
              90deg,
              rgba(235, 239, 236, 0.8) 0 5%,
              #617069 5% 95%,
              rgba(235, 239, 236, 0.8) 95% 100%
            );
          box-shadow:
            inset 14px 0 0 rgba(255, 255, 255, 0.07),
            inset -14px 0 0 rgba(255, 255, 255, 0.07);
        }

        .road-center-lines {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 18px;
          transform: translateX(-50%);
          overflow: hidden;
        }

        .road-center-lines span {
          position: absolute;
          left: 3px;
          width: 12px;
          height: 38px;
          border-radius: 3px;
          background: rgba(255, 244, 180, 0.86);
          animation: roadDashMove 1.15s linear infinite;
        }

        .road-center-lines span:nth-child(1) {
          top: -54px;
        }

        .road-center-lines span:nth-child(2) {
          top: -4px;
        }

        .road-center-lines span:nth-child(3) {
          top: 46px;
        }

        .road-center-lines span:nth-child(4) {
          top: 96px;
        }

        .road-center-lines span:nth-child(5) {
          top: 146px;
        }

        .road-center-lines span:nth-child(6) {
          top: 196px;
        }

        .truck-shadow {
          position: absolute;
          z-index: 4;
          width: 250px;
          height: 28px;
          left: 50%;
          bottom: 46px;
          border-radius: 50%;
          background: rgba(15, 40, 27, 0.25);
          filter: blur(9px);
          transform: translateX(-50%) scaleX(1.05);
          animation: shadowPulse 0.66s ease-in-out infinite alternate;
        }

        .truck-driver {
          position: absolute;
          z-index: 5;
          width: 300px;
          height: 155px;
          left: 50%;
          bottom: 49px;
          transform: translateX(-50%);
          transform-style: preserve-3d;
          animation:
            truckBob 0.64s ease-in-out infinite alternate,
            truckDrift 4.5s ease-in-out infinite alternate;
        }

        .truck-3d {
          position: relative;
          width: 300px;
          height: 145px;
          transform-style: preserve-3d;
          transform: rotateX(-4deg) rotateY(-9deg);
        }

        .truck-box {
          position: absolute;
          left: 24px;
          top: 23px;
          width: 184px;
          height: 76px;
          transform-style: preserve-3d;
        }

        .truck-box-side {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          overflow: hidden;
          border: 2px solid #e7eee9;
          border-radius: 8px 4px 5px 8px;
          background:
            linear-gradient(
              105deg,
              #f8fbf9 0%,
              #e6ece8 50%,
              #d9e1dc 100%
            );
          box-shadow:
            inset 0 -12px 20px rgba(25, 80, 53, 0.08),
            0 7px 12px rgba(18, 54, 37, 0.13);
          transform: translateZ(24px);
        }

        .truck-box-side::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 6px;
          height: 12px;
          background:
            linear-gradient(
              90deg,
              #0c8a51 0 26%,
              #6fb935 26% 33%,
              #0c8a51 33% 59%,
              #f0c42a 59% 66%,
              #0c8a51 66% 100%
            );
          opacity: 0.95;
        }

        .truck-box-side img {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          object-fit: contain;
          background: #fff;
          flex: 0 0 auto;
        }

        .truck-box-side span {
          position: relative;
          z-index: 2;
          color: #087347;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: 0.03em;
        }

        .truck-box-top {
          position: absolute;
          left: 8px;
          right: 2px;
          top: -21px;
          height: 28px;
          border-radius: 7px 7px 2px 2px;
          background:
            repeating-linear-gradient(
              90deg,
              #cfd8d2 0 14px,
              #aebbb3 14px 18px
            );
          transform:
            rotateX(74deg)
            translateZ(38px)
            translateY(-4px);
          transform-origin: bottom center;
          box-shadow: inset 0 0 0 1px #bbc6bf;
        }

        .truck-box-back {
          position: absolute;
          left: -15px;
          top: 8px;
          width: 26px;
          height: 64px;
          border-radius: 5px 0 0 5px;
          background: linear-gradient(180deg, #198e58, #07673e);
          transform:
            rotateY(77deg)
            translateZ(13px);
          transform-origin: right center;
        }

        .truck-cab {
          position: absolute;
          left: 204px;
          top: 49px;
          width: 70px;
          height: 58px;
          transform-style: preserve-3d;
        }

        .cab-side {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 7px 10px 6px 4px;
          background: linear-gradient(
            150deg,
            #f7faf8 0%,
            #e6ebe8 58%,
            #d0d9d3 100%
          );
          border: 1px solid #c4cec8;
          transform: translateZ(23px);
          box-shadow: 0 7px 12px rgba(20, 56, 38, 0.12);
        }

        .cab-window {
          position: absolute;
          right: 9px;
          top: 8px;
          width: 31px;
          height: 21px;
          border-radius: 4px 6px 3px 3px;
          background:
            linear-gradient(
              145deg,
              rgba(177, 226, 233, 0.92),
              rgba(87, 134, 145, 0.93)
            );
          box-shadow: inset 0 0 0 2px rgba(46, 72, 75, 0.18);
        }

        .cab-door-line {
          position: absolute;
          right: 5px;
          top: 34px;
          width: 39px;
          height: 1px;
          background: rgba(75, 92, 84, 0.38);
        }

        .cab-handle {
          position: absolute;
          right: 11px;
          top: 39px;
          width: 9px;
          height: 2px;
          border-radius: 999px;
          background: #6f7c75;
        }

        .cab-front {
          position: absolute;
          right: -17px;
          top: 6px;
          width: 27px;
          height: 50px;
          border-radius: 0 8px 6px 0;
          background: linear-gradient(180deg, #e9efeb, #cbd4cf);
          transform: rotateY(-73deg) translateZ(9px);
          transform-origin: left center;
        }

        .windshield {
          position: absolute;
          left: 5px;
          top: 5px;
          width: 17px;
          height: 21px;
          border-radius: 3px;
          background: linear-gradient(145deg, #b6dce3, #628a95);
        }

        .headlight {
          position: absolute;
          right: 2px;
          width: 7px;
          height: 5px;
          border-radius: 50%;
          background: #fff4a7;
          box-shadow:
            0 0 8px rgba(255, 242, 148, 0.84),
            0 0 16px rgba(255, 235, 114, 0.3);
        }

        .headlight-top {
          top: 32px;
        }

        .headlight-bottom {
          top: 42px;
        }

        .cab-roof {
          position: absolute;
          left: 2px;
          right: 4px;
          top: -14px;
          height: 21px;
          border-radius: 7px 8px 2px 2px;
          background: #edf2ef;
          border: 1px solid #c8d2cc;
          transform:
            rotateX(73deg)
            translateZ(28px);
          transform-origin: bottom center;
        }

        .truck-chassis {
          position: absolute;
          left: 22px;
          top: 99px;
          width: 257px;
          height: 12px;
          border-radius: 6px;
          background: linear-gradient(180deg, #273730, #15241e);
          transform: translateZ(14px);
          box-shadow: 0 6px 8px rgba(15, 40, 27, 0.23);
        }

        .wheel {
          position: absolute;
          top: 91px;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 8px solid #19231f;
          background:
            radial-gradient(
              circle at center,
              #aeb9b3 0 28%,
              #5f7067 29% 45%,
              #27332d 46% 100%
            );
          box-shadow:
            inset 0 0 0 2px #0d1512,
            0 6px 8px rgba(13, 28, 20, 0.23);
          transform: translateZ(29px);
          animation: wheelSpin 0.72s linear infinite;
        }

        .wheel::before,
        .wheel::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          width: 4px;
          height: 23px;
          border-radius: 3px;
          background: rgba(235, 239, 236, 0.72);
          transform: translate(-50%, -50%);
        }

        .wheel::after {
          transform: translate(-50%, -50%) rotate(90deg);
        }

        .wheel-back {
          left: 52px;
        }

        .wheel-middle {
          left: 163px;
        }

        .wheel-front {
          left: 232px;
        }

        .wheel-rim {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #edf2ef;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 2px #77877e;
        }

        .loading-copy {
          margin-top: 7px;
          text-align: center;
        }

        .loading-copy h1 {
          margin: 0;
          color: #102238;
          font-size: clamp(24px, 3vw, 31px);
          line-height: 1.15;
          letter-spacing: -0.035em;
          font-weight: 900;
        }

        .loading-copy p {
          max-width: 530px;
          margin: 8px auto 0;
          color: #63758a;
          font-size: 13px;
          line-height: 1.5;
        }

        .loading-progress {
          width: min(100%, 280px);
          height: 7px;
          margin-top: 20px;
          overflow: hidden;
          border-radius: 999px;
          background: #d9e7df;
        }

        .loading-progress span {
          display: block;
          width: 38%;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #10a766, #087d4b);
          box-shadow: 0 0 10px rgba(16, 167, 102, 0.28);
          animation: loaderSweep 1.35s ease-in-out infinite;
        }

        .loading-status {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin-top: 14px;
          color: #466051;
          font-size: 11px;
          font-weight: 750;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10a766;
          box-shadow: 0 0 0 0 rgba(16, 167, 102, 0.4);
          animation: statusPulse 1.45s ease-in-out infinite;
        }

        @keyframes wheelSpin {
          from {
            transform: translateZ(29px) rotate(0deg);
          }

          to {
            transform: translateZ(29px) rotate(360deg);
          }
        }

        @keyframes truckBob {
          from {
            transform: translateX(-50%) translateY(0);
          }

          to {
            transform: translateX(-50%) translateY(-3px);
          }
        }

        @keyframes truckDrift {
          0% {
            margin-left: -26px;
          }

          100% {
            margin-left: 26px;
          }
        }

        @keyframes shadowPulse {
          from {
            opacity: 0.22;
            transform: translateX(-50%) scaleX(0.98);
          }

          to {
            opacity: 0.3;
            transform: translateX(-50%) scaleX(1.08);
          }
        }

        @keyframes roadDashMove {
          from {
            transform: translateY(-52px) scaleY(0.65);
          }

          to {
            transform: translateY(58px) scaleY(1.2);
          }
        }

        @keyframes loaderSweep {
          0% {
            transform: translateX(-125%);
          }

          100% {
            transform: translateX(355%);
          }
        }

        @keyframes statusPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(16, 167, 102, 0.4);
          }

          70% {
            box-shadow: 0 0 0 9px rgba(16, 167, 102, 0);
          }

          100% {
            box-shadow: 0 0 0 0 rgba(16, 167, 102, 0);
          }
        }

        @keyframes cloudFloatA {
          from {
            transform: translateX(-12px);
          }

          to {
            transform: translateX(24px);
          }
        }

        @keyframes cloudFloatB {
          from {
            transform: translateX(15px);
          }

          to {
            transform: translateX(-20px);
          }
        }

        @media (max-width: 680px) {
          .loading-page {
            padding: 15px;
          }

          .loading-shell {
            padding: 21px 14px 24px;
            border-radius: 20px;
          }

          .loading-brand img {
            width: 47px;
            height: 47px;
            flex-basis: 47px;
          }

          .loading-brand strong {
            font-size: 16px;
          }

          .truck-scene {
            height: 230px;
            border-radius: 17px;
          }

          .truck-driver {
            width: 245px;
            transform: translateX(-50%) scale(0.82);
            transform-origin: bottom center;
          }

          .truck-shadow {
            bottom: 42px;
            width: 205px;
          }

          .loading-copy h1 {
            font-size: 24px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .wheel,
          .truck-driver,
          .truck-shadow,
          .road-center-lines span,
          .loading-progress span,
          .status-dot,
          .scene-cloud {
            animation: none !important;
          }
        }
      `}</style>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  ICONS                                                                      */
/* -------------------------------------------------------------------------- */

function Icon({
  children,
  size = 24,
  fill = "none",
}: {
  children: ReactNode;
  size?: number;
  fill?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function LockBadgeIcon() {
  return (
    <Icon size={18}>
      <rect x="6" y="10" width="12" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

function MailIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Icon>
  );
}

function LockIcon() {
  return (
    <Icon>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </Icon>
  );
}

function EyeIcon() {
  return (
    <Icon>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

function EyeOffIcon() {
  return (
    <Icon>
      <path d="m3 3 18 18" />
      <path d="M10.6 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a16.7 16.7 0 0 1-2.4 3.1" />
      <path d="M6.7 6.7C4 8.6 2.5 12 2.5 12S6 18 12 18c1.1 0 2.2-.2 3.2-.5" />
    </Icon>
  );
}

function ArrowIcon() {
  return (
    <Icon>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </Icon>
  );
}

function ShieldIcon() {
  return (
    <Icon fill="currentColor">
      <path
        stroke="none"
        d="M12 2 4 5v6c0 5.2 3.4 9.5 8 11 4.6-1.5 8-5.8 8-11V5l-8-3Zm-1.2 14.5-3.4-3.4 1.4-1.4 2 2 4.4-4.4 1.4 1.4-5.8 5.8Z"
      />
    </Icon>
  );
}

function HeadsetIcon() {
  return (
    <Icon>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v5H5a1 1 0 0 1-1-1v-4Z" />
      <path d="M20 14h-3v5h2a1 1 0 0 0 1-1v-4Z" />
      <path d="M17 19c0 2-2 3-5 3" />
    </Icon>
  );
}

function ErrorIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </Icon>
  );
}

function CheckIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.3 2.3 4.9-5" />
    </Icon>
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
