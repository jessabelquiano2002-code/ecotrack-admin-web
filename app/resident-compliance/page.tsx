"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, remove, set, update } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type OnboardingRecord = {
  status?: string;
  currentVersion?: number | string;
  advertisementStatus?: string;
  videoStatus?: string;
  rulesStatus?: string;
  completedAt?: number;
  skippedAt?: number;
  updatedAt?: number;
};

type Resident = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  fname?: string;
  lname?: string;
  email?: string;
  barangay?: string;
  purok?: string | number;
  onboarding?: OnboardingRecord;
};

type Violation = {
  id: string;
  residentId: string;
  residentName?: string;
  violation?: string;
  penalty?: string;
  status?: string;
  notes?: string;
  issuedAt?: number;
  updatedAt?: number;
};

type ViolationForm = {
  residentId: string;
  residentName: string;
  violation: string;
  penalty: string;
  status: string;
  notes: string;
};

const EMPTY_VIOLATION: ViolationForm = {
  residentId: "",
  residentName: "",
  violation: "",
  penalty: "",
  status: "Recorded",
  notes: "",
};

const STATUS_OPTIONS = ["Recorded", "Under Review", "Issued", "Paid", "Resolved", "Dismissed"];

const getResidentName = (resident: Resident) => {
  const assembled = [resident.firstName || resident.fname, resident.lastName || resident.lname]
    .filter(Boolean)
    .join(" ");
  return resident.name || assembled || resident.email || `Resident ${resident.id.slice(0, 8)}`;
};

const formatDate = (value?: number) => {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizedStatus = (value?: string) => (value || "pending").toLowerCase();

function latestRecord(value: unknown, activeVersion: string): OnboardingRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const records = value as Record<string, OnboardingRecord>;
  if (records[activeVersion]) return records[activeVersion];
  if ("status" in records) return records as unknown as OnboardingRecord;
  const versions = Object.keys(records).sort((a, b) => Number(b) - Number(a));
  return versions.length ? records[versions[0]] : undefined;
}

