"use client";

import { onValue, push, ref, update } from "firebase/database";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = [
  "Mercedes",
  "Canlapwas",
  "Maulong",
  "San Andres",
  "Poblacion 13",
];

type BarangayMapLocation = {
  center: [number, number];
  zoom: number;
};

// Approximate barangay center points used only to focus the preview map.
// The map is not used to draw or validate a collection route.
const BARANGAY_MAP_LOCATIONS: Record<string, BarangayMapLocation> = {
  Mercedes: { center: [124.8768, 11.7836], zoom: 15 },
  Canlapwas: { center: [124.8874, 11.7818], zoom: 15 },
  Maulong: { center: [124.8661, 11.7908], zoom: 15 },
  "San Andres": { center: [124.8972, 11.7874], zoom: 15 },
  "Poblacion 13": { center: [124.8861, 11.7783], zoom: 16 },
};

const CATBALOGAN_MAP_LOCATION: BarangayMapLocation = {
  center: [124.8829, 11.7753],
  zoom: 12.5,
};

const PUROKS = Array.from({ length: 10 }, (_, index) => `Purok ${index + 1}`);

type Driver = {
  id: string;
  name?: string;
  truck?: string;
  status?: string;
  assignedRouteId?: string;
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
  createdAt?: number;
  updatedAt?: number;
};

type ScheduleRecord = {
  id: string;
  routeId?: string;
  assignedRouteId?: string;
  status?: string;
};

type RouteForm = {
  routeName: string;
  barangay: string;
  assignedDriverId: string;
  assignedVehicle: string;
};

const EMPTY_FORM: RouteForm = {
  routeName: "",
  barangay: "",
  assignedDriverId: "",
  assignedVehicle: "",
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

function makeBarangayKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function getRouteBarangay(route: RouteRecord): string {
  return route.barangay || normalizeArray(route.barangays)[0] || "";
}

function getRoutePuroks(route: RouteRecord): string[] {
  return normalizeArray(route.puroks);
}

function formatDate(value?: number): string {
  if (!value) return "—";

  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.7 4a6.7 6.7 0 1 0 0 13.4A6.7 6.7 0 0 0 10.7 4Zm0 2a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm5.8 9.1 4.5 4.5-1.4 1.4-4.5-4.5 1.4-1.4Z" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm10 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.6 13.3l5-3.1a1 1 0 0 1 1.3.24l1.8 2.31-1.58 1.23-1.26-1.62-4.25 2.64L8.6 13.3Z" />
    </svg>
  );
}

function ReadyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.1 14.2-4-4 1.4-1.4 2.6 2.6 4.9-5 1.4 1.4Z" />
    </svg>
  );
}

function DriverIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.5 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2 19c0-3.1 3.1-5 6-5s6 1.9 6 5v1H2v-1Zm12.5 1v-1c0-1.1-.3-2.1-.9-3 2.3.3 5.4 1.6 5.4 4v0h-4.5Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h2v3H7V2Zm8 0h2v3h-2V2ZM4 5h16a1 1 0 0 1 1 1v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Zm0 5v10h16V10H4Zm3 3h3v3H7v-3Z" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5h11v10H3V5Zm12 4h3.8l3.2 3.4V15h-2a3 3 0 0 0-6 0h-1V9h2Zm-8 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM15 11v2h4.2l-1.7-2H15Z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 16.9 10.3-10.3 2.8 2.8L6.8 19.7 4 20l.3-3.1ZM15 5.9l1.6-1.6a1.8 1.8 0 0 1 2.5 0l.6.6a1.8 1.8 0 0 1 0 2.5L18 9l-3-3.1Z" />
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

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [form, setForm] = useState<RouteForm>(EMPTY_FORM);
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const unsubscribeRoutes = onValue(ref(db, "routes"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value)
        .map(([id, raw]) => ({
          id,
          ...(raw as Omit<RouteRecord, "id">),
        }))
        .sort(
          (left, right) =>
            Number(right.updatedAt || right.createdAt || 0) -
            Number(left.updatedAt || left.createdAt || 0),
        );
      setRoutes(list);
    });

    const unsubscribeDrivers = onValue(ref(db, "drivers"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value).map(([id, raw]) => ({
        id,
        ...(raw as Omit<Driver, "id">),
      }));
      setDrivers(list);
    });

    const unsubscribeSchedules = onValue(ref(db, "schedules"), (snapshot) => {
      const value = snapshot.val() || {};
      const list = Object.entries(value).map(([id, raw]) => ({
        id,
        ...(raw as Omit<ScheduleRecord, "id">),
      }));
      setSchedules(list);
    });

    return () => {
      unsubscribeRoutes();
      unsubscribeDrivers();
      unsubscribeSchedules();
    };
  }, []);

  useEffect(() => {
    if (!editorOpen || !mapContainerRef.current || mapRef.current) return;

    let disposed = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: "https://tiles.openfreemap.org/styles/bright",
        center: CATBALOGAN_MAP_LOCATION.center,
        zoom: CATBALOGAN_MAP_LOCATION.zoom,
        attributionControl: { compact: true },
      });

      map.addControl(
        new maplibregl.NavigationControl({
          showCompass: false,
          showZoom: true,
        }),
        "top-left",
      );

      map.addControl(
        new maplibregl.ScaleControl({
          maxWidth: 120,
          unit: "metric",
        }),
        "bottom-right",
      );

      map.on("load", () => {
        if (disposed) return;
        map.resize();
        setMapReady(true);
      });

      mapRef.current = map;
    });

    return () => {
      disposed = true;
      setMapReady(false);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [editorOpen]);

  useEffect(() => {
    if (!editorOpen || !mapReady || !mapRef.current) return;

    markerRef.current?.remove();
    markerRef.current = null;

    const selectedLocation = form.barangay
      ? BARANGAY_MAP_LOCATIONS[form.barangay]
      : CATBALOGAN_MAP_LOCATION;

    if (!selectedLocation) return;

    mapRef.current.flyTo({
      center: selectedLocation.center,
      zoom: selectedLocation.zoom,
      speed: 1.2,
      curve: 1.35,
      essential: true,
    });

    if (!form.barangay) return;

    void import("maplibre-gl").then((maplibregl) => {
      if (!mapRef.current || !form.barangay) return;

      markerRef.current = new maplibregl.Marker({
        color: "#1b9d58",
        scale: 0.92,
      })
        .setLngLat(selectedLocation.center)
        .setPopup(
          new maplibregl.Popup({ offset: 20 }).setText(
            `${form.barangay}, Catbalogan City`,
          ),
        )
        .addTo(mapRef.current);
    });
  }, [editorOpen, form.barangay, mapReady]);

  const focusSelectedBarangay = () => {
    if (!mapRef.current) return;

    const location = form.barangay
      ? BARANGAY_MAP_LOCATIONS[form.barangay]
      : CATBALOGAN_MAP_LOCATION;

    if (!location) return;

    mapRef.current.flyTo({
      center: location.center,
      zoom: location.zoom,
      speed: 1.2,
      curve: 1.35,
      essential: true,
    });
  };

  const activeDrivers = useMemo(
    () =>
      drivers.filter((driver) => {
        const status = String(driver.status || "active").toLowerCase();
        return !["disabled", "inactive", "suspended"].includes(status);
      }),
    [drivers],
  );

  const filteredRoutes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return routes;

    return routes.filter((route) => {
      const text = [
        route.routeName,
        getRouteBarangay(route),
        getRoutePuroks(route).join(" "),
        route.assignedDriverName,
        route.assignedVehicle,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(query);
    });
  }, [routes, search]);

  const routesWithSchedules = useMemo(() => {
    const routeIds = new Set(
      schedules
        .filter(
          (schedule) =>
            String(schedule.status || "active").toLowerCase() !== "cancelled",
        )
        .map((schedule) => schedule.routeId || schedule.assignedRouteId)
        .filter(Boolean),
    );

    return routeIds.size;
  }, [schedules]);

  const resetEditor = () => {
    setEditingRouteId(null);
    setForm(EMPTY_FORM);
    setSelectedPuroks([]);
    setSaving(false);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    resetEditor();
  };

  const openCreateEditor = () => {
    setSuccessMessage("");
    resetEditor();
    setEditorOpen(true);
  };

  const openEditEditor = (route: RouteRecord) => {
    setSuccessMessage("");
    setEditingRouteId(route.id);
    setForm({
      routeName: route.routeName || "",
      barangay: getRouteBarangay(route),
      assignedDriverId: route.assignedDriverId || "",
      assignedVehicle: route.assignedVehicle || "",
    });
    setSelectedPuroks(getRoutePuroks(route));
    setEditorOpen(true);
  };

  const togglePurok = (purok: string) => {
    setSelectedPuroks((current) =>
      current.includes(purok)
        ? current.filter((item) => item !== purok)
        : [...current, purok],
    );
  };

  const selectAllPuroks = () => {
    setSelectedPuroks(
      selectedPuroks.length === PUROKS.length ? [] : [...PUROKS],
    );
  };

  const saveRoute = async () => {
    const routeName = form.routeName.trim();
    const assignedDriver = drivers.find(
      (driver) => driver.id === form.assignedDriverId,
    );

    if (!routeName) return alert("Enter a route name.");
    if (!form.barangay) return alert("Select a barangay.");
    if (selectedPuroks.length === 0) {
      return alert("Select at least one Purok.");
    }
    if (!assignedDriver) return alert("Assign a valid driver.");

    const existingRoute = editingRouteId
      ? routes.find((route) => route.id === editingRouteId)
      : undefined;

    const routeReference = editingRouteId
      ? ref(db, `routes/${editingRouteId}`)
      : push(ref(db, "routes"));

    const routeId = editingRouteId || routeReference.key;
    if (!routeId) return alert("Unable to generate a route ID.");

    const now = Date.now();
    const vehicle = form.assignedVehicle.trim() || assignedDriver.truck || "";

    const payload = {
      routeName,
      barangay: form.barangay,
      barangayKey: makeBarangayKey(form.barangay),
      barangays: [form.barangay],
      puroks: selectedPuroks,
      assignedDriverId: assignedDriver.id,
      assignedDriverName: assignedDriver.name || "Driver",
      assignedVehicle: vehicle,
      routeType: "service-area",
      trackingMode: "barangay-purok",
      requiresDrawnPath: false,
      status: "ready",
      createdAt: existingRoute?.createdAt || now,
      updatedAt: now,
    };

    const routeStatusKey = push(ref(db, "route_status_updates")).key;
    const rootUpdates: Record<string, unknown> = {
      [`routes/${routeId}`]: payload,
      [`drivers/${assignedDriver.id}/assignedRouteId`]: routeId,
      [`drivers/${assignedDriver.id}/assignedRouteName`]: routeName,
      [`drivers/${assignedDriver.id}/assignedVehicle`]: vehicle,
      [`barangay_assignments/${makeBarangayKey(form.barangay)}/${routeId}`]: {
        routeId,
        routeName,
        barangay: form.barangay,
        barangayKey: makeBarangayKey(form.barangay),
        puroks: selectedPuroks,
        driverId: assignedDriver.id,
        driverName: assignedDriver.name || "Driver",
        assignedVehicle: vehicle,
        routeType: "service-area",
        updatedAt: now,
      },
    };

    if (routeStatusKey) {
      rootUpdates[`route_status_updates/${routeStatusKey}`] = {
        routeId,
        routeName,
        driverId: assignedDriver.id,
        driverName: assignedDriver.name || "Driver",
        barangay: form.barangay,
        puroks: selectedPuroks,
        status: editingRouteId ? "updated" : "ready",
        routeType: "service-area",
        createdAt: now,
      };
    }

    if (
      existingRoute?.assignedDriverId &&
      existingRoute.assignedDriverId !== assignedDriver.id
    ) {
      rootUpdates[
        `drivers/${existingRoute.assignedDriverId}/assignedRouteId`
      ] = null;
      rootUpdates[
        `drivers/${existingRoute.assignedDriverId}/assignedRouteName`
      ] = null;
    }

    const previousBarangay = existingRoute ? getRouteBarangay(existingRoute) : "";

    if (
      previousBarangay &&
      makeBarangayKey(previousBarangay) !== makeBarangayKey(form.barangay)
    ) {
      rootUpdates[
        `barangay_assignments/${makeBarangayKey(previousBarangay)}/${routeId}`
      ] = null;
    }

    try {
      setSaving(true);
      await update(ref(db), rootUpdates);
      setSuccessMessage(
        editingRouteId
          ? "Route assignment updated successfully."
          : "Route assignment created successfully.",
      );
      closeEditor();
    } catch (error) {
      console.error("Unable to save route assignment", error);
      alert("Unable to save the route. Check Firebase permissions and try again.");
      setSaving(false);
    }
  };

  const deleteRoute = async (route: RouteRecord) => {
    const activeSchedules = schedules.filter((schedule) => {
      const routeId = schedule.routeId || schedule.assignedRouteId;
      return (
        routeId === route.id &&
        String(schedule.status || "active").toLowerCase() !== "cancelled"
      );
    });

    if (activeSchedules.length > 0) {
      alert(
        `This route is used by ${activeSchedules.length} schedule(s). Delete or reassign those schedules first.`,
      );
      return;
    }

    if (!window.confirm(`Delete “${route.routeName || "this route"}”?`)) {
      return;
    }

    const rootUpdates: Record<string, unknown> = {
      [`routes/${route.id}`]: null,
    };

    if (route.assignedDriverId) {
      rootUpdates[`drivers/${route.assignedDriverId}/assignedRouteId`] = null;
      rootUpdates[`drivers/${route.assignedDriverId}/assignedRouteName`] = null;
    }

    const barangay = getRouteBarangay(route);
    if (barangay) {
      rootUpdates[
        `barangay_assignments/${makeBarangayKey(barangay)}/${route.id}`
      ] = null;
    }

    try {
      await update(ref(db), rootUpdates);
      setSuccessMessage("Route deleted successfully.");
    } catch (error) {
      console.error("Unable to delete route", error);
      alert("Unable to delete the route.");
    }
  };

  return (
    <DashboardShell
      title="Route Management"
      description="Assign a driver to a Barangay and selected Puroks. The map automatically focuses on the selected Barangay for reference only."
    >
      <div className="route-page">
        {successMessage ? (
          <div className="success-banner reveal reveal-2">
            <span>{successMessage}</span>
            <button type="button" onClick={() => setSuccessMessage("")}>
              ×
            </button>
          </div>
        ) : null}

        <section className="metrics-grid reveal reveal-2">
          <Metric
            icon={<RouteIcon />}
            tone="green"
            label="Total routes"
            value={routes.length}
            hint="Saved service areas"
          />
          <Metric
            icon={<ReadyIcon />}
            tone="blue"
            label="Ready"
            value={routes.filter((route) => getRoutePuroks(route).length > 0).length}
            hint="Barangay and Puroks configured"
          />
          <Metric
            icon={<DriverIcon />}
            tone="amber"
            label="Drivers assigned"
            value={routes.filter((route) => route.assignedDriverId).length}
            hint="Operational ownership"
          />
          <Metric
            icon={<CalendarIcon />}
            tone="purple"
            label="Used by schedules"
            value={routesWithSchedules}
            hint="Linked weekly schedules"
          />
        </section>

        <section className="route-card reveal reveal-3">
          <div className="table-toolbar">
            <div>
              <h3>Route assignments</h3>
              <p>No drawn path is required.</p>
            </div>

            <div className="toolbar-actions">
              <div className="search-wrap">
                <span className="search-icon">
                  <SearchIcon />
                </span>
                <input
                  type="search"
                  placeholder="Search route, Barangay, Purok, driver..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <button
                type="button"
                className="create-route-btn"
                onClick={openCreateEditor}
              >
                <span aria-hidden="true">＋</span>
                Create Route
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Barangay</th>
                  <th>Purok coverage</th>
                  <th>Driver / Truck</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredRoutes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No route assignments found.
                    </td>
                  </tr>
                ) : (
                  filteredRoutes.map((route, index) => {
                    const puroks = getRoutePuroks(route);

                    return (
                      <tr
                        key={route.id}
                        className="row-fade"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <td>
                          <div className="route-info">
                            <span className="route-symbol">
                              <RouteIcon />
                            </span>
                            <div>
                              <strong>{route.routeName || "Unnamed route"}</strong>
                              <small>{route.id}</small>
                            </div>
                          </div>
                        </td>

                        <td>{getRouteBarangay(route) || "—"}</td>

                        <td>
                          <div className="purok-list">
                            {puroks.map((purok) => (
                              <span key={purok}>{purok}</span>
                            ))}
                          </div>
                        </td>

                        <td>
                          <div className="driver-cell">
                            <span className="truck-symbol">
                              <TruckIcon />
                            </span>
                            <div>
                              <strong>{route.assignedDriverName || "Unassigned"}</strong>
                              <small>{route.assignedVehicle || "No truck assigned"}</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="status-pill">
                            <i />
                            {String(route.status || "ready")}
                          </span>
                        </td>

                        <td>{formatDate(route.updatedAt || route.createdAt)}</td>

                        <td>
                          <div className="table-actions">
                            <button type="button" onClick={() => openEditEditor(route)}>
                              <PencilIcon />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deleteRoute(route)}
                            >
                              <TrashIcon />
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

          <div className="table-footer">
            <p>
              Showing {filteredRoutes.length === 0 ? 0 : 1} to {filteredRoutes.length} of{" "}
              {filteredRoutes.length} routes
            </p>

            <div className="pagination">
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

        {editorOpen ? (
          <div className="modal-backdrop" role="presentation">
            <section
              className="editor"
              role="dialog"
              aria-modal="true"
              aria-labelledby="route-editor-title"
            >
              <header className="editor-header">
                <div>
                  <span className="editor-kicker">
                    {editingRouteId ? "EDIT ROUTE" : "NEW ROUTE"}
                  </span>
                  <h2 id="route-editor-title">
                    {editingRouteId
                      ? "Update service area route"
                      : "Create service area route"}
                  </h2>
                  <p>
                    Select the Barangay, Puroks, and assigned driver. The map
                    will automatically focus on the selected Barangay.
                  </p>
                </div>
                <button type="button" onClick={closeEditor} aria-label="Close">
                  ×
                </button>
              </header>

              <div className="editor-body">
                <div className="form-grid">
                  <label>
                    <span>Route name</span>
                    <input
                      value={form.routeName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          routeName: event.target.value,
                        }))
                      }
                      placeholder="Example: Canlapwas Purok 1–5"
                    />
                  </label>

                  <label>
                    <span>Barangay</span>
                    <select
                      value={form.barangay}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          barangay: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select Barangay</option>
                      {BARANGAYS.map((barangay) => (
                        <option key={barangay} value={barangay}>
                          {barangay}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Assigned driver</span>
                    <select
                      value={form.assignedDriverId}
                      onChange={(event) => {
                        const driverId = event.target.value;
                        const driver = drivers.find((item) => item.id === driverId);
                        setForm((current) => ({
                          ...current,
                          assignedDriverId: driverId,
                          assignedVehicle:
                            current.assignedVehicle || driver?.truck || "",
                        }));
                      }}
                    >
                      <option value="">Select driver</option>
                      {activeDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name || driver.id}
                          {driver.truck ? ` — ${driver.truck}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Truck / plate number</span>
                    <input
                      value={form.assignedVehicle}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          assignedVehicle: event.target.value,
                        }))
                      }
                      placeholder="Optional"
                    />
                  </label>
                </div>

                <div className="purok-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Purok coverage</h3>
                      <p>Select Purok 1 to Purok 10 covered by this route.</p>
                    </div>
                    <button type="button" onClick={selectAllPuroks}>
                      {selectedPuroks.length === PUROKS.length ? "Clear all" : "Select all"}
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

                <div className="map-panel">
                  <div className="map-heading">
                    <div>
                      <h3>Barangay map preview</h3>
                      <p>
                        {form.barangay
                          ? `Showing the reference location for ${form.barangay}.`
                          : "Select a Barangay to focus the map."}
                      </p>
                    </div>
                    <button type="button" onClick={focusSelectedBarangay} disabled={!mapReady}>
                      Recenter map
                    </button>
                  </div>

                  <div
                    ref={mapContainerRef}
                    className="barangay-map"
                    aria-label={
                      form.barangay
                        ? `Map focused on ${form.barangay}`
                        : "Catbalogan City map"
                    }
                  />

                  <p className="map-disclaimer">
                    This map is for visual reference only. It does not require route
                    drawing, checkpoints, or Purok pins.
                  </p>
                </div>

                <div className="info-card">
                  <strong>Area-based route assignment</strong>
                  <p>
                    Saving the route records only the selected Barangay, Puroks,
                    driver, and truck. The map location is not saved as a route
                    line.
                  </p>
                </div>
              </div>

              <footer className="editor-footer">
                <button type="button" className="secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={saving}
                  onClick={saveRoute}
                >
                  {saving
                    ? "Saving..."
                    : editingRouteId
                      ? "Save Changes"
                      : "Create Route"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <style jsx global>{`
          .route-page {
            width: 100%;
            max-width: 1680px;
            margin: 0 auto;
            display: grid;
            gap: 16px;
            color: #16291f;
          }

          .reveal {
            opacity: 0;
            transform: translateY(10px);
            animation: revealIn .42s cubic-bezier(.2,.75,.25,1) forwards;
          }

          .reveal-1 { animation-delay: 20ms; }
          .reveal-2 { animation-delay: 80ms; }
          .reveal-3 { animation-delay: 140ms; }

          @keyframes revealIn {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .success-banner {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 16px;
            border: 1px solid #b8e7c4;
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

          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 14px;
          }

          .metric-card {
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 102px;
            padding: 17px 18px;
            border: 1px solid #dfe8e2;
            border-radius: 16px;
            background: #ffffff;
            box-shadow: 0 6px 18px rgba(16,35,27,.045);
            transition: transform .16s ease, box-shadow .16s ease;
          }

          .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 26px rgba(16,35,27,.08);
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
            background: #eaf5ee;
            color: #1b9656;
          }

          .metric-icon.blue {
            background: #e8f1fb;
            color: #2276b7;
          }

          .metric-icon.amber {
            background: #fff3da;
            color: #c28411;
          }

          .metric-icon.purple {
            background: #f0e8fb;
            color: #7960c9;
          }

          .metric-icon svg {
            width: 26px !important;
            height: 26px !important;
            fill: currentColor;
          }

          .metric-copy {
            min-width: 0;
            display: grid;
            gap: 4px;
          }

          .metric-copy span {
            color: #4e6258;
            font-size: 14px;
            font-weight: 800;
          }

          .metric-copy strong {
            color: #13261d;
            font-size: 22px;
            line-height: 1;
          }

          .metric-copy small {
            color: #75857c;
            font-size: 12px;
          }

          .route-card {
            overflow: hidden;
            border: 1px solid #dfe7e2;
            border-radius: 18px;
            background: #ffffff;
            box-shadow: 0 8px 24px rgba(16,35,27,.045);
          }

          .table-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
            padding: 16px 18px;
            border-bottom: 1px solid #e7ede9;
          }

          .table-toolbar h3,
          .table-toolbar p {
            margin: 0;
          }

          .table-toolbar h3 {
            color: #16291f;
            font-size: 24px;
            line-height: 1.2;
          }

          .table-toolbar p {
            margin-top: 6px;
            color: #71827a;
            font-size: 13px;
          }

          .search-wrap {
            width: min(360px, 100%);
            height: 42px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 13px;
            border: 1px solid #d5dfd9;
            border-radius: 12px;
            background: #ffffff;
          }

          .search-icon {
            width: 18px;
            height: 18px;
            color: #85928b;
            flex: 0 0 18px;
          }

          .search-icon svg {
            width: 18px !important;
            height: 18px !important;
            fill: currentColor;
          }

          .search-wrap input {
            width: 100%;
            border: 0;
            outline: 0;
            color: #1a2f25;
            background: transparent;
            font-size: 14px;
          }

          .search-wrap input::placeholder {
            color: #87968e;
          }

          .toolbar-actions {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .create-route-btn {
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 0 15px;
            border: 1px solid #168a4a;
            border-radius: 11px;
            background: #168a4a;
            color: #ffffff;
            font-size: 13px;
            font-weight: 900;
            white-space: nowrap;
            cursor: pointer;
            box-shadow: 0 7px 16px rgba(22, 138, 74, .14);
            transition:
              transform .15s ease,
              background .15s ease,
              box-shadow .15s ease;
          }

          .create-route-btn:hover {
            transform: translateY(-1px);
            background: #117a42;
            box-shadow: 0 10px 19px rgba(22, 138, 74, .20);
          }

          .table-wrap {
            overflow-x: auto;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1020px;
          }

          th,
          td {
            padding: 15px 16px;
            border-bottom: 1px solid #edf1ee;
            text-align: left;
            vertical-align: middle;
            font-size: 14px;
          }

          th {
            color: #4f705c;
            background: #f7faf8;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: .06em;
          }

          td strong,
          td small {
            display: block;
          }

          td small {
            margin-top: 4px;
            color: #7b8a82;
            font-size: 12px;
          }

          .row-fade {
            opacity: 0;
            transform: translateY(6px);
            animation: rowFade .3s ease forwards;
          }

          @keyframes rowFade {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .route-info,
          .driver-cell {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .route-symbol,
          .truck-symbol {
            width: 34px;
            height: 34px;
            flex: 0 0 34px;
            display: grid;
            place-items: center;
            border-radius: 12px;
            background: #eaf5ee;
            color: #1b9656;
          }

          .truck-symbol {
            background: #edf5ee;
            border-radius: 11px;
          }

          .route-symbol svg,
          .truck-symbol svg {
            width: 20px !important;
            height: 20px !important;
            fill: currentColor;
          }

          .purok-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            max-width: 320px;
          }

          .purok-list span {
            display: inline-flex;
            border-radius: 999px;
            padding: 5px 10px;
            background: #ecf8ef;
            color: #158d4d;
            font-size: 12px;
            font-weight: 800;
          }

          .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #eef8f0;
            color: #1b9756;
            font-size: 12px;
            font-weight: 800;
            text-transform: lowercase;
          }

          .status-pill i {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
          }

          .table-actions {
            display: flex;
            gap: 9px;
          }

          .table-actions button {
            min-height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 0 12px;
            border: 1px solid #c9ddd0;
            border-radius: 10px;
            background: #ffffff;
            color: #168446;
            font-size: 14px;
            font-weight: 800;
            cursor: pointer;
          }

          .table-actions button svg {
            width: 16px !important;
            height: 16px !important;
            fill: currentColor;
          }

          .table-actions .danger {
            border-color: #efc1ba;
            color: #df3e35;
          }

          .empty-state {
            padding: 56px;
            text-align: center;
            color: #77867e;
          }

          .table-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            padding: 12px 18px;
          }

          .table-footer p {
            margin: 0;
            color: #6e7f76;
            font-size: 13px;
          }

          .pagination {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .pagination button {
            width: 34px;
            height: 34px;
            border: 1px solid #d9e4dd;
            border-radius: 10px;
            background: #ffffff;
            color: #9aa7a1;
            display: grid;
            place-items: center;
            font-weight: 800;
          }

          .pagination button svg {
            width: 16px !important;
            height: 16px !important;
            fill: currentColor;
          }

          .pagination .current {
            background: #1b9656;
            color: #ffffff;
            border-color: #1b9656;
          }

          .modal-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1000;
            display: grid;
            place-items: center;
            padding: 24px;
            background: rgba(15, 23, 42, 0.50);
            backdrop-filter: blur(5px);
          }

          .editor {
            width: min(980px, 100%);
            max-height: calc(100dvh - 48px);
            overflow: auto;
            border-radius: 22px;
            background: #ffffff;
            box-shadow: 0 28px 90px rgba(15, 23, 42, 0.28);
            animation: modalIn .28s ease;
          }

          @keyframes modalIn {
            from {
              opacity: 0;
              transform: translateY(10px) scale(.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          .editor-header,
          .editor-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 20px 22px;
          }

          .editor-header {
            border-bottom: 1px solid #e8eeea;
          }

          .editor-footer {
            justify-content: flex-end;
            border-top: 1px solid #e8eeea;
          }

          .editor-kicker {
            color: #209657;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: .12em;
          }

          .editor-header h2,
          .editor-header p {
            margin: 0;
          }

          .editor-header h2 {
            margin-top: 7px;
            color: #173026;
            font-size: 24px;
          }

          .editor-header p {
            margin-top: 7px;
            color: #6b7b72;
            line-height: 1.5;
          }

          .editor-header > button {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 50%;
            background: #f1f5f3;
            color: #2f4138;
            font-size: 22px;
            cursor: pointer;
          }

          .editor-body {
            display: grid;
            gap: 20px;
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
          select {
            width: 100%;
            border: 1px solid #d5dfd9;
            border-radius: 11px;
            padding: 11px 12px;
            background: #fff;
            color: #17231d;
            outline: 0;
          }

          input:focus,
          select:focus {
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
            gap: 16px;
            align-items: flex-start;
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
            border-radius: 10px;
            padding: 10px 12px;
            background: #ffffff;
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

          .map-panel {
            overflow: hidden;
            border: 1px solid #dce6e0;
            border-radius: 16px;
            background: #ffffff;
          }

          .map-heading {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 15px 16px;
            border-bottom: 1px solid #e8eeea;
          }

          .map-heading h3,
          .map-heading p {
            margin: 0;
          }

          .map-heading p {
            margin-top: 4px;
            color: #718078;
            font-size: 13px;
          }

          .map-heading button {
            border: 1px solid #cfdad4;
            border-radius: 10px;
            padding: 8px 11px;
            background: #ffffff;
            color: #0f5138;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
          }

          .map-heading button:disabled {
            cursor: wait;
            opacity: 0.55;
          }

          .barangay-map {
            width: 100%;
            height: 360px;
            background: #e7eef0;
          }

          .map-disclaimer {
            margin: 0;
            padding: 11px 16px;
            border-top: 1px solid #e8eeea;
            color: #6c7b73;
            background: #f8faf9;
            font-size: 12px;
            line-height: 1.5;
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

          @media (max-width: 1200px) {
            .hero-copy {
              width: min(610px, 62%);
              padding-right: 30px;
            }

            .hero-illustration-svg {
              width: 72%;
              min-width: 660px;
            }

            .hero-cta {
              right: 20px;
            }

            .metrics-grid,
            .info-strip {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .info-tile:nth-child(3) {
              border-left: 0;
            }

            .info-tile {
              border-top: 1px solid transparent;
            }
          }

          @media (max-width: 900px) {
            .table-toolbar,
            .panel-heading,
            .map-heading {
              flex-direction: column;
              align-items: stretch;
            }

            .toolbar-actions {
              width: 100%;
            }

            .search-wrap {
              flex: 1;
              width: auto;
            }

            .metrics-grid,
            .info-strip,
            .form-grid {
              grid-template-columns: 1fr;
            }

            .hero-card {
              min-height: 300px;
            }

            .hero-copy {
              width: 100%;
              min-height: 190px;
              padding: 25px 24px 92px;
              background:
                linear-gradient(180deg, rgba(5,79,49,.94) 0%, rgba(5,79,49,.82) 58%, rgba(5,79,49,.22) 100%);
            }

            .hero-copy h2,
            .hero-copy p {
              max-width: 650px;
            }

            .hero-illustration-svg {
              width: 100%;
              min-width: 600px;
              opacity: .66;
            }

            .hero-cta {
              top: auto;
              left: 24px;
              right: auto;
              bottom: 22px;
              transform: none;
            }

            .hero-cta:hover {
              transform: translateY(-2px);
            }

            .purok-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .table-footer {
              flex-direction: column;
              align-items: flex-start;
            }

            .info-tile + .info-tile {
              border-left: 0;
              border-top: 1px solid #dde8e2;
            }
          }

          @media (max-width: 620px) {
            .toolbar-actions {
              flex-direction: column;
              align-items: stretch;
            }

            .create-route-btn {
              width: 100%;
            }

            .page-heading h1 {
              font-size: 24px;
            }

            .hero-copy h2 {
              font-size: 31px;
            }

            .hero-card {
              min-height: 290px;
              border-radius: 18px;
            }

            .hero-copy {
              padding: 22px 18px 88px;
            }

            .hero-cta {
              left: 18px;
              bottom: 18px;
            }

            .hero-illustration-svg {
              min-width: 560px;
              transform: translateX(18%);
            }

            .barangay-map {
              height: 300px;
            }

            .modal-backdrop {
              padding: 12px;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .reveal,
            .row-fade,
            .editor {
              animation: none !important;
              opacity: 1 !important;
              transform: none !important;
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
  icon: React.ReactNode;
  tone: "green" | "blue" | "amber" | "purple";
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}
