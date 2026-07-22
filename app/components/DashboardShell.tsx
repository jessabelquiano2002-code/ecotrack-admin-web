"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { onValue, ref, update } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { AuthGate } from "./AuthGate";
import {
  beginSignOutRedirect,
  cancelSignOutRedirect,
  redirectToLogin,
  signOutAdmin,
} from "../../lib/auth";

type AdminProfile = {
  name?: string;
  email?: string;
  role?: string;
  profileImage?: string;
};

type SidebarLink = {
  href: string;
  label: string;
  group: "MAIN" | "MANAGEMENT" | "REPORTS";
  icon: ReactNode;
};


const MetroWasteLogo = () => (
  <svg
    className="metro-logo"
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="metroWasteLogoGradient" x1="10" y1="8" x2="56" y2="58">
        <stop offset="0" stopColor="#22c55e" />
        <stop offset="0.48" stopColor="#0d9488" />
        <stop offset="1" stopColor="#2563eb" />
      </linearGradient>
      <linearGradient id="metroWasteLogoShield" x1="18" y1="12" x2="46" y2="52">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#dffdf0" />
      </linearGradient>
    </defs>

    <rect width="64" height="64" rx="18" fill="url(#metroWasteLogoGradient)" />
    <circle cx="52" cy="12" r="18" fill="rgba(255,255,255,0.14)" />
    <circle cx="13" cy="53" r="17" fill="rgba(6,78,59,0.18)" />

    <path
      d="M32 9.5 47 15.5v12.8c0 10.3-5.9 18.9-15 24.2-9.1-5.3-15-13.9-15-24.2V15.5L32 9.5Z"
      fill="url(#metroWasteLogoShield)"
      opacity="0.96"
    />

    <path
      d="M23.8 27.2h16.4l-1.25 14.6a2.6 2.6 0 0 1-2.6 2.38h-8.7a2.6 2.6 0 0 1-2.6-2.38L23.8 27.2Z"
      fill="#0f766e"
    />
    <path
      d="M22.2 23.4h19.6v4.2H22.2v-4.2Z"
      fill="#064e3b"
    />
    <path
      d="M28 22.9c.7-2.2 2-3.3 4-3.3s3.3 1.1 4 3.3"
      fill="none"
      stroke="#064e3b"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M28.5 31.3v8.1M32 31.3v8.1M35.5 31.3v8.1"
      stroke="#e8fff5"
      strokeWidth="1.8"
      strokeLinecap="round"
    />

    <path
      d="M31.7 16.3c4.8.2 8.4 2.8 9.9 7.3-5.2.7-9.2-.3-12.1-3.2-1.7 2.6-2.2 5.2-1.4 7.8-3.2-4.4-2-9.5 3.6-11.9Z"
      fill="#22c55e"
    />
    <path
      d="M29.6 20.8c3.4.6 6.5 1.7 9.2 3.4"
      stroke="#eafff5"
      strokeWidth="1.7"
      strokeLinecap="round"
      opacity="0.95"
    />
  </svg>
);

const IconDashboard = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
  </svg>
);

const IconMap = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M12 2C8.4 2 5.5 4.9 5.5 8.5c0 4.7 6.5 13.5 6.5 13.5s6.5-8.8 6.5-13.5C18.5 4.9 15.6 2 12 2Zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
  </svg>
);

const IconRoutes = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M7 7a3 3 0 1 1 .1 0H7Zm10 10a3 3 0 1 1-.1 0h.1ZM7 9.5c0 3.8 10 1.2 10 5h-2c0-1.7-10 .8-10-5H7Z" />
  </svg>
);

const IconAnalytics = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M5 20V9h3v11H5Zm5 0V4h3v16h-3Zm5 0v-7h3v7h-3Z" />
  </svg>
);

