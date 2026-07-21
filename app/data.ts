export const stats = [
  { label: "Active Drivers", value: "12" },
  { label: "Routes Today", value: "8" },
  { label: "Residents Subscribed", value: "1,284" },
  { label: "Reports Submitted", value: "35" }
];

export const drivers = [
  { name: "Juan Dela Cruz", truck: "TRK-01", status: "On Route", route: "Morning Route A", username: "juan.driver", phone: "09171234567" },
  { name: "Pedro Santos", truck: "TRK-02", status: "Active", route: "Afternoon Route B", username: "pedro.driver", phone: "09179876543" },
  { name: "Ana Reyes", truck: "TRK-03", status: "Offline", route: "Pending Assignment", username: "ana.driver", phone: "09172345678" }
];

export const routes = [
  { name: "Morning Route A", area: "Poblacion 1 / Purok 3", schedule: "7:00 AM", progress: "68%", driver: "Juan Dela Cruz", day: "Mon/Wed/Fri" },
  { name: "Afternoon Route B", area: "Silanga / Purok 1", schedule: "3:00 PM", progress: "20%", driver: "Pedro Santos", day: "Tue/Thu/Sat" },
  { name: "Market Route", area: "Guinsorongan / Purok 4", schedule: "5:30 PM", progress: "0%", driver: "Unassigned", day: "Daily" }
];

export const notifications = [
  {
    title: "Schedule Adjustment",
    body: "Collection in Poblacion 1 will begin 30 minutes later due to traffic.",
    target: "Poblacion 1 / Purok 3",
    date: "April 23, 2026"
  },
  {
    title: "Truck Approaching",
    body: "TRK-01 is nearing Silanga Route B coverage.",
    target: "Silanga / Purok 1",
    date: "April 23, 2026"
  }
];

export const analytics = [
  { label: "Collection Completion", value: "91%" },
  { label: "Average Delay", value: "12 min" },
  { label: "Resident Reports", value: "17" },
  { label: "Notification Success", value: "98%" }
];

export const recentReports = [
  { driver: "Juan Dela Cruz", route: "Morning Route A", note: "2 stops delayed due to heavy traffic." },
  { driver: "Pedro Santos", route: "Afternoon Route B", note: "Route started on time and completed with no issues." },
  { driver: "Ana Reyes", route: "Market Route", note: "Truck under maintenance, route pending reassignment." }
];
