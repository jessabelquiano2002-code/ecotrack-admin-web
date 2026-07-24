"use client";

import { onValue, push, ref, remove, set } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = [
  "Mercedes",
  "Canlapwas",
  "Maulong",
  "San Andres",
  "Poblacion 13",
];

const PUROKS = Array.from(
  { length: 10 },
  (_, index) => `Purok ${index + 1}`,
);

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
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicle?: string;
  routeType?: string;
  trackingMode?: string;
  status?: string;
};

type Schedule = {
  id: string;
  title?: string;
  barangay?: string;
  barangayKey?: string;
  assignedPuroks?: string[] | Record<string, string | boolean>;
  puroks?: Array<string | number> | Record<string, string | number | boolean>;
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
};

type ScheduleForm = {
  title: string;
  startTime: string;
  truckId: string;
  assignedDriverId: string;
  notes: string;
  routeId: string;
};

const EMPTY_FORM: ScheduleForm = {
  title: "",
  startTime: "",
  truckId: "",
  assignedDriverId: "",
  notes: "",
  routeId: "",
};

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
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
  return String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function makePurokKey(value: unknown): string {
  const normalized = normalizePurokLabel(value);
  const number = normalized.match(/\d+/)?.[0];
  return number ? `purok_${Number(number)}` : "";
}

function getRouteBarangay(route: RouteRecord): string {
  return route.barangay || normalizeArray(route.barangays)[0] || "";
}

function getRoutePuroks(route: RouteRecord): string[] {
  return normalizeArray(route.puroks)
    .map(normalizePurokLabel)
    .filter(Boolean);
}

