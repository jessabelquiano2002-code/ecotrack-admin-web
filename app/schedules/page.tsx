"use client";

import { onValue, push, ref, remove, set } from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { findOfficialBarangay } from "../service-areas/catalog";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ALL_PUROKS_LABEL = "All Puroks";

type Driver = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  truck?: string;
  status?: string;
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
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicle?: string;
  routeType?: string;
  trackingMode?: string;
  status?: string;
  verified?: boolean;
  routeValidation?: { status?: string };
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

type ServicePurokRecord = {
  purok?: string;
  active?: boolean;
  verified?: boolean;
  lat?: number;
  lng?: number;
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
  barangayKeys?: string[] | Record<string, string | boolean>;
  areas?: ServiceArea[] | Record<string, ServiceArea>;
  assignedPuroks?: string[] | Record<string, string | boolean>;
  puroks?: Array<string | number> | Record<string, string | number | boolean>;
  scheduleDay?: string;
  scheduleDays?: string[] | string;
  startTime?: string;
  purokTimes?: Record<string, string>;
  collectionTimesByPurok?: Record<string, string>;
  truckId?: string;
  assignedDriverId?: string;
  driverId?: string;
  driverName?: string;
  routeId?: string;
  assignedRouteId?: string;
  routeName?: string;
  notes?: string;
  status?: string;
  scheduleType?: string;
  repeat?: string;
  isRecurring?: boolean;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  lastCompletedAt?: number;
};

type ScheduleForm = {
  title: string;
  truckId: string;
  assignedDriverId: string;
  notes: string;
  routeId: string;
};

