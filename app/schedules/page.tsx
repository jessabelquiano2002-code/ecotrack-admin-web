"use client";

import {
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { findOfficialBarangay } from "../service-areas/catalog";
import { ScheduleDialog } from "./ScheduleDialog";
import { ScheduleIcon, type ScheduleIconName } from "./ScheduleIcons";
import styles from "./schedules.module.css";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MANILA_TIME_ZONE = "Asia/Manila";

type DriverOverride = {
  date?: string;
  rangeStartDate?: string;
  rangeEndDate?: string;
  overrideGroupId?: string;
  originalDriverId?: string;
  originalDriverName?: string;
  substituteDriverId?: string;
  substituteDriverName?: string;
  reason?: string;
  createdAt?: number;
  createdBy?: string;
  status?: string;
};

type Driver = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  truck?: string;
  status?: string;
  active?: boolean;
  enabled?: boolean;
  availabilityStatus?: string;
  availabilityReason?: string;
  unavailableFrom?: string | number;
  unavailableUntil?: string | number;
};

type ServiceArea = {
  areaKey?: string;
  barangay: string;
  barangayKey?: string;
  purok?: string;
  purokKey?: string;
  order?: number;
  startTime?: string;
};

type RouteRecord = {
  id: string;
  routeName?: string;
  barangay?: string;
  barangayKey?: string;
  barangayKeys?: string[] | Record<string, string | boolean>;
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
  areas?: ServiceArea[] | Record<string, ServiceArea>;
  coverageByBarangay?: Record<
    string,
    {
      barangay?: string;
      barangayKey?: string;
      puroks?: string[] | Record<string, string | boolean>;
      areas?: ServiceArea[] | Record<string, ServiceArea>;
    }
  >;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicle?: string;
  status?: string;
  verified?: boolean;
  routeValidation?: { status?: string };
};

type ServicePurokRecord = {
  purok?: string;
  active?: boolean;
};

type ServiceBarangayRecord = {
  barangay?: string;
  active?: boolean;
  puroks?: Record<string, ServicePurokRecord>;
};

type Schedule = {
  id: string;
  title?: string;
  barangay?: string;
  barangayKey?: string;
  barangays?: string[] | Record<string, string | boolean>;
  areas?: ServiceArea[] | Record<string, ServiceArea>;
  assignedPuroks?: string[] | Record<string, string | boolean>;
  puroks?: Array<string | number> | Record<string, string | number | boolean>;
  scheduleDay?: string;
  scheduleDays?: string[] | string;
  startTime?: string;
  endTime?: string;
  purokTimes?: Record<string, string>;
  collectionTimesByPurok?: Record<string, string>;
  truckId?: string;
  assignedDriverId?: string;
  driverId?: string;
  driverName?: string;
  defaultDriverId?: string;
  defaultDriverName?: string;
  routeId?: string;
  assignedRouteId?: string;
  routeName?: string;
  notes?: string;
  status?: string;
  scheduleType?: string;
  repeat?: string;
  isRecurring?: boolean;
  driverOverrides?: Record<string, DriverOverride>;
  createdAt?: number;
  updatedAt?: number;
};

type CreateForm = {
  title: string;
  barangays: string[];
  routeId: string;
  startTime: string;
  endTime: string;
  assignedDriverId: string;
  truckId: string;
  notes: string;
};

const EMPTY_CREATE_FORM: CreateForm = {
  title: "",
  barangays: [],
  routeId: "",
  startTime: "",
  endTime: "",
  assignedDriverId: "",
  truckId: "",
  notes: "",
};

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item === true) return key;
        if (typeof item === "string" || typeof item === "number") {
          return String(item);
        }
        return "";
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value ? [String(value).trim()].filter(Boolean) : [];
}

function cleanText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizePurokLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = raw.match(/\d+/)?.[0];
  return number ? `Purok ${Number(number)}` : raw;
}

function makeBarangayKey(value: string): string {
  const key = String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  if (["13", "poblacion13"].includes(key)) return "poblacion_13";
  if (["guindapunan", "gundaponan"].includes(key)) return "guindaponan";
  return key;
}

function makePurokKey(value: unknown): string {
  const normalized = normalizePurokLabel(value);
  const number = normalized.match(/\d+/)?.[0];
  return number ? `purok_${Number(number)}` : "";
}

function serviceAreaId(area: ServiceArea): string {
  const barangayKey = area.barangayKey || makeBarangayKey(area.barangay);
  const purokKey = area.purokKey || makePurokKey(area.purok);
  return area.areaKey || `${barangayKey}|${purokKey || "all"}`;
}

function getServiceAreas(value: unknown): ServiceArea[] {
  const items = Array.isArray(value)
    ? value
    : Object.values(
        (value && typeof value === "object" ? value : {}) as Record<
          string,
          ServiceArea
        >,
      );

  return items
    .filter((area): area is ServiceArea => Boolean(area && area.barangay))
    .map((area) => ({
      ...area,
      barangay: String(area.barangay).trim(),
      barangayKey: area.barangayKey || makeBarangayKey(area.barangay),
      purok: normalizePurokLabel(area.purok || ""),
      purokKey:
        area.purokKey || (area.purok ? makePurokKey(area.purok) : "all"),
    }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function getRouteBarangays(route: RouteRecord): string[] {
  const explicit = [route.barangay, ...normalizeArray(route.barangays)]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const fromCoverage = Object.entries(route.coverageByBarangay || {}).map(
    ([storedKey, value]) => String(value.barangay || storedKey).trim(),
  );

  const fromAreas = getRouteServiceAreas(route).map((area) => area.barangay);

  return Array.from(
    new Set([...explicit, ...fromCoverage, ...fromAreas].filter(Boolean)),
  );
}

function getRouteServiceAreas(route: RouteRecord): ServiceArea[] {
  const explicitAreas = getServiceAreas(route.areas);
  if (explicitAreas.length > 0) return explicitAreas;

  const fromCoverage = Object.entries(route.coverageByBarangay || {}).flatMap(
    ([storedKey, coverage]) => {
      const barangay = String(coverage.barangay || storedKey).trim();
      const barangayKey = coverage.barangayKey || makeBarangayKey(barangay);
      const nestedAreas = getServiceAreas(coverage.areas);

      if (nestedAreas.length > 0) {
        return nestedAreas.map((area) => ({
          ...area,
          barangay: area.barangay || barangay,
          barangayKey: area.barangayKey || barangayKey,
        }));
      }

      return normalizeArray(coverage.puroks).map((purok, order) => ({
        areaKey: `${barangayKey}|${makePurokKey(purok)}`,
        barangay,
        barangayKey,
        purok: normalizePurokLabel(purok),
        purokKey: makePurokKey(purok),
        order,
      }));
    },
  );

  if (fromCoverage.length > 0) return fromCoverage;

  const fallbackBarangay = String(route.barangay || "").trim();
  return normalizeArray(route.puroks).map((purok, order) => ({
    areaKey: `${makeBarangayKey(fallbackBarangay)}|${makePurokKey(purok)}`,
    barangay: fallbackBarangay,
    barangayKey: makeBarangayKey(fallbackBarangay),
    purok: normalizePurokLabel(purok),
    purokKey: makePurokKey(purok),
    order,
  }));
}

function isSelectableRoute(route: RouteRecord): boolean {
  const status = String(route.status || "ready").trim().toLowerCase();
  const active = !["disabled", "inactive", "archived"].includes(status);
  const verified =
    route.verified === true &&
    String(route.routeValidation?.status || "").toLowerCase() === "verified";

  return active && verified;
}

function routeCoversBarangay(route: RouteRecord, barangay: string): boolean {
  const key = makeBarangayKey(barangay);
  if (!key) return false;
  return getRouteBarangays(route).some(
    (item) => makeBarangayKey(item) === key,
  );
}

function getRouteAreasForBarangay(
  route: RouteRecord,
  barangay: string,
): ServiceArea[] {
  const key = makeBarangayKey(barangay);
  return getRouteServiceAreas(route).filter(
    (area) => makeBarangayKey(area.barangay) === key,
  );
}

function routeCoversAllBarangays(
  route: RouteRecord,
  barangays: string[],
): boolean {
  if (barangays.length === 0) return false;
  return barangays.every((barangay) =>
    routeCoversBarangay(route, barangay),
  );
}

function getRouteAreasForBarangays(
  route: RouteRecord,
  barangays: string[],
): ServiceArea[] {
  const selectedKeys = new Set(
    barangays.map(makeBarangayKey).filter(Boolean),
  );

  return getRouteServiceAreas(route).filter((area) =>
    selectedKeys.has(makeBarangayKey(area.barangay)),
  );
}

function groupAreasByBarangay(
  areas: ServiceArea[],
): Array<{ barangay: string; puroks: string[] }> {
  const groups = new Map<string, { barangay: string; puroks: string[] }>();

  for (const area of areas) {
    const barangay = String(area.barangay || "").trim();
    if (!barangay) continue;

    const key = makeBarangayKey(barangay);
    const existing = groups.get(key) || {
      barangay,
      puroks: [],
    };

    const purok = normalizePurokLabel(area.purok);
    if (purok && !existing.puroks.includes(purok)) {
      existing.puroks.push(purok);
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    puroks: group.puroks.sort(
      (a, b) =>
        Number(a.match(/\d+/)?.[0] || 0) -
        Number(b.match(/\d+/)?.[0] || 0),
    ),
  }));
}

function getScheduleBarangays(schedule: Schedule): string[] {
  return Array.from(
    new Set(
      [schedule.barangay, ...normalizeArray(schedule.barangays)]
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function getSchedulePuroks(schedule: Schedule): string[] {
  const fromAreas = getServiceAreas(schedule.areas)
    .map((area) => normalizePurokLabel(area.purok))
    .filter(Boolean);

  if (fromAreas.length > 0) return Array.from(new Set(fromAreas));

  return normalizeArray(schedule.assignedPuroks || schedule.puroks)
    .map(normalizePurokLabel)
    .filter(Boolean);
}

function getScheduleDays(schedule: Schedule): string[] {
  const values = normalizeArray(schedule.scheduleDays);
  const fallback = schedule.scheduleDay ? [schedule.scheduleDay] : [];
  const selected = new Set(values.length > 0 ? values : fallback);
  return DAYS.filter((day) => selected.has(day));
}

function formatDayList(days: string[]): string {
  const ordered = DAYS.filter((day) => days.includes(day));
  if (ordered.length === 0) return "—";
  if (ordered.length === 1) return ordered[0];
  return ordered.map((day) => day.slice(0, 3)).join(", ");
}

function formatTime(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";

  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;

  let hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

function formatDate(value?: number): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: MANILA_TIME_ZONE,
  }).format(new Date(value));
}

function dateKeyForOffset(daysFromToday: number): string {
  const now = new Date();
  const manilaParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: MANILA_TIME_ZONE,
  }).formatToParts(now);

  const values = Object.fromEntries(
    manilaParts.map((part) => [part.type, part.value]),
  );

  const base = new Date(
    `${values.year}-${values.month}-${values.day}T12:00:00+08:00`,
  );
  base.setUTCDate(base.getUTCDate() + daysFromToday);

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: MANILA_TIME_ZONE,
  }).format(base);
}

function dayNameForDateKey(dateKey: string): string {
  if (!dateKey) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: MANILA_TIME_ZONE,
  }).format(new Date(`${dateKey}T12:00:00+08:00`));
}

function formatDateKey(dateKey: string): string {
  if (!dateKey) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: MANILA_TIME_ZONE,
  }).format(new Date(`${dateKey}T12:00:00+08:00`));
}

function nextScheduledDate(schedule: Schedule): string {
  const days = getScheduleDays(schedule);
  for (let offset = 0; offset <= 14; offset += 1) {
    const key = dateKeyForOffset(offset);
    if (days.length === 0 || days.includes(dayNameForDateKey(key))) return key;
  }
  return dateKeyForOffset(0);
}

