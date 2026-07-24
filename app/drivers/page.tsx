"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref, remove } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type Driver = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  truck?: string;
  status?: string;
  profileImage?: string;
  licenseNumber?: string;
  licenseExpirationDate?: string;
  licenseImageRef?: string;
  createdAt?: number;
  updatedAt?: number;
};

type Resident = {
  id: string;
  uid?: string;
  residentId?: string;
  name?: string;
  email?: string;
  phone?: string;
  barangay?: string;
  barangayKey?: string;
  purok?: string | number;
  purokLabel?: string;
  role?: string;
  accountStatus?: string;
  createdAt?: number;
  updatedAt?: number;
};

type UserRow = {
  id: string;
  type: "driver" | "resident";
  name: string;
  email: string;
  phone: string;
  status: string;
  profileImage?: string;
  primaryInfo: string;
  secondaryInfo: string;
  createdAt?: number;
  rawDriver?: Driver;
  rawResident?: Resident;
};

type TabType = "all" | "drivers" | "residents";

type DriverApiResponse = {
  success?: boolean;
  uid?: string;
  error?: string;
};

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  password: "",
  truck: "",
  licenseNumber: "",
  licenseExpirationDate: "",
};

const MAX_LICENSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LICENSE_TYPES = new Set(["image/jpeg", "image/png"]);

