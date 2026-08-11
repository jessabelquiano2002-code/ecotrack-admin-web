"use client";

import { DashboardShell } from "../components/DashboardShell";
import { MetroWastePlanningReport } from "../components/MetroWastePlanningReport";

export default function AgencyReportPage() {
  return (
    <DashboardShell
      title="Operations Report"
      description="Generate professional whole-system WasteTrack operational reports from realtime collection, GPS, driver, truck, issue, and schedule records."
    >
      <MetroWastePlanningReport />
    </DashboardShell>
  );
}