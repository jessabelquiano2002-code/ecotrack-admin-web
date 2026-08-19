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

function normalizeProfileImage(value?: string): string {
  const image = String(value || "").trim();
  if (!image) return "";

  if (
    image.startsWith("data:image/") ||
    image.startsWith("http://") ||
    image.startsWith("https://") ||
    image.startsWith("blob:")
  ) {
    return image;
  }

  // Support older records that contain only the raw Base64 payload.
  if (/^[A-Za-z0-9+/=\s]+$/.test(image) && image.length > 100) {
    return `data:image/jpeg;base64,${image.replace(/\s+/g, "")}`;
  }

  return image;
}

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


const MetroWasteMunicipalSeal = () => (
  <svg
    className="metro-municipal-seal"
    viewBox="0 0 100 100"
    role="img"
    aria-label="Metro Waste Catbalogan emblem"
  >
    <defs>
      <linearGradient id="sealGreen" x1="15" y1="10" x2="82" y2="90">
        <stop offset="0" stopColor="#55e36a" />
        <stop offset="1" stopColor="#0b7a50" />
      </linearGradient>
      <linearGradient id="sealGold" x1="30" y1="20" x2="70" y2="80">
        <stop offset="0" stopColor="#f6d365" />
        <stop offset="1" stopColor="#d9a72e" />
      </linearGradient>
    </defs>

    <circle cx="50" cy="50" r="47" fill="#ffffff" />
    <circle cx="50" cy="50" r="43.5" fill="#f7fbf8" stroke="#173c31" strokeWidth="2" />
    <circle cx="50" cy="50" r="34.5" fill="#ffffff" stroke="url(#sealGreen)" strokeWidth="3" />

    <path
      d="M50 24 68 31v15.5c0 12.6-7.2 23-18 29.4-10.8-6.4-18-16.8-18-29.4V31L50 24Z"
      fill="#ecfff3"
      stroke="#0b7a50"
      strokeWidth="2"
    />
    <path d="M38 42h24l-1.7 20.5a3 3 0 0 1-3 2.8H42.7a3 3 0 0 1-3-2.8L38 42Z" fill="#0b7a50" />
    <path d="M36.5 37.5h27v5.5h-27v-5.5Z" fill="#064e3b" />
    <path d="M44.5 37c.8-3.1 2.7-4.6 5.5-4.6s4.7 1.5 5.5 4.6" fill="none" stroke="#064e3b" strokeWidth="3" strokeLinecap="round" />
    <path d="M44.2 48v11M50 48v11M55.8 48v11" stroke="#effff5" strokeWidth="2.3" strokeLinecap="round" />
    <path d="M51 29c5.9.4 10.1 3.3 11.8 8.2-5.7.9-10.5-.2-14-3.4-1.8 2.8-2.4 5.7-1.8 8.6-3.6-5-2.1-10.6 4-13.4Z" fill="#41d65c" />
    <path d="M48.4 34.1c3.7.6 7.4 1.9 10.7 4" fill="none" stroke="#eaffef" strokeWidth="1.7" strokeLinecap="round" />

    <path d="M23 25A38 38 0 0 1 77 25" fill="none" stroke="url(#sealGold)" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M23 75A38 38 0 0 0 77 75" fill="none" stroke="url(#sealGold)" strokeWidth="2.2" strokeLinecap="round" />

    <text x="50" y="17.5" textAnchor="middle" fontSize="7.2" fontWeight="900" fill="#173c31" letterSpacing="1.7">
      METRO
    </text>
    <text x="50" y="89" textAnchor="middle" fontSize="6.3" fontWeight="900" fill="#173c31" letterSpacing="1.2">
      CATBALOGAN
    </text>
  </svg>
);

const MetroWasteSkyline = () => (
  <svg
    className="metro-brand-skyline"
    viewBox="0 0 360 76"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 64h360" opacity=".35" />
      <path d="M13 64V52h13V42l7-7 7 7v22" />
      <path d="M24 52h18M30 47h6" />
      <path d="M52 64V50h19v14M57 50v-8h9v8" />
      <path d="M81 64V45h22v19M86 45l6-8 6 8" />
      <path d="M112 64V50h13V39h18v25M116 50h27M130 39v-8" />
      <path d="M153 64V43h25v21M158 43l7-9 8 9M165 34v-6" />
      <path d="M189 64V48h17V36h21v28M194 48h33M213 36V25M210 25h6" />
      <path d="M237 64V50h15V41h13v23M242 50h23" />
      <path d="M276 64V44h25v20M281 44l7-10 8 10" />
      <path d="M310 64V52h12v-7h13v19M341 64V49h11v15" />
      <path d="M315 45c1-9 5-14 8-17M323 45c-1-9-5-14-8-17M344 49c1-8 4-12 7-15M351 49c-1-8-4-12-7-15" />
    </g>
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

const IconAgencyReport = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon">
    <path d="M5 2h10l4 4v16H5V2Zm9 2v3h3l-3-3ZM8 10h8v2H8v-2Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z" />
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

const IconMenu = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon" aria-hidden="true">
    <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
  </svg>
);

const IconCollapse = () => (
  <svg viewBox="0 0 24 24" className="admin-svg-icon" aria-hidden="true">
    <path d="m14.7 5.3-1.4-1.4L5.2 12l8.1 8.1 1.4-1.4L8 12l6.7-6.7Zm4 0-1.4-1.4L9.2 12l8.1 8.1 1.4-1.4L12 12l6.7-6.7Z" />
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
    href: "/issues",
    label: "Driver & Resident Issues",
    group: "MANAGEMENT",
    icon: <IconWarning />,
  },
  {
    href: "/activity-requests",
    label: "Driver Activity Requests",
    group: "REPORTS",
    icon: <IconBook />,
  },
  {
    href: "/agency-report",
    label: "Agency Report",
    group: "REPORTS",
    icon: <IconAgencyReport />,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const saved = window.localStorage.getItem("wastetrack.sidebar.collapsed");
    if (saved === "true") setSidebarCollapsed(true);

    const handleResize = () => {
      if (window.innerWidth > 900) setMobileSidebarOpen(false);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("wastetrack.sidebar.collapsed", String(next));
      return next;
    });
  };

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

  const profileImageSrc = normalizeProfileImage(adminProfile.profileImage);

  const avatar = profileImageSrc ? (
    <img
      src={profileImageSrc}
      alt={adminProfile.name ? `${adminProfile.name} profile` : "Admin profile"}
      className="admin-avatar-img"
    />
  ) : (
    <span>{adminProfile.name?.charAt(0).toUpperCase() || "A"}</span>
  );

  return (
    <AuthGate>
      <div className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}>
        <aside className="admin-sidebar" aria-label="Primary administration navigation">
          <div className="admin-brand-wrap">
            <div className="admin-brand-hero" aria-label="Metro Waste Catbalogan">
              <div className="admin-brand-expanded">
                <div className="admin-brand-top">
                  <div className="admin-brand-seal-wrap">
                    {profileImageSrc ? (
                      <img
                        src={profileImageSrc}
                        alt={adminProfile.name ? `${adminProfile.name} profile` : "Administrator profile"}
                        className="admin-brand-profile-image"
                      />
                    ) : (
                      <MetroWasteMunicipalSeal />
                    )}
                  </div>

                  <div className="admin-brand-code-copy">
                    <div
                      className="admin-brand-code-title"
                      title={adminProfile.name || "METRO WASTE"}
                    >
                      {adminProfile.name || "METRO WASTE"}
                    </div>
                    <div className="admin-brand-code-city">CATBALOGAN</div>
                    <div className="admin-brand-code-divider">
                      <span />
                      <b aria-hidden="true">◆</b>
                      <span />
                    </div>
                    <div className="admin-brand-code-tagline">Smart • Clean • Sustainable</div>
                  </div>
                </div>

                <MetroWasteSkyline />

                <svg
                  className="metro-brand-wave"
                  viewBox="0 0 360 36"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M-8 9C74 30 145 29 215 18c58-9 105-12 153-6"
                    fill="none"
                    stroke="rgba(72,222,84,.26)"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                  <path
                    d="M-8 7C75 27 145 26 216 16c58-9 105-11 152-5"
                    fill="none"
                    stroke="#45d957"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="admin-brand-collapsed" aria-hidden="true">
                {profileImageSrc ? (
                  <img
                    src={profileImageSrc}
                    alt=""
                    className="admin-brand-profile-image admin-brand-profile-image-collapsed"
                  />
                ) : (
                  <MetroWasteMunicipalSeal />
                )}
              </div>
            </div>

            <button
              type="button"
              className="admin-sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <IconCollapse />
            </button>
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
                        title={sidebarCollapsed ? link.label : undefined}
                        data-tooltip={link.label}
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
              title={sidebarCollapsed ? (adminProfile.name || "Admin User") : undefined}
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

        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />

        <section className="admin-main">
          <header className="admin-topbar">
            <button
              type="button"
              className="admin-mobile-menu"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <IconMenu />
            </button>

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


        /* =========================================================
           METRO WASTE CATBALOGAN — PROFESSIONAL COLLAPSIBLE SIDEBAR
           ========================================================= */

        :root {
          --metro-sidebar: #041b14;
          --metro-sidebar-deep: #02130f;
          --metro-sidebar-soft: #073526;
          --metro-green: #39d353;
          --metro-green-strong: #21b34b;
          --metro-green-muted: #8fe29f;
          --metro-cream: #f7fbf8;
        }

        .admin-shell {
          background: #f5f8f6;
        }

        .admin-sidebar {
          width: 292px;
          min-width: 292px;
          overflow: visible;
          isolation: isolate;
          background:
            radial-gradient(circle at 24% 4%, rgba(57, 211, 83, 0.16), transparent 25%),
            linear-gradient(180deg, #063424 0%, var(--metro-sidebar) 40%, var(--metro-sidebar-deep) 100%);
          border-right: 1px solid rgba(121, 255, 151, 0.11);
          box-shadow: 14px 0 42px rgba(2, 19, 15, 0.14);
          transition:
            width 220ms cubic-bezier(.2,.75,.2,1),
            min-width 220ms cubic-bezier(.2,.75,.2,1),
            transform 220ms cubic-bezier(.2,.75,.2,1);
        }

        .admin-sidebar::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          opacity: .55;
          background:
            linear-gradient(155deg, transparent 0 21%, rgba(57,211,83,.05) 21.2% 21.5%, transparent 21.8%),
            radial-gradient(circle at 88% 18%, rgba(57,211,83,.10), transparent 18%);
        }

        .admin-brand-wrap {
          position: relative;
          min-height: 150px;
          align-items: flex-start;
          gap: 14px;
          padding: 28px 24px 24px;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }

        .brand-mark {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: rgba(255,255,255,.08);
          box-shadow:
            0 14px 32px rgba(0,0,0,.20),
            inset 0 0 0 1px rgba(255,255,255,.11);
        }

        .metro-logo {
          width: 56px;
          height: 56px;
        }

        .admin-brand-copy {
          min-width: 0;
          padding-top: 4px;
          transition: opacity 150ms ease, transform 150ms ease;
        }

        .admin-brand {
          font-size: 20px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -.025em;
          white-space: nowrap;
        }

        .admin-brand-city {
          margin-top: 7px;
          color: var(--metro-green);
          font-size: 12px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: .30em;
          white-space: nowrap;
        }

        .admin-brand-sub {
          margin-top: 17px;
          color: #c4d9cf;
          font-size: 11px;
          font-weight: 650;
          white-space: nowrap;
        }

        .admin-sidebar-toggle {
          position: absolute;
          top: 72px;
          right: -16px;
          z-index: 5;
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid #dce8e1;
          border-radius: 50%;
          background: #ffffff;
          color: #174834;
          box-shadow: 0 8px 22px rgba(2, 19, 15, .18);
          transition: transform 200ms ease, background 160ms ease, color 160ms ease;
        }

        .admin-sidebar-toggle:hover {
          background: var(--metro-green);
          color: #062216;
          transform: scale(1.06);
        }

        .admin-sidebar-toggle .admin-svg-icon {
          width: 17px;
          height: 17px;
          transition: transform 220ms ease;
        }

        .admin-nav {
          padding: 14px 16px 18px;
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,.20) transparent;
        }

        .admin-nav::-webkit-scrollbar {
          width: 5px;
        }

        .admin-nav::-webkit-scrollbar-track {
          background: transparent;
        }

        .admin-nav::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(255,255,255,.18);
        }

        .admin-nav-group {
          padding: 14px 0 18px;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }

        .admin-nav-group-title {
          margin: 0 12px 10px;
          color: #86a99a;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .13em;
        }

        .admin-nav-link {
          min-height: 50px;
          gap: 13px;
          padding: 0 13px;
          margin-bottom: 5px;
          border-radius: 13px;
          color: #e2eee8;
          font-size: 14px;
          font-weight: 760;
          transform: none;
        }

        .admin-nav-link::before {
          content: "";
          position: absolute;
          left: 0;
          top: 9px;
          bottom: 9px;
          width: 3px;
          border-radius: 999px;
          background: transparent;
        }

        .admin-nav-link:hover {
          background: rgba(255,255,255,.07);
          color: #ffffff;
          transform: none;
        }

        .admin-nav-link.active {
          background: linear-gradient(90deg, rgba(24,125,79,.95), rgba(10,81,58,.92));
          color: #ffffff;
          box-shadow:
            inset 0 0 0 1px rgba(94,231,124,.16),
            0 12px 28px rgba(0,0,0,.14);
        }

        .admin-nav-link.active::before {
          background: var(--metro-green);
          box-shadow: 0 0 15px rgba(57,211,83,.56);
        }

        .admin-nav-link.active .admin-nav-icon {
          color: var(--metro-green);
        }

        .admin-nav-icon {
          width: 28px;
          height: 28px;
          color: #d8e8e0;
        }

        .admin-nav-icon .admin-svg-icon {
          width: 20px;
          height: 20px;
        }

        .admin-nav-label {
          min-width: 0;
        }

        .admin-badge {
          min-width: 25px;
          height: 22px;
          font-size: 10px;
          border: 2px solid rgba(4,27,20,.9);
        }

        .admin-sidebar-footer {
          padding: 14px 16px 18px;
          border-top: 1px solid rgba(255,255,255,.08);
        }

        .admin-user-card {
          min-height: 70px;
          gap: 11px;
          padding: 10px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.035));
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
        }

        .admin-user-card:hover {
          background: rgba(255,255,255,.11);
          transform: none;
        }

        .admin-user-avatar {
          width: 44px;
          height: 44px;
          border: 2px solid rgba(113, 231, 138, .56);
          background: #ffffff;
        }

        .admin-user-name {
          font-size: 13px;
        }

        .admin-user-email {
          max-width: 155px;
          color: #9bb7aa;
          font-size: 11px;
        }

        .admin-user-arrow {
          color: var(--metro-green-muted);
        }

        .admin-main {
          transition: width 220ms cubic-bezier(.2,.75,.2,1);
        }

        .admin-topbar {
          height: 76px;
          padding: 0 28px;
          background: rgba(255,255,255,.94);
          border-bottom-color: #e1e9e4;
          box-shadow: 0 1px 0 rgba(15,23,42,.02);
        }

        .admin-mobile-menu {
          display: none;
          width: 44px;
          height: 44px;
          flex: 0 0 44px;
          place-items: center;
          border: 1px solid #dce7e0;
          border-radius: 13px;
          background: #ffffff;
          color: #174834;
          box-shadow: 0 8px 20px rgba(15,23,42,.05);
        }

        .admin-mobile-menu .admin-svg-icon {
          width: 21px;
          height: 21px;
        }

        .admin-search-wrap {
          width: min(520px, 100%);
          height: 46px;
          border-color: #dce7e0;
          border-radius: 14px;
        }

        .admin-search-wrap:focus-within {
          border-color: #39b95a;
          box-shadow: 0 0 0 4px rgba(57,185,90,.10);
        }

        .admin-icon-btn:hover,
        .admin-profile-mini:hover {
          border-color: #cfe3d7;
          background: #f4faf6;
        }

        .admin-profile-avatar,
        .admin-dropdown-avatar {
          background: linear-gradient(135deg, #0f7a4f, #39b95a);
        }

        .admin-content {
          padding: 28px;
          background:
            radial-gradient(circle at 100% 0, rgba(46, 160, 85, .055), transparent 28%),
            #f5f8f6;
        }

        .admin-sidebar-backdrop {
          display: none;
          border: 0;
          padding: 0;
        }

        /* Desktop collapsed state */
        .admin-shell.sidebar-collapsed .admin-sidebar {
          width: 88px;
          min-width: 88px;
        }

        .admin-shell.sidebar-collapsed .admin-brand-wrap {
          min-height: 112px;
          justify-content: center;
          padding: 24px 16px;
        }

        .admin-shell.sidebar-collapsed .brand-mark {
          width: 48px;
          height: 48px;
        }

        .admin-shell.sidebar-collapsed .metro-logo {
          width: 48px;
          height: 48px;
        }

        .admin-shell.sidebar-collapsed .admin-brand-copy,
        .admin-shell.sidebar-collapsed .admin-nav-group-title,
        .admin-shell.sidebar-collapsed .admin-nav-label,
        .admin-shell.sidebar-collapsed .admin-user-info,
        .admin-shell.sidebar-collapsed .admin-user-arrow {
          display: none;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-toggle {
          top: 66px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-toggle .admin-svg-icon {
          transform: rotate(180deg);
        }

        .admin-shell.sidebar-collapsed .admin-nav {
          padding: 12px 13px 18px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-group {
          padding: 8px 0 12px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link {
          justify-content: center;
          width: 54px;
          min-height: 50px;
          padding: 0;
          margin: 0 auto 6px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link::after {
          content: attr(data-tooltip);
          position: absolute;
          left: calc(100% + 14px);
          top: 50%;
          z-index: 120;
          padding: 7px 10px;
          border-radius: 8px;
          background: #0e2c20;
          color: #ffffff;
          box-shadow: 0 10px 26px rgba(2,19,15,.22);
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transform: translate(4px,-50%);
          transition: opacity 120ms ease, transform 120ms ease;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link:hover::after {
          opacity: 1;
          transform: translate(0,-50%);
        }

        .admin-shell.sidebar-collapsed .admin-nav-link::before {
          left: -1px;
          top: 8px;
          bottom: 8px;
        }

        .admin-shell.sidebar-collapsed .admin-badge {
          position: absolute;
          top: -4px;
          right: -6px;
          min-width: 20px;
          height: 20px;
          padding: 0 5px;
          font-size: 9px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-footer {
          padding: 12px 13px 16px;
        }

        .admin-shell.sidebar-collapsed .admin-user-card {
          width: 58px;
          min-height: 58px;
          justify-content: center;
          padding: 7px;
          margin: 0 auto;
        }

        .admin-shell.sidebar-collapsed .admin-user-avatar {
          width: 42px;
          height: 42px;
        }

        @media (max-width: 1100px) and (min-width: 901px) {
          .admin-sidebar {
            width: 260px;
            min-width: 260px;
          }

          .admin-shell.sidebar-collapsed .admin-sidebar {
            width: 88px;
            min-width: 88px;
          }
        }

        @media (max-width: 900px) {
          .admin-shell {
            display: block;
          }

          .admin-nav,
          .admin-shell.sidebar-collapsed .admin-nav {
            display: block;
            padding: 14px 16px 18px;
          }

          .admin-nav-group,
          .admin-shell.sidebar-collapsed .admin-nav-group {
            padding: 14px 0 18px;
            border-bottom: 1px solid rgba(255,255,255,.08);
          }

          .admin-sidebar-footer {
            display: block;
          }

          .admin-sidebar,
          .admin-shell.sidebar-collapsed .admin-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            z-index: 1100;
            width: min(292px, 86vw);
            min-width: min(292px, 86vw);
            height: 100dvh;
            transform: translateX(-104%);
            box-shadow: 24px 0 60px rgba(2,19,15,.32);
          }

          .admin-shell.mobile-sidebar-open .admin-sidebar {
            transform: translateX(0);
          }

          .admin-shell.sidebar-collapsed .admin-brand-wrap {
            min-height: 150px;
            justify-content: flex-start;
            padding: 28px 24px 24px;
          }

          .admin-shell.sidebar-collapsed .brand-mark,
          .admin-shell.sidebar-collapsed .metro-logo {
            width: 56px;
            height: 56px;
          }

          .admin-shell.sidebar-collapsed .admin-brand-copy,
          .admin-shell.sidebar-collapsed .admin-nav-group-title,
          .admin-shell.sidebar-collapsed .admin-nav-label,
          .admin-shell.sidebar-collapsed .admin-user-info,
          .admin-shell.sidebar-collapsed .admin-user-arrow {
            display: initial;
          }

          .admin-shell.sidebar-collapsed .admin-brand-copy,
          .admin-shell.sidebar-collapsed .admin-user-info {
            display: block;
          }

          .admin-shell.sidebar-collapsed .admin-nav {
            display: block;
            padding: 14px 16px 18px;
          }

          .admin-shell.sidebar-collapsed .admin-nav-group {
            padding: 14px 0 18px;
            border-bottom: 1px solid rgba(255,255,255,.08);
          }

          .admin-shell.sidebar-collapsed .admin-nav-link {
            justify-content: flex-start;
            width: auto;
            min-height: 50px;
            gap: 13px;
            padding: 0 13px;
            margin: 0 0 5px;
          }

          .admin-shell.sidebar-collapsed .admin-nav-link::after {
            display: none;
          }

          .admin-shell.sidebar-collapsed .admin-badge {
            position: static;
            margin-left: auto;
            min-width: 25px;
            height: 22px;
            padding: 0 7px;
            font-size: 10px;
          }

          .admin-shell.sidebar-collapsed .admin-sidebar-footer {
            display: block;
            padding: 14px 16px 18px;
          }

          .admin-shell.sidebar-collapsed .admin-user-card {
            width: 100%;
            min-height: 70px;
            justify-content: flex-start;
            gap: 11px;
            padding: 10px;
          }

          .admin-shell.sidebar-collapsed .admin-sidebar-toggle {
            display: none;
          }

          .admin-sidebar-toggle {
            display: none;
          }

          .admin-sidebar-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1090;
            background: rgba(1,18,13,.52);
            backdrop-filter: blur(3px);
          }

          .admin-shell.mobile-sidebar-open .admin-sidebar-backdrop {
            display: block;
          }

          .admin-main {
            width: 100%;
          }

          .admin-topbar {
            height: 70px;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 10px;
            padding: 0 16px;
          }

          .admin-mobile-menu {
            display: grid;
          }

          .admin-search-wrap {
            flex: 1;
            width: auto;
            min-width: 0;
          }

          .admin-topbar-actions {
            justify-content: flex-end;
            flex-shrink: 0;
          }

          .admin-profile-text {
            display: none;
          }

          .admin-content {
            padding: 20px 16px 28px;
          }
        }

        @media (max-width: 620px) {
          .admin-topbar {
            padding: 0 10px;
          }

          .admin-search-shortcut,
          .admin-profile-mini .admin-chevron {
            display: none;
          }

          .admin-profile-mini {
            padding: 3px;
          }

          .admin-profile-avatar {
            width: 40px;
            height: 40px;
          }

          .admin-icon-btn {
            width: 42px;
            height: 42px;
          }

          .admin-search {
            font-size: 13px;
            padding-right: 34px;
          }

          .admin-search-icon {
            width: 42px;
          }
        }


        /* =========================================================
           EXACT REFERENCE SIDEBAR — image-matched Metro Waste style
           ========================================================= */
        .admin-sidebar {
          width: 360px;
          min-width: 360px;
          background:
            radial-gradient(circle at 24% 0%, rgba(22, 163, 74, .13), transparent 24%),
            linear-gradient(180deg, #073f2c 0%, #022d22 28%, #001d17 100%);
          border-right: 1px solid rgba(100, 230, 130, .10);
          box-shadow: 16px 0 44px rgba(0, 24, 18, .16);
        }

        .admin-sidebar::before {
          opacity: .35;
          background:
            radial-gradient(circle at 8% 8%, rgba(56, 189, 85, .10), transparent 19%),
            radial-gradient(circle at 95% 18%, rgba(31, 133, 80, .12), transparent 18%);
        }

        .admin-brand-wrap {
          position: relative;
          display: block;
          min-height: 154px;
          padding: 0;
          border-bottom: 0;
          background: #043426;
          overflow: visible;
        }

        .admin-brand-hero {
          width: 100%;
          height: 154px;
          overflow: hidden;
          background: #043426;
        }

        .admin-brand-banner {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center center;
          user-select: none;
          pointer-events: none;
        }

        .admin-collapsed-seal {
          display: none;
        }

        .admin-sidebar-toggle {
          top: 68px;
          right: -17px;
          width: 34px;
          height: 34px;
          border: 1px solid #dfece4;
          background: #ffffff;
          color: #0a5d3f;
          box-shadow: 0 8px 22px rgba(0, 36, 26, .24);
        }

        .admin-sidebar-toggle:hover {
          background: #45db58;
          color: #062a1c;
        }

        .admin-nav {
          padding: 25px 28px 22px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,.18) transparent;
        }

        .admin-nav-group {
          padding: 18px 0 24px;
          border-bottom: 1px solid rgba(255,255,255,.10);
        }

        .admin-nav-group:first-child {
          padding-top: 2px;
        }

        .admin-nav-group-title {
          margin: 0 12px 15px;
          color: #79a897;
          font-size: 12px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: .16em;
        }

        .admin-nav-link {
          min-height: 58px;
          gap: 16px;
          padding: 0 18px;
          margin-bottom: 7px;
          border-radius: 14px;
          color: #f0f7f3;
          font-size: 15px;
          font-weight: 760;
          letter-spacing: -.01em;
        }

        .admin-nav-link::before {
          left: 0;
          top: 10px;
          bottom: 10px;
          width: 4px;
        }

        .admin-nav-link:hover {
          background: rgba(255,255,255,.07);
          color: #ffffff;
        }

        .admin-nav-link.active {
          background: linear-gradient(90deg, rgba(12, 107, 72, .98), rgba(10, 76, 58, .92));
          box-shadow:
            inset 0 0 0 1px rgba(87, 230, 116, .20),
            0 12px 26px rgba(0, 0, 0, .14);
        }

        .admin-nav-link.active::before {
          background: #42df55;
          box-shadow: 0 0 17px rgba(66,223,85,.62);
        }

        .admin-nav-link.active .admin-nav-icon {
          color: #42df55;
        }

        .admin-nav-icon {
          width: 30px;
          height: 30px;
          color: #f4faf7;
        }

        .admin-nav-icon .admin-svg-icon {
          width: 22px;
          height: 22px;
        }

        .admin-badge {
          min-width: 30px;
          height: 24px;
          padding: 0 8px;
          border: 2px solid #022d22;
          background: #ff444f;
          font-size: 10px;
        }

        .admin-sidebar-footer {
          padding: 18px 28px 26px;
          border-top: 1px solid rgba(255,255,255,.10);
        }

        .admin-user-card {
          min-height: 82px;
          gap: 13px;
          padding: 12px 14px;
          border-radius: 17px;
          background: linear-gradient(135deg, rgba(255,255,255,.075), rgba(255,255,255,.035));
          box-shadow: inset 0 0 0 1px rgba(116, 225, 142, .13);
        }

        .admin-user-avatar {
          width: 50px;
          height: 50px;
          border: 2px solid rgba(82, 225, 108, .45);
          background: #ffffff;
        }

        .admin-user-name {
          font-size: 14px;
          font-weight: 900;
        }

        .admin-user-email {
          max-width: 205px;
          color: #a7c2b7;
          font-size: 11px;
        }

        .admin-user-arrow {
          color: #53e267;
          font-size: 22px;
        }

        /* Collapsed: seal-only version of the same branding */
        .admin-shell.sidebar-collapsed .admin-sidebar {
          width: 92px;
          min-width: 92px;
        }

        .admin-shell.sidebar-collapsed .admin-brand-wrap {
          min-height: 118px;
          padding: 0;
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, #06452f, #022d22);
        }

        .admin-shell.sidebar-collapsed .admin-brand-hero {
          width: 92px;
          height: 118px;
          display: grid;
          place-items: center;
        }

        .admin-shell.sidebar-collapsed .admin-brand-banner {
          display: none;
        }

        .admin-shell.sidebar-collapsed .admin-collapsed-seal {
          display: block;
          width: 58px;
          height: 58px;
          object-fit: cover;
          border-radius: 50%;
          box-shadow: 0 9px 22px rgba(0,0,0,.20);
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-toggle {
          top: 52px;
        }

        .admin-shell.sidebar-collapsed .admin-nav {
          padding: 15px 17px 20px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-group {
          padding: 9px 0 14px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link {
          width: 58px;
          min-height: 56px;
          margin: 0 auto 8px;
          border-radius: 15px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-footer {
          padding: 14px 17px 20px;
        }

        .admin-shell.sidebar-collapsed .admin-user-card {
          width: 58px;
          min-height: 58px;
        }

        @media (max-width: 1220px) and (min-width: 901px) {
          .admin-sidebar {
            width: 326px;
            min-width: 326px;
          }
          .admin-brand-hero {
            height: 140px;
          }
          .admin-brand-wrap {
            min-height: 140px;
          }
          .admin-nav {
            padding-left: 22px;
            padding-right: 22px;
          }
          .admin-sidebar-footer {
            padding-left: 22px;
            padding-right: 22px;
          }
          .admin-shell.sidebar-collapsed .admin-sidebar {
            width: 92px;
            min-width: 92px;
          }
        }

        @media (max-width: 900px) {
          .admin-sidebar,
          .admin-shell.sidebar-collapsed .admin-sidebar {
            width: min(360px, 91vw);
            min-width: min(360px, 91vw);
          }

          .admin-brand-wrap,
          .admin-shell.sidebar-collapsed .admin-brand-wrap {
            min-height: 154px;
            padding: 0;
            display: block;
          }

          .admin-brand-hero,
          .admin-shell.sidebar-collapsed .admin-brand-hero {
            width: 100%;
            height: 154px;
            display: block;
          }

          .admin-brand-banner,
          .admin-shell.sidebar-collapsed .admin-brand-banner {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .admin-collapsed-seal,
          .admin-shell.sidebar-collapsed .admin-collapsed-seal {
            display: none;
          }

          .admin-nav,
          .admin-shell.sidebar-collapsed .admin-nav {
            padding: 22px 24px 22px;
          }

          .admin-nav-link,
          .admin-shell.sidebar-collapsed .admin-nav-link {
            width: auto;
            min-height: 56px;
            justify-content: flex-start;
            gap: 15px;
            padding: 0 17px;
            margin: 0 0 7px;
          }

          .admin-sidebar-footer,
          .admin-shell.sidebar-collapsed .admin-sidebar-footer {
            padding: 18px 24px 24px;
          }

          .admin-user-card,
          .admin-shell.sidebar-collapsed .admin-user-card {
            width: 100%;
            min-height: 78px;
            justify-content: flex-start;
            gap: 12px;
            padding: 12px 14px;
          }
        }



        /* =========================================================
           FINAL CODE-ONLY METRO WASTE BRAND + SIDEBAR FIX
           This block intentionally overrides the older sidebar rules.
           No /public branding PNG is required.
           ========================================================= */

        .admin-sidebar {
          width: 350px;
          min-width: 350px;
          background:
            radial-gradient(circle at 18% 3%, rgba(61, 211, 89, .13), transparent 25%),
            radial-gradient(circle at 92% 15%, rgba(31, 122, 79, .15), transparent 22%),
            linear-gradient(180deg, #063d2b 0%, #043123 26%, #01261d 61%, #001c16 100%);
          border-right: 1px solid rgba(91, 226, 120, .12);
          box-shadow: 16px 0 42px rgba(1, 25, 18, .18);
        }

        .admin-sidebar::before {
          opacity: .42;
          background:
            linear-gradient(151deg, transparent 0 18%, rgba(65,217,87,.045) 18.2% 18.7%, transparent 18.9% 100%),
            radial-gradient(circle at 90% 8%, rgba(65,217,87,.08), transparent 19%);
        }

        .admin-brand-wrap {
          min-height: 170px;
          padding: 0;
          display: block;
          border-bottom: 1px solid rgba(255,255,255,.08);
          background: transparent;
          overflow: visible;
        }

        .admin-brand-hero {
          position: relative;
          width: 100%;
          height: 170px;
          overflow: hidden;
          background:
            radial-gradient(circle at 12% 14%, rgba(72, 222, 84, .12), transparent 19%),
            linear-gradient(145deg, rgba(8,75,50,.98), rgba(2,49,36,.98) 58%, rgba(1,38,29,.99));
        }

        .admin-brand-expanded {
          position: relative;
          width: 100%;
          height: 100%;
        }

        .admin-brand-top {
          position: relative;
          z-index: 4;
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 18px 24px 0;
        }

        .admin-brand-seal-wrap {
          width: 78px;
          height: 78px;
          flex: 0 0 78px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          filter: drop-shadow(0 8px 16px rgba(0,0,0,.18));
        }

        .metro-municipal-seal {
          width: 100%;
          height: 100%;
          display: block;
        }

        .admin-brand-profile-image {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          object-position: center;
          border-radius: 50%;
          border: 3px solid rgba(255, 255, 255, .95);
          background: #ffffff;
          box-shadow:
            0 0 0 3px rgba(69, 217, 87, .22),
            0 8px 18px rgba(0, 0, 0, .22);
        }

        .admin-brand-seal-wrap {
          overflow: hidden;
          background: rgba(255, 255, 255, .98);
          border: 1px solid rgba(255, 255, 255, .72);
        }

        .admin-brand-code-copy {
          min-width: 0;
          padding-top: 2px;
        }

        .admin-brand-code-title {
          max-width: 205px;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #ffffff;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 950;
          letter-spacing: .015em;
          white-space: nowrap;
          text-shadow: 0 2px 12px rgba(0,0,0,.18);
        }

        .admin-brand-code-city {
          margin-top: 7px;
          color: #55dd63;
          font-size: 11px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: .34em;
          white-space: nowrap;
        }

        .admin-brand-code-divider {
          width: 150px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 7px;
          margin-top: 10px;
          color: #42d957;
        }

        .admin-brand-code-divider span {
          height: 1px;
          background: linear-gradient(90deg, rgba(80,222,95,.12), rgba(80,222,95,.76));
        }

        .admin-brand-code-divider span:last-child {
          background: linear-gradient(90deg, rgba(80,222,95,.76), rgba(80,222,95,.12));
        }

        .admin-brand-code-divider b {
          font-size: 8px;
          line-height: 1;
          transform: rotate(45deg);
          opacity: .9;
        }

        .admin-brand-code-tagline {
          margin-top: 8px;
          color: #e0eee6;
          font-size: 10px;
          line-height: 1;
          font-weight: 650;
          white-space: nowrap;
        }

        .metro-brand-skyline {
          position: absolute;
          z-index: 1;
          left: 0;
          right: 0;
          bottom: 11px;
          width: 100%;
          height: 71px;
          color: rgba(58, 188, 91, .25);
          pointer-events: none;
        }

        .metro-brand-wave {
          position: absolute;
          z-index: 3;
          left: 0;
          right: 0;
          bottom: -1px;
          width: 100%;
          height: 38px;
          pointer-events: none;
        }

        .admin-brand-collapsed {
          display: none;
        }

        .admin-sidebar-toggle {
          top: 68px;
          right: -17px;
          width: 34px;
          height: 34px;
          border: 1px solid #dbe8e0;
          border-radius: 999px;
          background: #ffffff;
          color: #0b6847;
          box-shadow: 0 9px 24px rgba(0, 34, 24, .26);
        }

        .admin-sidebar-toggle:hover {
          background: #49dc5c;
          color: #062b1d;
        }

        .admin-nav {
          padding: 20px 24px 18px;
          overflow-x: hidden;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(92, 164, 137, .52) transparent;
        }

        .admin-nav::-webkit-scrollbar {
          width: 5px;
          height: 0;
        }

        .admin-nav::-webkit-scrollbar-track {
          background: transparent;
        }

        .admin-nav::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(107, 173, 149, .40);
        }

        .admin-nav::-webkit-scrollbar-button {
          width: 0;
          height: 0;
          display: none;
        }

        .admin-nav-group {
          padding: 16px 0 20px;
          border-bottom: 1px solid rgba(255,255,255,.09);
        }

        .admin-nav-group:first-child {
          padding-top: 4px;
        }

        .admin-nav-group:last-child {
          padding-bottom: 8px;
          border-bottom: 0;
        }

        .admin-nav-group-title {
          margin: 0 12px 12px;
          color: #7fa493;
          font-size: 11px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .15em;
        }

        .admin-nav-link {
          min-height: 52px;
          gap: 15px;
          padding: 0 16px;
          margin-bottom: 6px;
          border-radius: 13px;
          color: #f0f7f3;
          font-size: 14px;
          font-weight: 780;
          letter-spacing: -.01em;
          box-shadow: none;
        }

        .admin-nav-link::before {
          left: 0;
          top: 8px;
          bottom: 8px;
          width: 3px;
          border-radius: 0 999px 999px 0;
        }

        .admin-nav-link:hover {
          background: rgba(255,255,255,.065);
          color: #ffffff;
          transform: none;
        }

        .admin-nav-link.active {
          background: linear-gradient(90deg, rgba(11,108,72,.98), rgba(8,78,57,.92));
          color: #ffffff;
          box-shadow:
            inset 0 0 0 1px rgba(82,224,108,.18),
            0 10px 24px rgba(0,0,0,.13);
        }

        .admin-nav-link.active::before {
          background: #42de57;
          box-shadow: 0 0 16px rgba(66,222,87,.55);
        }

        .admin-nav-link.active .admin-nav-icon {
          color: #48df5b;
        }

        .admin-nav-icon {
          width: 28px;
          height: 28px;
          color: #e8f2ed;
        }

        .admin-nav-icon .admin-svg-icon {
          width: 20px;
          height: 20px;
        }

        .admin-badge {
          min-width: 29px;
          height: 23px;
          padding: 0 8px;
          border: 2px solid #03291f;
          background: #ff4450;
          font-size: 10px;
          box-shadow: 0 7px 15px rgba(255,68,80,.18);
        }

        .admin-sidebar-footer {
          padding: 15px 24px 22px;
          border-top: 1px solid rgba(255,255,255,.09);
        }

        .admin-user-card {
          min-height: 75px;
          gap: 12px;
          padding: 11px 13px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(255,255,255,.072), rgba(255,255,255,.032));
          box-shadow: inset 0 0 0 1px rgba(91,224,116,.12);
        }

        .admin-user-card:hover {
          background: rgba(255,255,255,.095);
          transform: none;
        }

        .admin-user-avatar {
          width: 47px;
          height: 47px;
          border: 2px solid rgba(80,220,103,.42);
        }

        .admin-user-name {
          font-size: 14px;
        }

        .admin-user-email {
          max-width: 190px;
          color: #9eb8ad;
          font-size: 11px;
        }

        .admin-user-arrow {
          color: #51df64;
        }

        /* Collapsed desktop */
        .admin-shell.sidebar-collapsed .admin-sidebar {
          width: 88px;
          min-width: 88px;
        }

        .admin-shell.sidebar-collapsed .admin-brand-wrap {
          min-height: 112px;
          padding: 0;
          display: block;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }

        .admin-shell.sidebar-collapsed .admin-brand-hero {
          width: 88px;
          height: 112px;
          display: grid;
          place-items: center;
        }

        .admin-shell.sidebar-collapsed .admin-brand-expanded {
          display: none;
        }

        .admin-shell.sidebar-collapsed .admin-brand-collapsed {
          display: grid;
          place-items: center;
          width: 57px;
          height: 57px;
          overflow: hidden;
          border-radius: 50%;
          filter: drop-shadow(0 8px 15px rgba(0,0,0,.18));
        }

        .admin-shell.sidebar-collapsed .admin-brand-profile-image-collapsed {
          width: 57px;
          height: 57px;
          border-width: 2px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-toggle {
          top: 48px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-toggle .admin-svg-icon {
          transform: rotate(180deg);
        }

        .admin-shell.sidebar-collapsed .admin-nav {
          padding: 12px 15px 18px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-group {
          padding: 8px 0 12px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-group-title,
        .admin-shell.sidebar-collapsed .admin-nav-label,
        .admin-shell.sidebar-collapsed .admin-user-info,
        .admin-shell.sidebar-collapsed .admin-user-arrow {
          display: none;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link {
          width: 56px;
          min-height: 52px;
          justify-content: center;
          gap: 0;
          padding: 0;
          margin: 0 auto 6px;
          border-radius: 14px;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link::after {
          content: attr(data-tooltip);
          position: absolute;
          left: calc(100% + 14px);
          top: 50%;
          z-index: 130;
          padding: 8px 11px;
          border-radius: 9px;
          background: #0b2c20;
          color: #ffffff;
          box-shadow: 0 12px 28px rgba(0,20,14,.28);
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transform: translate(5px,-50%);
          transition: opacity 130ms ease, transform 130ms ease;
        }

        .admin-shell.sidebar-collapsed .admin-nav-link:hover::after {
          opacity: 1;
          transform: translate(0,-50%);
        }

        .admin-shell.sidebar-collapsed .admin-badge {
          position: absolute;
          top: -4px;
          right: -7px;
          min-width: 21px;
          height: 20px;
          padding: 0 5px;
          font-size: 9px;
        }

        .admin-shell.sidebar-collapsed .admin-sidebar-footer {
          padding: 12px 15px 16px;
        }

        .admin-shell.sidebar-collapsed .admin-user-card {
          width: 56px;
          min-height: 56px;
          justify-content: center;
          padding: 6px;
          margin: 0 auto;
        }

        .admin-shell.sidebar-collapsed .admin-user-avatar {
          width: 43px;
          height: 43px;
        }

        @media (max-width: 1180px) and (min-width: 901px) {
          .admin-sidebar {
            width: 320px;
            min-width: 320px;
          }

          .admin-brand-hero,
          .admin-brand-wrap {
            height: 160px;
            min-height: 160px;
          }

          .admin-brand-top {
            padding-left: 20px;
            padding-right: 20px;
            gap: 13px;
          }

          .admin-brand-seal-wrap {
            width: 70px;
            height: 70px;
            flex-basis: 70px;
          }

          .admin-brand-code-title {
            font-size: 20px;
          }

          .admin-brand-code-city {
            font-size: 10px;
          }

          .admin-nav,
          .admin-sidebar-footer {
            padding-left: 20px;
            padding-right: 20px;
          }

          .admin-shell.sidebar-collapsed .admin-sidebar {
            width: 88px;
            min-width: 88px;
          }

          .admin-shell.sidebar-collapsed .admin-brand-hero,
          .admin-shell.sidebar-collapsed .admin-brand-wrap {
            width: 88px;
            height: 112px;
            min-height: 112px;
          }
        }

        @media (max-width: 900px) {
          .admin-sidebar,
          .admin-shell.sidebar-collapsed .admin-sidebar {
            width: min(350px, 92vw);
            min-width: min(350px, 92vw);
            height: 100dvh;
          }

          .admin-brand-wrap,
          .admin-shell.sidebar-collapsed .admin-brand-wrap {
            min-height: 168px;
            height: 168px;
          }

          .admin-brand-hero,
          .admin-shell.sidebar-collapsed .admin-brand-hero {
            width: 100%;
            height: 168px;
            display: block;
          }

          .admin-brand-expanded,
          .admin-shell.sidebar-collapsed .admin-brand-expanded {
            display: block;
            width: 100%;
            height: 100%;
          }

          .admin-brand-collapsed,
          .admin-shell.sidebar-collapsed .admin-brand-collapsed {
            display: none;
          }

          .admin-sidebar-toggle,
          .admin-shell.sidebar-collapsed .admin-sidebar-toggle {
            display: none;
          }

          .admin-nav,
          .admin-shell.sidebar-collapsed .admin-nav {
            display: block;
            padding: 18px 20px 18px;
          }

          .admin-nav-group,
          .admin-shell.sidebar-collapsed .admin-nav-group {
            padding: 13px 0 17px;
          }

          .admin-nav-group-title,
          .admin-shell.sidebar-collapsed .admin-nav-group-title {
            display: block;
          }

          .admin-nav-link,
          .admin-shell.sidebar-collapsed .admin-nav-link {
            width: auto;
            min-height: 52px;
            justify-content: flex-start;
            gap: 14px;
            padding: 0 15px;
            margin: 0 0 6px;
          }

          .admin-nav-label,
          .admin-shell.sidebar-collapsed .admin-nav-label {
            display: inline;
          }

          .admin-shell.sidebar-collapsed .admin-nav-link::after {
            display: none;
          }

          .admin-badge,
          .admin-shell.sidebar-collapsed .admin-badge {
            position: static;
            margin-left: auto;
            min-width: 29px;
            height: 23px;
            padding: 0 8px;
            font-size: 10px;
          }

          .admin-sidebar-footer,
          .admin-shell.sidebar-collapsed .admin-sidebar-footer {
            display: block;
            padding: 15px 20px 20px;
          }

          .admin-user-card,
          .admin-shell.sidebar-collapsed .admin-user-card {
            width: 100%;
            min-height: 74px;
            justify-content: flex-start;
            gap: 12px;
            padding: 11px 13px;
          }

          .admin-user-info,
          .admin-shell.sidebar-collapsed .admin-user-info {
            display: flex;
          }

          .admin-user-arrow,
          .admin-shell.sidebar-collapsed .admin-user-arrow {
            display: inline;
          }
        }

        @media (max-width: 430px) {
          .admin-brand-top {
            gap: 11px;
            padding: 17px 17px 0;
          }

          .admin-brand-seal-wrap {
            width: 66px;
            height: 66px;
            flex-basis: 66px;
          }

          .admin-brand-code-title {
            font-size: 18px;
          }

          .admin-brand-code-city {
            margin-top: 6px;
            font-size: 9px;
            letter-spacing: .28em;
          }

          .admin-brand-code-divider {
            width: 128px;
            margin-top: 8px;
          }

          .admin-brand-code-tagline {
            margin-top: 7px;
            font-size: 9px;
          }
        }

      `}</style>
    </AuthGate>
  );
}