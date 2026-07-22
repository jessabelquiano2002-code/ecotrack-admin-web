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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      setUid(user.uid);

      const profileRef = ref(db, `adminProfile/${user.uid}`);
      const snap = await get(profileRef);

      if (snap.exists()) {
        const data = snap.val();

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

      setLoading(false);
    });

    return () => unsub();
  }, []);

  const resizeImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Please upload an image file."));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxSize = 300;

          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxSize) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");

          if (!ctx) {
            reject(new Error("Image processing failed."));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          const base64 = canvas.toDataURL("image/jpeg", 0.75);
          resolve(base64);
        };

        img.onerror = () => reject(new Error("Invalid image file."));
        img.src = reader.result as string;
      };

      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (file: File) => {
    try {
      const base64Image = await resizeImageToBase64(file);

      setProfile((prev) => ({
        ...prev,
        profileImage: base64Image,
      }));
    } catch (error: any) {
      alert(error.message || "Failed to upload image.");
    }
  };

  const saveProfile = async () => {
    if (!uid) {
      alert("No logged-in admin found.");
      return;
    }

    if (!profile.name.trim()) {
      alert("Name is required.");
      return;
    }

    setSaving(true);

    try {
      await update(ref(db, `adminProfile/${uid}`), {
        name: profile.name.trim(),
        email: profile.email.trim(),
        phone: profile.phone.trim(),
        role: profile.role.trim() || "System Admin",
        profileImage: profile.profileImage,
        updatedAt: Date.now(),
      });

      alert("Profile updated successfully.");
    } catch (error) {
      console.error(error);
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
                  alt="Profile"
                  className="profile-photo"
                />
              ) : (
                <div className="profile-photo-placeholder">
                  {profile.name ? profile.name.charAt(0).toUpperCase() : "A"}
                </div>
              )}

              <button
                type="button"
                className="change-photo-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Change Photo
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }}
              />
            </div>

            <div>
              <h2>{profile.name || "Admin User"}</h2>
              <p>{profile.email || "admin@wastetrack.gov.ph"}</p>
            </div>
          </div>

          {loading ? (
            <div className="profile-loading">Loading profile...</div>
          ) : (
            <div className="profile-form">
              <div className="form-group">
                <label>Full Name</label>
                <input
                  value={profile.name}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Enter full name"
                />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input
                  value={profile.email}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      email: e.target.value,
                    }))
                  }
                  placeholder="Enter email address"
                />
              </div>

              <div className="form-group">
                <label>Phone Number</label>
                <input
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  placeholder="Enter phone number"
                />
              </div>

              <div className="form-group">
                <label>Role</label>
                <input
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
                  disabled={saving}
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
        }

        .profile-photo,
        .profile-photo-placeholder {
          width: 110px;
          height: 110px;
          border-radius: 50%;
          object-fit: cover;
          border: 4px solid #dcfce7;
        }

        .profile-photo-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          background: #22c55e;
          color: #ffffff;
          font-size: 42px;
          font-weight: 800;
        }

        .change-photo-btn {
          border: 0;
          background: #ecfdf5;
          color: #16a34a;
          padding: 8px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
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

        .profile-actions {
          grid-column: 1 / -1;
          display: flex;
          justify-content: flex-end;
          padding-top: 8px;
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
          .profile-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .profile-form {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </DashboardShell>
  );
}