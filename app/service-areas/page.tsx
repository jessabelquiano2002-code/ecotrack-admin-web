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

type RawRecord = Record<string, unknown>;
type PurokRecord = { purok?: string; purokKey?: string; configured?: boolean; active?: boolean; createdAt?: number; updatedAt?: number };
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
type ServiceAreaRow = PurokRecord & { id: string; barangay: string; barangayKey: string; psgcCode: string; purok: string; purokKey: string };
type AreaConsumer = { status?: string; areas?: unknown };

function asRecords(value: unknown): Record<string, RawRecord> {
  return value && typeof value === "object" ? value as Record<string, RawRecord> : {};
}

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

function recordBarangay(record: RawRecord): string {
  const location = record.location && typeof record.location === "object" ? record.location as RawRecord : {};
  return String(record.barangay ?? location.barangay ?? record.addressBarangay ?? record.assignedBarangay ?? "").trim();
}

function recordPurok(record: RawRecord): string {
  const location = record.location && typeof record.location === "object" ? record.location as RawRecord : {};
  return normalizePurokLabel(String(record.purok ?? record.purokLabel ?? location.purok ?? location.purokLabel ?? ""));
}

function sortPuroks(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0),
  );
}

function parsePurokInput(value: string): string[] {
  const numbers = new Set<number>();
  value
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const range = part.match(/^(\d{1,2})-(\d{1,2})$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (start >= 1 && start <= 99 && end >= 1 && end <= 99) {
          const low = Math.min(start, end);
          const high = Math.max(start, end);
          for (let current = low; current <= high; current += 1) numbers.add(current);
        }
        return;
      }
      const number = Number(part.replace(/[^0-9]/g, ""));
      if (number >= 1 && number <= 99) numbers.add(number);
    });
  return [...numbers].sort((a, b) => a - b).map((number) => `Purok ${number}`);
}

