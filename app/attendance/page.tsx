"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import styles from "./attendance.module.css";

type Driver = {
  id: string;
  uid?: string;
  authUid?: string;
  firebaseUid?: string;
  userId?: string;
  driverId?: string;
  accountId?: string;
  name?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  truck?: string;
  vehicle?: string;
  status?: string;
  profileImage?: string;
};

type AttendancePoint = {
  timestamp?: number;
  selfie?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationVerified?: boolean;
  faceDetected?: boolean;
  livenessVerified?: boolean;
  blinkVerified?: boolean;
  headTurnVerified?: boolean;
  autoCaptured?: boolean;
  smartCameraVerified?: boolean;
  verificationMethod?: string;
  verificationProvider?: string;
  verificationStatus?: string;
  biometricVerified?: boolean;
  fingerprintVerified?: boolean;
  biometricType?: string;
  biometricResultOnly?: boolean;
  livenessMode?: string;
  faceBrightness?: number;
  faceSizeRatio?: number;
  faceTrackingId?: number;
  scanDurationMs?: number;
};

type AttendanceRecord = {
  id: string;
  sourceDriverKey: string;
  driverId: string;
  driverUid?: string;
  driverEmail?: string;
  dateKey: string;
  driverName?: string;
  vehicle?: string;
  scheduleId?: string;
  scheduleTitle?: string;
  routeId?: string;
  scheduledStart?: string;
  barangay?: string;
  puroks?: string;
  status?: string;
  timingStatus?: string;
  lateMinutes?: number;
  earlyMinutes?: number;
  totalDutyMinutes?: number;
  completed?: boolean;
  updatedAt?: number;
  timeIn?: AttendancePoint;
  timeOut?: AttendancePoint;
};

type Schedule = {
  id: string;
  assignedDriverId?: string;
  driverId?: string;
  defaultDriverId?: string;
  title?: string;
  routeId?: string;
  assignedRouteId?: string;
  startTime?: string;
  endTime?: string;
  truckId?: string;
  assignedVehicle?: string;
  barangay?: string;
  barangays?: unknown;
  puroks?: unknown;
  scheduleDays?: unknown;
  scheduleDay?: string;
  status?: string;
  driverOverrides?: Record<string, unknown>;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
  return str(value).toLowerCase();
}

function imageSrc(value?: string): string {
  const clean = str(value);
  if (!clean) return "";
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(clean)) return clean;
  if (clean.length > 100) return `data:image/jpeg;base64,${clean.replace(/\s+/g, "")}`;
  return "";
}

function driverName(driver?: Driver): string {
  return str(driver?.name) || str(driver?.fullName) || str(driver?.email) || "Driver";
}

function vehicleName(driver?: Driver): string {
  return str(driver?.truck) || str(driver?.vehicle) || "Unassigned vehicle";
}

function driverIds(driver?: Driver): Set<string> {
  if (!driver) return new Set();
  return new Set(
    [
      driver.id,
      driver.uid,
      driver.authUid,
      driver.firebaseUid,
      driver.userId,
      driver.driverId,
      driver.accountId,
    ]
      .map(normalize)
      .filter(Boolean),
  );
}

function attendanceMatchesDriver(record: AttendanceRecord, driver?: Driver): boolean {
  if (!driver) return false;
  const ids = driverIds(driver);
  const recordIds = [record.sourceDriverKey, record.driverId, record.driverUid]
    .map(normalize)
    .filter(Boolean);
  if (recordIds.some((id) => ids.has(id))) return true;

  const recordEmail = normalize(record.driverEmail);
  const profileEmail = normalize(driver.email);
  if (recordEmail && profileEmail && recordEmail === profileEmail) return true;

  const recordName = normalize(record.driverName);
  const profileName = normalize(driverName(driver));
  return Boolean(recordName && profileName && recordName === profileName);
}

function statusLabel(value?: string, record?: AttendanceRecord): string {
  if (record?.timeIn?.timestamp && !record?.timeOut?.timestamp) return "Incomplete";
  const normalized = normalize(value);
  if (normalized === "late") return "Late";
  if (normalized === "present") return "Present";
  if (normalized === "excused") return "Excused";
  if (normalized === "absent") return "Absent";
  return "Incomplete";
}

function fingerprintVerified(point?: AttendancePoint): boolean {
  return Boolean(
    point?.fingerprintVerified ||
      (point?.biometricVerified && normalize(point?.biometricType) === "fingerprint"),
  );
}

function smartVerified(point?: AttendancePoint): boolean {
  if (fingerprintVerified(point)) return Boolean(point?.locationVerified);
  return Boolean(point?.faceDetected && point?.livenessVerified && point?.locationVerified);
}

function smartVerificationLabel(point?: AttendancePoint): string {
  if (!point) return "Unavailable";
  if (fingerprintVerified(point) && point.locationVerified) return "Fingerprint + GPS verified";
  if (fingerprintVerified(point)) return "Fingerprint verified";
  if (smartVerified(point)) return "Face + liveness + GPS verified";
  if (point.faceDetected && point.livenessVerified) return "Face + liveness verified";
  if (point.locationVerified) return "GPS verified only";
  return "Unverified";
}

function biometricMethodLabel(point?: AttendancePoint): string {
  if (!point) return "Unavailable";
  if (fingerprintVerified(point)) return "Android fingerprint sensor";
  if (point.faceDetected && point.livenessVerified) return "Smart camera + liveness";
  return str(point.verificationMethod) || "Unavailable";
}

function livenessLabel(point?: AttendancePoint): string {
  if (fingerprintVerified(point)) return "Not applicable";
  if (!point?.livenessVerified) return "Not verified";
  if (point.blinkVerified && point.headTurnVerified) return "Blink + head turn passed";
  if (point.headTurnVerified) return "Head turn passed";
  return "Liveness passed";
}

function manilaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function currentMonthKey(): string {
  return manilaDateKey().slice(0, 7);
}

function dateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+08:00`);
}

function dayNameForKey(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
  }).format(dateFromKey(dateKey));
}

function formatDateKey(value: string): string {
  if (!DATE_KEY.test(value)) return value || "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(dateFromKey(value));
}

function formatTime(value?: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuty(value?: number): string {
  const minutes = Math.max(0, Math.round(num(value)));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${String(remaining).padStart(2, "0")}m`;
}

function normalizeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, raw]) => {
        if (typeof raw === "boolean") return raw ? [key] : [];
        const valueText = str(raw);
        return valueText ? [valueText] : [];
      })
      .filter(Boolean);
  }
  const text = str(value);
  if (!text) return [];
  return text.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
}

function effectiveScheduleDriverId(schedule: Schedule, dateKey: string): string {
  const overrides = schedule.driverOverrides;
  const rawOverride = overrides && typeof overrides === "object"
    ? (overrides[dateKey] as Record<string, unknown> | undefined)
    : undefined;
  const overrideStatus = normalize(rawOverride?.status || "active");
  const substitute = overrideStatus === "active" ? str(rawOverride?.substituteDriverId) : "";
  return substitute || str(schedule.assignedDriverId) || str(schedule.driverId) || str(schedule.defaultDriverId);
}

function scheduleApplies(schedule: Schedule, dateKey: string): boolean {
  const status = normalize(schedule.status || "active");
  if (["cancelled", "completed", "inactive"].includes(status)) return false;
  const days = normalizeList(schedule.scheduleDays);
  if (!days.length && schedule.scheduleDay) days.push(str(schedule.scheduleDay));
  if (!days.length) return true;
  const target = dayNameForKey(dateKey).toLowerCase();
  const short = target.slice(0, 3);
  return days.some((day) => {
    const value = normalize(day);
    return value === target || value.slice(0, 3) === short;
  });
}

function scheduleMatchesDriver(schedule: Schedule, dateKey: string, driver?: Driver): boolean {
  if (!driver || !scheduleApplies(schedule, dateKey)) return false;
  const effectiveId = normalize(effectiveScheduleDriverId(schedule, dateKey));
  return Boolean(effectiveId && driverIds(driver).has(effectiveId));
}

function scheduleTitle(schedule?: Schedule): string {
  return str(schedule?.title) || "Collection duty";
}

function scheduleRoute(schedule?: Schedule): string {
  return str(schedule?.routeId) || str(schedule?.assignedRouteId) || "—";
}

function scheduleVehicle(schedule?: Schedule): string {
  return str(schedule?.truckId) || str(schedule?.assignedVehicle) || "—";
}

function scheduleArea(schedule?: Schedule): string {
  const barangays = normalizeList(schedule?.barangays);
  const primary = str(schedule?.barangay);
  if (primary && !barangays.includes(primary)) barangays.unshift(primary);
  const puroks = normalizeList(schedule?.puroks);
  const left = barangays.length ? barangays.join(", ") : "No Barangay listed";
  return puroks.length ? `${left} • ${puroks.join(", ")}` : left;
}

function scheduleTime(schedule?: Schedule): string {
  const start = str(schedule?.startTime);
  const end = str(schedule?.endTime);
  if (start && end) return `${start} to ${end}`;
  return start || "Time not set";
}

