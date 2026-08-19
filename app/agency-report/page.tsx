"use client";

import { DashboardShell } from "../components/DashboardShell";
import { MetroWastePlanningReport } from "../components/MetroWastePlanningReport";

export default function AgencyReportPage() {
  return (
    <DashboardShell title="" description="">
      <MetroWastePlanningReport />
    </DashboardShell>
  );
}