const IconBell = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M12 22a2.8 2.8 0 0 0 2.7-2h-5.4A2.8 2.8 0 0 0 12 22Zm7-6-1.5-1.8V10a5.5 5.5 0 0 0-4.3-5.4V3a1.2 1.2 0 0 0-2.4 0v1.6A5.5 5.5 0 0 0 6.5 10v4.2L5 16v1h14v-1Z" />
  </svg>
);

const IconUsers = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 1.7-6 3.8V20h12v-2.2C15 15.7 12.3 14 9 14Zm7.5-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2c-.7 0-1.3.1-1.9.2 1.5.9 2.4 2.1 2.4 3.6V20h5v-2.2c0-2.1-2.5-3.8-5.5-3.8Z" />
  </svg>
);

const IconWarning = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M12 2 1.8 20h20.4L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V8h2v5Z" />
  </svg>
);

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm11 8H6v10h12V10ZM6 8h12V6H6v2Z" />
  </svg>
);

const IconBook = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M4 3h6.8c1.1 0 2 .9 2 2v15c-.7-.7-1.5-1-2.5-1H4V3Zm16 0h-6.8v17c.7-.7 1.5-1 2.5-1H20V3Z" />
  </svg>
);

const IconCompliance = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M12 2 20 5v6c0 5.2-3.4 9.7-8 11-4.6-1.3-8-5.8-8-11V5l8-3Zm-1.1 13.7 5.7-5.7-1.4-1.4-4.3 4.3-2.1-2.1-1.4 1.4 3.5 3.5Z" />
  </svg>
);

const links: SidebarLink[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    group: "MAIN",
    icon: <IconDashboard />,
  },
  {
    href: "/live-map",
    label: "Live Map",
    group: "MAIN",
    icon: <IconMap />,
  },
  {
    href: "/routes",
    label: "Routes",
    group: "MAIN",
    icon: <IconRoutes />,
  },
  {
    href: "/drivers",
    label: "Users",
    group: "MANAGEMENT",
    icon: <IconUsers />,
  },
  {
    href: "/schedules",
    label: "Schedules",
    group: "MANAGEMENT",
    icon: <IconCalendar />,
  },
  {
    href: "/content-management",
    label: "Onboarding & Content",
    group: "MANAGEMENT",
    icon: <IconBook />,
  },
  {
    href: "/resident-compliance",
    label: "Resident Compliance",
    group: "MANAGEMENT",
    icon: <IconCompliance />,
  },
  {
    href: "/issues",
    label: "Driver & Resident Issues",
    group: "MANAGEMENT",
    icon: <IconWarning />,
  },
  {
    href: "/analytics",
    label: "Analytics",
    group: "REPORTS",
    icon: <IconAnalytics />,
  },
  {
    href: "/notifications",
    label: "Notifications",
    group: "REPORTS",
    icon: <IconBell />,
  },
];

const groups: SidebarLink["group"][] = ["MAIN", "MANAGEMENT", "REPORTS"];