export default function UsersPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("all");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [editDriverId, setEditDriverId] = useState<string | null>(null);
  const [profileDriver, setProfileDriver] = useState<Driver | null>(null);
  const [profileLicenseUrl, setProfileLicenseUrl] = useState("");
  const [isLicenseLoading, setIsLicenseLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileTab, setProfileTab] = useState<"overview" | "licence">("overview");

  useEffect(() => {
    return () => {
      if (profileLicenseUrl) {
        URL.revokeObjectURL(profileLicenseUrl);
      }
    };
  }, [profileLicenseUrl]);

  /* ================= FETCH DRIVERS ================= */
  useEffect(() => {
    const driversRef = ref(db, "drivers");

    const unsubscribe = onValue(driversRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setDrivers([]);
        return;
      }

      const list: Driver[] = Object.entries(data).map(([id, value]: any) => ({
        id,
        ...value,
        status: value.status || "offline",
      }));

      setDrivers(list);
    });

    return () => unsubscribe();
  }, []);

  /* ================= FETCH RESIDENTS ================= */
  useEffect(() => {
    const residentsRef = ref(db, "residents");

    const unsubscribe = onValue(residentsRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setResidents([]);
        return;
      }

      const list: Resident[] = Object.entries(data).map(([id, value]: any) => ({
        id,
        ...value,
        accountStatus: value.accountStatus || "Active",
      }));

      setResidents(list);
    });

    return () => unsubscribe();
  }, []);

  /* ================= NORMALIZED USER LIST ================= */
  const allUsers = useMemo<UserRow[]>(() => {
    const driverRows: UserRow[] = drivers.map((driver) => ({
      id: driver.id,
      type: "driver",
      name: driver.name || "Unnamed Driver",
      email: driver.email || "-",
      phone: driver.phone || "-",
      status: driver.status || "offline",
      profileImage: driver.profileImage,
      primaryInfo: driver.truck || "No truck assigned",
      secondaryInfo: "Collection Driver",
      createdAt: driver.createdAt,
      rawDriver: driver,
    }));

    const residentRows: UserRow[] = residents.map((resident) => {
      const purokText =
        resident.purokLabel ||
        (resident.purok ? `Purok ${resident.purok}` : "No purok");

      return {
        id: resident.id,
        type: "resident",
        name: resident.name || "Unnamed Resident",
        email: resident.email || "-",
        phone: resident.phone || "-",
        status: resident.accountStatus || "Active",
        primaryInfo: resident.barangay || "No barangay",
        secondaryInfo: purokText,
        createdAt: resident.createdAt,
        rawResident: resident,
      };
    });

    return [...driverRows, ...residentRows].sort((a, b) => {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [drivers, residents]);

  /* ================= FILTER ================= */
  const filteredUsers = useMemo(() => {
    let list = allUsers;

    if (activeTab === "drivers") {
      list = list.filter((user) => user.type === "driver");
    }

    if (activeTab === "residents") {
      list = list.filter((user) => user.type === "resident");
    }

    if (!search.trim()) return list;

    const keyword = search.toLowerCase();

    return list.filter((user) => {
      const text = `
        ${user.name}
        ${user.email}
        ${user.phone}
        ${user.status}
        ${user.primaryInfo}
        ${user.secondaryInfo}
        ${user.type}
      `.toLowerCase();

      return text.includes(keyword);
    });
  }, [allUsers, activeTab, search]);

  /* ================= STATS ================= */
  const stats = useMemo(() => {
    return {
      totalUsers: drivers.length + residents.length,
      totalDrivers: drivers.length,
      totalResidents: residents.length,
      onlineDrivers: drivers.filter(
        (driver) => (driver.status || "").toLowerCase() === "online"
      ).length,
    };
  }, [drivers, residents]);

  /* ================= CREATE DRIVER ================= */
  const createDriver = async () => {
  if (isSaving) return;

  setFormError("");

  const normalizedName = form.name.trim();
  const normalizedEmail = form.email.trim().toLowerCase();
  const normalizedPhone = form.phone.trim();
  const normalizedTruck = form.truck.trim();
  const normalizedLicenseNumber = form.licenseNumber.trim();

  if (
    !normalizedName ||
    !normalizedEmail ||
    !normalizedPhone ||
    !normalizedTruck
  ) {
    setFormError(
      "Full name, email, contact number, and assigned vehicle are required.",
    );
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    setFormError(
      "Enter a valid email address, such as driver@example.com.",
    );
    return;
  }

  if (
    !normalizedLicenseNumber ||
    !form.licenseExpirationDate ||
    !licenseFile
  ) {
    setFormError(
      "Licence number, expiration date, and licence image are required.",
    );
    return;
  }

  const expirationDate = new Date(
    `${form.licenseExpirationDate}T23:59:59`,
  );

  if (Number.isNaN(expirationDate.getTime())) {
    setFormError("Enter a valid licence expiration date.");
    return;
  }

  if (expirationDate.getTime() < Date.now()) {
    setFormError("The driver's licence is already expired.");
    return;
  }

  if (form.password.length < 6) {
    setFormError(
      "Password must contain at least 6 characters.",
    );
    return;
  }

  try {
    setIsSaving(true);

    const token = await getAdminToken();

    const normalizedForm = {
      ...form,
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      truck: normalizedTruck,
      licenseNumber: normalizedLicenseNumber,
    };

    const body = buildDriverFormData(
      normalizedForm,
      licenseFile,
    );

    const response = await fetch("/api/create-driver", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      cache: "no-store",
    });

    const result = await readDriverApiResponse(response);

    if (!response.ok) {
      setFormError(
        result.error || "Failed to create driver.",
      );
      return;
    }

    setShowModal(false);
    setForm(emptyForm);
    clearLicenseSelection();
  } catch (error) {
    console.error("Create driver error:", error);

    setFormError(
      error instanceof Error
        ? error.message
        : "Something went wrong while creating the driver.",
    );
  } finally {
    setIsSaving(false);
  }
};

  const updateDriver = async () => {
    if (!editDriverId) return;
    if (isSaving) return;
    setFormError("");

    try {
      setIsSaving(true);
      const token = await getAdminToken();
      const body = buildDriverFormData(form, licenseFile);
      body.set("driverId", editDriverId);
      const response = await fetch("/api/create-driver", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        cache: "no-store",
      });
      const result = await readDriverApiResponse(response);
      if (!response.ok) {
        setFormError(result.error || "Failed to update driver.");
        return;
      }

      setEditDriverId(null);
      setForm(emptyForm);
      clearLicenseSelection();
    } catch (error) {
      console.error(error);
      setFormError(error instanceof Error ? error.message : "Failed to update driver.");
    } finally {
      setIsSaving(false);
    }
  };

  const clearLicenseSelection = () => {
    if (licensePreview) URL.revokeObjectURL(licensePreview);
    setLicenseFile(null);
    setLicensePreview("");
  };

  const selectLicenseImage = (file: File | null) => {
    setFormError("");
    clearLicenseSelection();
    if (!file) return;
    if (!ALLOWED_LICENSE_TYPES.has(file.type)) {
      setFormError("Licence image must be JPG, JPEG, or PNG.");
      return;
    }
    if (file.size > MAX_LICENSE_BYTES) {
      setFormError("Licence image must not exceed 5 MB.");
      return;
    }
    setLicenseFile(file);
    setLicensePreview(URL.createObjectURL(file));
  };

  const openCreateDriver = () => {
    clearLicenseSelection();
    setForm(emptyForm);
    setFormError("");
    setShowModal(true);
  };

  const openEditDriver = (driver: Driver) => {
    clearLicenseSelection();
    setFormError("");
    setForm({
      name: driver.name || "",
      email: driver.email || "",
      phone: driver.phone || "",
      password: "",
      truck: driver.truck || "",
      licenseNumber: driver.licenseNumber || "",
      licenseExpirationDate: driver.licenseExpirationDate || "",
    });
    setEditDriverId(driver.id);
  };

  const closeDriverProfile = () => {
    if (profileLicenseUrl) {
      URL.revokeObjectURL(profileLicenseUrl);
    }

    setProfileDriver(null);
    setProfileLicenseUrl("");
    setProfileError("");
    setProfileTab("overview");
    setIsLicenseLoading(false);
  };

  const openDriverProfile = async (driver: Driver) => {
    if (profileLicenseUrl) {
      URL.revokeObjectURL(profileLicenseUrl);
    }

    setProfileDriver(driver);
    setProfileLicenseUrl("");
    setProfileError("");
    setProfileTab("overview");
    setIsLicenseLoading(true);

    try {
      const token = await getAdminToken();

      /*
       * app/api/driver-license/route.ts is a non-dynamic route.
       * The driver ID must therefore be passed as a query parameter.
       */
      const response = await fetch(
        `/api/driver-license?driverId=${encodeURIComponent(driver.id)}`,
        {
          method: "GET",
          headers: {
            Accept: "image/jpeg,image/png,application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      if (response.status === 404) {
        setProfileError("No driver licence image is currently stored.");
        return;
      }

      if (!response.ok) {
        const message = await readImageApiError(response);
        throw new Error(message);
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();

      if (!contentType.startsWith("image/")) {
        throw new Error("The licence service returned an invalid image response.");
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error("The stored licence image is empty.");
      }

      setProfileLicenseUrl(URL.createObjectURL(blob));
    } catch (error) {
      console.error("Driver licence loading error:", error);
      setProfileError(
        error instanceof Error
          ? error.message
          : "The driver licence image could not be loaded.",
      );
    } finally {
      setIsLicenseLoading(false);
    }
  };

  /* ================= DELETE DRIVER ================= */
  const deleteDriver = async (id: string) => {
    if (!confirm("Delete this driver account and its licence image?")) return;

    try {
      const token = await getAdminToken();
      const response = await fetch("/api/create-driver", {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ driverId: id }),
        cache: "no-store",
      });
      const result = await readDriverApiResponse(response);
      if (!response.ok) throw new Error(result.error || "Failed to delete driver.");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to delete driver.");
    }
  };

  /* ================= DELETE RESIDENT ================= */
  const deleteResident = async (id: string) => {
    if (!confirm("Delete this resident from the database?")) return;

    try {
      await remove(ref(db, `residents/${id}`));
    } catch (error) {
      console.error(error);
      alert("Failed to delete resident.");
    }
  };

  const getAvatar = (user: UserRow) => {
    if (user.profileImage) {
      const src = user.profileImage.startsWith("data:")
        ? user.profileImage
        : `data:image/jpeg;base64,${user.profileImage}`;

      return <img src={src} alt={user.name} className="user-avatar-img" />;
    }

    return (
      <div className={`user-avatar ${user.type === "driver" ? "driver" : "resident"}`}>
        {getInitials(user.name)}
      </div>
    );
  };

  return (
    <DashboardShell
      title="User Management"
      description="Manage drivers and monitor registered residents in realtime"
    >
      <div className="users-page">
        {/* STATS */}
        <div className="users-stats-grid">
          <div className="users-stat-card">
            <span className="stat-label">Total Users</span>
            <strong>{stats.totalUsers}</strong>
            <small>Drivers and residents</small>
          </div>

          <div className="users-stat-card green">
            <span className="stat-label">Drivers</span>
            <strong>{stats.totalDrivers}</strong>
            <small>{stats.onlineDrivers} online now</small>
          </div>

          <div className="users-stat-card blue">
            <span className="stat-label">Residents</span>
            <strong>{stats.totalResidents}</strong>
            <small>Registered accounts</small>
          </div>

          <div className="users-stat-card dark">
            <span className="stat-label">Online Drivers</span>
            <strong>{stats.onlineDrivers}</strong>
            <small>Realtime tracking active</small>
          </div>
        </div>

        {/* HEADER */}
        <div className="users-toolbar">
          <div>
            <h2>Accounts Directory</h2>
            <p>View resident accounts and manage collection drivers.</p>
          </div>

          <div className="users-actions">
            <div className="search-box">
              <span>⌕</span>
              <input
                placeholder="Search name, barangay, truck, status..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              className="primary-action"
              onClick={openCreateDriver}
            >
              + Add Driver
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="users-tabs">
          <button
            className={activeTab === "all" ? "active" : ""}
            onClick={() => setActiveTab("all")}
          >
            All Users
            <span>{stats.totalUsers}</span>
          </button>

          <button
            className={activeTab === "drivers" ? "active" : ""}
            onClick={() => setActiveTab("drivers")}
          >
            Drivers
            <span>{stats.totalDrivers}</span>
          </button>

          <button
            className={activeTab === "residents" ? "active" : ""}
            onClick={() => setActiveTab("residents")}
          >
            Residents
            <span>{stats.totalResidents}</span>
          </button>
        </div>

        {/* TABLE */}
        <div className="users-table-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Contact</th>
                <th>Assignment / Area</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <strong>No users found</strong>
                      <span>Try changing your search or selected tab.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={`${user.type}-${user.id}`}>
                    <td>
                      <div className="user-cell">
                        {getAvatar(user)}

                        <div>
                          <strong>{user.name}</strong>
                          <span>ID: {shortId(user.id)}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={`role-pill ${user.type}`}>
                        {user.type === "driver" ? "Driver" : "Resident"}
                      </span>
                    </td>

                    <td>
                      <div className="contact-cell">
                        <span>{user.email}</span>
                        <small>{user.phone}</small>
                      </div>
                    </td>

                    <td>
                      <div className="area-cell">
                        <strong>{user.primaryInfo}</strong>
                        <span>{user.secondaryInfo}</span>
                      </div>
                    </td>

                    <td>
                      <span className={`status-pill ${getStatusClass(user.status)}`}>
                        {user.status}
                      </span>
                    </td>

                    <td>{formatDate(user.createdAt)}</td>

                    <td>
                      <div className="row-actions">
                        {user.type === "driver" && user.rawDriver && (
                          <button className="soft-btn" onClick={() => openDriverProfile(user.rawDriver!)}>
                            Profile
                          </button>
                        )}
                        {user.type === "driver" && user.rawDriver && (
                          <button
                            className="soft-btn"
                            onClick={() => openEditDriver(user.rawDriver!)}
                          >
                            Edit
                          </button>
                        )}

                        {user.type === "driver" ? (
                          <button
                            className="danger-btn"
                            onClick={() => deleteDriver(user.id)}
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            className="danger-btn"
                            onClick={() => deleteResident(user.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ADD DRIVER MODAL */}
        {showModal && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <div className="modal-header">
                <div>
                  <h3>Create Driver Account</h3>
                  <p>Add a new collection driver to the system.</p>
                </div>

                <button className="modal-close" onClick={() => { setShowModal(false); clearLicenseSelection(); }}>
                  ×
                </button>
              </div>

              {formError && <div className="form-error full-error" role="alert">{formError}</div>}

              <DriverFields form={form} setForm={setForm} includePassword />

              <LicensePicker
                preview={licensePreview}
                hasStoredImage={false}
                onChange={selectLicenseImage}
              />

              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => { setShowModal(false); clearLicenseSelection(); }} disabled={isSaving}>
                  Cancel
                </button>
                <button className="primary-action" onClick={createDriver} disabled={isSaving}>
                  {isSaving ? "Saving driver…" : "Save Driver"}
                </button>
              </div>
            </div>
          </div>
        )}

        {editDriverId && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <div className="modal-header">
                <div>
                  <h3>Update Driver Profile</h3>
                  <p>Update contact, vehicle, licence details, or replace the stored licence image.</p>
                </div>
                <button className="modal-close" onClick={() => { setEditDriverId(null); clearLicenseSelection(); }}>×</button>
              </div>

              {formError && <div className="form-error full-error" role="alert">{formError}</div>}
              <DriverFields form={form} setForm={setForm} />
              <LicensePicker
                preview={licensePreview}
                hasStoredImage={Boolean(drivers.find((driver) => driver.id === editDriverId)?.licenseImageRef)}
                onChange={selectLicenseImage}
              />

              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => { setEditDriverId(null); clearLicenseSelection(); }} disabled={isSaving}>Cancel</button>
                <button className="primary-action" onClick={updateDriver} disabled={isSaving}>
                  {isSaving ? "Saving changes…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {profileDriver && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeDriverProfile();
              }
            }}
          >
            <section
              className="modal-card profile-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="driver-profile-title"
            >
              <div className="profile-hero">
                <DriverProfileAvatar driver={profileDriver} />

                <div className="profile-hero-copy">
                  <div className="profile-title-row">
                    <span className="profile-kicker">Collection driver</span>
                    <span className={`status-pill ${getStatusClass(profileDriver.status || "offline")}`}>
                      {profileDriver.status || "offline"}
                    </span>
                  </div>

                  <h3 id="driver-profile-title">
                    {profileDriver.name || "Driver Profile"}
                  </h3>

                  <p>
                    Review the driver account, assigned vehicle, profile photo,
                    and securely stored licence record.
                  </p>

                  <div className="profile-meta-row">
                    <span>ID: {shortId(profileDriver.id)}</span>
                    <span>Joined {formatDate(profileDriver.createdAt)}</span>
                  </div>
                </div>

                <button
                  className="modal-close profile-close"
                  type="button"
                  onClick={closeDriverProfile}
                  aria-label="Close driver profile"
                >
                  ×
                </button>
              </div>

              <div className="profile-tabs" role="tablist" aria-label="Driver profile sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={profileTab === "overview"}
                  className={profileTab === "overview" ? "active" : ""}
                  onClick={() => setProfileTab("overview")}
                >
                  Profile overview
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={profileTab === "licence"}
                  className={profileTab === "licence" ? "active" : ""}
                  onClick={() => setProfileTab("licence")}
                >
                  Driver&apos;s licence
                  {profileLicenseUrl ? <span className="available-dot" aria-label="Image available" /> : null}
                </button>
              </div>

              {profileTab === "overview" ? (
                <div className="profile-overview-layout">
                  <div className="profile-photo-card">
                    <span className="section-eyebrow">Driver photo</span>
                    <DriverProfileAvatar driver={profileDriver} large />
                    <strong>{profileDriver.name || "Unnamed Driver"}</strong>
                    <span>{profileDriver.email || "No email provided"}</span>
                  </div>

                  <div className="profile-information-card">
                    <div className="section-heading">
                      <div>
                        <span className="section-eyebrow">Account information</span>
                        <h4>Driver details</h4>
                      </div>
                    </div>

                    <div className="profile-detail-grid">
                      <ProfileField label="Email address" value={profileDriver.email} />
                      <ProfileField label="Contact number" value={profileDriver.phone} />
                      <ProfileField label="Assigned vehicle" value={profileDriver.truck} />
                      <ProfileField label="Licence number" value={profileDriver.licenseNumber} />
                      <ProfileField
                        label="Licence expiration"
                        value={formatLicenceDate(profileDriver.licenseExpirationDate)}
                      />
                      <ProfileField label="Account status" value={profileDriver.status || "offline"} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="licence-section">
                  <div className="section-heading licence-heading">
                    <div>
                      <span className="section-eyebrow">Secure document</span>
                      <h4>Driver&apos;s licence image</h4>
                      <p>
                        This image is loaded through the protected administrator API
                        and is not exposed directly in the public database.
                      </p>
                    </div>

                    <div className="licence-number-badge">
                      <span>Licence number</span>
                      <strong>{profileDriver.licenseNumber || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="licence-view professional">
                    {isLicenseLoading ? (
                      <div className="licence-placeholder">
                        <span className="mini-spinner" />
                        <strong>Loading secure image</strong>
                        <span>Please wait while WasteTrack retrieves the licence.</span>
                      </div>
                    ) : profileLicenseUrl ? (
                      <img
                        src={profileLicenseUrl}
                        alt={`${profileDriver.name || "Driver"} licence`}
                      />
                    ) : (
                      <div className="licence-placeholder">
                        <span className="document-icon" aria-hidden="true">▧</span>
                        <strong>No licence image available</strong>
                        <span>
                          {profileError ||
                            "Upload or replace the licence image from Update Profile."}
                        </span>
                      </div>
                    )}
                  </div>

                  {profileError && profileLicenseUrl ? (
                    <div className="profile-inline-error" role="alert">
                      {profileError}
                    </div>
                  ) : null}

                  <div className="licence-summary-grid">
                    <ProfileField label="Driver" value={profileDriver.name} />
                    <ProfileField label="Expiration date" value={formatLicenceDate(profileDriver.licenseExpirationDate)} />
                    <ProfileField label="Assigned vehicle" value={profileDriver.truck} />
                  </div>
                </div>
              )}

              <div className="profile-modal-actions">
                <button
                  className="cancel-btn"
                  type="button"
                  onClick={closeDriverProfile}
                >
                  Close
                </button>

                <button
                  className="primary-action"
                  type="button"
                  onClick={() => {
                    const driver = profileDriver;
                    closeDriverProfile();
                    openEditDriver(driver);
                  }}
                >
                  Update Profile
                </button>
              </div>
            </section>
          </div>
        )}

      </div>

      <style jsx global>{`
        .users-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .users-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .users-stat-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .users-stat-card.green {
          background: linear-gradient(135deg, #ecfdf5, #ffffff);
        }

        .users-stat-card.blue {
          background: linear-gradient(135deg, #eff6ff, #ffffff);
        }

        .users-stat-card.dark {
          background: linear-gradient(135deg, #064e3b, #047857);
          color: #ffffff;
        }

        .users-stat-card .stat-label {
          display: block;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .users-stat-card.dark .stat-label,
        .users-stat-card.dark small {
          color: #d1fae5;
        }

        .users-stat-card strong {
          display: block;
          color: inherit;
          font-size: 34px;
          line-height: 1;
          margin-bottom: 8px;
        }

        .users-stat-card small {
          color: #64748b;
          font-size: 12px;
        }

        .users-toolbar {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          padding: 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .users-toolbar h2 {
          margin: 0;
          color: #0f172a;
          font-size: 22px;
        }

        .users-toolbar p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .users-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .search-box {
          width: 340px;
          height: 44px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f8fafc;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
        }

        .search-box span {
          color: #64748b;
          font-size: 18px;
        }

        .search-box input {
          width: 100%;
          border: 0;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-size: 14px;
        }

        .primary-action {
          height: 44px;
          border: 0;
          border-radius: 14px;
          background: #059669;
          color: #ffffff;
          padding: 0 18px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 20px rgba(5, 150, 105, 0.22);
        }

        .primary-action:hover {
          background: #047857;
        }

        .users-tabs {
          display: flex;
          gap: 10px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 8px;
          width: fit-content;
        }

        .users-tabs button {
          border: 0;
          background: transparent;
          color: #64748b;
          padding: 10px 14px;
          border-radius: 13px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .users-tabs button span {
          min-width: 24px;
          padding: 2px 7px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #475569;
          font-size: 12px;
        }

        .users-tabs button.active {
          background: #ecfdf5;
          color: #047857;
        }

        .users-tabs button.active span {
          background: #bbf7d0;
          color: #065f46;
        }

        .users-table-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .users-table {
          width: 100%;
          border-collapse: collapse;
        }

        .users-table thead {
          background: #f8fafc;
        }

        .users-table th {
          text-align: left;
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .users-table th.right {
          text-align: right;
        }

        .users-table td {
          padding: 16px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          vertical-align: middle;
        }

        .users-table tr:last-child td {
          border-bottom: 0;
        }

        .user-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-cell strong {
          display: block;
          color: #0f172a;
          font-size: 14px;
        }

        .user-cell span {
          display: block;
          color: #94a3b8;
          font-size: 12px;
          margin-top: 2px;
        }

        .user-avatar,
        .user-avatar-img {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          flex: 0 0 42px;
        }

        .user-avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-weight: 900;
          background: #0f766e;
        }

        .user-avatar.resident {
          background: #2563eb;
        }

        .user-avatar-img {
          object-fit: cover;
          border: 2px solid #e5e7eb;
        }

        .role-pill,
        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .role-pill.driver {
          background: #ecfdf5;
          color: #047857;
        }

        .role-pill.resident {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .status-pill.online,
        .status-pill.active {
          background: #dcfce7;
          color: #166534;
        }

        .status-pill.offline {
          background: #f1f5f9;
          color: #475569;
        }

        .status-pill.pending {
          background: #fef3c7;
          color: #92400e;
        }

        .contact-cell,
        .area-cell {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .contact-cell span,
        .area-cell strong {
          color: #0f172a;
          font-weight: 700;
        }

        .contact-cell small,
        .area-cell span {
          color: #64748b;
          font-size: 12px;
        }

        .row-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .soft-btn,
        .danger-btn,
        .cancel-btn {
          height: 36px;
          border: 0;
          border-radius: 11px;
          padding: 0 12px;
          font-weight: 800;
          cursor: pointer;
        }

        .soft-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .soft-btn:hover {
          background: #e2e8f0;
        }

        .danger-btn {
          background: #fee2e2;
          color: #b91c1c;
        }

        .danger-btn:hover {
          background: #fecaca;
        }

        .empty-state {
          padding: 40px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          color: #64748b;
        }

        .empty-state strong {
          color: #0f172a;
          font-size: 16px;
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.52);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
        }

        .modal-card {
          width: min(760px, 100%);
          max-height: calc(100dvh - 40px);
          overflow-y: auto;
          background: #ffffff;
          border-radius: 24px;
          padding: 22px;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.3);
        }

        .modal-card.small {
          width: min(420px, 100%);
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 18px;
        }

        .modal-header h3 {
          margin: 0;
          color: #0f172a;
          font-size: 20px;
        }

        .modal-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .modal-close {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 0;
          background: #f1f5f9;
          color: #334155;
          font-size: 22px;
          cursor: pointer;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        label,
        .single-label {
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        label input,
        label select,
        .single-label input {
          height: 44px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 0 12px;
          outline: none;
          color: #0f172a;
          background: #f8fafc;
        }

        label select {
          height: 44px;
          padding: 0 12px;
        }

        label input:focus,
        label select:focus,
        .single-label input:focus {
          border-color: #10b981;
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }

        .cancel-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .form-error {
          border: 1px solid #fecaca;
          border-radius: 13px;
          background: #fef2f2;
          color: #b91c1c;
          padding: 11px 13px;
          font-size: 13px;
          font-weight: 700;
        }

        .full-error {
          margin-bottom: 14px;
        }

        .license-picker {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 14px;
          padding: 14px;
          border: 1px solid #dbe4df;
          border-radius: 18px;
          background: #f8faf9;
        }

        .license-preview {
          min-height: 118px;
          overflow: hidden;
          border-radius: 14px;
          border: 1px dashed #a7b8af;
          background: #eef4f1;
          display: grid;
          place-items: center;
          color: #64748b;
          text-align: center;
          font-size: 12px;
          padding: 10px;
        }

        .license-preview img {
          width: 100%;
          height: 118px;
          object-fit: contain;
        }

        .license-copy strong,
        .license-copy span,
        .license-copy small {
          display: block;
        }

        .license-copy strong { color: #0f172a; font-size: 14px; }
        .license-copy span { color: #475569; font-size: 12px; margin-top: 5px; }
        .license-copy small { color: #64748b; font-size: 11px; margin-top: 5px; }

        .file-button {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          margin-top: 12px;
          padding: 9px 12px;
          border-radius: 11px;
          background: #dcfce7;
          color: #166534;
          cursor: pointer;
          font-weight: 900;
        }

        .file-button input { position: absolute; opacity: 0; pointer-events: none; }

        .profile-modal {
          width: min(940px, 100%);
          padding: 0;
          overflow: hidden;
          border: 1px solid rgba(203, 213, 225, 0.9);
        }

        .profile-hero {
          position: relative;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 18px;
          padding: 24px;
          background:
            radial-gradient(circle at 100% 0%, rgba(52, 211, 153, 0.16), transparent 34%),
            linear-gradient(135deg, #f8fffc, #eef8f3);
          border-bottom: 1px solid #dfeae4;
        }

        .profile-hero-copy {
          min-width: 0;
        }

        .profile-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }

        .profile-kicker,
        .section-eyebrow {
          color: #047857;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .profile-hero h3 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(24px, 3vw, 32px);
          letter-spacing: -0.035em;
        }

        .profile-hero p {
          max-width: 650px;
          margin: 7px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.6;
        }

        .profile-meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin-top: 12px;
          color: #64748b;
          font-size: 12px;
        }

        .profile-close {
          align-self: start;
        }

        .driver-profile-avatar {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          overflow: hidden;
          border-radius: 22px;
          background: linear-gradient(145deg, #059669, #065f46);
          color: #ffffff;
          box-shadow: 0 14px 30px rgba(5, 150, 105, 0.2);
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .driver-profile-avatar.normal {
          width: 72px;
          height: 72px;
          font-size: 22px;
        }

        .driver-profile-avatar.large {
          width: 132px;
          height: 132px;
          border-radius: 30px;
          font-size: 38px;
        }

        .driver-profile-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .profile-tabs {
          display: flex;
          gap: 6px;
          padding: 12px 24px 0;
          background: #ffffff;
          border-bottom: 1px solid #edf2ef;
        }

        .profile-tabs button {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          padding: 0 15px;
          border: 0;
          border-radius: 12px 12px 0 0;
          background: transparent;
          color: #64748b;
          font-weight: 850;
          cursor: pointer;
        }

        .profile-tabs button.active {
          background: #ecfdf5;
          color: #047857;
        }

        .profile-tabs button.active::after {
          content: "";
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: -1px;
          height: 3px;
          border-radius: 999px;
          background: #10b981;
        }

        .available-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #10b981;
        }

        .profile-overview-layout {
          display: grid;
          grid-template-columns: 250px minmax(0, 1fr);
          gap: 18px;
          padding: 24px;
        }

        .profile-photo-card,
        .profile-information-card,
        .licence-section {
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #ffffff;
        }

        .profile-photo-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 300px;
          padding: 24px;
          text-align: center;
          background:
            radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.12), transparent 40%),
            #fbfefd;
        }

        .profile-photo-card .section-eyebrow {
          align-self: flex-start;
          margin-bottom: 24px;
        }

        .profile-photo-card > strong {
          margin-top: 16px;
          color: #0f172a;
          font-size: 17px;
        }

        .profile-photo-card > span:last-child {
          margin-top: 5px;
          color: #64748b;
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .profile-information-card {
          padding: 20px;
        }

        .section-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .section-heading h4 {
          margin: 5px 0 0;
          color: #0f172a;
          font-size: 19px;
        }

        .section-heading p {
          max-width: 580px;
          margin: 6px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.55;
        }

        .profile-detail-grid,
        .licence-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .profile-field {
          min-height: 68px;
          padding: 12px 13px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1px solid #edf1f4;
        }

        .profile-field small,
        .profile-field strong {
          display: block;
        }

        .profile-field small {
          color: #64748b;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .profile-field strong {
          margin-top: 6px;
          color: #0f172a;
          font-size: 13px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .licence-section {
          margin: 24px;
          padding: 20px;
        }

        .licence-heading {
          align-items: center;
        }

        .licence-number-badge {
          min-width: 180px;
          padding: 10px 12px;
          border: 1px solid #d9ebe2;
          border-radius: 14px;
          background: #f0fdf7;
        }

        .licence-number-badge span,
        .licence-number-badge strong {
          display: block;
        }

        .licence-number-badge span {
          color: #64748b;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .licence-number-badge strong {
          margin-top: 5px;
          color: #065f46;
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .licence-view {
          min-height: 370px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 1px solid #dbe4df;
          border-radius: 18px;
          background:
            linear-gradient(45deg, #f7faf8 25%, transparent 25%),
            linear-gradient(-45deg, #f7faf8 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #f7faf8 75%),
            linear-gradient(-45deg, transparent 75%, #f7faf8 75%),
            #ffffff;
          background-size: 22px 22px;
          background-position: 0 0, 0 11px, 11px -11px, -11px 0;
        }

        .licence-view img {
          width: 100%;
          max-height: 520px;
          object-fit: contain;
          background: rgba(255, 255, 255, 0.9);
        }

        .licence-placeholder {
          min-height: 370px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 8px;
          padding: 28px;
          color: #64748b;
          text-align: center;
        }

        .licence-placeholder strong {
          color: #334155;
          font-size: 16px;
        }

        .licence-placeholder span:last-child {
          max-width: 360px;
          font-size: 12px;
          line-height: 1.55;
        }

        .document-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #ecfdf5;
          color: #047857;
          font-size: 25px;
        }

        .licence-summary-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-top: 14px;
        }

        .profile-inline-error {
          margin-top: 12px;
          padding: 11px 13px;
          border: 1px solid #fecaca;
          border-radius: 13px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 12px;
          font-weight: 700;
        }

        .profile-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 0 24px 24px;
        }

        .mini-spinner {
          width: 28px;
          height: 28px;
          border: 3px solid #d1fae5;
          border-top-color: #059669;
          border-radius: 50%;
          animation: driver-spin 0.8s linear infinite;
        }

        @keyframes driver-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1100px) {
          .users-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .users-toolbar {
            flex-direction: column;
            align-items: stretch;
          }

          .users-actions {
            flex-direction: column;
            align-items: stretch;
          }

          .search-box {
            width: 100%;
          }

          .primary-action {
            width: 100%;
          }

          .users-table-card {
            overflow-x: auto;
          }

          .users-table {
            min-width: 980px;
          }
        }

        @media (max-width: 640px) {
          .users-stats-grid {
            grid-template-columns: 1fr;
          }

          .users-tabs {
            width: 100%;
            overflow-x: auto;
          }

          .form-grid {
            grid-template-columns: 1fr;
          }

          .license-picker,
          .profile-overview-layout,
          .profile-detail-grid,
          .licence-summary-grid {
            grid-template-columns: 1fr;
          }

          .profile-overview-layout {
            padding: 16px;
          }

          .profile-hero {
            grid-template-columns: auto minmax(0, 1fr);
            padding: 18px;
          }

          .profile-close {
            position: absolute;
            top: 14px;
            right: 14px;
          }

          .profile-tabs {
            overflow-x: auto;
            padding-inline: 16px;
          }

          .licence-section {
            margin: 16px;
            padding: 16px;
          }

          .licence-heading {
            flex-direction: column;
          }

          .licence-number-badge {
            width: 100%;
          }
        }
      `}</style>
    </DashboardShell>
  );
}

