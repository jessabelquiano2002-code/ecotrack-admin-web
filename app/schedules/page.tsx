"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, remove, set } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = ["Mercedes", "Canlapwas", "Maulong", "San Andres", "Poblacion 13"];
const PUROKS = Array.from({ length: 10 }, (_, index) => index + 1);
const ALL_PUROKS_VALUE = "all";
const ALL_PUROKS_LABEL = "All Puroks";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
  scheduleDays?: string[] | Record<string, string | boolean>;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicle?: string;
  checkpoints?: unknown[] | Record<string, unknown>;
};

type Schedule = {
  id: string;
  title?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  purokKey?: string;
  purokNumber?: string | number;
  targetPurok?: string;
  assignedPuroks?: string[] | Record<string, string | boolean>;
  puroks?: Array<string | number> | Record<string, string | number | boolean>;
  purokKeys?: string[] | Record<string, string | boolean>;
  scheduleDay?: string;
  scheduleDays?: string[] | string;
  startTime?: string;
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
  lastCompletedDate?: string;
  lastCollectionReportId?: string;
};

type ScheduleForm = {
  title: string;
  startTime: string;
  truckId: string;
  assignedDriverId: string;
  notes: string;
  routeId: string;
};

const emptyForm: ScheduleForm = {
  title: "",
  startTime: "",
  truckId: "",
  assignedDriverId: "",
  notes: "",
  routeId: "",
};

const makeBarangayKey = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

const isAllPurokValue = (value: unknown) => {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_")
    .trim();

  return (
    normalized === "all" ||
    normalized === "all_purok" ||
    normalized === "all_puroks" ||
    normalized === "barangay_all_purok" ||
    normalized === "all_barangay_purok"
  );
};

const makePurokKey = (value: unknown) => {
  if (isAllPurokValue(value)) return "all";

  const number = Number(value);
  return Number.isNaN(number) ? "" : `purok_${number}`;
};

const normalizeArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => item === true ? key : typeof item === "string" || typeof item === "number" ? String(item) : "")
      .filter(Boolean);
  }
  if (!value) return [];
  return [String(value)];
};

const formatTime = (value?: string) => {
  if (!value) return "-";

  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = minuteRaw || "00";

  if (Number.isNaN(hour)) return value;

  const period = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;

  return `${normalizedHour}:${minute} ${period}`;
};

const getPurokDisplay = (value: unknown) => {
  if (isAllPurokValue(value)) return ALL_PUROKS_LABEL;
  return value ? `Purok ${value}` : "-";
};

const getSchedulePurokDisplay = (schedule: Schedule) => {
  const assigned = normalizeArray(schedule.assignedPuroks || schedule.puroks);
  if (assigned.length > 0) return assigned.join(", ");
  if (
    isAllPurokValue(schedule.purok) ||
    isAllPurokValue(schedule.purokKey) ||
    isAllPurokValue(schedule.targetPurok) ||
    isAllPurokValue(schedule.purokNumber)
  ) {
    return ALL_PUROKS_LABEL;
  }

  return getPurokDisplay(schedule.purok || schedule.purokNumber);
};

const getSchedulePuroks = (schedule: Schedule): string[] => {
  const assigned = normalizeArray(schedule.assignedPuroks || schedule.puroks);
  if (assigned.length > 0) return assigned.map((value) => value.toLowerCase().startsWith("purok") ? value : `Purok ${value}`);
  if (isAllPurokValue(schedule.purok) || isAllPurokValue(schedule.purokKey) || isAllPurokValue(schedule.targetPurok)) {
    return PUROKS.map((value) => `Purok ${value}`);
  }
  const single = schedule.purok || schedule.purokNumber;
  return single ? [String(single).toLowerCase().startsWith("purok") ? String(single) : `Purok ${single}`] : [];
};

const isScheduleForSpecificPurok = (schedule: Schedule, purok: string) => {
  if (!purok) return true;

  if (isAllPurokValue(purok)) {
    return getSchedulePuroks(schedule).length === PUROKS.length;
  }

  const scheduleIsAll =
    isAllPurokValue(schedule.purok) ||
    isAllPurokValue(schedule.purokKey) ||
    isAllPurokValue(schedule.targetPurok) ||
    isAllPurokValue(schedule.purokNumber);

  if (scheduleIsAll) return true;

  return scheduleIsAll || getSchedulePuroks(schedule).some((value) => value === `Purok ${purok}` || value === purok);
};

const formatDate = (value?: number) => {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleDateString("en-PH", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return "-";
  }
};


