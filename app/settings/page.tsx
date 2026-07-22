"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { get, ref, set, update } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type AdminSettings = {
  systemName: string;
  cityName: string;
  contactEmail: string;
  notificationsEnabled: boolean;
  autoRefreshEnabled: boolean;
  mapRefreshSeconds: number;
  updatedAt?: number;
};

const defaultSettings: AdminSettings = {
  systemName: "Track",
  cityName: "Catbalogan City",
  contactEmail: "admin@wastetrack.gov.ph",
  notificationsEnabled: true,
  autoRefreshEnabled: true,
  mapRefreshSeconds: 5,
};

export default function SettingsPage() {
  const [uid, setUid] = useState("");
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      setUid(user.uid);

      const settingsRef = ref(db, `adminSettings/${user.uid}`);
      const snap = await get(settingsRef);

      if (snap.exists()) {
        const data = snap.val();

        setSettings({
          systemName: data.systemName || "WasteTrack",
          cityName: data.cityName || "Catbalogan City",
          contactEmail: data.contactEmail || user.email || "",
          notificationsEnabled:
            typeof data.notificationsEnabled === "boolean"
              ? data.notificationsEnabled
              : true,
          autoRefreshEnabled:
            typeof data.autoRefreshEnabled === "boolean"
              ? data.autoRefreshEnabled
              : true,
          mapRefreshSeconds: Number(data.mapRefreshSeconds || 5),
          updatedAt: data.updatedAt,
        });
      } else {
        const starterSettings: AdminSettings = {
          ...defaultSettings,
          contactEmail: user.email || defaultSettings.contactEmail,
          updatedAt: Date.now(),
        };

        await set(settingsRef, starterSettings);
        setSettings(starterSettings);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  const saveSettings = async () => {
    if (!uid) {
      alert("No logged-in admin found.");
      return;
    }

    if (!settings.systemName.trim()) {
      alert("System name is required.");
      return;
    }

    if (!settings.cityName.trim()) {
      alert("City name is required.");
      return;
    }

    setSaving(true);

    try {
      await update(ref(db, `adminSettings/${uid}`), {
        systemName: settings.systemName.trim(),
        cityName: settings.cityName.trim(),
        contactEmail: settings.contactEmail.trim(),
        notificationsEnabled: settings.notificationsEnabled,
        autoRefreshEnabled: settings.autoRefreshEnabled,
        mapRefreshSeconds: Number(settings.mapRefreshSeconds || 5),
        updatedAt: Date.now(),
      });

      alert("Settings saved successfully.");
    } catch (error) {
      console.error(error);
      alert("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardShell
      title="Settings"
      description="Manage system information and admin preferences."
    >
      <div className="settings-page">
        <div className="settings-card">
          {loading ? (
            <div className="settings-loading">Loading settings...</div>
          ) : (
            <>
              <div className="settings-section">
                <h2>System Information</h2>
                <p>These details will be used for your admin dashboard.</p>

                <div className="settings-grid">
                  <div className="form-group">
                    <label>System Name</label>
                    <input
                      value={settings.systemName}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          systemName: e.target.value,
                        }))
                      }
                      placeholder="WasteTrack"
                    />
                  </div>

                  <div className="form-group">
                    <label>City / Office Name</label>
                    <input
                      value={settings.cityName}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          cityName: e.target.value,
                        }))
                      }
                      placeholder="Catbalogan City"
                    />
                  </div>

                  <div className="form-group full">
                    <label>Contact Email</label>
                    <input
                      value={settings.contactEmail}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          contactEmail: e.target.value,
                        }))
                      }
                      placeholder="admin@wastetrack.gov.ph"
                    />
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h2>Dashboard Preferences</h2>
                <p>Control notification and map refresh behavior.</p>

                <div className="setting-row">
                  <div>
                    <h3>Enable Notifications</h3>
                    <p>Show notification count and notification alerts.</p>
                  </div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.notificationsEnabled}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          notificationsEnabled: e.target.checked,
                        }))
                      }
                    />
                    <span />
                  </label>
                </div>

                <div className="setting-row">
                  <div>
                    <h3>Auto Refresh</h3>
                    <p>Allow live map and dashboard data to refresh automatically.</p>
                  </div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.autoRefreshEnabled}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          autoRefreshEnabled: e.target.checked,
                        }))
                      }
                    />
                    <span />
                  </label>
                </div>

                <div className="form-group refresh-field">
                  <label>Map Refresh Seconds</label>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={settings.mapRefreshSeconds}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        mapRefreshSeconds: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  className="save-btn"
                  onClick={saveSettings}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .settings-page {
          max-width: 900px;
        }

        .settings-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 24px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
        }

        .settings-loading {
          color: #64748b;
          font-size: 14px;
        }

        .settings-section {
          padding-bottom: 24px;
          margin-bottom: 24px;
          border-bottom: 1px solid #e5e7eb;
        }

        .settings-section h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 850;
          color: #0f172a;
        }

        .settings-section > p {
          margin: 6px 0 18px;
          font-size: 13px;
          color: #64748b;
        }

        .settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .form-group.full {
          grid-column: 1 / -1;
        }

        .form-group label {
          font-size: 12px;
          font-weight: 800;
          color: #334155;
        }

        .form-group input {
          height: 42px;
          border: 1px solid #dbe3ef;
          border-radius: 12px;
          padding: 0 13px;
          font-size: 13px;
          outline: none;
        }

        .form-group input:focus {
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
        }

        .setting-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          margin-bottom: 12px;
          background: #f8fafc;
        }

        .setting-row h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 850;
          color: #0f172a;
        }

        .setting-row p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #64748b;
        }

        .switch {
          position: relative;
          width: 48px;
          height: 26px;
          flex-shrink: 0;
        }

        .switch input {
          display: none;
        }

        .switch span {
          position: absolute;
          inset: 0;
          cursor: pointer;
          background: #cbd5e1;
          border-radius: 999px;
          transition: 0.2s ease;
        }

        .switch span::before {
          content: "";
          position: absolute;
          width: 20px;
          height: 20px;
          left: 3px;
          top: 3px;
          background: #ffffff;
          border-radius: 50%;
          transition: 0.2s ease;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
        }

        .switch input:checked + span {
          background: #22c55e;
        }

        .switch input:checked + span::before {
          transform: translateX(22px);
        }

        .refresh-field {
          max-width: 260px;
          margin-top: 16px;
        }

        .settings-actions {
          display: flex;
          justify-content: flex-end;
        }

        .save-btn {
          border: 0;
          background: #22c55e;
          color: #ffffff;
          padding: 12px 18px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 850;
          cursor: pointer;
        }

        .save-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        @media (max-width: 700px) {
          .settings-grid {
            grid-template-columns: 1fr;
          }

          .setting-row {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>
    </DashboardShell>
  );
}