function parseMinutes(time?: string): number | null {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function addMinutesToTime(
  time: string,
  minutesToAdd: number,
): string {
  const start = parseMinutes(time);
  if (start === null) return "";

  const normalized =
    ((start + minutesToAdd) % (24 * 60) + 24 * 60) %
    (24 * 60);

  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}`;
}

function timeWindowDurationMinutes(
  startTime?: string,
  endTime?: string,
): number | null {
  const start = parseMinutes(startTime);
  const end = parseMinutes(endTime);

  if (start === null || end === null) return null;
  if (start === end) return 0;

  return end > start ? end - start : 24 * 60 - start + end;
}

function timeWindowLabel(
  startTime?: string,
  endTime?: string,
): string {
  const duration = timeWindowDurationMinutes(startTime, endTime);

  if (duration === null) {
    return "Select a start and expected end time.";
  }

  if (duration === 0) {
    return "Start and expected end time cannot be the same.";
  }

  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  const durationLabel = [
    hours > 0 ? `${hours} hr${hours === 1 ? "" : "s"}` : "",
    minutes > 0 ? `${minutes} min` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const start = parseMinutes(startTime);
  const end = parseMinutes(endTime);
  const overnight =
    start !== null && end !== null && end < start;

  return overnight
    ? `${durationLabel} collection window • ends the next day`
    : `${durationLabel} collection window`;
}

function isValidTimeWindow(
  startTime?: string,
  endTime?: string,
): boolean {
  const duration = timeWindowDurationMinutes(startTime, endTime);
  return duration !== null && duration > 0;
}

function timeWindowsOverlap(
  startA?: string,
  endA?: string,
  startB?: string,
  endB?: string,
): boolean {
  const aStart = parseMinutes(startA);
  const bStart = parseMinutes(startB);

  if (aStart === null || bStart === null) return false;

  const aDuration = timeWindowDurationMinutes(startA, endA);
  const bDuration = timeWindowDurationMinutes(startB, endB);

  // Legacy schedules without an end time cannot prove a duration.
  // Treat only an identical start time as a conflict in that case.
  if (aDuration === null || bDuration === null) {
    return aStart === bStart;
  }

  // Same start/end is invalid for a new schedule, but old malformed records
  // should still be treated as a point conflict rather than breaking checks.
  if (aDuration === 0 || bDuration === 0) {
    return aStart === bStart;
  }

  const aEnd = aStart + aDuration;
  const bEnd = bStart + bDuration;

  const overlaps = (
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number,
  ) => firstStart < secondEnd && secondStart < firstEnd;

  return (
    overlaps(aStart, aEnd, bStart, bEnd) ||
    overlaps(aStart, aEnd, bStart + 1440, bEnd + 1440) ||
    overlaps(aStart + 1440, aEnd + 1440, bStart, bEnd)
  );
}

function driverOverrideForDate(
  schedule: Schedule,
  dateKey: string,
): DriverOverride | null {
  const override = schedule.driverOverrides?.[dateKey];
  if (!override) return null;

  const status = String(override.status || "active").toLowerCase();
  if (["cancelled", "inactive", "removed"].includes(status)) return null;
  if (!String(override.substituteDriverId || "").trim()) return null;

  return override;
}

function effectiveDriverIdForDate(
  schedule: Schedule,
  dateKey: string,
): string {
  const override = driverOverrideForDate(schedule, dateKey);
  return String(
    override?.substituteDriverId ||
      schedule.assignedDriverId ||
      schedule.driverId ||
      schedule.defaultDriverId ||
      "",
  ).trim();
}

function isDriverOperationallyAvailable(
  driver: Driver,
  dateKey?: string,
): boolean {
  if (driver.active === false || driver.enabled === false) return false;

  const accountStatus = String(driver.status || "offline")
    .trim()
    .toLowerCase();

  // "offline" is only app presence. It does NOT mean unavailable for work.
  if (["disabled", "inactive", "suspended", "blocked"].includes(accountStatus)) {
    return false;
  }

  const availability = String(driver.availabilityStatus || "available")
    .trim()
    .toLowerCase();

  if (
    [
      "unavailable",
      "on_leave",
      "on leave",
      "leave",
      "sick",
      "sick_leave",
      "suspended",
    ].includes(availability)
  ) {
    return false;
  }

  if (dateKey) {
    const target = new Date(`${dateKey}T12:00:00+08:00`).getTime();
    const from =
      typeof driver.unavailableFrom === "number"
        ? driver.unavailableFrom
        : driver.unavailableFrom
          ? new Date(String(driver.unavailableFrom)).getTime()
          : NaN;

    const until =
      typeof driver.unavailableUntil === "number"
        ? driver.unavailableUntil
        : driver.unavailableUntil
          ? new Date(String(driver.unavailableUntil)).getTime()
          : NaN;

    if (
      Number.isFinite(target) &&
      Number.isFinite(from) &&
      Number.isFinite(until) &&
      target >= from &&
      target <= until
    ) {
      return false;
    }
  }

  return true;
}

function scheduleRunsOnDate(schedule: Schedule, dateKey: string): boolean {
  const days = getScheduleDays(schedule);
  return days.length === 0 || days.includes(dayNameForDateKey(dateKey));
}

function dateKeysInRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || endDate < startDate) return [];

  const start = new Date(`${startDate}T12:00:00+08:00`);
  const end = new Date(`${endDate}T12:00:00+08:00`);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return [];
  }

  const result: string[] = [];
  const cursor = new Date(start.getTime());

  while (cursor.getTime() <= end.getTime()) {
    result.push(
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: MANILA_TIME_ZONE,
      }).format(cursor),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return Array.from(new Set(result));
}

function scheduledDateKeysInRange(
  schedule: Schedule,
  startDate: string,
  endDate: string,
): string[] {
  return dateKeysInRange(startDate, endDate).filter((dateKey) =>
    scheduleRunsOnDate(schedule, dateKey),
  );
}

function overrideRangeLabel(
  dateKey: string,
  override?: DriverOverride | null,
): string {
  if (
    override?.rangeStartDate &&
    override?.rangeEndDate &&
    override.rangeStartDate !== override.rangeEndDate
  ) {
    return `${formatDateKey(override.rangeStartDate)} – ${formatDateKey(
      override.rangeEndDate,
    )}`;
  }
  return formatDateKey(dateKey);
}

function hasDriverConflictOnDate(
  schedules: Schedule[],
  driverId: string,
  dateKey: string,
  startTime: string,
  endTime: string,
  excludeScheduleId = "",
): boolean {
  return schedules.some((schedule) => {
    if (schedule.id === excludeScheduleId) return false;
    if (String(schedule.status || "active").toLowerCase() !== "active") {
      return false;
    }
    if (!scheduleRunsOnDate(schedule, dateKey)) return false;
    if (effectiveDriverIdForDate(schedule, dateKey) !== driverId) return false;

    return timeWindowsOverlap(
      startTime,
      endTime,
      String(schedule.startTime || ""),
      String(schedule.endTime || ""),
    );
  });
}

function hasRecurringDriverConflict(
  schedules: Schedule[],
  driverId: string,
  days: string[],
  startTime: string,
  endTime: string,
  excludeScheduleId = "",
): boolean {
  return schedules.some((schedule) => {
    if (schedule.id === excludeScheduleId) return false;
    if (String(schedule.status || "active").toLowerCase() !== "active") {
      return false;
    }

    const scheduleDriver = String(
      schedule.assignedDriverId ||
        schedule.driverId ||
        schedule.defaultDriverId ||
        "",
    );

    if (scheduleDriver !== driverId) return false;

    const existingDays = getScheduleDays(schedule);
    if (!days.some((day) => existingDays.includes(day))) return false;

    return timeWindowsOverlap(
      startTime,
      endTime,
      String(schedule.startTime || ""),
      String(schedule.endTime || ""),
    );
  });
}


const STEPS = [
  { label: "Service areas", hint: "Choose the Barangays", icon: "pin" },
  { label: "Collection route", hint: "Choose the verified master route", icon: "route" },
  { label: "Purok coverage", hint: "Choose what this schedule will collect", icon: "pin" },
  { label: "Days & time", hint: "Set the weekly timetable", icon: "clock" },
  { label: "Driver & truck", hint: "Confirm the regular assignment", icon: "users" },
  { label: "Review", hint: "Check everything before saving", icon: "check" },
] as const;

function Metric({ label, value, caption, icon }: {
  label: string; value: ReactNode; caption: string; icon: ScheduleIconName;
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricHeading}>
        <span>{label}</span><ScheduleIcon name={icon} size={18} />
      </div>
      <strong className={styles.metricValue}>{value}</strong>
      <span className={styles.metricCaption}>{caption}</span>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const label = String(status || "active").trim().toLowerCase();
  return <span className={styles.statusBadge} data-active={label === "active"}>
    <span aria-hidden="true" />{label.replace(/_/g, " ")}
  </span>;
}

function conciseDays(schedule: Schedule): string {
  const days = getScheduleDays(schedule);
  if (days.length === 7) return "Every day";
  if (days.length === 5 && !days.includes("Sunday") && !days.includes("Saturday")) {
    return "Monday–Friday";
  }
  return formatDayList(days);
}

// Display helpers must not invent an end time for a legacy record.
function savedWindow(schedule: Schedule): string {
  if (!schedule.startTime) return "Start time not set";
  if (!schedule.endTime) return `${formatTime(schedule.startTime)} · End time not set`;
  const overnight = (parseMinutes(schedule.endTime) ?? 0) < (parseMinutes(schedule.startTime) ?? 0);
  return `${formatTime(schedule.startTime)} – ${formatTime(schedule.endTime)}${overnight ? " (+1 day)" : ""}`;
}

function Coverage({ schedule }: { schedule: Schedule }) {
  const groups = groupAreasByBarangay(getServiceAreas(schedule.areas));
  if (groups.length > 0) {
    return <div className={styles.coverageList}>
      {groups.map((group) => <div key={group.barangay} className={styles.coverageRow}>
        <strong>{group.barangay}</strong>
        <span>{group.puroks.length ? group.puroks.join(", ") : "Purok details not recorded"}</span>
      </div>)}
    </div>;
  }
  // Do not infer every possible Barangay/Purok pair from legacy aggregate lists.
  return <div className={styles.legacyCoverage}>
    <p>{getScheduleBarangays(schedule).join(", ") || "Barangay not recorded"}</p>
    <p>{getSchedulePuroks(schedule).join(", ") || "Puroks not recorded"}</p>
    <small>Legacy record: exact Barangay/Purok pairs are not available here.</small>
  </div>;
}

function ScheduleRow({ schedule, override, onEdit, onSubstitute, onDelete }: {
  schedule: Schedule;
  override: [string, DriverOverride] | null;
  onEdit: () => void;
  onSubstitute: () => void;
  onDelete: () => void;
}) {
  const barangays = getScheduleBarangays(schedule);
  const regularDriver = schedule.driverName || schedule.defaultDriverName || "Driver not assigned";
  return (
    <details className={styles.scheduleRow}>
      <summary className={styles.scheduleSummary}>
        <span className={styles.rowIcon}><ScheduleIcon name="calendar" /></span>
        <span className={styles.rowIdentity}>
          <strong>{schedule.title || "Untitled collection schedule"}</strong>
          <span>{barangays.join(" · ") || "Service area not recorded"}</span>
        </span>
        <span className={styles.rowWhen}>
          <strong>{conciseDays(schedule)}</strong><span>{savedWindow(schedule)}</span>
        </span>
        <span className={styles.rowState}>
          <StatusBadge status={schedule.status} />
          {override ? <span className={styles.substituteHint}>Substitute scheduled</span> : null}
        </span>
        <ScheduleIcon name="chevron" size={17} className={styles.rowChevron} />
      </summary>
      <div className={styles.scheduleDetail}>
        <div className={styles.detailColumns}>
          <section className={styles.detailSection} aria-label="Service coverage">
            <h3><ScheduleIcon name="pin" size={17} /> Where we collect</h3>
            <Coverage schedule={schedule} />
          </section>
          <section className={styles.detailSection} aria-label="Regular assignment">
            <h3><ScheduleIcon name="users" size={17} /> Who is assigned</h3>
            <dl className={styles.facts}>
              <div><dt>Regular driver</dt><dd>{regularDriver}</dd></div>
              <div><dt>Truck / plate</dt><dd>{schedule.truckId || "Not recorded"}</dd></div>
              <div><dt>Route</dt><dd>{schedule.routeName || "Not recorded"}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(schedule.createdAt)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(schedule.updatedAt || schedule.createdAt)}</dd></div>
            </dl>
          </section>
        </div>
        {override ? <div className={styles.overrideNotice}>
          <ScheduleIcon name="swap" size={19} />
          <div><strong>{override[1].substituteDriverName || "Substitute driver"}</strong>
            <p>{overrideRangeLabel(override[0], override[1])}</p>
            <small>Applies to saved collection dates only. The regular assignment is retained.</small>
          </div>
        </div> : null}
        {schedule.notes ? <section className={styles.notes}><h3>Admin notes</h3><p>{schedule.notes}</p></section> : null}
        <details className={styles.recordDetails}>
          <summary>Record identifiers</summary>
          <dl className={styles.facts}>
            <div><dt>Schedule ID</dt><dd><code>{schedule.id}</code></dd></div>
            <div><dt>Route ID</dt><dd><code>{schedule.routeId || schedule.assignedRouteId || "Not recorded"}</code></dd></div>
          </dl>
        </details>
        <div className={styles.detailActions}>
          <div className={styles.detailActionGroup}>
            <button type="button" className={styles.primaryOutlineButton} onClick={onEdit}>
              <ScheduleIcon name="edit" size={17} /> Edit schedule
            </button>
            <button type="button" className={styles.secondaryButton} onClick={onSubstitute}>
              <ScheduleIcon name="swap" size={17} /> Substitute driver
            </button>
          </div>
          <button type="button" className={styles.dangerButton} onClick={onDelete}>
            <ScheduleIcon name="trash" size={17} /> Delete schedule
          </button>
        </div>
      </div>
    </details>
  );
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [serviceRegistry, setServiceRegistry] = useState<
    Record<string, ServiceBarangayRecord>
  >({});

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingOriginalSchedule, setEditingOriginalSchedule] = useState<Schedule | null>(null);
  const initialEditRouteIdRef = useRef("");
  const initialEditAreaIdsRef = useRef<string[]>([]);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  // Schedule-level coverage. These IDs are selected from the master Route,
  // but saving a schedule never mutates routes/{routeId}.
  const [selectedScheduleAreaIds, setSelectedScheduleAreaIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [substituteSchedule, setSubstituteSchedule] =
    useState<Schedule | null>(null);
  const [substituteStartDate, setSubstituteStartDate] = useState("");
  const [substituteEndDate, setSubstituteEndDate] = useState("");
  const [substituteDriverId, setSubstituteDriverId] = useState("");
  const [substituteReason, setSubstituteReason] = useState("");
  const [isSavingSubstitute, setIsSavingSubstitute] = useState(false);

  // Presentation state only. No new Firebase fields are introduced.
  const [step, setStep] = useState(0);
  const [areaSearch, setAreaSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "substitute">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stepError, setStepError] = useState("");
  const [presentationToday, setPresentationToday] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepNavigationRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updateDate = () => setPresentationToday(dateKeyForOffset(0));
    updateDate();
    const timer = window.setInterval(updateDate, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (showCreate) {
      stepHeadingRef.current?.focus();
      stepNavigationRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    setStepError("");
  }, [step, showCreate]);

  useEffect(() => {
    const unsubSchedules = onValue(ref(db, "schedules"), (snapshot) => {
      setLoading(false);
      setLoadError("");
      const value = snapshot.val() || {};
      setSchedules(
        Object.entries(value)
          .map(([id, raw]) => ({
            id,
            ...(raw as Omit<Schedule, "id">),
          }))
          .sort(
            (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
          ),
      );
    }, (error) => {
      setLoading(false);
      setLoadError(error.message || "Unable to load schedules. Check your connection and access permissions.");
    });

    const unsubDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      const value = snapshot.val() || {};
      setDrivers(
        Object.entries(value).map(([id, raw]) => ({
          id,
          ...(raw as Omit<Driver, "id">),
        })),
      );
    });

    const unsubRoutes = onValue(ref(db, "routes"), (snapshot) => {
      const value = snapshot.val() || {};
      setRoutes(
        Object.entries(value).map(([id, raw]) => ({
          id,
          ...(raw as Omit<RouteRecord, "id">),
        })),
      );
    });

    const unsubAreas = onValue(ref(db, "service_areas"), (snapshot) => {
      setServiceRegistry(snapshot.val() || {});
    });

    return () => {
      unsubSchedules();
      unsubDrivers();
      unsubRoutes();
      unsubAreas();
    };
  }, []);

  const availableBarangays = useMemo(
    () =>
      Object.entries(serviceRegistry)
        .filter(([, record]) => record.active !== false)
        .filter(([, record]) =>
          Object.values(record.puroks || {}).some(
            (purok) => purok.active !== false,
          ),
        )
        .map(([key, record]) => {
          const raw = record.barangay || key;
          return findOfficialBarangay(raw)?.name || raw;
        })
        .sort((a, b) => a.localeCompare(b)),
    [serviceRegistry],
  );

  const selectedBarangays = form.barangays;

  const matchingRoutes = useMemo(() => {
    if (selectedBarangays.length === 0) return [];

    return routes
      .filter(isSelectableRoute)
      .filter((route) =>
        routeCoversAllBarangays(route, selectedBarangays),
      )
      .sort((a, b) =>
        String(a.routeName || "").localeCompare(
          String(b.routeName || ""),
        ),
      );
  }, [routes, selectedBarangays]);

  useEffect(() => {
    if (!showCreate) return;

    if (selectedBarangays.length === 0) {
      setForm((current) => ({
        ...current,
        routeId: "",
        assignedDriverId: "",
        truckId: "",
      }));
      return;
    }

    if (matchingRoutes.length === 1) {
      const route = matchingRoutes[0];

      setForm((current) => {
        if (current.routeId === route.id) return current;

        return {
          ...current,
          routeId: route.id,
          assignedDriverId: "",
          truckId: "",
        };
      });
    } else if (
      form.routeId &&
      !matchingRoutes.some((route) => route.id === form.routeId)
    ) {
      setForm((current) => ({
        ...current,
        routeId: "",
        assignedDriverId: "",
        truckId: "",
      }));
    }
  }, [
    showCreate,
    selectedBarangays,
    form.routeId,
    matchingRoutes,
  ]);

  const selectedRoute = useMemo(
    () =>
      routes.find((route) => route.id === form.routeId) || null,
    [routes, form.routeId],
  );

  const routeAreas = useMemo(() => {
    if (!selectedRoute || selectedBarangays.length === 0) return [];

    return getRouteAreasForBarangays(
      selectedRoute,
      selectedBarangays,
    );
  }, [selectedRoute, selectedBarangays]);

  const routeCoverageGroups = useMemo(
    () => groupAreasByBarangay(routeAreas),
    [routeAreas],
  );

  const selectedScheduleAreas = useMemo(
    () => routeAreas.filter((area) => selectedScheduleAreaIds.includes(serviceAreaId(area))),
    [routeAreas, selectedScheduleAreaIds],
  );

  const selectedCoverageGroups = useMemo(
    () => groupAreasByBarangay(selectedScheduleAreas),
    [selectedScheduleAreas],
  );

  // Default a newly selected Route to all of its Puroks. During Edit, keep
  // the schedule's saved Purok selection instead of expanding it back to the
  // entire master Route. If the admin chooses a different Route while editing,
  // its coverage is selected initially and can still be adjusted in Step 3.
  useEffect(() => {
    if (!showCreate || !selectedRoute) {
      setSelectedScheduleAreaIds([]);
      return;
    }

    const validIds = routeAreas.map(serviceAreaId);

    if (!editingScheduleId) {
      setSelectedScheduleAreaIds(validIds);
      return;
    }

    if (selectedRoute.id !== initialEditRouteIdRef.current) {
      setSelectedScheduleAreaIds(validIds);
      return;
    }

    const validSet = new Set(validIds);
    let initialIds = initialEditAreaIdsRef.current.filter((id) => validSet.has(id));

    // Legacy schedules may have aggregate Purok fields but no exact areas.
    // Recover only the Puroks explicitly stored on the schedule.
    if (initialIds.length === 0 && editingOriginalSchedule) {
      const legacyPurokKeys = new Set(
        getSchedulePuroks(editingOriginalSchedule).map(makePurokKey).filter(Boolean),
      );
      initialIds = routeAreas
        .filter((area) => legacyPurokKeys.has(makePurokKey(area.purok)))
        .map(serviceAreaId);
    }

    setSelectedScheduleAreaIds((current) => {
      const currentValid = current.filter((id) => validSet.has(id));
      return currentValid.length > 0 ? currentValid : initialIds;
    });
  }, [
    showCreate,
    selectedRoute,
    routeAreas,
    editingScheduleId,
    editingOriginalSchedule,
  ]);

  const routePuroks = useMemo(
    () =>
      Array.from(
        new Set(
          selectedScheduleAreas
            .map((area) => normalizePurokLabel(area.purok))
            .filter(Boolean),
        ),
      ).sort(
        (a, b) =>
          Number(a.match(/\d+/)?.[0] || 0) -
          Number(b.match(/\d+/)?.[0] || 0),
      ),
    [selectedScheduleAreas],
  );

  const selectedTimeWindowValid = isValidTimeWindow(
    form.startTime,
    form.endTime,
  );

  const availableDriversForNewSchedule = useMemo(() => {
    if (
      selectedDays.length === 0 ||
      !selectedTimeWindowValid
    ) {
      return drivers.filter((driver) =>
        isDriverOperationallyAvailable(driver),
      );
    }

    return drivers.filter((driver) => {
      if (!isDriverOperationallyAvailable(driver)) return false;

      return !hasRecurringDriverConflict(
        schedules,
        driver.id,
        selectedDays,
        form.startTime,
        form.endTime,
        editingScheduleId || "",
      );
    });
  }, [
    drivers,
    schedules,
    selectedDays,
    form.startTime,
    form.endTime,
    selectedTimeWindowValid,
    editingScheduleId,
  ]);

  useEffect(() => {
    if (!selectedRoute) return;

    const routeDefaultDriver = drivers.find(
      (driver) => driver.id === selectedRoute.assignedDriverId,
    );

    setForm((current) => {
      const currentDriverStillAvailable = availableDriversForNewSchedule.some(
        (driver) => driver.id === current.assignedDriverId,
      );

      if (currentDriverStillAvailable) return current;

      const preferred =
        routeDefaultDriver &&
        availableDriversForNewSchedule.some(
          (driver) => driver.id === routeDefaultDriver.id,
        )
          ? routeDefaultDriver
          : availableDriversForNewSchedule[0];

      return {
        ...current,
        assignedDriverId: preferred?.id || "",
        truckId:
          preferred?.truck ||
          selectedRoute.assignedVehicle ||
          current.truckId ||
          "",
      };
    });
  }, [
    selectedRoute,
    drivers,
    availableDriversForNewSchedule,
  ]);

  const filteredSchedules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schedules;

    return schedules.filter((schedule) =>
      [
        schedule.title,
        getScheduleBarangays(schedule).join(" "),
        getSchedulePuroks(schedule).join(" "),
        schedule.routeName,
        schedule.driverName,
        schedule.truckId,
        getScheduleDays(schedule).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [schedules, search]);

  const affectedSubstituteDates = useMemo(() => {
    if (
      !substituteSchedule ||
      !substituteStartDate ||
      !substituteEndDate
    ) {
      return [];
    }

    return scheduledDateKeysInRange(
      substituteSchedule,
      substituteStartDate,
      substituteEndDate,
    );
  }, [
    substituteSchedule,
    substituteStartDate,
    substituteEndDate,
  ]);

  const substituteCandidates = useMemo(() => {
    if (!substituteSchedule || affectedSubstituteDates.length === 0) {
      return [];
    }

    const regularDriverId = String(
      substituteSchedule.defaultDriverId ||
        substituteSchedule.assignedDriverId ||
        substituteSchedule.driverId ||
        "",
    );

    return drivers.filter((driver) => {
      if (driver.id === regularDriverId) return false;

      return affectedSubstituteDates.every((dateKey) => {
        if (!isDriverOperationallyAvailable(driver, dateKey)) {
          return false;
        }

        return !hasDriverConflictOnDate(
          schedules,
          driver.id,
          dateKey,
          String(substituteSchedule.startTime || ""),
          String(substituteSchedule.endTime || ""),
          substituteSchedule.id,
        );
      });
    });
  }, [
    drivers,
    schedules,
    substituteSchedule,
    affectedSubstituteDates,
  ]);

  const existingOverridesInSelectedRange = useMemo(() => {
    if (!substituteSchedule) return [];

    return affectedSubstituteDates.filter((dateKey) =>
      Boolean(driverOverrideForDate(substituteSchedule, dateKey)),
    );
  }, [substituteSchedule, affectedSubstituteDates]);

  const resetCreate = () => {
    setStep(0);
    setAreaSearch("");
    setStepError("");
    setForm(EMPTY_CREATE_FORM);
    setSelectedDays([]);
    setSelectedScheduleAreaIds([]);
    setEditingScheduleId(null);
    setEditingOriginalSchedule(null);
    initialEditRouteIdRef.current = "";
    initialEditAreaIdsRef.current = [];
    setIsSaving(false);
  };

  const closeCreate = () => {
    setShowCreate(false);
    resetCreate();
  };

  const openCreateSchedule = () => {
    resetCreate();
    setSuccessMessage("");
    setShowCreate(true);
  };

  const openEditSchedule = (schedule: Schedule) => {
    const scheduleBarangays = getScheduleBarangays(schedule);
    const storedRouteId = String(
      schedule.routeId ||
        schedule.assignedRouteId ||
        routes.find(
          (route) =>
            cleanText(route.routeName) &&
            cleanText(route.routeName) === cleanText(schedule.routeName),
        )?.id ||
        "",
    );
    const savedAreas = getServiceAreas(schedule.areas);
    const regularDriverId = String(
      schedule.assignedDriverId ||
        schedule.driverId ||
        schedule.defaultDriverId ||
        "",
    );

    setSuccessMessage("");
    setStepError("");
    setAreaSearch("");
    setStep(0);
    setEditingScheduleId(schedule.id);
    setEditingOriginalSchedule(schedule);
    initialEditRouteIdRef.current = storedRouteId;
    initialEditAreaIdsRef.current = savedAreas.map(serviceAreaId);
    setForm({
      title: String(schedule.title || ""),
      barangays: scheduleBarangays,
      routeId: storedRouteId,
      startTime: String(schedule.startTime || ""),
      endTime: String(schedule.endTime || ""),
      assignedDriverId: regularDriverId,
      truckId: String(schedule.truckId || ""),
      notes: String(schedule.notes || ""),
    });
    setSelectedDays(getScheduleDays(schedule));
    setSelectedScheduleAreaIds(savedAreas.map(serviceAreaId));
    setIsSaving(false);
    setShowCreate(true);
  };

  const toggleBarangay = (barangay: string) => {
    setForm((current) => {
      const exists = current.barangays.some(
        (item) =>
          makeBarangayKey(item) === makeBarangayKey(barangay),
      );

      const nextBarangays = exists
        ? current.barangays.filter(
            (item) =>
              makeBarangayKey(item) !==
              makeBarangayKey(barangay),
          )
        : [...current.barangays, barangay];

      return {
        ...current,
        barangays: availableBarangays.filter((item) =>
          nextBarangays.some(
            (selected) =>
              makeBarangayKey(selected) ===
              makeBarangayKey(item),
          ),
        ),
        routeId: "",
        assignedDriverId: "",
        truckId: "",
      };
    });
  };

  const clearBarangays = () => {
    setForm((current) => ({
      ...current,
      barangays: [],
      routeId: "",
      assignedDriverId: "",
      truckId: "",
    }));
  };

  const setRoute = (routeId: string) => {
    setSelectedScheduleAreaIds(
      editingScheduleId && routeId === initialEditRouteIdRef.current
        ? [...initialEditAreaIdsRef.current]
        : [],
    );
    setForm((current) => ({
      ...current,
      routeId,
      assignedDriverId:
        editingScheduleId && routeId === initialEditRouteIdRef.current
          ? String(
              editingOriginalSchedule?.assignedDriverId ||
                editingOriginalSchedule?.driverId ||
                editingOriginalSchedule?.defaultDriverId ||
                "",
            )
          : "",
      truckId:
        editingScheduleId && routeId === initialEditRouteIdRef.current
          ? String(editingOriginalSchedule?.truckId || "")
          : "",
    }));
  };

  const toggleScheduleArea = (area: ServiceArea) => {
    const id = serviceAreaId(area);
    setSelectedScheduleAreaIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const setBarangayScheduleCoverage = (barangay: string, selected: boolean) => {
    const key = makeBarangayKey(barangay);
    const ids = routeAreas
      .filter((area) => makeBarangayKey(area.barangay) === key)
      .map(serviceAreaId);

    setSelectedScheduleAreaIds((current) => {
      const withoutBarangay = current.filter((id) => !ids.includes(id));
      return selected ? [...withoutBarangay, ...ids] : withoutBarangay;
    });
  };

  const toggleDay = (day: string) => {
    setSelectedDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : DAYS.filter((item) => [...current, day].includes(item)),
    );
  };

  const sendDriverOperationalPush = async ({
    driverId,
    title,
    message,
    type,
    scheduleId = "",
    routeId = "",
    routeName = "",
    substituteFrom = "",
    substituteUntil = "",
    affectedDates = [],
    reason = "",
    assignmentRole = "",
    voiceMessage = "",
  }: {
    driverId: string;
    title: string;
    message: string;
    type: string;
    scheduleId?: string;
    routeId?: string;
    routeName?: string;
    substituteFrom?: string;
    substituteUntil?: string;
    affectedDates?: string[];
    reason?: string;
    assignmentRole?: string;
    voiceMessage?: string;
  }) => {
    if (!driverId) return;

    try {
      const admin = auth.currentUser;
      if (!admin) return;
      const idToken = await admin.getIdToken();

      const response = await fetch("/api/send-alert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title,
          message,
          type,
          target: "driver",
          targetUid: driverId,
          scheduleId,
          routeId,
          routeName,
          substituteFrom,
          substituteUntil,
          affectedDates,
          reason,
          assignmentRole,
          voiceMessage,
        }),
      });

      if (!response.ok) {
        console.warn("Driver notification was not confirmed:", await response.text());
      }
    } catch (error) {
      // Saving the schedule remains authoritative. FCM is best-effort.
      console.warn("Driver notification failed:", error);
    }
  };

  const scheduleCoverageSummary = (areas: ServiceArea[]): string => {
    const groups = groupAreasByBarangay(areas);
    if (!groups.length) return "No Purok coverage recorded";
    return groups
      .map((group) =>
        `${group.barangay}: ${group.puroks.length ? group.puroks.join(", ") : "Purok details not recorded"}`,
      )
      .join(" • ");
  };

  const affectedDatesSummary = (dateKeys: string[]): string => {
    if (!dateKeys.length) return "No collection dates";
    if (dateKeys.length <= 3) return dateKeys.map(formatDateKey).join(" • ");
    return `${dateKeys.length} collection dates from ${formatDateKey(dateKeys[0])} to ${formatDateKey(dateKeys[dateKeys.length - 1])}`;
  };

  const createScheduleNotification = async ({
    scheduleId,
    title,
    barangays,
    areas,
    days,
    startTime,
    endTime,
    status,
    notes,
  }: {
    scheduleId: string;
    title: string;
    barangays: string[];
    areas: ServiceArea[];
    days: string[];
    startTime: string;
    endTime: string;
    status: "created" | "updated" | "cancelled";
    notes?: string;
  }) => {
    const timestamp = Date.now();
    const dayLabel = formatDayList(days);
    const allBarangays = Array.from(
      new Set(
        barangays.map((item) => item.trim()).filter(Boolean),
      ),
    );

    const notificationTitle =
      status === "created"
        ? "New weekly garbage collection schedule"
        : status === "updated"
          ? "Garbage collection schedule updated"
          : "Garbage collection schedule cancelled";

    const writes: Promise<void>[] = [];

    for (const area of areas) {
      const areaBarangay = String(area.barangay || "").trim();
      if (!areaBarangay) continue;

      const purok = normalizePurokLabel(area.purok);
      const barangayKey = makeBarangayKey(areaBarangay);
      const purokKey = makePurokKey(purok);
      const areaName = purok
        ? `${areaBarangay}, ${purok}`
        : areaBarangay;

      const timeText = endTime
        ? `${formatTime(startTime)} – ${formatTime(endTime)}`
        : formatTime(startTime);

      const message =
        status === "created"
          ? `Garbage collection for ${areaName} is scheduled every ${dayLabel}, ${timeText}.`
          : status === "updated"
            ? `Garbage collection for ${areaName} was updated to every ${dayLabel}, ${timeText}.`
            : `The garbage collection schedule for ${areaName} has been cancelled.`;

      const data = {
        type: "schedule",
        status,
        title: notificationTitle,
        message,
        scheduleId,
        scheduleTitle: title,
        notes: notes || "",
        barangay: areaBarangay,
        barangayKey,
        barangays: allBarangays,
        barangayKeys: allBarangays.map(makeBarangayKey),
        purok,
        puroks: purok ? [purok] : [],
        assignedPuroks: purok ? [purok] : [],
        purokKey,
        purokKeys: purokKey ? [purokKey] : [],
        scheduleDay: days[0] || "",
        scheduleDays: days,
        startTime,
        endTime,
        scheduleType: "weekly",
        repeat: "weekly",
        isRecurring: true,
        seen: false,
        createdAt: timestamp,
        timestamp,
      };

      writes.push(
        set(push(ref(db, "notifications")), data),
        set(
          push(
            ref(
              db,
              `notificationsByArea/${barangayKey}/${purokKey || "all"}`,
            ),
          ),
          data,
        ),
      );
    }

    await Promise.all(writes);

    try {
      const admin = auth.currentUser;
      if (!admin) return;

      const idToken = await admin.getIdToken();

      await Promise.allSettled(
        areas.map(async (area) => {
          const areaBarangay = String(
            area.barangay || "",
          ).trim();

          if (!areaBarangay) return;

          const purok = normalizePurokLabel(area.purok);
          const areaName = purok
            ? `${areaBarangay}, ${purok}`
            : areaBarangay;

          const timeText = endTime
            ? `${formatTime(startTime)} – ${formatTime(endTime)}`
            : formatTime(startTime);

          const message =
            status === "created"
              ? `Garbage collection for ${areaName} is scheduled every ${dayLabel}, ${timeText}.`
              : status === "updated"
                ? `Garbage collection for ${areaName} was updated to every ${dayLabel}, ${timeText}.`
                : `The garbage collection schedule for ${areaName} has been cancelled.`;

          const response = await fetch("/api/send-alert", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              title: notificationTitle,
              message,
              type: "schedule",
              target: "resident",
              barangay: areaBarangay,
              barangays: [areaBarangay],
              puroks: purok ? [purok] : [],
              startTime,
              endTime,
              scheduleId,
              scheduleTitle: title,
              status,
            }),
          });

          if (!response.ok) {
            throw new Error(await response.text());
          }
        }),
      );
    } catch (error) {
      console.warn(
        "Schedule saved, but one or more FCM schedule pushes failed:",
        error,
      );
    }
  };

  const createScheduleCoverageRemovalNotification = async ({
    scheduleId,
    title,
    areas,
  }: {
    scheduleId: string;
    title: string;
    areas: ServiceArea[];
  }) => {
    if (!areas.length) return;

    const timestamp = Date.now();
    const notificationTitle = "Garbage collection schedule updated";
    const writes: Promise<void>[] = [];

    for (const area of areas) {
      const areaBarangay = String(area.barangay || "").trim();
      if (!areaBarangay) continue;
      const purok = normalizePurokLabel(area.purok);
      const barangayKey = makeBarangayKey(areaBarangay);
      const purokKey = makePurokKey(purok);
      const areaName = purok ? `${areaBarangay}, ${purok}` : areaBarangay;
      const message = `The schedule “${title}” was updated. ${areaName} is no longer included in this collection schedule.`;
      const data = {
        type: "schedule",
        status: "updated",
        changeType: "coverage_removed",
        title: notificationTitle,
        message,
        scheduleId,
        scheduleTitle: title,
        barangay: areaBarangay,
        barangayKey,
        purok,
        purokKey,
        seen: false,
        createdAt: timestamp,
        timestamp,
      };

      writes.push(
        set(push(ref(db, "notifications")), data),
        set(
          push(
            ref(db, `notificationsByArea/${barangayKey}/${purokKey || "all"}`),
          ),
          data,
        ),
      );
    }

    await Promise.all(writes);

    try {
      const admin = auth.currentUser;
      if (!admin) return;
      const idToken = await admin.getIdToken();

      await Promise.allSettled(
        areas.map(async (area) => {
          const areaBarangay = String(area.barangay || "").trim();
          if (!areaBarangay) return;
          const purok = normalizePurokLabel(area.purok);
          const areaName = purok ? `${areaBarangay}, ${purok}` : areaBarangay;
          const message = `The schedule “${title}” was updated. ${areaName} is no longer included in this collection schedule.`;

          const response = await fetch("/api/send-alert", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              title: notificationTitle,
              message,
              type: "schedule",
              target: "resident",
              barangay: areaBarangay,
              barangays: [areaBarangay],
              puroks: purok ? [purok] : [],
              scheduleId,
              scheduleTitle: title,
              status: "updated",
              changeType: "coverage_removed",
            }),
          });

          if (!response.ok) throw new Error(await response.text());
        }),
      );
    } catch (error) {
      console.warn(
        "Schedule was updated, but removed-area push notifications could not all be confirmed:",
        error,
      );
    }
  };

  const saveSchedule = async () => {
    setSuccessMessage("");

    if (selectedBarangays.length === 0) {
      return alert("Select at least one Barangay.");
    }

    if (!form.routeId) {
      return alert(
        "Select a verified route that covers all selected Barangays.",
      );
    }

    if (routeAreas.length === 0) {
      return alert(
        "The selected route has no Barangay/Purok coverage for the selected service areas.",
      );
    }

    if (selectedScheduleAreas.length === 0) {
      return alert("Select at least one Purok for this collection schedule.");
    }

    if (selectedDays.length === 0) {
      return alert(
        "Select at least one weekly collection day.",
      );
    }

    if (!form.startTime || !form.endTime) {
      return alert(
        "Set the collection start and expected end time.",
      );
    }

    if (!selectedTimeWindowValid) {
      return alert(
        "Start and expected end time cannot be the same. Choose a different end time.",
      );
    }

    const route = selectedRoute;

    if (!route || !isSelectableRoute(route)) {
      return alert(
        "The selected route is not active and verified.",
      );
    }

    if (
      !routeCoversAllBarangays(
        route,
        selectedBarangays,
      )
    ) {
      return alert(
        "The selected route no longer covers every selected Barangay.",
      );
    }

    const missingBarangays =
      selectedBarangays.filter((barangay) => {
        const key = makeBarangayKey(barangay);
        return !selectedScheduleAreas.some(
          (area) => makeBarangayKey(area.barangay) === key,
        );
      });

    if (missingBarangays.length > 0) {
      return alert(
        `Select at least one Purok for each Barangay. Missing schedule coverage for: ${missingBarangays.join(
          ", ",
        )}.`,
      );
    }

    const driver = drivers.find(
      (item) => item.id === form.assignedDriverId,
    );

    if (!driver) {
      return alert("Select an available driver.");
    }

    if (
      !availableDriversForNewSchedule.some(
        (item) => item.id === driver.id,
      )
    ) {
      return alert(
        "The selected driver is unavailable or already assigned to an overlapping collection schedule.",
      );
    }

    try {
      setIsSaving(true);

      const existingSchedule = editingScheduleId
        ? editingOriginalSchedule ||
          schedules.find((schedule) => schedule.id === editingScheduleId) ||
          null
        : null;
      const scheduleRef = editingScheduleId
        ? ref(db, `schedules/${editingScheduleId}`)
        : push(ref(db, "schedules"));
      const scheduleId = editingScheduleId || scheduleRef.key;

      if (!scheduleId) {
        throw new Error("Unable to create schedule ID.");
      }

      const timestamp = Date.now();

      const resolvedTitle =
        form.title.trim() ||
        (selectedBarangays.length === 1
          ? `${selectedBarangays[0]} Weekly Collection`
          : `${selectedBarangays.length}-Barangay Weekly Collection`);

      const areas = selectedScheduleAreas.map((area, index) => ({
        ...area,
        barangay: String(area.barangay || "").trim(),
        barangayKey: makeBarangayKey(area.barangay),
        purok: normalizePurokLabel(area.purok),
        purokKey: makePurokKey(area.purok),
        order: Number(area.order ?? index),
        startTime: form.startTime,
      }));

      // Schedule coverage is authoritative for the Driver and Resident apps.
      // Do not repopulate the legacy Purok arrays from the whole master route.
      const puroks = Array.from(
        new Set(
          areas
            .map((area) => normalizePurokLabel(area.purok))
            .filter(Boolean),
        ),
      ).sort(
        (a, b) =>
          Number(a.match(/\d+/)?.[0] || 0) -
          Number(b.match(/\d+/)?.[0] || 0),
      );

      const purokTimes = Object.fromEntries(
        puroks.map((purok) => [purok, form.startTime]),
      );

      const collectionTimesByPurok = Object.fromEntries(
        puroks.map((purok) => [makePurokKey(purok), form.startTime]),
      );

      const truck =
        form.truckId.trim() ||
        driver.truck ||
        route.assignedVehicle ||
        "";

      const primaryBarangay =
        selectedBarangays[0] || "";

      const targetType =
        selectedBarangays.length > 1
          ? "multiple_barangays_route_coverage"
          : puroks.length > 1
            ? "barangay_multiple_puroks"
            : "barangay_purok";

      const payload = {
        title: resolvedTitle,

        // Legacy primary fields remain for old readers.
        barangay: primaryBarangay,
        barangayKey: makeBarangayKey(primaryBarangay),

        // Authoritative multi-Barangay coverage.
        barangays: selectedBarangays,
        barangayKeys: selectedBarangays.map(makeBarangayKey),
        areas,
        coverageSource: "schedule-selected-from-route",
        routeCoverageAreaCount: routeAreas.length,
        selectedCoverageAreaCount: areas.length,

        // Legacy-compatible Purok fields remain populated for the Driver and Resident apps.
        purok:
          puroks.length > 1
            ? puroks.join(", ")
            : puroks[0] || "",
        assignedPuroks: puroks,
        puroks: puroks.map((purok) =>
          Number(purok.match(/\d+/)?.[0] || 0),
        ),
        purokKeys: puroks.map(makePurokKey),
        purokTimes,
        collectionTimesByPurok,

        scheduleDay: selectedDays[0],
        scheduleDays: selectedDays,
        startTime: form.startTime,
        endTime: form.endTime,
        collectionWindowMinutes:
          timeWindowDurationMinutes(
            form.startTime,
            form.endTime,
          ) || 0,

        assignedDriverId: driver.id,
        driverId: driver.id,
        driverName: driver.name || "",
        defaultDriverId: driver.id,
        defaultDriverName: driver.name || "",
        truckId: truck,

        routeId: route.id,
        assignedRouteId: route.id,
        routeName: route.routeName || "",
        routeModel: "service-area-live-gps",
        routeType: "service-area-route",
        trackingMode: "live-gps",
        routeVerified: true,

        notes: form.notes.trim(),
        status: existingSchedule?.status || "active",
        scheduleType: "weekly",
        repeat: "weekly",
        recurrence: {
          frequency: "weekly",
          dayOfWeek: selectedDays[0],
          daysOfWeek: selectedDays,
          time: form.startTime,
          endTime: form.endTime,
        },
        isRecurring: true,
        targetType,

        createdAt: existingSchedule?.createdAt || timestamp,
        updatedAt: timestamp,
        ...(editingScheduleId
          ? {
              lastEditedAt: timestamp,
              lastEditedBy: auth.currentUser?.uid || "admin",
            }
          : {}),
      };

      let clearDriverOverrides = false;
      if (existingSchedule && Object.keys(existingSchedule.driverOverrides || {}).length > 0) {
        const oldDriverId = String(
          existingSchedule.assignedDriverId ||
            existingSchedule.driverId ||
            existingSchedule.defaultDriverId ||
            "",
        );
        const oldRouteId = String(
          existingSchedule.routeId || existingSchedule.assignedRouteId || "",
        );
        const oldDays = getScheduleDays(existingSchedule);
        const oldAreas = getServiceAreas(existingSchedule.areas);
        const oldAreaKeys = oldAreas.map(serviceAreaId).sort();
        const newAreaKeys = areas.map(serviceAreaId).sort();
        const operationalDefinitionChanged =
          oldDriverId !== driver.id ||
          oldRouteId !== route.id ||
          String(existingSchedule.startTime || "") !== form.startTime ||
          String(existingSchedule.endTime || "") !== form.endTime ||
          JSON.stringify(oldDays) !== JSON.stringify(selectedDays) ||
          JSON.stringify(oldAreaKeys) !== JSON.stringify(newAreaKeys);

        if (operationalDefinitionChanged) {
          const accepted = window.confirm(
            "This schedule has temporary substitute assignments. Changing its route, coverage, days, time, or regular driver can make those overrides invalid. Continue and remove the existing temporary substitutions?",
          );
          if (!accepted) {
            setIsSaving(false);
            return;
          }
          clearDriverOverrides = true;
        }
      }

      if (editingScheduleId) {
        await update(scheduleRef, {
          ...payload,
          ...(clearDriverOverrides ? { driverOverrides: null } : {}),
        });
      } else {
        await set(scheduleRef, payload);
      }

      await createScheduleNotification({
        scheduleId,
        title: resolvedTitle,
        barangays: selectedBarangays,
        areas,
        days: selectedDays,
        startTime: form.startTime,
        endTime: form.endTime,
        status: editingScheduleId ? "updated" : "created",
        notes: form.notes.trim(),
      });

      if (existingSchedule) {
        const currentAreaIds = new Set(areas.map(serviceAreaId));
        const removedAreas = getServiceAreas(existingSchedule.areas).filter(
          (area) => !currentAreaIds.has(serviceAreaId(area)),
        );
        if (removedAreas.length > 0) {
          await createScheduleCoverageRemovalNotification({
            scheduleId,
            title: resolvedTitle,
            areas: removedAreas,
          });
        }
      }

      const coverageLabel = scheduleCoverageSummary(areas);
      const scheduleWindow = `${formatTime(form.startTime)} – ${formatTime(form.endTime)}`;
      await sendDriverOperationalPush({
        driverId: driver.id,
        title: editingScheduleId
          ? "Collection schedule updated"
          : "New collection schedule assigned",
        message: `${resolvedTitle}. ${formatDayList(selectedDays)}, ${scheduleWindow}. Route: ${route.routeName || "Collection route"}. Coverage: ${coverageLabel}. Truck: ${truck || "not recorded"}.`,
        type: editingScheduleId
          ? "driver_schedule_updated"
          : "driver_schedule_assignment",
        scheduleId,
        routeId: route.id,
        routeName: route.routeName || "",
        assignmentRole: "regular_driver",
      });

      if (existingSchedule) {
        const previousDriverId = String(
          existingSchedule.assignedDriverId ||
            existingSchedule.driverId ||
            existingSchedule.defaultDriverId ||
            "",
        );
        if (previousDriverId && previousDriverId !== driver.id) {
          await sendDriverOperationalPush({
            driverId: previousDriverId,
            title: "Collection schedule reassigned",
            message: `You are no longer the regular driver for ${resolvedTitle}. The schedule is now assigned to ${driver.name || "another driver"}.`,
            type: "driver_schedule_reassigned",
            scheduleId,
            routeId: route.id,
            routeName: route.routeName || "",
            assignmentRole: "previous_regular_driver",
          });
        }
      }

      setSuccessMessage(
        editingScheduleId
          ? `Schedule updated for ${selectedBarangays.join(", ")}. The assigned Driver and affected Resident views will use the revised coverage, days, time, and assignment automatically.`
          : `Schedule created for ${selectedBarangays.join(
              ", ",
            )}. ${route.routeName || "Route"} coverage was loaded automatically.`,
      );

      closeCreate();
    } catch (error) {
      console.error(
        editingScheduleId ? "Unable to update schedule:" : "Unable to create schedule:",
        error,
      );

      alert(
        error instanceof Error && error.message.trim()
          ? `Unable to ${editingScheduleId ? "update" : "create"} the schedule: ${error.message}`
          : `Unable to ${editingScheduleId ? "update" : "create"} the schedule.`,
      );

      setIsSaving(false);
    }
  };

  const openSubstitute = (schedule: Schedule) => {
    const today = dateKeyForOffset(0);

    setSubstituteSchedule(schedule);
    setSubstituteStartDate(today);
    setSubstituteEndDate(today);

    const existingToday = driverOverrideForDate(schedule, today);

    setSubstituteDriverId(
      existingToday?.substituteDriverId || "",
    );
    setSubstituteReason(
      existingToday?.reason || "Driver unavailable",
    );
  };

  const closeSubstitute = () => {
    setSubstituteSchedule(null);
    setSubstituteStartDate("");
    setSubstituteEndDate("");
    setSubstituteDriverId("");
    setSubstituteReason("");
    setIsSavingSubstitute(false);
  };

  useEffect(() => {
    if (
      !substituteSchedule ||
      affectedSubstituteDates.length === 0
    ) {
      setSubstituteDriverId("");
      return;
    }

    const firstDate = affectedSubstituteDates[0];
    const existing = driverOverrideForDate(
      substituteSchedule,
      firstDate,
    );

    if (
      existing &&
      affectedSubstituteDates.every((dateKey) => {
        const candidate = driverOverrideForDate(
          substituteSchedule,
          dateKey,
        );
        return (
          candidate?.substituteDriverId ===
          existing.substituteDriverId
        );
      })
    ) {
      setSubstituteDriverId(
        existing.substituteDriverId || "",
      );
      setSubstituteReason(
        existing.reason || "Driver unavailable",
      );
    } else {
      setSubstituteDriverId("");
    }
  }, [substituteSchedule, affectedSubstituteDates]);

  const saveTemporarySubstitute = async () => {
    if (!substituteSchedule) return;

    if (!substituteStartDate || !substituteEndDate) {
      return alert("Select the start and end date.");
    }

    if (substituteEndDate < substituteStartDate) {
      return alert("Until date cannot be earlier than the start date.");
    }

    if (affectedSubstituteDates.length === 0) {
      return alert(
        `There are no scheduled collection days between ${formatDateKey(
          substituteStartDate,
        )} and ${formatDateKey(substituteEndDate)}. This schedule runs on ${formatDayList(
          getScheduleDays(substituteSchedule),
        )}.`,
      );
    }

    const substitute = drivers.find(
      (driver) => driver.id === substituteDriverId,
    );

    if (!substitute) {
      return alert("Select an available substitute driver.");
    }

    if (
      !substituteCandidates.some(
        (driver) => driver.id === substitute.id,
      )
    ) {
      return alert(
        "That driver is unavailable or has an overlapping collection on at least one affected collection date.",
      );
    }

    if (
      existingOverridesInSelectedRange.length > 0 &&
      !window.confirm(
        `${existingOverridesInSelectedRange.length} affected collection date(s) already have a temporary substitute. Replace those overrides with ${substitute.name || "the selected driver"}?`,
      )
    ) {
      return;
    }

    const originalDriverId = String(
      substituteSchedule.defaultDriverId ||
        substituteSchedule.assignedDriverId ||
        substituteSchedule.driverId ||
        "",
    );

    const originalDriverName =
      substituteSchedule.defaultDriverName ||
      substituteSchedule.driverName ||
      drivers.find((driver) => driver.id === originalDriverId)?.name ||
      "";

    try {
      setIsSavingSubstitute(true);

      const now = Date.now();
      const overrideGroupId = `sub_${now}_${substitute.id}`;
      const writes: Promise<void>[] = [];

      for (const dateKey of affectedSubstituteDates) {
        const override: DriverOverride = {
          date: dateKey,
          rangeStartDate: substituteStartDate,
          rangeEndDate: substituteEndDate,
          overrideGroupId,
          originalDriverId,
          originalDriverName,
          substituteDriverId: substitute.id,
          substituteDriverName: substitute.name || "",
          reason: substituteReason.trim() || "Driver unavailable",
          status: "active",
          createdAt: now,
          createdBy: auth.currentUser?.uid || "",
        };

        writes.push(
          set(
            ref(
              db,
              `schedules/${substituteSchedule.id}/driverOverrides/${dateKey}`,
            ),
            override,
          ),
        );
      }

      await Promise.all(writes);

      await update(
        ref(db, `schedules/${substituteSchedule.id}`),
        { updatedAt: now },
      );

      const exactDateLabel = affectedDatesSummary(affectedSubstituteDates);
      const substituteAreas = getServiceAreas(substituteSchedule.areas);
      const substituteCoverage = substituteAreas.length
        ? scheduleCoverageSummary(substituteAreas)
        : `${getScheduleBarangays(substituteSchedule).join(", ") || "Barangay not recorded"}: ${getSchedulePuroks(substituteSchedule).join(", ") || "Puroks not recorded"}`;
      const substituteTime = `${formatTime(substituteSchedule.startTime)} – ${formatTime(substituteSchedule.endTime)}`;
      const substituteReasonText = substituteReason.trim() || "Driver unavailable";

      await sendDriverOperationalPush({
        driverId: substitute.id,
        title: "Temporary substitute assignment",
        message: `You are the substitute driver for ${substituteSchedule.title || "this collection schedule"}. Collection date(s): ${exactDateLabel}. Time: ${substituteTime}. Coverage: ${substituteCoverage}. Route: ${substituteSchedule.routeName || "Not recorded"}. Truck: ${substituteSchedule.truckId || "Not recorded"}. Regular driver: ${originalDriverName || "Not recorded"}. Reason: ${substituteReasonText}. After the assigned date(s), the regular driver resumes automatically.`,
        type: "driver_substitute_assignment",
        scheduleId: substituteSchedule.id,
        routeId: String(substituteSchedule.routeId || substituteSchedule.assignedRouteId || ""),
        routeName: substituteSchedule.routeName || "",
        substituteFrom: substituteStartDate,
        substituteUntil: substituteEndDate,
        affectedDates: affectedSubstituteDates,
        reason: substituteReasonText,
        assignmentRole: "substitute_driver",
        voiceMessage: `WasteTrack alert. You are the temporary substitute driver for ${substituteSchedule.title || "this collection schedule"}. Collection date${affectedSubstituteDates.length === 1 ? "" : "s"}: ${exactDateLabel}. Time: ${substituteTime}. Coverage: ${substituteCoverage}. Reason: ${substituteReasonText}. Your temporary assignment ends after these scheduled collection date${affectedSubstituteDates.length === 1 ? "" : "s"}, then the regular driver resumes automatically.`,
      });

      if (originalDriverId && originalDriverId !== substitute.id) {
        await sendDriverOperationalPush({
          driverId: originalDriverId,
          title: "Temporary substitute assigned",
          message: `${substitute.name || "A substitute driver"} will cover ${substituteSchedule.title || "your collection schedule"} on ${exactDateLabel}. Your regular assignment resumes automatically after the substitute period.`,
          type: "driver_substitute_regular_notice",
          scheduleId: substituteSchedule.id,
          routeId: String(substituteSchedule.routeId || substituteSchedule.assignedRouteId || ""),
          routeName: substituteSchedule.routeName || "",
          substituteFrom: substituteStartDate,
          substituteUntil: substituteEndDate,
          affectedDates: affectedSubstituteDates,
          reason: substituteReasonText,
          assignmentRole: "regular_driver",
        });
      }

      setSuccessMessage(
        `${substitute.name || "Substitute driver"} assigned for ${affectedSubstituteDates.length} scheduled collection date(s) from ${formatDateKey(
          substituteStartDate,
        )} to ${formatDateKey(
          substituteEndDate,
        )}. The regular driver is used automatically after this period.`,
      );

      closeSubstitute();
    } catch (error) {
      console.error("Unable to save temporary substitute range:", error);
      alert("Unable to save the temporary driver substitution.");
      setIsSavingSubstitute(false);
    }
  };

  const removeTemporarySubstitute = async () => {
    if (!substituteSchedule) return;

    const datesToRemove = affectedSubstituteDates.filter((dateKey) =>
      Boolean(driverOverrideForDate(substituteSchedule, dateKey)),
    );

    if (datesToRemove.length === 0) {
      return alert(
        "There is no temporary substitute in the selected scheduled-date range.",
      );
    }

    if (
      !window.confirm(
        `Remove the temporary substitute from ${datesToRemove.length} scheduled collection date(s) between ${formatDateKey(
          substituteStartDate,
        )} and ${formatDateKey(
          substituteEndDate,
        )}? The regular driver will be used automatically.`,
      )
    ) {
      return;
    }

    try {
      setIsSavingSubstitute(true);

      await Promise.all(
        datesToRemove.map((dateKey) =>
          remove(
            ref(
              db,
              `schedules/${substituteSchedule.id}/driverOverrides/${dateKey}`,
            ),
          ),
        ),
      );

      await update(
        ref(db, `schedules/${substituteSchedule.id}`),
        { updatedAt: Date.now() },
      );

      setSuccessMessage(
        `Temporary substitution removed for ${datesToRemove.length} collection date(s). The regular driver is active for those occurrences again.`,
      );

      closeSubstitute();
    } catch (error) {
      console.error("Unable to remove substitute range:", error);
      alert("Unable to remove the temporary substitute.");
      setIsSavingSubstitute(false);
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    if (
      !window.confirm(
        "Delete this recurring schedule and notify affected residents?",
      )
    ) {
      return;
    }

    try {
      await remove(ref(db, `schedules/${schedule.id}`));

      const areas = getServiceAreas(schedule.areas);
      await createScheduleNotification({
        scheduleId: schedule.id,
        title: schedule.title || "Schedule",
        barangays: getScheduleBarangays(schedule),
        areas,
        days: getScheduleDays(schedule),
        startTime: String(schedule.startTime || ""),
        endTime: String(schedule.endTime || ""),
        status: "cancelled",
        notes: schedule.notes || "",
      });

      setSuccessMessage("Schedule deleted.");
    } catch (error) {
      console.error("Unable to delete schedule:", error);
      alert("Unable to delete the schedule.");
    }
  };

  const upcomingOverride = (schedule: Schedule) => {
    const entries = Object.entries(schedule.driverOverrides || {})
      .filter(([date, override]) => {
        if (!driverOverrideForDate(schedule, date)) return false;
        return (
          new Date(`${date}T23:59:59+08:00`).getTime() >= Date.now()
        );
      })
      .sort(([a], [b]) => a.localeCompare(b));

    return entries[0] || null;
  };

  // UI-only derived values. Assignment and conflict rules above are preserved.
  const activeScheduleCount = schedules.filter(
    (schedule) => String(schedule.status || "active").toLowerCase() === "active",
  ).length;
  const schedulesWithSubstitutes = schedules.filter((schedule) => upcomingOverride(schedule));
  const upcomingOverrideCount = presentationToday ? schedules.reduce(
    (count, schedule) => count + Object.keys(schedule.driverOverrides || {}).filter(
      (date) => date >= presentationToday && Boolean(driverOverrideForDate(schedule, date)),
    ).length, 0,
  ) : 0;
  const visibleSchedules = filteredSchedules.filter((schedule) => {
    if (statusFilter === "active") return String(schedule.status || "active").toLowerCase() === "active";
    if (statusFilter === "substitute") return Boolean(upcomingOverride(schedule));
    return true;
  });
  const visibleBarangays = availableBarangays.filter(
    (barangay) => barangay.toLowerCase().includes(areaSearch.trim().toLowerCase()),
  );
  const selectedDriver = drivers.find((driver) => driver.id === form.assignedDriverId);
  const canAdvance = [
    selectedBarangays.length > 0,
    Boolean(selectedRoute && routeAreas.length > 0 && selectedBarangays.every(
      (barangay) => routeAreas.some((area) => makeBarangayKey(area.barangay) === makeBarangayKey(barangay)),
    )),
    Boolean(selectedScheduleAreas.length > 0 && selectedBarangays.every(
      (barangay) => selectedScheduleAreas.some((area) => makeBarangayKey(area.barangay) === makeBarangayKey(barangay)),
    )),
    selectedDays.length > 0 && selectedTimeWindowValid,
    Boolean(form.assignedDriverId && availableDriversForNewSchedule.some((driver) => driver.id === form.assignedDriverId)),
    true,
  ];
  const allStepsValid = canAdvance.slice(0, 5).every(Boolean);
  const highestStep = (() => {
    const invalid = canAdvance.slice(0, 5).findIndex((valid) => !valid);
    return invalid === -1 ? 5 : invalid;
  })();
  const nextStep = () => {
    if (!canAdvance[step]) {
      setStepError([
        "Choose at least one Barangay.",
        "Choose a verified route with coverage for all selected Barangays.",
        "Choose at least one Purok for every selected Barangay.",
        "Choose the collection days and a valid start/end time.",
        "Choose a driver who passes the schedule checks.",
      ][step] || "Complete the required fields.");
      return;
    }
    setStep((value) => Math.min(value + 1, 5));
  };
  const requestCloseCreate = () => {
    if (isSaving) return;
    const dirty =
      selectedBarangays.length > 0 ||
      selectedScheduleAreaIds.length > 0 ||
      selectedDays.length > 0 ||
      Boolean(form.startTime || form.title || form.notes);
    const message = editingScheduleId
      ? "Discard your unsaved schedule changes?"
      : "Discard this unsaved schedule?";
    if (!dirty || window.confirm(message)) closeCreate();
  };
  const requestCloseSubstitute = () => {
    if (!isSavingSubstitute) closeSubstitute();
  };

  return (
    <DashboardShell title={""} description={""}>
      <section className={styles.workspace} aria-labelledby="schedule-page-title">
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Collection operations</p>
            <h1 id="schedule-page-title">Collection schedules</h1>
            <p className={styles.subtitle}>Plan collections, review coverage, and manage temporary driver changes.</p>
          </div>
          <button type="button" className={styles.primaryButton} disabled={loading || Boolean(loadError)}
            onClick={openCreateSchedule}>
            <ScheduleIcon name="plus" size={18} /> Create schedule
          </button>
        </div>

        {successMessage ? <div className={styles.successNotice} role="status">
          <ScheduleIcon name="check" size={18} /><span>{successMessage}</span>
          <button type="button" className={styles.iconButton} aria-label="Dismiss confirmation" onClick={() => setSuccessMessage("")}>
            <ScheduleIcon name="close" size={18} />
          </button>
        </div> : null}

        <section className={styles.metrics} aria-label="Schedule overview">
          <Metric label="Active schedules" value={loading ? "—" : activeScheduleCount} caption="Recurring collection plans" icon="calendar" />
          <Metric label="Verified routes" value={routes.filter(isSelectableRoute).length} caption="Available for route selection" icon="route" />
          <Metric label="Available drivers" value={drivers.filter((driver) => isDriverOperationallyAvailable(driver)).length} caption="Before time-conflict checks" icon="users" />
          <Metric label="Upcoming substitutions" value={upcomingOverrideCount} caption="Collection-date overrides" icon="swap" />
        </section>

        <section className={styles.registry} aria-labelledby="registry-title">
          <div className={styles.registryIntro}>
            <div><h2 id="registry-title">Your schedules</h2><p>Select a schedule to see its coverage and assignment.</p></div>
            <span className={styles.recordCount}>{visibleSchedules.length} of {schedules.length}</span>
          </div>
          <div className={styles.registryTools}>
            <div className={styles.filterTabs} role="group" aria-label="Filter schedules">
              {([
                ["all", "All", schedules.length],
                ["active", "Active", activeScheduleCount],
                ["substitute", "With substitutes", schedulesWithSubstitutes.length],
              ] as const).map(([value, label, count]) => (
                <button key={value} type="button" aria-pressed={statusFilter === value}
                  className={styles.filterButton} onClick={() => setStatusFilter(value)}>
                  {label}<span>{count}</span>
                </button>
              ))}
            </div>
            <label className={styles.searchField}>
              <ScheduleIcon name="search" size={18} />
              <span className={styles.srOnly}>Search schedules</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Search schedule, route, or driver" />
            </label>
          </div>
          {loadError ? <div className={styles.emptyState} role="alert">
            <ScheduleIcon name="info" size={28} /><h3>Schedules could not be loaded</h3><p>{loadError}</p>
          </div> : loading ? <div className={styles.emptyState} role="status">
            <span className={styles.spinner} aria-hidden="true" /><p>Loading collection schedules…</p>
          </div> : visibleSchedules.length === 0 ? <div className={styles.emptyState}>
            <ScheduleIcon name="calendar" size={28} /><h3>{schedules.length ? "No matching schedules" : "No schedules yet"}</h3>
            <p>{schedules.length ? "Change the search or filter to see other schedules." : "Create a schedule to assign collection days, service areas, and a driver."}</p>
            {schedules.length ? <button type="button" className={styles.secondaryButton} onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear filters</button> : null}
          </div> : <div className={styles.scheduleList}>
            {visibleSchedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule}
              override={upcomingOverride(schedule)} onEdit={() => openEditSchedule(schedule)}
              onSubstitute={() => openSubstitute(schedule)}
              onDelete={() => deleteSchedule(schedule)} />)}
          </div>}
          <div className={styles.registryFootnote}>
            <ScheduleIcon name="info" size={16} /><span>Temporary substitutions keep the regular driver assignment unchanged.</span>
          </div>
        </section>
      </section>

      {showCreate ? <ScheduleDialog fullScreen labelledBy="create-schedule-title" busy={isSaving} onDismiss={requestCloseCreate}>
        <header className={styles.dialogHeader}>
          <div className={styles.dialogTitleGroup}>
            <span className={styles.brandMark}><ScheduleIcon name="calendar" size={22} /></span>
            <div><span className={styles.eyebrow}>MetroWaste · Schedule planner</span>
              <h2 id="create-schedule-title" data-dialog-heading tabIndex={-1}>
                {editingScheduleId ? "Edit collection schedule" : "Create a collection schedule"}
              </h2>
            </div>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close schedule planner" disabled={isSaving} onClick={requestCloseCreate}>
            <ScheduleIcon name="close" />
          </button>
        </header>

        <div className={styles.plannerLayout}>
          <aside className={styles.plannerSidebar} aria-label="Schedule creation steps">
            <p className={styles.sidebarCaption}>{editingScheduleId ? "Review and update" : "A few clear steps"}</p>
            <ol className={styles.stepNav}>
              {STEPS.map((item, index) => <li key={item.label}>
                <button ref={step === index ? stepNavigationRef : undefined} type="button" className={styles.stepNavButton} aria-current={step === index ? "step" : undefined}
                  disabled={isSaving || index > highestStep} onClick={() => setStep(index)}>
                  <span className={styles.stepNumber} data-complete={index < step && canAdvance[index]}>
                    {index < step && canAdvance[index] ? <ScheduleIcon name="check" size={16} /> : index + 1}
                  </span>
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                </button>
              </li>)}
            </ol>
            <div className={styles.sidebarNote}><ScheduleIcon name="info" size={18} />
              <p>{editingScheduleId ? "Changes update this existing schedule without creating a duplicate record." : "Your schedule is saved only after you review and confirm it."}</p>
            </div>
          </aside>

          <div className={styles.plannerScroll} key={step}>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>
                <span className={styles.stepCounter}>Step {step + 1} of {STEPS.length}</span>
                <h2 ref={stepHeadingRef} tabIndex={-1}>{[
                  "Where will collection take place?",
                  "Which master route should be used?",
                  "Which Puroks will be collected on this schedule?",
                  "When should collection happen?",
                  "Who will carry out the collection?",
                  "Does everything look right?",
                ][step]}</h2>
                <p>{[
                  "Choose one or more Barangays. The next step shows routes that cover your full selection.",
                  "Choose a verified master route. Its saved Barangay and Purok coverage is loaded without changing it.",
                  "Choose the exact Puroks this schedule will serve. This affects only this schedule, not the master route.",
                  "Select the recurring days and the expected collection window.",
                  "Choose the regular driver and confirm the collection vehicle.",
                  editingScheduleId
                    ? "Review the revised coverage, timetable, and assignment before updating the existing schedule."
                    : "Review the schedule-specific coverage, timetable, and assignment before creating the schedule.",
                ][step]}</p>
              </div>
              {stepError ? <div className={styles.errorNotice} role="alert"><ScheduleIcon name="info" size={18} />{stepError}</div> : null}
              <fieldset className={styles.formFields} disabled={isSaving}>
                <legend className={styles.srOnly}>{STEPS[step].label}</legend>

                {step === 0 ? <>
                  <label className={styles.searchField}>
                    <ScheduleIcon name="search" size={18} /><span className={styles.srOnly}>Find a Barangay</span>
                    <input type="search" value={areaSearch} onChange={(event) => setAreaSearch(event.target.value)} placeholder="Find a Barangay…" />
                  </label>
                  <div className={styles.selectionCaption}>
                    <span><strong>{selectedBarangays.length}</strong> Barangay{selectedBarangays.length === 1 ? "" : "s"} selected</span>
                    <button type="button" className={styles.textButton} disabled={!selectedBarangays.length} onClick={clearBarangays}>Clear selection</button>
                  </div>
                  <div className={styles.areaChoices}>
                    {visibleBarangays.map((barangay) => {
                      const checked = selectedBarangays.some((item) => makeBarangayKey(item) === makeBarangayKey(barangay));
                      return <label key={barangay} className={styles.choice} data-selected={checked}>
                        <input type="checkbox" checked={checked} onChange={() => toggleBarangay(barangay)} />
                        <span><strong>{barangay}</strong><small>Collection service area</small></span>
                      </label>;
                    })}
                  </div>
                  {!visibleBarangays.length ? <div className={styles.helpNotice}>
                    {availableBarangays.length ? "No Barangay matches that search." : "No active Barangays with Puroks are available in the Service Area registry."}
                  </div> : null}
                  {selectedBarangays.length ? <div className={styles.selectionReview}>
                    <strong>Your selection</strong><p>{selectedBarangays.join(" · ")}</p>
                    <span>{matchingRoutes.length} verified route{matchingRoutes.length === 1 ? "" : "s"} cover all selected Barangays.</span>
                  </div> : null}
                </> : null}

                {step === 1 ? <>
                  <div className={styles.contextLine}><ScheduleIcon name="pin" size={17} /><span>{selectedBarangays.join(" · ")}</span>
                    <button type="button" className={styles.textButton} onClick={() => setStep(0)}>Change</button>
                  </div>
                  {!matchingRoutes.length ? <div className={styles.helpNotice}>
                    <strong>No matching verified route</strong><p>No saved route covers every selected Barangay. Change the selection, or configure and verify the required route first.</p>
                  </div> : <div className={styles.routeChoices}>
                    {matchingRoutes.map((route) => {
                      const groups = groupAreasByBarangay(getRouteAreasForBarangays(route, selectedBarangays));
                      return <label key={route.id} className={styles.routeChoice} data-selected={form.routeId === route.id}>
                        <input type="radio" name="matchingRoute" value={route.id} checked={form.routeId === route.id} onChange={() => setRoute(route.id)} />
                        <span className={styles.routeChoiceText}>
                          <span><strong>{route.routeName || "Unnamed route"}</strong><span className={styles.verifiedLabel}>Verified</span></span>
                          {groups.map((group) => <small key={group.barangay}>{group.barangay} — {group.puroks.join(", ") || "Purok coverage not recorded"}</small>)}
                        </span>
                      </label>;
                    })}
                  </div>}
                  {matchingRoutes.length === 1 ? <p className={styles.fieldHint}><ScheduleIcon name="check" size={16} />The only matching route has been selected automatically.</p> : null}
                  {selectedRoute ? <section className={styles.coveragePreview}>
                    <h3>Included collection points</h3>
                    <div className={styles.coverageList}>{routeCoverageGroups.map((group) => <div key={group.barangay} className={styles.coverageRow}>
                      <strong>{group.barangay}</strong><span>{group.puroks.join(", ") || "Purok details not recorded"}</span>
                    </div>)}</div>
                    <p className={styles.fieldHint}>These are the selected route’s exact Barangay/Purok pairs.</p>
                  </section> : null}
                </> : null}

                {step === 2 ? <>
                  <div className={styles.contextLine}><ScheduleIcon name="route" size={17} /><span>{selectedRoute?.routeName || "Selected route"}</span>
                    <button type="button" className={styles.textButton} onClick={() => setStep(1)}>Change route</button>
                  </div>
                  <div className={styles.selectionCaption}>
                    <span><strong>{selectedScheduleAreas.length}</strong> of {routeAreas.length} route Purok area{routeAreas.length === 1 ? "" : "s"} included</span>
                    <button type="button" className={styles.textButton}
                      disabled={!routeAreas.length}
                      onClick={() => setSelectedScheduleAreaIds(
                        selectedScheduleAreas.length === routeAreas.length ? [] : routeAreas.map(serviceAreaId),
                      )}>
                      {selectedScheduleAreas.length === routeAreas.length ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <div className={styles.coverageEditor}>
                    {routeCoverageGroups.map((group) => {
                      const groupAreas = routeAreas.filter((area) => makeBarangayKey(area.barangay) === makeBarangayKey(group.barangay));
                      const selectedCount = groupAreas.filter((area) => selectedScheduleAreaIds.includes(serviceAreaId(area))).length;
                      const allSelected = groupAreas.length > 0 && selectedCount === groupAreas.length;
                      return <section className={styles.coverageEditorGroup} key={group.barangay}>
                        <div className={styles.coverageEditorHead}>
                          <div><strong>{group.barangay}</strong><small>{selectedCount} of {groupAreas.length} Puroks selected</small></div>
                          <button type="button" className={styles.textButton}
                            onClick={() => setBarangayScheduleCoverage(group.barangay, !allSelected)}>
                            {allSelected ? "Clear Barangay" : "Select Barangay"}
                          </button>
                        </div>
                        <div className={styles.purokChoices}>
                          {groupAreas.map((area) => {
                            const id = serviceAreaId(area);
                            const checked = selectedScheduleAreaIds.includes(id);
                            return <label key={id} className={styles.purokChoice} data-selected={checked}>
                              <input type="checkbox" checked={checked} onChange={() => toggleScheduleArea(area)} />
                              <span><strong>{normalizePurokLabel(area.purok)}</strong><small>Included in this schedule</small></span>
                            </label>;
                          })}
                        </div>
                      </section>;
                    })}
                  </div>
                  <div className={styles.helpNotice}><ScheduleIcon name="info" size={20} /><div>
                    <strong>Schedule-only coverage</strong>
                    <p>The master route remains unchanged. Driver and resident screens receive only the Barangay/Purok areas selected here through schedules/{'{scheduleId}'}/areas.</p>
                  </div></div>
                </> : null}

                {step === 3 ? <>
                  <div className={styles.fieldGroup}>
                    <h3>Repeats every week on</h3>
                    <div className={styles.dayChoices}>{DAYS.map((day) => <button key={day} type="button"
                      className={styles.dayButton} aria-pressed={selectedDays.includes(day)} aria-label={day} onClick={() => toggleDay(day)}>
                      {day.slice(0, 3)}{selectedDays.includes(day) ? <ScheduleIcon name="check" size={14} /> : null}
                    </button>)}</div>
                    <p className={styles.fieldHint}>{selectedDays.length ? formatDayList(selectedDays) : "Select at least one collection day."}</p>
                  </div>
                  <div className={styles.twoFields}>
                    <label className={styles.field}><span>Collection start</span>
                      <input type="time" value={form.startTime} onChange={(event) => {
                        const startTime = event.target.value;
                        setForm((current) => ({ ...current, startTime,
                          endTime: startTime && (!current.endTime || current.endTime === current.startTime || current.endTime === startTime)
                            ? addMinutesToTime(startTime, 120) : current.endTime,
                          assignedDriverId: "",
                        }));
                      }} />
                    </label>
                    <label className={styles.field}><span>Expected end</span>
                      <input type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value, assignedDriverId: "" }))} />
                    </label>
                  </div>
                  <div className={styles.durationChoices}><span>Set duration</span>{[60,120,180,240].map((minutes) => <button key={minutes} type="button"
                    disabled={!form.startTime} className={styles.durationButton}
                    onClick={() => setForm((current) => ({...current, endTime: addMinutesToTime(current.startTime, minutes), assignedDriverId: ""}))}>
                    {minutes / 60} hour{minutes === 60 ? "" : "s"}
                  </button>)}</div>
                  <div className={selectedTimeWindowValid ? styles.helpNotice : styles.neutralNotice}>
                    <ScheduleIcon name="clock" size={20} /><div><strong>{timeWindowLabel(form.startTime, form.endTime)}</strong>
                      <p>An earlier end time means the next day. Identical start and end times are not accepted.</p>
                    </div>
                  </div>
                </> : null}

                {step === 4 ? <>
                  <div className={styles.contextLine}><ScheduleIcon name="clock" size={17} /><span>{formatDayList(selectedDays)} · {formatTime(form.startTime)} – {formatTime(form.endTime)}</span>
                    <button type="button" className={styles.textButton} onClick={() => setStep(3)}>Change</button>
                  </div>
                  <div className={styles.twoFields}>
                    <label className={styles.field}><span>Regular driver</span>
                      <select aria-label="Regular driver" aria-describedby="regular-driver-hint" value={form.assignedDriverId} onChange={(event) => {
                        const driver = drivers.find((item) => item.id === event.target.value);
                        setForm((current) => ({...current, assignedDriverId: event.target.value, truckId: driver?.truck || selectedRoute?.assignedVehicle || current.truckId}));
                      }}>
                        <option value="">{availableDriversForNewSchedule.length ? "Choose a driver" : "No driver passes the schedule checks"}</option>
                        {availableDriversForNewSchedule.map((driver) => <option key={driver.id} value={driver.id}>{driver.name || "Unnamed driver"}</option>)}
                      </select>
                      <small id="regular-driver-hint">Filtered by the existing availability and schedule-time checks.</small>
                    </label>
                    <label className={styles.field}><span>Truck / plate</span>
                      <input aria-label="Truck / plate" value={form.truckId} onChange={(event) => setForm((current) => ({...current, truckId: event.target.value}))} placeholder="Enter or confirm the truck" />
                      <small>Confirm the vehicle before saving.</small>
                    </label>
                  </div>
                  {!availableDriversForNewSchedule.length ? <div className={styles.helpNotice}><strong>No matching driver</strong>
                    <p>Review the collection window and driver availability. This screen will not bypass the existing conflict checks.</p>
                  </div> : null}
                  <label className={styles.field}><span>Schedule title <small>Optional</small></span>
                    <input aria-label="Schedule title" aria-describedby="schedule-title-hint" value={form.title} onChange={(event) => setForm((current) => ({...current, title: event.target.value}))}
                      placeholder={selectedBarangays.length === 1 ? `${selectedBarangays[0]} Weekly Collection` : "Example: North Cluster Weekly Collection"} />
                    <small id="schedule-title-hint">A title is generated when this field is empty.</small>
                  </label>
                  <label className={styles.field}><span>Admin notes <small>Optional</small></span>
                    <textarea aria-label="Admin notes" rows={4} value={form.notes} onChange={(event) => setForm((current) => ({...current, notes: event.target.value}))} placeholder="Add any collection instructions or internal notes." />
                  </label>
                </> : null}

                {step === 5 ? <>
                  <div className={styles.reviewTitle}><ScheduleIcon name="calendar" size={25} />
                    <div><strong>{form.title.trim() || (selectedBarangays.length === 1 ? `${selectedBarangays[0]} Weekly Collection` : `${selectedBarangays.length}-Barangay Weekly Collection`)}</strong><span>Weekly recurring schedule</span></div>
                  </div>
                  <section className={styles.reviewSection}><div className={styles.reviewHeading}><h3>Schedule Purok coverage</h3><button type="button" className={styles.textButton} onClick={() => setStep(2)}>Change</button></div>
                    <div className={styles.coverageList}>{selectedCoverageGroups.map((group) => <div key={group.barangay} className={styles.coverageRow}><strong>{group.barangay}</strong><span>{group.puroks.join(", ")}</span></div>)}</div>
                  </section>
                  <section className={styles.reviewSection}><div className={styles.reviewHeading}><h3>Timetable & assignment</h3><button type="button" className={styles.textButton} onClick={() => setStep(3)}>Change</button></div>
                    <dl className={styles.facts}>
                      <div><dt>Route</dt><dd>{selectedRoute?.routeName || "Not selected"}</dd></div>
                      <div><dt>Collection days</dt><dd>{formatDayList(selectedDays)}</dd></div>
                      <div><dt>Time window</dt><dd>{formatTime(form.startTime)} – {formatTime(form.endTime)}<small>{timeWindowLabel(form.startTime, form.endTime)}</small></dd></div>
                      <div><dt>Regular driver</dt><dd>{selectedDriver?.name || "Not selected"}</dd></div>
                      <div><dt>Truck / plate</dt><dd>{form.truckId || selectedDriver?.truck || selectedRoute?.assignedVehicle || "Not recorded"}</dd></div>
                    </dl>
                  </section>
                  {form.notes ? <section className={styles.notes}><h3>Admin notes</h3><p>{form.notes}</p></section> : null}
                  <div className={styles.neutralNotice}><ScheduleIcon name="info" size={20} /><p>{editingScheduleId ? "Confirming updates this existing schedule immediately. Driver and Resident views will read the revised record. Avoid saving changes while this collection is actively being tracked." : "Confirming will save the schedule and use your existing resident notification workflow."}</p></div>
                  {!allStepsValid ? <div className={styles.errorNotice} role="alert">An earlier selection changed. Review the previous steps before saving.</div> : null}
                </> : null}
              </fieldset>
            </div>
          </div>
        </div>
        <footer className={styles.plannerFooter}>
          <span className={styles.footerProgress}>Step {step + 1} of {STEPS.length} · {STEPS[step].label}</span>
          <div className={styles.footerActions}>
            <button type="button" className={styles.secondaryButton} disabled={isSaving} onClick={() => step === 0 ? requestCloseCreate() : setStep((current) => current - 1)}>
              {step > 0 ? <ScheduleIcon name="arrowLeft" size={17} /> : null}{step === 0 ? "Cancel" : "Back"}
            </button>
            {step < 5 ? <button type="button" className={styles.primaryButton} disabled={isSaving} onClick={nextStep}>Continue<ScheduleIcon name="arrowRight" size={17} /></button>
              : <button type="button" className={styles.primaryButton} disabled={isSaving || !allStepsValid} onClick={saveSchedule}>
                {isSaving ? <span className={styles.spinner} aria-hidden="true" /> : <ScheduleIcon name="check" size={17} />}
                {isSaving
                  ? (editingScheduleId ? "Updating schedule…" : "Saving schedule…")
                  : (editingScheduleId ? "Confirm & update" : "Confirm & create")}
              </button>}
          </div>
        </footer>
      </ScheduleDialog> : null}

      {substituteSchedule ? <ScheduleDialog labelledBy="substitute-title" busy={isSavingSubstitute} onDismiss={requestCloseSubstitute}>
        <header className={styles.dialogHeader}>
          <div><span className={styles.eyebrow}>Temporary assignment</span><h2 id="substitute-title" data-dialog-heading tabIndex={-1}>Substitute a driver</h2></div>
          <button type="button" className={styles.iconButton} aria-label="Close substitution form" disabled={isSavingSubstitute} onClick={requestCloseSubstitute}><ScheduleIcon name="close" /></button>
        </header>
        <div className={styles.compactBody}>
          <p className={styles.subtitle}>Choose a period and replacement driver. The regular assignment stays unchanged.</p>
          <dl className={styles.facts}>
            <div><dt>Schedule</dt><dd>{substituteSchedule.title || "Collection schedule"}</dd></div>
            <div><dt>Regular driver</dt><dd>{substituteSchedule.driverName || substituteSchedule.defaultDriverName || "Not recorded"}</dd></div>
            <div><dt>Timetable</dt><dd>{conciseDays(substituteSchedule)}<small>{savedWindow(substituteSchedule)}</small></dd></div>
          </dl>
          <fieldset className={styles.formFields} disabled={isSavingSubstitute}>
            <legend className={styles.srOnly}>Substitution period and driver</legend>
            <div className={styles.twoFields}>
              <label className={styles.field}><span>From date</span><input type="date" min={dateKeyForOffset(0)} value={substituteStartDate} onChange={(event) => {
                const value = event.target.value; setSubstituteStartDate(value);
                if (!substituteEndDate || substituteEndDate < value) setSubstituteEndDate(value);
              }} /></label>
              <label className={styles.field}><span>Until date <small>Inclusive</small></span><input type="date" min={substituteStartDate || dateKeyForOffset(0)} value={substituteEndDate} onChange={(event) => setSubstituteEndDate(event.target.value)} /></label>
            </div>
            <div className={styles.affectedDates}>
              <strong>{affectedSubstituteDates.length} scheduled collection{affectedSubstituteDates.length === 1 ? "" : "s"} affected</strong>
              {affectedSubstituteDates.length ? <details><summary>View affected dates</summary><ul>{affectedSubstituteDates.map((date) => <li key={date}>{formatDateKey(date)}</li>)}</ul></details>
                : <p>No scheduled collection falls within this period.</p>}
            </div>
            <label className={styles.field}><span>Substitute driver</span>
              <select aria-label="Substitute driver" value={substituteDriverId} disabled={!affectedSubstituteDates.length} onChange={(event) => setSubstituteDriverId(event.target.value)}>
                <option value="">{substituteCandidates.length ? "Choose a substitute" : "No matching driver for this period"}</option>
                {substituteCandidates.map((driver) => <option key={driver.id} value={driver.id}>{driver.name || "Unnamed driver"}</option>)}
              </select><small>Must pass the existing checks on every affected collection date. The scheduled truck is not changed by this form.</small>
            </label>
            <label className={styles.field}><span>Reason</span><select value={substituteReason} onChange={(event) => setSubstituteReason(event.target.value)}>
              {["Driver unavailable", "Sick leave", "Approved leave", "Emergency", "Schedule conflict", "Operational reassignment"].map((reason) => <option key={reason}>{reason}</option>)}
            </select></label>
            <div className={styles.helpNotice}><ScheduleIcon name="swap" size={20} /><div><strong>Regular assignment retained</strong>
              <p>Only scheduled dates from {formatDateKey(substituteStartDate)} through {formatDateKey(substituteEndDate)} are changed. Dates without an override use the regular driver.</p></div>
            </div>
            {existingOverridesInSelectedRange.length ? <button type="button" className={styles.dangerButton} onClick={removeTemporarySubstitute}>Remove substitutes in this period</button> : null}
          </fieldset>
        </div>
        <footer className={styles.compactFooter}>
          <button type="button" className={styles.secondaryButton} disabled={isSavingSubstitute} onClick={requestCloseSubstitute}>Cancel</button>
          <button type="button" className={styles.primaryButton} disabled={isSavingSubstitute || !affectedSubstituteDates.length || !substituteDriverId} onClick={saveTemporarySubstitute}>
            {isSavingSubstitute ? "Saving…" : "Assign substitute"}
          </button>
        </footer>
      </ScheduleDialog> : null}
    </DashboardShell>
  );
}
