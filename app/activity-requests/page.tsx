"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, set, update } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type ActivityRequest = {
  id: string;
  requestId?: string;
  driverId?: string;
  driverName?: string;
  truck?: string;
  period?: string;
  periodLabel?: string;
  requestedDateKey?: string;
  requestedDateDisplay?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  requestedAt?: number;
  sentAt?: number;
  status?: string;
  adminNote?: string;
  pushStatus?: string;
  pushSentAt?: number;
};

type CollectionReport = {
  reportId: string;
  scheduleId?: string;
  routeId?: string;
  driverId?: string;
  driverName?: string;
  truckId?: string;
  routeName?: string;
  scheduleName?: string;
  barangay?: string;
  assignedPuroks?: unknown;
  puroks?: unknown;
  claimedPuroks?: unknown;
  visitedPuroks?: unknown;
  unclaimedPuroks?: unknown;
  collectionStatus?: string;
  status?: string;
  truckLoadFraction?: string;
  truckLoadLabel?: string;
  truckLoadPercent?: number;
  completionReason?: string;
  collectionCondition?: string;
  driverNotes?: string;
  routeProgress?: number;
  startTime?: number;
  completedAt?: number;
  timestamp?: number;
  distanceTravelledMeters?: number;
  durationSeconds?: number;
};

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value?: string): string {
  return (value || "pending").trim().toLowerCase();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => str(entry)).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item === true || item === "true" || item === 1 || item === "1") return key;
        return str(item);
      })
      .filter(Boolean);
  }

  const scalar = str(value);
  if (!scalar) return [];
  return scalar.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatDateTime(value?: number): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: number): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function durationLabel(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function collectionTimestamp(report: CollectionReport): number {
  return num(report.completedAt) || num(report.timestamp) || num(report.startTime);
}

function isFullTruck(report: CollectionReport): boolean {
  const fraction = str(report.truckLoadFraction).toLowerCase();
  const label = str(report.truckLoadLabel).toLowerCase();
  const percent = num(report.truckLoadPercent);
  return fraction === "1" || fraction === "1/1" || label.includes("full") || percent >= 100;
}

export default function DriverActivityRequestsPage() {
  const [requests, setRequests] = useState<ActivityRequest[]>([]);
  const [reports, setReports] = useState<CollectionReport[]>([]);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "sent">("pending");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "driver_activity_requests"), (snapshot) => {
      const value = snapshot.val() || {};
      const list: ActivityRequest[] = Object.entries(value).map(([id, raw]) => ({
        id,
        ...(raw as Record<string, unknown>),
      })) as ActivityRequest[];

      list.sort((a, b) => num(b.requestedAt) - num(a.requestedAt));
      setRequests(list);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "collection_reports"), (snapshot) => {
      const value = snapshot.val() || {};
      const list: CollectionReport[] = Object.entries(value).map(([reportId, raw]) => ({
        reportId,
        ...(raw as Record<string, unknown>),
      })) as CollectionReport[];
      setReports(list);
    });
    return () => unsubscribe();
  }, []);

  const visibleRequests = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return requests.filter((request) => {
      const status = normalizeStatus(request.status);
      if (filter === "pending" && status !== "pending" && status !== "processing") return false;
      if (filter === "sent" && status !== "sent" && status !== "delivered") return false;

      if (!keyword) return true;
      return `${request.driverName || ""} ${request.truck || ""} ${request.periodLabel || ""} ${request.requestedDateDisplay || ""} ${status}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [requests, filter, search]);

  function matchingReports(request: ActivityRequest): CollectionReport[] {
    const driverId = str(request.driverId);
    const from = num(request.fromTimestamp);
    const to = num(request.toTimestamp) || Date.now();

    return reports
      .filter((report) => {
        if (!driverId || str(report.driverId) !== driverId) return false;
        const timestamp = collectionTimestamp(report);
        return timestamp >= from && timestamp <= to;
      })
      .sort((a, b) => collectionTimestamp(b) - collectionTimestamp(a));
  }

  async function sendActivityReport(request: ActivityRequest) {
    if (!request.id || !request.driverId) return;
    if (busyRequestId) return;

    setBusyRequestId(request.id);

    try {
      const matched = matchingReports(request);

      const completedCount = matched.filter((item) => {
        const status = str(item.collectionStatus || item.status).toLowerCase();
        return status === "completed" || status === "complete";
      }).length;

      const partialCount = matched.filter((item) => {
        const status = str(item.collectionStatus || item.status).toLowerCase();
        return status.includes("partial");
      }).length;

      const fullTruckCount = matched.filter(isFullTruck).length;
      const totalDistanceMeters = matched.reduce(
        (sum, item) => sum + num(item.distanceTravelledMeters),
        0,
      );
      const totalDurationSeconds = matched.reduce(
        (sum, item) => sum + num(item.durationSeconds),
        0,
      );

      /*
       * IMPORTANT: No Firebase Storage is used.
       * We do not copy screenshots or map images.
       * Every activity only stores the Realtime Database path of its real GPS
       * session. The Driver app can render the map from this path:
       * gps_route_history/{scheduleId}/{sessionId}/points
       */
      const activities = Object.fromEntries(
        matched.map((item) => {
          const scheduleId = str(item.scheduleId);
          const sessionId = item.reportId;

          return [
            item.reportId,
            {
              reportId: item.reportId,
              sessionId,
              scheduleId,
              routeId: item.routeId || "",
              mapSource: "realtime_database",
              mapPath:
                scheduleId && sessionId
                  ? `gps_route_history/${scheduleId}/${sessionId}/points`
                  : "",
              routeName: item.routeName || item.scheduleName || "Collection route",
              scheduleName: item.scheduleName || "",
              barangay: item.barangay || "",
              assignedPuroks: stringList(item.assignedPuroks || item.puroks),
              claimedPuroks: stringList(item.claimedPuroks || item.visitedPuroks),
              unclaimedPuroks: stringList(item.unclaimedPuroks),
              collectionStatus: item.collectionStatus || item.status || "",
              truckLoadFraction: item.truckLoadFraction || "",
              truckLoadLabel: item.truckLoadLabel || "",
              truckLoadPercent: num(item.truckLoadPercent),
              completionReason: item.completionReason || "",
              collectionCondition: item.collectionCondition || "",
              driverNotes: item.driverNotes || "",
              routeProgress: num(item.routeProgress),
              startTime: num(item.startTime),
              completedAt: num(item.completedAt),
              timestamp: collectionTimestamp(item),
              distanceTravelledMeters: num(item.distanceTravelledMeters),
              durationSeconds: num(item.durationSeconds),
            },
          ];
        }),
      );

      const now = Date.now();
      const sentBy = auth.currentUser?.email || auth.currentUser?.uid || "Administrator";
      const periodLabel =
        request.requestedDateDisplay ||
        request.periodLabel ||
        "Requested activity period";

      const reportPayload = {
        requestId: request.id,
        driverId: request.driverId,
        driverName: request.driverName || "Driver",
        truck: request.truck || "-",
        period: request.period || "specific_date",
        periodLabel,
        requestedDateKey: request.requestedDateKey || "",
        requestedDateDisplay: request.requestedDateDisplay || periodLabel,
        fromTimestamp: num(request.fromTimestamp),
        toTimestamp: num(request.toTimestamp),
        requestedAt: num(request.requestedAt),
        generatedAt: now,
        generatedBy: sentBy,
        mapStorage: "realtime_database_only",
        summary: {
          tripCount: matched.length,
          completedCount,
          partialCount,
          fullTruckCount,
          mappedTripCount: matched.filter(
            (item) => Boolean(str(item.scheduleId) && item.reportId),
          ).length,
          totalDistanceMeters: Math.round(totalDistanceMeters),
          totalDurationSeconds: Math.round(totalDurationSeconds),
        },
        activities,
      };

      const driverNotification = {
        title: "Activity Report Ready",
        message: `Your ${periodLabel} activity report with GPS activity map is ready to view and print.`,
        type: "driver_activity_report_ready",
        driverId: request.driverId,
        requestId: request.id,
        periodLabel,
        requestedDateKey: request.requestedDateKey || "",
        requestedDateDisplay: request.requestedDateDisplay || periodLabel,
        timestamp: now,
        seen: false,
      };

      const notificationId = push(
        ref(db, `driver_notifications/${request.driverId}`),
      ).key;

      await Promise.all([
        set(ref(db, `driver_activity_reports/${request.id}`), reportPayload),
        update(ref(db, `driver_activity_requests/${request.id}`), {
          status: "sent",
          sentAt: now,
          updatedAt: now,
          sentBy,
          reportActivityCount: matched.length,
          reportMappedTripCount: matched.filter(
            (item) => Boolean(str(item.scheduleId) && item.reportId),
          ).length,
        }),
        notificationId
          ? set(
              ref(db, `driver_notifications/${request.driverId}/${notificationId}`),
              driverNotification,
            )
          : Promise.resolve(),
      ]);

      /*
       * Send the real Android phone notification.
       * The report is already safely saved in Realtime Database, so a push
       * failure will never erase or cancel the report.
       */
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Administrator session unavailable.");

        const idToken = await currentUser.getIdToken();
        const response = await fetch("/api/driver-activity-notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            driverId: request.driverId,
            requestId: request.id,
            periodLabel,
            requestedDateDisplay: request.requestedDateDisplay || periodLabel,
          }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
          await update(ref(db, `driver_activity_requests/${request.id}`), {
            pushStatus: "failed",
            pushError: result?.message || "Unable to send phone notification.",
            updatedAt: Date.now(),
          });

          console.warn("Activity report saved, but push notification failed:", result);
          return;
        }

        await update(ref(db, `driver_activity_requests/${request.id}`), {
          pushStatus: "sent",
          pushSentAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (pushError) {
        console.error("Activity report saved, but phone notification failed:", pushError);
        await update(ref(db, `driver_activity_requests/${request.id}`), {
          pushStatus: "failed",
          pushError:
            pushError instanceof Error
              ? pushError.message
              : "Unknown notification error",
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error("Unable to send driver activity report", error);
      window.alert("Unable to send the activity report. Please try again.");
    } finally {
      setBusyRequestId("");
    }
  }

  async function rejectRequest(request: ActivityRequest) {
    if (!request.id || busyRequestId) return;
    const note = window.prompt(
      "Reason for declining this request (optional):",
      "Activity report request could not be processed.",
    );
    if (note === null) return;

    setBusyRequestId(request.id);
    try {
      await update(ref(db, `driver_activity_requests/${request.id}`), {
        status: "rejected",
        adminNote: note.trim(),
        updatedAt: Date.now(),
        sentBy: auth.currentUser?.email || auth.currentUser?.uid || "Administrator",
      });
    } finally {
      setBusyRequestId("");
    }
  }

  return (
    <DashboardShell
      title="Driver Activity Requests"
      description="Review exact-date driver requests, generate printable reports with linked GPS activity maps, and notify the requesting driver."
    >
      <div className="activity-page">
        <div className="toolbar">
          <div className="tabs">
            {(["pending", "all", "sent"] as const).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {value === "pending" ? "Pending" : value === "sent" ? "Sent" : "All"}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search driver, truck, date..."
          />
        </div>

        <div className="request-grid">
          {visibleRequests.map((request) => {
            const status = normalizeStatus(request.status);
            const matchedCount = matchingReports(request).length;
            const isSent = status === "sent" || status === "delivered";

            return (
              <article className="request-card" key={request.id}>
                <div className="card-head">
                  <div>
                    <div className="eyebrow">DRIVER REQUEST</div>
                    <h3>{request.driverName || "Driver"}</h3>
                    <p>Truck: {request.truck || "-"}</p>
                  </div>
                  <span className={`status ${status}`}>{isSent ? "SENT" : status.toUpperCase()}</span>
                </div>

                <div className="period-box">
                  <strong>{request.requestedDateDisplay || request.periodLabel || "Requested activity"}</strong>
                  <span>
                    {formatDate(request.fromTimestamp)} - {formatDate(request.toTimestamp)}
                  </span>
                </div>

                <div className="facts">
                  <div><span>Requested</span><strong>{formatDateTime(request.requestedAt)}</strong></div>
                  <div><span>Matching trips</span><strong>{matchedCount}</strong></div>
                  <div>
                    <span>GPS maps</span>
                    <strong>
                      {matchingReports(request).filter((item) => Boolean(str(item.scheduleId) && item.reportId)).length}
                    </strong>
                  </div>
                  <div><span>Status</span><strong>{isSent ? `Sent ${formatDateTime(request.sentAt)}` : status}</strong></div>
                </div>

                {request.adminNote ? <div className="admin-note">{request.adminNote}</div> : null}

                <div className="actions">
                  <button
                    className="primary"
                    disabled={busyRequestId === request.id}
                    onClick={() => sendActivityReport(request)}
                  >
                    {busyRequestId === request.id
                      ? "Sending..."
                      : isSent
                        ? "Regenerate & Send"
                        : "Generate & Send Report"}
                  </button>
                  {!isSent && status !== "rejected" ? (
                    <button
                      className="secondary"
                      disabled={busyRequestId === request.id}
                      onClick={() => rejectRequest(request)}
                    >
                      Decline
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {visibleRequests.length === 0 ? (
            <div className="empty">No driver activity report requests match this view.</div>
          ) : null}
        </div>
      </div>

      <style jsx>{`
        .activity-page { display: grid; gap: 18px; }
        .toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 12px; }
        .tabs { display: flex; gap: 8px; }
        .tabs button { border: 1px solid #dbe2e8; background: #fff; color: #475569; padding: 9px 13px; border-radius: 10px; font-weight: 700; cursor: pointer; }
        .tabs button.active { background: #065f46; color: #fff; border-color: #065f46; }
        .toolbar input { width: min(340px, 100%); border: 1px solid #dbe2e8; border-radius: 10px; padding: 10px 12px; outline: none; }
        .request-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
        .request-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px; box-shadow: 0 8px 24px rgba(15,23,42,.04); }
        .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .eyebrow { font-size: 10px; font-weight: 800; color: #059669; letter-spacing: .08em; }
        h3 { margin: 4px 0 2px; font-size: 20px; color: #0f172a; }
        p { margin: 0; color: #64748b; font-size: 12px; }
        .status { font-size: 10px; font-weight: 800; border-radius: 999px; padding: 7px 10px; background: #f1f5f9; color: #475569; }
        .status.pending { background: #fff7ed; color: #b45309; }
        .status.processing { background: #eff6ff; color: #1d4ed8; }
        .status.sent, .status.delivered { background: #ecfdf5; color: #047857; }
        .status.rejected { background: #fef2f2; color: #b91c1c; }
        .period-box { display: grid; gap: 4px; margin-top: 15px; padding: 12px; border-radius: 12px; background: #f8fafc; border: 1px solid #e9eef3; }
        .period-box strong { color: #0f172a; }
        .period-box span { color: #64748b; font-size: 12px; }
        .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
        .facts div { display: grid; gap: 4px; }
        .facts span { color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: 800; }
        .facts strong { color: #334155; font-size: 12px; }
        .admin-note { margin-top: 12px; padding: 10px; background: #fef2f2; color: #991b1b; border-radius: 10px; font-size: 12px; }
        .actions { display: flex; gap: 9px; margin-top: 16px; }
        .actions button { border: 0; border-radius: 11px; padding: 11px 13px; font-weight: 800; cursor: pointer; }
        .primary { flex: 1; background: #059669; color: white; }
        .secondary { background: #f1f5f9; color: #475569; }
        .actions button:disabled { opacity: .55; cursor: default; }
        .empty { grid-column: 1 / -1; padding: 32px; text-align: center; color: #64748b; background: #fff; border: 1px dashed #cbd5e1; border-radius: 16px; }
        @media (max-width: 700px) {
          .toolbar { align-items: stretch; flex-direction: column; }
          .toolbar input { width: 100%; }
          .facts { grid-template-columns: 1fr; }
        }
      `}</style>
    </DashboardShell>
  );
}