"use client";

import { DashboardShell } from "../components/DashboardShell";
import { MetroWastePlanningReport } from "../components/MetroWastePlanningReport";

export default function AgencyReportPage() {
  return (
    <DashboardShell
      title="Agency Report"
      description="Generate printable Metro Waste planning reports and schedule recommendations from operational records."
    >
      <MetroWastePlanningReport />
    </DashboardShell>
  );
}
