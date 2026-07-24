"use client";

import { onValue, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../../lib/firebase";

type PurokRegistryRecord = {
  name?: string;
  label?: string;
  active?: boolean;
  verified?: boolean;
  lat?: number;
  lng?: number;
  sourceType?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  verifiedAt?: number;
};

type PurokLocationRecord = {
  purok?: string;
  verified?: boolean;
  lat?: number;
  lng?: number;
  source?: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

type ResidentRecord = {
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  purokLabel?: string;
};

type RouteRecord = {
  barangays?: string[] | Record<string, string | boolean>;
  puroks?: string[] | Record<string, string | boolean>;
};

type AvailablePurok = {
  name: string;
  verified: boolean;
  sourceType: string;
  sourceLabel: string;
  sourceUrl?: string;
};

type Props = {
  barangays: readonly string[];
  barangay: string;
  selectedPuroks: string[];
  mappedPuroks: string[];
  verifiedPuroks: string[];
  locatingPuroks: Record<string, boolean>;
  locationNotice?: string;
  onBarangayChange: (barangay: string) => void;
  onTogglePurok: (purok: string) => void;
  onLocateSelected: () => void | Promise<void>;
};

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) =>
        item === true
          ? key
          : typeof item === "string" || typeof item === "number"
            ? String(item)
            : "",
      )
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

function makePurokKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/purok/g, "")
    .replace(/[^a-z0-9ñ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_") || "unknown";
}

function normalizePurokName(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^purok\s+/i.test(raw)) return raw.replace(/^purok\s+/i, "Purok ");
  if (/^\d+[a-z-]*$/i.test(raw)) return `Purok ${raw}`;
  return raw;
}

function comparePuroks(left: string, right: string): number {
  const leftMatch = left.match(/purok\s+(\d+)/i);
  const rightMatch = right.match(/purok\s+(\d+)/i);
  const leftNumber = leftMatch ? Number(leftMatch[1]) : Number.MAX_SAFE_INTEGER;
  const rightNumber = rightMatch ? Number(rightMatch[1]) : Number.MAX_SAFE_INTEGER;
  return leftNumber - rightNumber || left.localeCompare(right, undefined, { numeric: true });
}

