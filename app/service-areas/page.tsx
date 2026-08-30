"use client";

import { onValue, ref, update } from "@/lib/offlineFirebaseDatabase";
import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import {
  CATBALOGAN_BOUNDARY_SOURCE,
  CATBALOGAN_PSGC_SOURCE,
  OFFICIAL_CATBALOGAN_BARANGAYS,
  findOfficialBarangay,
  makeBarangayKey,
  makePurokKey,
  normalizePurokLabel,
} from "./catalog";

const PUROK_OPTIONS = Array.from({ length: 10 }, (_, index) => `Purok ${index + 1}`);

type PurokRecord = {
  purok?: string;
  purokKey?: string;
  configured?: boolean;
  active?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

type BarangayRecord = {
  barangay?: string;
  psgcCode?: string;
  centerLatitude?: number;
  centerLongitude?: number;
  coordinateType?: string;
  coordinateSource?: string;
  active?: boolean;
  puroks?: Record<string, PurokRecord>;
};

type ServiceAreaRow = PurokRecord & {
  id: string;
  barangay: string;
  barangayKey: string;
  psgcCode: string;
  purok: string;
  purokKey: string;
};

type AreaConsumer = { status?: string; areas?: unknown };

function recordUsesArea(record: AreaConsumer, targetAreaKey: string): boolean {
  const items = Array.isArray(record.areas)
    ? record.areas
    : Object.values((record.areas && typeof record.areas === "object" ? record.areas : {}) as Record<string, unknown>);
  return items.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const area = raw as { areaKey?: string; barangay?: string; purok?: string };
    const key = area.areaKey || `${makeBarangayKey(area.barangay || "")}|${makePurokKey(area.purok || "")}`;
    return key === targetAreaKey;
  });
}

