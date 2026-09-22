"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { onValue, ref, remove } from "@/lib/offlineFirebaseDatabase";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";
import { ScheduleDialog } from "../schedules/ScheduleDialog";
import { ScheduleIcon } from "../schedules/ScheduleIcons";
import styles from "../schedules/schedules.module.css";

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

const makeBarangayFilterKey = (value?: string) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getResidentPurokLabel = (resident?: Resident) => {
  const savedLabel = String(resident?.purokLabel || "").trim();
  if (savedLabel) return savedLabel;

  const rawPurok = String(resident?.purok ?? "").trim();
  if (!rawPurok) return "Unassigned Purok";

  return /^purok\b/i.test(rawPurok) ? rawPurok : `Purok ${rawPurok}`;
};

const makePurokFilterKey = (resident?: Resident) =>
  getResidentPurokLabel(resident)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unassigned_purok";

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

const DRIVER_STEPS = [
  { label: "Driver details", hint: "Identity, contact, vehicle, and sign in" },
  { label: "Driver licence", hint: "Licence details and both image sides" },
  { label: "Review", hint: "Confirm everything before creating" },
] as const;

export default function UsersPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [selectedBarangay, setSelectedBarangay] = useState("all");
  const [selectedPurok, setSelectedPurok] = useState("all");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState("");
  const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null);
  const [licenseBackPreview, setLicenseBackPreview] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [driverStep, setDriverStep] = useState(0);
  const [highestDriverStep, setHighestDriverStep] = useState(0);
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const [editDriverId, setEditDriverId] = useState<string | null>(null);
  const [profileDriver, setProfileDriver] = useState<Driver | null>(null);
  const [profileLicenseUrl, setProfileLicenseUrl] = useState("");
  const [profileLicenseBackUrl, setProfileLicenseBackUrl] = useState("");
  const [isLicenseLoading, setIsLicenseLoading] = useState(false);
  const [profileLicenseErrors, setProfileLicenseErrors] = useState({
    front: "",
    back: "",
  });
  const [profileTab, setProfileTab] = useState<"overview" | "licence">("overview");
  const [createdCredential, setCreatedCredential] = useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);
  const [showCreatedPassword, setShowCreatedPassword] = useState(true);
  const [credentialCopied, setCredentialCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (profileLicenseUrl) {
        URL.revokeObjectURL(profileLicenseUrl);
      }
    };
  }, [profileLicenseUrl]);

  useEffect(() => {
    return () => {
      if (profileLicenseBackUrl) {
        URL.revokeObjectURL(profileLicenseBackUrl);
      }
    };
  }, [profileLicenseBackUrl]);

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
      const purokText = getResidentPurokLabel(resident);

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

  /* ================= RESIDENT BARANGAY / PUROK FOLDERS ================= */
  const residentBarangayFolders = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; name: string; count: number; purokKeys: Set<string> }
    >();

    residents.forEach((resident) => {
      const name = (resident.barangay || "Unassigned Barangay").trim();
      const key = resident.barangayKey || makeBarangayFilterKey(name) || "unassigned";
      const purokKey = makePurokFilterKey(resident);
      const existing = groups.get(key);

      if (existing) {
        existing.count += 1;
        existing.purokKeys.add(purokKey);
      } else {
        groups.set(key, { key, name, count: 1, purokKeys: new Set([purokKey]) });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({
        key: group.key,
        name: group.name,
        count: group.count,
        purokCount: group.purokKeys.size,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [residents]);

  const selectedBarangayFolder = useMemo(
    () => residentBarangayFolders.find((folder) => folder.key === selectedBarangay) || null,
    [residentBarangayFolders, selectedBarangay],
  );

  const residentPurokFolders = useMemo(() => {
    if (selectedBarangay === "all") return [];

    const groups = new Map<string, { key: string; name: string; count: number }>();

    residents.forEach((resident) => {
      const barangayName = (resident.barangay || "Unassigned Barangay").trim();
      const barangayKey =
        resident.barangayKey || makeBarangayFilterKey(barangayName) || "unassigned";

      if (barangayKey !== selectedBarangay) return;

      const name = getResidentPurokLabel(resident);
      const key = makePurokFilterKey(resident);
      const existing = groups.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, { key, name, count: 1 });
      }
    });

    return Array.from(groups.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [residents, selectedBarangay]);

  useEffect(() => {
    if (selectedBarangay === "all") {
      setSelectedPurok("all");
      return;
    }

    const stillExists = residentBarangayFolders.some(
      (folder) => folder.key === selectedBarangay,
    );

    if (!stillExists) {
      setSelectedBarangay("all");
      setSelectedPurok("all");
    }
  }, [residentBarangayFolders, selectedBarangay]);

  useEffect(() => {
    if (selectedPurok === "all") return;

    const stillExists = residentPurokFolders.some(
      (folder) => folder.key === selectedPurok,
    );

    if (!stillExists) setSelectedPurok("all");
  }, [residentPurokFolders, selectedPurok]);

  /* ================= FILTER ================= */
  const filteredUsers = useMemo(() => {
    let list = allUsers;

    if (activeTab === "drivers") {
      list = list.filter((user) => user.type === "driver");
    }

    if (activeTab === "residents") {
      list = list.filter((user) => user.type === "resident");

      if (selectedBarangay !== "all") {
        list = list.filter((user) => {
          const resident = user.rawResident;
          if (!resident) return false;
          const key =
            resident.barangayKey ||
            makeBarangayFilterKey(resident.barangay) ||
            "unassigned";
          return key === selectedBarangay;
        });

        if (selectedPurok !== "all") {
          list = list.filter((user) =>
            user.rawResident
              ? makePurokFilterKey(user.rawResident) === selectedPurok
              : false,
          );
        }
      }
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
  }, [allUsers, activeTab, search, selectedBarangay, selectedPurok]);

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

  const normalizedCreateEmail = form.email.trim().toLowerCase();
  const driverAccountStepValid = Boolean(
    form.name.trim() &&
    normalizedCreateEmail &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCreateEmail) &&
    form.phone.trim() &&
    form.truck.trim() &&
    form.password.length >= 6,
  );

  const createLicenceExpiry = form.licenseExpirationDate
    ? new Date(`${form.licenseExpirationDate}T23:59:59`)
    : null;
  const createLicenceDateValid = Boolean(
    createLicenceExpiry &&
    !Number.isNaN(createLicenceExpiry.getTime()) &&
    createLicenceExpiry.getTime() >= Date.now(),
  );
  const driverLicenceStepValid = Boolean(
    form.licenseNumber.trim() &&
    createLicenceDateValid &&
    licenseFile &&
    licenseBackFile,
  );
  const driverAllStepsValid = driverAccountStepValid && driverLicenceStepValid;
  const driverCanAdvance = [driverAccountStepValid, driverLicenceStepValid, driverAllStepsValid];

  const getDriverStepError = (step: number): string => {
    if (step === 0) {
      if (!form.name.trim() || !normalizedCreateEmail || !form.phone.trim() || !form.truck.trim()) {
        return "Full name, email, contact number, and assigned vehicle are required.";
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCreateEmail)) {
        return "Enter a valid email address, such as driver@example.com.";
      }
      if (form.password.length < 6) {
        return "Password must contain at least 6 characters.";
      }
      return "";
    }

    if (step === 1) {
      if (!form.licenseNumber.trim() || !form.licenseExpirationDate) {
        return "Licence number and expiration date are required.";
      }
      if (!createLicenceExpiry || Number.isNaN(createLicenceExpiry.getTime())) {
        return "Enter a valid licence expiration date.";
      }
      if (createLicenceExpiry.getTime() < Date.now()) {
        return "The driver's licence is already expired.";
      }
      if (!licenseFile || !licenseBackFile) {
        return "Upload both the front and back images of the driver's licence.";
      }
    }

    return "";
  };

  const nextDriverStep = () => {
    const error = getDriverStepError(driverStep);
    if (error) {
      setFormError(error);
      return;
    }

    setFormError("");
    setDriverStep((current) => {
      const next = Math.min(current + 1, DRIVER_STEPS.length - 1);
      setHighestDriverStep((highest) => Math.max(highest, next));
      return next;
    });
  };

  const requestCloseCreateDriver = () => {
    if (isSaving) return;
    setShowModal(false);
    setForm(emptyForm);
    setFormError("");
    setDriverStep(0);
    setHighestDriverStep(0);
    setShowCreatePassword(false);
    clearLicenseSelection();
  };

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
    setDriverStep(0);
    setFormError(
      "Full name, email, contact number, and assigned vehicle are required.",
    );
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    setDriverStep(0);
    setFormError(
      "Enter a valid email address, such as driver@example.com.",
    );
    return;
  }

  if (
    !normalizedLicenseNumber ||
    !form.licenseExpirationDate ||
    !licenseFile ||
    !licenseBackFile
  ) {
    setDriverStep(1);
    setHighestDriverStep((highest) => Math.max(highest, 1));
    setFormError(
      "Licence number, expiration date, and both front and back licence images are required.",
    );
    return;
  }

  const expirationDate = new Date(
    `${form.licenseExpirationDate}T23:59:59`,
  );

  if (Number.isNaN(expirationDate.getTime())) {
    setDriverStep(1);
    setFormError("Enter a valid licence expiration date.");
    return;
  }

  if (expirationDate.getTime() < Date.now()) {
    setDriverStep(1);
    setFormError("The driver's licence is already expired.");
    return;
  }

  if (form.password.length < 6) {
    setDriverStep(0);
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
      licenseBackFile,
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

    setCreatedCredential({
      name: normalizedName,
      email: normalizedEmail,
      password: form.password,
    });
    setShowCreatedPassword(true);
    setCredentialCopied(false);
    setShowModal(false);
    setForm(emptyForm);
    setDriverStep(0);
    setHighestDriverStep(0);
    setShowCreatePassword(false);
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
    if (licenseBackPreview) URL.revokeObjectURL(licenseBackPreview);
    setLicenseFile(null);
    setLicensePreview("");
    setLicenseBackFile(null);
    setLicenseBackPreview("");
  };

  const selectLicenseImage = (file: File | null) => {
    setFormError("");
    if (licensePreview) URL.revokeObjectURL(licensePreview);
    setLicenseFile(null);
    setLicensePreview("");
    if (!file) return;
    if (!ALLOWED_LICENSE_TYPES.has(file.type)) {
      setFormError("Front licence image must be JPG, JPEG, or PNG.");
      return;
    }
    if (file.size > MAX_LICENSE_BYTES) {
      setFormError("Front licence image must not exceed 5 MB.");
      return;
    }
    setLicenseFile(file);
    setLicensePreview(URL.createObjectURL(file));
  };

  const selectLicenseBackImage = (file: File | null) => {
    setFormError("");
    if (licenseBackPreview) URL.revokeObjectURL(licenseBackPreview);
    setLicenseBackFile(null);
    setLicenseBackPreview("");
    if (!file) return;
    if (!ALLOWED_LICENSE_TYPES.has(file.type)) {
      setFormError("Back licence image must be JPG, JPEG, or PNG.");
      return;
    }
    if (file.size > MAX_LICENSE_BYTES) {
      setFormError("Back licence image must not exceed 5 MB.");
      return;
    }
    setLicenseBackFile(file);
    setLicenseBackPreview(URL.createObjectURL(file));
  };

  const openCreateDriver = () => {
    clearLicenseSelection();
    setForm(emptyForm);
    setFormError("");
    setDriverStep(0);
    setHighestDriverStep(0);
    setShowCreatePassword(false);
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
    if (profileLicenseBackUrl) {
      URL.revokeObjectURL(profileLicenseBackUrl);
    }

    setProfileDriver(null);
    setProfileLicenseUrl("");
    setProfileLicenseBackUrl("");
    setProfileLicenseErrors({ front: "", back: "" });
    setProfileTab("overview");
    setIsLicenseLoading(false);
  };

  const openDriverProfile = async (driver: Driver) => {
    if (profileLicenseUrl) {
      URL.revokeObjectURL(profileLicenseUrl);
    }
    if (profileLicenseBackUrl) {
      URL.revokeObjectURL(profileLicenseBackUrl);
    }

    setProfileDriver(driver);
    setProfileLicenseUrl("");
    setProfileLicenseBackUrl("");
    setProfileLicenseErrors({ front: "", back: "" });
    setProfileTab("overview");
    setIsLicenseLoading(true);

    try {
      const token = await getAdminToken();

      const loadLicenceSide = async (side: "front" | "back") => {
        const response = await fetch(
          `/api/driver-license?driverId=${encodeURIComponent(driver.id)}&side=${side}`,
          {
            method: "GET",
            headers: {
              Accept: "image/jpeg,image/png,application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        if (!response.ok) {
          const message = await readImageApiError(response);
          return { side, url: "", error: message };
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();

        if (!contentType.startsWith("image/")) {
          return {
            side,
            url: "",
            error: `The ${side} licence service returned an invalid image response.`,
          };
        }

        const blob = await response.blob();

        if (blob.size === 0) {
          return {
            side,
            url: "",
            error: `The stored ${side} licence image is empty.`,
          };
        }

        return { side, url: URL.createObjectURL(blob), error: "" };
      };

      const [frontResult, backResult] = await Promise.all([
        loadLicenceSide("front"),
        loadLicenceSide("back"),
      ]);

      setProfileLicenseUrl(frontResult.url);
      setProfileLicenseBackUrl(backResult.url);
      setProfileLicenseErrors({
        front: frontResult.error,
        back: backResult.error,
      });
    } catch (error) {
      console.error("Driver licence loading error:", error);
      const message =
        error instanceof Error
          ? error.message
          : "The driver licence images could not be loaded.";

      setProfileLicenseErrors({ front: message, back: message });
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
      title="Accounts & Drivers"
      description="Create driver accounts and review registered residents."
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
            onClick={() => { setActiveTab("all"); setSelectedBarangay("all"); setSelectedPurok("all"); }}
          >
            All Users
            <span>{stats.totalUsers}</span>
          </button>

          <button
            className={activeTab === "drivers" ? "active" : ""}
            onClick={() => { setActiveTab("drivers"); setSelectedBarangay("all"); setSelectedPurok("all"); }}
          >
            Drivers
            <span>{stats.totalDrivers}</span>
          </button>

          <button
            className={activeTab === "residents" ? "active" : ""}
            onClick={() => { setActiveTab("residents"); setSelectedBarangay("all"); setSelectedPurok("all"); }}
          >
            Residents
            <span>{stats.totalResidents}</span>
          </button>
        </div>

        {activeTab === "residents" && (
          <section className="barangay-folders" aria-label="Residents by Barangay and Purok">
            <div className="barangay-folders-header">
              <div>
                <h3>Residents by Barangay</h3>
                <p>Select a Barangay folder, then choose a Purok to narrow the resident list.</p>
              </div>
              <span className="barangay-folder-total">{stats.totalResidents} residents</span>
            </div>

            <div className="barangay-folder-grid">
              <button
                type="button"
                className={`barangay-folder ${selectedBarangay === "all" ? "active" : ""}`}
                onClick={() => { setSelectedBarangay("all"); setSelectedPurok("all"); }}
              >
                <span className="barangay-folder-icon" aria-hidden="true" />
                <span className="barangay-folder-copy">
                  <strong>All Barangays</strong>
                  <small>{stats.totalResidents} residents · {residentBarangayFolders.length} barangays</small>
                </span>
              </button>

              {residentBarangayFolders.map((folder) => (
                <button
                  type="button"
                  key={folder.key}
                  className={`barangay-folder ${selectedBarangay === folder.key ? "active" : ""}`}
                  onClick={() => { setSelectedBarangay(folder.key); setSelectedPurok("all"); }}
                >
                  <span className="barangay-folder-icon" aria-hidden="true" />
                  <span className="barangay-folder-copy">
                    <strong>{folder.name}</strong>
                    <small>
                      {folder.count} {folder.count === 1 ? "resident" : "residents"} · {folder.purokCount} {folder.purokCount === 1 ? "purok" : "puroks"}
                    </small>
                  </span>
                </button>
              ))}
            </div>

            {selectedBarangay !== "all" && selectedBarangayFolder && (
              <div className="purok-folder-section">
                <div className="purok-folder-header">
                  <div>
                    <span className="purok-eyebrow">PUROK BREAKDOWN</span>
                    <h4>{selectedBarangayFolder.name}</h4>
                    <p>Choose a Purok folder to display only residents registered in that area.</p>
                  </div>
                  <span className="purok-total">
                    {selectedBarangayFolder.count} {selectedBarangayFolder.count === 1 ? "resident" : "residents"}
                  </span>
                </div>

                <div className="purok-folder-grid">
                  <button
                    type="button"
                    className={`purok-folder ${selectedPurok === "all" ? "active" : ""}`}
                    onClick={() => setSelectedPurok("all")}
                  >
                    <span className="purok-folder-number">ALL</span>
                    <span className="purok-folder-copy">
                      <strong>All Puroks</strong>
                      <small>{selectedBarangayFolder.count} residents</small>
                    </span>
                  </button>

                  {residentPurokFolders.map((folder, index) => (
                    <button
                      type="button"
                      key={folder.key}
                      className={`purok-folder ${selectedPurok === folder.key ? "active" : ""}`}
                      onClick={() => setSelectedPurok(folder.key)}
                    >
                      <span className="purok-folder-number">{index + 1}</span>
                      <span className="purok-folder-copy">
                        <strong>{folder.name}</strong>
                        <small>{folder.count} {folder.count === 1 ? "resident" : "residents"}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}


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
                      <span>Try changing your search, Barangay, Purok, or selected tab.</span>
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

        {/* ADD DRIVER — SAME FULL-SCREEN WORKSPACE AS SCHEDULES / ROUTES */}
        {showModal ? (
          <ScheduleDialog
            fullScreen
            labelledBy="create-driver-title"
            busy={isSaving}
            onDismiss={requestCloseCreateDriver}
          >
            <header className={styles.dialogHeader}>
              <div className={styles.dialogTitleGroup}>
                <span className={styles.brandMark}>
                  <ScheduleIcon name="users" size={22} />
                </span>
                <div>
                  <span className={styles.eyebrow}>MetroWaste · Driver management</span>
                  <h2 id="create-driver-title" data-dialog-heading tabIndex={-1}>
                    Create driver account
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close driver creator"
                disabled={isSaving}
                onClick={requestCloseCreateDriver}
              >
                <ScheduleIcon name="close" />
              </button>
            </header>

            <div className={styles.plannerLayout}>
              <aside className={styles.plannerSidebar} aria-label="Driver creation steps">
                <p className={styles.sidebarCaption}>Driver setup</p>
                <ol className={styles.stepNav}>
                  {DRIVER_STEPS.map((item, index) => (
                    <li key={item.label}>
                      <button
                        type="button"
                        className={styles.stepNavButton}
                        aria-current={driverStep === index ? "step" : undefined}
                        disabled={isSaving || index > highestDriverStep}
                        onClick={() => {
                          setFormError("");
                          setDriverStep(index);
                        }}
                      >
                        <span
                          className={styles.stepNumber}
                          data-complete={index < driverStep && driverCanAdvance[index]}
                        >
                          {index < driverStep && driverCanAdvance[index]
                            ? <ScheduleIcon name="check" size={16} />
                            : index + 1}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.hint}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className={styles.sidebarNote}>
                  <ScheduleIcon name="info" size={18} />
                  <p>
                    Create the driver profile first, upload both sides of the Driver licence,
                    then review the information before saving the account.
                  </p>
                </div>
              </aside>

              <div className={styles.plannerScroll} key={driverStep}>
                <div className={styles.stepContent}>
                  <div className={styles.stepTitle}>
                    <span className={styles.stepCounter}>
                      Step {driverStep + 1} of {DRIVER_STEPS.length}
                    </span>
                    <h2 tabIndex={-1}>
                      {[
                        "Who is the collection driver?",
                        "What are the driver's licence details?",
                        "Does the driver account look correct?",
                      ][driverStep]}
                    </h2>
                    <p>
                      {[
                        "Enter the driver's identity, contact information, assigned vehicle, and temporary sign in password.",
                        "Enter the licence details and upload clear images of both the front and back sides.",
                        "Review the driver information and licence uploads before creating the account.",
                      ][driverStep]}
                    </p>
                  </div>

                  {formError ? (
                    <div className={styles.errorNotice} role="alert">
                      <ScheduleIcon name="info" size={18} />
                      {formError}
                    </div>
                  ) : null}

                  <fieldset className={styles.formFields} disabled={isSaving}>
                    <legend className={styles.srOnly}>{DRIVER_STEPS[driverStep].label}</legend>

                    {driverStep === 0 ? <>
                      <div className={styles.twoFields}>
                        <label className={styles.field}>
                          <span>Full name</span>
                          <input
                            value={form.name}
                            onChange={(event) => setForm({ ...form, name: event.target.value })}
                            placeholder="Enter driver name"
                            autoComplete="name"
                          />
                          <small>Use the driver's complete name.</small>
                        </label>
                        <label className={styles.field}>
                          <span>Email address</span>
                          <input
                            type="email"
                            value={form.email}
                            onChange={(event) => setForm({ ...form, email: event.target.value })}
                            placeholder="driver@example.com"
                            autoComplete="email"
                          />
                          <small>This email will be used for driver sign in.</small>
                        </label>
                      </div>

                      <div className={styles.twoFields}>
                        <label className={styles.field}>
                          <span>Contact number</span>
                          <input
                            type="tel"
                            value={form.phone}
                            onChange={(event) => setForm({ ...form, phone: event.target.value })}
                            placeholder="09XXXXXXXXX"
                            autoComplete="tel"
                          />
                          <small>Enter the driver's active mobile number.</small>
                        </label>
                        <label className={styles.field}>
                          <span>Assigned vehicle</span>
                          <input
                            value={form.truck}
                            onChange={(event) => setForm({ ...form, truck: event.target.value })}
                            placeholder="Truck 01 / plate number"
                          />
                          <small>Enter the assigned truck name or plate number.</small>
                        </label>
                      </div>

                      <label className={styles.field}>
                        <span>Password</span>
                        <div className="driver-password-field">
                          <input
                            type={showCreatePassword ? "text" : "password"}
                            value={form.password}
                            onChange={(event) => setForm({ ...form, password: event.target.value })}
                            placeholder="At least 6 characters"
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            className="driver-password-toggle"
                            onClick={() => setShowCreatePassword((visible) => !visible)}
                            aria-label={showCreatePassword ? "Hide password" : "Show password"}
                          >
                            {showCreatePassword ? "Hide" : "Show"}
                          </button>
                        </div>
                        <small>
                          Verify the password before saving. It will be shown once after account creation.
                        </small>
                      </label>

                      <div className={styles.neutralNotice}>
                        <ScheduleIcon name="info" size={20} />
                        <p>The driver can use this account to sign in to the Driver App after creation.</p>
                      </div>
                    </> : null}

                    {driverStep === 1 ? <>
                      <div className={styles.twoFields}>
                        <label className={styles.field}>
                          <span>Licence number</span>
                          <input
                            value={form.licenseNumber}
                            onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })}
                            placeholder="Enter licence number"
                          />
                          <small>Enter the number exactly as shown on the licence.</small>
                        </label>
                        <label className={styles.field}>
                          <span>Licence expiration date</span>
                          <input
                            type="date"
                            value={form.licenseExpirationDate}
                            onChange={(event) => setForm({ ...form, licenseExpirationDate: event.target.value })}
                          />
                          <small>The licence must still be valid.</small>
                        </label>
                      </div>

                      <div className="driver-create-license-grid">
                        <label className="driver-create-file-card" data-ready={Boolean(licensePreview)}>
                          <div className="driver-create-license-preview">
                            {licensePreview
                              ? <img src={licensePreview} alt="Front of driver's licence" />
                              : <ScheduleIcon name="users" size={34} />}
                          </div>
                          <div className="driver-create-file-copy">
                            <strong>Front of licence</strong>
                            <span>Upload the front side with the driver's photo and licence details visible.</span>
                            <em>{licenseFile?.name || "Choose front image"}</em>
                          </div>
                          <input
                            className="driver-create-file-input"
                            type="file"
                            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                            onChange={(event) => selectLicenseImage(event.target.files?.[0] || null)}
                          />
                        </label>

                        <label className="driver-create-file-card" data-ready={Boolean(licenseBackPreview)}>
                          <div className="driver-create-license-preview">
                            {licenseBackPreview
                              ? <img src={licenseBackPreview} alt="Back of driver's licence" />
                              : <ScheduleIcon name="users" size={34} />}
                          </div>
                          <div className="driver-create-file-copy">
                            <strong>Back of licence</strong>
                            <span>Upload the complete back side of the same driver's licence.</span>
                            <em>{licenseBackFile?.name || "Choose back image"}</em>
                          </div>
                          <input
                            className="driver-create-file-input"
                            type="file"
                            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                            onChange={(event) => selectLicenseBackImage(event.target.files?.[0] || null)}
                          />
                        </label>
                      </div>

                      <div className={styles.helpNotice}>
                        <ScheduleIcon name="info" size={20} />
                        <div>
                          <strong>Image requirements</strong>
                          <p>JPG, JPEG, or PNG only. Maximum file size is 5 MB for each side.</p>
                        </div>
                      </div>
                    </> : null}

                    {driverStep === 2 ? <>
                      <div className={styles.reviewTitle}>
                        <ScheduleIcon name="users" size={25} />
                        <div>
                          <strong>{form.name.trim() || "Unnamed driver"}</strong>
                          <span>Collection driver account</span>
                        </div>
                      </div>

                      <section className={styles.reviewSection}>
                        <div className={styles.reviewHeading}>
                          <h3>Driver and account details</h3>
                          <button type="button" className={styles.textButton} onClick={() => setDriverStep(0)}>
                            Change
                          </button>
                        </div>
                        <dl className={styles.facts}>
                          <div><dt>Full name</dt><dd>{form.name.trim() || "Not provided"}</dd></div>
                          <div><dt>Email</dt><dd>{normalizedCreateEmail || "Not provided"}</dd></div>
                          <div><dt>Contact number</dt><dd>{form.phone.trim() || "Not provided"}</dd></div>
                          <div><dt>Assigned vehicle</dt><dd>{form.truck.trim() || "Not provided"}</dd></div>
                          <div><dt>Password</dt><dd>{"•".repeat(Math.max(6, form.password.length))}</dd></div>
                        </dl>
                      </section>

                      <section className={styles.reviewSection}>
                        <div className={styles.reviewHeading}>
                          <h3>Driver licence</h3>
                          <button type="button" className={styles.textButton} onClick={() => setDriverStep(1)}>
                            Change
                          </button>
                        </div>
                        <dl className={styles.facts}>
                          <div><dt>Licence number</dt><dd>{form.licenseNumber.trim() || "Not provided"}</dd></div>
                          <div><dt>Expiration date</dt><dd>{formatLicenceDate(form.licenseExpirationDate)}</dd></div>
                          <div><dt>Front image</dt><dd>{licenseFile?.name || "Not uploaded"}</dd></div>
                          <div><dt>Back image</dt><dd>{licenseBackFile?.name || "Not uploaded"}</dd></div>
                        </dl>
                        <div className="driver-review-license-grid">
                          <div>{licensePreview ? <img src={licensePreview} alt="Front licence review" /> : null}<span>Front</span></div>
                          <div>{licenseBackPreview ? <img src={licenseBackPreview} alt="Back licence review" /> : null}<span>Back</span></div>
                        </div>
                      </section>

                      <div className={styles.neutralNotice}>
                        <ScheduleIcon name="info" size={20} />
                        <p>
                          Confirming creates the Firebase Authentication account and stores the driver profile and both licence images.
                        </p>
                      </div>

                      {!driverAllStepsValid ? (
                        <div className={styles.errorNotice} role="alert">
                          An earlier entry changed. Review the previous steps before saving.
                        </div>
                      ) : null}
                    </> : null}
                  </fieldset>
                </div>
              </div>
            </div>

            <footer className={styles.plannerFooter}>
              <span className={styles.footerProgress}>
                Step {driverStep + 1} of {DRIVER_STEPS.length} · {DRIVER_STEPS[driverStep].label}
              </span>
              <div className={styles.footerActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={isSaving}
                  onClick={() => driverStep === 0
                    ? requestCloseCreateDriver()
                    : setDriverStep((current) => current - 1)}
                >
                  {driverStep > 0 ? <ScheduleIcon name="arrowLeft" size={17} /> : null}
                  {driverStep === 0 ? "Cancel" : "Back"}
                </button>

                {driverStep < DRIVER_STEPS.length - 1 ? (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={isSaving}
                    onClick={nextDriverStep}
                  >
                    Continue
                    <ScheduleIcon name="arrowRight" size={17} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={isSaving || !driverAllStepsValid}
                    onClick={createDriver}
                  >
                    {isSaving ? <span className={styles.spinner} aria-hidden="true" /> : <ScheduleIcon name="check" size={17} />}
                    {isSaving ? "Saving driver…" : "Confirm & create"}
                  </button>
                )}
              </div>
            </footer>
          </ScheduleDialog>
        ) : null}

        {createdCredential && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setCreatedCredential(null);
              }
            }}
          >
            <section
              className="modal-card credential-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="driver-credential-title"
            >
              <div className="credential-success-icon" aria-hidden="true">✓</div>

              <div className="credential-heading">
                <span>DRIVER ACCOUNT CREATED</span>
                <h3 id="driver-credential-title">Temporary sign-in credentials</h3>
                <p>
                  Review or copy the password now. MetroWaste does not store a
                  readable copy of Firebase Authentication passwords.
                </p>
              </div>

              <div className="credential-person">
                <div className="credential-avatar">
                  {getInitials(createdCredential.name)}
                </div>
                <div>
                  <strong>{createdCredential.name}</strong>
                  <span>{createdCredential.email}</span>
                </div>
              </div>

              <div className="credential-password-card">
                <div className="credential-password-copy">
                  <small>TEMPORARY PASSWORD</small>
                  <input
                    readOnly
                    type={showCreatedPassword ? "text" : "password"}
                    value={createdCredential.password}
                    aria-label="Temporary driver password"
                  />
                </div>

                <button
                  type="button"
                  className="credential-icon-btn"
                  onClick={() => setShowCreatedPassword((visible) => !visible)}
                  aria-label={showCreatedPassword ? "Hide password" : "Show password"}
                  title={showCreatedPassword ? "Hide password" : "Show password"}
                >
                  {showCreatedPassword ? "Hide" : "Show"}
                </button>

                <button
                  type="button"
                  className="credential-copy-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(createdCredential.password);
                      setCredentialCopied(true);
                    } catch {
                      setCredentialCopied(false);
                    }
                  }}
                >
                  {credentialCopied ? "Copied" : "Copy password"}
                </button>
              </div>

              <div className="credential-security-note">
                <strong>Security note</strong>
                <span>
                  After this window is closed, the existing password cannot be
                  retrieved. An administrator can set a new password from Update Profile.
                </span>
              </div>

              <div className="credential-actions">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => setCreatedCredential(null)}
                >
                  Done
                </button>
              </div>
            </section>
          </div>
        )}

        {editDriverId && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <div className="modal-header">
                <div>
                  <h3>Update Driver Profile</h3>
                  <p>Update contact, vehicle, licence details, password, or replace the stored licence image.</p>
                </div>
                <button className="modal-close" onClick={() => { setEditDriverId(null); clearLicenseSelection(); }}>×</button>
              </div>

              {formError && <div className="form-error full-error" role="alert">{formError}</div>}
              <DriverFields
                form={form}
                setForm={setForm}
                includePassword
                passwordLabel="New Password (Optional)"
              />
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

        {profileDriver && typeof document !== "undefined" ? createPortal((
          <div
            className="modal-backdrop driver-profile-backdrop"
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
                    <span>ID: {profileDriver.id}</span>
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
                  {profileLicenseUrl || profileLicenseBackUrl ? <span className="available-dot" aria-label="Image available" /> : null}
                </button>
              </div>

              {profileTab === "overview" ? (
                <div className="profile-overview-layout professional-driver-profile">
                  <aside className="driver-showcase-card">
                    <div className="driver-showcase-hero">
                      <div className="driver-showcase-title">
                        <h4>DRIVER PROFILE</h4>
                        <p>Authorized collection driver account</p>
                      </div>

                      <div className="driver-showcase-avatar-wrap">
                        <DriverProfileAvatar driver={profileDriver} large />
                        <button
                          type="button"
                          className="driver-avatar-edit"
                          onClick={() => {
                            const driver = profileDriver;
                            closeDriverProfile();
                            openEditDriver(driver);
                          }}
                          aria-label="Edit driver profile"
                          title="Edit driver profile"
                        >
                          ✎
                        </button>
                      </div>

                      <strong className="showcase-name">{profileDriver.name || "Unnamed Driver"}</strong>
                      <span className="showcase-email">{profileDriver.email || "No email provided"}</span>

                      <div className="showcase-badges">
                        <span className={`status-pill ${getStatusClass(profileDriver.status || "offline")}`}>
                          {profileDriver.status || "offline"}
                        </span>
                        <span className="driver-id-pill">Truck: {profileDriver.truck || "Not assigned"}</span>
                      </div>

                      
                    </div>

                    <div className="driver-highlights-grid">
                      <div className="driver-highlight-card">
                        <small>Driver ID</small>
                        <strong>{profileDriver.id}</strong>
                      </div>

                      <div className="driver-highlight-card">
                        <small>Joined</small>
                        <strong>{formatDate(profileDriver.createdAt)}</strong>
                      </div>

                      <div className="driver-highlight-card">
                        <small>Contact Number</small>
                        <strong>{profileDriver.phone || "Not provided"}</strong>
                      </div>

                      <div className="driver-highlight-card">
                        <small>Licence Number</small>
                        <strong>{profileDriver.licenseNumber || "Not provided"}</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="driver-showcase-edit-btn"
                      onClick={() => {
                        const driver = profileDriver;
                        closeDriverProfile();
                        openEditDriver(driver);
                      }}
                    >
                      ✎ Edit Profile
                    </button>
                  </aside>

                  <div className="driver-info-stack">
                    <section className="driver-info-card">
                      <div className="driver-info-heading">
                        <div className="driver-info-badge" aria-hidden="true">👥</div>
                        <div>
                          <h4>Driver Information</h4>
                          <p>Personal and account details</p>
                        </div>
                      </div>

                      <div className="driver-info-list">
                        <div className="driver-info-item wide">
                          <div className="driver-info-icon" aria-hidden="true">✉</div>
                          <div className="driver-info-copy">
                            <small>Email Address</small>
                            <strong>{profileDriver.email || "Not provided"}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">☎</div>
                          <div className="driver-info-copy">
                            <small>Contact Number</small>
                            <strong>{profileDriver.phone || "Not provided"}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">🚚</div>
                          <div className="driver-info-copy">
                            <small>Assigned Vehicle</small>
                            <strong>{profileDriver.truck || "No vehicle assigned"}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">🪪</div>
                          <div className="driver-info-copy">
                            <small>Licence Number</small>
                            <strong>{profileDriver.licenseNumber || "Not provided"}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">🗓</div>
                          <div className="driver-info-copy">
                            <small>Licence Expiration</small>
                            <strong>{formatLicenceDate(profileDriver.licenseExpirationDate)}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">●</div>
                          <div className="driver-info-copy">
                            <small>Account Status</small>
                            <strong>
                              <span className={`status-pill ${getStatusClass(profileDriver.status || "offline")}`}>
                                {profileDriver.status || "offline"}
                              </span>
                            </strong>
                          </div>
                        </div>

                        <div className="driver-info-item wide">
                          <div className="driver-info-icon" aria-hidden="true">#</div>
                          <div className="driver-info-copy">
                            <small>Driver ID</small>
                            <strong>{profileDriver.id}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">＋</div>
                          <div className="driver-info-copy">
                            <small>Account Created</small>
                            <strong>{formatDate(profileDriver.createdAt)}</strong>
                          </div>
                        </div>

                        <div className="driver-info-item">
                          <div className="driver-info-icon" aria-hidden="true">↻</div>
                          <div className="driver-info-copy">
                            <small>Last Updated</small>
                            <strong>{formatDate(profileDriver.updatedAt)}</strong>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="driver-password-card-visual">
                      <div className="driver-info-heading">
                        <div className="driver-info-badge shield" aria-hidden="true">🛡</div>
                        <div>
                          <h4>Password Security</h4>
                          <p>Manage the driver account password</p>
                        </div>
                      </div>

                      <div className="driver-password-note">
                        <div className="driver-password-lock" aria-hidden="true">🔒</div>
                        <div>
                          <strong>Protected by Firebase Authentication</strong>
                          <p>
                            Existing passwords cannot be viewed after account creation.
                            Use the update profile form to set a new password when needed.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="security-action driver-password-action"
                        onClick={() => {
                          const driver = profileDriver;
                          closeDriverProfile();
                          openEditDriver(driver);
                        }}
                      >
                        Set New Password
                      </button>
                    </section>
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

                  <div className="licence-sides-grid">
                    <section className="licence-side-card" aria-label="Front of driver's licence">
                      <div className="licence-side-title">
                        <span>Front</span>
                        <strong>Front of licence</strong>
                      </div>

                      <div className="licence-view professional">
                        {isLicenseLoading ? (
                          <div className="licence-placeholder">
                            <span className="mini-spinner" />
                            <strong>Loading front image</strong>
                            <span>Please wait while MetroWaste retrieves the licence.</span>
                          </div>
                        ) : profileLicenseUrl ? (
                          <img
                            src={profileLicenseUrl}
                            alt={`${profileDriver.name || "Driver"} licence front`}
                          />
                        ) : (
                          <div className="licence-placeholder">
                            <span className="document-icon" aria-hidden="true">▧</span>
                            <strong>No front image available</strong>
                            <span>
                              {profileLicenseErrors.front ||
                                "Upload the front licence image from Update Profile."}
                            </span>
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="licence-side-card" aria-label="Back of driver's licence">
                      <div className="licence-side-title">
                        <span>Back</span>
                        <strong>Back of licence</strong>
                      </div>

                      <div className="licence-view professional">
                        {isLicenseLoading ? (
                          <div className="licence-placeholder">
                            <span className="mini-spinner" />
                            <strong>Loading back image</strong>
                            <span>Please wait while MetroWaste retrieves the licence.</span>
                          </div>
                        ) : profileLicenseBackUrl ? (
                          <img
                            src={profileLicenseBackUrl}
                            alt={`${profileDriver.name || "Driver"} licence back`}
                          />
                        ) : (
                          <div className="licence-placeholder">
                            <span className="document-icon" aria-hidden="true">▧</span>
                            <strong>No back image available</strong>
                            <span>
                              {profileLicenseErrors.back ||
                                "Upload the back licence image from Update Profile."}
                            </span>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

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
        ), document.body) : null}

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

        .barangay-folders {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
        }

        .barangay-folders-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 14px;
        }

        .barangay-folders-header h3 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
        }

        .barangay-folders-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .barangay-folder-total {
          flex: 0 0 auto;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 800;
        }

        .barangay-folder-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 10px;
        }

        .barangay-folder {
          min-width: 0;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #f8fafc;
          padding: 13px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          text-align: left;
          cursor: pointer;
          transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
        }

        .barangay-folder:hover {
          border-color: #86efac;
          background: #f0fdf4;
        }

        .barangay-folder.active {
          border-color: #22c55e;
          background: #ecfdf5;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.10);
        }

        .barangay-folder-icon {
          position: relative;
          width: 36px;
          height: 28px;
          flex: 0 0 36px;
          border-radius: 6px;
          background: #dbeafe;
          border: 1px solid #bfdbfe;
        }

        .barangay-folder-icon::before {
          content: "";
          position: absolute;
          left: 4px;
          top: -6px;
          width: 16px;
          height: 8px;
          border-radius: 5px 5px 0 0;
          background: #bfdbfe;
          border: 1px solid #93c5fd;
          border-bottom: 0;
        }

        .barangay-folder.active .barangay-folder-icon {
          background: #bbf7d0;
          border-color: #86efac;
        }

        .barangay-folder.active .barangay-folder-icon::before {
          background: #86efac;
          border-color: #4ade80;
        }

        .barangay-folder-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .barangay-folder-copy strong {
          overflow: hidden;
          color: #0f172a;
          font-size: 14px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .barangay-folder-copy small {
          color: #64748b;
          font-size: 12px;
        }

        .purok-folder-section {
          margin-top: 16px;
          border-top: 1px solid #e5e7eb;
          padding-top: 16px;
        }

        .purok-folder-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 12px;
        }

        .purok-eyebrow {
          display: block;
          margin-bottom: 3px;
          color: #059669;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }

        .purok-folder-header h4 {
          margin: 0;
          color: #0f172a;
          font-size: 15px;
        }

        .purok-folder-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
        }

        .purok-total {
          flex: 0 0 auto;
          border-radius: 999px;
          background: #f0fdf4;
          color: #047857;
          padding: 6px 9px;
          font-size: 11px;
          font-weight: 800;
        }

        .purok-folder-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 9px;
        }

        .purok-folder {
          min-width: 0;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #ffffff;
          padding: 11px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          text-align: left;
          cursor: pointer;
          transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
        }

        .purok-folder:hover {
          border-color: #86efac;
          background: #f7fef9;
        }

        .purok-folder.active {
          border-color: #22c55e;
          background: #ecfdf5;
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.08);
        }

        .purok-folder-number {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 11px;
          font-weight: 900;
        }

        .purok-folder.active .purok-folder-number {
          background: #bbf7d0;
          color: #047857;
        }

        .purok-folder-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .purok-folder-copy strong {
          overflow: hidden;
          color: #0f172a;
          font-size: 13px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .purok-folder-copy small {
          color: #64748b;
          font-size: 11px;
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

        .modal-card label,
        .single-label {
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        .modal-card label input,
        .modal-card label select,
        .single-label input {
          height: 44px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 0 12px;
          outline: none;
          color: #0f172a;
          background: #f8fafc;
        }

        .modal-card label select {
          height: 44px;
          padding: 0 12px;
        }

        .modal-card label input:focus,
        .modal-card label select:focus,
        .single-label input:focus {
          border-color: #10b981;
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }

        .password-input-wrap {
          position: relative;
          display: block;
        }

        .password-input-wrap input {
          width: 100%;
          padding-right: 50px;
        }

        .password-toggle {
          position: absolute;
          top: 50%;
          right: 8px;
          width: 36px;
          height: 36px;
          transform: translateY(-50%);
          display: grid;
          place-items: center;
          padding: 0;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: #64748b;
          cursor: pointer;
        }

        .password-toggle:hover {
          background: #eef7f2;
          color: #047857;
        }

        .password-toggle:focus-visible {
          outline: 2px solid #10b981;
          outline-offset: 2px;
        }

        .password-toggle svg {
          width: 19px;
          height: 19px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.9;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .field-help {
          margin-top: 1px;
          color: #64748b;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.45;
        }

        .credential-modal {
          width: min(620px, calc(100vw - 40px));
          padding: 26px;
          overflow: visible;
        }

        .credential-success-icon {
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: linear-gradient(145deg, #10b981, #047857);
          color: #ffffff;
          box-shadow: 0 14px 32px rgba(5, 150, 105, 0.22);
          font-size: 26px;
          font-weight: 900;
        }

        .credential-heading { margin-top: 18px; }
        .credential-heading > span {
          color: #047857;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.09em;
        }
        .credential-heading h3 {
          margin: 6px 0 0;
          color: #0f172a;
          font-size: 24px;
          letter-spacing: -0.02em;
        }
        .credential-heading p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.6;
        }

        .credential-person {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 20px;
          padding: 14px;
          border: 1px solid #dfe9e4;
          border-radius: 16px;
          background: #f8fffb;
        }
        .credential-avatar {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #047857;
          color: #fff;
          font-weight: 900;
        }
        .credential-person strong,
        .credential-person span { display: block; }
        .credential-person strong { color: #0f172a; }
        .credential-person span { margin-top: 2px; color: #64748b; font-size: 12px; }

        .credential-password-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          align-items: end;
          gap: 10px;
          margin-top: 14px;
          padding: 14px;
          border: 1px solid #dbe5e0;
          border-radius: 16px;
          background: #ffffff;
        }
        .credential-password-copy small {
          display: block;
          margin-bottom: 7px;
          color: #64748b;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
        }
        .credential-password-copy input {
          width: 100%;
          height: 42px;
          border: 1px solid #d8e2dd;
          border-radius: 12px;
          background: #f8fafc;
          padding: 0 12px;
          color: #0f172a;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-weight: 800;
        }
        .credential-icon-btn,
        .credential-copy-btn {
          height: 42px;
          border: 0;
          border-radius: 12px;
          padding: 0 13px;
          cursor: pointer;
          font-weight: 850;
        }
        .credential-icon-btn { background: #f1f5f9; color: #334155; }
        .credential-copy-btn { background: #ecfdf5; color: #047857; }

        .credential-security-note {
          display: grid;
          gap: 3px;
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          background: #f8fafc;
          color: #64748b;
          font-size: 12px;
          line-height: 1.5;
        }
        .credential-security-note strong { color: #334155; }
        .credential-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 18px;
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

        .driver-password-field {
          position: relative;
          min-width: 0;
        }

        .driver-password-field > input {
          padding-right: 74px !important;
        }

        .driver-password-toggle {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          min-height: 34px;
          padding: 5px 10px;
          border: 0;
          border-radius: 6px;
          background: #eef5f0;
          color: #0b6a42;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .driver-create-license-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          min-width: 0;
        }

        .driver-create-file-card {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(150px, 0.85fr) minmax(0, 1fr);
          gap: 16px;
          align-items: center;
          padding: 16px;
          border: 1px solid #dce5df;
          border-radius: 10px;
          background: #ffffff;
          cursor: pointer;
          transition: border-color .15s, background-color .15s, box-shadow .15s;
        }

        .driver-create-file-card:hover {
          border-color: #9fbfaa;
          background: #fcfefc;
        }

        .driver-create-file-card[data-ready="true"] {
          border-color: #399768;
          background: #f1faf5;
          box-shadow: inset 0 0 0 1px #0b7a4b0b;
        }

        .driver-create-license-preview {
          min-width: 0;
          height: 145px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 1px dashed #b9c9bf;
          border-radius: 8px;
          background: #f7f9f8;
          color: #739080;
        }

        .driver-create-license-preview img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #fff;
        }

        .driver-create-file-copy {
          min-width: 0;
          display: grid;
          gap: 7px;
          align-content: center;
        }

        .driver-create-file-copy strong {
          color: #29483a;
          font-size: 14px;
          font-weight: 600;
        }

        .driver-create-file-copy span {
          color: #607068;
          font-size: 12px;
          line-height: 1.6;
        }

        .driver-create-file-copy em {
          width: fit-content;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 7px 10px;
          border: 1px solid #cfe0d5;
          border-radius: 7px;
          background: #eef7f1;
          color: #0b6a42;
          font-size: 11px;
          font-style: normal;
          font-weight: 600;
        }

        .driver-create-file-input {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          opacity: 0;
          pointer-events: none;
        }

        .driver-review-license-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 18px;
        }

        .driver-review-license-grid > div {
          min-width: 0;
          display: grid;
          gap: 7px;
        }

        .driver-review-license-grid img {
          width: 100%;
          height: 170px;
          object-fit: contain;
          border: 1px solid #dfe6e2;
          border-radius: 9px;
          background: #f7f9f8;
        }

        .driver-review-license-grid span {
          color: #607068;
          font-size: 11px;
          font-weight: 600;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        @media (max-width: 760px) {
          .driver-create-license-grid,
          .driver-review-license-grid {
            grid-template-columns: 1fr;
          }

          .driver-create-file-card {
            grid-template-columns: 1fr;
          }
        }

        .profile-modal {
          width: min(1380px, calc(100vw - 24px));
          height: calc(100dvh - 24px);
          max-height: calc(100dvh - 24px);
          padding: 0;
          overflow-y: auto;
          overflow-x: hidden;
          border: 1px solid rgba(203, 213, 225, 0.9);
          border-radius: 28px;
          background: #f8fafc;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
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
          grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
          gap: 20px;
          padding: 24px;
          background: #f8fafc;
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
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
        }

        .profile-field {
          min-height: 78px;
          padding: 14px 15px;
          border-radius: 16px;
          background: #f8fafc;
          border: 1px solid #e7edf1;
          display: flex;
          flex-direction: column;
          justify-content: center;
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

        .profile-identity-badges {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          margin-top: 16px;
        }

        .vehicle-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          font-size: 11px;
          font-weight: 850;
        }

        .profile-security-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          margin-top: 16px;
          padding: 16px;
          border: 1px solid #dce8e2;
          border-radius: 18px;
          background: linear-gradient(135deg, #f0fdf7, #ffffff);
        }

        .profile-security-icon {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #dcfce7;
          color: #047857;
        }

        .profile-security-icon svg {
          width: 22px;
          height: 22px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.9;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .profile-security-copy small,
        .profile-security-copy strong { display: block; }
        .profile-security-copy small {
          color: #047857;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
        }
        .profile-security-copy strong {
          margin-top: 4px;
          color: #0f172a;
          font-size: 14px;
        }
        .profile-security-copy p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.5;
        }

        .security-action {
          min-height: 38px;
          padding: 0 13px;
          border: 1px solid #a7f3d0;
          border-radius: 12px;
          background: #ffffff;
          color: #047857;
          cursor: pointer;
          font-size: 12px;
          font-weight: 850;
          white-space: nowrap;
        }
        .security-action:hover { background: #ecfdf5; }

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

        .licence-sides-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .licence-side-card {
          min-width: 0;
          overflow: hidden;
          border: 1px solid #dbe4df;
          border-radius: 18px;
          background: #ffffff;
        }

        .licence-side-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid #e5ece8;
          background: #f8faf9;
        }

        .licence-side-title span {
          color: #047857;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .licence-side-title strong {
          color: #334155;
          font-size: 12px;
          font-weight: 800;
        }

        .licence-side-card .licence-view {
          border: 0;
          border-radius: 0;
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

        .professional-driver-profile {
          grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }

        .driver-showcase-card {
          position: sticky;
          top: 18px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 20px;
          border: 1px solid #dbe8df;
          border-radius: 24px;
          background:
            radial-gradient(circle at 30% 0%, rgba(16, 185, 129, 0.16), transparent 36%),
            radial-gradient(circle at 100% 25%, rgba(16, 185, 129, 0.1), transparent 30%),
            linear-gradient(180deg, #fbfffd 0%, #ffffff 100%);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05);
        }

        .driver-showcase-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 10px;
          padding: 10px 8px 0;
        }

        .driver-showcase-title h4 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .driver-showcase-title p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .driver-showcase-avatar-wrap {
          position: relative;
          margin-top: 10px;
        }

        .driver-avatar-edit {
          position: absolute;
          right: -6px;
          bottom: 8px;
          width: 42px;
          height: 42px;
          border: 4px solid #f8fffc;
          border-radius: 999px;
          background: #dcfce7;
          color: #047857;
          font-size: 16px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(5, 150, 105, 0.18);
        }

        .showcase-name {
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
        }

        .showcase-email {
          margin-top: -3px;
          color: #64748b;
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .showcase-badges {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          margin-top: 4px;
        }

        .driver-id-pill {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          padding: 0 14px;
          border-radius: 999px;
          background: #dcfce7;
          color: #065f46;
          font-size: 12px;
          font-weight: 800;
        }

        .showcase-quote {
          margin: 2px 0 0;
          color: #64748b;
          font-size: 12px;
          max-width: 220px;
          line-height: 1.5;
        }

        .driver-highlights-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding-top: 14px;
          border-top: 1px solid #e7edf1;
        }

        .driver-highlight-card {
          min-height: 82px;
          border: 1px solid #e7edf1;
          border-radius: 16px;
          background: #ffffff;
          padding: 14px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .driver-highlight-card small {
          color: #94a3b8;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .driver-highlight-card strong {
          margin-top: 6px;
          color: #0f172a;
          font-size: 13px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .driver-showcase-edit-btn {
          width: 100%;
          min-height: 48px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(135deg, #047857, #059669);
          color: #ffffff;
          font-size: 15px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(5, 150, 105, 0.2);
        }

        .driver-info-stack {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .driver-info-card,
        .driver-password-card-visual {
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          background: #ffffff;
          padding: 20px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.04);
        }

        .driver-info-heading {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .driver-info-badge {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #047857, #059669);
          color: #ffffff;
          font-size: 18px;
          box-shadow: 0 8px 18px rgba(5, 150, 105, 0.18);
        }

        .driver-info-badge.shield {
          background: linear-gradient(135deg, #065f46, #10b981);
        }

        .driver-info-heading h4 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
        }

        .driver-info-heading p {
          margin: 2px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .driver-info-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .driver-info-item {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          padding: 14px;
          border: 1px solid #e7edf1;
          border-radius: 16px;
          background: #ffffff;
          min-height: 92px;
        }

        .driver-info-item.wide {
          grid-column: 1 / -1;
        }

        .driver-info-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: #f8fafc;
          color: #0f172a;
          font-size: 20px;
        }

        .driver-info-copy small {
          display: block;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .driver-info-copy strong {
          display: block;
          margin-top: 5px;
          color: #0f172a;
          font-size: 14px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .driver-password-note {
          display: grid;
          grid-template-columns: 52px minmax(0, 1fr);
          gap: 12px;
          padding: 16px;
          border: 1px solid #dce8e2;
          border-radius: 16px;
          background: linear-gradient(135deg, #f0fdf7, #f8fffc);
        }

        .driver-password-lock {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: #dcfce7;
          color: #047857;
          font-size: 20px;
        }

        .driver-password-note strong {
          display: block;
          color: #166534;
          font-size: 14px;
        }

        .driver-password-note p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.5;
        }

        .driver-password-action {
          margin-top: 14px;
          width: 100%;
          min-height: 44px;
        }

        @media (max-width: 960px) {
          .professional-driver-profile {
            grid-template-columns: 1fr;
          }

          .driver-showcase-card {
            position: static;
          }

          .driver-info-list {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .driver-highlights-grid {
            grid-template-columns: 1fr;
          }

          .driver-info-item {
            grid-template-columns: 46px minmax(0, 1fr);
            padding: 12px;
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

        @media (max-width: 840px) {
          .profile-overview-layout {
            grid-template-columns: 1fr;
          }

          .profile-photo-card {
            min-height: auto;
          }

          .profile-security-card {
            grid-template-columns: auto minmax(0, 1fr);
          }

          .profile-security-card .security-action {
            grid-column: 1 / -1;
            width: 100%;
          }
        }

        @media (max-width: 640px) {
          .users-stats-grid {
            grid-template-columns: 1fr;
          }

          .barangay-folders-header {
            flex-direction: column;
          }

          .barangay-folder-grid {
            grid-template-columns: 1fr;
          }

          .purok-folder-header {
            flex-direction: column;
          }

          .purok-folder-grid {
            grid-template-columns: 1fr;
          }

          .users-tabs {
            width: 100%;
            overflow-x: auto;
          }

          .form-grid {
            grid-template-columns: 1fr;
          }

          .credential-password-card {
            grid-template-columns: 1fr 1fr;
          }

          .credential-password-copy {
            grid-column: 1 / -1;
          }

          .license-picker,
          .profile-overview-layout,
          .profile-detail-grid,
          .licence-summary-grid,
          .licence-sides-grid {
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

        /* FINAL DRIVER PROFILE FULL-SCREEN OVERRIDES */
        .modal-card.profile-modal {
          position: fixed !important;
          inset: 8px !important;
          width: auto !important;
          max-width: none !important;
          height: auto !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          border-radius: 20px !important;
          background: #f8fafc !important;
          z-index: 10000;
        }

        .modal-card.profile-modal .profile-hero {
          padding: 20px 26px;
        }

        .modal-card.profile-modal .profile-tabs {
          padding-inline: 26px;
        }

        .modal-card.profile-modal .professional-driver-profile {
          grid-template-columns: minmax(320px, 380px) minmax(0, 1fr) !important;
          gap: 20px !important;
          padding: 22px 26px !important;
          max-width: 1320px;
          margin: 0 auto;
          width: 100%;
        }

        .modal-card.profile-modal .driver-info-list {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }

        .modal-card.profile-modal .driver-info-item.wide {
          grid-column: 1 / -1 !important;
        }

        .modal-card.profile-modal .profile-modal-actions {
          padding: 0 26px 24px;
          max-width: 1320px;
          margin: 0 auto;
        }

        @media (max-width: 920px) {
          .modal-card.profile-modal {
            inset: 4px !important;
            border-radius: 14px !important;
          }

          .modal-card.profile-modal .professional-driver-profile {
            grid-template-columns: 1fr !important;
            padding: 16px !important;
          }

          .modal-card.profile-modal .driver-showcase-card {
            position: static !important;
          }

          .modal-card.profile-modal .driver-info-list {
            grid-template-columns: 1fr !important;
          }
        }

        /* DRIVER PROFILE LAYOUT STABILIZER
           Keeps the profile independent from DashboardShell and prevents
           global flex/grid rules from stretching the hero and tabs. */
        .driver-profile-backdrop {
          position: fixed !important;
          inset: 0 !important;
          z-index: 2147483000 !important;
          display: block !important;
          overflow: hidden !important;
          padding: 0 !important;
          background: rgba(15, 23, 42, 0.52) !important;
          backdrop-filter: blur(6px);
        }

        .driver-profile-backdrop > .modal-card.profile-modal {
          position: fixed !important;
          inset: 8px !important;
          display: block !important;
          width: auto !important;
          max-width: none !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          border-radius: 20px !important;
          background: #f8fafc !important;
        }

        .driver-profile-backdrop .profile-hero {
          position: relative !important;
          display: grid !important;
          grid-template-columns: auto minmax(0, 1fr) auto !important;
          align-items: center !important;
          min-height: 0 !important;
          height: auto !important;
          padding: 20px 26px !important;
          flex: none !important;
        }

        .driver-profile-backdrop .profile-tabs {
          display: flex !important;
          flex: none !important;
          align-items: flex-end !important;
          justify-content: flex-start !important;
          gap: 6px !important;
          width: 100% !important;
          min-height: 56px !important;
          height: auto !important;
          padding: 12px 26px 0 !important;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          background: #ffffff !important;
          border-bottom: 1px solid #edf2ef !important;
        }

        .driver-profile-backdrop .profile-tabs button {
          display: inline-flex !important;
          flex: 0 0 auto !important;
          align-items: center !important;
          align-self: auto !important;
          justify-content: center !important;
          width: auto !important;
          min-width: 0 !important;
          min-height: 44px !important;
          height: 44px !important;
          margin: 0 !important;
          padding: 0 15px !important;
        }

        .driver-profile-backdrop .profile-overview-layout,
        .driver-profile-backdrop .professional-driver-profile,
        .driver-profile-backdrop .licence-section {
          min-height: 0 !important;
          height: auto !important;
          flex: none !important;
        }

        .driver-profile-backdrop .profile-modal-actions {
          min-height: 0 !important;
          height: auto !important;
          flex: none !important;
        }

        @media (max-width: 920px) {
          .driver-profile-backdrop > .modal-card.profile-modal {
            inset: 4px !important;
            border-radius: 14px !important;
          }

          .driver-profile-backdrop .profile-hero {
            grid-template-columns: auto minmax(0, 1fr) !important;
            padding: 18px !important;
          }

          .driver-profile-backdrop .profile-tabs {
            padding-inline: 16px !important;
          }

          .driver-profile-backdrop .profile-close {
            position: absolute !important;
            top: 14px !important;
            right: 14px !important;
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
  passwordLabel = "Password",
}: {
  form: DriverFormState;
  setForm: (value: DriverFormState) => void;
  includePassword?: boolean;
  passwordLabel?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);

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
          {passwordLabel}
          <span className="password-input-wrap">
            <input
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder={passwordLabel.includes("Optional") ? "Leave blank to keep current password" : "At least 6 characters"}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                  <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 8.7 4.4 9.6 6-.5.9-1.5 2.3-3 3.5" />
                  <path d="M6.3 6.3C4.4 7.6 3.1 9.4 2.4 10.6 3.3 12.2 6.8 16 12 16c1 0 2-.1 2.9-.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.4 12s3.5-6 9.6-6 9.6 6 9.6 6-3.5 6-9.6 6-9.6-6-9.6-6Z" />
                  <circle cx="12" cy="12" r="2.7" />
                </svg>
              )}
            </button>
          </span>
          <small className="field-help">
            {passwordLabel.includes("Optional")
              ? "Use the eye button to verify a new password. Leave blank to keep the current password."
              : "Use the eye button to verify the password before saving. It will be shown once after account creation."}
          </small>
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

function buildDriverFormData(
  form: DriverFormState,
  licenseFile: File | null,
  licenseBackFile?: File | null,
) {
  const body = new FormData();
  Object.entries(form).forEach(([key, value]) => body.set(key, value));
  if (licenseFile) body.set("licenseImage", licenseFile, licenseFile.name);
  if (licenseBackFile) body.set("licenseImageBack", licenseBackFile, licenseBackFile.name);
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