/* ================= HELPERS ================= */

type DriverFormState = typeof emptyForm;

function DriverFields({
  form,
  setForm,
  includePassword = false,
}: {
  form: DriverFormState;
  setForm: (value: DriverFormState) => void;
  includePassword?: boolean;
}) {
  return (
    <div className="form-grid">
      <label>
        Full Name
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Enter driver name" autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="driver@example.com" autoComplete="email" />
      </label>
      <label>
        Contact Number
        <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="09XXXXXXXXX" autoComplete="tel" />
      </label>
      <label>
        Assigned Vehicle
        <input value={form.truck} onChange={(event) => setForm({ ...form, truck: event.target.value })} placeholder="Truck 01 / plate number" />
      </label>
      <label>
        Licence Number
        <input value={form.licenseNumber} onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })} placeholder="Enter licence number" />
      </label>
      <label>
        Licence Expiration Date
        <input type="date" value={form.licenseExpirationDate} onChange={(event) => setForm({ ...form, licenseExpirationDate: event.target.value })} />
      </label>
      {includePassword && (
        <label>
          Temporary Password
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 6 characters" autoComplete="new-password" />
        </label>
      )}
    </div>
  );
}

function LicensePicker({
  preview,
  hasStoredImage,
  onChange,
}: {
  preview: string;
  hasStoredImage: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="license-picker">
      <div className="license-preview">
        {preview ? <img src={preview} alt="Driver licence preview" /> : <span>{hasStoredImage ? "A secure licence image is already stored." : "Licence image preview"}</span>}
      </div>
      <div className="license-copy">
        <strong>Driver&apos;s Licence Image</strong>
        <span>{hasStoredImage ? "Choose a new image only when replacing the current file." : "Upload the front of the driver’s licence."}</span>
        <small>Accepted: JPG, JPEG, PNG • Maximum: 5 MB</small>
        <label className="file-button">
          {preview ? "Choose another image" : hasStoredImage ? "Replace image" : "Choose image"}
          <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(event) => onChange(event.target.files?.[0] || null)} />
        </label>
      </div>
    </div>
  );
}