const getDateKey = (timestamp = Date.now()) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [locations, setLocations] = useState<Record<string, unknown>>({});

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");

  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedPurok, setSelectedPurok] = useState("");
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState("");

  const [form, setForm] = useState<ScheduleForm>(emptyForm);

  useEffect(() => {
    const allowedKeys = BARANGAYS.map(makeBarangayKey);

    const unsubSchedules = onValue(ref(db, "schedules"), (snap) => {
      const value = snap.val() || {};

      const list: Schedule[] = Object.entries(value)
        .map(([id, data]: any) => ({
          id,
          ...data,
        }))
        .filter((schedule: Schedule) => {
          const barangay = schedule.barangay || "";
          const barangayKey = schedule.barangayKey || makeBarangayKey(barangay);
          return allowedKeys.includes(barangayKey);
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      setSchedules(list);
    });

    const unsubDrivers = onValue(ref(db, "drivers"), (snap) => {
      const value = snap.val() || {};
      const list: Driver[] = Object.entries(value).map(([id, data]: any) => ({
        id,
        ...data,
      }));

      setDrivers(list);
    });

    const unsubLocations = onValue(ref(db, "driver_locations"), (snap) => {
      setLocations(snap.val() || {});
    });

    const unsubRoutes = onValue(ref(db, "routes"), (snap) => {
      const value = snap.val() || {};
      setRoutes(Object.entries(value).map(([id, data]) => ({ id, ...(data as Omit<RouteRecord, "id">) })));
    });

    return () => {
      unsubSchedules();
      unsubDrivers();
      unsubLocations();
      unsubRoutes();
    };
  }, []);

  const filteredSchedules = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return schedules.filter((schedule) => {
      if (selectedBarangay) {
        const scheduleKey = schedule.barangayKey || makeBarangayKey(schedule.barangay || "");
        if (scheduleKey !== makeBarangayKey(selectedBarangay)) return false;
      }

      if (!isScheduleForSpecificPurok(schedule, selectedPurok)) return false;

      if (selectedDay) {
        const days = normalizeArray(schedule.scheduleDays);
        if (!days.includes(selectedDay) && schedule.scheduleDay !== selectedDay) return false;
      }

      if (!keyword) return true;

      const searchable = `
        ${schedule.title || ""}
        ${schedule.barangay || ""}
        ${getSchedulePurokDisplay(schedule)}
        ${schedule.scheduleDay || ""}
        ${normalizeArray(schedule.scheduleDays).join(" ")}
        ${schedule.driverName || ""}
        ${schedule.truckId || ""}
        ${schedule.status || ""}
      `.toLowerCase();

      return searchable.includes(keyword);
    });
  }, [schedules, search, selectedBarangay, selectedPurok, selectedDay]);

  const stats = useMemo(() => {
    const todayKey = getDateKey();
    const active = schedules.filter((schedule) => String(schedule.status || "active").toLowerCase() === "active");
    const completedToday = schedules.filter((schedule) => schedule.lastCompletedDate === todayKey);
    const withDrivers = schedules.filter((schedule) => schedule.driverId || schedule.assignedDriverId);

    return {
      total: schedules.length,
      active: active.length,
      weekly: schedules.filter((schedule) => schedule.isRecurring || schedule.repeat === "weekly" || schedule.scheduleDay).length,
      completedToday: completedToday.length,
      withDrivers: withDrivers.length,
    };
  }, [schedules]);

  const bestDriver = useMemo(() => {
    if (drivers.length === 0) return null;

    const onlineDrivers = drivers.filter(
      (driver) => String(driver.status || "").toLowerCase() === "online"
    );

    const candidates = onlineDrivers.length > 0 ? onlineDrivers : drivers;

    const ranked = candidates.map((driver) => {
      const assignedSchedules = schedules.filter(
        (schedule) => schedule.driverId === driver.id || schedule.assignedDriverId === driver.id
      );

      const dayConflict = assignedSchedules.filter((schedule) =>
        normalizeArray(schedule.scheduleDays).includes(selectedDay)
      ).length;

      const barangayConflict = assignedSchedules.filter(
        (schedule) => makeBarangayKey(schedule.barangay || "") === makeBarangayKey(selectedBarangay)
      ).length;

      const score = assignedSchedules.length * 10 + dayConflict * 50 + barangayConflict * 30;

      return {
        ...driver,
        score,
      };
    });

    ranked.sort((a, b) => a.score - b.score);

    return ranked[0] || null;
  }, [drivers, schedules, selectedBarangay, selectedDay]);

  const compatibleRoutes = useMemo(() => {
    const requestedPuroks = new Set(selectedPuroks);
    return routes.filter((route) => {
      const barangays = normalizeArray(route.barangays);
      const routePuroks = new Set(normalizeArray(route.puroks));
      const matchesBarangay = !selectedBarangay || barangays.some((barangay) => makeBarangayKey(barangay) === makeBarangayKey(selectedBarangay));
      const coversPuroks = requestedPuroks.size === 0 || Array.from(requestedPuroks).every((purok) => routePuroks.has(purok));
      const checkpointCount = Array.isArray(route.checkpoints)
        ? route.checkpoints.length
        : route.checkpoints && typeof route.checkpoints === "object"
          ? Object.keys(route.checkpoints).length
          : 0;
      return matchesBarangay && coversPuroks && checkpointCount >= 2;
    });
  }, [routes, selectedBarangay, selectedPuroks]);

  useEffect(() => {
    if (showForm && !form.assignedDriverId && bestDriver) {
      setForm((prev) => ({
        ...prev,
        assignedDriverId: bestDriver.id,
      }));
    }
  }, [bestDriver, form.assignedDriverId, showForm]);

  useEffect(() => {
    if (!form.routeId) return;
    const route = routes.find((item) => item.id === form.routeId);
    if (!route) return;
    const routeDriver = drivers.find((driver) => driver.id === route.assignedDriverId);
    setForm((current) => ({
      ...current,
      assignedDriverId: route.assignedDriverId || current.assignedDriverId,
      truckId: route.assignedVehicle || routeDriver?.truck || current.truckId,
    }));
  }, [form.routeId, routes, drivers]);

  const resetForm = () => {
    setSelectedBarangay("");
    setSelectedPurok("");
    setSelectedPuroks([]);
    setSelectedDay("");
    setForm(emptyForm);
  };

  const createScheduleNotification = async ({
    scheduleId,
    title,
    barangay,
    puroks,
    day,
    startTime,
    status,
    notes,
  }: {
    scheduleId: string;
    title: string;
    barangay: string;
    puroks: string[];
    day: string;
    startTime: string;
    status: "created" | "cancelled";
    notes?: string;
  }) => {
    const barangayKey = makeBarangayKey(barangay);
    const timestamp = Date.now();
    const isAllPurok = puroks.length === PUROKS.length;
    const purokLabel = isAllPurok ? ALL_PUROKS_LABEL : puroks.join(", ");

    const notificationTitle =
      status === "created"
        ? "New weekly garbage collection schedule"
        : "Garbage collection schedule cancelled";

    const message =
      status === "created"
        ? `Garbage collection for ${barangay}, ${purokLabel}, is set every week on ${day} at ${formatTime(
            startTime
          )}.`
        : `The garbage collection schedule for ${barangay}, ${purokLabel}, has been cancelled.`;

    const notificationData = {
      type: "schedule",
      status,
      title: notificationTitle,
      message,
      notes: notes || "",
      adminNotes: notes || "",
      scheduleId,
      scheduleTitle: title,
      barangay,
      barangayKey,
      purok: purokLabel,
      puroks,
      assignedPuroks: puroks,
      purokKeys: puroks.map((purok) => makePurokKey(purok.replace(/purok\s*/i, ""))),
      purokKey: isAllPurok ? "all" : puroks.length === 1 ? makePurokKey(puroks[0].replace(/purok\s*/i, "")) : "multiple",
      purokNumber: isAllPurok ? "all" : puroks.map((purok) => Number(purok.replace(/\D/g, ""))),
      targetPurok: purokLabel,
      scheduleDay: day,
      scheduleDays: [day],
      startTime,
      scheduleType: "weekly",
      repeat: "weekly",
      isRecurring: true,
      targetType: isAllPurok ? "barangay_all_purok" : puroks.length > 1 ? "barangay_multiple_puroks" : "barangay_purok",
      targetMode: isAllPurok ? "all_purok" : puroks.length > 1 ? "multiple_puroks" : "specific_purok",
      notifyAllPurok: isAllPurok,
      seen: false,
      createdAt: timestamp,
      timestamp,
    };

    await Promise.all([
      set(push(ref(db, "notifications")), notificationData),
      ...puroks.map((purok) => set(
        push(ref(db, `notificationsByArea/${barangayKey}/${makePurokKey(purok.replace(/purok\s*/i, ""))}`)),
        { ...notificationData, purok, purokKey: makePurokKey(purok.replace(/purok\s*/i, "")) },
      )),
    ]);
  };

  const hasPotentialConflict = () => {
    return schedules.some((schedule) => {
      const sameBarangay = makeBarangayKey(schedule.barangay || "") === makeBarangayKey(selectedBarangay);
      const sameDay = normalizeArray(schedule.scheduleDays).includes(selectedDay) || schedule.scheduleDay === selectedDay;
      const sameTime = schedule.startTime === form.startTime;
      const existingPuroks = getSchedulePuroks(schedule);
      const sameTarget = selectedPuroks.some((purok) => existingPuroks.includes(purok));
      const active = String(schedule.status || "active").toLowerCase() === "active";

      return sameBarangay && sameDay && sameTime && sameTarget && active;
    });
  };

  const saveSchedule = async () => {
    setSuccessMessage("");

    if (!form.title.trim()) {
      alert("Please enter schedule title.");
      return;
    }

    if (!selectedBarangay) {
      alert("Please select barangay.");
      return;
    }

    if (selectedPuroks.length === 0) {
      alert("Please select at least one purok.");
      return;
    }

    if (!selectedDay) {
      alert("Please select weekly collection day.");
      return;
    }

    if (!form.startTime) {
      alert("Please select collection time.");
      return;
    }

    if (!form.routeId) {
      alert("Please select an assigned GPS route.");
      return;
    }

    const selectedRoute = routes.find((route) => route.id === form.routeId);
    if (!selectedRoute || !compatibleRoutes.some((route) => route.id === form.routeId)) {
      alert("The selected route does not cover every selected purok or has insufficient GPS checkpoints.");
      return;
    }

    if (hasPotentialConflict()) {
      const proceed = confirm(
        "A similar active weekly schedule already exists for this barangay, purok, day, and time. Continue anyway?"
      );

      if (!proceed) return;
    }

    const isAllPurok = selectedPuroks.length === PUROKS.length;
    const purokValue = isAllPurok ? ALL_PUROKS_LABEL : selectedPuroks.join(", ");
    const purokNumbers = selectedPuroks.map((purok) => Number(purok.replace(/\D/g, "")));
    const driver = drivers.find((d) => d.id === form.assignedDriverId);

    try {
      setIsSaving(true);

      const newScheduleRef = push(ref(db, "schedules"));
      const scheduleId = newScheduleRef.key;

      if (!scheduleId) {
        alert("Failed to create schedule ID.");
        return;
      }

      const timestamp = Date.now();

      const payload = {
        title: form.title.trim(),
        barangay: selectedBarangay,
        barangayKey: makeBarangayKey(selectedBarangay),
        purok: purokValue,
        assignedPuroks: selectedPuroks,
        puroks: purokNumbers,
        purokKeys: selectedPuroks.map((purok) => makePurokKey(purok.replace(/\D/g, ""))),
        purokKey: isAllPurok ? "all" : selectedPuroks.length === 1 ? makePurokKey(purokNumbers[0]) : "multiple",
        purokNumber: isAllPurok ? "all" : purokNumbers,
        targetPurok: purokValue,
        scheduleDay: selectedDay,
        scheduleDays: [selectedDay],
        startTime: form.startTime,
        truckId: form.truckId.trim() || selectedRoute.assignedVehicle || driver?.truck || "",
        assignedDriverId: driver?.id || "",
        driverId: driver?.id || "",
        driverName: driver?.name || "",
        routeId: selectedRoute.id,
        assignedRouteId: selectedRoute.id,
        routeName: selectedRoute.routeName || "",
        notes: form.notes.trim(),
        status: "active",
        scheduleType: "weekly",
        repeat: "weekly",
        recurrence: {
          frequency: "weekly",
          dayOfWeek: selectedDay,
          time: form.startTime,
        },
        isRecurring: true,
        targetType: isAllPurok ? "barangay_all_purok" : selectedPuroks.length > 1 ? "barangay_multiple_puroks" : "barangay_purok",
        targetMode: isAllPurok ? "all_purok" : selectedPuroks.length > 1 ? "multiple_puroks" : "specific_purok",
        notifyAllPurok: isAllPurok,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await set(newScheduleRef, payload);

      await createScheduleNotification({
        scheduleId,
        title: form.title.trim(),
        barangay: selectedBarangay,
        puroks: selectedPuroks,
        day: selectedDay,
        startTime: form.startTime,
        status: "created",
        notes: form.notes.trim(),
      });

      setSuccessMessage(
        `Weekly schedule saved successfully for ${selectedBarangay}, ${purokValue}, every ${selectedDay} at ${formatTime(form.startTime)}. Residents were notified.`
      );

      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error(error);
      alert("Failed to create schedule.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    const confirmDelete = confirm("Delete this schedule and notify affected residents?");
    if (!confirmDelete) return;

    const scheduleDay = normalizeArray(schedule.scheduleDays)[0] || schedule.scheduleDay || "-";

    try {
      await remove(ref(db, `schedules/${schedule.id}`));

      await createScheduleNotification({
        scheduleId: schedule.id,
        title: schedule.title || "Schedule",
        barangay: schedule.barangay || "",
        puroks: getSchedulePuroks(schedule),
        day: scheduleDay,
        startTime: schedule.startTime || "-",
        status: "cancelled",
        notes: schedule.notes || "",
      });

      setSuccessMessage("Schedule deleted and resident cancellation notification sent.");
    } catch (error) {
      console.error(error);
      alert("Failed to delete schedule.");
    }
  };

  const selectedDriver = drivers.find((driver) => driver.id === form.assignedDriverId);

  return (
    <DashboardShell
      title="Schedule Management"
      description="Create weekly collection schedules for multiple puroks and verified GPS routes."
      hidePageHeader
    >
      <div className="schedule-page">
        <section className="schedule-hero">
          <div>
            <span className="eyebrow">Collection Planning</span>
            <h1>Weekly Schedule Manager</h1>
            <p>
              Build recurring schedules, assign several puroks to one GPS route, and notify all affected residents.
            </p>
          </div>

          <button className="hero-action" onClick={() => setShowForm(true)}>
            + Create Weekly Schedule
          </button>
        </section>

        {successMessage && (
          <div className="success-banner">
            <strong>Success</strong>
            <span>{successMessage}</span>
            <button onClick={() => setSuccessMessage("")}>×</button>
          </div>
        )}

        <section className="schedule-stats">
          <div className="stat-card">
            <span>Total Schedules</span>
            <strong>{stats.total}</strong>
            <small>Saved in Firebase</small>
          </div>

          <div className="stat-card green">
            <span>Active Weekly</span>
            <strong>{stats.weekly}</strong>
            <small>Runs every week</small>
          </div>

          <div className="stat-card blue">
            <span>Completed Today</span>
            <strong>{stats.completedToday}</strong>
            <small>Sent to Analytics</small>
          </div>

          <div className="stat-card dark">
            <span>With Assigned Driver</span>
            <strong>{stats.withDrivers}</strong>
            <small>Ready for operations</small>
          </div>
        </section>

        <section className="planner-flow">
          <div className="flow-step">
            <span>1</span>
            <div>
              <strong>Choose area</strong>
              <small>Barangay + one or more puroks</small>
            </div>
          </div>

          <div className="flow-line" />

          <div className="flow-step">
            <span>2</span>
            <div>
              <strong>Set weekly time</strong>
              <small>Every week on selected day and time</small>
            </div>
          </div>

          <div className="flow-line" />

          <div className="flow-step">
            <span>3</span>
            <div>
              <strong>Notify residents</strong>
              <small>Notification is sent after saving</small>
            </div>
          </div>
        </section>

        <section className="toolbar-card">
          <div className="search-box">
            <span>⌕</span>
            <input
              placeholder="Search schedule, barangay, driver, truck..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select value={selectedBarangay} onChange={(e) => setSelectedBarangay(e.target.value)}>
            <option value="">All Barangays</option>
            {BARANGAYS.map((barangay) => (
              <option key={barangay} value={barangay}>
                {barangay}
              </option>
            ))}
          </select>

          <select value={selectedPurok} onChange={(e) => setSelectedPurok(e.target.value)}>
            <option value="">All Puroks + Specific</option>
            <option value={ALL_PUROKS_VALUE}>All Puroks only</option>
            {PUROKS.map((purok) => (
              <option key={purok} value={String(purok)}>
                Purok {purok}
              </option>
            ))}
          </select>

          <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
            <option value="">All Days</option>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>

          <button
            className="clear-btn"
            onClick={() => {
              setSearch("");
              setSelectedBarangay("");
              setSelectedPurok("");
              setSelectedDay("");
            }}
          >
            Clear
          </button>
        </section>

        <section className="schedule-table-card">
          <div className="table-header">
            <div>
              <h2>Schedules</h2>
              <p>{filteredSchedules.length} result(s) shown</p>
            </div>
          </div>

          <div className="table-scroll">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Target Area</th>
                  <th>Assigned Route</th>
                  <th>Weekly Run</th>
                  <th>Driver</th>
                  <th>Truck</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredSchedules.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state">
                        <strong>No schedules found</strong>
                        <span>Create a weekly schedule or change your filters.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSchedules.map((schedule) => {
                    const scheduleDays = normalizeArray(schedule.scheduleDays);
                    const day = scheduleDays.length > 0 ? scheduleDays.join(", ") : schedule.scheduleDay || "-";
                    return (
                      <tr key={schedule.id}>
                        <td>
                          <div className="schedule-title">
                            <strong>{schedule.title || "Untitled Schedule"}</strong>
                            <span>{schedule.notes || "Weekly collection schedule"}</span>
                          </div>
                        </td>

                        <td><div className="target-cell"><strong>{schedule.routeName || "No route"}</strong><span>{schedule.routeId || schedule.assignedRouteId ? "GPS verification enabled" : "Route required"}</span></div></td>

                        <td>
                          <div className="target-cell">
                            <strong>{schedule.barangay || "-"}</strong>
                            <span>{getSchedulePurokDisplay(schedule)}</span>
                          </div>
                        </td>

                        <td>
                          <div className="weekly-cell">
                            <span className="weekly-pill">Every {day}</span>
                            <small>{formatTime(schedule.startTime)}</small>
                          </div>
                        </td>

                        <td>{schedule.driverName || "No driver"}</td>
                        <td>{schedule.truckId || "-"}</td>
                        <td>
                          <span className={`status-pill ${String(schedule.status || "active").toLowerCase()}`}>
                            {schedule.status || "active"}
                          </span>
                        </td>
                        <td>{formatDate(schedule.updatedAt || schedule.createdAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button className="complete-btn" onClick={() => { window.location.href = `/analytics?schedule=${encodeURIComponent(schedule.id)}`; }}>
                              Track / Verify
                            </button>

                            <button className="danger-btn" onClick={() => deleteSchedule(schedule)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showForm && (
          <div className="modal-backdrop">
            <div className="schedule-modal">
              <div className="modal-header">
                <div>
                  <span className="eyebrow">New Weekly Schedule</span>
                  <h3>Create Garbage Collection Schedule</h3>
                  <p>Set a recurring weekly collection schedule and notify affected residents.</p>
                </div>

                <button
                  className="modal-close"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                >
                  ×
                </button>
              </div>

              <div className="modal-grid">
                <label>
                  Schedule Title
                  <input
                    placeholder="Example: Maulong Sunday Collection"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </label>

                <label>
                  Barangay
                  <select value={selectedBarangay} onChange={(e) => { setSelectedBarangay(e.target.value); setForm((current) => ({ ...current, routeId: "" })); }}>
                    <option value="">Select Barangay</option>
                    {BARANGAYS.map((barangay) => (
                      <option key={barangay} value={barangay}>
                        {barangay}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="multi-purok full">
                  <div className="multi-heading"><div><strong>Purok Coverage</strong><span>Select one or several puroks under this schedule.</span></div><button type="button" onClick={() => { setSelectedPuroks(selectedPuroks.length === PUROKS.length ? [] : PUROKS.map((value) => `Purok ${value}`)); setForm((current) => ({ ...current, routeId: "" })); }}>{selectedPuroks.length === PUROKS.length ? "Clear all" : "Select all"}</button></div>
                  <div className="purok-chips">
                    {PUROKS.map((purok) => {
                      const label = `Purok ${purok}`;
                      const selected = selectedPuroks.includes(label);
                      return <button key={purok} type="button" className={selected ? "selected" : ""} onClick={() => { setSelectedPuroks((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]); setForm((current) => ({ ...current, routeId: "" })); }}>{selected ? "✓ " : "+ "}{label}</button>;
                    })}
                  </div>
                </div>

                <label>
                  Weekly Collection Day
                  <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
                    <option value="">Select Day</option>
                    {DAYS.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Collection Time
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  />
                </label>

                <label>
                  Truck / Plate Number
                  <input
                    placeholder="Optional"
                    value={form.truckId}
                    onChange={(e) => setForm({ ...form, truckId: e.target.value })}
                  />
                </label>

                <label className="full">
                  Assigned GPS Route
                  <select value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })}>
                    <option value="">Select a route covering all selected puroks</option>
                    {compatibleRoutes.map((route) => <option key={route.id} value={route.id}>{route.routeName || "Unnamed Route"} • {normalizeArray(route.puroks).join(", ")}</option>)}
                  </select>
                  {selectedBarangay && selectedPuroks.length > 0 && compatibleRoutes.length === 0 && <span className="field-warning">No mapped route covers this exact area. Create it in Route Management first.</span>}
                </label>

                <label className="full">
                  Assigned Driver
                  <select
                    value={form.assignedDriverId}
                    onChange={(e) => setForm({ ...form, assignedDriverId: e.target.value })}
                  >
                    <option value="">No driver / Auto suggest</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name || "Driver"} {locations[driver.id] ? "• GPS active" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="full">
                  Notes
                  <textarea
                    placeholder="Optional notes for admin records and resident notification"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </label>
              </div>

              <div className="suggestion-card">
                <div>
                  <strong>GPS route verification</strong>
                  <span>
                    {form.routeId
                      ? `${selectedDriver?.name || "Assigned driver"} must pass the saved route checkpoints and every assigned purok before completion.`
                      : "Choose a mapped route to enable live progress and verified completion."}
                  </span>
                </div>
                <span className="weekly-pill">Weekly recurring</span>
              </div>

              <div className="modal-actions">
                <button
                  className="cancel-btn"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </button>

                <button className="save-btn" onClick={saveSchedule} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Weekly Schedule + Notify"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .schedule-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .schedule-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 24px;
          border-radius: 28px;
          background: linear-gradient(135deg, #064e3b, #059669);
          color: #ffffff;
          box-shadow: 0 24px 60px rgba(5, 150, 105, 0.18);
        }

        .eyebrow {
          display: inline-flex;
          color: #bbf7d0;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .schedule-hero h1 {
          margin: 8px 0 0;
          font-size: 30px;
          letter-spacing: -0.04em;
        }

        .schedule-hero p {
          max-width: 680px;
          margin: 8px 0 0;
          color: #d1fae5;
          font-size: 14px;
          line-height: 1.55;
        }

        .hero-action,
        .save-btn {
          border: 0;
          border-radius: 16px;
          background: #22c55e;
          color: #ffffff;
          height: 46px;
          padding: 0 18px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 16px 30px rgba(34, 197, 94, 0.26);
          white-space: nowrap;
        }

        .hero-action:hover,
        .save-btn:hover:not(:disabled) {
          background: #16a34a;
        }

        .success-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
          border-radius: 18px;
          padding: 14px 16px;
        }

        .success-banner strong {
          font-size: 14px;
        }

        .success-banner span {
          flex: 1;
          font-size: 13px;
        }

        .success-banner button {
          width: 28px;
          height: 28px;
          border: 0;
          border-radius: 50%;
          background: #dcfce7;
          color: #166534;
          cursor: pointer;
          font-size: 18px;
        }

        .schedule-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .stat-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .stat-card.green {
          background: linear-gradient(135deg, #ecfdf5, #ffffff);
        }

        .stat-card.blue {
          background: linear-gradient(135deg, #eff6ff, #ffffff);
        }

        .stat-card.dark {
          background: linear-gradient(135deg, #0f172a, #064e3b);
          color: #ffffff;
        }

        .stat-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 8px;
        }

        .stat-card.dark span,
        .stat-card.dark small {
          color: #d1fae5;
        }

        .stat-card strong {
          display: block;
          color: inherit;
          font-size: 34px;
          line-height: 1;
        }

        .stat-card small {
          display: block;
          margin-top: 8px;
          color: #64748b;
          font-size: 12px;
        }

        .planner-flow {
          display: grid;
          grid-template-columns: 1fr 48px 1fr 48px 1fr;
          align-items: center;
          padding: 16px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .flow-step {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .flow-step > span {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #ecfdf5;
          color: #047857;
          display: grid;
          place-items: center;
          font-weight: 900;
        }

        .flow-step strong {
          display: block;
          color: #0f172a;
          font-size: 14px;
        }

        .flow-step small {
          color: #64748b;
          font-size: 12px;
        }

        .flow-line {
          height: 1px;
          background: #dbeafe;
        }

        .toolbar-card {
          display: grid;
          grid-template-columns: minmax(280px, 1.6fr) repeat(3, minmax(150px, 1fr)) auto;
          gap: 10px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          padding: 14px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 44px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 0 12px;
        }

        .search-box span {
          color: #64748b;
          font-size: 18px;
        }

        .search-box input,
        .toolbar-card select,
        .modal-grid input,
        .modal-grid select,
        .modal-grid textarea {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f8fafc;
          color: #0f172a;
          outline: none;
          font-size: 14px;
        }

        .search-box input {
          border: 0;
          background: transparent;
        }

        .toolbar-card select,
        .clear-btn {
          height: 44px;
          padding: 0 12px;
        }

        .clear-btn,
        .cancel-btn,
        .complete-btn,
        .danger-btn {
          border: 0;
          border-radius: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .clear-btn,
        .cancel-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .schedule-table-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .table-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid #e5e7eb;
        }

        .table-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
        }

        .table-header p {
          margin: 3px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .table-scroll {
          overflow-x: auto;
        }

        .schedule-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }

        .schedule-table thead {
          background: #f8fafc;
        }

        .schedule-table th {
          text-align: left;
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .schedule-table th.right {
          text-align: right;
        }

        .schedule-table td {
          padding: 16px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          vertical-align: middle;
        }

        .schedule-table tr:last-child td {
          border-bottom: 0;
        }

        .schedule-title strong,
        .target-cell strong {
          display: block;
          color: #0f172a;
          font-weight: 900;
        }

        .schedule-title span,
        .target-cell span,
        .weekly-cell small {
          display: block;
          margin-top: 4px;
          color: #64748b;
          font-size: 12px;
        }

        .weekly-pill,
        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .weekly-pill {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .status-pill.active,
        .status-pill.completed {
          background: #dcfce7;
          color: #166534;
        }

        .status-pill.cancelled,
        .status-pill.inactive {
          background: #fee2e2;
          color: #991b1b;
        }

        .row-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .complete-btn {
          height: 36px;
          padding: 0 12px;
          background: #dcfce7;
          color: #166534;
        }

        .complete-btn:hover:not(:disabled) {
          background: #bbf7d0;
        }

        .complete-btn:disabled {
          background: #f1f5f9;
          color: #64748b;
          cursor: not-allowed;
        }

        .danger-btn {
          height: 36px;
          padding: 0 12px;
          background: #fee2e2;
          color: #b91c1c;
        }

        .danger-btn:hover {
          background: #fecaca;
        }

        .empty-state {
          padding: 44px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          color: #64748b;
        }

        .empty-state strong {
          color: #0f172a;
          font-size: 16px;
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(6px);
          padding: 20px;
        }

        .schedule-modal {
          width: min(760px, 100%);
          max-height: calc(100dvh - 40px);
          overflow-y: auto;
          background: #ffffff;
          border-radius: 28px;
          padding: 24px;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.35);
        }

        .modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .modal-header h3 {
          margin: 6px 0 0;
          color: #0f172a;
          font-size: 24px;
          letter-spacing: -0.035em;
        }

        .modal-header p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .modal-close {
          width: 36px;
          height: 36px;
          border: 0;
          border-radius: 50%;
          background: #f1f5f9;
          color: #334155;
          font-size: 24px;
          cursor: pointer;
        }

        .modal-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .modal-grid label {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: #334155;
          font-size: 13px;
          font-weight: 900;
        }

        .modal-grid label.full {
          grid-column: 1 / -1;
        }

        .multi-purok.full {
          grid-column: 1 / -1;
          padding: 14px;
          border: 1px solid #dbe4df;
          border-radius: 17px;
          background: #f8faf9;
        }

        .multi-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .multi-heading strong,
        .multi-heading span {
          display: block;
        }

        .multi-heading strong { color: #334155; font-size: 13px; }
        .multi-heading span { margin-top: 3px; color: #64748b; font-size: 12px; }
        .multi-heading button { border: 0; border-radius: 10px; background: #dcfce7; color: #166534; padding: 8px 10px; font-weight: 900; cursor: pointer; }

        .purok-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }

        .purok-chips button {
          border: 1px solid #dbe4df;
          border-radius: 999px;
          background: #ffffff;
          color: #475569;
          padding: 8px 11px;
          font-size: 12px;
          font-weight: 850;
          cursor: pointer;
        }

        .purok-chips button.selected {
          border-color: #10b981;
          background: #dcfce7;
          color: #166534;
        }

        .field-warning {
          color: #b45309;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.4;
        }

        .modal-grid input,
        .modal-grid select {
          height: 46px;
          padding: 0 12px;
        }

        .modal-grid textarea {
          min-height: 92px;
          resize: vertical;
          padding: 12px;
        }

        .modal-grid input:focus,
        .modal-grid select:focus,
        .modal-grid textarea:focus {
          border-color: #10b981;
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .suggestion-card {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          border: 1px solid #dcfce7;
          background: #f0fdf4;
          border-radius: 18px;
          padding: 14px;
        }

        .suggestion-card strong {
          display: block;
          color: #166534;
          font-size: 13px;
        }

        .suggestion-card span {
          display: inline-flex;
          margin-top: 4px;
          color: #166534;
          font-size: 12px;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }

        .cancel-btn,
        .save-btn {
          height: 44px;
          padding: 0 16px;
        }

        .save-btn:disabled,
        .cancel-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        @media (max-width: 1180px) {
          .schedule-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .toolbar-card {
            grid-template-columns: 1fr 1fr;
          }

          .search-box {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 760px) {
          .schedule-hero {
            flex-direction: column;
            align-items: flex-start;
          }

          .hero-action {
            width: 100%;
          }

          .planner-flow {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .flow-line {
            display: none;
          }

          .schedule-stats,
          .toolbar-card,
          .modal-grid {
            grid-template-columns: 1fr;
          }

          .modal-actions {
            flex-direction: column;
          }

          .cancel-btn,
          .save-btn {
            width: 100%;
          }
        }
      `}</style>
    </DashboardShell>
  );
}
