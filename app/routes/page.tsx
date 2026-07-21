"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, set, remove, update, get } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = [
  "Mercedes",
  "Canlapwas ",
  "Maulong ",
  "San Andres",
  "Poblacion 13"
];

const PUROKS = Array.from({ length: 10 }, (_, i) => `Purok ${i + 1}`);

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function RoutesPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any>({});
  const [etas, setEtas] = useState<any>({});

  const [selectedBarangays, setSelectedBarangays] = useState<string[]>([]);
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]); // ✅ ADDED
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    routeName: "",
    assignedDriverId: "",
    estimatedDistanceKm: "",
  });

  const makeBarangayKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s*\(.*?\)/g, "")
      .replace(/barangay/g, "")
      .replace(/[^a-z0-9ñ\s]/g, "")
      .trim()
      .replace(/\s+/g, "_");

  /* ================= DELETE ROUTE ================= */
  const deleteRoute = async (routeId: string) => {
    const confirmDelete = confirm("Are you sure you want to delete this route?");
    if (!confirmDelete) return;

    try {
      const routeSnap = await get(ref(db, `routes/${routeId}`));
      const routeData: any = routeSnap.val();

      if (!routeData) {
        alert("Route not found");
        return;
      }

      const assignedDriverId = routeData.assignedDriverId;
      const barangays = Array.isArray(routeData.barangays) ? routeData.barangays : [];

      await remove(ref(db, `routes/${routeId}`));

      await Promise.all(
        barangays.map(async (barangay: string) => {
          const key = makeBarangayKey(barangay);
          const assignmentRef = ref(db, `barangay_assignments/${key}`);
          const assignmentSnap = await get(assignmentRef);
          const assignmentData: any = assignmentSnap.val();

          if (assignmentData?.routeId === routeId) {
            await remove(assignmentRef);
          }
        })
      );

      if (assignedDriverId) {
        const driverRouteSnap = await get(ref(db, `drivers/${assignedDriverId}/assignedRouteId`));
        const currentAssignedRouteId = driverRouteSnap.val();

        if (currentAssignedRouteId === routeId) {
          await update(ref(db, `drivers/${assignedDriverId}`), {
            assignedRouteId: null,
          });
        }
      }

      await set(push(ref(db, "route_status_updates")), {
        routeName: routeData.routeName || "Deleted Route",
        status: "deleted",
        createdAt: Date.now(),
      });

      alert("Route deleted successfully!");
    } catch (error) {
      console.error(error);
      alert("Failed to delete route");
    }
  };

  /* ================= REALTIME FETCH ================= */
  useEffect(() => {
    const unsubRoutes = onValue(ref(db, "routes"), snap => {
      const val = snap.val() || {};
      setRoutes(Object.entries(val).map(([id, v]: any) => ({ id, ...v })));
    });

    const unsubDrivers = onValue(ref(db, "drivers"), snap => {
      const val = snap.val() || {};
      setDrivers(Object.entries(val).map(([id, v]: any) => ({ id, ...v })));
    });

    const unsubLocation = onValue(ref(db, "driver_locations"), snap => {
      const data = snap.val() || {};
      setLocations(data);

      Object.entries(data).forEach(([id, loc]: any) => {
        if (loc?.latitude && loc?.longitude) {
          fetchETA(id, loc.latitude, loc.longitude);
        }
      });
    });

    return () => {
      unsubRoutes();
      unsubDrivers();
      unsubLocation();
    };
  }, []);

  /* ================= ETA FUNCTION ================= */
  const fetchETA = async (id: string, lat: number, lng: number) => {
    try {
      const destLat = 11.780;
      const destLng = 124.890;

      const toRad = (value: number) => (value * Math.PI) / 180;
      const earthRadiusKm = 6371;

      const dLat = toRad(destLat - lat);
      const dLng = toRad(destLng - lng);

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat)) *
        Math.cos(toRad(destLat)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      const distanceKm = earthRadiusKm * c;
      const averageSpeedKmH = 25;

      const minutes = Math.max(1, Math.round((distanceKm / averageSpeedKmH) * 60));

      setEtas((prev: any) => ({
        ...prev,
        [id]: `${minutes} min`,
      }));
    } catch (e) {
      setEtas((prev: any) => ({
        ...prev,
        [id]: "-",
      }));
    }
  };

  /* ================= AUTO DRIVER AI ================= */
  const bestDriver = useMemo(() => {
    const ranked = drivers.map(driver => {
      const driverRoutes = routes.filter(r => r.assignedDriverId === driver.id);
      const routeCount = driverRoutes.length;

      const score = routeCount * 10 + Math.random() * 5;

      return { ...driver, score };
    });

    ranked.sort((a, b) => a.score - b.score);
    return ranked[0] || null;
  }, [drivers, routes]);

  useEffect(() => {
    if (!form.assignedDriverId && bestDriver) {
      setForm(prev => ({
        ...prev,
        assignedDriverId: bestDriver.id,
      }));
    }
  }, [bestDriver]);

  /* ================= CREATE ROUTE ================= */
  const saveRoute = async () => {
    if (!form.routeName || selectedBarangays.length === 0 || selectedDays.length === 0) {
      alert("Please complete all fields");
      return;
    }

    if (selectedPuroks.length === 0) {
      alert("Please select at least one purok");
      return;
    }

    const driver =
      drivers.find(d => d.id === form.assignedDriverId) || bestDriver;

    if (!driver) {
      alert("No available driver");
      return;
    }

    const distance = parseFloat(form.estimatedDistanceKm);

    const payload = {
      routeName: form.routeName,
      barangays: selectedBarangays,
      puroks: selectedPuroks, // ✅ ADDED
      scheduleDays: selectedDays,
      estimatedDistanceKm: isNaN(distance) ? 0 : distance,
      assignedDriverId: driver.id,
      assignedDriverName: driver.name,
      createdAt: Date.now(),
    };

    try {
      const newRouteRef = push(ref(db, "routes"));
      const routeId = newRouteRef.key;

      if (!routeId) return alert("Failed to create route ID");

      await set(newRouteRef, payload);

      await update(ref(db, `drivers/${driver.id}`), {
        assignedRouteId: routeId,
      });

      await Promise.all(
        selectedBarangays.map(barangay =>
          set(ref(db, `barangay_assignments/${makeBarangayKey(barangay)}`), {
            barangay,
            routeId,
            routeName: payload.routeName,
            driverId: driver.id,
            driverName: driver.name,
            scheduleDays: selectedDays,
            puroks: selectedPuroks, // ✅ ADDED
            estimatedDistanceKm: payload.estimatedDistanceKm,
            updatedAt: Date.now(),
          })
        )
      );

      await set(push(ref(db, "route_status_updates")), {
        ...payload,
        status: "scheduled",
      });

      alert(`Assigned to ${driver.name}`);

      setSelectedBarangays([]);
      setSelectedPuroks([]); // ✅ ADDED
      setSelectedDays([]);

      setForm({
        routeName: "",
        assignedDriverId: "",
        estimatedDistanceKm: "",
      });

      setShowForm(false);
    } catch (error) {
      console.error(error);
      alert("Failed to create route");
    }
  };

  /* ================= UI ================= */
  return (
    <DashboardShell title="Route Management" description="Smart + GPS driver assignment">
      <div className="route-header">
        <h2>Routes ({routes.length})</h2>

        <button className="primary-action" onClick={() => setShowForm(true)}>
          + Add Route
        </button>
      </div>

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Create Route</h3>

            <input
              placeholder="Route Name"
              value={form.routeName}
              onChange={(e) => setForm({ ...form, routeName: e.target.value })}
            />

            <select
              value={selectedBarangays[0] || ""}
              onChange={(e) => setSelectedBarangays([e.target.value])}
            >
              <option value="">Select Barangay</option>
              {BARANGAYS.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {/* ✅ PUROK ADDED */}
            {selectedBarangays.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <label><b>Select Puroks</b></label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {PUROKS.map(p => (
                    <label key={p}>
                      <input
                        type="checkbox"
                        checked={selectedPuroks.includes(p)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPuroks([...selectedPuroks, p]);
                          } else {
                            setSelectedPuroks(selectedPuroks.filter(x => x !== p));
                          }
                        }}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <select
              value={selectedDays[0] || ""}
              onChange={(e) => setSelectedDays([e.target.value])}
            >
              <option value="">Select Day</option>
              {DAYS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <input
              placeholder="Distance (km)"
              value={form.estimatedDistanceKm}
              onChange={(e) =>
                setForm({ ...form, estimatedDistanceKm: e.target.value })
              }
            />

            <select
              value={form.assignedDriverId}
              onChange={(e) =>
                setForm({ ...form, assignedDriverId: e.target.value })
              }
            >
              <option value="">Auto Assign</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} {locations[d.id] ? "📍" : ""}
                </option>
              ))}
            </select>

            <div className="modal-actions">
              <button onClick={() => setShowForm(false)}>Cancel</button>
              <button className="primary-action" onClick={saveRoute}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Barangay</th>
              <th>Purok</th>
              <th>Driver</th>
              <th>GPS</th>
              <th>Schedule</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {routes.map((r) => {
              const loc = locations[r.assignedDriverId];

              return (
                <tr key={r.id}>
                  <td>{r.routeName}</td>

                  <td>{Array.isArray(r.barangays) ? r.barangays.join(", ") : r.barangays}</td>

                  {/* ✅ PUROK DISPLAY ADDED */}
                  <td>{Array.isArray(r.puroks) ? r.puroks.join(", ") : "-"}</td>

                  <td>{r.assignedDriverName || "-"}</td>

                  <td>
                    {loc ? `📍 ${loc.latitude}, ${loc.longitude}` : "No GPS"}
                    <br />
                    ⏱ {etas[r.assignedDriverId] || "-"}
                  </td>

                  <td>
                    {Array.isArray(r.scheduleDays)
                      ? r.scheduleDays.join(", ")
                      : r.scheduleDays}
                  </td>

                  <td>
                    <button
                      style={{ background: "red", color: "white", padding: "5px 10px" }}
                      onClick={() => deleteRoute(r.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}