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

const PUROKS = Array.from(
  { length: 10 },
  (_, index) => `Purok ${index + 1}`,
);

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
        color: "#1478c8",
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
    const vehicle =
      form.assignedVehicle.trim() || assignedDriver.truck || "";

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

    const previousBarangay = existingRoute
      ? getRouteBarangay(existingRoute)
      : "";

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
        <section className="hero">
          <div>
            <span>COLLECTION AREA ASSIGNMENT</span>
            <h1>Barangay and Purok routes</h1>
            <p>
              A route is an assigned service area. Select the Barangay, choose the
              covered Puroks, and assign the responsible driver.
            </p>
          </div>
          <button type="button" onClick={openCreateEditor}>
            + Create Route
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
          <Metric label="Total routes" value={routes.length} hint="Saved service areas" />
          <Metric
            label="Ready"
            value={routes.filter((route) => getRoutePuroks(route).length > 0).length}
            hint="Barangay and Puroks configured"
          />
          <Metric
            label="Drivers assigned"
            value={routes.filter((route) => route.assignedDriverId).length}
            hint="Operational ownership"
          />
          <Metric
            label="Used by schedules"
            value={routesWithSchedules}
            hint="Linked weekly schedules"
          />
        </section>

        <section className="route-card">
          <div className="card-toolbar">
            <div>
              <h2>Route assignments</h2>
              <p>No drawn path is required.</p>
            </div>
            <input
              type="search"
              placeholder="Search route, Barangay, Purok, driver…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
                  <th aria-label="Actions" />
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
                  filteredRoutes.map((route) => {
                    const puroks = getRoutePuroks(route);
                    return (
                      <tr key={route.id}>
                        <td>
                          <strong>{route.routeName || "Unnamed route"}</strong>
                          <small>{route.id}</small>
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
                          <strong>{route.assignedDriverName || "Unassigned"}</strong>
                          <small>{route.assignedVehicle || "No truck assigned"}</small>
                        </td>
                        <td>
                          <span className="status-pill">
                            {String(route.status || "ready")}
                          </span>
                        </td>
                        <td>{formatDate(route.updatedAt || route.createdAt)}</td>
                        <td>
                          <div className="actions">
                            <button type="button" onClick={() => openEditEditor(route)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deleteRoute(route)}
                            >
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

        {editorOpen ? (
          <div className="modal-backdrop" role="presentation">
            <section
              className="editor"
              role="dialog"
              aria-modal="true"
              aria-labelledby="route-editor-title"
            >
              <header>
                <div>
                  <span>{editingRouteId ? "EDIT ROUTE" : "NEW ROUTE"}</span>
                  <h2 id="route-editor-title">
                    {editingRouteId
                      ? "Update service area route"
                      : "Create service area route"}
                  </h2>
                  <p>Select the Barangay, Puroks, and assigned driver. The map will automatically focus on the selected Barangay.</p>
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
                    <button
                      type="button"
                      onClick={focusSelectedBarangay}
                      disabled={!mapReady}
                    >
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
                    driver, and truck. The map location is not saved as a route line.
                  </p>
                </div>
              </div>

              <footer>
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
                    ? "Saving…"
                    : editingRouteId
                      ? "Save Changes"
                      : "Create Route"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <style jsx>{`
          .route-page {
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
          .editor header span {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.12em;
          }

          .hero h1 {
            margin: 8px 0;
            font-size: 30px;
          }

          .hero p {
            max-width: 700px;
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

          .route-card {
            overflow: hidden;
            border: 1px solid #dfe7e2;
            border-radius: 18px;
            background: #fff;
          }

          .card-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 18px;
            border-bottom: 1px solid #e5ebe7;
          }

          .card-toolbar h2,
          .card-toolbar p {
            margin: 0;
          }

          .card-toolbar p {
            margin-top: 4px;
            color: #6b7b72;
            font-size: 13px;
          }

          .card-toolbar input {
            width: min(340px, 100%);
            border: 1px solid #d7e1db;
            border-radius: 11px;
            padding: 11px 13px;
            outline: 0;
          }

          .table-wrap {
            overflow-x: auto;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 960px;
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

          .purok-list {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            max-width: 330px;
          }

          .purok-list span,
          .status-pill {
            display: inline-flex;
            border-radius: 999px;
            padding: 5px 8px;
            background: #ecfdf5;
            color: #047857;
            font-size: 11px;
            font-weight: 700;
          }

          .actions {
            display: flex;
            gap: 7px;
          }

          .actions button,
          .secondary,
          .panel-heading button {
            border: 1px solid #d7e1db;
            border-radius: 9px;
            padding: 8px 10px;
            background: #fff;
            color: #33443b;
            font-weight: 700;
            cursor: pointer;
          }

          .actions .danger {
            color: #b91c1c;
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

          .editor {
            width: min(980px, 100%);
            max-height: calc(100dvh - 48px);
            overflow: auto;
            border-radius: 20px;
            background: #fff;
            box-shadow: 0 28px 90px rgba(15, 23, 42, 0.28);
          }

          .editor header,
          .editor footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            padding: 20px 22px;
          }

          .editor header {
            border-bottom: 1px solid #e8eeea;
          }

          .editor footer {
            justify-content: flex-end;
            border-top: 1px solid #e8eeea;
          }

          .editor header h2,
          .editor header p {
            margin: 0;
          }

          .editor header h2 {
            margin-top: 5px;
          }

          .editor header p {
            margin-top: 5px;
            color: #6b7b72;
          }

          .editor header > button {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 50%;
            background: #f1f5f3;
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

          @media (max-width: 1000px) {
            .metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 700px) {
            .hero,
            .card-toolbar,
            .panel-heading,
            .map-heading {
              flex-direction: column;
              align-items: stretch;
            }

            .form-grid {
              grid-template-columns: 1fr;
            }

            .purok-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .barangay-map {
              height: 300px;
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

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <style jsx>{`
        .metric {
          display: grid;
          gap: 5px;
          padding: 17px;
          border: 1px solid #dfe7e2;
          border-radius: 15px;
          background: #fff;
        }

        span,
        small {
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
