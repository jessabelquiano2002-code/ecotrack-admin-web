"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { onValue, push, ref, remove, set, update } from "@/lib/offlineFirebaseDatabase";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { findOfficialBarangay } from "../service-areas/catalog";
import styles from "./issues.module.css";

type TabType = "all" | "driver" | "resident";
type StatusFilter = "all" | "Open" | "In Progress" | "Resolved";

type IssueRow = {
  id: string;
  uid?: string;
  source?: "resident" | "driver" | string;
  driverName?: string;
  residentName?: string;
  routeName?: string;
  issueType?: string;
  details?: string;
  barangay?: string;
  purok?: string;
  status?: string;
  timestamp?: number;
  updatedAt?: number;
  resolvedAt?: number;
  photoBase64?: string;
  adminTitle?: string;
  adminMessage?: string;
  lastNotifiedAt?: number;
};

type ResidentRow = {
  uid: string;
  name?: string;
  barangay?: string;
  purok?: string;
  fcmToken?: string;
  role?: string;
};

type NoticeForm = {
  barangay: string;
  purok: string;
  title: string;
  message: string;
};

const EMPTY_NOTICE: NoticeForm = {
  barangay: "",
  purok: "",
  title: "",
  message: "",
};

type ServiceBarangay = {
  barangay?: string;
  active?: boolean;
  puroks?: Record<string, { purok?: string; active?: boolean; verified?: boolean; lat?: number; lng?: number }>;
};

function readString(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => readString(item)).filter(Boolean).join(", ");
  }

  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;

    return (
      readString(item.value) ||
      readString(item.label) ||
      readString(item.name) ||
      readString(item.title)
    );
  }

  return "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function cleanText(value?: string): string {
  const cleaned = (value || "")
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .replace(/^"+|"+$/g, "")
    .trim();

  const normalized = cleaned.toLowerCase();
  if (normalized === "undefined" || normalized === "null" || normalized === "nan") {
    return "";
  }

  return cleaned;
}

function displayText(value?: string, fallback = "Not provided"): string {
  const cleaned = cleanText(value);
  return cleaned || fallback;
}

function normalize(value?: string): string {
  return cleanText(value).toLowerCase();
}