export default function ServiceAreasPage() {
  const [registry, setRegistry] = useState<Record<string, BarangayRecord>>({});
  const [routes, setRoutes] = useState<Record<string, AreaConsumer>>({});
  const [schedules, setSchedules] = useState<Record<string, AreaConsumer>>({});
  const [selectedBarangays, setSelectedBarangays] = useState<string[]>([]);
  const [selectedPuroks, setSelectedPuroks] = useState<string[]>([]);
  const [barangayPickerOpen, setBarangayPickerOpen] = useState(false);
  const [barangayQuery, setBarangayQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const barangayPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onValue(ref(db, "service_areas"), (snapshot) => setRegistry(snapshot.val() || {})), []);
  useEffect(() => onValue(ref(db, "routes"), (snapshot) => setRoutes(snapshot.val() || {})), []);
  useEffect(() => onValue(ref(db, "schedules"), (snapshot) => setSchedules(snapshot.val() || {})), []);

  // Keep existing Service Area Barangay pins synchronized with the verified
  // public-map locality coordinates in catalog.ts. This fixes older records
  // that were saved with generic boundary-interior reference points.
  useEffect(() => {
    const writes: Record<string, unknown> = {};
    Object.entries(registry).forEach(([registryBarangayKey, record]) => {
      const official = findOfficialBarangay(
        record.barangay || registryBarangayKey,
      );
      if (!official || official.coordinateType !== "openstreetmap-locality") {
        return;
      }

      const latitude = Number(record.centerLatitude);
      const longitude = Number(record.centerLongitude);
      const staleCoordinate =
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude - official.centerLatitude) > 0.000001 ||
        Math.abs(longitude - official.centerLongitude) > 0.000001;
      const staleSource =
        record.coordinateType !== official.coordinateType ||
        record.coordinateSource !== official.coordinateSource;

      if (!staleCoordinate && !staleSource) return;

      const basePath = `service_areas/${official.barangayKey}`;
      writes[`${basePath}/centerLatitude`] = official.centerLatitude;
      writes[`${basePath}/centerLongitude`] = official.centerLongitude;
      writes[`${basePath}/coordinateType`] = official.coordinateType;
      writes[`${basePath}/coordinateSource`] = official.coordinateSource;
      writes[`${basePath}/coordinatesVerifiedAt`] = Date.now();
    });

    if (!Object.keys(writes).length) return;
    void update(ref(db), writes).catch((error) => {
      console.error("Unable to synchronize Service Area coordinates", error);
    });
  }, [registry]);

  useEffect(() => {
    if (!barangayPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (barangayPickerRef.current && !barangayPickerRef.current.contains(event.target as Node)) {
        setBarangayPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBarangayPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [barangayPickerOpen]);

  const rows = useMemo<ServiceAreaRow[]>(() => {
    const result: ServiceAreaRow[] = [];
    Object.entries(registry).forEach(([registryBarangayKey, barangayRecord]) => {
      const official = findOfficialBarangay(barangayRecord.barangay || registryBarangayKey);
      const barangay = official?.name || barangayRecord.barangay || registryBarangayKey;
      const barangayKey = makeBarangayKey(barangay);
      Object.entries(barangayRecord.puroks || {}).forEach(([registryPurokKey, record]) => {
        const purok = normalizePurokLabel(record.purok || registryPurokKey.replace(/_/g, " "));
        const purokKey = makePurokKey(purok);
        result.push({
          ...record,
          id: `${barangayKey}|${purokKey}`,
          barangay,
          barangayKey,
          psgcCode: official?.psgcCode || barangayRecord.psgcCode || "",
          purok,
          purokKey,
        });
      });
    });
    return result.sort((left, right) => left.barangay.localeCompare(right.barangay) ||
      Number(left.purok.match(/\d+/)?.[0] || 0) - Number(right.purok.match(/\d+/)?.[0] || 0));
  }, [registry]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? rows.filter((row) => `${row.barangay} ${row.purok}`.toLowerCase().includes(query)) : rows;
  }, [rows, search]);

  const filteredBarangays = useMemo(() => {
    const query = barangayQuery.trim().toLowerCase();
    return query
      ? OFFICIAL_CATBALOGAN_BARANGAYS.filter((item) => item.name.toLowerCase().includes(query))
      : OFFICIAL_CATBALOGAN_BARANGAYS;
  }, [barangayQuery]);

  const activeRows = useMemo(() => rows.filter((row) => row.active !== false), [rows]);
  const activeBarangays = useMemo(() => new Set(activeRows.map((row) => row.barangayKey)).size, [activeRows]);
  const combinationCount = selectedBarangays.length * selectedPuroks.length;

  const toggleBarangay = (barangay: string) => {
    setSelectedBarangays((current) => current.includes(barangay)
      ? current.filter((item) => item !== barangay)
      : [...current, barangay]);
  };

  const togglePurok = (purok: string) => {
    setSelectedPuroks((current) => current.includes(purok)
      ? current.filter((item) => item !== purok)
      : [...current, purok]);
  };

  const addServiceAreas = async () => {
    if (!selectedBarangays.length) return alert("Select at least one Barangay.");
    if (!selectedPuroks.length) return alert("Select at least one Purok.");

    const now = Date.now();
    const addedBy = auth.currentUser?.uid || "admin";
    const writes: Record<string, unknown> = {};
    let addedCount = 0;
    let skippedCount = 0;

    selectedBarangays.forEach((barangay) => {
      const official = findOfficialBarangay(barangay);
      if (!official) return;
      const newPuroks = selectedPuroks.filter((purok) => {
        const existing = registry[official.barangayKey]?.puroks?.[makePurokKey(purok)];
        if (existing && existing.active !== false) {
          skippedCount += 1;
          return false;
        }
        return true;
      });
      if (!newPuroks.length) return;

      const basePath = `service_areas/${official.barangayKey}`;
      writes[`${basePath}/barangay`] = official.name;
      writes[`${basePath}/barangayKey`] = official.barangayKey;
      writes[`${basePath}/psgcCode`] = official.psgcCode;
      writes[`${basePath}/correspondenceCode`] = official.correspondenceCode;
      writes[`${basePath}/centerLatitude`] = official.centerLatitude;
      writes[`${basePath}/centerLongitude`] = official.centerLongitude;
      writes[`${basePath}/coordinateType`] = official.coordinateType;
      writes[`${basePath}/coordinateSource`] = official.coordinateSource;
      writes[`${basePath}/coordinatesVerifiedAt`] = now;
      writes[`${basePath}/active`] = true;
      writes[`${basePath}/updatedAt`] = now;

      newPuroks.forEach((rawPurok) => {
        const purok = normalizePurokLabel(rawPurok);
        const purokKey = makePurokKey(purok);
        const existing = registry[official.barangayKey]?.puroks?.[purokKey];
        const areaPath = `${basePath}/puroks/${purokKey}`;
        writes[`${areaPath}/purok`] = purok;
        writes[`${areaPath}/purokKey`] = purokKey;
        writes[`${areaPath}/configured`] = true;
        writes[`${areaPath}/active`] = true;
        writes[`${areaPath}/addedBy`] = addedBy;
        writes[`${areaPath}/createdAt`] = existing?.createdAt || now;
        writes[`${areaPath}/updatedAt`] = now;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/name`] = purok;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/label`] = purok;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/purok`] = purok;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/configured`] = true;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/active`] = true;
        writes[`purok_registry/${official.barangayKey}/${purokKey}/updatedAt`] = now;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/barangay`] = official.name;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/barangayKey`] = official.barangayKey;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/purok`] = purok;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/configured`] = true;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/active`] = true;
        writes[`purok_locations/${official.barangayKey}/${purokKey}/updatedAt`] = now;
        addedCount += 1;
      });
    });

    if (!addedCount) return alert("All selected Barangay/Purok combinations are already active.");
    writes["service_area_catalog/updatedAt"] = now;
    writes["service_area_catalog/updatedBy"] = addedBy;
    writes["service_area_catalog/psgcSource"] = CATBALOGAN_PSGC_SOURCE;
    writes["service_area_catalog/boundarySource"] = CATBALOGAN_BOUNDARY_SOURCE;

    try {
      setSaving(true);
      await update(ref(db), writes);
      setNotice(`${addedCount} service area${addedCount === 1 ? "" : "s"} added${skippedCount ? ` • ${skippedCount} already existed` : ""}. Route Assignment and Schedule Setup are updated.`);
      setSelectedBarangays([]);
      setSelectedPuroks([]);
      setBarangayPickerOpen(false);
      setBarangayQuery("");
    } catch (error) {
      console.error(error);
      alert("Unable to add the service areas. Check Firebase permissions and try again.");
    } finally {
      setSaving(false);
    }
  };

  const areaIsInUse = (row: ServiceAreaRow) =>
    [...Object.values(routes), ...Object.values(schedules)].some((record) =>
      !["cancelled", "canceled", "inactive", "archived", "completed"].includes(
        String(record.status || "active").toLowerCase(),
      ) && recordUsesArea(record, row.id),
    );

  const setActive = async (row: ServiceAreaRow, active: boolean) => {
    if (!active) {
      if (areaIsInUse(row)) {
        return alert("This Barangay/Purok is used by an active route or schedule. Reassign it first.");
      }
      if (!window.confirm(`Deactivate ${row.barangay}, ${row.purok}?`)) return;
    }
    const now = Date.now();
    await update(ref(db), {
      [`service_areas/${row.barangayKey}/puroks/${row.purokKey}/active`]: active,
      [`service_areas/${row.barangayKey}/puroks/${row.purokKey}/updatedAt`]: now,
      [`purok_registry/${row.barangayKey}/${row.purokKey}/active`]: active,
      [`purok_locations/${row.barangayKey}/${row.purokKey}/active`]: active,
      "service_area_catalog/updatedAt": now,
    });
    setNotice(`${row.barangay}, ${row.purok} ${active ? "activated" : "deactivated"}.`);
  };

  const deleteServiceArea = async (row: ServiceAreaRow) => {
    if (areaIsInUse(row)) {
      return alert(
        "This Barangay/Purok is still used by an active route or schedule. Reassign or remove it there before deleting it.",
      );
    }

    const confirmed = window.confirm(
      `Permanently delete ${row.barangay}, ${row.purok}?\n\nThis removes it from Service Areas, Route Assignment choices, and Schedule Setup choices. This action cannot be undone.`,
    );
    if (!confirmed) return;

    const barangayRecord = registry[row.barangayKey];
    const remainingPuroks = Object.keys(barangayRecord?.puroks || {}).filter(
      (key) => key !== row.purokKey,
    );
    const deletingLastPurok = remainingPuroks.length === 0;
    const now = Date.now();

    const writes: Record<string, unknown> = {
      [`purok_registry/${row.barangayKey}/${row.purokKey}`]: null,
      [`purok_locations/${row.barangayKey}/${row.purokKey}`]: null,
      "service_area_catalog/updatedAt": now,
      "service_area_catalog/updatedBy": auth.currentUser?.uid || "admin",
    };

    if (deletingLastPurok) {
      writes[`service_areas/${row.barangayKey}`] = null;
      writes[`purok_registry/${row.barangayKey}`] = null;
      writes[`purok_locations/${row.barangayKey}`] = null;
    } else {
      writes[`service_areas/${row.barangayKey}/puroks/${row.purokKey}`] = null;
      writes[`service_areas/${row.barangayKey}/updatedAt`] = now;
    }

    try {
      await update(ref(db), writes);
      setNotice(`${row.barangay}, ${row.purok} was permanently deleted.`);
    } catch (error) {
      console.error("Unable to delete service area", error);
      alert("Unable to delete this service area. Check Firebase permissions and try again.");
    }
  };

  return (
    <DashboardShell title="Barangays & Puroks" description="Create the service coverage used by Route Assignment and Schedule Setup.">
      <main className="areas-page-v2">
        {notice ? <div className="area-notice"><span>✓ {notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}

        <section className="area-stats">
          <div><strong>{activeBarangays}</strong><span>Active Barangays</span></div>
          <div><strong>{activeRows.length}</strong><span>Active Puroks</span></div>
          <div><strong>{rows.length}</strong><span>Configured areas</span></div>
        </section>

        <section className="batch-area-card">
          <header><div><span>SERVICE AREA SETUP</span><h2>Add multiple Barangays and Puroks</h2><p>Select several Barangays and Puroks, then add every selected combination together.</p></div><div className="selection-total"><strong>{combinationCount}</strong><span>areas to add</span></div></header>
          <div className="batch-picker-grid">
            <section className="selection-panel" ref={barangayPickerRef}>
              <div className="selection-heading"><span>1</span><div><h3>Choose Barangays</h3><p>Select one or many official Catbalogan Barangays.</p></div></div>
              <button className={`multi-picker-trigger ${selectedBarangays.length ? "has-value" : ""}`} type="button" onClick={() => setBarangayPickerOpen((open) => !open)}><span>{selectedBarangays.length ? `${selectedBarangays.length} Barangay${selectedBarangays.length === 1 ? "" : "s"} selected` : "Select Barangays"}</span><b>⌄</b></button>
              {barangayPickerOpen ? <div className="barangay-menu"><div className="barangay-menu-head"><input autoFocus type="search" value={barangayQuery} onChange={(event) => setBarangayQuery(event.target.value)} placeholder="Search Barangay" /><button type="button" onClick={() => { setSelectedBarangays([]); setBarangayQuery(""); }}>Clear</button></div><div className="barangay-menu-list">{filteredBarangays.map((item) => { const selected = selectedBarangays.includes(item.name); return <button type="button" className={selected ? "selected" : ""} key={item.psgcCode} onClick={() => toggleBarangay(item.name)}><i>{selected ? "✓" : ""}</i><span>{item.name}</span></button>; })}</div><button className="barangay-menu-done" type="button" onClick={() => setBarangayPickerOpen(false)}>Done</button></div> : null}
              <div className="selected-area-chips">{selectedBarangays.length ? selectedBarangays.map((barangay) => <button type="button" key={barangay} onClick={() => toggleBarangay(barangay)}>{barangay}<span>×</span></button>) : <p>No Barangay selected.</p>}</div>
            </section>

            <section className="selection-panel">
              <div className="selection-heading"><span>2</span><div><h3>Choose Puroks</h3><p>Select Purok 1–10 for the chosen Barangays.</p></div><button type="button" onClick={() => setSelectedPuroks(selectedPuroks.length === PUROK_OPTIONS.length ? [] : [...PUROK_OPTIONS])}>{selectedPuroks.length === PUROK_OPTIONS.length ? "Clear all" : "Select all"}</button></div>
              <div className="purok-choice-grid">{PUROK_OPTIONS.map((purok) => { const selected = selectedPuroks.includes(purok); return <button type="button" className={selected ? "selected" : ""} key={purok} onClick={() => togglePurok(purok)}><i>{selected ? "✓" : "+"}</i><span>{purok}</span></button>; })}</div>
            </section>
          </div>
          <footer className="batch-add-footer"><div><strong>{selectedBarangays.length} Barangay{selectedBarangays.length === 1 ? "" : "s"} × {selectedPuroks.length} Purok{selectedPuroks.length === 1 ? "" : "s"}</strong><span>{combinationCount ? `${combinationCount} service-area combination${combinationCount === 1 ? "" : "s"} will be added.` : "Choose Barangays and Puroks to continue."}</span></div><button disabled={saving || !combinationCount} onClick={() => void addServiceAreas()}>{saving ? "Adding service areas…" : `＋ Add ${combinationCount || "selected"} service areas`}</button></footer>
        </section>

        <section className="simple-list-card">
          <header><div><h2>Added service areas</h2><p>Active entries appear automatically in Route Assignment and Schedule Setup.</p></div><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Barangay or Purok" /></header>
          <div className="simple-table-wrap"><table><thead><tr><th>Barangay</th><th>Purok</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id}><td><strong>{row.barangay}</strong></td><td>{row.purok}</td><td><span className={row.active !== false ? "row-status active" : "row-status inactive"}>{row.active !== false ? "Active" : "Inactive"}</span></td><td><div className="service-area-actions"><button className={row.active !== false ? "deactivate" : "activate"} onClick={() => void setActive(row, row.active === false)}>{row.active !== false ? "Deactivate" : "Activate"}</button><button className="delete-area" onClick={() => void deleteServiceArea(row)} aria-label={`Delete ${row.barangay} ${row.purok}`}>Delete</button></div></td></tr>) : <tr><td colSpan={4} className="empty-row">No Barangay/Purok added yet.</td></tr>}</tbody></table></div>
        </section>
      </main>
      <style jsx global>{`
        .areas-page-v2{width:min(1240px,100%);margin:0 auto;display:grid;gap:16px;color:#172a20}.area-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:1px solid #a7dfbd;border-radius:12px;background:#f0fdf4;color:#166534}.area-notice button{border:0;background:transparent;font-size:20px;cursor:pointer}.area-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.area-stats div{display:flex;align-items:center;gap:12px;padding:16px 18px;border:1px solid #dce7e0;border-radius:14px;background:#fff}.area-stats strong{font-size:27px;color:#168a4a}.area-stats span{color:#607269;font-size:12px;font-weight:800}.batch-area-card,.simple-list-card{overflow:visible;border:1px solid #dce7e0;border-radius:17px;background:#fff}.batch-area-card>header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px;border-bottom:1px solid #e5ece8}.batch-area-card header>div:first-child>span{color:#168a4a;font-size:10px;font-weight:900;letter-spacing:.11em}.batch-area-card h2,.batch-area-card p,.selection-panel h3,.selection-panel p,.simple-list-card h2,.simple-list-card p{margin:0}.batch-area-card h2{margin-top:4px}.batch-area-card p,.selection-panel p,.simple-list-card p{margin-top:4px;color:#718078;font-size:12px}.selection-total{min-width:92px;display:grid;place-items:center;padding:10px 14px;border-radius:12px;background:#eaf7ef;color:#137744}.selection-total strong{font-size:24px}.selection-total span{font-size:10px;font-weight:850}.batch-picker-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;padding:20px}.selection-panel{position:relative;display:grid;align-content:start;gap:12px;padding:16px;border:1px solid #dce7e0;border-radius:14px;background:#fbfdfc}.selection-heading{display:flex;align-items:flex-start;gap:10px}.selection-heading>span{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;background:#e5f6ec;color:#137744;font-weight:900}.selection-heading>div{flex:1}.selection-heading>button{border:0;background:transparent;color:#168a4a;font-size:11px;font-weight:850;cursor:pointer}.multi-picker-trigger{min-height:48px;display:flex;align-items:center;justify-content:space-between;border:1px solid #cad9d0;border-radius:10px;padding:0 13px;background:#fff;color:#5e7066;font-weight:750;cursor:pointer}.multi-picker-trigger.has-value{border-color:#168a4a;color:#173a28;box-shadow:0 0 0 3px rgba(22,138,74,.08)}.barangay-menu{position:absolute;z-index:60;top:120px;left:16px;right:16px;overflow:hidden;border:1px solid #cbdad1;border-radius:13px;background:#fff;box-shadow:0 18px 42px rgba(20,46,31,.18)}.barangay-menu-head{display:flex;gap:8px;padding:10px;border-bottom:1px solid #e5ece8}.barangay-menu-head input{min-height:40px;flex:1;border:1px solid #cedbd3;border-radius:9px;padding:0 11px}.barangay-menu-head button{border:0;background:transparent;color:#b42318;font-weight:800;cursor:pointer}.barangay-menu-list{max-height:250px;overflow:auto;padding:6px}.barangay-menu-list button{width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:9px;background:#fff;text-align:left;cursor:pointer}.barangay-menu-list button:hover{background:#f3f8f5}.barangay-menu-list button.selected{background:#eaf7ef;color:#137744;font-weight:800}.barangay-menu-list i{width:20px;height:20px;display:grid;place-items:center;border:1px solid #bfcec5;border-radius:6px;font-style:normal}.barangay-menu-list button.selected i{border-color:#168a4a;background:#168a4a;color:#fff}.barangay-menu-done{width:calc(100% - 16px);min-height:39px;margin:0 8px 8px;border:1px solid #168a4a;border-radius:9px;background:#168a4a;color:#fff;font-weight:850;cursor:pointer}.selected-area-chips{display:flex;flex-wrap:wrap;gap:7px;min-height:32px}.selected-area-chips>button{display:flex;align-items:center;gap:7px;border:1px solid #b9ddc7;border-radius:999px;padding:6px 9px;background:#effaf3;color:#166b40;font-size:11px;font-weight:750;cursor:pointer}.selected-area-chips>button span{font-size:15px}.selected-area-chips p{align-self:center}.purok-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.purok-choice-grid button{display:flex;align-items:center;gap:8px;min-height:42px;border:1px solid #d2ded6;border-radius:10px;padding:0 10px;background:#fff;color:#4f6258;font-weight:750;cursor:pointer}.purok-choice-grid button.selected{border-color:#168a4a;background:#eaf7ef;color:#137744}.purok-choice-grid i{width:21px;height:21px;display:grid;place-items:center;border-radius:6px;background:#eef2f0;font-style:normal}.purok-choice-grid button.selected i{background:#168a4a;color:#fff}.batch-add-footer{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 20px;border-top:1px solid #e5ece8;background:#f8fbf9;border-radius:0 0 17px 17px}.batch-add-footer>div{display:grid;gap:3px}.batch-add-footer span{color:#718078;font-size:11px}.batch-add-footer>button{min-height:44px;border:1px solid #168a4a;border-radius:10px;padding:0 18px;background:#168a4a;color:#fff;font-weight:900;cursor:pointer}.batch-add-footer>button:disabled{border-color:#bdcbc2;background:#dce5df;color:#718078;cursor:not-allowed}.simple-list-card{overflow:hidden}.simple-list-card>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid #e5ece8}.simple-list-card input{width:min(290px,100%);min-height:43px;border:1px solid #cad9d0;border-radius:10px;padding:0 12px}.simple-table-wrap{overflow:auto}.simple-list-card table{width:100%;border-collapse:collapse}.simple-list-card th,.simple-list-card td{padding:13px 15px;border-bottom:1px solid #e8eeea;text-align:left;font-size:12px}.simple-list-card th{background:#f8fbf9;color:#607269;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.row-status{display:inline-flex;border-radius:999px;padding:6px 9px;font-weight:850}.row-status.active{background:#e8f7ee;color:#137744}.row-status.inactive{background:#f1f3f2;color:#66736d}.service-area-actions{display:flex;align-items:center;gap:8px;white-space:nowrap}.service-area-actions>button{border:1px solid #d4dfd8;border-radius:8px;padding:7px 10px;background:#fff;font-weight:750;cursor:pointer;transition:background .15s ease,border-color .15s ease}.service-area-actions>button.deactivate{color:#b45309}.service-area-actions>button.activate{color:#137744}.service-area-actions>button.delete-area{border-color:#fecaca;background:#fff7f7;color:#b42318}.service-area-actions>button.delete-area:hover{border-color:#fca5a5;background:#fef2f2}.empty-row{text-align:center!important;padding:28px!important;color:#718078}@media(max-width:820px){.area-stats,.batch-picker-grid{grid-template-columns:1fr}.batch-area-card>header,.batch-add-footer,.simple-list-card>header{align-items:stretch;flex-direction:column}.selection-total{justify-self:start}.simple-list-card input{width:100%}.barangay-menu{top:120px}}
      `}</style>
    </DashboardShell>
  );
}
