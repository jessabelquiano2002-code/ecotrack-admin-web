"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { onValue, push, ref, remove, set, update } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { SectionCard } from "../components/SectionCard";

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

const ALLOWED_BARANGAYS = [
  "Mercedes",
  "Maulong",
  "San Andres",
  "Poblacion 13",
  "Canlapwas",
];


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
  return (value || "")
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .replace(/^"+|"+$/g, "")
    .trim();
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
  return locationKey(value).replace(/^barangay\s+/, "").trim();
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

function isAllowedBarangay(value?: string): boolean {
  const key = barangayKey(value);
  return ALLOWED_BARANGAYS.some((barangay) => barangayKey(barangay) === key);
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

  const [selected, setSelected] = useState<IssueRow | null>(null);
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

    return {
      barangays: ALLOWED_BARANGAYS,
      puroks: Array.from(puroks).sort(),
    };
  }, [issues, residents, residentsByUid]);

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

    if (!isAllowedBarangay(barangay)) {
      throw new Error(
        "Please select one of the supported barangays: Mercedes, Maulong, San Andres, Poblacion 13, or Canlapwas."
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
    };
  };

  const handleQuickSend = async () => {
    setSendingQuick(true);
    setQuickResult("");

    try {
      const result = await writeResidentNotice(quickNotice, null);

      setQuickResult(
        `Notice sent/saved successfully. Matched residents: ${result.targetCount}.`
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
        `Notice sent/saved successfully. Matched residents: ${result.targetCount}.`
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


  if (selected) {
    const selectedReporter = getReporterName(selected);
    const selectedStatus = selected.status || "Open";
    const selectedTargetCount = getTargetResidents(
      modalNotice.barangay,
      modalNotice.purok,
      selected
    ).length;

    return (
      <>
        <div className="complaintOnlyPage">
          <div className="complaintTopBar">
            <button className="backButton" onClick={() => setSelected(null)}>
              ← Back to reports
            </button>

            <div className="complaintTopActions">
              <button onClick={() => changeStatus(selected, "Open")}>Open</button>
              <button onClick={() => changeStatus(selected, "In Progress")}>
                In Progress
              </button>
              <button onClick={() => changeStatus(selected, "Resolved")}>
                Resolve
              </button>
              <button className="deleteTopButton" onClick={() => deleteIssue(selected)}>
                Delete
              </button>
              <button className="roundCloseButton" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
          </div>

          <section className="complaintHeaderCard">
            <div>
              <p className="complaintKicker">
                {selected.source === "driver" ? "Driver Report" : "Resident Complaint"}
              </p>
              <h1>{selected.issueType || "Issue Details"}</h1>
              <p className="complaintMeta">
                From: <strong>{selectedReporter}</strong>
                <span>·</span>
                {formatDate(selected.timestamp)}
                <span>·</span>
                {getLocationText(selected)}
              </p>
            </div>

            <span
              className={`openedStatusBadge ${normalize(selectedStatus).replace(
                /\s+/g,
                "-"
              )}`}
            >
              {selectedStatus}
            </span>
          </section>

          <main className="openedIssueGrid">
            <section className="conversationPanel">
              <div className="messageRow reporterRow">
                <div className="avatarCircle">
                  {selectedReporter.charAt(0).toUpperCase() || "R"}
                </div>

                <div className="messageContent">
                  <div className="messageHeaderLine">
                    <div>
                      <strong>{selectedReporter}</strong>
                      <span>
                        {selected.source === "driver"
                          ? "Driver report sent to admin"
                          : "Resident complaint sent to admin"}
                      </span>
                    </div>
                    <time>{formatDate(selected.timestamp)}</time>
                  </div>

                  <h2>Original complaint</h2>
                  <p className="originalText">{selected.details || "No details"}</p>

                  <div className="compactDetailGrid">
                    <div>
                      <span>Reporter</span>
                      <strong>{selectedReporter}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>
                        {selected.source === "driver" ? "Driver" : "Resident"}
                      </strong>
                    </div>
                    <div>
                      <span>Barangay / Purok</span>
                      <strong>{getLocationText(selected)}</strong>
                    </div>
                    <div>
                      <span>Route</span>
                      <strong>{selected.routeName || "No route saved"}</strong>
                    </div>
                    <div>
                      <span>Last Updated</span>
                      <strong>{formatDate(selected.updatedAt)}</strong>
                    </div>
                    <div>
                      <span>Resolved Date</span>
                      <strong>{formatDate(selected.resolvedAt)}</strong>
                    </div>
                  </div>

                  {selected.photoBase64 && (
                    <div className="openedPhotoBox">
                      <img src={getPhotoSrc(selected.photoBase64)} alt="Complaint attachment" />
                    </div>
                  )}
                </div>
              </div>

              <div className="messageRow adminReplyRow">
                <div className="avatarCircle adminAvatar">A</div>

                <div className="adminReplyBubble">
                  <div className="messageHeaderLine">
                    <div>
                      <strong>Admin reply</strong>
                      <span>{modalNotice.title || "Report Status Update"}</span>
                    </div>
                    <time>{formatDate(selected.lastNotifiedAt || Date.now())}</time>
                  </div>

                  <p>{modalNotice.message}</p>
                </div>
              </div>
            </section>

            <aside className="replyPanelOnly">
              <div className="replyHeader">
                <div>
                  <p>Reply / Notice</p>
                  <h2>Notify affected residents</h2>
                </div>
                <span>{selectedTargetCount} target</span>
              </div>

              <p className="replyDescription">
                This panel works like an email reply. Review the complaint on the left,
                then send a clear update to the correct resident or barangay.
              </p>

              <div className="targetLocationBox">
                <div className="targetLocationHeader">
                  <div>
                    <span>Automatic Target</span>
                    <strong>
                      {selected.source === "resident"
                        ? "Complainant Location"
                        : "Affected Residents Location"}
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="smallEditButton"
                    onClick={() => setManualLocationEdit((current) => !current)}
                  >
                    {manualLocationEdit ? "Lock" : "Edit"}
                  </button>
                </div>

                {!manualLocationEdit ? (
                  <div className="readonlyLocationGrid">
                    <div>
                      <span>Barangay</span>
                      <strong>{modalNotice.barangay || "No barangay saved"}</strong>
                    </div>
                    <div>
                      <span>Purok</span>
                      <strong>{modalNotice.purok || "No purok saved"}</strong>
                    </div>
                    <div className="fullLocation">
                      <span>Send To</span>
                      <strong>
                        {selected.source === "resident"
                          ? selectedReporter
                          : `Residents in ${
                              [modalNotice.barangay, modalNotice.purok]
                                .filter(Boolean)
                                .join(" / ") || "selected location"
                            }`}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="manualLocationGrid">
                    <div className="formGroup">
                      <label>Barangay</label>
                      <input
                        list="barangayOptions"
                        value={modalNotice.barangay}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setModalNotice((current) => ({
                            ...current,
                            barangay: event.target.value,
                          }))
                        }
                        placeholder="Barangay"
                      />
                    </div>

                    <div className="formGroup">
                      <label>Purok</label>
                      <input
                        list="purokOptions"
                        value={modalNotice.purok}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setModalNotice((current) => ({
                            ...current,
                            purok: event.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                )}

                {!modalNotice.barangay && (
                  <p className="locationWarning">
                    Barangay is missing. Edit the target location before sending.
                  </p>
                )}
              </div>

              <div className="formGroup">
                <label>Notification Title</label>
                <input
                  value={modalNotice.title}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setModalNotice((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Notification title"
                />
              </div>

              <div className="formGroup">
                <label>Message</label>
                <textarea
                  value={modalNotice.message}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setModalNotice((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  rows={7}
                  placeholder="Write message to residents..."
                />
              </div>

              <button
                className="primaryButton fullButton"
                onClick={handleModalSend}
                disabled={sendingModal}
              >
                {sendingModal ? "Sending..." : "Send Notice"}
              </button>

              {modalResult && <div className="modalResult">{modalResult}</div>}
            </aside>
          </main>
        </div>

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

        <style jsx>{`
          .complaintOnlyPage {
            min-height: 100vh;
            padding: 10px;
            background: #f5f7fb;
            color: #0f172a;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
              "Segoe UI", sans-serif;
          }

          .complaintTopBar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
          }

          .backButton,
          .complaintTopActions button,
          .smallEditButton {
            border: 1px solid #d8e1ee;
            background: #ffffff;
            color: #0f172a;
            border-radius: 999px;
            padding: 8px 13px;
            font-size: 12px;
            font-weight: 900;
            cursor: pointer;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
          }

          .complaintTopActions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
          }

          .complaintTopActions button:hover,
          .backButton:hover,
          .smallEditButton:hover {
            border-color: #16a34a;
            color: #15803d;
          }

          .deleteTopButton {
            border-color: #fecaca !important;
            color: #dc2626 !important;
          }

          .roundCloseButton {
            width: 34px;
            height: 34px;
            padding: 0 !important;
            font-size: 17px !important;
            line-height: 1;
          }

          .complaintHeaderCard,
          .conversationPanel,
          .replyPanelOnly {
            border: 1px solid #dbe4f0;
            background: #ffffff;
            border-radius: 18px;
            box-shadow: 0 14px 38px rgba(15, 23, 42, 0.06);
          }

          .complaintHeaderCard {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 17px 18px;
            margin-bottom: 12px;
          }

          .complaintKicker {
            margin: 0 0 6px;
            color: #059669;
            font-size: 11px;
            font-weight: 1000;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .complaintHeaderCard h1 {
            margin: 0;
            font-size: 25px;
            line-height: 1.15;
            color: #020617;
            letter-spacing: -0.03em;
          }

          .complaintMeta {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 8px 0 0;
            color: #64748b;
            font-size: 13px;
          }

          .openedStatusBadge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            padding: 7px 12px;
            font-size: 12px;
            font-weight: 1000;
            white-space: nowrap;
          }

          .openedStatusBadge.open {
            background: #fff7ed;
            color: #c2410c;
          }

          .openedStatusBadge.in-progress {
            background: #eff6ff;
            color: #1d4ed8;
          }

          .openedStatusBadge.resolved {
            background: #f0fdf4;
            color: #15803d;
          }

          .openedIssueGrid {
            display: grid;
            grid-template-columns: minmax(0, 1.38fr) minmax(340px, 0.72fr);
            gap: 14px;
            align-items: start;
          }

          .conversationPanel {
            padding: 16px;
          }

          .messageRow {
            display: grid;
            grid-template-columns: 44px minmax(0, 1fr);
            gap: 12px;
          }

          .reporterRow {
            padding-bottom: 14px;
            border-bottom: 1px solid #e8edf5;
          }

          .adminReplyRow {
            padding-top: 14px;
          }

          .avatarCircle {
            width: 38px;
            height: 38px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #dcfce7;
            color: #047857;
            font-size: 14px;
            font-weight: 1000;
          }

          .adminAvatar {
            background: #dbeafe;
            color: #1d4ed8;
          }

          .messageHeaderLine {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
          }

          .messageHeaderLine strong {
            display: block;
            color: #0f172a;
            font-size: 13px;
          }

          .messageHeaderLine span {
            display: block;
            margin-top: 2px;
            color: #64748b;
            font-size: 11px;
            font-weight: 700;
          }

          .messageHeaderLine time {
            color: #94a3b8;
            font-size: 11px;
            font-weight: 800;
            white-space: nowrap;
          }

          .messageContent h2 {
            margin: 0 0 9px;
            font-size: 17px;
            color: #020617;
          }

          .originalText {
            margin: 0 0 13px;
            color: #334155;
            font-size: 14px;
            line-height: 1.55;
          }

          .compactDetailGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .compactDetailGrid div,
          .readonlyLocationGrid div {
            border: 1px solid #dbe4f0;
            background: #f8fafc;
            border-radius: 12px;
            padding: 10px 11px;
            min-width: 0;
          }

          .compactDetailGrid span,
          .readonlyLocationGrid span,
          .targetLocationHeader span {
            display: block;
            margin-bottom: 5px;
            color: #64748b;
            font-size: 10px;
            font-weight: 1000;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .compactDetailGrid strong,
          .readonlyLocationGrid strong,
          .targetLocationHeader strong {
            display: block;
            color: #0f172a;
            font-size: 12px;
            line-height: 1.35;
            word-break: break-word;
          }

          .openedPhotoBox {
            margin-top: 12px;
            overflow: hidden;
            border: 1px solid #dbe4f0;
            border-radius: 14px;
            background: #ffffff;
          }

          .openedPhotoBox img {
            display: block;
            width: 100%;
            max-height: 280px;
            object-fit: cover;
          }

          .adminReplyBubble {
            border: 1px solid #bbf7d0;
            background: #ecfdf5;
            border-radius: 16px;
            padding: 13px;
          }

          .adminReplyBubble p {
            margin: 0;
            color: #166534;
            font-size: 13px;
            line-height: 1.55;
          }

          .replyPanelOnly {
            padding: 16px;
            background: #ffffff;
          }

          .replyHeader {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
          }

          .replyHeader p {
            margin: 0 0 5px;
            color: #1d4ed8;
            font-size: 10px;
            font-weight: 1000;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .replyHeader h2 {
            margin: 0;
            color: #020617;
            font-size: 18px;
            line-height: 1.2;
          }

          .replyHeader span {
            border: 1px solid #86efac;
            background: #dcfce7;
            color: #047857;
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 1000;
            white-space: nowrap;
          }

          .replyDescription {
            margin: 0 0 12px;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
          }

          .targetLocationBox {
            border: 1px solid #dbeafe;
            background: #f8fafc;
            border-radius: 15px;
            padding: 12px;
            margin-bottom: 12px;
          }

          .targetLocationHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }

          .readonlyLocationGrid,
          .manualLocationGrid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px;
          }

          .fullLocation {
            grid-column: 1 / -1;
          }

          .formGroup {
            display: grid;
            gap: 6px;
            margin-bottom: 10px;
          }

          .formGroup label {
            color: #334155;
            font-size: 12px;
            font-weight: 900;
          }

          .formGroup input,
          .formGroup textarea {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 11px;
            padding: 10px 11px;
            color: #0f172a;
            background: #ffffff;
            outline: none;
            font-size: 13px;
            resize: vertical;
          }

          .formGroup input:focus,
          .formGroup textarea:focus {
            border-color: #22c55e;
            box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.14);
          }

          .locationWarning {
            margin: 10px 0 0;
            padding: 9px 10px;
            border-radius: 11px;
            background: #fff7ed;
            color: #c2410c;
            font-size: 12px;
            font-weight: 800;
          }

          .primaryButton {
            border: none;
            border-radius: 12px;
            padding: 11px 15px;
            background: #16a34a;
            color: #ffffff;
            cursor: pointer;
            font-weight: 900;
            box-shadow: 0 10px 20px rgba(22, 163, 74, 0.18);
          }

          .primaryButton:disabled {
            opacity: 0.65;
            cursor: not-allowed;
          }

          .fullButton {
            width: 100%;
            margin-top: 2px;
          }

          .modalResult {
            margin-top: 10px;
            padding: 10px 11px;
            border-radius: 11px;
            background: #f0fdf4;
            color: #166534;
            font-weight: 900;
            font-size: 12px;
          }

          @media (max-width: 980px) {
            .complaintOnlyPage {
              padding: 8px;
            }

            .complaintTopBar,
            .complaintHeaderCard {
              align-items: stretch;
              flex-direction: column;
            }

            .complaintTopActions {
              justify-content: flex-start;
            }

            .openedIssueGrid {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 640px) {
            .messageRow {
              grid-template-columns: 1fr;
            }

            .compactDetailGrid,
            .readonlyLocationGrid,
            .manualLocationGrid {
              grid-template-columns: 1fr;
            }

            .messageHeaderLine {
              flex-direction: column;
              gap: 5px;
            }
          }
        `}</style>
      </>
    );
  }

  return (
    <DashboardShell
      title="Admin Complaints & Reports"
      description="Receive resident and driver complaints, manage status, and send notices to affected residents."
    >
      <div className="adminIssuesPage">
        {errorMessage && <div className="errorBox">{errorMessage}</div>}

        <div className="statsGrid">
          <div className="statCard">
            <span>Total Reports</span>
            <strong>{counts.total}</strong>
          </div>

          <div className="statCard">
            <span>Open</span>
            <strong>{counts.open}</strong>
          </div>

          <div className="statCard">
            <span>In Progress</span>
            <strong>{counts.inProgress}</strong>
          </div>

          <div className="statCard">
            <span>Resolved</span>
            <strong>{counts.resolved}</strong>
          </div>

          <div className="statCard">
            <span>Driver Reports</span>
            <strong>{counts.driver}</strong>
          </div>

          <div className="statCard">
            <span>Resident Reports</span>
            <strong>{counts.resident}</strong>
          </div>
        </div>

        <SectionCard title="Send Advisory / Notice to Residents">
          <div className="noticeGrid">
            <div className="formGroup">
              <label>Barangay</label>
              <input
                list="barangayOptions"
                value={quickNotice.barangay}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setQuickNotice((current) => ({
                    ...current,
                    barangay: event.target.value,
                  }))
                }
                placeholder="Select barangay"
              />
            </div>

            <div className="formGroup">
              <label>Purok</label>
              <input
                list="purokOptions"
                value={quickNotice.purok}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setQuickNotice((current) => ({
                    ...current,
                    purok: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>

            <div className="formGroup noticeTitle">
              <label>Title</label>
              <input
                value={quickNotice.title}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setQuickNotice((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Example: Collection Advisory"
              />
            </div>

            <div className="formGroup noticeMessage">
              <label>Message</label>
              <textarea
                value={quickNotice.message}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setQuickNotice((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
                placeholder="Write the complaint/notice that residents will receive..."
                rows={4}
              />
            </div>
          </div>

          <div className="noticeFooter">
            <button
              className="primaryButton"
              onClick={handleQuickSend}
              disabled={sendingQuick}
            >
              {sendingQuick ? "Sending..." : "Send Notice to Residents"}
            </button>

            {quickResult && <span className="resultText">{quickResult}</span>}
          </div>
        </SectionCard>

        <SectionCard title="Issue Table">
          <div className="toolbar">
            <div className="tabs">
              {[
                { label: "All", value: "all" },
                { label: "Driver", value: "driver" },
                { label: "Resident", value: "resident" },
              ].map((item) => (
                <button
                  key={item.value}
                  className={tab === item.value ? "tab active" : "tab"}
                  onClick={() => setTab(item.value as TabType)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="filters">
              <input
                value={search}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                placeholder="Search report, barangay, purok, route..."
              />

              <select
                value={statusFilter}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                <option value="all">All Status</option>
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>
          </div>

          {loading && <div className="emptyState">Loading reports...</div>}

          {!loading && filtered.length === 0 && (
            <div className="emptyState">No reports found.</div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="tableWrap">
              <table className="issueTable">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Reporter</th>
                    <th>Issue</th>
                    <th>Location</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <span
                          className={
                            issue.source === "driver"
                              ? "sourceBadge driver"
                              : "sourceBadge resident"
                          }
                        >
                          {issue.source === "driver" ? "Driver" : "Resident"}
                        </span>
                      </td>

                      <td>
                        <strong>{getReporterName(issue)}</strong>
                      </td>

                      <td>
                        <div className="issueTitle">
                          {issue.issueType || "Issue Report"}
                        </div>
                        <div className="issueDetails">{issue.details}</div>
                      </td>

                      <td>{getLocationText(issue)}</td>

                      <td>{issue.routeName || "-"}</td>

                      <td>
                        <span
                          className={`statusBadge ${normalize(
                            issue.status || "Open"
                          ).replace(/\s+/g, "-")}`}
                        >
                          {issue.status || "Open"}
                        </span>
                      </td>

                      <td>{formatDate(issue.timestamp)}</td>

                      <td>
                        <div className="rowActions">
                          <button onClick={() => openIssue(issue)}>View</button>

                          <button
                            onClick={() => changeStatus(issue, "Resolved")}
                          >
                            Resolve
                          </button>

                          <button
                            className="dangerButton"
                            onClick={() => deleteIssue(issue)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

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

      <style jsx>{`
        .adminIssuesPage {
          display: grid;
          gap: 18px;
        }

        .errorBox {
          padding: 14px 16px;
          border-radius: 14px;
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
          font-size: 14px;
        }

        .statsGrid {
          display: grid;
          grid-template-columns: repeat(6, minmax(120px, 1fr));
          gap: 14px;
        }

        .statCard {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
        }

        .statCard span {
          display: block;
          color: #64748b;
          font-size: 13px;
          margin-bottom: 8px;
        }

        .statCard strong {
          color: #0f172a;
          font-size: 28px;
          line-height: 1;
        }

        .noticeGrid {
          display: grid;
          grid-template-columns: 1fr 1fr 2fr;
          gap: 14px;
        }

        .formGroup {
          display: grid;
          gap: 7px;
        }

        .formGroup label {
          color: #334155;
          font-size: 13px;
          font-weight: 700;
        }

        .formGroup input,
        .formGroup select,
        .formGroup textarea,
        .filters input,
        .filters select {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 11px 12px;
          color: #0f172a;
          background: #ffffff;
          outline: none;
          font-size: 14px;
        }

        .formGroup input:focus,
        .formGroup textarea:focus,
        .filters input:focus,
        .filters select:focus {
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
        }

        .noticeMessage {
          grid-column: 1 / -1;
        }

        .noticeFooter {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 14px;
          flex-wrap: wrap;
        }

        .primaryButton {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          background: #16a34a;
          color: #ffffff;
          cursor: pointer;
          font-weight: 800;
          box-shadow: 0 10px 20px rgba(22, 163, 74, 0.18);
        }

        .primaryButton:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .resultText {
          font-size: 14px;
          color: #166534;
          font-weight: 700;
        }

        .toolbar {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }

        .tabs {
          display: flex;
          gap: 8px;
          background: #f1f5f9;
          padding: 6px;
          border-radius: 14px;
        }

        .tab {
          border: none;
          border-radius: 10px;
          padding: 9px 14px;
          background: transparent;
          color: #475569;
          cursor: pointer;
          font-weight: 800;
        }

        .tab.active {
          background: #16a34a;
          color: #ffffff;
        }

        .filters {
          display: flex;
          gap: 10px;
          min-width: 420px;
        }

        .filters input {
          min-width: 280px;
        }

        .emptyState {
          text-align: center;
          padding: 34px;
          color: #64748b;
          background: #f8fafc;
          border-radius: 16px;
          border: 1px dashed #cbd5e1;
        }

        .tableWrap {
          overflow-x: auto;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
        }

        .issueTable {
          width: 100%;
          border-collapse: collapse;
          background: #ffffff;
        }

        .issueTable th {
          background: #f8fafc;
          color: #475569;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: left;
          padding: 14px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }

        .issueTable td {
          padding: 14px;
          border-bottom: 1px solid #f1f5f9;
          color: #0f172a;
          vertical-align: top;
          font-size: 14px;
        }

        .issueTable tr:hover td {
          background: #f8fafc;
        }

        .sourceBadge,
        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .sourceBadge.driver {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .sourceBadge.resident {
          background: #ecfdf5;
          color: #047857;
        }

        .statusBadge.open {
          background: #fff7ed;
          color: #c2410c;
        }

        .statusBadge.in-progress {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .statusBadge.resolved {
          background: #f0fdf4;
          color: #15803d;
        }

        .issueTitle {
          font-weight: 900;
          margin-bottom: 4px;
        }

        .issueDetails {
          color: #64748b;
          max-width: 360px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .rowActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rowActions button,
        .modalActions button,
        .closeButton {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
          font-weight: 800;
        }

        .dangerButton {
          border-color: #fecaca !important;
          background: #fff1f2 !important;
          color: #be123c !important;
        }

        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(15, 23, 42, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .modalCard {
          width: min(1120px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #ffffff;
          border-radius: 24px;
          padding: 22px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.25);
        }

        .modalHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 16px;
          margin-bottom: 18px;
        }

        .modalKicker {
          margin: 0 0 4px;
          color: #16a34a;
          font-size: 13px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .modalHeader h2 {
          margin: 0;
          color: #0f172a;
          font-size: 24px;
        }

        .closeButton {
          width: 38px;
          height: 38px;
          font-size: 24px;
          line-height: 1;
        }

        .modalGrid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 18px;
        }

        .detailPanel,
        .noticePanel {
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 16px;
          background: #f8fafc;
        }

        .noticePanel {
          background: #ffffff;
        }

        .noticePanel h3 {
          margin: 0 0 6px;
          color: #0f172a;
          font-size: 20px;
        }

        .noticePanel p {
          margin: 0 0 14px;
          color: #64748b;
          font-size: 14px;
        }

        .targetLocationBox {
          border: 1px solid #dbeafe;
          background: #f8fafc;
          border-radius: 16px;
          padding: 14px;
          margin-bottom: 14px;
        }

        .targetLocationHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .targetLocationHeader span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .targetLocationHeader strong {
          color: #0f172a;
          font-size: 15px;
        }

        .smallEditButton {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .readonlyLocationGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .readonlyLocationGrid div {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 11px 12px;
        }

        .readonlyLocationGrid span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 4px;
        }

        .readonlyLocationGrid strong {
          color: #0f172a;
          font-size: 14px;
        }

        .fullLocation {
          grid-column: 1 / -1;
        }

        .manualLocationGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .locationWarning {
          margin: 10px 0 0 !important;
          padding: 10px 12px;
          border-radius: 12px;
          background: #fff7ed;
          color: #c2410c !important;
          font-size: 13px !important;
          font-weight: 700;
        }

        .detailItem {
          display: grid;
          gap: 4px;
          margin-bottom: 12px;
        }

        .detailItem span {
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 900;
        }

        .detailItem strong {
          color: #0f172a;
        }

        .detailItem p {
          margin: 0;
          color: #334155;
          line-height: 1.55;
        }

        .adminMessageBox {
          background: #ecfdf5;
          border: 1px solid #bbf7d0;
          padding: 12px;
          border-radius: 14px;
        }

        .adminMessageBox small {
          color: #166534;
          font-weight: 700;
        }

        .photoBox {
          margin-top: 12px;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          background: #ffffff;
        }

        .photoBox img {
          width: 100%;
          display: block;
          object-fit: cover;
        }

        .modalActions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        .fullButton {
          width: 100%;
          margin-top: 10px;
        }

        .modalResult {
          margin-top: 12px;
          padding: 11px 12px;
          border-radius: 12px;
          background: #f0fdf4;
          color: #166534;
          font-weight: 800;
          font-size: 14px;
        }

        @media (max-width: 1100px) {
          .statsGrid {
            grid-template-columns: repeat(3, 1fr);
          }

          .noticeGrid {
            grid-template-columns: 1fr 1fr;
          }

          .noticeTitle,
          .noticeMessage {
            grid-column: 1 / -1;
          }

          .modalGrid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .statsGrid {
            grid-template-columns: repeat(2, 1fr);
          }

          .noticeGrid {
            grid-template-columns: 1fr;
          }

          .toolbar {
            align-items: stretch;
          }

          .tabs,
          .filters {
            width: 100%;
          }

          .filters {
            min-width: 0;
            flex-direction: column;
          }

          .filters input {
            min-width: 0;
          }

          .modalBackdrop {
            padding: 10px;
          }

          .modalCard {
            border-radius: 18px;
            padding: 16px;
          }

          .readonlyLocationGrid,
          .manualLocationGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardShell>
  );
}