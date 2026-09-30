"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "../components/DashboardShell";
import { LiveAnalyticsDashboard } from "../components/LiveAnalyticsDashboard";
import { MetroWastePlanningReport } from "../components/MetroWastePlanningReport";

type Tab = "dashboard" | "report";

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "dashboard";
  return window.location.hash === "#report" ? "report" : "dashboard";
}

export default function ReportsAndAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  // The report is mounted the first time it is opened, then kept mounted so a
  // generated report is not lost when switching tabs.
  const [reportMounted, setReportMounted] = useState(false);

  useEffect(() => {
    const initial = tabFromHash();
    setTab(initial);
    if (initial === "report") setReportMounted(true);

    const onHashChange = () => {
      const next = tabFromHash();
      setTab(next);
      if (next === "report") setReportMounted(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    if (next === "report") setReportMounted(true);
    window.history.replaceState(null, "", next === "report" ? "#report" : window.location.pathname);
  };

  return (
    <DashboardShell
      title="Reports & Analytics"
      description="Live operations dashboard and the printable agency report in one place."
      hidePageHeader
    >
      <div className="ra-tabs" role="tablist" aria-label="Reports and analytics views">
        <button
          type="button"
          role="tab"
          id="ra-tab-dashboard"
          aria-selected={tab === "dashboard"}
          aria-controls="ra-panel-dashboard"
          className={tab === "dashboard" ? "active" : ""}
          onClick={() => selectTab("dashboard")}
        >
          <strong>Live Dashboard</strong>
          <span>Real-time performance, GPS footprint, and recent records</span>
        </button>
        <button
          type="button"
          role="tab"
          id="ra-tab-report"
          aria-selected={tab === "report"}
          aria-controls="ra-panel-report"
          className={tab === "report" ? "active" : ""}
          onClick={() => selectTab("report")}
        >
          <strong>Generate Report</strong>
          <span>Printable agency report with filters, PDF, and recommendations</span>
        </button>
      </div>

      <div
        role="tabpanel"
        id="ra-panel-dashboard"
        aria-labelledby="ra-tab-dashboard"
        hidden={tab !== "dashboard"}
      >
        <LiveAnalyticsDashboard />
      </div>

      {reportMounted && (
        <div
          role="tabpanel"
          id="ra-panel-report"
          aria-labelledby="ra-tab-report"
          hidden={tab !== "report"}
        >
          <MetroWastePlanningReport />
        </div>
      )}

      <style jsx global>{`
        .ra-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 18px;
          padding: 6px;
          border: 1px solid #dce7e0;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 8px 22px rgba(15, 45, 31, 0.05);
        }
        .ra-tabs button {
          display: grid;
          gap: 3px;
          padding: 13px 16px;
          border: 1px solid transparent;
          border-radius: 12px;
          background: transparent;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .ra-tabs button strong {
          color: #263f34;
          font-size: 15px;
        }
        .ra-tabs button span {
          color: #64766d;
          font-size: 13px;
          line-height: 1.4;
        }
        .ra-tabs button:hover {
          background: #f4faf6;
        }
        .ra-tabs button.active {
          border-color: #26a962;
          background: #f0faf4;
          box-shadow: inset 0 0 0 1px rgba(38, 169, 98, 0.13);
        }
        .ra-tabs button.active strong {
          color: #087a4b;
        }
        [role="tabpanel"][hidden] {
          display: none !important;
        }
        @media (max-width: 640px) {
          .ra-tabs {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardShell>
  );
}
