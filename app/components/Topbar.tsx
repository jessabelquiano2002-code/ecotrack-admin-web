"use client";

import { useState } from "react";

export default function Topbar() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const notifications = [
    { id: 1, text: "New garbage schedule created", time: "5m ago" },
    { id: 2, text: "Driver assigned to Mercedes route", time: "20m ago" },
    { id: 3, text: "Schedule cancelled in Purok 2", time: "1h ago" },
  ];

  return (
    <header className="w-full bg-white shadow-sm px-6 py-3 flex items-center justify-between relative">

      {/* SEARCH */}
      <div className="w-1/2">
        <input
          type="text"
          placeholder="Search trucks, routes, drivers..."
          className="w-full border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-4 relative">

        {/* NOTIFICATIONS */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2 rounded-full hover:bg-gray-100"
          >
            🔔

            {/* BADGE */}
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-1 rounded-full">
              3
            </span>
          </button>

          {/* DROPDOWN */}
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border rounded-lg shadow-lg z-50">
              <div className="p-3 border-b font-semibold">
                Notifications
              </div>

              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="p-3 hover:bg-gray-50 border-b text-sm"
                >
                  <div>{n.text}</div>
                  <div className="text-xs text-gray-400">{n.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ADMIN MENU */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-1 rounded-full hover:bg-gray-100"
          >
            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center">
              A
            </div>
            <span className="text-sm font-medium">Admin</span>
          </button>

          {/* DROPDOWN MENU */}
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border rounded-lg shadow-lg z-50">

              <div className="p-3 border-b text-sm font-semibold">
                Admin Panel
              </div>

              <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                Profile
              </button>

              <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                Settings
              </button>

              <button
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-50"
              >
                Log out
              </button>

            </div>
          )}
        </div>

      </div>
    </header>
  );
}