function locationKey(value?: string): string {
  return normalize(value)
    .replace(/\s*\(.*?\)/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function barangayKey(value?: string): string {
  const key = locationKey(value).replace(/^(barangay|brgy)\s+/, "").trim();
  if (key === "13" || key === "poblacion13") return "poblacion 13";
  if (key === "guindapunan" || key === "gundaponan") return "guindaponan";
  return key;
}

function purokKey(value?: string): string {
  const raw = locationKey(value)
    .replace(/^purok(\d)/, "purok $1")
    .replace(/^prk\s*/, "")
    .replace(/^purok\s*/, "")
    .trim();

  return raw ? `purok ${raw}` : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }

  return "";
}

function isAllowedBarangay(value: string | undefined, allowedBarangays: string[]): boolean {
  const key = barangayKey(value);
  return allowedBarangays.some((barangay) => barangayKey(barangay) === key);
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPhotoSrc(photoBase64?: string): string {
  if (!photoBase64) return "";
  if (photoBase64.startsWith("data:image")) return photoBase64;
  return `data:image/jpeg;base64,${photoBase64}`;
}

function snapshotToResidents(value: unknown): ResidentRow[] {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>)
    .map(([uid, raw]) => {
      const item = toRecord(raw);
      const location = toRecord(item.location);
      const address = toRecord(item.address);
      const settings = toRecord(item.settings);
      const profile = toRecord(item.profile);
      const residentInfo = toRecord(item.residentInfo);
      const notificationSettings = toRecord(item.notificationSettings);
      const preferences = toRecord(item.preferences);

      const role = readFirstString(
        item.role,
        item.userType,
        item.accountType,
        item.type,
        profile.role,
        settings.role
      );

      const firstName = readFirstString(item.firstName, profile.firstName);
      const lastName = readFirstString(item.lastName, profile.lastName);
      const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ");

      const barangay = readFirstString(
        item.barangay,
        item.brgy,
        item.barangayName,
        item.selectedBarangay,
        location.barangay,
        location.brgy,
        location.barangayName,
        address.barangay,
        address.brgy,
        settings.barangay,
        settings.brgy,
        profile.barangay,
        residentInfo.barangay,
        notificationSettings.barangay,
        preferences.barangay
      );

      const purok = readFirstString(
        item.purok,
        item.prk,
        item.purokName,
        item.selectedPurok,
        location.purok,
        location.prk,
        location.purokName,
        address.purok,
        address.prk,
        settings.purok,
        settings.prk,
        profile.purok,
        residentInfo.purok,
        notificationSettings.purok,
        preferences.purok
      );

      const tokenMap = toRecord(item.fcmTokens || item.tokens || item.deviceTokens);
      const firstTokenFromMap = readFirstString(...Object.values(tokenMap));

      return {
        uid: readFirstString(item.uid, profile.uid) || uid,
        name:
          readFirstString(
            item.name,
            item.fullName,
            item.displayName,
            item.username,
            profile.name,
            profile.fullName,
            residentInfo.name,
            fullNameFromParts
          ) || "Resident",
        barangay,
        purok,
        fcmToken:
          readFirstString(
            item.fcmToken,
            item.token,
            item.deviceToken,
            item.notificationToken,
            item.messagingToken,
            settings.fcmToken,
            notificationSettings.fcmToken,
            preferences.fcmToken,
            firstTokenFromMap
          ),
        role,
      };
    })
    .filter((resident) => {
      if (!resident.uid) return false;

      const role = normalize(resident.role);

      // If your users node has roles, only residents are included.
      // If no role is saved, it is still allowed for compatibility.
      return (
        !role ||
        role.includes("resident") ||
        role === "user" ||
        role === "homeowner"
      );
    });
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [residentRows, setResidentRows] = useState<ResidentRow[]>([]);
  const [userRows, setUserRows] = useState<ResidentRow[]>([]);
  const [extraResidentRows, setExtraResidentRows] = useState<ResidentRow[]>([]);
  const [serviceRegistry, setServiceRegistry] = useState<Record<string, ServiceBarangay>>({});

  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showAdvisory, setShowAdvisory] = useState(false);
  const [tab, setTab] = useState<TabType>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [quickNotice, setQuickNotice] = useState<NoticeForm>(EMPTY_NOTICE);
  const [modalNotice, setModalNotice] = useState<NoticeForm>(EMPTY_NOTICE);
  const [manualLocationEdit, setManualLocationEdit] = useState(false);

  const [sendingQuick, setSendingQuick] = useState(false);
  const [sendingModal, setSendingModal] = useState(false);
  const [quickResult, setQuickResult] = useState("");
  const [modalResult, setModalResult] = useState("");

  useEffect(() => {
    const issuesRef = ref(db, "issues");

    const unsubscribe = onValue(
      issuesRef,
      (snapshot) => {
        const value = snapshot.val();

        if (!value || typeof value !== "object") {
          setIssues([]);
          setLoading(false);
          return;
        }

        const rows: IssueRow[] = Object.entries(
          value as Record<string, unknown>
        ).map(([id, raw]) => {
          const item =
            raw && typeof raw === "object"
              ? (raw as Record<string, unknown>)
              : {};

          const source = readString(item.source) || "resident";

          return {
            id,
            uid: readString(item.uid),
            source,
            driverName: readString(item.driverName),
            residentName: readString(item.residentName),
            routeName: readString(item.routeName),
            issueType: readString(item.issueType) || "Issue Report",
            details: readString(item.details) || "No details",
            barangay: readString(item.barangay),
            purok: readString(item.purok),
            status: readString(item.status) || "Open",
            timestamp: readNumber(item.timestamp),
            updatedAt: readNumber(item.updatedAt),
            resolvedAt: readNumber(item.resolvedAt),
            photoBase64: readString(item.photoBase64),
            adminTitle: readString(item.adminTitle),
            adminMessage: readString(item.adminMessage),
            lastNotifiedAt: readNumber(item.lastNotifiedAt),
          };
        });

        rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        setIssues(rows);
        setLoading(false);
        setErrorMessage("");
      },
      (error) => {
        console.error(error);
        setLoading(false);
        setErrorMessage("Unable to load reports. Please check Firebase rules.");
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const residentsRef = ref(db, "residents");

    const unsubscribe = onValue(residentsRef, (snapshot) => {
      setResidentRows(snapshotToResidents(snapshot.val()));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const usersRef = ref(db, "users");

    const unsubscribe = onValue(usersRef, (snapshot) => {
      setUserRows(snapshotToResidents(snapshot.val()));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => onValue(ref(db, "service_areas"), (snapshot) => {
    setServiceRegistry(snapshot.val() || {});
  }), []);

  const availableBarangays = useMemo(() => Object.entries(serviceRegistry)
    .filter(([, record]) => record.active !== false)
    .filter(([, record]) => Object.values(record.puroks || {}).some((purok) =>
      purok.active !== false))
    .map(([key, record]) => findOfficialBarangay(record.barangay || key)?.name || record.barangay || key)
    .sort((left, right) => left.localeCompare(right)), [serviceRegistry]);

  useEffect(() => {
    const paths = [
      "residentProfiles",
      "resident_profiles",
      "residentSettings",
      "resident_settings",
      "resident_accounts",
      "accounts",
      "profiles",
      "settings",
      "userSettings",
      "user_settings",
    ];

    const cache: Record<string, ResidentRow[]> = {};

    const refresh = () => {
      const map = new Map<string, ResidentRow>();

      Object.values(cache)
        .flat()
        .forEach((resident) => {
          if (!resident.uid) return;

          const existing = map.get(resident.uid);

          map.set(resident.uid, {
            uid: resident.uid,
            name: resident.name || existing?.name || "Resident",
            barangay: resident.barangay || existing?.barangay || "",
            purok: resident.purok || existing?.purok || "",
            fcmToken: resident.fcmToken || existing?.fcmToken || "",
            role: resident.role || existing?.role || "resident",
          });
        });

      setExtraResidentRows(Array.from(map.values()));
    };

    const unsubscribers = paths.map((path) =>
      onValue(ref(db, path), (snapshot) => {
        cache[path] = snapshotToResidents(snapshot.val());
        refresh();
      })
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const residents = useMemo(() => {
    const map = new Map<string, ResidentRow>();

    [...userRows, ...residentRows, ...extraResidentRows].forEach((resident) => {
      if (!resident.uid) return;

      const existing = map.get(resident.uid);

      map.set(resident.uid, {
        uid: resident.uid,
        name: resident.name || existing?.name || "Resident",
        barangay: resident.barangay || existing?.barangay || "",
        purok: resident.purok || existing?.purok || "",
        fcmToken: resident.fcmToken || existing?.fcmToken || "",
        role: resident.role || existing?.role || "resident",
      });
    });

    return Array.from(map.values());
  }, [residentRows, userRows, extraResidentRows]);

  const residentsByUid = useMemo(() => {
    const map = new Map<string, ResidentRow>();

    residents.forEach((resident) => {
      map.set(resident.uid, resident);
    });

    return map;
  }, [residents]);

  const getResidentProfileForIssue = (issue: IssueRow): ResidentRow | undefined => {
    if (issue.uid) {
      const byUid = residentsByUid.get(issue.uid);
      if (byUid) return byUid;
    }

    const issueResidentName = normalize(issue.residentName);

    if (issueResidentName) {
      return residents.find(
        (resident) => normalize(resident.name) === issueResidentName
      );
    }

    return undefined;
  };

  const getIssueBarangay = (issue: IssueRow): string => {
    if (issue.barangay) return issue.barangay;

    const residentProfile = getResidentProfileForIssue(issue);
    return residentProfile?.barangay || "";
  };

  const getIssuePurok = (issue: IssueRow): string => {
    if (issue.purok) return issue.purok;

    const residentProfile = getResidentProfileForIssue(issue);
    return residentProfile?.purok || "";
  };

  const getReporterName = (issue: IssueRow): string => {
    if (issue.source === "driver") {
      return issue.driverName || "Driver";
    }

    if (issue.residentName) return issue.residentName;

    const residentProfile = getResidentProfileForIssue(issue);
    if (residentProfile?.name) return residentProfile.name;

    return "Resident";
  };

  const getLocationText = (issue: IssueRow): string => {
    const barangay = getIssueBarangay(issue);
    const purok = getIssuePurok(issue);

    if (barangay && purok) return `${barangay} / ${purok}`;
    if (barangay) return barangay;
    if (purok) return purok;

    return "No location saved";
  };

  const filtered = useMemo(() => {
    const keyword = normalize(search);

    return issues.filter((issue) => {
      const issueStatus = issue.status || "Open";
      const barangay = getIssueBarangay(issue);
      const purok = getIssuePurok(issue);
      const reporter = getReporterName(issue);

      const matchesTab = tab === "all" ? true : issue.source === tab;
      const matchesStatus =
        statusFilter === "all" ? true : issueStatus === statusFilter;

      const searchableText = normalize(
        [
          issue.source,
          reporter,
          issue.driverName,
          issue.residentName,
          issue.routeName,
          issue.issueType,
          issue.details,
          barangay,
          purok,
          issueStatus,
        ].join(" ")
      );

      const matchesSearch = keyword ? searchableText.includes(keyword) : true;

      return matchesTab && matchesStatus && matchesSearch;
    });
  }, [issues, search, statusFilter, tab, residentsByUid]);

  const counts = useMemo(() => {
    return issues.reduce(
      (acc, issue) => {
        const status = issue.status || "Open";

        acc.total += 1;

        if (issue.source === "driver") acc.driver += 1;
        if (issue.source === "resident") acc.resident += 1;

        if (status === "Resolved") acc.resolved += 1;
        else if (status === "In Progress") acc.inProgress += 1;
        else acc.open += 1;

        return acc;
      },
      {
        total: 0,
        open: 0,
        inProgress: 0,
        resolved: 0,
        driver: 0,
        resident: 0,
      }
    );
  }, [issues]);

  const locationOptions = useMemo(() => {
    const puroks = new Set<string>();

    residents.forEach((resident) => {
      if (resident.purok) puroks.add(resident.purok);
    });

    issues.forEach((issue) => {
      const purok = getIssuePurok(issue);
      if (purok) puroks.add(purok);
    });
    Object.values(serviceRegistry).forEach((barangay) => {
      Object.values(barangay.puroks || {}).forEach((purok) => {
        if (purok.active !== false && purok.purok) puroks.add(purok.purok);
      });
    });

    return {
      barangays: availableBarangays,
      puroks: Array.from(puroks).sort(),
    };
  }, [availableBarangays, issues, residents, residentsByUid, serviceRegistry]);

  const getLocationMatchedResidents = (
    barangay: string,
    purok: string
  ): ResidentRow[] => {
    const targetBarangay = barangayKey(barangay);
    const targetPurok = purokKey(purok);
    const map = new Map<string, ResidentRow>();

    residents.forEach((resident) => {
      const residentBarangay = barangayKey(resident.barangay);
      const residentPurok = purokKey(resident.purok);

      const barangayMatch = targetBarangay
        ? residentBarangay === targetBarangay
        : false;

      const purokMatch = targetPurok ? residentPurok === targetPurok : true;

      if (barangayMatch && purokMatch) {
        map.set(resident.uid, resident);
      }
    });

    return Array.from(map.values());
  };

  const getTargetResidents = (
    barangay: string,
    purok: string,
    issue?: IssueRow | null
  ): ResidentRow[] => {
    const map = new Map<string, ResidentRow>();

    if (issue?.source === "resident") {
      const residentProfile = getResidentProfileForIssue(issue);

      if (residentProfile?.uid) {
        map.set(residentProfile.uid, {
          ...residentProfile,
          name: residentProfile.name || getReporterName(issue),
          barangay: barangay || residentProfile.barangay || getIssueBarangay(issue),
          purok: purok || residentProfile.purok || getIssuePurok(issue),
          role: residentProfile.role || "resident",
        });
      } else if (issue.uid) {
        map.set(issue.uid, {
          uid: issue.uid,
          name: getReporterName(issue),
          barangay: barangay || getIssueBarangay(issue),
          purok: purok || getIssuePurok(issue),
          role: "resident",
        });
      }

      // Compatibility fallback for old resident reports with no uid saved.
      // This sends to residents matching the saved barangay/purok only when no exact complainant account is found.
      if (map.size === 0) {
        getLocationMatchedResidents(barangay, purok).forEach((resident) => {
          map.set(resident.uid, resident);
        });
      }

      return Array.from(map.values());
    }

    getLocationMatchedResidents(barangay, purok).forEach((resident) => {
      map.set(resident.uid, resident);
    });

    return Array.from(map.values());
  };

  const writeResidentNotice = async (
    form: NoticeForm,
    issue?: IssueRow | null
  ) => {
    const barangay = form.barangay.trim() || (issue ? getIssueBarangay(issue) : "");
    const purok = form.purok.trim() || (issue ? getIssuePurok(issue) : "");
    const title = form.title.trim();
    const message = form.message.trim();

    if (!title) throw new Error("Please enter a notification title.");
    if (!message) throw new Error("Please enter a message.");

    if (!isAllowedBarangay(barangay, availableBarangays)) {
      throw new Error(
        "Please select an active MetroWaste Barangay from Service Areas."
      );
    }

    const targetResidents = getTargetResidents(barangay, purok, issue);
    const targetUids = targetResidents.map((resident) => resident.uid);

    if (targetResidents.length === 0) {
      const savedLocations = residents
        .filter((resident) => resident.barangay || resident.purok)
        .slice(0, 5)
        .map(
          (resident) =>
            `${resident.name || resident.uid}: ${resident.barangay || "-"} / ${
              resident.purok || "-"
            }`
        )
        .join("; ");

      throw new Error(
        savedLocations
          ? `No matching resident found for ${barangay} / ${
              purok || "All Puroks"
            }. Saved resident locations found: ${savedLocations}`
          : "No matching resident found because no resident account with saved barangay and purok was loaded from Firebase."
      );
    }

    const timestamp = Date.now();
    const notificationRef = push(ref(db, "notifications"));
    const notificationId = notificationRef.key || String(timestamp);

    const isResidentReply = issue?.source === "resident";

    const payload = {
      id: notificationId,
      source: "admin",
      type: isResidentReply
        ? "admin_complaint_update"
        : "admin_barangay_advisory",
      audience: "resident",
      targetRole: "resident",
      targetType: isResidentReply
        ? "specific_resident"
        : purok
        ? "barangay_purok"
        : "barangay",
      barangay,
      purok,
      title,
      message,
      body: message,
      issueId: issue?.id || "",
      issueSource: issue?.source || "",
      issueType: issue?.issueType || "",
      driverName: issue?.driverName || "",
      routeName: issue?.routeName || "",
      read: false,
      status: "Unread",
      targetUids,
      timestamp,
      createdAt: timestamp,
    };

    await set(notificationRef, payload);

    await Promise.all(
      targetResidents.map((resident) =>
        set(ref(db, `residentNotifications/${resident.uid}/${notificationId}`), {
          ...payload,
          uid: resident.uid,
        })
      )
    );

    // Extra copies are saved by location so resident apps that listen by barangay/purok
    // can also receive the notice even if they do not read residentNotifications/{uid}.
    const safeBarangayKey = barangayKey(barangay) || "unknown";
    const safePurokKey = purokKey(purok).replace(/\s+/g, "_") || "all_puroks";

    await set(
      ref(
        db,
        `residentLocationNotifications/${safeBarangayKey}/${safePurokKey}/${notificationId}`
      ),
      payload
    );

    // Realtime Database stores the resident's inbox/history. A real phone
    // notification (sound, vibration, lock-screen alert) must still be sent
    // through Firebase Cloud Messaging. Resident complaint replies target the
    // exact complainant UID(s); general advisories continue to use area targeting.
    const currentAdmin = auth.currentUser;
    if (!currentAdmin) {
      throw new Error(
        "Reply was saved, but your Admin session expired before the phone alert could be sent. Please sign in again and resend."
      );
    }

    const adminToken = await currentAdmin.getIdToken();
    const pushRequest = {
      title,
      message,
      body: message,
      type: payload.type,
      target: "resident",
      barangay,
      purok,
      issueId: issue?.id || "",
      ...(isResidentReply ? { targetUids } : {}),
    };

    const pushResponse = await fetch("/api/send-alert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(pushRequest),
    });

    let pushResult: {
      sent?: number;
      failed?: number;
      warning?: string;
      error?: string;
    } = {};

    try {
      pushResult = await pushResponse.json();
    } catch {
      pushResult = {};
    }

    if (!pushResponse.ok) {
      throw new Error(
        pushResult.error ||
          "Reply was saved, but the resident phone notification could not be sent."
      );
    }

    const pushSent = Number(pushResult.sent || 0);
    const pushFailed = Number(pushResult.failed || 0);
    const pushWarning = String(pushResult.warning || "").trim();

    if (issue?.id) {
      const nextStatus =
        issue.status === "Resolved" ? "Resolved" : "In Progress";

      await update(ref(db, `issues/${issue.id}`), {
        barangay,
        purok,
        adminTitle: title,
        adminMessage: message,
        lastNotifiedAt: timestamp,
        updatedAt: timestamp,
        status: nextStatus,
      });

      setSelected((current) =>
        current?.id === issue.id
          ? {
              ...current,
              barangay,
              purok,
              adminTitle: title,
              adminMessage: message,
              lastNotifiedAt: timestamp,
              updatedAt: timestamp,
              status: nextStatus,
            }
          : current
      );
    }

    return {
      notificationId,
      targetCount: targetResidents.length,
      pushSent,
      pushFailed,
      pushWarning,
    };
  };

  const handleQuickSend = async () => {
    setSendingQuick(true);
    setQuickResult("");

    try {
      const result = await writeResidentNotice(quickNotice, null);

      setQuickResult(
        result.pushSent > 0
          ? `Notice saved and phone alert sent to ${result.pushSent} device${result.pushSent === 1 ? "" : "s"}.`
          : `Notice saved, but no registered phone received the push.${result.pushWarning ? ` ${result.pushWarning}` : ""}`
      );

      setQuickNotice(EMPTY_NOTICE);
    } catch (error) {
      setQuickResult(
        error instanceof Error ? error.message : "Failed to send notice."
      );
    } finally {
      setSendingQuick(false);
    }
  };

  const handleModalSend = async () => {
    if (!selected) return;

    setSendingModal(true);
    setModalResult("");

    try {
      const result = await writeResidentNotice(modalNotice, selected);

      setModalResult(
        result.pushSent > 0
          ? `Reply saved and phone notification sent with sound to ${result.pushSent} registered device${result.pushSent === 1 ? "" : "s"}.`
          : `Reply saved, but no registered resident phone received the push.${result.pushWarning ? ` ${result.pushWarning}` : ""}`
      );
    } catch (error) {
      setModalResult(
        error instanceof Error ? error.message : "Failed to send notice."
      );
    } finally {
      setSendingModal(false);
    }
  };

  const changeStatus = async (issue: IssueRow, status: string) => {
    const timestamp = Date.now();

    const firebasePatch: {
      status: string;
      updatedAt: number;
      resolvedAt?: number | null;
    } = {
      status,
      updatedAt: timestamp,
    };

    const statePatch: Partial<IssueRow> = {
      status,
      updatedAt: timestamp,
    };

    if (status === "Resolved") {
      firebasePatch.resolvedAt = timestamp;
      statePatch.resolvedAt = timestamp;
    }

    if (status === "Open" || status === "In Progress") {
      firebasePatch.resolvedAt = null;
      statePatch.resolvedAt = undefined;
    }

    await update(ref(db, `issues/${issue.id}`), firebasePatch);

    setSelected((current) =>
      current?.id === issue.id ? { ...current, ...statePatch } : current
    );
  };

  const deleteIssue = async (issue: IssueRow) => {
    const confirmed = window.confirm(
      `Delete this ${issue.source || "issue"} report?`
    );

    if (!confirmed) return;

    await remove(ref(db, `issues/${issue.id}`));

    if (selected?.id === issue.id) {
      setSelected(null);
    }
  };

  const openIssue = (issue: IssueRow) => {
    const barangay = getIssueBarangay(issue);
    const purok = getIssuePurok(issue);
    const location = [barangay, purok].filter(Boolean).join(" / ");
    const issueType = issue.issueType || "collection issue";

    const title =
      issue.source === "driver"
        ? "Collection Advisory"
        : "Report Status Update";

    const message =
      issue.source === "driver"
        ? `A collection issue was reported by our driver${
            location ? ` in ${location}` : ""
          }. Issue: ${issueType}. Please be guided and wait for further update from the waste management office.`
        : `Your report about ${issueType} has been received by the waste management office. We are now reviewing the concern and will update you once action has been taken.`;

    setSelected({
      ...issue,
      barangay,
      purok,
    });

    setModalNotice({
      barangay,
      purok,
      title,
      message,
    });

    setManualLocationEdit(false);
    setModalResult("");
  };


  const sourceLabel = (issue: IssueRow) =>
    issue.source === "driver" ? "Driver report" : "Resident complaint";

  const statusClass = (status?: string) => {
    const value = normalize(status || "Open").replace(/\s+/g, "-");
    if (value === "resolved") return styles.statusResolved;
    if (value === "in-progress") return styles.statusProgress;
    return styles.statusOpen;
  };

  const closeSelectedIssue = () => {
    setSelected(null);
    setShowFullImage(false);
    setManualLocationEdit(false);
    setModalResult("");
  };

  return (
    <DashboardShell
      title="Complaints & Reports"
      description="Review resident concerns and driver field reports, record action taken, and keep affected residents informed."
    >
      <div className={styles.page}>
        {errorMessage && (
          <div className={styles.errorBanner} role="alert">
            <strong>Reports could not be refreshed.</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {!selected ? (
          <>
            <section className={styles.summaryStrip} aria-label="Report summary">
              <div className={styles.summaryPrimary}>
                <span className={styles.summaryLabel}>Open reports</span>
                <strong>{counts.open}</strong>
                <small>Require review or action</small>
              </div>
              <div className={styles.summaryItem}>
                <span>In progress</span>
                <strong>{counts.inProgress}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Resolved</span>
                <strong>{counts.resolved}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Total records</span>
                <strong>{counts.total}</strong>
              </div>
              <div className={styles.summarySources}>
                <span>{counts.resident} resident</span>
                <span>{counts.driver} driver</span>
              </div>
            </section>

            <section className={styles.registryCard}>
              <div className={styles.registryHeader}>
                <div>
                  <p className={styles.eyebrow}>REPORT REGISTRY</p>
                  <h2>Issues requiring administrative review</h2>
                  <p>
                    Open a report to review evidence, update its status, and send the correct resident notice.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => {
                    setQuickResult("");
                    setShowAdvisory(true);
                  }}
                >
                  + New resident advisory
                </button>
              </div>

              <div className={styles.toolbar}>
                <div className={styles.segmentedControl} aria-label="Report source">
                  {[
                    { label: `All ${counts.total}`, value: "all" },
                    { label: `Residents ${counts.resident}`, value: "resident" },
                    { label: `Drivers ${counts.driver}`, value: "driver" },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      className={tab === item.value ? styles.segmentActive : styles.segment}
                      onClick={() => setTab(item.value as TabType)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className={styles.filterGroup}>
                  <label className={styles.searchBox}>
                    <span>Search</span>
                    <input
                      value={search}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                      placeholder="Reporter, issue, location, route..."
                    />
                  </label>

                  <label className={styles.selectBox}>
                    <span>Status</span>
                    <select
                      value={statusFilter}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        setStatusFilter(event.target.value as StatusFilter)
                      }
                    >
                      <option value="all">All statuses</option>
                      <option value="Open">Open</option>
                      <option value="In Progress">In progress</option>
                      <option value="Resolved">Resolved</option>
                    </select>
                  </label>
                </div>
              </div>

              {loading ? (
                <div className={styles.emptyState}>
                  <div className={styles.spinner} />
                  <strong>Loading reports</strong>
                  <span>Retrieving the latest complaint and driver-report records.</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>✓</div>
                  <strong>No matching reports</strong>
                  <span>Try another source, status, or search term.</span>
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.issueTable}>
                    <thead>
                      <tr>
                        <th>Report</th>
                        <th>Reporter</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>Received</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((issue) => {
                        const reporter = getReporterName(issue);
                        const details = displayText(issue.details, "No description supplied");
                        const location = getLocationText(issue);
                        const route = cleanText(issue.routeName);
                        const status = displayText(issue.status, "Open");

                        return (
                          <tr key={issue.id} onDoubleClick={() => openIssue(issue)}>
                            <td>
                              <div className={styles.reportCell}>
                                <div
                                  className={`${styles.sourceIcon} ${
                                    issue.source === "driver" ? styles.driverIcon : styles.residentIcon
                                  }`}
                                  aria-hidden="true"
                                >
                                  {issue.source === "driver" ? "D" : "R"}
                                </div>
                                <div>
                                  <div className={styles.reportTitleRow}>
                                    <strong>{displayText(issue.issueType, "General issue")}</strong>
                                    <span>{sourceLabel(issue)}</span>
                                  </div>
                                  <p>{details}</p>
                                  {route && <small>Route: {route}</small>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className={styles.reporterCell}>
                                <strong>{displayText(reporter, "Unknown reporter")}</strong>
                                <span>{issue.source === "driver" ? "Driver" : "Resident"}</span>
                              </div>
                            </td>
                            <td>
                              <span className={styles.locationText}>{displayText(location, "No location saved")}</span>
                            </td>
                            <td>
                              <span className={`${styles.statusBadge} ${statusClass(status)}`}>
                                {status}
                              </span>
                            </td>
                            <td>
                              <span className={styles.dateText}>{formatDate(issue.timestamp)}</span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={styles.reviewButton}
                                onClick={() => openIssue(issue)}
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!loading && filtered.length > 0 && (
                <div className={styles.tableFooter}>
                  Showing <strong>{filtered.length}</strong> of <strong>{counts.total}</strong> report records
                </div>
              )}
            </section>
          </>
        ) : (
          <section className={styles.detailWorkspace}>
            <div className={styles.detailTopbar}>
              <button type="button" className={styles.backButton} onClick={closeSelectedIssue}>
                ← Reports
              </button>
              <div className={styles.detailTopbarText}>
                <span>{sourceLabel(selected)}</span>
                <strong>Report #{selected.id.slice(-8).toUpperCase()}</strong>
              </div>
              <span className={`${styles.statusBadge} ${statusClass(selected.status)}`}>
                {displayText(selected.status, "Open")}
              </span>
            </div>

            <div className={styles.detailHeading}>
              <div>
                <p className={styles.eyebrow}>REPORT REVIEW</p>
                <h2>{displayText(selected.issueType, "General issue")}</h2>
                <p>
                  Submitted by <strong>{displayText(getReporterName(selected), "Unknown reporter")}</strong>
                  <span className={styles.dot}>•</span>
                  {formatDate(selected.timestamp)}
                  <span className={styles.dot}>•</span>
                  {displayText(getLocationText(selected), "No location saved")}
                </p>
              </div>
            </div>

            <div className={styles.detailGrid}>
              <div className={styles.detailMain}>
                <article className={styles.officeCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span className={styles.cardKicker}>ORIGINAL REPORT</span>
                      <h3>Concern submitted to MetroWaste</h3>
                    </div>
                    <span className={styles.sourcePill}>{sourceLabel(selected)}</span>
                  </div>

                  <p className={styles.reportNarrative}>
                    {displayText(selected.details, "The reporter did not provide additional details.")}
                  </p>

                  <dl className={styles.factGrid}>
                    <div>
                      <dt>Reporter</dt>
                      <dd>{displayText(getReporterName(selected), "Unknown reporter")}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{selected.source === "driver" ? "Driver application" : "Resident application"}</dd>
                    </div>
                    <div>
                      <dt>Barangay</dt>
                      <dd>{displayText(getIssueBarangay(selected))}</dd>
                    </div>
                    <div>
                      <dt>Purok</dt>
                      <dd>{displayText(getIssuePurok(selected))}</dd>
                    </div>
                    <div>
                      <dt>Route</dt>
                      <dd>{displayText(selected.routeName, "Not assigned")}</dd>
                    </div>
                    <div>
                      <dt>Last updated</dt>
                      <dd>{formatDate(selected.updatedAt || selected.timestamp)}</dd>
                    </div>
                  </dl>

                  {selected.photoBase64 && (
                    <div className={styles.evidenceBlock}>
                      <div className={styles.evidenceHeader}>
                        <div>
                          <span>PHOTO EVIDENCE</span>
                          <strong>Attachment submitted with this report</strong>
                        </div>
                        <button type="button" onClick={() => setShowFullImage(true)}>
                          View full image
                        </button>
                      </div>
                      <button
                        type="button"
                        className={styles.evidencePreview}
                        onClick={() => setShowFullImage(true)}
                        aria-label="Open full complaint image"
                      >
                        <img src={getPhotoSrc(selected.photoBase64)} alt="Issue evidence" />
                      </button>
                    </div>
                  )}
                </article>

                <article className={styles.officeCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span className={styles.cardKicker}>CASE ACTIVITY</span>
                      <h3>Administrative record</h3>
                    </div>
                  </div>

                  <div className={styles.timeline}>
                    <div className={styles.timelineItem}>
                      <span className={styles.timelineDot} />
                      <div>
                        <strong>Report received</strong>
                        <p>{formatDate(selected.timestamp)}</p>
                      </div>
                    </div>
                    {selected.updatedAt && selected.updatedAt !== selected.timestamp && (
                      <div className={styles.timelineItem}>
                        <span className={styles.timelineDot} />
                        <div>
                          <strong>Case updated</strong>
                          <p>{formatDate(selected.updatedAt)}</p>
                        </div>
                      </div>
                    )}
                    {selected.lastNotifiedAt && (
                      <div className={styles.timelineItem}>
                        <span className={styles.timelineDot} />
                        <div>
                          <strong>Resident notification sent</strong>
                          <p>{formatDate(selected.lastNotifiedAt)}</p>
                        </div>
                      </div>
                    )}
                    {selected.resolvedAt && (
                      <div className={styles.timelineItem}>
                        <span className={`${styles.timelineDot} ${styles.timelineDone}`} />
                        <div>
                          <strong>Report resolved</strong>
                          <p>{formatDate(selected.resolvedAt)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              </div>

              <aside className={styles.detailSidebar}>
                <section className={styles.officeCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span className={styles.cardKicker}>CASE STATUS</span>
                      <h3>Administrative action</h3>
                    </div>
                  </div>

                  <div className={styles.statusActions}>
                    <button
                      type="button"
                      className={displayText(selected.status, "Open") === "Open" ? styles.statusActionActive : styles.statusAction}
                      onClick={() => changeStatus(selected, "Open")}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className={displayText(selected.status, "Open") === "In Progress" ? styles.statusActionActive : styles.statusAction}
                      onClick={() => changeStatus(selected, "In Progress")}
                    >
                      In progress
                    </button>
                    <button
                      type="button"
                      className={displayText(selected.status, "Open") === "Resolved" ? styles.statusActionActive : styles.statusAction}
                      onClick={() => changeStatus(selected, "Resolved")}
                    >
                      Resolved
                    </button>
                  </div>

                  <div className={styles.caseMeta}>
                    <div>
                      <span>Current status</span>
                      <strong>{displayText(selected.status, "Open")}</strong>
                    </div>
                    <div>
                      <span>Report ID</span>
                      <strong>{selected.id.slice(-12)}</strong>
                    </div>
                  </div>
                </section>

                <section className={styles.officeCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span className={styles.cardKicker}>RESIDENT UPDATE</span>
                      <h3>
                        {selected.source === "resident" ? "Reply to complainant" : "Notify affected residents"}
                      </h3>
                    </div>
                    <span className={styles.targetCount}>
                      {getTargetResidents(modalNotice.barangay, modalNotice.purok, selected).length} target
                    </span>
                  </div>

                  <div className={styles.targetBox}>
                    <div className={styles.targetBoxHeader}>
                      <div>
                        <span>Target location</span>
                        <strong>
                          {[modalNotice.barangay, modalNotice.purok].filter(Boolean).join(" / ") || "Not configured"}
                        </strong>
                      </div>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setManualLocationEdit((value) => !value)}
                      >
                        {manualLocationEdit ? "Use saved location" : "Edit"}
                      </button>
                    </div>

                    {manualLocationEdit && (
                      <div className={styles.twoColumnFields}>
                        <label className={styles.field}>
                          <span>Barangay</span>
                          <input
                            list="barangayOptions"
                            value={modalNotice.barangay}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setModalNotice((current) => ({ ...current, barangay: event.target.value }))
                            }
                            placeholder="Barangay"
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Purok</span>
                          <input
                            list="purokOptions"
                            value={modalNotice.purok}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setModalNotice((current) => ({ ...current, purok: event.target.value }))
                            }
                            placeholder="Optional"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <label className={styles.field}>
                    <span>Notification title</span>
                    <input
                      value={modalNotice.title}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setModalNotice((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="Report status update"
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Message</span>
                    <textarea
                      value={modalNotice.message}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setModalNotice((current) => ({ ...current, message: event.target.value }))
                      }
                      rows={7}
                      placeholder="Write a clear update for the resident..."
                    />
                  </label>

                  <button
                    type="button"
                    className={styles.primaryButtonWide}
                    onClick={handleModalSend}
                    disabled={sendingModal}
                  >
                    {sendingModal ? "Sending notification..." : "Send resident update"}
                  </button>

                  {modalResult && <div className={styles.resultBox}>{modalResult}</div>}
                </section>

                <section className={`${styles.officeCard} ${styles.dangerCard}`}>
                  <div>
                    <span className={styles.cardKicker}>RECORD CONTROL</span>
                    <h3>Delete report</h3>
                    <p>Delete only duplicate or invalid records. This action cannot be undone.</p>
                  </div>
                  <button type="button" className={styles.deleteButton} onClick={() => deleteIssue(selected)}>
                    Delete report
                  </button>
                </section>
              </aside>
            </div>
          </section>
        )}
      </div>

      {showAdvisory && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setShowAdvisory(false)}>
          <section
            className={styles.advisoryModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="advisory-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>RESIDENT COMMUNICATION</p>
                <h2 id="advisory-title">New resident advisory</h2>
                <p>Send an operational notice to residents in one active service area.</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setShowAdvisory(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.twoColumnFields}>
                <label className={styles.field}>
                  <span>Barangay</span>
                  <input
                    list="barangayOptions"
                    value={quickNotice.barangay}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setQuickNotice((current) => ({ ...current, barangay: event.target.value }))
                    }
                    placeholder="Select barangay"
                  />
                </label>
                <label className={styles.field}>
                  <span>Purok <em>optional</em></span>
                  <input
                    list="purokOptions"
                    value={quickNotice.purok}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setQuickNotice((current) => ({ ...current, purok: event.target.value }))
                    }
                    placeholder="All puroks"
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>Notification title</span>
                <input
                  value={quickNotice.title}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setQuickNotice((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Example: Collection advisory"
                />
              </label>

              <label className={styles.field}>
                <span>Message</span>
                <textarea
                  value={quickNotice.message}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setQuickNotice((current) => ({ ...current, message: event.target.value }))
                  }
                  rows={6}
                  placeholder="Write the notice residents will receive..."
                />
              </label>

              {quickResult && <div className={styles.resultBox}>{quickResult}</div>}
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setShowAdvisory(false)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleQuickSend} disabled={sendingQuick}>
                {sendingQuick ? "Sending..." : "Send advisory"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showFullImage && selected?.photoBase64 && (
        <div className={styles.imageBackdrop} role="presentation" onClick={() => setShowFullImage(false)}>
          <div className={styles.imageModal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.imageModalHeader}>
              <div>
                <strong>Photo evidence</strong>
                <span>{displayText(selected.issueType, "Issue report")}</span>
              </div>
              <button type="button" onClick={() => setShowFullImage(false)} aria-label="Close image">×</button>
            </div>
            <img src={getPhotoSrc(selected.photoBase64)} alt="Issue evidence full size" />
          </div>
        </div>
      )}

      <datalist id="barangayOptions">
        {locationOptions.barangays.map((barangay) => (
          <option key={barangay} value={barangay} />
        ))}
      </datalist>
      <datalist id="purokOptions">
        {locationOptions.puroks.map((purok) => (
          <option key={purok} value={purok} />
        ))}
      </datalist>
    </DashboardShell>
  );
}
