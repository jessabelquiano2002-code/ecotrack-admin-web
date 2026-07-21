"use client";

import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { SectionCard } from "../components/SectionCard";

type RouteStatus = {
  id: string;
  driverName?: string;
  routeName?: string;
  stop?: string;
  status?: string;
  notes?: string;
  createdAt?: number;
};

export default function RouteStatusPage() {
  const [rows, setRows] = useState<RouteStatus[]>([]);

  useEffect(() => {
    const unsub = onValue(ref(db, "route_status_updates"), (snap) => {
      const val = snap.val() || {};

      const list = Object.entries(val).map(([id, v]: any) => ({
        id,
        ...v,
      }));

      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      setRows(list);
    });

    return () => unsub();
  }, []);

  const formatDate = (t?: number) =>
    t ? new Date(t).toLocaleString() : "-";

  return (
    <DashboardShell
      title="Route Status Viewer"
      description="View route updates sent by drivers from the mobile app"
    >
      <SectionCard title="Driver route status records">

        <table className="table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Route</th>
              <th>Stop</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Time</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No route updates yet.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.driverName || "-"}</td>
                <td>{r.routeName || "-"}</td>
                <td>{r.stop || "-"}</td>

                <td>
                  <span className={`status-pill status-${r.status}`}>
                    {r.status}
                  </span>
                </td>

                <td>{r.notes || "-"}</td>
                <td>{formatDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>

      </SectionCard>
    </DashboardShell>
  );
}