export default function ResidentCompliancePage() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [onboarding, setOnboarding] = useState<Record<string, unknown>>({});
  const [violations, setViolations] = useState<Violation[]>([]);
  const [activeVersion, setActiveVersion] = useState("1");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState<"onboarding" | "violations">("onboarding");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Violation | null>(null);
  const [form, setForm] = useState<ViolationForm>(EMPTY_VIOLATION);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => onValue(ref(db, "residents"), (snapshot) => {
    const value = snapshot.val() || {};
    setResidents(Object.entries(value).map(([id, data]) => ({ id, ...(data as Omit<Resident, "id">) })));
  }), []);

  useEffect(() => onValue(ref(db, "residentOnboarding"), (snapshot) => {
    setOnboarding(snapshot.val() || {});
  }), []);

  useEffect(() => onValue(ref(db, "onboarding/config/activeVersion"), (snapshot) => {
    setActiveVersion(String(snapshot.val() || 1));
  }), []);

  useEffect(() => onValue(ref(db, "residentViolations"), (snapshot) => {
    const rows: Violation[] = [];
    snapshot.forEach((residentNode) => {
      residentNode.forEach((item) => {
        rows.push({
          id: item.key || "",
          residentId: residentNode.key || "",
          ...(item.val() as Omit<Violation, "id" | "residentId">),
        });
      });
    });
    rows.sort((a, b) => (b.updatedAt || b.issuedAt || 0) - (a.updatedAt || a.issuedAt || 0));
    setViolations(rows);
  }), []);

  const residentRows = useMemo(() => residents.map((resident) => ({
    ...resident,
    onboarding: latestRecord(onboarding[resident.id], activeVersion) || resident.onboarding,
  })), [residents, onboarding, activeVersion]);

  const stats = useMemo(() => {
    const completed = residentRows.filter((row) => normalizedStatus(row.onboarding?.status) === "completed").length;
    const skipped = residentRows.filter((row) => normalizedStatus(row.onboarding?.status) === "skipped").length;
    const pending = Math.max(0, residentRows.length - completed - skipped);
    const acknowledged = residentRows.filter((row) => normalizedStatus(row.onboarding?.rulesStatus) === "acknowledged").length;
    return { completed, skipped, pending, acknowledged };
  }, [residentRows]);

  const filteredResidents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return residentRows.filter((resident) => {
      const status = normalizedStatus(resident.onboarding?.status);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!needle) return true;
      return `${getResidentName(resident)} ${resident.email || ""} ${resident.barangay || ""} ${resident.purok || ""}`
        .toLowerCase().includes(needle);
    });
  }, [residentRows, query, statusFilter]);

  const filteredViolations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return violations;
    return violations.filter((row) => `${row.residentName || ""} ${row.violation || ""} ${row.penalty || ""} ${row.status || ""}`
      .toLowerCase().includes(needle));
  }, [violations, query]);

  const openCreate = (resident?: Resident) => {
    setEditing(null);
    setForm({
      ...EMPTY_VIOLATION,
      residentId: resident?.id || "",
      residentName: resident ? getResidentName(resident) : "",
    });
    setShowForm(true);
  };

  const openEdit = (row: Violation) => {
    setEditing(row);
    setForm({
      residentId: row.residentId,
      residentName: row.residentName || "",
      violation: row.violation || "",
      penalty: row.penalty || "",
      status: row.status || "Recorded",
      notes: row.notes || "",
    });
    setShowForm(true);
  };

  const chooseResident = (residentId: string) => {
    const resident = residents.find((row) => row.id === residentId);
    setForm({ ...form, residentId, residentName: resident ? getResidentName(resident) : "" });
  };

  const saveViolation = async () => {
    if (!form.residentId || !form.violation.trim()) {
      alert("Select a resident and enter the violation.");
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const target = editing
        ? ref(db, `residentViolations/${form.residentId}/${editing.id}`)
        : push(ref(db, `residentViolations/${form.residentId}`));
      await set(target, {
        residentName: form.residentName,
        violation: form.violation.trim(),
        penalty: form.penalty.trim(),
        status: form.status,
        notes: form.notes.trim(),
        issuedAt: editing?.issuedAt || now,
        updatedAt: now,
      });
      if (editing && editing.residentId !== form.residentId) {
        await remove(ref(db, `residentViolations/${editing.residentId}/${editing.id}`));
      }
      setNotice(editing ? "Violation record updated." : "Violation record created.");
      setShowForm(false);
    } catch (error) {
      console.error(error);
      alert("Unable to save the violation record.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (row: Violation, status: string) => {
    await update(ref(db, `residentViolations/${row.residentId}/${row.id}`), { status, updatedAt: Date.now() });
    setNotice("Violation status updated.");
  };

  const deleteViolation = async (row: Violation) => {
    if (!window.confirm("Delete this resident violation record?")) return;
    await remove(ref(db, `residentViolations/${row.residentId}/${row.id}`));
    setNotice("Violation record deleted.");
  };

  return (
    <DashboardShell title="Resident Compliance" description="Onboarding engagement and resident violation management" hidePageHeader>
      <main className="page">
        <section className="hero">
          <div><span className="eyebrow">Resident governance</span><h1>Resident Compliance</h1>
            <p>Monitor onboarding engagement and maintain an accountable history of waste violations.</p></div>
          <div className="version"><small>Current onboarding version</small><strong>Version {activeVersion}</strong></div>
        </section>

        {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        <section className="stats">
          <article><span>Total residents</span><strong>{residentRows.length}</strong><small>Registered accounts</small></article>
          <article><span>Completed</span><strong>{stats.completed}</strong><small>Current version</small></article>
          <article><span>Skipped</span><strong>{stats.skipped}</strong><small>Optional content</small></article>
          <article><span>Pending review</span><strong>{stats.pending}</strong><small>Requires follow-up</small></article>
          <article><span>Rules acknowledged</span><strong>{stats.acknowledged}</strong><small>Explicit consent</small></article>
        </section>

        <section className="workspace">
          <div className="toolbar">
            <div className="tabs">
              <button className={tab === "onboarding" ? "active" : ""} onClick={() => setTab("onboarding")}>Onboarding records</button>
              <button className={tab === "violations" ? "active" : ""} onClick={() => setTab("violations")}>Resident violations</button>
            </div>
            <div className="tools">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search residents or records" />
              {tab === "onboarding" && <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option><option value="completed">Completed</option>
                <option value="skipped">Skipped</option><option value="pending">Pending</option>
              </select>}
              {tab === "violations" && <button className="primary" onClick={() => openCreate()}>+ Add violation</button>}
            </div>
          </div>

          <div className="tableWrap">
            {tab === "onboarding" ? (
              <table><thead><tr><th>Resident</th><th>Location</th><th>Overall</th><th>Advertisements</th><th>Video</th><th>Rules & penalties</th><th>Last activity</th><th /></tr></thead>
                <tbody>{filteredResidents.map((resident) => {
                  const record = resident.onboarding;
                  const status = normalizedStatus(record?.status);
                  return <tr key={resident.id}>
                    <td><strong>{getResidentName(resident)}</strong><small>{resident.email || resident.id}</small></td>
                    <td>{resident.barangay || "Not set"}<small>{resident.purok ? `Purok ${String(resident.purok).replace(/purok/i, "").trim()}` : "No purok"}</small></td>
                    <td><span className={`pill ${status}`}>{status}</span><small>v{record?.currentVersion || activeVersion}</small></td>
                    <td><span className="sectionStatus">{record?.advertisementStatus || "Not viewed"}</span></td>
                    <td><span className="sectionStatus">{record?.videoStatus || "Not viewed"}</span></td>
                    <td><span className="sectionStatus">{record?.rulesStatus || "Not acknowledged"}</span></td>
                    <td>{formatDate(record?.completedAt || record?.skippedAt || record?.updatedAt)}</td>
                    <td><button className="link" onClick={() => openCreate(resident)}>Record violation</button></td>
                  </tr>;
                })}</tbody>
              </table>
            ) : (
              <table><thead><tr><th>Resident</th><th>Violation</th><th>Penalty</th><th>Status</th><th>Issued</th><th>Notes</th><th /></tr></thead>
                <tbody>{filteredViolations.map((row) => <tr key={`${row.residentId}-${row.id}`}>
                  <td><strong>{row.residentName || row.residentId}</strong><small>{row.residentId}</small></td>
                  <td>{row.violation || "—"}</td><td>{row.penalty || "Pending assessment"}</td>
                  <td><select className="inlineSelect" value={row.status || "Recorded"} onChange={(event) => updateStatus(row, event.target.value)}>
                    {STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></td>
                  <td>{formatDate(row.issuedAt)}</td><td className="notes">{row.notes || "—"}</td>
                  <td><div className="rowActions"><button className="link" onClick={() => openEdit(row)}>Edit</button><button className="danger" onClick={() => deleteViolation(row)}>Delete</button></div></td>
                </tr>)}</tbody>
              </table>
            )}
            {(tab === "onboarding" ? filteredResidents.length : filteredViolations.length) === 0 && <div className="empty">No matching records found.</div>}
          </div>
        </section>
      </main>

      {showForm && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}>
        <section className="modal"><header><div><span className="eyebrow">Compliance record</span><h2>{editing ? "Edit violation" : "Record violation"}</h2></div><button onClick={() => setShowForm(false)}>×</button></header>
          <div className="formGrid">
            <label><span>Resident *</span><select value={form.residentId} onChange={(event) => chooseResident(event.target.value)} disabled={Boolean(editing)}>
              <option value="">Select resident</option>{residents.map((resident) => <option key={resident.id} value={resident.id}>{getResidentName(resident)}</option>)}</select></label>
            <label><span>Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="wide"><span>Violation *</span><input value={form.violation} onChange={(event) => setForm({ ...form, violation: event.target.value })} placeholder="Example: Failure to segregate waste properly" /></label>
            <label className="wide"><span>Penalty or corrective action</span><input value={form.penalty} onChange={(event) => setForm({ ...form, penalty: event.target.value })} placeholder="Fine, warning, community service, or required seminar" /></label>
            <label className="wide"><span>Administrative notes</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Evidence, incident location, schedule, or resolution details" /></label>
          </div>
          <footer><button className="secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="primary" onClick={saveViolation} disabled={saving}>{saving ? "Saving…" : "Save record"}</button></footer>
        </section>
      </div>}

      <style jsx>{`
        .page{padding:30px;background:#f5f7f8;min-height:100vh;color:#17201d}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:30px;border-radius:24px;background:linear-gradient(135deg,#073b2c,#0b654a);color:white;box-shadow:0 18px 45px rgba(7,59,44,.18)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.16em;font-weight:800;color:#7dd3ac}.hero h1,.modal h2{margin:6px 0 8px;font-size:32px}.hero p{margin:0;color:#d8eee6;max-width:650px}.version{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);padding:16px 20px;border-radius:16px;min-width:190px}.version small,.version strong{display:block}.version strong{margin-top:5px;font-size:20px}.notice{display:flex;justify-content:space-between;margin:16px 0 0;padding:13px 16px;border-radius:12px;background:#e8f7ef;color:#12623f;font-weight:700}.notice button{border:0;background:none;font-size:20px;color:inherit}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:18px 0}.stats article{background:white;border:1px solid #e4e9e7;border-radius:17px;padding:18px;box-shadow:0 8px 24px rgba(19,45,36,.04)}.stats span,.stats small{display:block;color:#718078}.stats strong{display:block;font-size:28px;margin:7px 0}.workspace{background:white;border:1px solid #e3e9e6;border-radius:20px;overflow:hidden}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px;border-bottom:1px solid #e7ece9}.tabs{display:flex;background:#f0f4f2;border-radius:12px;padding:4px}.tabs button{border:0;background:none;padding:10px 14px;border-radius:9px;font-weight:800;color:#68766f}.tabs button.active{background:white;color:#0b654a;box-shadow:0 3px 12px rgba(20,53,42,.09)}.tools{display:flex;gap:10px}.tools input,.tools select,.formGrid input,.formGrid select,.formGrid textarea,.inlineSelect{border:1px solid #d8e0dc;border-radius:10px;padding:11px 12px;background:white;color:#17201d}.tools input{min-width:260px}.primary,.secondary{border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}.primary{border:1px solid #0b654a;background:#0b654a;color:white}.secondary{border:1px solid #ccd7d1;background:white}.tableWrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:1050px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#748078;background:#fafcfb}th,td{padding:14px 16px;border-bottom:1px solid #edf1ef;vertical-align:top}td{font-size:13px}td strong,td small{display:block}td small{color:#849089;margin-top:4px}.pill{display:inline-block;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:900;text-transform:capitalize}.pill.completed{background:#dcf6e8;color:#12623f}.pill.skipped{background:#fff0d8;color:#9a5b05}.pill.pending{background:#edf0ef;color:#66736c}.sectionStatus{text-transform:capitalize;font-weight:700;color:#46534d}.link,.danger{border:0;background:none;padding:4px;color:#0b654a;font-weight:800;cursor:pointer}.danger{color:#c23a3a}.rowActions{display:flex;gap:8px}.inlineSelect{padding:7px 8px;min-width:125px}.notes{max-width:220px}.empty{text-align:center;padding:42px;color:#7a8780}.overlay{position:fixed;inset:0;background:rgba(7,22,17,.58);display:grid;place-items:center;padding:20px;z-index:90}.modal{width:min(680px,100%);background:white;border-radius:22px;box-shadow:0 25px 80px rgba(0,0,0,.28);overflow:hidden}.modal header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px;border-bottom:1px solid #e9eeeb}.modal h2{font-size:25px;color:#17201d}.modal header button{border:0;background:#eff3f1;width:36px;height:36px;border-radius:50%;font-size:22px}.formGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:24px}.formGrid label span{display:block;margin-bottom:7px;font-size:12px;font-weight:800;color:#5f6d66}.formGrid input,.formGrid select,.formGrid textarea{width:100%;box-sizing:border-box}.formGrid textarea{min-height:105px;resize:vertical}.formGrid .wide{grid-column:1/-1}.modal footer{display:flex;justify-content:flex-end;gap:10px;padding:18px 24px;background:#f8faf9}@media(max-width:1100px){.stats{grid-template-columns:repeat(3,1fr)}.toolbar{align-items:stretch;flex-direction:column}.tools{flex-wrap:wrap}}@media(max-width:720px){.page{padding:16px}.hero{align-items:flex-start;flex-direction:column;padding:22px}.stats{grid-template-columns:1fr 1fr}.tools{flex-direction:column}.tools input{min-width:0}.formGrid{grid-template-columns:1fr}.formGrid .wide{grid-column:auto}.tabs{overflow:auto}}
      `}</style>
    </DashboardShell>
  );
}