export default function ServiceAreasPage() {
  const [registry, setRegistry] = useState<Record<string, BarangayRecord>>({});
  const [routes, setRoutes] = useState<Record<string, AreaConsumer>>({});
  const [schedules, setSchedules] = useState<Record<string, AreaConsumer>>({});
  const [residents, setResidents] = useState<Record<string, RawRecord>>({});
  const [selectedBarangays, setSelectedBarangays] = useState<string[]>([]);
  const [selectedByBarangay, setSelectedByBarangay] = useState<Record<string, string[]>>({});
  const [purokInputs, setPurokInputs] = useState<Record<string, string>>({});
  const [barangayPickerOpen, setBarangayPickerOpen] = useState(false);
  const [barangayQuery, setBarangayQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const barangayPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onValue(ref(db, "service_areas"), (snapshot) => setRegistry(snapshot.val() || {})), []);
  useEffect(() => onValue(ref(db, "routes"), (snapshot) => setRoutes(snapshot.val() || {})), []);
  useEffect(() => onValue(ref(db, "schedules"), (snapshot) => setSchedules(snapshot.val() || {})), []);
  useEffect(() => onValue(ref(db, "residents"), (snapshot) => setResidents(asRecords(snapshot.val()))), []);

  useEffect(() => {
    if (!barangayPickerOpen) return;
    const outside = (event: PointerEvent) => {
      if (barangayPickerRef.current && !barangayPickerRef.current.contains(event.target as Node)) setBarangayPickerOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setBarangayPickerOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [barangayPickerOpen]);

  const rows = useMemo<ServiceAreaRow[]>(() => {
    const result: ServiceAreaRow[] = [];
    Object.entries(registry).forEach(([registryBarangayKey, barangayRecord]) => {
      const official = findOfficialBarangay(barangayRecord.barangay || registryBarangayKey);
      const barangay = official?.name || barangayRecord.barangay || registryBarangayKey;
      const barangayKey = makeBarangayKey(barangay);
      Object.entries(barangayRecord.puroks || {}).forEach(([registryPurokKey, record]) => {
        const purok = normalizePurokLabel(record.purok || registryPurokKey.replace(/_/g, " "));
        if (!purok) return;
        const purokKey = makePurokKey(purok);
        result.push({ ...record, id: `${barangayKey}|${purokKey}`, barangay, barangayKey, psgcCode: official?.psgcCode || barangayRecord.psgcCode || "", purok, purokKey });
      });
    });
    return result.sort((a, b) => a.barangay.localeCompare(b.barangay) || Number(a.purok.match(/\d+/)?.[0] || 0) - Number(b.purok.match(/\d+/)?.[0] || 0));
  }, [registry]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? rows.filter((row) => `${row.barangay} ${row.purok}`.toLowerCase().includes(query)) : rows;
  }, [rows, search]);

  const filteredBarangays = useMemo(() => {
    const query = barangayQuery.trim().toLowerCase();
    return query ? OFFICIAL_CATBALOGAN_BARANGAYS.filter((item) => item.name.toLowerCase().includes(query)) : OFFICIAL_CATBALOGAN_BARANGAYS;
  }, [barangayQuery]);

  const detectedByBarangay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    rows.forEach((row) => {
      if (!map.has(row.barangayKey)) map.set(row.barangayKey, new Set());
      map.get(row.barangayKey)!.add(row.purok);
    });
    Object.values(residents).forEach((resident) => {
      const barangay = recordBarangay(resident);
      const purok = recordPurok(resident);
      if (!barangay || !purok) return;
      const key = makeBarangayKey(barangay);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(purok);
    });
    return map;
  }, [rows, residents]);

  const activeRows = useMemo(() => rows.filter((row) => row.active !== false), [rows]);
  const activeBarangays = useMemo(() => new Set(activeRows.map((row) => row.barangayKey)).size, [activeRows]);
  const combinationCount = useMemo(() => selectedBarangays.reduce((sum, barangay) => sum + (selectedByBarangay[makeBarangayKey(barangay)]?.length || 0), 0), [selectedBarangays, selectedByBarangay]);

  const toggleBarangay = (barangay: string) => {
    const key = makeBarangayKey(barangay);
    setSelectedBarangays((current) => {
      if (current.includes(barangay)) {
        setSelectedByBarangay((state) => { const next = { ...state }; delete next[key]; return next; });
        setPurokInputs((state) => { const next = { ...state }; delete next[key]; return next; });
        return current.filter((item) => item !== barangay);
      }
      return [...current, barangay];
    });
  };

  const togglePurok = (barangay: string, purok: string) => {
    const key = makeBarangayKey(barangay);
    setSelectedByBarangay((current) => {
      const values = current[key] || [];
      return { ...current, [key]: values.includes(purok) ? values.filter((item) => item !== purok) : sortPuroks([...values, purok]) };
    });
  };

  const addTypedPuroks = (barangay: string) => {
    const key = makeBarangayKey(barangay);
    const parsed = parsePurokInput(purokInputs[key] || "");
    if (!parsed.length) return alert("Enter an actual Purok number, for example 1, 2, 4-8.");
    setSelectedByBarangay((current) => ({ ...current, [key]: sortPuroks([...(current[key] || []), ...parsed]) }));
    setPurokInputs((current) => ({ ...current, [key]: "" }));
  };

  const addServiceAreas = async () => {
    if (!selectedBarangays.length) return alert("Select at least one Barangay.");
    if (!combinationCount) return alert("Add the actual Purok numbers for the selected Barangay first.");

    const now = Date.now();
    const addedBy = auth.currentUser?.uid || "admin";
    const writes: Record<string, unknown> = {};
    let addedCount = 0;
    let skippedCount = 0;

    selectedBarangays.forEach((barangay) => {
      const official = findOfficialBarangay(barangay);
      if (!official) return;
      const selectedPuroks = selectedByBarangay[official.barangayKey] || [];
      const newPuroks = selectedPuroks.filter((purok) => {
        const existing = registry[official.barangayKey]?.puroks?.[makePurokKey(purok)];
        if (existing && existing.active !== false) { skippedCount += 1; return false; }
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
      writes[`${basePath}/active`] = true;
      writes[`${basePath}/updatedAt`] = now;

      newPuroks.forEach((purok) => {
        const purokKey = makePurokKey(purok);
        if (!purokKey) return;
        const existing = registry[official.barangayKey]?.puroks?.[purokKey];
        const areaPath = `${basePath}/puroks/${purokKey}`;
        writes[`${areaPath}/purok`] = purok;
        writes[`${areaPath}/purokKey`] = purokKey;
        writes[`${areaPath}/configured`] = true;
        writes[`${areaPath}/active`] = true;
        writes[`${areaPath}/source`] = "admin-confirmed-local-purok";
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

    if (!addedCount) return alert("All selected Barangay/Purok entries are already active.");
    writes["service_area_catalog/updatedAt"] = now;
    writes["service_area_catalog/updatedBy"] = addedBy;
    writes["service_area_catalog/psgcSource"] = CATBALOGAN_PSGC_SOURCE;
    writes["service_area_catalog/boundarySource"] = CATBALOGAN_BOUNDARY_SOURCE;

    try {
      setSaving(true);
      await update(ref(db), writes);
      setNotice(`${addedCount} actual service area${addedCount === 1 ? "" : "s"} added${skippedCount ? ` • ${skippedCount} already existed` : ""}. Route Assignment and Schedule Setup will use these exact Puroks.`);
      setSelectedBarangays([]);
      setSelectedByBarangay({});
      setPurokInputs({});
      setBarangayPickerOpen(false);
    } catch (error) {
      console.error(error);
      alert("Unable to add the service areas. Check Firebase permissions and try again.");
    } finally {
      setSaving(false);
    }
  };

  const areaIsInUse = (row: ServiceAreaRow) => [...Object.values(routes), ...Object.values(schedules)].some((record) =>
    !["cancelled", "canceled", "inactive", "archived", "completed"].includes(String(record.status || "active").toLowerCase()) && recordUsesArea(record, row.id));

  const setActive = async (row: ServiceAreaRow, active: boolean) => {
    if (!active) {
      if (areaIsInUse(row)) return alert("This Barangay/Purok is used by an active route or schedule. Reassign it first.");
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
    if (areaIsInUse(row)) return alert("This Barangay/Purok is still used by an active route or schedule. Reassign it before deleting it.");
    if (!window.confirm(`Permanently delete ${row.barangay}, ${row.purok}?`)) return;
    const remaining = Object.keys(registry[row.barangayKey]?.puroks || {}).filter((key) => key !== row.purokKey);
    const writes: Record<string, unknown> = {
      [`purok_registry/${row.barangayKey}/${row.purokKey}`]: null,
      [`purok_locations/${row.barangayKey}/${row.purokKey}`]: null,
      "service_area_catalog/updatedAt": Date.now(),
    };
    if (remaining.length === 0) writes[`service_areas/${row.barangayKey}`] = null;
    else writes[`service_areas/${row.barangayKey}/puroks/${row.purokKey}`] = null;
    try { await update(ref(db), writes); setNotice(`${row.barangay}, ${row.purok} was permanently deleted.`); }
    catch (error) { console.error(error); alert("Unable to delete this service area."); }
  };

  return (
    <DashboardShell title="Barangays & Puroks" description="Maintain the real local service coverage used by Route Assignment and Schedule Setup.">
      <main className="areas-real-page">
        {notice && <div className="area-notice"><span>✓ {notice}</span><button type="button" onClick={() => setNotice("")}>×</button></div>}

        <section className="area-hero">
          <div><span>LOCAL SERVICE AREA REGISTRY</span><h1>Use the actual Puroks in each Barangay</h1><p>MetroWaste no longer assumes every Barangay has Purok 1–10. Select a Barangay, then confirm only the Purok numbers that really exist in your local records. No map pin is required.</p></div>
          <div className="area-hero-badge"><strong>{activeRows.length}</strong><span>active actual Puroks</span></div>
        </section>

        <section className="area-stats"><div><strong>{activeBarangays}</strong><span>Active Barangays</span></div><div><strong>{activeRows.length}</strong><span>Active Puroks</span></div><div><strong>{rows.length}</strong><span>Configured areas</span></div></section>

        <section className="actual-area-builder">
          <header><div><span>SERVICE AREA SETUP</span><h2>Add exact Barangay/Purok coverage</h2><p>Detected Puroks come from existing resident/service-area records. You can also enter the correct local Purok numbers manually.</p></div><div className="selection-total"><strong>{combinationCount}</strong><span>areas ready</span></div></header>
          <div className="actual-builder-grid">
            <section className="selection-panel" ref={barangayPickerRef}>
              <div className="selection-heading"><b>1</b><div><h3>Choose Barangays</h3><p>Select one or several official Catbalogan Barangays.</p></div></div>
              <button className={`multi-picker-trigger ${selectedBarangays.length ? "has-value" : ""}`} type="button" onClick={() => setBarangayPickerOpen((open) => !open)}><span>{selectedBarangays.length ? `${selectedBarangays.length} Barangay${selectedBarangays.length === 1 ? "" : "s"} selected` : "Select Barangays"}</span><b>⌄</b></button>
              {barangayPickerOpen && <div className="barangay-menu"><div className="barangay-menu-head"><input autoFocus type="search" value={barangayQuery} onChange={(event) => setBarangayQuery(event.target.value)} placeholder="Search Barangay"/><button type="button" onClick={() => { setSelectedBarangays([]); setSelectedByBarangay({}); }}>Clear</button></div><div className="barangay-menu-list">{filteredBarangays.map((item) => { const selected = selectedBarangays.includes(item.name); return <button type="button" className={selected ? "selected" : ""} key={item.psgcCode} onClick={() => toggleBarangay(item.name)}><i>{selected ? "✓" : ""}</i><span>{item.name}</span></button>; })}</div><button className="barangay-menu-done" type="button" onClick={() => setBarangayPickerOpen(false)}>Done</button></div>}
              <div className="selected-area-chips">{selectedBarangays.length ? selectedBarangays.map((barangay) => <button type="button" key={barangay} onClick={() => toggleBarangay(barangay)}>{barangay}<span>×</span></button>) : <p>No Barangay selected.</p>}</div>
            </section>

            <section className="purok-per-barangay-panel">
              <div className="selection-heading"><b>2</b><div><h3>Confirm real Puroks</h3><p>Each selected Barangay has its own Purok list. Nothing is auto-created as Purok 1–10.</p></div></div>
              {!selectedBarangays.length ? <div className="purok-empty">Select a Barangay first.</div> : <div className="purok-editor-list">{selectedBarangays.map((barangay) => {
                const key = makeBarangayKey(barangay);
                const detected = sortPuroks([...(detectedByBarangay.get(key) || [])]);
                const selected = selectedByBarangay[key] || [];
                return <article className="purok-editor" key={key}><div className="purok-editor-head"><div><strong>{barangay}</strong><small>{selected.length} Purok{selected.length === 1 ? "" : "s"} selected</small></div>{detected.length > 0 && <button type="button" onClick={() => setSelectedByBarangay((current) => ({ ...current, [key]: detected }))}>Use detected</button>}</div>
                  {detected.length > 0 && <div className="detected-wrap"><small>Detected in current records</small><div className="detected-chips">{detected.map((purok) => <button type="button" className={selected.includes(purok) ? "selected" : ""} key={purok} onClick={() => togglePurok(barangay, purok)}>{selected.includes(purok) ? "✓" : "+"} {purok}</button>)}</div></div>}
                  <div className="purok-entry"><input value={purokInputs[key] || ""} onChange={(event) => setPurokInputs((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTypedPuroks(barangay); } }} placeholder="Example: 1,2,3 or 1-8"/><button type="button" onClick={() => addTypedPuroks(barangay)}>Add Puroks</button></div>
                  <div className="chosen-puroks">{selected.length ? selected.map((purok) => <button type="button" key={purok} onClick={() => togglePurok(barangay, purok)}>{purok}<span>×</span></button>) : <span>No Puroks confirmed yet.</span>}</div>
                </article>;
              })}</div>}
            </section>
          </div>
          <footer><div><strong>{combinationCount} exact service area{combinationCount === 1 ? "" : "s"}</strong><span>Barangay/Purok coverage only — no Purok pin or latitude/longitude entry.</span></div><button disabled={saving || !combinationCount} type="button" onClick={() => void addServiceAreas()}>{saving ? "Saving…" : `＋ Save ${combinationCount || "selected"} areas`}</button></footer>
        </section>

        <section className="actual-area-table-card">
          <header><div><h2>Configured local service areas</h2><p>These exact Puroks are the choices used by Route Assignment and Schedule Setup.</p></div><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Barangay or Purok"/></header>
          <div className="actual-table-wrap"><table><thead><tr><th>Barangay</th><th>Actual Purok</th><th>Source</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id}><td><strong>{row.barangay}</strong></td><td><b>{row.purok}</b></td><td><span className="local-source">Local registry</span></td><td><span className={row.active !== false ? "row-status active" : "row-status inactive"}>{row.active !== false ? "Active" : "Inactive"}</span></td><td><div className="service-area-actions"><button className={row.active !== false ? "deactivate" : "activate"} onClick={() => void setActive(row, row.active === false)}>{row.active !== false ? "Deactivate" : "Activate"}</button><button className="delete-area" onClick={() => void deleteServiceArea(row)}>Delete</button></div></td></tr>) : <tr><td colSpan={5} className="empty-row">No service areas configured yet.</td></tr>}</tbody></table></div>
        </section>
      </main>

      <style jsx global>{`
        .areas-real-page{width:min(1320px,100%);margin:0 auto;display:grid;gap:16px;color:#172a20}.area-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:1px solid #a7dfbd;border-radius:12px;background:#f0fdf4;color:#166534}.area-notice button{border:0;background:transparent;font-size:20px;cursor:pointer}.area-hero{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:23px 24px;border:1px solid #d9e5dd;border-radius:22px;background:radial-gradient(circle at 90% 20%,rgba(34,197,94,.1),transparent 28%),linear-gradient(120deg,#fff,#f3faf5);box-shadow:0 10px 28px rgba(16,35,27,.05)}.area-hero>div:first-child{max-width:880px}.area-hero>div:first-child>span,.actual-area-builder>header>div:first-child>span{color:#168a4a;font-size:10px;font-weight:950;letter-spacing:.1em}.area-hero h1{margin:6px 0 0;font-size:31px;letter-spacing:-.04em}.area-hero p{margin:8px 0 0;color:#617269;font-size:13px;line-height:1.55}.area-hero-badge{min-width:150px;padding:14px;border:1px solid #cce5d5;border-radius:16px;background:#fff;text-align:center}.area-hero-badge strong,.area-hero-badge span{display:block}.area-hero-badge strong{color:#168a4a;font-size:29px}.area-hero-badge span{margin-top:3px;color:#687970;font-size:10px;font-weight:850}.area-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.area-stats div{display:flex;align-items:center;gap:12px;padding:15px 17px;border:1px solid #dce7e0;border-radius:14px;background:#fff}.area-stats strong{font-size:25px;color:#168a4a}.area-stats span{color:#607269;font-size:11px;font-weight:850}
        .actual-area-builder,.actual-area-table-card{border:1px solid #dce7e0;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(16,35,27,.045)}.actual-area-builder>header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:19px 20px;border-bottom:1px solid #e5ece8}.actual-area-builder h2,.actual-area-builder p,.selection-panel h3,.selection-panel p,.purok-per-barangay-panel h3,.purok-per-barangay-panel p{margin:0}.actual-area-builder h2{margin-top:4px}.actual-area-builder p,.selection-panel p,.purok-per-barangay-panel p{margin-top:4px;color:#718078;font-size:11px}.selection-total{min-width:96px;display:grid;place-items:center;padding:10px 14px;border-radius:12px;background:#eaf7ef;color:#137744}.selection-total strong{font-size:24px}.selection-total span{font-size:9px;font-weight:900}.actual-builder-grid{display:grid;grid-template-columns:.78fr 1.22fr;gap:15px;padding:18px}.selection-panel,.purok-per-barangay-panel{position:relative;display:grid;align-content:start;gap:12px;padding:15px;border:1px solid #dce7e0;border-radius:14px;background:#fbfdfc}.selection-heading{display:flex;align-items:flex-start;gap:10px}.selection-heading>b{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;border-radius:50%;background:#e5f6ec;color:#137744}.multi-picker-trigger{min-height:46px;display:flex;align-items:center;justify-content:space-between;border:1px solid #cad9d0;border-radius:10px;padding:0 13px;background:#fff;color:#5e7066;font-weight:800;cursor:pointer}.multi-picker-trigger.has-value{border-color:#168a4a;color:#173a28;box-shadow:0 0 0 3px rgba(22,138,74,.08)}.barangay-menu{position:absolute;z-index:60;top:112px;left:15px;right:15px;overflow:hidden;border:1px solid #cbdad1;border-radius:13px;background:#fff;box-shadow:0 18px 42px rgba(20,46,31,.18)}.barangay-menu-head{display:flex;gap:8px;padding:10px;border-bottom:1px solid #e5ece8}.barangay-menu-head input{min-height:39px;flex:1;border:1px solid #cedbd3;border-radius:9px;padding:0 11px}.barangay-menu-head button{border:0;background:transparent;color:#b42318;font-weight:800;cursor:pointer}.barangay-menu-list{max-height:260px;overflow:auto;padding:6px}.barangay-menu-list button{width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:8px;padding:9px;background:#fff;text-align:left;cursor:pointer}.barangay-menu-list button:hover{background:#f3f8f5}.barangay-menu-list button.selected{background:#eaf7ef;color:#137744;font-weight:800}.barangay-menu-list i{width:20px;height:20px;display:grid;place-items:center;border:1px solid #bfcec5;border-radius:6px;font-style:normal}.barangay-menu-list button.selected i{border-color:#168a4a;background:#168a4a;color:#fff}.barangay-menu-done{width:calc(100% - 16px);min-height:39px;margin:0 8px 8px;border:1px solid #168a4a;border-radius:9px;background:#168a4a;color:#fff;font-weight:850}.selected-area-chips{display:flex;flex-wrap:wrap;gap:7px;min-height:30px}.selected-area-chips>button,.chosen-puroks>button{display:flex;align-items:center;gap:6px;border:1px solid #b9ddc7;border-radius:999px;padding:6px 9px;background:#effaf3;color:#166b40;font-size:10px;font-weight:800;cursor:pointer}.selected-area-chips p{margin:0;align-self:center}.purok-editor-list{display:grid;gap:10px;max-height:520px;overflow:auto;padding-right:3px}.purok-editor{display:grid;gap:10px;padding:12px;border:1px solid #e0e8e3;border-radius:13px;background:#fff}.purok-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.purok-editor-head strong,.purok-editor-head small{display:block}.purok-editor-head strong{font-size:13px;color:#173227}.purok-editor-head small{margin-top:2px;color:#718078;font-size:9px}.purok-editor-head>button{border:0;border-radius:8px;padding:7px 9px;background:#eaf7ef;color:#137744;font-size:9px;font-weight:900;cursor:pointer}.detected-wrap>small{display:block;margin-bottom:6px;color:#75867c;font-size:9px;font-weight:850;text-transform:uppercase}.detected-chips,.chosen-puroks{display:flex;flex-wrap:wrap;gap:6px}.detected-chips button{border:1px solid #d7e2db;border-radius:9px;padding:6px 8px;background:#f8faf9;color:#596b61;font-size:9px;font-weight:850;cursor:pointer}.detected-chips button.selected{border-color:#168a4a;background:#eaf7ef;color:#137744}.purok-entry{display:grid;grid-template-columns:1fr auto;gap:7px}.purok-entry input{height:39px;border:1px solid #ccd9d1;border-radius:9px;padding:0 10px}.purok-entry button{border:1px solid #168a4a;border-radius:9px;padding:0 11px;background:#fff;color:#137744;font-size:10px;font-weight:900;cursor:pointer}.chosen-puroks>span,.purok-empty{padding:12px;border:1px dashed #cbd8d0;border-radius:10px;color:#718078;font-size:10px;text-align:center}.actual-area-builder>footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 20px;border-top:1px solid #e5ece8;background:#f8fbf9;border-radius:0 0 18px 18px}.actual-area-builder>footer>div{display:grid;gap:3px}.actual-area-builder>footer span{color:#718078;font-size:10px}.actual-area-builder>footer button{min-height:42px;border:1px solid #168a4a;border-radius:10px;padding:0 17px;background:#168a4a;color:#fff;font-weight:900;cursor:pointer}.actual-area-builder>footer button:disabled{border-color:#bdcbc2;background:#dce5df;color:#718078;cursor:not-allowed}
        .actual-area-table-card{overflow:hidden}.actual-area-table-card>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 19px;border-bottom:1px solid #e5ece8}.actual-area-table-card h2,.actual-area-table-card p{margin:0}.actual-area-table-card h2{font-size:17px}.actual-area-table-card p{margin-top:4px;color:#718078;font-size:10px}.actual-area-table-card input{width:min(290px,100%);min-height:41px;border:1px solid #cad9d0;border-radius:10px;padding:0 11px}.actual-table-wrap{overflow:auto}.actual-area-table-card table{width:100%;border-collapse:collapse}.actual-area-table-card th,.actual-area-table-card td{padding:12px 14px;border-bottom:1px solid #e8eeea;text-align:left;font-size:11px}.actual-area-table-card th{background:#f8fbf9;color:#607269;font-size:9px;text-transform:uppercase;letter-spacing:.06em}.local-source{display:inline-flex;padding:5px 7px;border-radius:999px;background:#edf5ff;color:#245caa;font-size:9px;font-weight:850}.row-status{display:inline-flex;border-radius:999px;padding:5px 8px;font-weight:850}.row-status.active{background:#e8f7ee;color:#137744}.row-status.inactive{background:#f1f3f2;color:#66736d}.service-area-actions{display:flex;gap:7px}.service-area-actions button{border:1px solid #d4dfd8;border-radius:8px;padding:6px 9px;background:#fff;font-size:10px;font-weight:800;cursor:pointer}.service-area-actions .deactivate{color:#b45309}.service-area-actions .activate{color:#137744}.service-area-actions .delete-area{border-color:#fecaca;background:#fff7f7;color:#b42318}.empty-row{text-align:center!important;padding:26px!important;color:#718078}
        @media(max-width:900px){.area-hero,.actual-area-builder>header,.actual-area-builder>footer,.actual-area-table-card>header{align-items:stretch;flex-direction:column}.area-hero-badge{width:100%}.area-stats,.actual-builder-grid{grid-template-columns:1fr}.selection-total{justify-self:start}.actual-area-table-card input{width:100%}}@media(max-width:600px){.area-stats{grid-template-columns:1fr}.purok-entry{grid-template-columns:1fr}.purok-entry button{min-height:39px}.service-area-actions{flex-direction:column}}
      `}</style>
    </DashboardShell>
  );
}