function googleMapsUrl(barangay: string, purok: string): string {
  const query = `${purok}, Barangay ${barangay}, Catbalogan City, Samar, Philippines`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function BarangayPurokPicker({
  barangays,
  barangay,
  selectedPuroks,
  mappedPuroks,
  verifiedPuroks,
  locatingPuroks,
  locationNotice,
  onBarangayChange,
  onTogglePurok,
  onLocateSelected,
}: Props) {
  const [registry, setRegistry] = useState<
    Record<string, Record<string, PurokRegistryRecord>>
  >({});
  const [savedPins, setSavedPins] = useState<
    Record<string, Record<string, PurokLocationRecord>>
  >({});
  const [residents, setResidents] = useState<Record<string, ResidentRecord>>({});
  const [routes, setRoutes] = useState<Record<string, RouteRecord>>({});

  useEffect(() => {
    const unsubscribeRegistry = onValue(ref(db, "purok_registry"), (snapshot) => {
      setRegistry(snapshot.val() || {});
    });

    const unsubscribePins = onValue(ref(db, "purok_locations"), (snapshot) => {
      setSavedPins(snapshot.val() || {});
    });

    const unsubscribeResidents = onValue(ref(db, "residents"), (snapshot) => {
      setResidents(snapshot.val() || {});
    });

    const unsubscribeRoutes = onValue(ref(db, "routes"), (snapshot) => {
      setRoutes(snapshot.val() || {});
    });

    return () => {
      unsubscribeRegistry();
      unsubscribePins();
      unsubscribeResidents();
      unsubscribeRoutes();
    };
  }, []);

  const availablePuroks = useMemo<AvailablePurok[]>(() => {
    if (!barangay) return [];

    const barangayKey = makeBarangayKey(barangay);
    const merged = new Map<string, AvailablePurok>();

    const add = (candidate: AvailablePurok) => {
      const name = normalizePurokName(candidate.name);
      if (!name) return;

      const key = makePurokKey(name);
      const current = merged.get(key);

      if (!current || (!current.verified && candidate.verified)) {
        merged.set(key, { ...candidate, name });
      }
    };

    Object.values(registry[barangayKey] || {}).forEach((record) => {
      if (record.active === false) return;
      const name = normalizePurokName(record.name || record.label);
      if (!name) return;

      add({
        name,
        verified: record.verified === true,
        sourceType: record.sourceType || "registry",
        sourceLabel:
          record.sourceLabel ||
          (record.verified ? "Verified Barangay/LGU registry" : "Purok registry"),
        sourceUrl: record.sourceUrl,
      });
    });

    Object.values(savedPins[barangayKey] || {}).forEach((record) => {
      const name = normalizePurokName(record.purok);
      if (!name) return;

      add({
        name,
        verified: record.verified === true,
        sourceType: record.source || "saved-map-pin",
        sourceLabel:
          record.sourceLabel ||
          (record.verified ? "Administrator-confirmed map pin" : "Saved map suggestion"),
        sourceUrl: record.sourceUrl,
      });
    });

    Object.values(residents).forEach((resident) => {
      const residentBarangayKey =
        resident.barangayKey || makeBarangayKey(resident.barangay || "");
      if (residentBarangayKey !== barangayKey) return;

      const name = normalizePurokName(resident.purokLabel || resident.purok);
      if (!name) return;

      add({
        name,
        verified: false,
        sourceType: "resident-record",
        sourceLabel: "Registered resident record — verify with Barangay/LGU",
      });
    });

    Object.values(routes).forEach((route) => {
      const routeBarangay = normalizeArray(route.barangays)[0] || "";
      if (makeBarangayKey(routeBarangay) !== barangayKey) return;

      normalizeArray(route.puroks).forEach((purok) => {
        add({
          name: purok,
          verified: false,
          sourceType: "existing-route",
          sourceLabel: "Existing WasteTrack route — verify before reuse",
        });
      });
    });

    return [...merged.values()].sort((left, right) =>
      comparePuroks(left.name, right.name),
    );
  }, [barangay, registry, residents, routes, savedPins]);

  const verifiedSet = useMemo(
    () => new Set(verifiedPuroks.map(normalizePurokName)),
    [verifiedPuroks],
  );
  const mappedSet = useMemo(
    () => new Set(mappedPuroks.map(normalizePurokName)),
    [mappedPuroks],
  );

  return (
    <>
      <label className="field-label">
        Barangay
        <select value={barangay} onChange={(event) => onBarangayChange(event.target.value)}>
          <option value="">Select barangay</option>
          {barangays.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <section className="purok-panel">
        <div className="panel-head">
          <div>
            <strong>Barangay Purok registry</strong>
            <span>
              Selecting a barangay automatically loads Puroks found in the verified
              registry, saved pins, resident records, and existing routes.
            </span>
          </div>

          <button
            type="button"
            onClick={() => void onLocateSelected()}
            disabled={!barangay || selectedPuroks.length === 0}
          >
            Locate selected
          </button>
        </div>

        {!barangay ? (
          <div className="empty-state">Select a barangay to load its Puroks.</div>
        ) : availablePuroks.length === 0 ? (
          <div className="empty-state warning">
            <strong>No Purok records found for {barangay}.</strong>
            <span>
              The system will not invent Purok names. Add the official list under
              <code>purok_registry/{makeBarangayKey(barangay)}</code> in Firebase,
              using a Barangay/LGU roster or certified map as the source.
            </span>
          </div>
        ) : (
          <div className="purok-list">
            {availablePuroks.map((item) => {
              const selected = selectedPuroks.includes(item.name);
              const verified = item.verified || verifiedSet.has(item.name);
              const mapped = mappedSet.has(item.name);
              const locatingKey = `${makeBarangayKey(barangay)}:${makePurokKey(item.name)}`;
              const locating = locatingPuroks[locatingKey] === true;

              return (
                <article
                  key={item.name}
                  className={`purok-item ${selected ? "selected" : ""} ${
                    verified ? "verified" : mapped ? "mapped" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="select-purok"
                    onClick={() => onTogglePurok(item.name)}
                    disabled={locating}
                  >
                    <span className="status-icon">
                      {locating ? "…" : verified ? "✓" : selected ? "•" : "+"}
                    </span>
                    <span className="purok-copy">
                      <strong>{item.name}</strong>
                      <small>{item.sourceLabel}</small>
                    </span>
                  </button>

                  <div className="source-actions">
                    <a
                      href={googleMapsUrl(barangay, item.name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps
                    </a>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {barangay && availablePuroks.length > 0 ? (
          <div className="registry-summary">
            <strong>{availablePuroks.length} Purok record(s)</strong>
            <span>
              {availablePuroks.filter((item) => item.verified).length} registry-verified
              · {availablePuroks.filter((item) => !item.verified).length} require review
            </span>
          </div>
        ) : null}

        {locationNotice ? <div className="notice">{locationNotice}</div> : null}

        <div className="safety-note">
          Google Maps and OpenStreetMap are reference maps only. They do not prove an
          official Purok boundary. For a defensible capstone system, use a Barangay/LGU
          roster or certified map as the authoritative source, then confirm the service
          pin in Route Management.
        </div>
      </section>

      <style jsx>{`
        .field-label {
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #28483b;
          font-size: 12px;
          font-weight: 850;
        }
        .field-label select {
          height: 42px;
          border: 1px solid #d7e1dc;
          border-radius: 11px;
          background: #fff;
          padding: 0 11px;
          color: #173c30;
          outline: 0;
        }
        .field-label select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1);
        }
        .purok-panel {
          padding: 14px;
          border: 1px solid #dde7e2;
          border-radius: 16px;
          background: #fff;
        }
        .panel-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .panel-head strong,
        .panel-head span {
          display: block;
        }
        .panel-head strong {
          color: #204638;
          font-size: 12px;
        }
        .panel-head span {
          margin-top: 4px;
          color: #72827a;
          font-size: 10px;
          line-height: 1.45;
        }
        .panel-head button {
          min-width: 112px;
          height: 34px;
          border: 1px solid #a7f3d0;
          border-radius: 10px;
          background: #ecfdf5;
          color: #047857;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }
        .panel-head button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .purok-list {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .purok-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border: 1px solid #e0e8e4;
          border-radius: 12px;
          background: #fff;
        }
        .purok-item.selected {
          border-color: #86efac;
          background: #f0fdf4;
        }
        .purok-item.verified {
          border-color: #34d399;
        }
        .purok-item.mapped:not(.verified) {
          border-color: #fbbf24;
          background: #fffbeb;
        }
        .select-purok {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 9px;
          border: 0;
          background: transparent;
          padding: 0;
          text-align: left;
          cursor: pointer;
        }
        .status-icon {
          width: 27px;
          height: 27px;
          flex: 0 0 27px;
          display: grid;
          place-items: center;
          border-radius: 9px;
          background: #e8f8f0;
          color: #047857;
          font-weight: 900;
        }
        .purok-copy {
          min-width: 0;
        }
        .purok-copy strong,
        .purok-copy small {
          display: block;
        }
        .purok-copy strong {
          color: #173c30;
          font-size: 11px;
        }
        .purok-copy small {
          margin-top: 3px;
          overflow: hidden;
          color: #74827b;
          font-size: 9px;
          line-height: 1.35;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .source-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .source-actions a {
          height: 28px;
          display: inline-flex;
          align-items: center;
          border: 1px solid #c7d2fe;
          border-radius: 8px;
          padding: 0 8px;
          background: #eef2ff;
          color: #3730a3;
          font-size: 9px;
          font-weight: 850;
          text-decoration: none;
        }
        .source-actions a + a {
          border-color: #bae6fd;
          background: #f0f9ff;
          color: #075985;
        }
        .empty-state {
          margin-top: 12px;
          padding: 14px;
          border: 1px dashed #cddbd4;
          border-radius: 12px;
          color: #718078;
          font-size: 10px;
          line-height: 1.45;
          text-align: center;
        }
        .empty-state.warning {
          border-color: #f0c96a;
          background: #fffbeb;
          color: #765816;
          text-align: left;
        }
        .empty-state strong,
        .empty-state span {
          display: block;
        }
        .empty-state span {
          margin-top: 5px;
        }
        .empty-state code {
          font-size: 9px;
        }
        .registry-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 10px;
          padding: 9px 10px;
          border-radius: 10px;
          background: #f5f8f6;
        }
        .registry-summary strong {
          color: #275142;
          font-size: 10px;
        }
        .registry-summary span {
          color: #687a71;
          font-size: 9px;
        }
        .notice {
          margin-top: 10px;
          padding: 10px;
          border: 1px solid #bae6fd;
          border-radius: 10px;
          background: #f0f9ff;
          color: #075985;
          font-size: 10px;
          line-height: 1.45;
        }
        .safety-note {
          margin-top: 9px;
          color: #7c6f45;
          font-size: 9px;
          line-height: 1.45;
        }
        @media (max-width: 520px) {
          .panel-head,
          .registry-summary {
            align-items: stretch;
            flex-direction: column;
          }
          .panel-head button {
            width: 100%;
          }
          .purok-item {
            grid-template-columns: 1fr;
          }
          .source-actions {
            padding-left: 36px;
          }
        }
      `}</style>
    </>
  );
}