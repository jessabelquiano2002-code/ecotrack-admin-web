"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { get, ref, set, update } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type AdminProfile = {
  name: string;
  email: string;
  phone: string;
  role: string;
  profileImage: string;
  updatedAt?: number;
};

const emptyProfile: AdminProfile = {
  name: "",
  email: "",
  phone: "",
  role: "System Admin",
  profileImage: "",
};

export default function ProfilePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [uid, setUid] = useState("");
  const [profile, setProfile] = useState<AdminProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUid("");
        setProfile(emptyProfile);
        setLoading(false);
        return;
      }

      setLoading(true);
      setUid(user.uid);

      try {
        const profileRef = ref(db, `adminProfile/${user.uid}`);
        const snap = await get(profileRef);

        if (snap.exists()) {
          const data = snap.val() || {};

          setProfile({
            name: data.name || "Admin User",
            email: data.email || user.email || "",
            phone: data.phone || "",
            role: data.role || "System Admin",
            profileImage: data.profileImage || "",
            updatedAt: data.updatedAt,
          });
        } else {
          const starterProfile: AdminProfile = {
            name: "Admin User",
            email: user.email || "",
            phone: "",
            role: "System Admin",
            profileImage: "",
            updatedAt: Date.now(),
          };

          await set(profileRef, starterProfile);
          setProfile(starterProfile);
        }
      } catch (error) {
        console.error("Failed to load admin profile:", error);
        alert("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const resizeImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Please upload a valid image file."));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;

        if (typeof result !== "string") {
          reject(new Error("Failed to read image."));
          return;
        }

        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxSize = 300;

          let width = img.width;
          let height = img.height;

          if (width <= 0 || height <= 0) {
            reject(new Error("Invalid image dimensions."));
            return;
          }

          if (width > height) {
            if (width > maxSize) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            }
          } else if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");

          if (!ctx) {
            reject(new Error("Image processing failed."));
            return;
          }

          // White background avoids black/transparent background when converting PNG/WebP to JPEG.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const base64 = canvas.toDataURL("image/jpeg", 0.78);

          if (!base64 || !base64.startsWith("data:image/")) {
            reject(new Error("Failed to prepare image."));
            return;
          }

          resolve(base64);
        };

        img.onerror = () => reject(new Error("Invalid or unsupported image file."));
        img.src = result;
      };

      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (file: File) => {
    if (!uid) {
      alert("No logged-in admin found.");
      return;
    }

    setPhotoSaving(true);

    try {
      const base64Image = await resizeImageToBase64(file);
      const updatedAt = Date.now();

      // Update this page immediately.
      setProfile((prev) => ({
        ...prev,
        profileImage: base64Image,
        updatedAt,
      }));

      // Save immediately to Firebase so DashboardShell's realtime onValue()
      // listener receives the new image and updates the sidebar/header.
      await update(ref(db, `adminProfile/${uid}`), {
        profileImage: base64Image,
        updatedAt,
      });
    } catch (error) {
      console.error("Profile image upload failed:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Failed to upload image.";

      alert(message);
    } finally {
      setPhotoSaving(false);
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    /*
     * IMPORTANT:
     * Store the input element before any await.
     * React's event.currentTarget should not be accessed after an async await,
     * because it may become null in the event lifecycle.
     */
    const input = event.currentTarget;
    const file = input.files?.[0];

    // Reset immediately. This also lets the user select the same file again.
    input.value = "";

    if (!file) return;

    await handleImageUpload(file);
  };

  const saveProfile = async () => {
    if (!uid) {
      alert("No logged-in admin found.");
      return;
    }

    const name = profile.name.trim();
    const email = profile.email.trim();
    const phone = profile.phone.trim();
    const role = profile.role.trim() || "System Admin";

    if (!name) {
      alert("Name is required.");
      return;
    }

    setSaving(true);

    try {
      const updatedAt = Date.now();

      await update(ref(db, `adminProfile/${uid}`), {
        name,
        email,
        phone,
        role,
        profileImage: profile.profileImage,
        updatedAt,
      });

      setProfile((prev) => ({
        ...prev,
        name,
        email,
        phone,
        role,
        updatedAt,
      }));

      alert("Profile updated successfully.");
    } catch (error) {
      console.error("Failed to save profile:", error);
      alert("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardShell
      title="Profile"
      description="Manage your admin account information and profile picture."
    >
      <div className="profile-page">
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-photo-wrap">
              {profile.profileImage ? (
                <img
                  src={profile.profileImage}
                  alt={profile.name || "Admin profile"}
                  className="profile-photo"
                />
              ) : (
                <div className="profile-photo-placeholder" aria-hidden="true">
                  {profile.name
                    ? profile.name.charAt(0).toUpperCase()
                    : "A"}
                </div>
              )}

              <button
                type="button"
                className="change-photo-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoSaving || loading}
              >
                {photoSaving ? "Saving Photo..." : "Change Photo"}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={handleFileChange}
              />
            </div>

            <div className="profile-summary">
              <h2>{profile.name || "Admin User"}</h2>
              <p>{profile.email || "admin@wastetrack.gov.ph"}</p>

              {photoSaving && (
                <span className="profile-save-status">
                  Updating profile picture…
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="profile-loading">Loading profile...</div>
          ) : (
            <div className="profile-form">
              <div className="form-group">
                <label htmlFor="profile-name">Full Name</label>
                <input
                  id="profile-name"
                  value={profile.name}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Enter full name"
                  autoComplete="name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-email">Email Address</label>
                <input
                  id="profile-email"
                  type="email"
                  value={profile.email}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      email: e.target.value,
                    }))
                  }
                  placeholder="Enter email address"
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-phone">Phone Number</label>
                <input
                  id="profile-phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  placeholder="Enter phone number"
                  autoComplete="tel"
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-role">Role</label>
                <input
                  id="profile-role"
                  value={profile.role}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      role: e.target.value,
                    }))
                  }
                  placeholder="Enter admin role"
                />
              </div>

              <div className="profile-actions">
                <button
                  type="button"
                  className="save-btn"
                  onClick={saveProfile}
                  disabled={saving || loading || photoSaving}
                >
                  {saving ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .profile-page {
          max-width: 850px;
        }

        .profile-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 24px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
        }

        .profile-header {
          display: flex;
          align-items: center;
          gap: 22px;
          padding-bottom: 22px;
          margin-bottom: 22px;
          border-bottom: 1px solid #e5e7eb;
        }

        .profile-photo-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .profile-photo,
        .profile-photo-placeholder {
          width: 110px;
          height: 110px;
          border-radius: 50%;
          object-fit: cover;
          border: 4px solid #dcfce7;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
        }

        .profile-photo-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: #ffffff;
          font-size: 42px;
          font-weight: 800;
        }

        .change-photo-btn {
          border: 0;
          background: #ecfdf5;
          color: #15803d;
          padding: 8px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          transition:
            background 0.18s ease,
            transform 0.18s ease;
        }

        .change-photo-btn:hover:not(:disabled) {
          background: #dcfce7;
          transform: translateY(-1px);
        }

        .change-photo-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .profile-summary {
          min-width: 0;
        }

        .profile-header h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 850;
          color: #0f172a;
        }

        .profile-header p {
          margin: 6px 0 0;
          font-size: 13px;
          color: #64748b;
        }

        .profile-save-status {
          display: inline-block;
          margin-top: 9px;
          padding: 5px 9px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #15803d;
          font-size: 11px;
          font-weight: 800;
        }

        .profile-loading {
          color: #64748b;
          font-size: 14px;
        }

        .profile-form {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .form-group label {
          font-size: 12px;
          font-weight: 800;
          color: #334155;
        }

        .form-group input {
          width: 100%;
          height: 42px;
          border: 1px solid #dbe3ef;
          border-radius: 12px;
          padding: 0 13px;
          background: #ffffff;
          color: #0f172a;
          font-size: 13px;
          outline: none;
          transition:
            border-color 0.18s ease,
            box-shadow 0.18s ease;
        }

        .form-group input:focus {
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
        }

        .profile-actions {
          grid-column: 1 / -1;
          display: flex;
          justify-content: flex-end;
          padding-top: 8px;
        }

        .save-btn {
          min-width: 130px;
          border: 0;
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: #ffffff;
          padding: 12px 18px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 850;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(22, 163, 74, 0.18);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease;
        }

        .save-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 26px rgba(22, 163, 74, 0.24);
        }

        .save-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        @media (max-width: 700px) {
          .profile-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .profile-form {
            grid-template-columns: 1fr;
          }

          .profile-actions {
            justify-content: stretch;
          }

          .save-btn {
            width: 100%;
          }
        }
      `}</style>
    </DashboardShell>
  );
}