export function DashboardShell({
  title,
  description,
  children,
  hidePageHeader = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  hidePageHeader?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [notifCount, setNotifCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const [adminProfile, setAdminProfile] = useState<AdminProfile>({
    name: "Admin User",
    email: "admin@wastetrack.gov.ph",
    role: "System Admin",
    profileImage: "",
  });

  const menuRef = useRef<HTMLDivElement | null>(null);
  const logoutCancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "notifications"), (snap) => {
      const val = snap.val() || {};
      setNotifCount(Object.keys(val).length);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!logoutDialogOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    logoutCancelButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoggingOut) setLogoutDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isLoggingOut, logoutDialogOpen]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!user) return;

      const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
      if (!localHosts.has(window.location.hostname)) {
        update(ref(db, "system_config"), {
          adminApiBaseUrl: window.location.origin,
          adminApiBaseUrlUpdatedAt: Date.now(),
        }).catch((error) => console.warn("Unable to publish the driver API origin.", error));
      }

      const profileRef = ref(db, `adminProfile/${user.uid}`);

      unsubProfile = onValue(profileRef, (snap) => {
        const data = snap.val() || {};

        setAdminProfile({
          name: data.name || "Admin User",
          email: data.email || user.email || "admin@wastetrack.gov.ph",
          role: data.role || "System Admin",
          profileImage: data.profileImage || "",
        });
      });
    });

    return () => {
      if (unsubProfile) unsubProfile();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const openLogoutDialog = () => {
    setMenuOpen(false);
    setLogoutError("");
    setLogoutDialogOpen(true);
  };

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError("");
    beginSignOutRedirect();

    try {
      await signOutAdmin();
      redirectToLogin({ reason: "signed-out" });
    } catch {
      cancelSignOutRedirect();
      setLogoutError("WasteTrack could not close the session. Check your connection and try again.");
      setIsLoggingOut(false);
    }
  };

  const handleSearch = () => {
    const query = searchValue.trim();

    if (!query) return;

    router.push(`/drivers?search=${encodeURIComponent(query)}`);
  };

  const avatar = adminProfile.profileImage ? (
    <img src={adminProfile.profileImage} alt="Admin" className="admin-avatar-img" />
  ) : (
    <span>{adminProfile.name?.charAt(0).toUpperCase() || "A"}</span>
  );

  return (
    <AuthGate>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand-wrap">
            <div className="brand-mark" aria-label="Metro Waste logo">
              <MetroWasteLogo />
            </div>

            <div>
              <div className="admin-brand">Waste Management</div>
              <div className="admin-brand-sub">Barangay Waste Collection</div>
            </div>
          </div>

          <nav className="admin-nav">
            {groups.map((group) => (
              <div className="admin-nav-group" key={group}>
                <div className="admin-nav-group-title">{group}</div>

                {links
                  .filter((link) => link.group === group)
                  .map((link) => {
                    const active =
                      pathname === link.href ||
                      pathname.startsWith(`${link.href}/`);

                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`admin-nav-link ${active ? "active" : ""}`}
                      >
                        <span className="admin-nav-icon">{link.icon}</span>
                        <span className="admin-nav-label">{link.label}</span>

                        {link.href === "/notifications" && notifCount > 0 && (
                          <span className="admin-badge">
                            {notifCount > 99 ? "99+" : notifCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>

          <div className="admin-sidebar-footer">
            <button
              type="button"
              className="admin-user-card"
              onClick={() => router.push("/profile")}
            >
              <span className="admin-user-avatar">{avatar}</span>

              <span className="admin-user-info">
                <span className="admin-user-name">
                  {adminProfile.name || "Admin User"}
                </span>
                <span className="admin-user-email">
                  {adminProfile.email || "admin@wastetrack.gov.ph"}
                </span>
              </span>

              <span className="admin-user-arrow">›</span>
            </button>
          </div>
        </aside>

        <section className="admin-main">
          <header className="admin-topbar">
            <div className="admin-search-wrap">
              <span className="admin-search-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M10.5 4a6.5 6.5 0 0 1 5.1 10.5l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                </svg>
              </span>

              <input
                className="admin-search"
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                placeholder="Search trucks, routes, drivers..."
              />

              {searchValue ? (
                <button
                  type="button"
                  className="admin-search-clear"
                  onClick={() => setSearchValue("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : (
                <span className="admin-search-shortcut">Ctrl + K</span>
              )}
            </div>

            <div className="admin-topbar-actions">
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => router.push("/notifications")}
                aria-label="Notifications"
              >
                <IconBell />

                {notifCount > 0 && (
                  <span className="admin-notif-dot">
                    {notifCount > 99 ? "99+" : notifCount}
                  </span>
                )}
              </button>

              <div className="admin-profile-area" ref={menuRef}>
                <button
                  type="button"
                  className="admin-profile-mini"
                  onClick={() => setMenuOpen((prev) => !prev)}
                >
                  <span className="admin-profile-avatar">{avatar}</span>

                  <span className="admin-profile-text">
                    <span className="admin-profile-name">
                      {adminProfile.name || "Admin User"}
                    </span>
                    <span className="admin-profile-role">
                      {adminProfile.role || "System Admin"}
                    </span>
                  </span>

                  <span className={`admin-chevron ${menuOpen ? "open" : ""}`}>
                    ▾
                  </span>
                </button>

                {menuOpen && (
                  <div className="admin-dropdown">
                    <div className="admin-dropdown-head">
                      <div className="admin-dropdown-avatar">{avatar}</div>

                      <div>
                        <div className="admin-dropdown-name">
                          {adminProfile.name || "Admin User"}
                        </div>
                        <div className="admin-dropdown-email">
                          {adminProfile.email || "admin@wastetrack.gov.ph"}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="admin-dropdown-item"
                      onClick={() => router.push("/profile")}
                    >
                      <span>👤</span>
                      Profile
                    </button>

                    <button
                      type="button"
                      className="admin-dropdown-item"
                      onClick={() => router.push("/settings")}
                    >
                      <span>⚙️</span>
                      Settings
                    </button>

                    <div className="admin-dropdown-divider" />

                    <button
                      type="button"
                      className="admin-dropdown-item danger"
                      onClick={openLogoutDialog}
                    >
                      <span>🚪</span>
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="admin-content">
            {!hidePageHeader && (
              <section className="admin-page-head">
                <div>
                  <h1>{title}</h1>
                  {description && <p>{description}</p>}
                </div>

                <div className="admin-update-status">
                  <span>Last updated: Just now</span>
                  <span className="admin-live-dot" />
                </div>
              </section>
            )}

            {children}
          </main>
        </section>
      </div>

      {logoutDialogOpen && (
        <div
          className="logout-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isLoggingOut) setLogoutDialogOpen(false);
          }}
        >
          <section
            className="logout-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-description"
          >
            <div className="logout-dialog-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M10 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H10v-2H6V6h4V4Zm4.6 3.2-1.4 1.4 2.4 2.4H9v2h6.6l-2.4 2.4 1.4 1.4 4.8-4.8-4.8-4.8Z" />
              </svg>
            </div>

            <div className="logout-dialog-copy">
              <span>Secure administrator session</span>
              <h2 id="logout-title">Sign out of WasteTrack?</h2>
              <p id="logout-description">
                You will be returned to the secure login page and protected administration pages will no longer be accessible.
              </p>
            </div>

            {logoutError && <div className="logout-dialog-error" role="alert">{logoutError}</div>}

            <div className="logout-dialog-actions">
              <button
                ref={logoutCancelButtonRef}
                type="button"
                className="logout-cancel"
                onClick={() => setLogoutDialogOpen(false)}
                disabled={isLoggingOut}
              >
                Stay signed in
              </button>
              <button
                type="button"
                className="logout-confirm"
                onClick={logout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? <span className="logout-spinner" aria-hidden="true" /> : null}
                {isLoggingOut ? "Signing out…" : "Yes, sign out"}
              </button>
            </div>

            <div className="logout-dialog-note">
              <span aria-hidden="true">✓</span>
              Your Firebase session is closed before redirection.
            </div>
          </section>
        </div>
      )}

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          min-height: 100%;
          background: #f6f8fb;
          color: #0f172a;
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Arial,
            sans-serif;
        }

        button,
        input {
          font-family: inherit;
        }

        .admin-shell {
          min-height: 100vh;
          display: flex;
          background:
            radial-gradient(circle at top right, rgba(15, 23, 42, 0.04), transparent 34%),
            #f6f8fb;
        }

        .admin-sidebar {
          width: 280px;
          min-width: 280px;
          height: 100vh;
          position: sticky;
          top: 0;
          left: 0;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #071426 0%, #0a1628 54%, #071120 100%);
          color: #ffffff;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          z-index: 50;
        }

        .admin-brand-wrap {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 28px 24px 26px;
        }

        .brand-mark {
          width: 52px;
          height: 52px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(37, 99, 235, 0.16));
          box-shadow:
            0 18px 38px rgba(16, 185, 129, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
          flex-shrink: 0;
          overflow: hidden;
        }

        .metro-logo {
          width: 52px;
          height: 52px;
          display: block;
          filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.14));
        }

        .admin-brand {
          font-size: 23px;
          line-height: 1.05;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.04em;
        }

        .admin-brand-sub {
          margin-top: 6px;
          font-size: 13px;
          font-weight: 500;
          color: #94a3b8;
        }

        .admin-nav {
          flex: 1;
          padding: 10px 18px 20px;
          overflow-y: auto;
        }

        .admin-nav-group {
          padding: 16px 0 22px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        }

        .admin-nav-group:last-child {
          border-bottom: 0;
        }

        .admin-nav-group-title {
          margin: 0 10px 12px;
          color: #94a3b8;
          font-size: 13px;
          font-weight: 850;
          letter-spacing: 0.04em;
        }

        .admin-nav-link {
          position: relative;
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 54px;
          padding: 0 16px;
          margin-bottom: 8px;
          border-radius: 14px;
          color: #dbe4f0;
          text-decoration: none;
          font-size: 15px;
          font-weight: 760;
          transition:
            background 0.18s ease,
            color 0.18s ease,
            transform 0.18s ease,
            box-shadow 0.18s ease;
        }

        .admin-nav-link:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
          transform: translateX(2px);
        }

        .admin-nav-link.active {
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #ffffff;
          box-shadow: 0 18px 40px rgba(21, 128, 61, 0.34);
        }

        .admin-nav-icon {
          width: 25px;
          height: 25px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .admin-svg-icon {
          width: 21px;
          height: 21px;
          fill: currentColor;
        }

        .admin-nav-label {
          flex: 1;
          line-height: 1.2;
        }

        .admin-badge {
          min-width: 27px;
          height: 24px;
          padding: 0 8px;
          border-radius: 999px;
          background: #ef4444;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 8px 18px rgba(239, 68, 68, 0.25);
        }

        .admin-sidebar-footer {
          padding: 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.09);
        }

        .admin-user-card {
          width: 100%;
          min-height: 76px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border: 0;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.07);
          color: #ffffff;
          cursor: pointer;
          text-align: left;
          transition:
            background 0.18s ease,
            transform 0.18s ease;
        }

        .admin-user-card:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-1px);
        }

        .admin-user-avatar,
        .admin-profile-avatar,
        .admin-dropdown-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: linear-gradient(135deg, #16a34a, #2563eb);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 900;
          flex-shrink: 0;
          overflow: hidden;
        }

        .admin-user-avatar {
          border: 3px solid rgba(255, 255, 255, 0.72);
        }

        .admin-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
          display: block;
        }

        .admin-user-info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .admin-user-name {
          font-size: 14px;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.2;
        }

        .admin-user-email {
          margin-top: 4px;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 500;
          color: #b8c4d6;
        }

        .admin-user-arrow {
          color: #cbd5e1;
          font-size: 24px;
          line-height: 1;
        }

        .admin-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .admin-topbar {
          height: 82px;
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 0 30px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid #e5eaf1;
        }

        .admin-search-wrap {
          width: min(560px, 100%);
          height: 48px;
          position: relative;
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1px solid #dfe7f1;
          border-radius: 15px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.035);
          transition:
            border 0.18s ease,
            box-shadow 0.18s ease;
        }

        .admin-search-wrap:focus-within {
          border-color: #16a34a;
          box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.11);
        }

        .admin-search-icon {
          width: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #8a99ad;
          flex-shrink: 0;
        }

        .admin-search-icon svg {
          width: 20px;
          height: 20px;
          fill: currentColor;
        }

        .admin-search {
          width: 100%;
          height: 100%;
          border: 0;
          outline: none;
          background: transparent;
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
          padding-right: 76px;
        }

        .admin-search::placeholder {
          color: #8a99ad;
        }

        .admin-search-shortcut {
          position: absolute;
          right: 12px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 4px 8px;
          background: #f8fafc;
        }

        .admin-search-clear {
          position: absolute;
          right: 12px;
          width: 25px;
          height: 25px;
          border: 0;
          border-radius: 50%;
          background: #e5e7eb;
          color: #334155;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }

        .admin-topbar-actions {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .admin-icon-btn {
          position: relative;
          width: 46px;
          height: 46px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #ffffff;
          color: #0f172a;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease;
        }

        .admin-icon-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 32px rgba(15, 23, 42, 0.08);
        }

        .admin-icon-btn .admin-svg-icon {
          width: 22px;
          height: 22px;
        }

        .admin-notif-dot {
          position: absolute;
          top: -8px;
          right: -8px;
          min-width: 23px;
          height: 23px;
          padding: 0 7px;
          border-radius: 999px;
          background: #ef4444;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 900;
          border: 3px solid #ffffff;
        }

        .admin-profile-area {
          position: relative;
        }

        .admin-profile-mini {
          height: 52px;
          border: 1px solid transparent;
          border-radius: 18px;
          background: transparent;
          padding: 4px 8px 4px 4px;
          display: flex;
          align-items: center;
          gap: 11px;
          cursor: pointer;
          transition: background 0.18s ease;
        }

        .admin-profile-mini:hover {
          background: #f1f5f9;
          border-color: #e2e8f0;
        }

        .admin-profile-avatar {
          width: 44px;
          height: 44px;
        }

        .admin-profile-text {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          line-height: 1.1;
        }

        .admin-profile-name {
          font-size: 15px;
          font-weight: 900;
          color: #0f172a;
        }

        .admin-profile-role {
          margin-top: 5px;
          font-size: 12px;
          font-weight: 650;
          color: #64748b;
        }

        .admin-chevron {
          font-size: 16px;
          color: #475569;
          transition: transform 0.18s ease;
        }

        .admin-chevron.open {
          transform: rotate(180deg);
        }

        .admin-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          width: 250px;
          border: 1px solid #e5eaf1;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
          padding: 9px;
          z-index: 999;
          animation: dropdownIn 0.16s ease;
        }

        @keyframes dropdownIn {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .admin-dropdown-head {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 11px;
          border-radius: 14px;
          background: #f8fafc;
          margin-bottom: 7px;
        }

        .admin-dropdown-name {
          font-size: 14px;
          font-weight: 900;
          color: #0f172a;
        }

        .admin-dropdown-email {
          margin-top: 3px;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          color: #64748b;
        }

        .admin-dropdown-item {
          width: 100%;
          border: 0;
          background: transparent;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px;
          border-radius: 12px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 800;
          color: #334155;
          text-align: left;
        }

        .admin-dropdown-item:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .admin-dropdown-item.danger {
          color: #dc2626;
        }

        .admin-dropdown-item.danger:hover {
          background: #fef2f2;
        }

        .admin-dropdown-divider {
          height: 1px;
          background: #e5e7eb;
          margin: 7px 0;
        }

        .logout-backdrop {
          position: fixed;
          inset: 0;
          z-index: 3000;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(4, 15, 25, 0.67);
          backdrop-filter: blur(8px);
          animation: logoutFadeIn 160ms ease-out;
        }

        .logout-dialog {
          width: min(100%, 470px);
          padding: 30px;
          border: 1px solid rgba(255, 255, 255, 0.72);
          border-radius: 26px;
          background: #ffffff;
          box-shadow: 0 30px 90px rgba(2, 15, 23, 0.32);
          animation: logoutDialogIn 180ms ease-out;
        }

        .logout-dialog-icon {
          width: 58px;
          height: 58px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: linear-gradient(145deg, #fff1f2, #ffe4e6);
          color: #dc2626;
          box-shadow: inset 0 0 0 1px #fecdd3;
        }

        .logout-dialog-icon svg {
          width: 28px;
          height: 28px;
          fill: currentColor;
        }

        .logout-dialog-copy {
          margin-top: 22px;
        }

        .logout-dialog-copy > span {
          color: #07845f;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .logout-dialog-copy h2 {
          margin: 9px 0 0;
          color: #0f172a;
          font-size: 27px;
          line-height: 1.15;
          letter-spacing: -0.035em;
        }

        .logout-dialog-copy p {
          margin: 12px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.65;
        }

        .logout-dialog-error {
          margin-top: 18px;
          padding: 12px 13px;
          border: 1px solid #fecaca;
          border-radius: 13px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.45;
        }

        .logout-dialog-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 24px;
        }

        .logout-dialog-actions button {
          min-height: 50px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 850;
          transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
        }

        .logout-cancel {
          border: 1px solid #dbe3ec;
          background: #ffffff;
          color: #334155;
        }

        .logout-cancel:hover:not(:disabled) {
          background: #f8fafc;
          transform: translateY(-1px);
        }

        .logout-confirm {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 0;
          background: linear-gradient(135deg, #dc2626, #b91c1c);
          color: #ffffff;
          box-shadow: 0 13px 26px rgba(185, 28, 28, 0.22);
        }

        .logout-confirm:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 16px 30px rgba(185, 28, 28, 0.28);
        }

        .logout-dialog-actions button:focus-visible {
          outline: 3px solid rgba(16, 185, 129, 0.24);
          outline-offset: 3px;
        }

        .logout-dialog-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .logout-spinner {
          width: 17px;
          height: 17px;
          border: 2px solid rgba(255, 255, 255, 0.38);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: logoutSpin 700ms linear infinite;
        }

        .logout-dialog-note {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-top: 17px;
          color: #7a899b;
          font-size: 11px;
          text-align: center;
        }

        .logout-dialog-note span {
          color: #059669;
          font-weight: 900;
        }

        @keyframes logoutFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes logoutDialogIn {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes logoutSpin {
          to { transform: rotate(360deg); }
        }

        .admin-content {
          flex: 1;
          padding: 30px;
        }

        .admin-page-head {
          margin-bottom: 28px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .admin-page-head h1 {
          margin: 0;
          color: #0f172a;
          font-size: 30px;
          line-height: 1.1;
          font-weight: 950;
          letter-spacing: -0.045em;
        }

        .admin-page-head p {
          margin: 9px 0 0;
          color: #53657d;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 550;
        }

        .admin-update-status {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 10px;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }

        .admin-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #16a34a;
          box-shadow: 0 0 0 5px rgba(22, 163, 74, 0.1);
        }

        @media (max-width: 1100px) {
          .admin-sidebar {
            width: 250px;
            min-width: 250px;
          }

          .admin-search-wrap {
            width: min(420px, 100%);
          }
        }

        @media (max-width: 900px) {
          .admin-shell {
            flex-direction: column;
          }

          .admin-sidebar {
            width: 100%;
            min-width: 100%;
            height: auto;
            position: relative;
          }

          .admin-nav {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }

          .admin-nav-group {
            padding: 0;
            border-bottom: 0;
          }

          .admin-sidebar-footer {
            display: none;
          }

          .admin-topbar {
            height: auto;
            align-items: stretch;
            flex-direction: column;
            padding: 16px;
          }

          .admin-search-wrap {
            width: 100%;
          }

          .admin-topbar-actions {
            justify-content: flex-end;
          }

          .admin-content {
            padding: 20px 16px 30px;
          }

          .admin-page-head {
            flex-direction: column;
          }
        }

        @media (max-width: 620px) {
          .admin-nav {
            grid-template-columns: 1fr;
          }

          .admin-profile-text,
          .admin-search-shortcut {
            display: none;
          }

          .admin-search {
            padding-right: 16px;
          }

          .admin-page-head h1 {
            font-size: 25px;
          }

          .logout-dialog {
            padding: 24px;
            border-radius: 22px;
          }

          .logout-dialog-actions {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </AuthGate>
  );
}
