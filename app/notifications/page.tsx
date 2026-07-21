"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, remove, set } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = [
  "Mercedes",
  "Canlapwas",
  "Maulong",
  "Poblacion 13",
  "San Andres",
] as const;

const PUROKS = Array.from({ length: 10 }, (_, index) => `Purok ${index + 1}`);
const ALL_PUROK_LABEL = "All Purok";

type NotificationType = "info" | "alert" | "emergency" | "schedule";
type NotificationStatus = "saved" | "sent" | "failed";
type TargetMode = "single_purok" | "all_purok";
type TargetType = "barangay_purok" | "barangay_all_purok";
type FilterType = "all" | NotificationType;
type FilterStatus = "all" | NotificationStatus;

type NotificationForm = {
  title: string;
  message: string;
  barangay: string;
  purok: string;
  targetMode: TargetMode;
  type: NotificationType;
};

type NotificationRow = {
  id: string;
  title?: string;
  message?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string;
  purokKey?: string;
  targetMode?: TargetMode | string;
  targetType?: TargetType | string;
  type?: NotificationType | string;
  status?: NotificationStatus | string;
  recipients?: number;
  recipientCount?: number;
  seen?: boolean;
  createdAt?: number;
  timestamp?: number;
};

type Resident = {
  id: string;
  name?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  purokLabel?: string;
  accountStatus?: string;
};

const EMPTY_FORM: NotificationForm = {
  title: "",
  message: "",
  barangay: "",
  purok: "",
  targetMode: "single_purok",
  type: "info",
};