const EMPTY_FORM: ScheduleForm = {
  title: "",
  truckId: "",
  assignedDriverId: "",
  notes: "",
  routeId: "",
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

function getRouteBarangays(route: RouteRecord): string[] {
  const values = [route.barangay, ...normalizeArray(route.barangays)]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

function getRoutePuroks(route: RouteRecord): string[] {
  return normalizeArray(route.puroks).map(normalizePurokLabel).filter(Boolean);
}

function getServiceAreas(value: unknown): ServiceArea[] {
  const items = Array.isArray(value)
    ? value
    : Object.values(
        (value && typeof value === "object" ? value : {}) as Record<string, ServiceArea>,
      );
  return items
    .filter((area): area is ServiceArea => Boolean(area && area.barangay))
    .map((area) => ({
      ...area,
      barangay: String(area.barangay).trim(),
      barangayKey: area.barangayKey || makeBarangayKey(area.barangay),
      purok: normalizePurokLabel(area.purok || ""),
      purokKey: area.purokKey || (area.purok ? makePurokKey(area.purok) : "all"),
    }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function routeCoversSelection(
  route: RouteRecord,
  barangays: string[],
  selectedPuroks: string[],
): boolean {
  const routeAreas = getServiceAreas(route.areas);
  const coversEveryArea = barangays.every((barangay) =>
    selectedPuroks.every((purok) =>
      routeAreas.some(
        (area) =>
          makeBarangayKey(area.barangay) === makeBarangayKey(barangay) &&
          normalizePurokLabel(area.purok) === normalizePurokLabel(purok),
      ),
    ),
  );

  const routeStatus = String(route.status || "ready").toLowerCase();
  const routeIsAvailable = !["disabled", "inactive", "archived"].includes(
    routeStatus,
  );

  const verified = route.verified === true &&
    route.routeValidation?.status === "verified";

  return (
    coversEveryArea &&
    routeIsAvailable &&
    verified &&
    Boolean(route.assignedDriverId)
  );
}

function getScheduleBarangays(schedule: Schedule): string[] {
  const values = [schedule.barangay, ...normalizeArray(schedule.barangays)]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

function getSchedulePuroks(schedule: Schedule): string[] {
  const values = normalizeArray(schedule.assignedPuroks || schedule.puroks);
  return values.map(normalizePurokLabel).filter(Boolean);
}

function getScheduleDays(schedule: Schedule): string[] {
  const values = normalizeArray(schedule.scheduleDays);
  const fallback = schedule.scheduleDay ? [schedule.scheduleDay] : [];
  const uniqueDays = new Set(values.length > 0 ? values : fallback);

  return DAYS.filter((day) => uniqueDays.has(day));
}

function getSchedulePurokTimes(schedule: Schedule): Record<string, string> {
  const source = schedule.purokTimes || schedule.collectionTimesByPurok || {};
  const fallback = String(schedule.startTime || "");

  return getSchedulePuroks(schedule).reduce<Record<string, string>>(
    (result, purok) => {
      result[purok] = source[purok] || source[makePurokKey(purok)] || fallback;
      return result;
    },
    {},
  );
}

function formatScheduleTimeSummary(schedule: Schedule): string {
  const times = Object.values(getSchedulePurokTimes(schedule)).filter(Boolean);
  const uniqueTimes = Array.from(new Set(times));

  if (uniqueTimes.length === 0) return "—";
  if (uniqueTimes.length === 1) return formatTime(uniqueTimes[0]);
  return `${times.length} Purok times`;
}

function formatDayList(days: string[]): string {
  const orderedDays = DAYS.filter((day) => days.includes(day));

  if (orderedDays.length === 0) return "—";
  if (orderedDays.length === 1) return orderedDays[0];
  if (orderedDays.length === 2)
    return `${orderedDays[0]} and ${orderedDays[1]}`;

  return `${orderedDays.slice(0, -1).join(", ")}, and ${orderedDays.at(-1)}`;
}

function formatTime(value?: string): string {
  if (!value) return "—";

  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = minuteRaw || "00";

  if (Number.isNaN(hour)) return value;

  const period = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minute} ${period}`;
}

function formatDate(value?: number): string {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [serviceRegistry, setServiceRegistry] = useState<Record<string, ServiceBarangayRecord>>({});

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");

  const [selectedBarangays, setSelectedBarangays] = useState<string[]>([]);
  const [barangayPickerOpen, setBarangayPickerOpen] = useState(false);
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]);
  const [purokTimes, setPurokTimes] = useState<Record<string, string>>({});
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const barangayPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribeSchedules = onValue(ref(db, "schedules"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value)
        .map(([id, raw]) => ({
          id,
          ...(raw as Omit<Schedule, "id">),
        }))
        .sort(
          (left, right) =>
            Number(right.createdAt || 0) - Number(left.createdAt || 0),
        );
      setSchedules(list);
    });

    const unsubscribeDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value).map(([id, raw]) => ({
        id,
        ...(raw as Omit<Driver, "id">),
      }));
      setDrivers(list);
    });

    const unsubscribeRoutes = onValue(ref(db, "routes"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value).map(([id, raw]) => ({
        id,
        ...(raw as Omit<RouteRecord, "id">),
      }));
      setRoutes(list);
    });

    const unsubscribeServiceAreas = onValue(ref(db, "service_areas"), (snapshot) => {
      setServiceRegistry(snapshot.val() || {});
    });

    return () => {
      unsubscribeSchedules();
      unsubscribeDrivers();
      unsubscribeRoutes();
      unsubscribeServiceAreas();
    };
  }, []);

  const availableBarangays = useMemo(() => Object.entries(serviceRegistry)
    .filter(([, record]) => record.active !== false)
    .filter(([, record]) => Object.values(record.puroks || {}).some((purok) =>
      purok.active !== false))
    .map(([key, record]) => findOfficialBarangay(record.barangay || key)?.name || record.barangay || key)
    .sort((left, right) => left.localeCompare(right)), [serviceRegistry]);

  const availablePuroks = useMemo(() => {
    const values = new Set<string>();
    selectedBarangays.forEach((barangay) => {
      const record = serviceRegistry[makeBarangayKey(barangay)];
      Object.values(record?.puroks || {}).forEach((purok) => {
        if (purok.active === false) return;
        const label = normalizePurokLabel(purok.purok || "");
        if (label) values.add(label);
      });
    });
    return [...values].sort((left, right) =>
      Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0));
  }, [selectedBarangays, serviceRegistry]);

  useEffect(() => {
    setSelectedBarangays((current) => current.filter((barangay) => availableBarangays.includes(barangay)));
  }, [availableBarangays]);

  useEffect(() => {
    setSelectedPuroks((current) => {
      const next = current.filter((purok) => availablePuroks.includes(purok));
      if (next.length !== current.length) {
        setPurokTimes((times) => Object.fromEntries(
          Object.entries(times).filter(([purok]) => next.includes(purok)),
        ));
      }
      return next;
    });
  }, [availablePuroks]);

  useEffect(() => {
    if (!barangayPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        barangayPickerRef.current &&
        !barangayPickerRef.current.contains(event.target as Node)
      ) {
        setBarangayPickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBarangayPickerOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [barangayPickerOpen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") !== "agency-report") return;

    const requestedBarangay = params.get("barangay") || "";
    const requestedPurok = params.get("purok") || "";
    const recommendedSlots = Math.max(
      1,
      Number(params.get("recommendedSlots") || 1),
    );

    const barangay =
      availableBarangays.find(
        (item) => item.toLowerCase() === requestedBarangay.toLowerCase(),
      ) || "";

    const normalizedRequestedPurok = normalizePurokLabel(requestedPurok);
    const purok = (() => {
      const record = serviceRegistry[makeBarangayKey(barangay)];
      return Object.values(record?.puroks || {})
        .filter((item) => item.active !== false)
        .map((item) => normalizePurokLabel(item.purok || ""))
        .find(
      (item) => item.toLowerCase() === normalizedRequestedPurok.toLowerCase(),
        );
    })();

    if (!barangay) return;

    setSelectedBarangays([barangay]);
    setSelectedPuroks(purok ? [purok] : []);
    setPurokTimes({});
    setSelectedDays([]);
    setForm({
      ...EMPTY_FORM,
      title: `${barangay}${purok ? ` ${purok}` : ""} — Additional Collection`,
      notes: `Recommended by MetroWaste Agency Report: consider ${recommendedSlots} additional weekly collection slot${recommendedSlots === 1 ? "" : "s"}. Review route, driver, truck, day, and time before saving.`,
    });
    setShowForm(true);
  }, [availableBarangays, serviceRegistry]);

  const compatibleRoutes = useMemo(() => {
    if (selectedBarangays.length === 0 || selectedPuroks.length === 0)
      return [];

    return routes.filter((route) =>
      routeCoversSelection(route, selectedBarangays, selectedPuroks),
    );
  }, [routes, selectedBarangays, selectedPuroks]);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === form.routeId),
    [routes, form.routeId],
  );

  const filteredSchedules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schedules;

    return schedules.filter((schedule) => {
      const text = [
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
        .toLowerCase();

      return text.includes(query);
    });
  }, [schedules, search]);

  const resetForm = () => {
    setSelectedBarangays([]);
    setBarangayPickerOpen(false);
    setSelectedPuroks([]);
    setPurokTimes({});
    setSelectedDays([]);
    setForm(EMPTY_FORM);
    setIsSaving(false);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const resetSelectedRoute = () => {
    setForm((current) => ({
      ...current,
      routeId: "",
      assignedDriverId: "",
      truckId: "",
    }));
  };

  const toggleBarangay = (barangay: string) => {
    setSelectedBarangays((current) =>
      current.includes(barangay)
        ? current.filter((item) => item !== barangay)
        : [...current, barangay],
    );
    resetSelectedRoute();
  };

  const selectAllBarangays = () => {
    setSelectedBarangays((current) =>
      current.length === availableBarangays.length ? [] : [...availableBarangays],
    );
    resetSelectedRoute();
  };

  const togglePurok = (purok: string) => {
    setSelectedPuroks((current) => {
      const isRemoving = current.includes(purok);

      if (isRemoving) {
        setPurokTimes((times) => {
          const next = { ...times };
          delete next[purok];
          return next;
        });
        return current.filter((item) => item !== purok);
      }

      return [...current, purok];
    });

    resetSelectedRoute();
  };

  const selectAllPuroks = () => {
    setSelectedPuroks((current) => {
      if (current.length === availablePuroks.length) {
        setPurokTimes({});
        return [];
      }

      return [...availablePuroks];
    });
    resetSelectedRoute();
  };

  const setPurokTime = (purok: string, time: string) => {
    setPurokTimes((current) => ({ ...current, [purok]: time }));
  };

  const toggleDay = (day: string) => {
    setSelectedDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : DAYS.filter((item) => [...current, day].includes(item)),
    );
  };

  const selectWeekdays = () => {
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const allWeekdaysSelected = weekdays.every((day) =>
      selectedDays.includes(day),
    );

    setSelectedDays(allWeekdaysSelected ? [] : weekdays);
  };

  const selectRoute = (routeId: string) => {
    const route = routes.find((item) => item.id === routeId);
    const driver = drivers.find((item) => item.id === route?.assignedDriverId);

    setForm((current) => ({
      ...current,
      routeId,
      assignedDriverId: route?.assignedDriverId || "",
      truckId: route?.assignedVehicle || driver?.truck || "",
    }));
  };

  const createScheduleNotification = async ({
    scheduleId,
    title,
    barangays,
    puroks,
    purokTimes,
    days,
    status,
    notes,
    areas,
  }: {
    scheduleId: string;
    title: string;
    barangays: string[];
    puroks: string[];
    purokTimes: Record<string, string>;
    days: string[];
    status: "created" | "cancelled";
    notes?: string;
    areas?: ServiceArea[];
  }) => {
    const normalizedBarangays = Array.from(
      new Set(barangays.map((item) => item.trim()).filter(Boolean)),
    );
    const primaryBarangay = normalizedBarangays[0] || "";
    const primaryStartTime = purokTimes[puroks[0]] || "";
    const timestamp = Date.now();
    const allPuroks = availablePuroks.length > 0 && puroks.length === availablePuroks.length;
    const purokLabel = allPuroks ? ALL_PUROKS_LABEL : puroks.join(", ");
    const orderedDays = DAYS.filter((day) => days.includes(day));
    const dayLabel = formatDayList(orderedDays);
    const targetedAreas = areas && areas.length > 0
      ? areas
      : normalizedBarangays.flatMap((barangay) => puroks.map((purok) => ({
          barangay,
          barangayKey: makeBarangayKey(barangay),
          purok,
          purokKey: makePurokKey(purok),
          startTime: purokTimes[purok] || primaryStartTime,
        })));
    const areaLabel = normalizedBarangays.join(", ");
    const timeSummary = puroks
      .map(
        (purok) =>
          `${purok} at ${formatTime(purokTimes[purok] || primaryStartTime)}`,
      )
      .join("; ");

    const notificationTitle =
      status === "created"
        ? "New weekly garbage collection schedule"
        : "Garbage collection schedule cancelled";

    const message =
      status === "created"
        ? `Garbage collection for ${areaLabel} is scheduled every ${dayLabel}: ${timeSummary}.`
        : `The garbage collection schedule for ${areaLabel}, ${purokLabel}, has been cancelled.`;

    const notificationData = {
      type: "schedule",
      status,
      title: notificationTitle,
      message,
      notes: notes || "",
      adminNotes: notes || "",
      scheduleId,
      scheduleTitle: title,
      barangay: primaryBarangay,
      barangayKey: makeBarangayKey(primaryBarangay),
      barangays: normalizedBarangays,
      barangayKeys: normalizedBarangays.map(makeBarangayKey),
      purok: purokLabel,
      puroks,
      assignedPuroks: puroks,
      purokKeys: puroks.map(makePurokKey),
      purokTimes,
      collectionTimesByPurok: puroks.reduce<Record<string, string>>(
        (result, purok) => {
          result[makePurokKey(purok)] = purokTimes[purok] || primaryStartTime;
          return result;
        },
        {},
      ),
      scheduleDay: orderedDays[0] || "",
      scheduleDays: orderedDays,
      startTime: primaryStartTime,
      scheduleType: "weekly",
      repeat: "weekly",
      isRecurring: true,
      targetType:
        normalizedBarangays.length > 1
          ? "multiple_barangays_puroks"
          : allPuroks
            ? "barangay_all_purok"
            : puroks.length > 1
              ? "barangay_multiple_puroks"
              : "barangay_purok",
      notifyAllPurok: allPuroks,
      seen: false,
      createdAt: timestamp,
      timestamp,
    };

    const writes: Array<Promise<void>> = [];

    for (const area of targetedAreas) {
        const barangay = area.barangay;
        const barangayKey = area.barangayKey || makeBarangayKey(barangay);
        const purok = area.purok || "";
        const purokKey = area.purokKey || (purok ? makePurokKey(purok) : "all");
        const areaTime = area.startTime || purokTimes[purok] || primaryStartTime;
        const areaName = purok ? `${barangay}, ${purok}` : `${barangay}, all Puroks`;
        const areaMessage =
          status === "created"
            ? `Garbage collection for ${areaName} is scheduled every ${dayLabel} at ${formatTime(areaTime)}.`
            : `The garbage collection schedule for ${areaName} has been cancelled.`;

        writes.push(
          set(push(ref(db, "notifications")), {
            ...notificationData,
            barangay,
            barangayKey,
            message: areaMessage,
            purok,
            puroks: [purok],
            assignedPuroks: [purok],
            purokKey,
            purokKeys: [purokKey],
            startTime: areaTime,
            targetType: "barangay_purok",
            notifyAllPurok: !purok,
          }),
          set(push(ref(db, `notificationsByArea/${barangayKey}/${purokKey}`)), {
            ...notificationData,
            barangay,
            barangayKey,
            message: areaMessage,
            purok,
            puroks: [purok],
            assignedPuroks: [purok],
            purokKey,
            purokKeys: [purokKey],
            startTime: areaTime,
            targetType: "barangay_purok",
            notifyAllPurok: !purok,
          }),
        );
    }

    await Promise.all(writes);

    /*
     * Realtime Database writes populate the in-app Alerts/Schedule history,
     * but they do NOT wake a closed Android app. Send a real FCM push too.
     */
    try {
      const currentAdmin = auth.currentUser;

      if (!currentAdmin) {
        console.warn(
          "Schedule saved, but FCM was skipped because the admin session is unavailable.",
        );
        return;
      }

      const idToken = await currentAdmin.getIdToken();

      const pushRequests = targetedAreas.map(async (area) => {
          const barangay = area.barangay;
          const purok = area.purok || "";
          const areaTime = area.startTime || purokTimes[purok] || primaryStartTime;
          const areaName = purok ? `${barangay}, ${purok}` : `${barangay}, all Puroks`;
          const areaMessage =
            status === "created"
              ? `Garbage collection for ${areaName} is scheduled every ${dayLabel} at ${formatTime(areaTime)}.`
              : `The garbage collection schedule for ${areaName} has been cancelled.`;

          const response = await fetch("/api/send-alert", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              title: notificationTitle,
              message: areaMessage,
              type: "schedule",
              target: "resident",
              barangay,
              barangays: [barangay],
              puroks: purok ? [purok] : [],
              purokTimes,
              startTime: areaTime,
              scheduleId,
              scheduleTitle: title,
              status,
            }),
          });

          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(
              `${barangay} ${purok}: ${result?.error || response.statusText}`,
            );
          }
        });

      const results = await Promise.allSettled(pushRequests);
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        console.warn(
          `Schedule was saved, but ${failures.length} targeted phone push request(s) failed.`,
        );
      }
    } catch (error) {
      console.warn("Schedule was saved but FCM push could not be sent:", error);
    }
  };

  const hasPotentialConflict = (): boolean =>
    schedules.some((schedule) => {
      const existingBarangayKeys = new Set(
        getScheduleBarangays(schedule).map(makeBarangayKey),
      );
      const overlapsBarangay = selectedBarangays.some((barangay) =>
        existingBarangayKeys.has(makeBarangayKey(barangay)),
      );
      const existingDays = getScheduleDays(schedule);
      const sameDay = selectedDays.some((day) => existingDays.includes(day));
      const existingPuroks = getSchedulePuroks(schedule);
      const existingPurokTimes = getSchedulePurokTimes(schedule);
      const overlapsPurokAtSameTime = selectedPuroks.some(
        (purok) =>
          existingPuroks.includes(purok) &&
          Boolean(purokTimes[purok]) &&
          existingPurokTimes[purok] === purokTimes[purok],
      );
      const active =
        String(schedule.status || "active").toLowerCase() === "active";

      return overlapsBarangay && sameDay && overlapsPurokAtSameTime && active;
    });

  const saveSchedule = async () => {
    setSuccessMessage("");

    if (!form.title.trim()) return alert("Enter a schedule title.");
    if (selectedBarangays.length === 0) {
      return alert("Select at least one Barangay.");
    }
    if (selectedPuroks.length === 0) {
      return alert("Select at least one Purok.");
    }
    const puroksWithoutTime = selectedPuroks.filter(
      (purok) => !purokTimes[purok],
    );
    if (puroksWithoutTime.length > 0) {
      return alert(
        `Set a collection time for ${puroksWithoutTime.join(", ")}.`,
      );
    }
    if (selectedDays.length === 0)
      return alert("Select at least one weekly collection day.");
    if (!form.routeId) return alert("Select a route assignment.");

    const route = routes.find((item) => item.id === form.routeId);
    if (
      !route ||
      !routeCoversSelection(route, selectedBarangays, selectedPuroks)
    ) {
      return alert(
        "The selected route must cover every selected Barangay and Purok, and have an assigned driver.",
      );
    }

    const driverId = form.assignedDriverId || route.assignedDriverId || "";
    const driver = drivers.find((item) => item.id === driverId);
    if (!driver)
      return alert("The selected route has no valid assigned driver.");

    if (hasPotentialConflict()) {
      const proceed = window.confirm(
        "A similar active schedule already exists for an overlapping Barangay, Purok, day, and time. Continue anyway?",
      );
      if (!proceed) return;
    }

    const allPuroks = availablePuroks.length > 0 && selectedPuroks.length === availablePuroks.length;
    const purokNumbers = selectedPuroks.map((purok) =>
      Number(purok.replace(/\D/g, "")),
    );
    const purokLabel = allPuroks ? ALL_PUROKS_LABEL : selectedPuroks.join(", ");
    const barangays = Array.from(new Set(selectedBarangays));
    const primaryBarangay = barangays[0];
    const primaryStartTime = purokTimes[selectedPuroks[0]];
    const collectionTimesByPurok = selectedPuroks.reduce<
      Record<string, string>
    >((result, purok) => {
      result[makePurokKey(purok)] = purokTimes[purok];
      return result;
    }, {});
    const selectedBarangayKeys = new Set(barangays.map(makeBarangayKey));
    const selectedPurokLabels = new Set(selectedPuroks.map(normalizePurokLabel));
    const scheduleAreas = getServiceAreas(route.areas)
      .filter((area) => selectedBarangayKeys.has(makeBarangayKey(area.barangay)))
      .filter((area) => !area.purok || selectedPurokLabels.has(normalizePurokLabel(area.purok)))
      .map((area) => ({
        ...area,
        startTime: area.purok
          ? purokTimes[normalizePurokLabel(area.purok)] || primaryStartTime
          : primaryStartTime,
      }));

    if (scheduleAreas.length === 0) {
      return alert("The route assignment has no Barangay/Purok coverage matching this schedule.");
    }
    const uncoveredAreas = barangays.flatMap((barangay) =>
      selectedPuroks
        .filter(
          (purok) =>
            !scheduleAreas.some(
              (area) =>
                makeBarangayKey(area.barangay) === makeBarangayKey(barangay) &&
                normalizePurokLabel(area.purok) === normalizePurokLabel(purok),
            ),
        )
        .map((purok) => `${barangay} / ${purok}`),
    );
    if (uncoveredAreas.length > 0) {
      return alert(`The selected route assignment does not include: ${uncoveredAreas.join(", ")}.`);
    }

    try {
      setIsSaving(true);

      const scheduleReference = push(ref(db, "schedules"));
      const scheduleId = scheduleReference.key;
      if (!scheduleId) throw new Error("Unable to create schedule ID.");

      const timestamp = Date.now();
      const truck =
        form.truckId.trim() || route.assignedVehicle || driver.truck || "";

      const payload = {
        title: form.title.trim(),
        barangay: primaryBarangay,
        barangayKey: makeBarangayKey(primaryBarangay),
        barangays,
        barangayKeys: barangays.map(makeBarangayKey),
        areas: scheduleAreas,
        purok: purokLabel,
        assignedPuroks: selectedPuroks,
        puroks: purokNumbers,
        purokKeys: selectedPuroks.map(makePurokKey),
        purokTimes,
        collectionTimesByPurok,
        purokKey: allPuroks
          ? "all"
          : selectedPuroks.length === 1
            ? makePurokKey(selectedPuroks[0])
            : "multiple",
        targetPurok: purokLabel,
        scheduleDay: selectedDays[0],
        scheduleDays: selectedDays,
        startTime: primaryStartTime,
        truckId: truck,
        assignedDriverId: driver.id,
        driverId: driver.id,
        driverName: driver.name || "",
        routeId: route.id,
        assignedRouteId: route.id,
        routeName: route.routeName || "",
        routeModel: "service-area-live-gps",
        routeType: "service-area-route",
        trackingMode: "live-gps",
        routeVerified: true,
        notes: form.notes.trim(),
        status: "active",
        scheduleType: "weekly",
        repeat: "weekly",
        recurrence: {
          frequency: "weekly",
          dayOfWeek: selectedDays[0],
          daysOfWeek: selectedDays,
          time: primaryStartTime,
          timesByPurok: purokTimes,
        },
        isRecurring: true,
        targetType:
          barangays.length > 1
            ? "multiple_barangays_puroks"
            : allPuroks
              ? "barangay_all_purok"
              : selectedPuroks.length > 1
                ? "barangay_multiple_puroks"
                : "barangay_purok",
        notifyAllPurok: allPuroks,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await set(scheduleReference, payload);

      await createScheduleNotification({
        scheduleId,
        title: form.title.trim(),
        barangays,
        puroks: selectedPuroks,
        purokTimes,
        days: selectedDays,
        status: "created",
        notes: form.notes.trim(),
        areas: scheduleAreas,
      });

      setSuccessMessage(
        `Weekly schedule saved for ${barangays.join(", ")} with individual collection times for ${selectedPuroks.length} Purok${selectedPuroks.length === 1 ? "" : "s"}.`,
      );
      closeForm();
    } catch (error) {
      console.error("Unable to save schedule", error);
      alert("Unable to create the schedule.");
      setIsSaving(false);
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    if (
      !window.confirm("Delete this schedule and notify affected residents?")
    ) {
      return;
    }

    try {
      await remove(ref(db, `schedules/${schedule.id}`));

      const schedulePuroks = getSchedulePuroks(schedule);
      const schedulePurokTimes = getSchedulePurokTimes(schedule);

      await createScheduleNotification({
        scheduleId: schedule.id,
        title: schedule.title || "Schedule",
        barangays: getScheduleBarangays(schedule),
        puroks: schedulePuroks,
        purokTimes: schedulePuroks.reduce<Record<string, string>>(
          (result, purok) => {
            result[purok] =
              schedulePurokTimes[purok] || schedule.startTime || "";
            return result;
          },
          {},
        ),
        days: getScheduleDays(schedule),
        status: "cancelled",
        notes: schedule.notes || "",
        areas: getServiceAreas(schedule.areas),
      });

      setSuccessMessage("Schedule deleted and cancellation notification sent.");
    } catch (error) {
      console.error("Unable to delete schedule", error);
      alert("Unable to delete the schedule.");
    }
  };

  return (
    <DashboardShell
      title="Collection Schedules"
      description="Schedule multiple Barangays and set the expected time for every Purok."
    >
      <div className="schedule-page">
        {successMessage ? (
          <div className="success-banner page-reveal reveal-1">
            <span>{successMessage}</span>
            <button type="button" onClick={() => setSuccessMessage("")}>
              ×
            </button>
          </div>
        ) : null}

        <section className="metrics page-reveal reveal-1">
          <Metric
            icon={<CalendarMetricIcon />}
            tone="green"
            label="Total schedules"
            value={schedules.length}
            hint="All saved schedules"
          />

          <Metric
            icon={<ActiveMetricIcon />}
            tone="blue"
            label="Active"
            value={
              schedules.filter(
                (schedule) =>
                  String(schedule.status || "active").toLowerCase() ===
                  "active",
              ).length
            }
            hint="Currently active schedules"
          />

          <Metric
            icon={<RouteMetricIcon />}
            tone="amber"
            label="Routes available"
            value={routes.length}
            hint="With assigned areas"
          />

          <Metric
            icon={<DriversMetricIcon />}
            tone="purple"
            label="Drivers"
            value={drivers.length}
            hint="Available drivers"
          />
        </section>

        <section className="schedule-card page-reveal reveal-2">
          <div className="toolbar">
            <div className="toolbar-title">
              <h2>Weekly schedules</h2>
              <p>
                Schedules match route coverage across all selected Barangays and
                Puroks.
              </p>
            </div>

            <div className="toolbar-actions">
              <label className="schedule-search" aria-label="Search schedules">
                <span className="search-icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <input
                  type="search"
                  placeholder="Search schedules..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <button
                type="button"
                className="create-schedule-btn"
                onClick={() => setShowForm(true)}
              >
                <span aria-hidden="true">＋</span>
                Create Schedule
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Service area</th>
                  <th>Day / Time</th>
                  <th>Route</th>
                  <th>Driver / Truck</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredSchedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No schedules found.
                    </td>
                  </tr>
                ) : (
                  filteredSchedules.map((schedule, index) => (
                    <tr
                      key={schedule.id}
                      className="schedule-row"
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <td>
                        <strong>{schedule.title || "Untitled schedule"}</strong>
                        <small>{schedule.id}</small>
                      </td>

                      <td>
                        <div className="barangay-tags">
                          {getScheduleBarangays(schedule).map((barangay) => (
                            <span key={barangay}>{barangay}</span>
                          ))}
                        </div>
                        <small>
                          {getSchedulePuroks(schedule).join(", ") || "—"}
                        </small>
                      </td>

                      <td>
                        <strong>
                          {formatDayList(getScheduleDays(schedule))}
                        </strong>
                        <small>{formatScheduleTimeSummary(schedule)}</small>
                      </td>

                      <td>{schedule.routeName || "—"}</td>

                      <td>
                        <strong>{schedule.driverName || "—"}</strong>
                        <small>{schedule.truckId || "No truck"}</small>
                      </td>

                      <td>
                        <span className="status-pill">
                          <i aria-hidden="true" />
                          {String(schedule.status || "active")}
                        </span>
                      </td>

                      <td>{formatDate(schedule.createdAt)}</td>

                      <td>
                        <button
                          type="button"
                          className="delete-btn"
                          onClick={() => deleteSchedule(schedule)}
                        >
                          <span className="delete-icon" aria-hidden="true">
                            <TrashIcon />
                          </span>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <p>
              Showing {filteredSchedules.length === 0 ? 0 : 1} to{" "}
              {filteredSchedules.length} of {filteredSchedules.length} schedules
            </p>

            <div className="pagination" aria-label="Schedule table pagination">
              <button type="button" disabled aria-label="Previous page">
                <PrevIcon />
              </button>
              <button type="button" className="current" aria-current="page">
                1
              </button>
              <button type="button" disabled aria-label="Next page">
                <NextIcon />
              </button>
            </div>
          </div>
        </section>

        {showForm ? (
          <div className="modal-backdrop" role="presentation">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="schedule-form-title"
            >
              <header>
                <div>
                  <span>NEW WEEKLY SCHEDULE</span>
                  <h2 id="schedule-form-title">
                    Create garbage collection schedule
                  </h2>
                  <p>
                    Select multiple Barangays, Puroks, days, and a time for each
                    Purok.
                  </p>
                </div>
                <button type="button" onClick={closeForm} aria-label="Close">
                  ×
                </button>
              </header>

              <div className="modal-body">
                <div className="form-grid">
                  <label>
                    <span>Schedule title</span>
                    <input
                      value={form.title}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Example: Canlapwas Mon-Wed-Fri Collection"
                    />
                  </label>

                  <div
                    className="field-group barangay-field"
                    ref={barangayPickerRef}
                  >
                    <span className="field-label">Barangays</span>
                    <button
                      type="button"
                      className={`multi-select-trigger ${barangayPickerOpen ? "open" : ""}`}
                      aria-haspopup="listbox"
                      aria-expanded={barangayPickerOpen}
                      onClick={() => setBarangayPickerOpen((open) => !open)}
                    >
                      <span>
                        {selectedBarangays.length === 0
                          ? "Select one or more Barangays"
                          : selectedBarangays.length === 1
                            ? selectedBarangays[0]
                            : `${selectedBarangays.length} Barangays selected`}
                      </span>
                      <strong>{selectedBarangays.length || ""}</strong>
                      <i aria-hidden="true">⌄</i>
                    </button>

                    {barangayPickerOpen ? (
                      <div
                        className="multi-select-menu"
                        role="listbox"
                        aria-label="Select schedule Barangays"
                        aria-multiselectable="true"
                      >
                        <div className="multi-select-menu-head">
                          <span>Service areas</span>
                          <button type="button" onClick={selectAllBarangays}>
                            {availableBarangays.length > 0 && selectedBarangays.length === availableBarangays.length
                              ? "Clear all"
                              : "Select all"}
                          </button>
                        </div>

                        {availableBarangays.length === 0 ? (
                          <div className="empty-state">
                            No service areas yet. Add a Barangay and Purok first.
                          </div>
                        ) : null}

                        {availableBarangays.map((barangay) => {
                          const selected = selectedBarangays.includes(barangay);
                          return (
                            <button
                              key={barangay}
                              type="button"
                              className={`multi-select-option ${selected ? "selected" : ""}`}
                              role="option"
                              aria-selected={selected}
                              onClick={() => toggleBarangay(barangay)}
                            >
                              <span className="check-box">
                                {selected ? "✓" : ""}
                              </span>
                              <span>{barangay}</span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          className="multi-select-done"
                          onClick={() => setBarangayPickerOpen(false)}
                        >
                          Done
                        </button>
                      </div>
                    ) : null}

                    {selectedBarangays.length > 0 ? (
                      <div
                        className="selected-barangay-chips"
                        aria-label="Selected Barangays"
                      >
                        {selectedBarangays.map((barangay) => (
                          <button
                            key={barangay}
                            type="button"
                            onClick={() => toggleBarangay(barangay)}
                            aria-label={`Remove ${barangay}`}
                          >
                            {barangay}
                            <span aria-hidden="true">×</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="purok-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Purok coverage</h3>
                      <p>
                        Click a Purok, then set its expected collection time.
                      </p>
                    </div>
                    <button type="button" onClick={selectAllPuroks}>
                      {availablePuroks.length > 0 && selectedPuroks.length === availablePuroks.length
                        ? "Clear all"
                        : "Select all"}
                    </button>
                  </div>

                  <div className="purok-grid">
                    {selectedBarangays.length > 0 && availablePuroks.length === 0 ? (
                      <p className="empty-state">The selected Barangay has no active Purok.</p>
                    ) : null}
                    {availablePuroks.map((purok) => {
                      const selected = selectedPuroks.includes(purok);
                      return (
                        <button
                          key={purok}
                          type="button"
                          className={selected ? "selected" : ""}
                          aria-pressed={selected}
                          onClick={() => togglePurok(purok)}
                        >
                          <span>{selected ? "✓" : "+"}</span>
                          {purok}
                        </button>
                      );
                    })}
                  </div>

                  {selectedPuroks.length > 0 ? (
                    <div className="purok-time-panel">
                      <div className="purok-time-heading">
                        <div>
                          <h4>Collection time per Purok</h4>
                          <p>
                            Times may differ because of traffic and route
                            conditions.
                          </p>
                        </div>
                        <span>{selectedPuroks.length} selected</span>
                      </div>

                      <div className="purok-time-grid">
                        {selectedPuroks.map((purok) => (
                          <label className="purok-time-field" key={purok}>
                            <span>{purok}</span>
                            <input
                              type="time"
                              value={purokTimes[purok] || ""}
                              onChange={(event) =>
                                setPurokTime(purok, event.target.value)
                              }
                              required
                              aria-label={`Collection time for ${purok}`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="day-time-grid">
                  <div className="day-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Weekly collection days</h3>
                        <p>Select every day this schedule should repeat.</p>
                      </div>
                      <div className="day-actions">
                        <button type="button" onClick={selectWeekdays}>
                          {[
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                          ].every((day) => selectedDays.includes(day))
                            ? "Clear weekdays"
                            : "Select weekdays"}
                        </button>
                        {selectedDays.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setSelectedDays([])}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className="day-grid"
                      role="group"
                      aria-label="Weekly collection days"
                    >
                      {DAYS.map((day) => {
                        const selected = selectedDays.includes(day);

                        return (
                          <button
                            key={day}
                            type="button"
                            className={selected ? "selected" : ""}
                            aria-pressed={selected}
                            onClick={() => toggleDay(day)}
                          >
                            <span>{selected ? "✓" : "+"}</span>
                            {day.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="selection-summary">
                      {selectedDays.length > 0
                        ? `Repeats every ${formatDayList(selectedDays)}`
                        : "No collection day selected yet."}
                    </p>
                  </div>
                </div>

                <label>
                  <span>Assigned route</span>
                  <select
                    value={form.routeId}
                    onChange={(event) => selectRoute(event.target.value)}
                    disabled={
                      selectedBarangays.length === 0 ||
                      selectedPuroks.length === 0
                    }
                  >
                    <option value="">
                      {selectedBarangays.length === 0
                        ? "Select Barangays first"
                        : selectedPuroks.length === 0
                          ? "Select at least one Purok first"
                          : compatibleRoutes.length === 0
                            ? "No compatible route available"
                            : "Select route assignment"}
                    </option>
                    {compatibleRoutes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.routeName || "Unnamed route"} —{" "}
                        {getRoutePuroks(route).join(", ")}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedBarangays.length > 0 &&
                selectedPuroks.length > 0 &&
                compatibleRoutes.length === 0 ? (
                  <div className="warning-card">
                    No saved route covers every selected Barangay and Purok.
                    Create or update the route assignment first.
                  </div>
                ) : null}

                <div className="form-grid">
                  <label>
                    <span>Assigned driver</span>
                    <input
                      value={
                        drivers.find(
                          (driver) => driver.id === form.assignedDriverId,
                        )?.name ||
                        selectedRoute?.assignedDriverName ||
                        ""
                      }
                      readOnly
                      placeholder="Automatically loaded from route"
                    />
                  </label>

                  <label>
                    <span>Truck / plate number</span>
                    <input
                      value={form.truckId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          truckId: event.target.value,
                        }))
                      }
                      placeholder="Optional"
                    />
                  </label>
                </div>

                <label>
                  <span>Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Optional notes for admin records and resident notification"
                    rows={4}
                  />
                </label>

                <div className="info-card">
                  <strong>Area-based route assignment</strong>
                  <p>
                    The selected route must cover every selected Barangay and
                    Purok. Each Purok keeps its own time, and residents receive
                    the time for their exact service area.
                  </p>
                </div>
              </div>

              <footer>
                <button type="button" className="secondary" onClick={closeForm}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={isSaving}
                  onClick={saveSchedule}
                >
                  {isSaving ? "Saving…" : "Save Multi-Day Schedule + Notify"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <style jsx>{`
          .schedule-page {
            width: 100%;
            max-width: 1680px;
            margin: 0 auto;
            display: grid;
            gap: 18px;
            color: #14251d;
          }

          .page-reveal {
            opacity: 0;
            transform: translateY(9px);
            animation: scheduleReveal 380ms cubic-bezier(0.2, 0.75, 0.25, 1)
              forwards;
          }

          .reveal-1 {
            animation-delay: 40ms;
          }

          .reveal-2 {
            animation-delay: 100ms;
          }

          @keyframes scheduleReveal {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .success-banner {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 13px 15px;
            border: 1px solid #b8e7c4;
            border-radius: 13px;
            background: #f0fdf4;
            color: #166534;
            font-size: 13px;
            box-shadow: 0 6px 18px rgba(16, 35, 27, 0.04);
          }

          .success-banner button {
            width: 32px;
            height: 32px;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
          }

          .metrics {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 14px;
          }

          .schedule-card {
            overflow: hidden;
            border: 1px solid #dfe7e2;
            border-radius: 19px;
            background: #ffffff;
            box-shadow: 0 10px 28px rgba(16, 35, 27, 0.05);
          }

          .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            padding: 20px 22px;
            border-bottom: 1px solid #e6ece8;
          }

          .toolbar-title h2,
          .toolbar-title p {
            margin: 0;
          }

          .toolbar-title h2 {
            color: #10231b;
            font-size: 23px;
            line-height: 1.2;
            letter-spacing: -0.025em;
          }

          .toolbar-title p {
            margin-top: 6px;
            color: #61736a;
            font-size: 13px;
            line-height: 1.5;
          }

          .toolbar-actions {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .schedule-search {
            width: 300px;
            height: 44px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            border: 1px solid #d8e2dc;
            border-radius: 12px;
            background: #ffffff;
            transition:
              border-color 150ms ease,
              box-shadow 150ms ease;
          }

          .schedule-search:focus-within {
            border-color: #62b881;
            box-shadow: 0 0 0 3px rgba(22, 138, 74, 0.1);
          }

          .search-icon {
            width: 18px;
            height: 18px;
            flex: 0 0 18px;
            color: #73867b;
          }

          .search-icon :global(svg) {
            width: 18px;
            height: 18px;
            fill: currentColor;
          }

          .schedule-search input {
            width: 100%;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: #21362b;
            font-size: 13px;
            outline: 0;
            box-shadow: none;
          }

          .schedule-search input::placeholder {
            color: #7d8d84;
          }

          .create-schedule-btn {
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 0 17px;
            border: 1px solid #168a4a;
            border-radius: 11px;
            background: linear-gradient(135deg, #19a454, #138543);
            color: #ffffff;
            font-size: 13px;
            font-weight: 900;
            white-space: nowrap;
            cursor: pointer;
            box-shadow: 0 7px 16px rgba(22, 138, 74, 0.16);
            transition:
              transform 150ms ease,
              background 150ms ease,
              box-shadow 150ms ease;
          }

          .create-schedule-btn:hover {
            transform: translateY(-1px);
            background: linear-gradient(135deg, #168f49, #11773c);
            box-shadow: 0 10px 20px rgba(22, 138, 74, 0.21);
          }

          .table-wrap {
            overflow-x: auto;
          }

          table {
            width: 100%;
            min-width: 1100px;
            border-collapse: collapse;
          }

          th,
          td {
            padding: 16px 18px;
            border-bottom: 1px solid #e7ece9;
            text-align: left;
            vertical-align: middle;
            font-size: 13px;
          }

          th {
            color: #4e6258;
            background: #f8faf9;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.055em;
          }

          td {
            color: #203329;
          }

          td strong,
          td small {
            display: block;
          }

          td strong {
            color: #15281e;
            font-size: 13px;
          }

          td small {
            margin-top: 4px;
            max-width: 230px;
            overflow: hidden;
            color: #6e8077;
            font-size: 11px;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .barangay-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            max-width: 260px;
          }

          .barangay-tags span {
            display: inline-flex;
            border-radius: 999px;
            padding: 4px 8px;
            background: #eff6ff;
            color: #1d4ed8;
            font-size: 10px;
            font-weight: 850;
          }

          .schedule-row {
            opacity: 0;
            transform: translateY(5px);
            animation: scheduleRowIn 300ms ease forwards;
            transition: background 140ms ease;
          }

          .schedule-row:hover {
            background: #fbfdfc;
          }

          @keyframes scheduleRowIn {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #eaf7ee;
            color: #148447;
            font-size: 11px;
            font-weight: 850;
            text-transform: lowercase;
          }

          .status-pill i {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: currentColor;
          }

          .delete-btn {
            min-height: 36px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 0 11px;
            border: 1px solid #ffb9b9;
            border-radius: 9px;
            background: #ffffff;
            color: #e32929;
            font-size: 12px;
            font-weight: 850;
            cursor: pointer;
            transition:
              background 140ms ease,
              border-color 140ms ease,
              transform 140ms ease;
          }

          .delete-btn:hover {
            transform: translateY(-1px);
            border-color: #f58c8c;
            background: #fff7f7;
          }

          .delete-icon {
            width: 15px;
            height: 15px;
          }

          .delete-icon :global(svg) {
            width: 15px;
            height: 15px;
            fill: currentColor;
          }

          .empty-state {
            padding: 52px;
            text-align: center;
            color: #77867e;
          }

          .table-footer {
            min-height: 72px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 12px 22px;
          }

          .table-footer p {
            margin: 0;
            color: #5f7267;
            font-size: 12px;
          }

          .pagination {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .pagination button {
            width: 38px;
            height: 38px;
            display: grid;
            place-items: center;
            border: 1px solid #dce5df;
            border-radius: 10px;
            background: #ffffff;
            color: #7b8b83;
          }

          .pagination button:disabled {
            cursor: default;
            opacity: 0.72;
          }

          .pagination button.current {
            border-color: #168a4a;
            background: #168a4a;
            color: #ffffff;
            font-weight: 900;
            box-shadow: 0 6px 14px rgba(22, 138, 74, 0.14);
          }

          .pagination button :global(svg) {
            width: 16px;
            height: 16px;
            fill: currentColor;
          }

          .modal-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1000;
            display: grid;
            place-items: center;
            padding: 24px;
            background: rgba(15, 23, 42, 0.55);
            backdrop-filter: blur(5px);
          }

          .modal {
            width: min(900px, 100%);
            max-height: calc(100dvh - 48px);
            overflow: auto;
            border-radius: 20px;
            background: #fff;
            box-shadow: 0 28px 90px rgba(15, 23, 42, 0.28);
            animation: modalIn 260ms ease;
          }

          @keyframes modalIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.988);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          .modal header,
          .modal footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 20px 22px;
          }

          .modal header {
            border-bottom: 1px solid #e8eeea;
          }

          .modal footer {
            justify-content: flex-end;
            border-top: 1px solid #e8eeea;
          }

          .modal header span {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.12em;
            color: #168a4a;
          }

          .modal header h2,
          .modal header p {
            margin: 0;
          }

          .modal header h2 {
            margin-top: 5px;
            color: #172c22;
          }

          .modal header p {
            margin-top: 5px;
            color: #6b7b72;
          }

          .modal header > button {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 50%;
            background: #f1f5f3;
            font-size: 22px;
            cursor: pointer;
          }

          .modal-body {
            display: grid;
            gap: 18px;
            padding: 22px;
          }

          .form-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }

          label {
            display: grid;
            gap: 7px;
          }

          label > span {
            color: #34463c;
            font-size: 12px;
            font-weight: 800;
          }

          .field-group {
            position: relative;
            min-width: 0;
            display: grid;
            align-content: start;
            gap: 7px;
          }

          .field-label {
            color: #34463c;
            font-size: 12px;
            font-weight: 800;
          }

          .multi-select-trigger {
            width: 100%;
            min-height: 43px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto;
            align-items: center;
            gap: 9px;
            padding: 10px 12px;
            border: 1px solid #d5dfd9;
            border-radius: 11px;
            background: #ffffff;
            color: #17231d;
            text-align: left;
            cursor: pointer;
          }

          .multi-select-trigger.open,
          .multi-select-trigger:focus-visible {
            border-color: #10b981;
            outline: 0;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
          }

          .multi-select-trigger > span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .multi-select-trigger strong {
            min-width: 23px;
            min-height: 23px;
            display: grid;
            place-items: center;
            border-radius: 999px;
            background: #e9f8ef;
            color: #087443;
            font-size: 11px;
          }

          .multi-select-trigger strong:empty {
            display: none;
          }

          .multi-select-trigger i {
            color: #52645b;
            font-size: 18px;
            font-style: normal;
            line-height: 1;
            transition: transform 160ms ease;
          }

          .multi-select-trigger.open i {
            transform: rotate(180deg);
          }

          .multi-select-menu {
            position: absolute;
            z-index: 40;
            top: 69px;
            left: 0;
            right: 0;
            display: grid;
            gap: 5px;
            padding: 9px;
            border: 1px solid #cfddd5;
            border-radius: 13px;
            background: #ffffff;
            box-shadow: 0 18px 45px rgba(15, 40, 29, 0.18);
          }

          .multi-select-menu-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 4px 5px 7px;
            border-bottom: 1px solid #edf2ef;
            color: #40544a;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.07em;
          }

          .multi-select-menu-head button,
          .multi-select-done {
            border: 0;
            background: transparent;
            color: #078249;
            font-size: 11px;
            font-weight: 900;
            cursor: pointer;
          }

          .multi-select-option {
            width: 100%;
            min-height: 39px;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 7px 9px;
            border: 1px solid transparent;
            border-radius: 9px;
            background: #ffffff;
            color: #25392f;
            text-align: left;
            cursor: pointer;
          }

          .multi-select-option:hover {
            background: #f5faf7;
          }

          .multi-select-option.selected {
            border-color: #a7e6c2;
            background: #ecfdf5;
            color: #047857;
            font-weight: 800;
          }

          .check-box {
            width: 20px;
            height: 20px;
            flex: 0 0 20px;
            display: grid;
            place-items: center;
            border: 1px solid #bccdc3;
            border-radius: 6px;
            background: #ffffff;
            color: #ffffff;
            font-size: 12px;
          }

          .multi-select-option.selected .check-box {
            border-color: #10b981;
            background: #10b981;
          }

          .multi-select-done {
            min-height: 36px;
            margin-top: 2px;
            border-radius: 9px;
            background: #ecfdf5;
          }

          .selected-barangay-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }

          .selected-barangay-chips button {
            min-height: 29px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 9px;
            border: 1px solid #bfdbfe;
            border-radius: 999px;
            background: #eff6ff;
            color: #1d4ed8;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
          }

          .selected-barangay-chips button span {
            font-size: 15px;
            line-height: 1;
          }

          input,
          select,
          textarea {
            width: 100%;
            border: 1px solid #d5dfd9;
            border-radius: 11px;
            padding: 11px 12px;
            background: #fff;
            color: #17231d;
            outline: 0;
          }

          textarea {
            resize: vertical;
          }

          input:focus,
          select:focus,
          textarea:focus {
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
          }

          .purok-panel {
            border: 1px solid #dce6e0;
            border-radius: 15px;
            padding: 16px;
            background: #fbfdfc;
          }

          .panel-heading {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
          }

          .panel-heading h3,
          .panel-heading p {
            margin: 0;
          }

          .panel-heading p {
            margin-top: 4px;
            color: #718078;
            font-size: 13px;
          }

          .panel-heading button,
          .secondary {
            border: 1px solid #d7e1db;
            border-radius: 9px;
            padding: 8px 10px;
            background: #fff;
            color: #33443b;
            font-weight: 700;
            cursor: pointer;
          }

          .purok-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px;
            margin-top: 14px;
          }

          .purok-grid button {
            display: inline-flex;
            justify-content: center;
            gap: 6px;
            border: 1px solid #d7e1db;
            border-radius: 10px;
            padding: 10px 8px;
            background: #fff;
            color: #34463c;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
          }

          .purok-grid button.selected {
            border-color: #10b981;
            background: #ecfdf5;
            color: #047857;
          }

          .purok-time-panel {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #dce6e0;
          }

          .purok-time-heading {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
          }

          .purok-time-heading h4,
          .purok-time-heading p {
            margin: 0;
          }

          .purok-time-heading h4 {
            color: #183329;
            font-size: 14px;
          }

          .purok-time-heading p {
            margin-top: 4px;
            color: #718078;
            font-size: 12px;
          }

          .purok-time-heading > span {
            flex: 0 0 auto;
            border-radius: 999px;
            padding: 5px 9px;
            background: #e9f8ef;
            color: #087443;
            font-size: 10px;
            font-weight: 900;
          }

          .purok-time-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 9px;
            margin-top: 13px;
          }

          .purok-time-field {
            gap: 6px;
            padding: 10px;
            border: 1px solid #dce6e0;
            border-radius: 11px;
            background: #ffffff;
          }

          .purok-time-field > span {
            color: #176b43;
            font-size: 11px;
            font-weight: 900;
          }

          .purok-time-field input {
            padding: 9px 10px;
            background: #f8fcfa;
          }

          .day-time-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 14px;
            align-items: stretch;
          }

          .day-panel {
            border: 1px solid #dce6e0;
            border-radius: 15px;
            padding: 16px;
            background: linear-gradient(180deg, #fbfdfc, #f7fbf9);
          }

          .day-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 7px;
          }

          .day-actions button {
            border: 1px solid #d7e1db;
            border-radius: 9px;
            padding: 7px 9px;
            background: #ffffff;
            color: #33443b;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
          }

          .day-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 8px;
            margin-top: 14px;
          }

          .day-grid button {
            min-height: 46px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            border: 1px solid #d6e1da;
            border-radius: 11px;
            background: #ffffff;
            color: #43564b;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            transition:
              transform 140ms ease,
              border-color 140ms ease,
              background 140ms ease,
              color 140ms ease;
          }

          .day-grid button:hover {
            transform: translateY(-1px);
            border-color: #86efac;
          }

          .day-grid button.selected {
            border-color: #16a34a;
            background: #dcfce7;
            color: #166534;
            box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.09);
          }

          .selection-summary {
            margin: 12px 0 0;
            color: #52655a;
            font-size: 12px;
            font-weight: 700;
          }

          .warning-card {
            border: 1px solid #fdba74;
            border-radius: 12px;
            padding: 12px 14px;
            background: #fff7ed;
            color: #9a3412;
            font-size: 13px;
          }

          .info-card {
            border: 1px solid #a7f3d0;
            border-radius: 14px;
            padding: 14px;
            background: #ecfdf5;
            color: #065f46;
          }

          .info-card strong,
          .info-card p {
            display: block;
            margin: 0;
          }

          .info-card p {
            margin-top: 5px;
            line-height: 1.55;
            font-size: 13px;
          }

          .primary {
            border: 0;
            border-radius: 12px;
            padding: 12px 18px;
            background: #22c55e;
            color: #052e16;
            font-weight: 800;
            cursor: pointer;
          }

          @media (max-width: 1100px) {
            .metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .toolbar {
              align-items: stretch;
              flex-direction: column;
            }

            .toolbar-actions {
              width: 100%;
            }

            .schedule-search {
              flex: 1;
              width: auto;
            }
          }

          @media (max-width: 900px) {
            .day-time-grid {
              grid-template-columns: 1fr;
            }

            .day-grid {
              grid-template-columns: repeat(4, minmax(0, 1fr));
            }
          }

          @media (max-width: 700px) {
            .toolbar-actions,
            .panel-heading {
              align-items: stretch;
              flex-direction: column;
            }

            .create-schedule-btn,
            .schedule-search {
              width: 100%;
            }

            .form-grid {
              grid-template-columns: 1fr;
            }

            .purok-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .purok-time-grid {
              grid-template-columns: 1fr;
            }

            .purok-time-heading {
              flex-direction: column;
            }

            .day-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .day-actions {
              justify-content: flex-start;
            }

            .metrics {
              grid-template-columns: 1fr;
            }

            .table-footer {
              align-items: flex-start;
              flex-direction: column;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .page-reveal,
            .schedule-row,
            .modal {
              opacity: 1 !important;
              transform: none !important;
              animation: none !important;
            }
          }
        `}</style>
      </div>
    </DashboardShell>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  tone: "green" | "blue" | "amber" | "purple";
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="metric">
      <div className={`metric-icon ${tone}`}>{icon}</div>

      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>

      <style jsx>{`
        .metric {
          min-height: 118px;
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 18px 19px;
          border: 1px solid #dfe7e2;
          border-radius: 17px;
          background: #ffffff;
          box-shadow: 0 7px 20px rgba(16, 35, 27, 0.045);
          transition:
            transform 150ms ease,
            box-shadow 150ms ease,
            border-color 150ms ease;
        }

        .metric:hover {
          transform: translateY(-2px);
          border-color: #c8d9cf;
          box-shadow: 0 11px 25px rgba(16, 35, 27, 0.07);
        }

        .metric-icon {
          width: 54px;
          height: 54px;
          flex: 0 0 54px;
          display: grid;
          place-items: center;
          border-radius: 16px;
        }

        .metric-icon.green {
          background: #e7f6ec;
          color: #17914f;
        }

        .metric-icon.blue {
          background: #e8f2fe;
          color: #2580dc;
        }

        .metric-icon.amber {
          background: #fff4dc;
          color: #e8a000;
        }

        .metric-icon.purple {
          background: #f1e9ff;
          color: #8f43e6;
        }

        .metric-icon :global(svg) {
          width: 27px;
          height: 27px;
          fill: currentColor;
        }

        .metric-copy {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .metric-copy span {
          color: #465b50;
          font-size: 14px;
          font-weight: 800;
        }

        .metric-copy strong {
          color: #10231b;
          font-size: 28px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.035em;
        }

        .metric-copy small {
          color: #6b7d73;
          font-size: 12px;
          line-height: 1.35;
        }

        @media (max-width: 700px) {
          .metric {
            min-height: 104px;
          }
        }
      `}</style>
    </article>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.7 4a6.7 6.7 0 1 0 0 13.4A6.7 6.7 0 0 0 10.7 4Zm0 2a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm5.8 9.1 4.5 4.5-1.4 1.4-4.5-4.5 1.4-1.4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v7H9v-7Zm4 0h2v7h-2v-7ZM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.4 5.4 9 11.8l6.4 6.4-1.4 1.4L6.2 12l7.8-7.8 1.4 1.2Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8.6 18.6 6.4-6.4-6.4-6.4L10 4.4l7.8 7.8-7.8 7.8-1.4-1.4Z" />
    </svg>
  );
}

function CalendarMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h2v3H7V2Zm8 0h2v3h-2V2ZM4 5h16a1 1 0 0 1 1 1v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Zm2 5v10h12V10H6Zm2 3h3v3H8v-3Z" />
    </svg>
  );
}

function ActiveMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.3 14.2-4-4 1.4-1.4 2.6 2.6 5.2-5.2 1.4 1.4-6.6 6.6Z" />
    </svg>
  );
}

function RouteMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm10 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9.7 8h6.8a3.5 3.5 0 0 1 0 7H14v-2h2.5a1.5 1.5 0 0 0 0-3H9.7V8Z" />
    </svg>
  );
}

function DriversMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.5 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2 19c0-3.1 3.1-5 6-5s6 1.9 6 5v1H2v-1Zm12.5 1v-1c0-1.1-.3-2.1-.9-3 2.3.3 5.4 1.6 5.4 4h-4.5Z" />
    </svg>
  );
}