function normalizeDriverImageSource(value?: string): string {
  const source = String(value || "").trim();

  if (!source) return "";

  if (
    source.startsWith("data:") ||
    source.startsWith("blob:") ||
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("/")
  ) {
    return source;
  }

  return `data:image/jpeg;base64,${source}`;
}

function DriverProfileAvatar({
  driver,
  large = false,
}: {
  driver: Driver;
  large?: boolean;
}) {
  const source = normalizeDriverImageSource(driver.profileImage);

  return (
    <div className={`driver-profile-avatar ${large ? "large" : "normal"}`}>
      {source ? (
        <img
          src={source}
          alt={`${driver.name || "Driver"} profile`}
        />
      ) : (
        <span>{getInitials(driver.name || "Driver")}</span>
      )}
    </div>
  );
}

async function readImageApiError(response: Response): Promise<string> {
  const fallback =
    response.status === 401 || response.status === 403
      ? "Your administrator session is not authorized to view this licence."
      : response.status === 404
        ? "No driver licence image is currently stored."
        : "The driver licence image could not be loaded.";

  try {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (!contentType.includes("application/json")) {
      return fallback;
    }

    const body = (await response.json()) as { error?: unknown };
    const message = String(body?.error || "").trim();

    return message || fallback;
  } catch {
    return fallback;
  }
}