function routeCoversSelection(
  route: RouteRecord,
  barangay: string,
  selectedPuroks: string[],
): boolean {
  const matchesBarangay =
    makeBarangayKey(getRouteBarangay(route)) === makeBarangayKey(barangay);

  const coveredPuroks = new Set(getRoutePuroks(route));
  const coversAllSelectedPuroks = selectedPuroks.every((purok) =>
    coveredPuroks.has(normalizePurokLabel(purok)),
  );

  const routeStatus = String(route.status || "ready").toLowerCase();
  const routeIsAvailable = !["disabled", "inactive", "archived"].includes(
    routeStatus,
  );

  return (
    matchesBarangay &&
    coversAllSelectedPuroks &&
    routeIsAvailable &&
    Boolean(route.assignedDriverId)
  );
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

function formatDayList(days: string[]): string {
  const orderedDays = DAYS.filter((day) => days.includes(day));

  if (orderedDays.length === 0) return "—";
  if (orderedDays.length === 1) return orderedDays[0];
  if (orderedDays.length === 2) return `${orderedDays[0]} and ${orderedDays[1]}`;

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

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");

  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);

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

    return () => {
      unsubscribeSchedules();
      unsubscribeDrivers();
      unsubscribeRoutes();
    };
  }, []);

  const compatibleRoutes = useMemo(() => {
    if (!selectedBarangay || selectedPuroks.length === 0) return [];

    return routes.filter((route) =>
      routeCoversSelection(route, selectedBarangay, selectedPuroks),
    );
  }, [routes, selectedBarangay, selectedPuroks]);

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
        schedule.barangay,
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
    setSelectedBarangay("");
    setSelectedPuroks([]);
    setSelectedDays([]);
    setForm(EMPTY_FORM);
    setIsSaving(false);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const togglePurok = (purok: string) => {
    setSelectedPuroks((current) =>
      current.includes(purok)
        ? current.filter((item) => item !== purok)
        : [...current, purok],
    );

    setForm((current) => ({
      ...current,
      routeId: "",
      assignedDriverId: "",
      truckId: "",
    }));
  };

  const selectAllPuroks = () => {
    setSelectedPuroks((current) =>
      current.length === PUROKS.length ? [] : [...PUROKS],
    );
    setForm((current) => ({
      ...current,
      routeId: "",
      assignedDriverId: "",
      truckId: "",
    }));
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
    const driver = drivers.find(
      (item) => item.id === route?.assignedDriverId,
    );

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
    barangay,
    puroks,
    days,
    startTime,
    status,
    notes,
  }: {
    scheduleId: string;
    title: string;
    barangay: string;
    puroks: string[];
    days: string[];
    startTime: string;
    status: "created" | "cancelled";
    notes?: string;
  }) => {
    const barangayKey = makeBarangayKey(barangay);
    const timestamp = Date.now();
    const allPuroks = puroks.length === PUROKS.length;
    const purokLabel = allPuroks ? ALL_PUROKS_LABEL : puroks.join(", ");
    const orderedDays = DAYS.filter((day) => days.includes(day));
    const dayLabel = formatDayList(orderedDays);

    const notificationTitle =
      status === "created"
        ? "New weekly garbage collection schedule"
        : "Garbage collection schedule cancelled";

    const message =
      status === "created"
        ? `Garbage collection for ${barangay}, ${purokLabel}, is scheduled every ${dayLabel} at ${formatTime(startTime)}.`
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
      purokKeys: puroks.map(makePurokKey),
      scheduleDay: orderedDays[0] || "",
      scheduleDays: orderedDays,
      startTime,
      scheduleType: "weekly",
      repeat: "weekly",
      isRecurring: true,
      targetType: allPuroks
        ? "barangay_all_purok"
        : puroks.length > 1
          ? "barangay_multiple_puroks"
          : "barangay_purok",
      notifyAllPurok: allPuroks,
      seen: false,
      createdAt: timestamp,
      timestamp,
    };

    const writes = [set(push(ref(db, "notifications")), notificationData)];

    for (const purok of puroks) {
      const purokKey = makePurokKey(purok);
      writes.push(
        set(
          push(ref(db, `notificationsByArea/${barangayKey}/${purokKey}`)),
          {
            ...notificationData,
            purok,
            purokKey,
          },
        ),
      );
    }

    await Promise.all(writes);
  };

  const hasPotentialConflict = (): boolean =>
    schedules.some((schedule) => {
      const sameBarangay =
        makeBarangayKey(schedule.barangay || "") ===
        makeBarangayKey(selectedBarangay);
      const existingDays = getScheduleDays(schedule);
      const sameDay = selectedDays.some((day) => existingDays.includes(day));
      const sameTime = schedule.startTime === form.startTime;
      const existingPuroks = getSchedulePuroks(schedule);
      const overlaps = selectedPuroks.some((purok) =>
        existingPuroks.includes(purok),
      );
      const active =
        String(schedule.status || "active").toLowerCase() === "active";

      return sameBarangay && sameDay && sameTime && overlaps && active;
    });

  const saveSchedule = async () => {
    setSuccessMessage("");

    if (!form.title.trim()) return alert("Enter a schedule title.");
    if (!selectedBarangay) return alert("Select a Barangay.");
    if (selectedPuroks.length === 0) {
      return alert("Select at least one Purok.");
    }
    if (selectedDays.length === 0) return alert("Select at least one weekly collection day.");
    if (!form.startTime) return alert("Select a collection time.");
    if (!form.routeId) return alert("Select a route assignment.");

    const route = routes.find((item) => item.id === form.routeId);
    if (!route || !routeCoversSelection(route, selectedBarangay, selectedPuroks)) {
      return alert(
        "The selected route must match the Barangay, cover every selected Purok, and have an assigned driver.",
      );
    }

    const driverId = form.assignedDriverId || route.assignedDriverId || "";
    const driver = drivers.find((item) => item.id === driverId);
    if (!driver) return alert("The selected route has no valid assigned driver.");

    if (hasPotentialConflict()) {
      const proceed = window.confirm(
        "A similar active schedule already exists for the same Barangay, Purok, at least one selected day, and time. Continue anyway?",
      );
      if (!proceed) return;
    }

    const allPuroks = selectedPuroks.length === PUROKS.length;
    const purokNumbers = selectedPuroks.map((purok) =>
      Number(purok.replace(/\D/g, "")),
    );
    const purokLabel = allPuroks
      ? ALL_PUROKS_LABEL
      : selectedPuroks.join(", ");

    try {
      setIsSaving(true);

      const scheduleReference = push(ref(db, "schedules"));
      const scheduleId = scheduleReference.key;
      if (!scheduleId) throw new Error("Unable to create schedule ID.");

      const timestamp = Date.now();
      const truck = form.truckId.trim() || route.assignedVehicle || driver.truck || "";

      const payload = {
        title: form.title.trim(),
        barangay: selectedBarangay,
        barangayKey: makeBarangayKey(selectedBarangay),
        purok: purokLabel,
        assignedPuroks: selectedPuroks,
        puroks: purokNumbers,
        purokKeys: selectedPuroks.map(makePurokKey),
        purokKey: allPuroks
          ? "all"
          : selectedPuroks.length === 1
            ? makePurokKey(selectedPuroks[0])
            : "multiple",
        targetPurok: purokLabel,
        scheduleDay: selectedDays[0],
        scheduleDays: selectedDays,
        startTime: form.startTime,
        truckId: truck,
        assignedDriverId: driver.id,
        driverId: driver.id,
        driverName: driver.name || "",
        routeId: route.id,
        assignedRouteId: route.id,
        routeName: route.routeName || "",
        routeType: "service-area",
        trackingMode: "barangay-purok",
        notes: form.notes.trim(),
        status: "active",
        scheduleType: "weekly",
        repeat: "weekly",
        recurrence: {
          frequency: "weekly",
          dayOfWeek: selectedDays[0],
          daysOfWeek: selectedDays,
          time: form.startTime,
        },
        isRecurring: true,
        targetType: allPuroks
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
        barangay: selectedBarangay,
        puroks: selectedPuroks,
        days: selectedDays,
        startTime: form.startTime,
        status: "created",
        notes: form.notes.trim(),
      });

      setSuccessMessage(
        `Weekly schedule saved for ${selectedBarangay}, ${purokLabel}, every ${formatDayList(selectedDays)} at ${formatTime(form.startTime)}.`,
      );
      closeForm();
    } catch (error) {
      console.error("Unable to save schedule", error);
      alert("Unable to create the schedule.");
      setIsSaving(false);
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    if (!window.confirm("Delete this schedule and notify affected residents?")) {
      return;
    }

    try {
      await remove(ref(db, `schedules/${schedule.id}`));

      await createScheduleNotification({
        scheduleId: schedule.id,
        title: schedule.title || "Schedule",
        barangay: schedule.barangay || "",
        puroks: getSchedulePuroks(schedule),
        days: getScheduleDays(schedule),
        startTime: schedule.startTime || "—",
        status: "cancelled",
        notes: schedule.notes || "",
      });

      setSuccessMessage("Schedule deleted and cancellation notification sent.");
    } catch (error) {
      console.error("Unable to delete schedule", error);
      alert("Unable to delete the schedule.");
    }
  };

  return (
    <DashboardShell
      title="Schedule Management"
      description="Create weekly collection schedules using Barangay and Purok route assignments. No map or drawn route is required."
    >
      <div className="schedule-page">
        <section className="hero">
          <div>
            <span>COLLECTION PLANNING</span>
            <h1>Weekly Schedule Manager</h1>
            <p>
              Choose the service area route, collection day, time, and assigned
              driver. Residents in the selected Puroks receive the schedule notice.
            </p>
          </div>
          <button type="button" onClick={() => setShowForm(true)}>
            + Create Schedule
          </button>
        </section>

        {successMessage ? (
          <div className="success-banner">
            <span>{successMessage}</span>
            <button type="button" onClick={() => setSuccessMessage("")}>
              ×
            </button>
          </div>
        ) : null}

        <section className="metrics">
          <Metric label="Total schedules" value={schedules.length} />
          <Metric
            label="Active"
            value={
              schedules.filter(
                (schedule) =>
                  String(schedule.status || "active").toLowerCase() === "active",
              ).length
            }
          />
          <Metric label="Routes available" value={routes.length} />
          <Metric label="Drivers" value={drivers.length} />
        </section>

        <section className="schedule-card">
          <div className="toolbar">
            <div>
              <h2>Weekly schedules</h2>
              <p>Schedules are matched using Barangay and Purok coverage.</p>
            </div>
            <input
              type="search"
              placeholder="Search schedules…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
                  <th aria-label="Actions" />
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
                  filteredSchedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td>
                        <strong>{schedule.title || "Untitled schedule"}</strong>
                        <small>{schedule.id}</small>
                      </td>
                      <td>
                        <strong>{schedule.barangay || "—"}</strong>
                        <small>{getSchedulePuroks(schedule).join(", ") || "—"}</small>
                      </td>
                      <td>
                        <strong>
                          {formatDayList(getScheduleDays(schedule))}
                        </strong>
                        <small>{formatTime(schedule.startTime)}</small>
                      </td>
                      <td>{schedule.routeName || "—"}</td>
                      <td>
                        <strong>{schedule.driverName || "—"}</strong>
                        <small>{schedule.truckId || "No truck"}</small>
                      </td>
                      <td>
                        <span className="status-pill">
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
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                  <h2 id="schedule-form-title">Create garbage collection schedule</h2>
                  <p>Select one or more recurring collection days for the same service area.</p>
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

                  <label>
                    <span>Barangay</span>
                    <select
                      value={selectedBarangay}
                      onChange={(event) => {
                        setSelectedBarangay(event.target.value);
                        setSelectedPuroks([]);
                        setForm((current) => ({
                          ...current,
                          routeId: "",
                          assignedDriverId: "",
                          truckId: "",
                        }));
                      }}
                    >
                      <option value="">Select Barangay</option>
                      {BARANGAYS.map((barangay) => (
                        <option key={barangay} value={barangay}>
                          {barangay}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="purok-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Purok coverage</h3>
                      <p>Select the Puroks included in this schedule.</p>
                    </div>
                    <button type="button" onClick={selectAllPuroks}>
                      {selectedPuroks.length === PUROKS.length
                        ? "Clear all"
                        : "Select all"}
                    </button>
                  </div>

                  <div className="purok-grid">
                    {PUROKS.map((purok) => {
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
                          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].every(
                            (day) => selectedDays.includes(day),
                          )
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

                    <div className="day-grid" role="group" aria-label="Weekly collection days">
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

                  <label className="time-field">
                    <span>Collection time</span>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                    <small>The same time applies to all selected days.</small>
                  </label>
                </div>

                <label>
                  <span>Assigned route</span>
                  <select
                    value={form.routeId}
                    onChange={(event) => selectRoute(event.target.value)}
                    disabled={!selectedBarangay || selectedPuroks.length === 0}
                  >
                    <option value="">
                      {!selectedBarangay
                        ? "Select Barangay first"
                        : selectedPuroks.length === 0
                          ? "Select at least one Purok first"
                          : compatibleRoutes.length === 0
                            ? "No compatible route available"
                            : "Select route assignment"}
                    </option>
                    {compatibleRoutes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.routeName || "Unnamed route"} — {getRoutePuroks(route).join(", ")}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedBarangay && selectedPuroks.length > 0 && compatibleRoutes.length === 0 ? (
                  <div className="warning-card">
                    No saved route matches this Barangay and every selected Purok.
                    Create or update the route assignment first.
                  </div>
                ) : null}

                <div className="form-grid">
                  <label>
                    <span>Assigned driver</span>
                    <input
                      value={
                        drivers.find((driver) => driver.id === form.assignedDriverId)
                          ?.name || selectedRoute?.assignedDriverName || ""
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
                    The selected route confirms the Barangay, covered Puroks,
                    driver, and truck. This schedule repeats on every selected day
                    at the same collection time.
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
            display: grid;
            gap: 18px;
          }

          .hero {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding: 28px;
            border-radius: 22px;
            color: #fff;
            background: linear-gradient(135deg, #064e3b, #047857);
            box-shadow: 0 20px 50px rgba(6, 78, 59, 0.18);
          }

          .hero span,
          .modal header span {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.12em;
          }

          .hero h1 {
            margin: 8px 0;
            font-size: 30px;
          }

          .hero p {
            max-width: 720px;
            margin: 0;
            color: rgba(255, 255, 255, 0.82);
            line-height: 1.6;
          }

          .hero > button,
          .primary {
            align-self: center;
            border: 0;
            border-radius: 12px;
            padding: 13px 18px;
            background: #22c55e;
            color: #052e16;
            font-weight: 800;
            cursor: pointer;
          }

          .success-banner {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 16px;
            border: 1px solid #86efac;
            border-radius: 14px;
            background: #f0fdf4;
            color: #166534;
          }

          .success-banner button {
            border: 0;
            background: transparent;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
          }

          .metrics {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }

          .schedule-card {
            overflow: hidden;
            border: 1px solid #dfe7e2;
            border-radius: 18px;
            background: #fff;
          }

          .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 18px;
            border-bottom: 1px solid #e5ebe7;
          }

          .toolbar h2,
          .toolbar p {
            margin: 0;
          }

          .toolbar p {
            margin-top: 4px;
            color: #6b7b72;
            font-size: 13px;
          }

          .toolbar input {
            width: min(320px, 100%);
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
            padding: 14px 16px;
            border-bottom: 1px solid #edf1ee;
            text-align: left;
            vertical-align: top;
            font-size: 13px;
          }

          th {
            color: #6b7b72;
            background: #f8faf9;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          td strong,
          td small {
            display: block;
          }

          td small {
            margin-top: 4px;
            color: #7b8a82;
          }

          .status-pill {
            display: inline-flex;
            border-radius: 999px;
            padding: 5px 8px;
            background: #ecfdf5;
            color: #047857;
            font-size: 11px;
            font-weight: 700;
          }

          .delete-btn {
            border: 1px solid #fecaca;
            border-radius: 9px;
            padding: 8px 10px;
            background: #fff;
            color: #b91c1c;
            font-weight: 700;
            cursor: pointer;
          }

          .empty-state {
            padding: 48px;
            text-align: center;
            color: #77867e;
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
            width: min(760px, 100%);
            max-height: calc(100dvh - 48px);
            overflow: auto;
            border-radius: 20px;
            background: #fff;
            box-shadow: 0 28px 90px rgba(15, 23, 42, 0.28);
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

          .modal header h2,
          .modal header p {
            margin: 0;
          }

          .modal header h2 {
            margin-top: 5px;
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

          .day-time-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.55fr) minmax(220px, 0.45fr);
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

          .time-field {
            align-content: start;
            border: 1px solid #dce6e0;
            border-radius: 15px;
            padding: 16px;
            background: #fbfdfc;
          }

          .time-field small {
            color: #718078;
            font-size: 11px;
            line-height: 1.5;
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

          @media (max-width: 1000px) {
            .metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
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
            .hero,
            .toolbar,
            .panel-heading {
              flex-direction: column;
              align-items: stretch;
            }

            .form-grid {
              grid-template-columns: 1fr;
            }

            .purok-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
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
          }
        `}</style>
      </div>
    </DashboardShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <style jsx>{`
        .metric {
          display: grid;
          gap: 5px;
          padding: 17px;
          border: 1px solid #dfe7e2;
          border-radius: 15px;
          background: #fff;
        }

        span {
          color: #728078;
          font-size: 12px;
        }

        strong {
          color: #153026;
          font-size: 24px;
        }
      `}</style>
    </article>
  );
}