const makeBarangayKey = (value?: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

const makePurokKey = (value?: string) => {
  const raw = String(value || "").toLowerCase().trim();

  if (raw === "all" || raw === "all purok" || raw === "all puroks") {
    return "all";
  }

  const match = raw.match(/\d+/);
  return match ? `purok_${match[0]}` : "";
};

const normalizePurokNumber = (value: unknown) => {
  if (value === undefined || value === null) return "";

  const text = String(value).toLowerCase().trim();

  if (
    text === "all" ||
    text === "all purok" ||
    text === "all puroks" ||
    text === "all_purok" ||
    text === "all_puroks"
  ) {
    return "all";
  }

  const match = text.match(/\d+/);
  return match ? match[0] : "";
};

const formatDateTime = (value?: number) => {
  if (!value) return "No date";

  try {
    return new Date(value).toLocaleString("en-PH", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "No date";
  }
};

const isAllPurokTarget = (row: NotificationRow) =>
  row.targetMode === "all_purok" ||
  row.targetType === "barangay_all_purok" ||
  row.purokKey === "all" ||
  row.purok === ALL_PUROK_LABEL;

const getTargetLabel = (row: NotificationRow) => {
  const barangayText = row.barangay || "Selected barangay";

  return isAllPurokTarget(row)
    ? `${barangayText} • All Purok`
    : row.purok
      ? `${barangayText} • ${row.purok}`
      : barangayText;
};

const getBadgeClass = (value?: string) => {
  switch ((value || "").toLowerCase()) {
    case "sent":
    case "info":
      return "badge badgeBlue";
    case "saved":
    case "schedule":
      return "badge badgeGreen";
    case "alert":
      return "badge badgeOrange";
    case "emergency":
    case "failed":
      return "badge badgeRed";
    default:
      return "badge badgeGray";
  }
};

const getStatusLabel = (status?: string) => {
  if (!status) return "Saved";
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getTypeLabel = (type?: string) => {
  if (!type) return "Info";
  return type.charAt(0).toUpperCase() + type.slice(1);
};

export default function NotificationsPage() {
  const [form, setForm] = useState<NotificationForm>(EMPTY_FORM);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [notice, setNotice] = useState("");

  const formIsAllPurok = form.targetMode === "all_purok";

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "notifications"), (snapshot) => {
      const value = snapshot.val() || {};

      const list: NotificationRow[] = Object.entries(value).map(([id, data]) => ({
        id,
        ...(data as Omit<NotificationRow, "id">),
      }));

      list.sort((a, b) => {
        const timeA = a.timestamp || a.createdAt || 0;
        const timeB = b.timestamp || b.createdAt || 0;
        return timeB - timeA;
      });

      setRows(list);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "residents"), (snapshot) => {
      const value = snapshot.val() || {};

      const list: Resident[] = Object.entries(value).map(([id, data]) => ({
        id,
        ...(data as Omit<Resident, "id">),
      }));

      setResidents(list);
    });

    return () => unsubscribe();
  }, []);

  const countTargetResidents = (barangay?: string, purok?: unknown) => {
    const targetBarangayKey = makeBarangayKey(barangay);
    const targetPurokNumber = normalizePurokNumber(purok);
    const targetIsAllPurok =
      targetPurokNumber === "all" ||
      String(purok || "").toLowerCase().includes("all purok");

    if (!targetBarangayKey) return 0;

    return residents.filter((resident) => {
      const residentBarangayKey = resident.barangayKey || makeBarangayKey(resident.barangay);
      const residentPurokNumber = normalizePurokNumber(
        resident.purok !== undefined && resident.purok !== null
          ? resident.purok
          : resident.purokLabel
      );

      const barangayMatches = residentBarangayKey === targetBarangayKey;
      const purokMatches =
        targetIsAllPurok ||
        !targetPurokNumber ||
        residentPurokNumber === targetPurokNumber;

      return barangayMatches && purokMatches;
    }).length;
  };

  const getDisplayRecipients = (row: NotificationRow) => {
    const savedCount = Number(row.recipientCount ?? row.recipients ?? 0);

    if (savedCount > 0) return savedCount;

    const fallbackPurok = isAllPurokTarget(row) ? ALL_PUROK_LABEL : row.purok;
    return countTargetResidents(row.barangay, fallbackPurok);
  };

  const stats = useMemo(() => {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const total = rows.length;

    const thisWeek = rows.filter((row) => {
      const createdTime = row.timestamp || row.createdAt || 0;
      return createdTime > 0 && now - createdTime < oneWeek;
    }).length;

    const recipients = rows.reduce(
      (totalRecipients, row) => totalRecipients + getDisplayRecipients(row),
      0
    );

    const sent = rows.filter((row) => row.status === "sent").length;
    const saved = rows.filter((row) => row.status === "saved" || !row.status).length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const deliveryRate = total ? Math.round((sent / total) * 100) : 0;

    return { total, thisWeek, recipients, sent, saved, failed, deliveryRate };
  }, [rows, residents]);

  const filteredRows = useMemo(() => {
    const searchText = query.trim().toLowerCase();

    return rows.filter((row) => {
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (barangayFilter !== "all" && row.barangay !== barangayFilter) return false;

      if (!searchText) return true;

      const haystack = `${row.title || ""} ${row.message || ""} ${row.barangay || ""} ${row.purok || ""} ${row.type || ""} ${row.status || ""}`.toLowerCase();
      return haystack.includes(searchText);
    });
  }, [rows, query, typeFilter, statusFilter, barangayFilter]);

  const selectedTargetLabel = useMemo(() => {
    if (!form.barangay) return "Select a barangay to preview the target";
    if (form.targetMode === "all_purok") return `${form.barangay} • All Purok`;
    if (form.purok) return `${form.barangay} • ${form.purok}`;
    return `${form.barangay} • Select Purok`;
  }, [form.barangay, form.purok, form.targetMode]);

  const selectedTargetCount = useMemo(() => {
    if (!form.barangay) return 0;
    return countTargetResidents(
      form.barangay,
      form.targetMode === "all_purok" ? ALL_PUROK_LABEL : form.purok
    );
  }, [form.barangay, form.purok, form.targetMode, residents]);

  const resetAndClose = () => {
    setForm(EMPTY_FORM);
    setShowModal(false);
    setSaving(false);
    setSending(false);
  };

  const openComposer = () => {
    setNotice("");
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const clearFilters = () => {
    setQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    setBarangayFilter("all");
  };

  const validateForm = () => {
    if (!form.title.trim()) {
      alert("Please enter a notification title.");
      return false;
    }

    if (!form.message.trim()) {
      alert("Please enter a notification message.");
      return false;
    }

    if (!form.barangay) {
      alert("Please select one barangay.");
      return false;
    }

    if (form.targetMode === "single_purok" && !form.purok) {
      alert("Please select one purok or choose Notify All Purok.");
      return false;
    }

    return true;
  };

  const saveNotificationRecord = async (
    payload: NotificationForm,
    status: NotificationStatus,
    recipients = 0
  ) => {
    const now = Date.now();
    const barangayKey = makeBarangayKey(payload.barangay);
    const isAllPurok = payload.targetMode === "all_purok";
    const targetType: TargetType = isAllPurok
      ? "barangay_all_purok"
      : "barangay_purok";
    const mainPurok = isAllPurok ? ALL_PUROK_LABEL : payload.purok;
    const mainPurokKey = isAllPurok ? "all" : makePurokKey(payload.purok);
    const finalRecipientCount =
      recipients > 0
        ? recipients
        : countTargetResidents(payload.barangay, isAllPurok ? ALL_PUROK_LABEL : payload.purok);

    const notificationData = {
      title: payload.title.trim(),
      message: payload.message.trim(),
      type: payload.type,
      barangay: payload.barangay,
      barangayKey,
      purok: mainPurok,
      purokKey: mainPurokKey,
      targetMode: payload.targetMode,
      targetType,
      target: "resident",
      status,
      recipients: finalRecipientCount,
      recipientCount: finalRecipientCount,
      seen: false,
      createdAt: now,
      timestamp: now,
    };

    await set(push(ref(db, "notifications")), notificationData);

    if (isAllPurok) {
      await set(push(ref(db, `notificationsByBarangay/${barangayKey}`)), notificationData);

      await Promise.all(
        PUROKS.map((purok) => {
          const purokKey = makePurokKey(purok);
          const purokRecipientCount = countTargetResidents(payload.barangay, purok);

          return set(
            push(ref(db, `notificationsByArea/${barangayKey}/${purokKey}`)),
            {
              ...notificationData,
              purok,
              purokKey,
              targetMode: "all_purok" as TargetMode,
              targetType: "barangay_all_purok" as TargetType,
              recipients: purokRecipientCount,
              recipientCount: purokRecipientCount,
            }
          );
        })
      );

      return;
    }

    await set(
      push(ref(db, `notificationsByArea/${barangayKey}/${mainPurokKey}`)),
      notificationData
    );
  };

  const saveOnly = async () => {
    if (!validateForm()) return;

    try {
      setSaving(true);

      const recipientCount = countTargetResidents(
        form.barangay,
        form.targetMode === "all_purok" ? ALL_PUROK_LABEL : form.purok
      );

      await saveNotificationRecord(form, "saved", recipientCount);
      setNotice(`Notification saved to history for ${recipientCount} registered recipient${recipientCount === 1 ? "" : "s"}.`);
      resetAndClose();
    } catch (error) {
      console.error("Save notification failed:", error);
      alert("Failed to save notification. Please check your Firebase connection.");
    } finally {
      setSaving(false);
    }
  };

  const sendPushToPurok = async (targetPurok: string) => {
    const barangayKey = makeBarangayKey(form.barangay);
    const purokKey = makePurokKey(targetPurok);
    const now = Date.now();
    const fallbackRecipients = countTargetResidents(form.barangay, targetPurok);

    const pushPayload = {
      title: form.title.trim(),
      message: form.message.trim(),
      barangay: form.barangay,
      barangayKey,
      purok: targetPurok,
      purokKey,
      type: form.type,
      target: "resident",
      targetType: "barangay_purok",
      targetMode: form.targetMode,
      status: "sent",
      createdAt: now,
      timestamp: now,
    };

    const currentAdmin = auth.currentUser;
    if (!currentAdmin) throw new Error("Your session has expired. Please sign in again.");
    const token = await currentAdmin.getIdToken();
    const response = await fetch("/api/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(pushPayload),
    });

    let result: any = {};
    try {
      result = await response.json();
    } catch {
      result = {};
    }

    if (!response.ok) {
      return {
        ok: false,
        recipients: fallbackRecipients,
        warning: "",
        error: result?.error || `Push sending failed for ${targetPurok}.`,
      };
    }

    const apiRecipients =
      Number(result?.sent) ||
      Number(result?.successCount) ||
      Number(result?.recipients) ||
      0;

    return {
      ok: true,
      recipients: apiRecipients > 0 ? apiRecipients : fallbackRecipients,
      warning: result?.warning || "",
      error: "",
    };
  };

  const saveAndSend = async () => {
    if (!validateForm()) return;

    try {
      setSending(true);

      const targetPuroks = form.targetMode === "all_purok" ? PUROKS : [form.purok];
      let recipients = 0;
      const failedPuroks: string[] = [];
      const warnings: string[] = [];

      for (const purok of targetPuroks) {
        const result = await sendPushToPurok(purok);
        recipients += result.recipients;

        if (!result.ok) failedPuroks.push(purok);
        if (result.warning) warnings.push(`${purok}: ${result.warning}`);
      }

      const finalStatus: NotificationStatus = failedPuroks.length > 0 ? "failed" : "sent";
      await saveNotificationRecord(form, finalStatus, recipients);

      if (failedPuroks.length > 0) {
        alert(
          `Notification saved, but push failed for: ${failedPuroks.join(
            ", "
          )}. Please check /api/send-alert and resident FCM tokens.`
        );
        setNotice("Notification saved, but some push requests failed.");
        resetAndClose();
        return;
      }

      if (warnings.length > 0) alert(warnings.join("\n"));

      setNotice(
        `Notification sent and saved for ${recipients} registered recipient${recipients === 1 ? "" : "s"}.`
      );
      resetAndClose();
    } catch (error) {
      console.error("Send notification failed:", error);
      alert("Failed to send notification. Please check the API route and Firebase.");
    } finally {
      setSending(false);
    }
  };

  const deleteRow = async (id: string) => {
    const confirmed = window.confirm("Delete this notification from admin history?");
    if (!confirmed) return;

    try {
      await remove(ref(db, `notifications/${id}`));
      setNotice("Notification deleted from history.");
    } catch (error) {
      console.error("Delete notification failed:", error);
      alert("Failed to delete notification.");
    }
  };


  if (showModal) {
    return (
      <DashboardShell
        title="Notifications"
        description="Create targeted notification"
        hidePageHeader
      >
        <section className="notificationsPage composeOnlyPage">
          <div className="composeTopBar">
            <button className="backButton" onClick={resetAndClose} disabled={saving || sending}>
              ← Back to notifications
            </button>

            <div className="composeTitleMini">
              <strong>New Notification</strong>
              <span>{selectedTargetLabel}</span>
            </div>

            <div className="composeTopActions">
              <button className="secondaryButton" onClick={saveOnly} disabled={saving || sending}>
                {saving ? "Saving..." : "Save Only"}
              </button>
              <button className="primaryButton" onClick={saveAndSend} disabled={saving || sending}>
                {sending
                  ? formIsAllPurok
                    ? "Sending to all puroks..."
                    : "Sending..."
                  : "Send Push"}
              </button>
            </div>
          </div>

          <div className="composeCard">
            <div className="composeHeader">
              <div>
                <span className="eyebrow">Create Targeted Alert</span>
                <h2>New Notification</h2>
                <p>
                  Compose the alert, choose the barangay and purok target, then save or send the notification.
                </p>
              </div>
              <span className="composeStatusPill">Composer View</span>
            </div>

            <div className="composeLayout">
              <div className="composeMain">
                <div className="formSection">
                  <div className="stepTitle">
                    <span>01</span>
                    <strong>Message details</strong>
                  </div>

                  <div className="formGrid">
                    <label>
                      <span>Title</span>
                      <input
                        type="text"
                        placeholder="Example: Collection Schedule Update"
                        value={form.title}
                        onChange={(event) => setForm({ ...form, title: event.target.value })}
                      />
                    </label>

                    <label>
                      <span>Notification Type</span>
                      <select
                        value={form.type}
                        onChange={(event) =>
                          setForm({ ...form, type: event.target.value as NotificationType })
                        }
                      >
                        <option value="info">Info</option>
                        <option value="alert">Alert</option>
                        <option value="emergency">Emergency</option>
                        <option value="schedule">Schedule</option>
                      </select>
                    </label>
                  </div>

                  <label>
                    <span>Message</span>
                    <textarea
                      placeholder="Write a short and clear notification message..."
                      value={form.message}
                      onChange={(event) => setForm({ ...form, message: event.target.value })}
                    />
                  </label>
                </div>

                <div className="formSection">
                  <div className="stepTitle">
                    <span>02</span>
                    <strong>Target residents</strong>
                  </div>

                  <div className="formGrid">
                    <label>
                      <span>Target Barangay</span>
                      <select
                        value={form.barangay}
                        onChange={(event) =>
                          setForm({ ...form, barangay: event.target.value, purok: "" })
                        }
                      >
                        <option value="">Select barangay</option>
                        {BARANGAYS.map((barangay) => (
                          <option key={barangay} value={barangay}>
                            {barangay}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Target Coverage</span>
                      <select
                        value={form.targetMode}
                        disabled={!form.barangay}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            targetMode: event.target.value as TargetMode,
                            purok: "",
                          })
                        }
                      >
                        <option value="single_purok">Selected Purok Only</option>
                        <option value="all_purok">All Purok in this Barangay</option>
                      </select>
                    </label>
                  </div>

                  <div className="formGrid">
                    <label>
                      <span>Target Purok</span>
                      <select
                        value={formIsAllPurok ? "" : form.purok}
                        disabled={!form.barangay || formIsAllPurok}
                        onChange={(event) => setForm({ ...form, purok: event.target.value })}
                      >
                        <option value="">
                          {!form.barangay
                            ? "Select barangay first"
                            : formIsAllPurok
                              ? "All Purok selected"
                              : "Select purok"}
                        </option>
                        {PUROKS.map((purok) => (
                          <option key={purok} value={purok}>
                            {purok}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Selected Target</span>
                      <input type="text" readOnly value={selectedTargetLabel} />
                    </label>
                  </div>
                </div>
              </div>

              <aside className="composePreviewPanel">
                <span className="eyebrow">Preview</span>
                <div className="phonePreview">
                  <div className="phoneTop" />
                  <div className="previewIcon">!</div>
                  <strong>{form.title || "Notification title"}</strong>
                  <p>{form.message || "Your message preview will appear here."}</p>
                  <small>{selectedTargetLabel}</small>
                </div>

                <div className="targetSummary">
                  <div>
                    <span>Registered recipients</span>
                    <strong>{selectedTargetCount.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Coverage</span>
                    <strong>{formIsAllPurok ? "10 puroks" : form.purok ? "1 purok" : "Not ready"}</strong>
                  </div>
                  <div>
                    <span>Database path</span>
                    <strong>{formIsAllPurok ? "Barangay + area copies" : "Area-specific copy"}</strong>
                  </div>
                </div>
              </aside>
            </div>

            <div className="composeActions">
              <button className="secondaryButton" onClick={resetAndClose} disabled={saving || sending}>
                Cancel
              </button>
              <button className="secondaryButton" onClick={saveOnly} disabled={saving || sending}>
                {saving ? "Saving..." : "Save Only"}
              </button>
              <button className="primaryButton" onClick={saveAndSend} disabled={saving || sending}>
                {sending
                  ? formIsAllPurok
                    ? "Sending to all puroks..."
                    : "Sending..."
                  : "Send Push"}
              </button>
            </div>
          </div>
        </section>

        <NotificationsStyles />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Notifications"
      description="Send barangay and purok alerts to selected residents"
      hidePageHeader
    >
      <section className="notificationsPage">
        <div className="heroCard">
          <div className="heroCopy">
            <span className="eyebrow">Resident Alert Center</span>
            <h1>Notifications</h1>
            <p>
              Create targeted alerts for one purok or send barangay-wide updates to all registered residents in Purok 1 to Purok 10.
            </p>
          </div>

          <div className="heroActions">
            <div className="systemStatus">
              <span className="pulse" />
              Firebase live
            </div>
            <button className="primaryButton" onClick={openComposer}>
              + New Notification
            </button>
          </div>
        </div>

        {notice && <div className="noticeBox">{notice}</div>}

        <div className="statsGrid">
          <MetricCard label="Total Alerts" value={stats.total} hint="Notification records created in Firebase" icon="🔔" />
          <MetricCard label="Sent Alerts" value={stats.sent} hint="Push requests marked as sent" icon="📤" tone="green" />
          <MetricCard label="This Week" value={stats.thisWeek} hint="Created in the last 7 days" icon="📅" tone="blue" />
          <MetricCard label="Recipients" value={stats.recipients} hint="Registered target recipients from resident records" icon="👥" tone="dark" />
        </div>

        <div className="historyCard">
          <div className="historyTop">
            <div>
              <span className="eyebrow">History</span>
              <h2>Notification records</h2>
              <p>
                Latest alerts are shown first. Use search and filters to review barangay, purok, type, and status.
              </p>
            </div>
          </div>

          <div className="filtersBar">
            <div className="searchBox">
              <span>⌕</span>
              <input
                placeholder="Search title, message, barangay..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)}>
              <option value="all">All barangays</option>
              {BARANGAYS.map((barangay) => (
                <option key={barangay} value={barangay}>
                  {barangay}
                </option>
              ))}
            </select>

            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as FilterType)}>
              <option value="all">All types</option>
              <option value="info">Info</option>
              <option value="alert">Alert</option>
              <option value="emergency">Emergency</option>
              <option value="schedule">Schedule</option>
            </select>

            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}>
              <option value="all">All statuses</option>
              <option value="sent">Sent</option>
              <option value="saved">Saved</option>
              <option value="failed">Failed</option>
            </select>

            <button className="clearButton" onClick={clearFilters}>
              Clear
            </button>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Target</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Date</th>
                  <th className="right">Action</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="emptyState">
                        <strong>No notifications found</strong>
                        <span>Try adjusting the filters or create a new notification.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="notificationCell">
                          <strong>{row.title || "Untitled notification"}</strong>
                          <span>{row.message || "No message provided"}</span>
                        </div>
                      </td>
                      <td>
                        <strong className="targetText">{getTargetLabel(row)}</strong>
                      </td>
                      <td>
                        <span className={getBadgeClass(row.type)}>{getTypeLabel(row.type)}</span>
                      </td>
                      <td>
                        <span className={getBadgeClass(row.status)}>{getStatusLabel(row.status)}</span>
                      </td>
                      <td>
                        <strong className="recipientCount">{getDisplayRecipients(row).toLocaleString()}</strong>
                      </td>
                      <td>{formatDateTime(row.timestamp || row.createdAt)}</td>
                      <td>
                        <div className="rowActions">
                          <button className="deleteButton" onClick={() => deleteRow(row.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </section>

      <NotificationsStyles />
    </DashboardShell>
  );
}


function NotificationsStyles() {
  return (
    <style jsx global>{`
        .notificationsPage {
          display: flex;
          flex-direction: column;
          gap: 24px;
          font-size: 16px;
        }

        .notificationsPage,
        .notificationsPage * {
          box-sizing: border-box;
        }

        .heroCard {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 34px;
          border-radius: 32px;
          background:
            radial-gradient(circle at 8% 12%, rgba(34, 197, 94, 0.18), transparent 32%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 58%, #ecfdf5 100%);
          border: 1px solid #e2e8f0;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
        }

        .heroCopy h1,
        .historyTop h2,
        .modalHeader h2 {
          margin: 0;
          color: #0f172a;
          letter-spacing: -0.04em;
        }

        .heroCopy h1 {
          font-size: 42px;
          line-height: 1.08;
        }

        .heroCopy p,
        .historyTop p,
        .modalHeader p {
          max-width: 760px;
          margin: 8px 0 0;
          color: #64748b;
          line-height: 1.55;
          font-size: 16px;
        }

        .eyebrow {
          display: inline-flex;
          margin-bottom: 8px;
          color: #059669;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .heroActions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .systemStatus {
          height: 44px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          border-radius: 999px;
          background: #f0fdf4;
          border: 1px solid #dcfce7;
          color: #166534;
          font-size: 14px;
          font-weight: 900;
        }

        .pulse {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.12);
        }

        .noticeBox {
          padding: 15px 18px;
          border-radius: 18px;
          background: #ecfdf5;
          border: 1px solid #bbf7d0;
          color: #047857;
          font-size: 15px;
          font-weight: 800;
        }

        .statsGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          align-items: stretch;
        }

        .metricCard {
          position: relative;
          min-width: 0;
          min-height: 78px;
          overflow: hidden;
          padding: 16px 18px 14px;
          border-radius: 16px;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
          border: 1px solid #dbe7f3;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
        }

        .metricCard::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: linear-gradient(180deg, #10b981, #34d399);
        }

        .metricCard::after {
          content: "";
          position: absolute;
          width: 76px;
          height: 76px;
          top: -34px;
          right: -22px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.10);
          pointer-events: none;
        }

        .metricCard.green {
          background: linear-gradient(180deg, #f7fff9 0%, #ffffff 100%);
        }

        .metricCard.green::before {
          background: linear-gradient(180deg, #16a34a, #86efac);
        }

        .metricCard.green::after {
          background: rgba(34, 197, 94, 0.10);
        }

        .metricCard.blue {
          background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
        }

        .metricCard.blue::before {
          background: linear-gradient(180deg, #2563eb, #93c5fd);
        }

        .metricCard.blue::after {
          background: rgba(37, 99, 235, 0.09);
        }

        .metricCard.dark {
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
          border-color: #dbe7f3;
          color: #0f172a;
        }

        .metricCard.dark::before {
          background: linear-gradient(180deg, #0f766e, #14b8a6);
        }

        .metricCard.dark::after {
          background: rgba(15, 118, 110, 0.10);
        }

        .metricTop {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .metricTop span:first-child {
          min-width: 0;
          color: #334155;
          font-size: 13px;
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: -0.01em;
        }

        .metricValue {
          flex: 0 0 auto;
          color: #0f172a;
          font-size: 24px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.05em;
          text-align: right;
        }

        .metricIcon {
          display: none;
        }

        .metricCard small {
          position: relative;
          z-index: 1;
          display: block;
          max-width: calc(100% - 34px);
          margin-top: 10px;
          color: #64748b;
          font-size: 11px;
          line-height: 1.45;
          font-weight: 800;
        }

        .historyCard {
          border-radius: 28px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
          overflow: hidden;
        }

        .historyTop {
          padding: 28px 30px 18px;
        }

        .filtersBar {
          display: grid;
          grid-template-columns: minmax(320px, 1fr) 190px 170px 170px 100px;
          gap: 14px;
          padding: 0 30px 26px;
        }

        .searchBox {
          height: 56px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border-radius: 16px;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          color: #64748b;
        }

        .searchBox input {
          height: 100%;
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: #0f172a;
          font-size: 16px;
        }

        select,
        input,
        textarea {
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          background: #ffffff;
          color: #0f172a;
          outline: none;
          font-size: 16px;
          transition: 0.18s ease;
        }

        .filtersBar select {
          height: 56px;
          padding: 0 14px;
          background: #ffffff;
        }

        select:focus,
        input:focus,
        textarea:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .clearButton {
          height: 56px;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          background: #f8fafc;
          color: #334155;
          font-size: 15px;
          font-weight: 900;
          cursor: pointer;
        }

        .tableWrap {
          width: 100%;
          overflow-x: auto;
          border-top: 1px solid #e2e8f0;
        }

        table {
          width: 100%;
          min-width: 1080px;
          border-collapse: collapse;
        }

        th,
        td {
          padding: 20px 22px;
          text-align: left;
          border-bottom: 1px solid #eef2f7;
          vertical-align: middle;
          font-size: 16px;
        }

        th {
          background: #f8fafc;
          color: #475569;
          font-size: 13px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        th.right {
          text-align: right;
        }

        tbody tr:hover {
          background: #f8fafc;
        }

        .notificationCell {
          max-width: 440px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .notificationCell strong {
          color: #0f172a;
          font-size: 17px;
          line-height: 1.35;
        }

        .notificationCell span {
          color: #64748b;
          font-size: 15px;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .targetText {
          color: #0f172a;
          font-size: 16px;
        }

        .recipientCount {
          color: #0f172a;
          font-size: 18px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 36px;
          padding: 0 14px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 900;
          white-space: nowrap;
        }

        .badgeBlue {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .badgeGreen {
          background: #dcfce7;
          color: #15803d;
        }

        .badgeOrange {
          background: #ffedd5;
          color: #c2410c;
        }

        .badgeRed {
          background: #fee2e2;
          color: #b91c1c;
        }

        .badgeGray {
          background: #f1f5f9;
          color: #475569;
        }

        .emptyState {
          padding: 48px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 15px;
        }

        .emptyState strong {
          color: #0f172a;
          font-size: 18px;
        }

        .rowActions {
          display: flex;
          justify-content: flex-end;
        }

        .deleteButton,
        .primaryButton,
        .secondaryButton,
        .iconButton {
          border: 0;
          cursor: pointer;
          font-weight: 900;
          transition: 0.18s ease;
        }

        .deleteButton {
          min-height: 44px;
          padding: 0 18px;
          border-radius: 12px;
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          font-size: 15px;
        }

        .primaryButton {
          min-height: 48px;
          padding: 0 20px;
          border-radius: 16px;
          background: #059669;
          color: #ffffff;
          font-size: 15px;
          box-shadow: 0 16px 30px rgba(5, 150, 105, 0.24);
        }

        .primaryButton:disabled,
        .secondaryButton:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .secondaryButton {
          min-height: 48px;
          padding: 0 18px;
          border-radius: 16px;
          background: #f8fafc;
          color: #334155;
          border: 1px solid #cbd5e1;
          font-size: 15px;
        }

        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .modalCard {
          width: min(1040px, 100%);
          max-height: 90vh;
          overflow-y: auto;
          background: #ffffff;
          border-radius: 30px;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.35);
        }

        .modalHeader {
          padding: 28px 30px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          border-bottom: 1px solid #e2e8f0;
        }

        .modalHeader h2 {
          font-size: 30px;
        }

        .iconButton {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: #f1f5f9;
          color: #0f172a;
          font-size: 28px;
          line-height: 1;
        }

        .modalLayout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 22px;
          padding: 30px;
        }

        .formPanel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .formSection {
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          padding: 22px;
          background: #ffffff;
        }

        .stepTitle {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }

        .stepTitle span {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: #dcfce7;
          color: #047857;
          font-weight: 900;
        }

        .stepTitle strong {
          color: #0f172a;
          font-size: 18px;
        }

        .formGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        label {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: #334155;
          font-size: 14px;
          font-weight: 900;
          margin-top: 14px;
        }

        label:first-child {
          margin-top: 0;
        }

        label input,
        label select {
          height: 52px;
          padding: 0 14px;
        }

        textarea {
          min-height: 118px;
          padding: 14px;
          resize: vertical;
          line-height: 1.5;
        }

        .previewPanel {
          border: 1px solid #dbeafe;
          border-radius: 24px;
          padding: 22px;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
          align-self: start;
        }

        .phonePreview {
          margin-top: 10px;
          border-radius: 24px;
          background: #ffffff;
          border: 1px solid #dbeafe;
          padding: 20px;
          box-shadow: 0 16px 34px rgba(37, 99, 235, 0.12);
        }

        .phoneTop {
          width: 54px;
          height: 5px;
          border-radius: 999px;
          background: #cbd5e1;
          margin: 0 auto 18px;
        }

        .previewIcon {
          width: 42px;
          height: 42px;
          border-radius: 16px;
          background: #dcfce7;
          color: #047857;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 20px;
          margin-bottom: 14px;
        }

        .phonePreview strong {
          display: block;
          color: #0f172a;
          font-size: 18px;
          line-height: 1.3;
        }

        .phonePreview p {
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .phonePreview small {
          color: #2563eb;
          font-weight: 900;
        }

        .targetSummary {
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .targetSummary div {
          border-radius: 16px;
          background: #ffffff;
          border: 1px solid #dbeafe;
          padding: 14px;
        }

        .targetSummary span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .targetSummary strong {
          display: block;
          color: #0f172a;
          font-size: 15px;
          margin-top: 5px;
        }

        .modalActions {
          padding: 22px 30px 30px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          border-top: 1px solid #e2e8f0;
        }


        .composeOnlyPage {
          gap: 14px;
        }

        .composeTopBar {
          position: sticky;
          top: 0;
          z-index: 20;
          min-height: 64px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 16px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(10px);
        }

        .backButton {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .composeTitleMini {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .composeTitleMini strong {
          color: #0f172a;
          font-size: 16px;
          line-height: 1.2;
        }

        .composeTitleMini span {
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .composeTopActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .composeCard {
          overflow: hidden;
          border-radius: 24px;
          background: #ffffff;
          border: 1px solid #dbe7f3;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        }

        .composeHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 22px 24px 18px;
          border-bottom: 1px solid #e2e8f0;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }

        .composeHeader h2 {
          margin: 0;
          color: #0f172a;
          font-size: 26px;
          line-height: 1.1;
          letter-spacing: -0.04em;
        }

        .composeHeader p {
          max-width: 760px;
          margin: 7px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .composeStatusPill {
          flex: 0 0 auto;
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #bbf7d0;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .composeLayout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 18px;
          padding: 20px;
        }

        .composeMain {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .composeCard .formSection {
          border-radius: 20px;
          padding: 18px;
        }

        .composeCard .stepTitle {
          margin-bottom: 14px;
        }

        .composeCard .stepTitle span {
          width: 30px;
          height: 30px;
          border-radius: 10px;
          font-size: 12px;
        }

        .composeCard .stepTitle strong {
          font-size: 16px;
        }

        .composeCard label {
          margin-top: 12px;
          gap: 7px;
          font-size: 12px;
        }

        .composeCard label input,
        .composeCard label select {
          height: 48px;
          border-radius: 14px;
          font-size: 14px;
        }

        .composeCard textarea {
          min-height: 96px;
          border-radius: 14px;
          font-size: 14px;
        }

        .composePreviewPanel {
          align-self: start;
          border: 1px solid #dbeafe;
          border-radius: 20px;
          padding: 18px;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
        }

        .composePreviewPanel .phonePreview {
          padding: 18px;
          border-radius: 20px;
        }

        .composePreviewPanel .targetSummary div {
          padding: 12px;
          border-radius: 14px;
        }

        .composeActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 20px;
          border-top: 1px solid #e2e8f0;
          background: #ffffff;
        }

        @media (max-width: 1180px) {
          .statsGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .filtersBar {
            grid-template-columns: 1fr 1fr;
          }

          .modalLayout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .heroCard,
          .modalHeader {
            flex-direction: column;
          }

          .statsGrid,
          .filtersBar,
          .formGrid {
            grid-template-columns: 1fr;
          }

          .heroCopy h1 {
            font-size: 34px;
          }

          .metricCard {
            min-height: 82px;
            padding: 16px 18px 14px;
          }

          .metricCard small {
            max-width: 100%;
          }

          .modalActions {
            flex-direction: column;
          }
        }


        @media (max-width: 1180px) {
          .composeLayout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .composeTopBar,
          .composeHeader {
            align-items: stretch;
            flex-direction: column;
          }

          .composeTopActions,
          .composeActions {
            flex-direction: column;
            align-items: stretch;
          }

          .composeTopActions .primaryButton,
          .composeTopActions .secondaryButton,
          .composeActions .primaryButton,
          .composeActions .secondaryButton {
            width: 100%;
          }
        }
`}</style>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: string;
  tone?: "green" | "blue" | "dark";
}) {
  const displayValue = typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div className={`metricCard ${tone || ""}`}>
      <div className="metricTop">
        <span>{label}</span>
        <span className="metricValue">{displayValue}</span>
      </div>
      <small>{hint}</small>
      <span className="metricIcon" aria-hidden="true">
        {icon}
      </span>
    </div>
  );
}