function ProfileField({ label, value }: { label: string; value?: string }) {
  return <div className="profile-field"><small>{label}</small><strong>{value || "Not provided"}</strong></div>;
}

function buildDriverFormData(form: DriverFormState, licenseFile: File | null) {
  const body = new FormData();
  Object.entries(form).forEach(([key, value]) => body.set(key, value));
  if (licenseFile) body.set("licenseImage", licenseFile, licenseFile.name);
  return body;
}

async function getAdminToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  return user.getIdToken(true);
}

async function readDriverApiResponse(response: Response): Promise<DriverApiResponse> {
  const rawBody = await response.text();
  const body = rawBody.trim();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!body) {
    throw new Error(
      response.ok
        ? "The driver service returned an empty response."
        : `The driver service failed with status ${response.status}.`,
    );
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("INVALID_JSON_OBJECT");
    }
    return parsed as DriverApiResponse;
  } catch {
    const isHtml = contentType.includes("text/html") || /^<!doctype\s+html|^<html/i.test(body);
    const redirectedToLogin = response.redirected || /\/login(?:\?|$)/i.test(response.url);

    if (redirectedToLogin || response.status === 401) {
      throw new Error("Your administrator session expired. Sign in again, then retry creating the driver.");
    }
    if (response.status === 404) {
      throw new Error("The Create Driver API was not found. Add app/api/create-driver/route.ts and restart the Next.js server.");
    }
    if (isHtml) {
      throw new Error(
        `The Create Driver API returned an HTML error page (status ${response.status}). Restart the Next.js server and check its terminal for the server error.`,
      );
    }
    throw new Error(`The Create Driver API returned an invalid response (status ${response.status}).`);
  }
}

function formatLicenceDate(value?: string) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

function getInitials(name: string) {
  const parts = name.trim().split(" ").filter(Boolean);

  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function shortId(id: string) {
  if (!id) return "-";
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

function formatDate(value?: number) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "-";
  }
}

function getStatusClass(status: string) {
  const value = (status || "").toLowerCase();

  if (value.includes("online")) return "online";
  if (value.includes("active")) return "active";
  if (value.includes("pending")) return "pending";

  return "offline";
}