function flattenAttendance(raw: unknown): AttendanceRecord[] {
  if (!raw || typeof raw !== "object") return [];
  const result: AttendanceRecord[] = [];
  const seen = new Set<string>();

  const push = (sourceDriverKey: string, dateKey: string, rawRecord: unknown) => {
    if (!DATE_KEY.test(dateKey) || !rawRecord || typeof rawRecord !== "object") return;
    const value = rawRecord as Record<string, unknown>;
    const recordDriverId = str(value.driverUid) || str(value.driverId) || sourceDriverKey;
    const timeIn = value.timeIn && typeof value.timeIn === "object" ? (value.timeIn as AttendancePoint) : undefined;
    const timeOut = value.timeOut && typeof value.timeOut === "object" ? (value.timeOut as AttendancePoint) : undefined;
    const identity = `${recordDriverId}|${dateKey}|${num(timeIn?.timestamp)}|${num(timeOut?.timestamp)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    result.push({
      id: identity,
      sourceDriverKey,
      driverId: recordDriverId,
      driverUid: str(value.driverUid),
      driverEmail: str(value.driverEmail),
      dateKey: str(value.dateKey) || dateKey,
      driverName: str(value.driverName),
      vehicle: str(value.vehicle),
      scheduleId: str(value.scheduleId),
      scheduleTitle: str(value.scheduleTitle),
      routeId: str(value.routeId),
      scheduledStart: str(value.scheduledStart),
      barangay: str(value.barangay),
      puroks: str(value.puroks),
      status: str(value.status),
      timingStatus: str(value.timingStatus),
      lateMinutes: num(value.lateMinutes),
      earlyMinutes: num(value.earlyMinutes),
      totalDutyMinutes: num(value.totalDutyMinutes),
      completed: Boolean(value.completed),
      updatedAt: num(value.updatedAt),
      timeIn,
      timeOut,
    });
  };

  const walkDriverNode = (sourceDriverKey: string, node: unknown) => {
    if (!node || typeof node !== "object") return;
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      if (DATE_KEY.test(key)) {
        push(sourceDriverKey, key, value);
        return;
      }
      // Supports: /driver_attendance/{uid}/September2026/attendance/{date}
      // and preserves compatibility with the former flat attendance tree.
      walkDriverNode(sourceDriverKey, value);
    });
  };

  Object.entries(raw as Record<string, unknown>).forEach(([outerKey, outerValue]) => {
    if (!outerValue || typeof outerValue !== "object") return;
    const outer = outerValue as Record<string, unknown>;

    if (DATE_KEY.test(outerKey)) {
      const looksLikeRecord = Boolean(outer.timeIn || outer.timeOut || outer.driverId || outer.driverUid || outer.driverName);
      if (looksLikeRecord) push(str(outer.driverUid) || str(outer.driverId) || "legacy", outerKey, outer);
      else Object.entries(outer).forEach(([driverKey, recordValue]) => push(driverKey, outerKey, recordValue));
      return;
    }

    if (DATE_KEY.test(str(outer.dateKey))) push(outerKey, str(outer.dateKey), outer);
    walkDriverNode(outerKey, outer);
  });

  result.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || num(b.updatedAt) - num(a.updatedAt));
  return result;
}

function recordVerificationState(record?: AttendanceRecord): { label: string; verified: boolean } {
  if (!record) return { label: "Pending", verified: false };
  const inVerified = fingerprintVerified(record.timeIn) && Boolean(record.timeIn?.locationVerified);
  const hasOut = Boolean(record.timeOut?.timestamp);
  const outVerified = fingerprintVerified(record.timeOut) && Boolean(record.timeOut?.locationVerified);
  if (inVerified && (!hasOut || outVerified)) return { label: "Fingerprint + GPS Verified", verified: true };
  if (inVerified) return { label: "Time In Verified", verified: false };
  return { label: "Pending Verification", verified: false };
}

function escapeHtml(value: unknown): string {
  return str(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printWindow(title: string, body: string) {
  const popup = window.open("", "_blank", "width=1120,height=820");
  if (!popup) {
    window.alert("Please allow pop-ups to open the printable attendance report.");
    return;
  }

  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#16261f;font-size:11px}
    .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0b7a4b;padding-bottom:12px;margin-bottom:18px}.brand h1{font-size:20px;margin:0}.brand p{margin:4px 0 0;color:#607168}.seal{width:52px;height:52px;border-radius:14px;background:#0b7a4b;color:#fff;display:grid;place-items:center;font-size:21px;font-weight:800}
    .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px;margin:12px 0 18px}.meta div{border-bottom:1px solid #d8e0dc;padding:6px 0}.meta b{display:block;font-size:9px;color:#6d7d75;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #cfd9d4;padding:7px;text-align:left;vertical-align:top}th{background:#edf6f1;color:#24463a;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
    .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0 0 16px}.summary div{border:1px solid #dce6e1;border-radius:8px;padding:10px}.summary b{font-size:18px;display:block}.summary span{color:#718078;font-size:9px;text-transform:uppercase}
    .photos{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.photo{border:1px solid #d7e0dc;border-radius:10px;padding:10px}.photo h3{margin:0 0 8px;font-size:12px}.photo img{width:100%;height:250px;object-fit:cover;border-radius:7px;background:#edf2ef}.emptyPhoto{height:250px;display:grid;place-items:center;background:#f2f5f3;color:#77847e;border-radius:7px}
    .signature{display:flex;justify-content:space-between;gap:60px;margin-top:70px}.signature div{width:45%;text-align:center;border-top:1px solid #263a31;padding-top:7px}.note{color:#65776e;line-height:1.5}
  </style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
  popup.document.close();
}

export default function AttendancePage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [driverSearch, setDriverSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(currentMonthKey());
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"records" | "summary">("records");
  const [detailTab, setDetailTab] = useState<"overview" | "evidence" | "location">("overview");
  const [driverFilter, setDriverFilter] = useState<"all" | "on-duty" | "no-duty">("all");

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "drivers"), (snapshot) => {
      const raw = snapshot.val() || {};
      const list = Object.entries(raw).map(([id, value]) => ({
        id,
        ...(value as Record<string, unknown>),
      })) as Driver[];
      list.sort((a, b) => driverName(a).localeCompare(driverName(b)));
      setDrivers(list);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "driver_attendance"), (snapshot) => {
      setRecords(flattenAttendance(snapshot.val() || {}));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onValue(ref(db, "schedules"), (snapshot) => {
      const raw = snapshot.val() || {};
      const list = Object.entries(raw)
        .filter(([, value]) => value && typeof value === "object")
        .map(([id, value]) => ({ id, ...(value as Record<string, unknown>) })) as Schedule[];
      setSchedules(list);
    });
    return () => unsubscribe();
  }, []);

  const today = manilaDateKey();

  const recordsByDriver = useMemo(() => {
    const grouped = new Map<string, AttendanceRecord[]>();
    drivers.forEach((driver) => {
      grouped.set(driver.id, records.filter((record) => attendanceMatchesDriver(record, driver)));
    });
    return grouped;
  }, [drivers, records]);

  const unmatchedRecords = useMemo(
    () => records.filter((record) => !drivers.some((driver) => attendanceMatchesDriver(record, driver))),
    [drivers, records],
  );

  useEffect(() => {
    if (!drivers.length) {
      setSelectedDriverId("");
      return;
    }
    if (selectionTouched && drivers.some((driver) => driver.id === selectedDriverId)) return;

    const todayRecord = records.find((record) => record.dateKey === today);
    const withToday = todayRecord
      ? drivers.find((driver) => attendanceMatchesDriver(todayRecord, driver))
      : undefined;
    const withAnyRecord = drivers.find((driver) => (recordsByDriver.get(driver.id) || []).length > 0);
    setSelectedDriverId((withToday || withAnyRecord || drivers[0]).id);
  }, [drivers, records, recordsByDriver, selectedDriverId, selectionTouched, today]);

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);

  const todayScheduleByDriver = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    drivers.forEach((driver) => {
      map.set(driver.id, schedules.filter((schedule) => scheduleMatchesDriver(schedule, today, driver)));
    });
    return map;
  }, [drivers, schedules, today]);

  const selectedTodaySchedules = selectedDriver ? todayScheduleByDriver.get(selectedDriver.id) || [] : [];
  const selectedTodaySchedule = selectedTodaySchedules[0];

  const visibleDrivers = useMemo(() => {
    const keyword = normalize(driverSearch);
    return drivers.filter((driver) => {
      const onDuty = (todayScheduleByDriver.get(driver.id) || []).length > 0;
      if (driverFilter === "on-duty" && !onDuty) return false;
      if (driverFilter === "no-duty" && onDuty) return false;
      if (!keyword) return true;
      return `${driverName(driver)} ${driver.email || ""} ${vehicleName(driver)} ${driver.id}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [drivers, driverFilter, driverSearch, todayScheduleByDriver]);

  const selectedAllRecords = recordsByDriver.get(selectedDriverId) || [];
  const selectedRecords = useMemo(() => {
    const keyword = normalize(recordSearch);
    return selectedAllRecords.filter((record) => {
      if (monthFilter && !record.dateKey.startsWith(monthFilter)) return false;
      const recordStatus = statusLabel(record.status, record).toLowerCase();
      if (statusFilter !== "all" && recordStatus !== statusFilter) return false;
      if (!keyword) return true;
      return `${record.dateKey} ${record.scheduleTitle || ""} ${record.routeId || ""} ${record.barangay || ""} ${record.vehicle || ""} ${record.timingStatus || ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [monthFilter, recordSearch, selectedAllRecords, statusFilter]);

  useEffect(() => {
    if (!selectedDriverId) {
      setSelectedRecord(null);
      return;
    }
    const currentBelongsToDriver = selectedRecord
      ? selectedAllRecords.some((record) => record.id === selectedRecord.id)
      : false;
    if (!currentBelongsToDriver) {
      setSelectedRecord(
        selectedAllRecords.find((record) => record.dateKey === today) ||
        selectedAllRecords[0] ||
        null,
      );
      setDetailTab("overview");
    }
  }, [selectedAllRecords, selectedDriverId, selectedRecord, today]);

  const monthRecords = selectedAllRecords.filter((record) => !monthFilter || record.dateKey.startsWith(monthFilter));

  const scheduledDates = useMemo(() => {
    if (!selectedDriver || !monthFilter) return [] as string[];
    const [year, month] = monthFilter.split("-").map(Number);
    if (!year || !month) return [] as string[];
    const lastDay = new Date(year, month, 0).getDate();
    const dates: string[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dateKey > today) break;
      if (schedules.some((schedule) => scheduleMatchesDriver(schedule, dateKey, selectedDriver))) dates.push(dateKey);
    }
    return dates;
  }, [monthFilter, schedules, selectedDriver, today]);

  const summary = useMemo(() => {
    let present = 0;
    let late = 0;
    let incomplete = 0;
    let duty = 0;

    monthRecords.forEach((record) => {
      const hasIn = Boolean(record.timeIn?.timestamp);
      const hasOut = Boolean(record.timeOut?.timestamp);
      if (hasIn && hasOut) {
        if (normalize(record.status) === "late") late += 1;
        else present += 1;
      } else if (hasIn || hasOut) {
        incomplete += 1;
      }
      duty += num(record.totalDutyMinutes);
    });

    const recordsByDate = new Map<string, AttendanceRecord>(
      monthRecords.map((record) => [record.dateKey, record] as [string, AttendanceRecord]),
    );
    let absent = 0;
    let due = 0;
    let completed = 0;
    scheduledDates.forEach((dateKey) => {
      const record = recordsByDate.get(dateKey);
      const hasIn = Boolean(record?.timeIn?.timestamp);
      const hasOut = Boolean(record?.timeOut?.timestamp);
      if (dateKey < today) {
        due += 1;
        if (!hasIn) absent += 1;
        if (hasIn && hasOut) completed += 1;
      } else if (dateKey === today && hasIn && hasOut) {
        due += 1;
        completed += 1;
      }
    });

    const attendanceRate = due > 0 ? Math.round((completed * 100) / due) : 0;
    return { present, late, incomplete, absent, scheduled: scheduledDates.length, duty, attendanceRate, completed, due };
  }, [monthRecords, scheduledDates, today]);

  const todayTotals = useMemo(() => {
    const scheduledDrivers = drivers.filter((driver) => (todayScheduleByDriver.get(driver.id) || []).length > 0);
    const todayDriverRecords = drivers
      .map((driver) => ({ driver, record: (recordsByDriver.get(driver.id) || []).find((record) => record.dateKey === today) }))
      .filter((entry) => entry.record);

    const timedIn = todayDriverRecords.filter((entry) => Boolean(entry.record?.timeIn?.timestamp)).length;
    const late = todayDriverRecords.filter((entry) => normalize(entry.record?.status) === "late").length;
    const completed = todayDriverRecords.filter((entry) => Boolean(entry.record?.timeOut?.timestamp)).length;
    const scheduledWithRecord = scheduledDrivers.filter((driver) =>
      (recordsByDriver.get(driver.id) || []).some((record) => record.dateKey === today && record.timeIn?.timestamp),
    ).length;

    return {
      scheduled: scheduledDrivers.length,
      timedIn,
      late,
      completed,
      noRecord: Math.max(0, scheduledDrivers.length - scheduledWithRecord),
    };
  }, [drivers, recordsByDriver, today, todayScheduleByDriver]);

  function openDriver(id: string) {
    setSelectionTouched(true);
    setSelectedDriverId(id);
    const driverRecords = recordsByDriver.get(id) || [];
    setSelectedRecord(driverRecords.find((record) => record.dateKey === today) || driverRecords[0] || null);
    setDetailTab("overview");
  }

  function printDriverReport() {
    if (!selectedDriver) return;
    const rows = selectedRecords.map((record) => `
      <tr>
        <td>${escapeHtml(formatDateKey(record.dateKey))}</td>
        <td>${escapeHtml(record.scheduledStart || "—")}</td>
        <td>${escapeHtml(formatTime(record.timeIn?.timestamp))}</td>
        <td>${escapeHtml(formatTime(record.timeOut?.timestamp))}</td>
        <td>${escapeHtml(record.timingStatus || (num(record.lateMinutes) > 0 ? `${record.lateMinutes} min late` : "—"))}</td>
        <td>${escapeHtml(formatDuty(record.totalDutyMinutes))}</td>
        <td>${escapeHtml(statusLabel(record.status, record))}</td>
      </tr>`).join("");

    const body = `
      <div class="brand"><div><h1>MetroWaste Driver Attendance Record</h1><p>Catbalogan City Waste Management System</p></div><div class="seal">MW</div></div>
      <div class="meta">
        <div><b>Driver</b>${escapeHtml(driverName(selectedDriver))}</div>
        <div><b>Driver ID</b>${escapeHtml(selectedDriver.id)}</div>
        <div><b>Vehicle</b>${escapeHtml(vehicleName(selectedDriver))}</div>
        <div><b>Period</b>${escapeHtml(monthFilter || "All records")}</div>
      </div>
      <div class="summary">
        <div><b>${summary.present}</b><span>Present</span></div>
        <div><b>${summary.late}</b><span>Late</span></div>
        <div><b>${summary.absent}</b><span>Absent</span></div>
        <div><b>${summary.incomplete}</b><span>Incomplete</span></div>
        <div><b>${escapeHtml(formatDuty(summary.duty))}</b><span>Total duty</span></div>
      </div>
      <table><thead><tr><th>Date</th><th>Scheduled</th><th>Time In</th><th>Time Out</th><th>Timing</th><th>Duty</th><th>Status</th></tr></thead><tbody>${rows || "<tr><td colspan='7'>No attendance records for this filter.</td></tr>"}</tbody></table>
      <div class="signature"><div>Prepared by / Administrator</div><div>Authorized Officer</div></div>`;
    printWindow(`Attendance - ${driverName(selectedDriver)}`, body);
  }

  function printDetailed(record: AttendanceRecord) {
    const inImage = imageSrc(record.timeIn?.selfie);
    const outImage = imageSrc(record.timeOut?.selfie);
    const body = `
      <div class="brand"><div><h1>Detailed Driver Attendance</h1><p>MetroWaste • Catbalogan City Waste Management System</p></div><div class="seal">MW</div></div>
      <div class="meta">
        <div><b>Driver</b>${escapeHtml(record.driverName || driverName(selectedDriver))}</div>
        <div><b>Date</b>${escapeHtml(formatDateKey(record.dateKey))}</div>
        <div><b>Status</b>${escapeHtml(statusLabel(record.status, record))}</div>
        <div><b>Vehicle</b>${escapeHtml(record.vehicle || vehicleName(selectedDriver))}</div>
        <div><b>Schedule</b>${escapeHtml(record.scheduleTitle || record.scheduleId || "—")}</div>
        <div><b>Scheduled Start</b>${escapeHtml(record.scheduledStart || "—")}</div>
        <div><b>Route</b>${escapeHtml(record.routeId || "—")}</div>
        <div><b>Service Area</b>${escapeHtml(record.barangay || "—")}</div>
        <div><b>Timing</b>${escapeHtml(record.timingStatus || "—")}</div>
        <div><b>Total Duty</b>${escapeHtml(formatDuty(record.totalDutyMinutes))}</div>
      </div>
      <div class="photos">
        <div class="photo"><h3>Time In • ${escapeHtml(formatTime(record.timeIn?.timestamp))}</h3>${inImage ? `<img src="${inImage}" alt="Legacy Time In evidence">` : fingerprintVerified(record.timeIn) ? "<div class='emptyPhoto'><b>Fingerprint verified</b><br>No fingerprint image is stored</div>" : "<div class='emptyPhoto'>No image evidence</div>"}<p class="note"><b>Verification:</b> ${escapeHtml(smartVerificationLabel(record.timeIn))}<br><b>Method:</b> ${escapeHtml(biometricMethodLabel(record.timeIn))}<br><b>GPS:</b> ${escapeHtml(locationLabel(record.timeIn))}</p></div>
        <div class="photo"><h3>Time Out • ${escapeHtml(formatTime(record.timeOut?.timestamp))}</h3>${outImage ? `<img src="${outImage}" alt="Legacy Time Out evidence">` : fingerprintVerified(record.timeOut) ? "<div class='emptyPhoto'><b>Fingerprint verified</b><br>No fingerprint image is stored</div>" : "<div class='emptyPhoto'>No image evidence</div>"}<p class="note"><b>Verification:</b> ${escapeHtml(smartVerificationLabel(record.timeOut))}<br><b>Method:</b> ${escapeHtml(biometricMethodLabel(record.timeOut))}<br><b>GPS:</b> ${escapeHtml(locationLabel(record.timeOut))}</p></div>
      </div>
      <div class="signature"><div>Driver Signature</div><div>Administrator / Authorized Officer</div></div>`;
    printWindow(`Detailed Attendance - ${record.dateKey}`, body);
  }

  const selectedDisplayRecord =
    selectedRecord ||
    selectedAllRecords.find((record) => record.dateKey === today) ||
    selectedAllRecords[0] ||
    null;

  const selectedRecordSchedule =
    selectedDisplayRecord?.scheduleId
      ? schedules.find((schedule) => schedule.id === selectedDisplayRecord.scheduleId)
      : selectedTodaySchedule;

  const selectedStatus = selectedDisplayRecord
    ? statusLabel(selectedDisplayRecord.status, selectedDisplayRecord)
    : selectedTodaySchedule
      ? "No Record"
      : "No Duty";

  const onDutyCount = drivers.filter(
    (driver) => (todayScheduleByDriver.get(driver.id) || []).length > 0,
  ).length;

  const noDutyCount = Math.max(0, drivers.length - onDutyCount);

  return (
    <DashboardShell
      title="Driver Attendance"
      description="Monitor driver attendance, verify records and view evidence."
      hidePageHeader
    >
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Driver Attendance</h1>
            <p>Monitor driver attendance, verify records and view evidence.</p>
          </div>

          <div className={styles.pageHeaderRight}>
            <span className={styles.todayDate}>{formatDateKey(today)}</span>
            <button
              type="button"
              className={styles.printButton}
              onClick={printDriverReport}
              disabled={!selectedDriver}
            >
              <span aria-hidden="true">▣</span>
              Print Report
            </button>
          </div>
        </header>

        {unmatchedRecords.length > 0 && (
          <div className={styles.integrationWarning}>
            <strong>{unmatchedRecords.length} attendance record{unmatchedRecords.length === 1 ? "" : "s"} need matching.</strong>
            <span>Driver attendance is still synced. Review the affected driver profile IDs.</span>
          </div>
        )}

        <section className={styles.summaryStrip} aria-label="Attendance summary">
          <SummaryCard icon="●" label="Total Drivers" value={drivers.length} tone="green" />
          <SummaryCard icon="▣" label="Scheduled Today" value={todayTotals.scheduled} tone="blue" />
          <SummaryCard icon="✓" label="Timed In" value={todayTotals.timedIn} tone="green" />
          <SummaryCard icon="◷" label="Late Today" value={todayTotals.late} tone="amber" />
          <SummaryCard icon="□" label="Completed" value={todayTotals.completed} tone="slate" />
          <SummaryCard icon="×" label="No Record" value={todayTotals.noRecord} tone="red" />
        </section>

        <section className={styles.mainWorkspace}>
          {/* DRIVER DIRECTORY */}
          <aside className={styles.driverPanel}>
            <div className={styles.panelTitle}>
              <h2>Drivers <span>({drivers.length})</span></h2>
            </div>

            <label className={styles.compactSearch}>
              <span aria-hidden="true">⌕</span>
              <input
                value={driverSearch}
                onChange={(event) => setDriverSearch(event.target.value)}
                placeholder="Search driver..."
              />
            </label>

            <div className={styles.driverFilterTabs}>
              <button
                type="button"
                data-active={driverFilter === "all"}
                onClick={() => setDriverFilter("all")}
              >
                All <b>{drivers.length}</b>
              </button>
              <button
                type="button"
                data-active={driverFilter === "on-duty"}
                onClick={() => setDriverFilter("on-duty")}
              >
                On Duty <b>{onDutyCount}</b>
              </button>
              <button
                type="button"
                data-active={driverFilter === "no-duty"}
                onClick={() => setDriverFilter("no-duty")}
              >
                No Duty <b>{noDutyCount}</b>
              </button>
            </div>

            <div className={styles.driverList}>
              {visibleDrivers.map((driver) => {
                const driverRecords = recordsByDriver.get(driver.id) || [];
                const todayRecord = driverRecords.find((record) => record.dateKey === today);
                const onDuty = (todayScheduleByDriver.get(driver.id) || []).length > 0;
                const avatar = imageSrc(driver.profileImage);
                const label = todayRecord
                  ? statusLabel(todayRecord.status, todayRecord)
                  : onDuty
                    ? "No Record"
                    : "No Duty";

                return (
                  <button
                    key={driver.id}
                    type="button"
                    className={styles.driverRow}
                    data-active={selectedDriverId === driver.id}
                    onClick={() => openDriver(driver.id)}
                  >
                    <span className={styles.driverAvatar}>
                      {avatar ? <img src={avatar} alt="" /> : initials(driverName(driver))}
                    </span>

                    <span className={styles.driverRowCopy}>
                      <strong>{driverName(driver)}</strong>
                      <small>Vehicle: {vehicleName(driver)}</small>
                    </span>

                    <span
                      className={styles.driverStatus}
                      data-status={label.toLowerCase().replaceAll(" ", "-")}
                    >
                      {label}
                    </span>

                    <span className={styles.chevron}>›</span>
                  </button>
                );
              })}

              {!visibleDrivers.length && (
                <div className={styles.emptyDrivers}>No drivers found.</div>
              )}
            </div>
          </aside>

          {/* RECORDS */}
          <section className={styles.recordsPanel}>
            <div className={styles.mainTabs}>
              <button
                type="button"
                data-active={activeTab === "records"}
                onClick={() => setActiveTab("records")}
              >
                <span aria-hidden="true">☷</span>
                Attendance Records
              </button>
              <button
                type="button"
                data-active={activeTab === "summary"}
                onClick={() => setActiveTab("summary")}
              >
                <span aria-hidden="true">▥</span>
                Monthly Summary
              </button>
            </div>

            {activeTab === "records" ? (
              <>
                <div className={styles.recordFilters}>
                  <label className={styles.monthControl}>
                    <span aria-hidden="true">▣</span>
                    <input
                      type="month"
                      value={monthFilter}
                      onChange={(event) => setMonthFilter(event.target.value)}
                    />
                  </label>

                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    aria-label="Attendance status"
                  >
                    <option value="all">All Status</option>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="incomplete">Incomplete</option>
                    <option value="excused">Excused</option>
                    <option value="absent">Absent</option>
                  </select>

                  <label className={styles.recordSearch}>
                    <span aria-hidden="true">⌕</span>
                    <input
                      value={recordSearch}
                      onChange={(event) => setRecordSearch(event.target.value)}
                      placeholder="Search records..."
                    />
                  </label>
                </div>

                <div className={styles.recordsTableWrap}>
                  <table className={styles.recordsTable}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Schedule</th>
                        <th>Time In</th>
                        <th>Time Out</th>
                        <th>Duty</th>
                        <th>Status</th>
                        <th>Verification</th>
                        <th />
                      </tr>
                    </thead>

                    <tbody>
                      {selectedRecords.map((record) => (
                        <tr
                          key={record.id}
                          data-selected={selectedDisplayRecord?.id === record.id}
                          onClick={() => {
                            setSelectedRecord(record);
                            setDetailTab("overview");
                          }}
                        >
                          <td>
                            <strong>{formatDateKey(record.dateKey)}</strong>
                            <small>{dayNameForKey(record.dateKey).slice(0, 3)}</small>
                          </td>
                          <td>
                            <strong>{record.scheduledStart || "—"}</strong>
                            <small>{record.barangay || record.routeId || "Collection duty"}</small>
                          </td>
                          <td>{formatTime(record.timeIn?.timestamp)}</td>
                          <td>{formatTime(record.timeOut?.timestamp)}</td>
                          <td>{formatDuty(record.totalDutyMinutes)}</td>
                          <td>
                            <span
                              className={styles.tableStatus}
                              data-status={statusLabel(record.status, record).toLowerCase()}
                            >
                              {statusLabel(record.status, record)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={styles.verificationBadge}
                              data-verified={recordVerificationState(record).verified}
                            >
                              <b>✓</b>
                              {recordVerificationState(record).label}
                            </span>
                          </td>
                          <td className={styles.tableArrow}>›</td>
                        </tr>
                      ))}

                      {!selectedRecords.length && (
                        <tr>
                          <td colSpan={8}>
                            <div className={styles.noRecords}>
                              <div className={styles.noRecordsIcon}>⌕</div>
                              <strong>No attendance records</strong>
                              <span>Select a different month or driver.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className={styles.monthlyView}>
                <div className={styles.monthlyHeader}>
                  <div>
                    <span>{monthLabel(monthFilter)}</span>
                    <h3>Monthly Attendance</h3>
                  </div>
                  <div className={styles.rateCircle}>
                    <strong>{summary.attendanceRate}%</strong>
                    <span>Attendance</span>
                  </div>
                </div>

                <div className={styles.monthlyMetrics}>
                  <CompactMetric label="Present" value={summary.present} tone="green" />
                  <CompactMetric label="Late" value={summary.late} tone="amber" />
                  <CompactMetric label="Absent" value={summary.absent} tone="red" />
                  <CompactMetric label="Incomplete" value={summary.incomplete} tone="orange" />
                  <CompactMetric label="Scheduled" value={summary.scheduled} tone="blue" />
                  <CompactMetric label="Duty Time" value={formatDuty(summary.duty)} tone="slate" />
                </div>

                <div className={styles.rateProgress}>
                  <div>
                    <strong>{summary.completed} of {summary.due}</strong>
                    <span>due duty days completed</span>
                  </div>
                  <div className={styles.progressTrack}>
                    <span style={{ width: `${Math.min(100, Math.max(0, summary.attendanceRate))}%` }} />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* DETAILS */}
          <aside className={styles.detailPanel}>
            {!selectedDriver ? (
              <div className={styles.emptyDetail}>
                <strong>Select a driver</strong>
                <span>Attendance details will appear here.</span>
              </div>
            ) : (
              <>
                <div className={styles.detailHeader}>
                  <div className={styles.detailHeaderTop}>
                    <span className={styles.detailBack} aria-hidden="true">←</span>
                    <h2>Attendance Details</h2>
                  </div>

                  <div className={styles.detailIdentity}>
                    <span className={styles.detailAvatar}>
                      {imageSrc(selectedDriver.profileImage) ? (
                        <img src={imageSrc(selectedDriver.profileImage)} alt="" />
                      ) : (
                        initials(driverName(selectedDriver))
                      )}
                    </span>

                    <div className={styles.detailName}>
                      <strong>{driverName(selectedDriver)}</strong>
                      <span>Vehicle: {vehicleName(selectedDriver)}</span>
                    </div>

                    <div className={styles.detailStatusBox}>
                      <span
                        className={styles.largeStatus}
                        data-status={selectedStatus.toLowerCase().replaceAll(" ", "-")}
                      >
                        {selectedStatus}
                      </span>
                      <small>{formatDateKey(selectedDisplayRecord?.dateKey || today)}</small>
                    </div>
                  </div>
                </div>

                <div className={styles.detailTabs}>
                  <button
                    type="button"
                    data-active={detailTab === "overview"}
                    onClick={() => setDetailTab("overview")}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    data-active={detailTab === "evidence"}
                    onClick={() => setDetailTab("evidence")}
                  >
                    Evidence
                  </button>
                  <button
                    type="button"
                    data-active={detailTab === "location"}
                    onClick={() => setDetailTab("location")}
                  >
                    Location
                  </button>
                </div>

                {detailTab === "overview" && (
                  <div className={styles.detailBody}>
                    <div className={styles.infoGrid}>
                      <InfoItem
                        icon="▣"
                        label="Schedule"
                        value={
                          selectedDisplayRecord?.scheduledStart ||
                          scheduleTime(selectedRecordSchedule)
                        }
                      />
                      <InfoItem
                        icon="◷"
                        label="Time In"
                        value={formatTime(selectedDisplayRecord?.timeIn?.timestamp)}
                      />
                      <InfoItem
                        icon="▥"
                        label="Route"
                        value={
                          selectedDisplayRecord?.routeId ||
                          scheduleRoute(selectedRecordSchedule)
                        }
                      />
                      <InfoItem
                        icon="◷"
                        label="Time Out"
                        value={formatTime(selectedDisplayRecord?.timeOut?.timestamp)}
                      />
                      <InfoItem
                        icon="●"
                        label="Service Area"
                        value={
                          selectedDisplayRecord?.barangay ||
                          scheduleArea(selectedRecordSchedule)
                        }
                      />
                      <InfoItem
                        icon="⌁"
                        label="Total Duty"
                        value={formatDuty(selectedDisplayRecord?.totalDutyMinutes)}
                      />
                    </div>

                    <section className={styles.timingCard}>
                      <div className={styles.smallSectionTitle}>
                        <span aria-hidden="true">◷</span>
                        Timing Details
                      </div>
                      <div className={styles.timingGrid}>
                        <div>
                          <span>Scheduled Start</span>
                          <strong>{selectedDisplayRecord?.scheduledStart || str(selectedRecordSchedule?.startTime) || "—"}</strong>
                        </div>
                        <div>
                          <span>Actual Time In</span>
                          <strong>{formatTime(selectedDisplayRecord?.timeIn?.timestamp)}</strong>
                        </div>
                        <div className={styles.lateBox}>
                          <span>Timing</span>
                          <strong>
                            {selectedDisplayRecord?.timingStatus ||
                              (num(selectedDisplayRecord?.lateMinutes) > 0
                                ? `Late by ${selectedDisplayRecord?.lateMinutes} min`
                                : selectedDisplayRecord?.timeIn?.timestamp
                                  ? "On time"
                                  : "—")}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <button
                      type="button"
                      className={styles.verificationRow}
                      onClick={() => setDetailTab("evidence")}
                    >
                      <span className={styles.verifiedIcon}>✓</span>
                      <span>
                        <small>Verification</small>
                        <strong>{smartVerificationLabel(selectedDisplayRecord?.timeIn)}</strong>
                      </span>
                      <b>›</b>
                    </button>

                    <section className={styles.selfieSection}>
                      <div className={styles.smallSectionTitle}>
                        <span aria-hidden="true">▣</span>
                        Attendance Verification
                      </div>

                      <div className={styles.selfieGrid}>
                        <SelfieThumb
                          label="Time In Verification"
                          point={selectedDisplayRecord?.timeIn}
                          onClick={() => setDetailTab("evidence")}
                        />
                        <SelfieThumb
                          label="Time Out Verification"
                          point={selectedDisplayRecord?.timeOut}
                          onClick={() => setDetailTab("evidence")}
                        />

                        <button
                          type="button"
                          className={styles.downloadTile}
                          disabled={!selectedDisplayRecord}
                          onClick={() => selectedDisplayRecord && printDetailed(selectedDisplayRecord)}
                        >
                          <span>⇩</span>
                          <strong>Print Full Report</strong>
                        </button>
                      </div>
                    </section>
                  </div>
                )}

                {detailTab === "evidence" && (
                  <div className={styles.detailBody}>
                    <EvidencePanel title="Time In" point={selectedDisplayRecord?.timeIn} />
                    <EvidencePanel title="Time Out" point={selectedDisplayRecord?.timeOut} />

                    {selectedDisplayRecord && (
                      <button
                        type="button"
                        className={styles.fullReportButton}
                        onClick={() => printDetailed(selectedDisplayRecord)}
                      >
                        Print verification report
                      </button>
                    )}
                  </div>
                )}

                {detailTab === "location" && (
                  <div className={styles.detailBody}>
                    <LocationPanel title="Time In Location" point={selectedDisplayRecord?.timeIn} />
                    <LocationPanel title="Time Out Location" point={selectedDisplayRecord?.timeOut} />
                  </div>
                )}
              </>
            )}
          </aside>
        </section>
      </main>
    </DashboardShell>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <article className={styles.summaryCard} data-tone={tone}>
      <span className={styles.summaryIcon}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function CompactMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <article className={styles.compactMetric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoIcon}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value || "—"}</strong>
      </div>
    </div>
  );
}

function SelfieThumb({
  label,
  point,
  onClick,
}: {
  label: string;
  point?: AttendancePoint;
  onClick: () => void;
}) {
  const image = imageSrc(point?.selfie);
  return (
    <button type="button" className={styles.selfieThumb} onClick={onClick}>
      <span className={styles.selfieImage}>
        {image ? (
          <img src={image} alt={label} />
        ) : fingerprintVerified(point) ? (
          <span className={styles.fingerprintMark} aria-label="Fingerprint verified">⌁</span>
        ) : (
          <span>No image</span>
        )}
      </span>
      <strong>{label}</strong>
      <small>{formatTime(point?.timestamp)}</small>
    </button>
  );
}

function EvidencePanel({
  title,
  point,
}: {
  title: string;
  point?: AttendancePoint;
}) {
  const image = imageSrc(point?.selfie);
  const fingerprint = fingerprintVerified(point);
  return (
    <section className={styles.evidencePanel}>
      <div className={styles.evidencePanelImage}>
        {image ? (
          <img src={image} alt={`${title} legacy attendance evidence`} />
        ) : fingerprint ? (
          <div className={styles.biometricEvidence}>
            <span className={styles.fingerprintMarkLarge}>⌁</span>
            <strong>Fingerprint Verified</strong>
            <small>No fingerprint image or template is stored by WasteTrack.</small>
          </div>
        ) : (
          <span>No verification image recorded</span>
        )}
      </div>
      <div className={styles.evidencePanelInfo}>
        <div><span>{title}</span><strong>{formatTime(point?.timestamp)}</strong></div>
        <div><span>Verification</span><strong>{smartVerificationLabel(point)}</strong></div>
        <div><span>Method</span><strong>{biometricMethodLabel(point)}</strong></div>
        <div><span>GPS</span><strong>{point?.locationVerified ? "Verified" : "—"}</strong></div>
      </div>
    </section>
  );
}

function LocationPanel({
  title,
  point,
}: {
  title: string;
  point?: AttendancePoint;
}) {
  return (
    <section className={styles.locationPanel}>
      <div className={styles.locationPin}>●</div>
      <div>
        <span>{title}</span>
        <strong>{locationLabel(point)}</strong>
        <small>
          {point?.accuracyMeters
            ? `Accuracy ±${Math.round(point.accuracyMeters)} m`
            : "Accuracy unavailable"}
        </small>
      </div>
    </section>
  );
}

function locationLabel(point?: AttendancePoint): string {
  if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) return "—";
  return `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "D") + (parts[1]?.[0] || "")).toUpperCase();
}

function todayAttendanceTitle(record?: AttendanceRecord): string {
  if (!record) return "No attendance recorded";
  if (record.timeIn?.timestamp && record.timeOut?.timestamp) return statusLabel(record.status, record);
  if (record.timeIn?.timestamp) return "Timed in • duty in progress";
  return "No attendance recorded";
}

function monthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return "All months";
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(Date.UTC(year, month - 1, 15, 4)));
}
