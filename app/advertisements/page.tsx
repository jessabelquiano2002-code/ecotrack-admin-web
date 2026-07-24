"use client";

import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { auth, db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

const BARANGAYS = [
  "Mercedes",
  "Canlapwas",
  "Maulong",
  "Poblacion 13",
  "San Andres",
] as const;

const PUROKS = Array.from(
  { length: 10 },
  (_, index) => `Purok ${index + 1}`,
);

type Audience =
  | "all_residents"
  | "barangay_all_purok"
  | "barangay_purok";

type AdvertisementForm = {
  title: string;
  message: string;
  audience: Audience;
  barangay: string;
  purok: string;
  ctaLabel: string;
  ctaUrl: string;
  startAt: string;
  endAt: string;
};

type AdvertisementRow = {
  id: string;
  title?: string;
  message?: string;
  imageRef?: string;
  imageContentType?: string;
  imageSize?: number;
  imageStorage?: string;
  audience?: Audience | string;
  barangay?: string;
  barangayKey?: string;
  purok?: string;
  purokKey?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  active?: boolean;
  status?: string;
  startAt?: number;
  endAt?: number;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
};

type ApiResponse = {
  success?: boolean;
  id?: string;
  error?: string;
};

const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DATABASE_IMAGE_BYTES = 600 * 1024;
const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 720;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EMPTY_FORM: AdvertisementForm = {
  title: "",
  message: "",
  audience: "all_residents",
  barangay: "",
  purok: "",
  ctaLabel: "",
  ctaUrl: "",
  startAt: "",
  endAt: "",
};

function toDateTimeLocal(value?: number): string {
  if (!value) return "";

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 16);
}

function formatDateTime(value?: number): string {
  if (!value) return "No limit";

  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAudienceLabel(ad: AdvertisementRow): string {
  if (ad.audience === "all_residents") {
    return "All registered residents";
  }

  if (ad.audience === "barangay_all_purok") {
    return `${ad.barangay || "Selected barangay"} • All Purok`;
  }

  return `${ad.barangay || "Selected barangay"} • ${
    ad.purok || "Selected Purok"
  }`;
}

function isCurrentlyLive(ad: AdvertisementRow): boolean {
  if (ad.active === false) return false;

  const now = Date.now();
  const startAt = Number(ad.startAt || 0);
  const endAt = Number(ad.endAt || 0);

  if (startAt > 0 && now < startAt) return false;
  if (endAt > 0 && now > endAt) return false;

  return true;
}

export default function AdvertisementsPage() {
  const [rows, setRows] = useState<AdvertisementRow[]>([]);
  const [form, setForm] = useState<AdvertisementForm>(EMPTY_FORM);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const unsubscribe = onValue(
      ref(db, "resident_advertisements"),
      (snapshot) => {
        const value = snapshot.val() || {};

        const list: AdvertisementRow[] = Object.entries(value)
          .map(([id, data]) => ({
            id,
            ...(data as Omit<AdvertisementRow, "id">),
          }))
          .sort(
            (left, right) =>
              Number(right.createdAt || 0) -
              Number(left.createdAt || 0),
          );

        setRows(list);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const stats = useMemo(() => {
    const live = rows.filter(isCurrentlyLive).length;
    const scheduled = rows.filter((row) => {
      return (
        row.active !== false &&
        Number(row.startAt || 0) > Date.now()
      );
    }).length;
    const inactive = rows.filter(
      (row) => row.active === false,
    ).length;

    return {
      total: rows.length,
      live,
      scheduled,
      inactive,
    };
  }, [rows]);

  const resetComposer = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);

    setForm({
      ...EMPTY_FORM,
      startAt: toDateTimeLocal(Date.now()),
    });
    setImageFile(null);
    setImagePreview("");
    setError("");
    setShowComposer(false);
  };

  const openComposer = () => {
    setNotice("");
    setError("");
    setForm({
      ...EMPTY_FORM,
      startAt: toDateTimeLocal(Date.now()),
    });
    setImageFile(null);
    setImagePreview("");
    setShowComposer(true);
  };

  const chooseImage = async (file: File | null) => {
    setError("");

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview("");
    setImageFile(null);

    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Use a JPG, PNG, or WebP advertisement image.");
      return;
    }

    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError("The original image must not exceed 5 MB.");
      return;
    }

    try {
      const optimized = await optimizeAdvertisementImage(file);

      if (optimized.size > MAX_DATABASE_IMAGE_BYTES) {
        setError(
          "The image could not be reduced below 600 KB. Choose a simpler or smaller photo.",
        );
        return;
      }

      setImageFile(optimized);
      setImagePreview(URL.createObjectURL(optimized));
    } catch (optimizationError) {
      console.error("Advertisement image optimization failed:", optimizationError);
      setError(
        optimizationError instanceof Error
          ? optimizationError.message
          : "The advertisement image could not be prepared.",
      );
    }
  };

  const validateForm = (): boolean => {
    if (!form.title.trim()) {
      setError("Enter an advertisement title.");
      return false;
    }

    if (!form.message.trim()) {
      setError("Enter a short advertisement message.");
      return false;
    }

    if (!imageFile) {
      setError("Choose the advertisement image residents will see.");
      return false;
    }

    if (
      form.audience !== "all_residents" &&
      !form.barangay
    ) {
      setError("Select the target barangay.");
      return false;
    }

    if (
      form.audience === "barangay_purok" &&
      !form.purok
    ) {
      setError("Select the target Purok.");
      return false;
    }

    if (form.ctaUrl.trim()) {
      try {
        const url = new URL(form.ctaUrl.trim());

        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("INVALID_PROTOCOL");
        }
      } catch {
        setError(
          "The action URL must be a complete http:// or https:// address.",
        );
        return false;
      }
    }

    const startAt = form.startAt
      ? new Date(form.startAt).getTime()
      : Date.now();
    const endAt = form.endAt
      ? new Date(form.endAt).getTime()
      : 0;

    if (!Number.isFinite(startAt)) {
      setError("Enter a valid start date and time.");
      return false;
    }

    if (endAt > 0 && endAt <= startAt) {
      setError("The end date must be later than the start date.");
      return false;
    }

    return true;
  };

  const publishAdvertisement = async () => {
    if (saving || !validateForm() || !imageFile) return;

    try {
      setSaving(true);
      setError("");

      const user = auth.currentUser;

      if (!user) {
        throw new Error(
          "Your administrator session expired. Sign in again.",
        );
      }

      const token = await user.getIdToken(true);
      const body = new FormData();

      body.set("title", form.title.trim());
      body.set("message", form.message.trim());
      body.set("audience", form.audience);
      body.set("barangay", form.barangay);
      body.set("purok", form.purok);
      body.set("ctaLabel", form.ctaLabel.trim());
      body.set("ctaUrl", form.ctaUrl.trim());
      body.set(
        "startAt",
        String(
          form.startAt
            ? new Date(form.startAt).getTime()
            : Date.now(),
        ),
      );
      body.set(
        "endAt",
        String(
          form.endAt
            ? new Date(form.endAt).getTime()
            : 0,
        ),
      );
      body.set("image", imageFile, imageFile.name);

      const response = await fetch("/api/advertisements", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        cache: "no-store",
      });

      const result = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(
          result.error || "Failed to publish advertisement.",
        );
      }

      setNotice(
        "Advertisement and optimized image saved in Realtime Database. Eligible resident home screens will receive it in real time.",
      );
      resetComposer();
    } catch (publishError) {
      console.error(
        "Publish advertisement failed:",
        publishError,
      );
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Failed to publish advertisement.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleAdvertisement = async (
    row: AdvertisementRow,
  ) => {
    if (workingId) return;

    try {
      setWorkingId(row.id);

      const user = auth.currentUser;

      if (!user) {
        throw new Error(
          "Your administrator session expired. Sign in again.",
        );
      }

      const response = await fetch("/api/advertisements", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${await user.getIdToken(true)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: row.id,
          active: row.active === false,
        }),
        cache: "no-store",
      });

      const result = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(
          result.error || "Failed to update advertisement.",
        );
      }

      setNotice(
        row.active === false
          ? "Advertisement activated."
          : "Advertisement paused.",
      );
    } catch (toggleError) {
      alert(
        toggleError instanceof Error
          ? toggleError.message
          : "Failed to update advertisement.",
      );
    } finally {
      setWorkingId("");
    }
  };

  const deleteAdvertisement = async (
    row: AdvertisementRow,
  ) => {
    if (
      !window.confirm(
        "Delete this advertisement and its Realtime Database image?",
      )
    ) {
      return;
    }

    try {
      setWorkingId(row.id);

      const user = auth.currentUser;

      if (!user) {
        throw new Error(
          "Your administrator session expired. Sign in again.",
        );
      }

      const response = await fetch(
        `/api/advertisements?id=${encodeURIComponent(row.id)}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${await user.getIdToken(true)}`,
          },
          cache: "no-store",
        },
      );

      const result = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(
          result.error || "Failed to delete advertisement.",
        );
      }

      setNotice("Advertisement deleted.");
    } catch (deleteError) {
      alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete advertisement.",
      );
    } finally {
      setWorkingId("");
    }
  };

  return (
    <DashboardShell
      title="Resident Advertisements"
      description="Publish photo announcements that appear on eligible resident home screens"
      hidePageHeader
    >
      <main className="adsPage">
        <section className="adsHero">
          <div>
            <span className="eyebrow">Resident engagement</span>
            <h1>Photo Advertisements</h1>
            <p>
              Publish a professional image card that appears inside
              the resident app when a matching resident opens or is
              currently viewing the home screen.
            </p>
          </div>

          <button
            className="primaryButton"
            type="button"
            onClick={openComposer}
          >
            + Create Advertisement
          </button>
        </section>

        {notice ? (
          <div className="noticeBox">{notice}</div>
        ) : null}

        <section className="statsGrid">
          <StatCard label="All advertisements" value={stats.total} />
          <StatCard label="Live now" value={stats.live} tone="green" />
          <StatCard label="Scheduled" value={stats.scheduled} tone="blue" />
          <StatCard label="Paused" value={stats.inactive} tone="gray" />
        </section>

        <section className="adsPanel">
          <div className="panelHeading">
            <div>
              <span className="eyebrow">Campaign library</span>
              <h2>Published advertisements</h2>
              <p>
                The newest eligible advertisement is shown first in
                the resident application.
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="emptyState">
              <strong>No advertisements yet</strong>
              <span>
                Create the first photo advertisement for residents.
              </span>
            </div>
          ) : (
            <div className="adsGrid">
              {rows.map((row) => {
                const live = isCurrentlyLive(row);

                return (
                  <article className="adCard" key={row.id}>
                    <div className="adImageWrap">
                      <AdvertisementImage
                        advertisementId={row.id}
                        alt={row.title || "Resident advertisement"}
                      />

                      <span
                        className={`statusBadge ${
                          live
                            ? "live"
                            : row.active === false
                              ? "paused"
                              : "scheduled"
                        }`}
                      >
                        {live
                          ? "Live"
                          : row.active === false
                            ? "Paused"
                            : "Scheduled"}
                      </span>
                    </div>

                    <div className="adBody">
                      <span className="audienceLabel">
                        {getAudienceLabel(row)}
                      </span>
                      <h3>{row.title || "Untitled advertisement"}</h3>
                      <p>{row.message || "No message provided."}</p>

                      <dl className="adMeta">
                        <div>
                          <dt>Starts</dt>
                          <dd>{formatDateTime(row.startAt)}</dd>
                        </div>
                        <div>
                          <dt>Ends</dt>
                          <dd>{formatDateTime(row.endAt)}</dd>
                        </div>
                      </dl>

                      <div className="cardActions">
                        <button
                          type="button"
                          className="secondaryButton"
                          disabled={workingId === row.id}
                          onClick={() => toggleAdvertisement(row)}
                        >
                          {row.active === false ? "Activate" : "Pause"}
                        </button>

                        <button
                          type="button"
                          className="dangerButton"
                          disabled={workingId === row.id}
                          onClick={() => deleteAdvertisement(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {showComposer ? (
          <div className="modalBackdrop">
            <section
              className="composer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="advertisement-title"
            >
              <header className="composerHeader">
                <div>
                  <span className="eyebrow">New resident campaign</span>
                  <h2 id="advertisement-title">
                    Create photo advertisement
                  </h2>
                  <p>
                    Recommended image size: 1200 × 675 pixels
                    (16:9). The image is optimized and stored in
                    Firebase Realtime Database.
                  </p>
                </div>

                <button
                  className="closeButton"
                  type="button"
                  onClick={resetComposer}
                  aria-label="Close advertisement composer"
                >
                  ×
                </button>
              </header>

              <div className="composerGrid">
                <div className="formColumn">
                  {error ? (
                    <div className="errorBox" role="alert">
                      {error}
                    </div>
                  ) : null}

                  <div className="formGrid">
                    <label className="fullField">
                      <span>Advertisement image</span>
                      <div className="imagePicker">
                        <div className="previewFrame">
                          {imagePreview ? (
                            <img
                              src={imagePreview}
                              alt="Advertisement preview"
                            />
                          ) : (
                            <div className="previewPlaceholder">
                              <strong>16:9 photo preview</strong>
                              <span>JPG, PNG, or WebP • source maximum 5 MB</span>
                              <small>Automatically compressed below 600 KB for Realtime Database.</small>
                            </div>
                          )}
                        </div>

                        <label className="fileButton">
                          {imageFile
                            ? "Choose another image"
                            : "Choose advertisement image"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                            onChange={(event) =>
                              chooseImage(
                                event.target.files?.[0] || null,
                              )
                            }
                          />
                        </label>
                      </div>
                    </label>

                    <label className="fullField">
                      <span>Title</span>
                      <input
                        value={form.title}
                        maxLength={80}
                        placeholder="Example: Waste Segregation Week"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            title: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className="fullField">
                      <span>Message</span>
                      <textarea
                        value={form.message}
                        maxLength={220}
                        placeholder="Write a short message residents can understand immediately."
                        onChange={(event) =>
                          setForm({
                            ...form,
                            message: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label>
                      <span>Audience</span>
                      <select
                        value={form.audience}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            audience: event.target.value as Audience,
                            barangay: "",
                            purok: "",
                          })
                        }
                      >
                        <option value="all_residents">
                          All registered residents
                        </option>
                        <option value="barangay_all_purok">
                          One barangay — all Puroks
                        </option>
                        <option value="barangay_purok">
                          One barangay — selected Purok
                        </option>
                      </select>
                    </label>

                    <label>
                      <span>Barangay</span>
                      <select
                        disabled={form.audience === "all_residents"}
                        value={form.barangay}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            barangay: event.target.value,
                            purok: "",
                          })
                        }
                      >
                        <option value="">Select barangay</option>
                        {BARANGAYS.map((barangay) => (
                          <option key={barangay} value={barangay}>
                            {barangay}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Purok</span>
                      <select
                        disabled={
                          form.audience !== "barangay_purok" ||
                          !form.barangay
                        }
                        value={form.purok}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            purok: event.target.value,
                          })
                        }
                      >
                        <option value="">Select Purok</option>
                        {PUROKS.map((purok) => (
                          <option key={purok} value={purok}>
                            {purok}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Button label (optional)</span>
                      <input
                        value={form.ctaLabel}
                        maxLength={30}
                        placeholder="Learn more"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            ctaLabel: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className="fullField">
                      <span>Button URL (optional)</span>
                      <input
                        value={form.ctaUrl}
                        placeholder="https://example.com"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            ctaUrl: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label>
                      <span>Display from</span>
                      <input
                        type="datetime-local"
                        value={form.startAt}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            startAt: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label>
                      <span>Display until (optional)</span>
                      <input
                        type="datetime-local"
                        value={form.endAt}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            endAt: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                </div>

                <aside className="residentPreview">
                  <span className="eyebrow">Resident home preview</span>

                  <div className="phoneFrame">
                    <div className="phoneNotch" />

                    <div className="previewAd">
                      <div className="previewImage">
                        {imagePreview ? (
                          <img src={imagePreview} alt="" />
                        ) : (
                          <span>Advertisement image</span>
                        )}
                      </div>

                      <div className="previewCopy">
                        <small>Sponsored announcement</small>
                        <strong>
                          {form.title || "Advertisement title"}
                        </strong>
                        <p>
                          {form.message ||
                            "The advertisement message appears here."}
                        </p>

                        {form.ctaLabel ? (
                          <button type="button">
                            {form.ctaLabel}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>

              <footer className="composerActions">
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={resetComposer}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="primaryButton"
                  onClick={publishAdvertisement}
                  disabled={saving}
                >
                  {saving ? "Publishing…" : "Publish Advertisement"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </main>

      <style jsx global>{`
        .adsPage,
        .adsPage * {
          box-sizing: border-box;
        }

        .adsPage {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .adsHero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding: 32px;
          border: 1px solid #dbe7e1;
          border-radius: 30px;
          background:
            radial-gradient(
              circle at 94% 0%,
              rgba(16, 185, 129, 0.2),
              transparent 34%
            ),
            linear-gradient(135deg, #ffffff, #f0fdf7);
          box-shadow: 0 22px 55px rgba(15, 23, 42, 0.07);
        }

        .eyebrow {
          display: inline-flex;
          margin-bottom: 8px;
          color: #047857;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .adsHero h1,
        .panelHeading h2,
        .composerHeader h2 {
          margin: 0;
          color: #0f172a;
          letter-spacing: -0.04em;
        }

        .adsHero h1 {
          font-size: clamp(30px, 4vw, 46px);
        }

        .adsHero p,
        .panelHeading p,
        .composerHeader p {
          max-width: 720px;
          margin: 8px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.6;
        }

        .primaryButton,
        .secondaryButton,
        .dangerButton,
        .closeButton {
          border: 0;
          font-weight: 850;
          cursor: pointer;
        }

        .primaryButton {
          min-height: 46px;
          padding: 0 18px;
          border-radius: 14px;
          background: #059669;
          color: #ffffff;
          box-shadow: 0 12px 25px rgba(5, 150, 105, 0.24);
        }

        .secondaryButton {
          min-height: 40px;
          padding: 0 14px;
          border-radius: 12px;
          background: #f1f5f9;
          color: #334155;
        }

        .dangerButton {
          min-height: 40px;
          padding: 0 14px;
          border-radius: 12px;
          background: #fef2f2;
          color: #b91c1c;
        }

        .primaryButton:disabled,
        .secondaryButton:disabled,
        .dangerButton:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .noticeBox {
          padding: 14px 17px;
          border: 1px solid #bbf7d0;
          border-radius: 15px;
          background: #ecfdf5;
          color: #047857;
          font-size: 13px;
          font-weight: 800;
        }

        .statsGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .statCard {
          padding: 18px;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 10px 25px rgba(15, 23, 42, 0.05);
        }

        .statCard span,
        .statCard strong {
          display: block;
        }

        .statCard span {
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .statCard strong {
          margin-top: 9px;
          color: #0f172a;
          font-size: 30px;
        }

        .statCard.green {
          background: linear-gradient(135deg, #ecfdf5, #ffffff);
        }

        .statCard.blue {
          background: linear-gradient(135deg, #eff6ff, #ffffff);
        }

        .statCard.gray {
          background: linear-gradient(135deg, #f8fafc, #ffffff);
        }

        .adsPanel {
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 26px;
          background: #ffffff;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
        }

        .panelHeading {
          padding: 24px 26px;
          border-bottom: 1px solid #edf2f7;
        }

        .panelHeading h2 {
          font-size: 23px;
        }

        .adsGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
          padding: 22px;
        }

        .adCard {
          min-width: 0;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #ffffff;
        }

        .adImageWrap {
          position: relative;
          aspect-ratio: 16 / 9;
          overflow: hidden;
          background: #f1f5f9;
        }

        .adImageWrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .missingImage {
          height: 100%;
          display: grid;
          place-items: center;
          color: #64748b;
          font-size: 13px;
        }

        .statusBadge {
          position: absolute;
          top: 12px;
          right: 12px;
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          padding: 0 10px;
          border-radius: 999px;
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
        }

        .statusBadge.live {
          background: #059669;
        }

        .statusBadge.paused {
          background: #64748b;
        }

        .statusBadge.scheduled {
          background: #2563eb;
        }

        .adBody {
          padding: 17px;
        }

        .audienceLabel {
          color: #047857;
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .adBody h3 {
          margin: 7px 0 0;
          color: #0f172a;
          font-size: 18px;
          line-height: 1.35;
        }

        .adBody p {
          min-height: 42px;
          margin: 7px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.55;
        }

        .adMeta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin: 15px 0 0;
        }

        .adMeta div {
          min-width: 0;
          padding: 10px;
          border-radius: 12px;
          background: #f8fafc;
        }

        .adMeta dt {
          color: #94a3b8;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .adMeta dd {
          margin: 4px 0 0;
          color: #334155;
          font-size: 11px;
          line-height: 1.4;
        }

        .cardActions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 15px;
        }

        .emptyState {
          min-height: 280px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 6px;
          padding: 32px;
          color: #64748b;
          text-align: center;
        }

        .emptyState strong {
          color: #0f172a;
          font-size: 18px;
        }

        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(15, 23, 42, 0.58);
          backdrop-filter: blur(8px);
        }

        .composer {
          width: min(1080px, 100%);
          max-height: calc(100dvh - 40px);
          overflow-y: auto;
          border-radius: 26px;
          background: #ffffff;
          box-shadow: 0 35px 90px rgba(15, 23, 42, 0.34);
        }

        .composerHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 24px 26px;
          border-bottom: 1px solid #e2e8f0;
        }

        .composerHeader h2 {
          font-size: 28px;
        }

        .closeButton {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: #f1f5f9;
          color: #334155;
          font-size: 25px;
        }

        .composerGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 350px;
          gap: 20px;
          padding: 24px;
        }

        .formColumn {
          min-width: 0;
        }

        .errorBox {
          margin-bottom: 14px;
          padding: 12px 14px;
          border: 1px solid #fecaca;
          border-radius: 13px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 750;
        }

        .formGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .formGrid label {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 850;
        }

        .fullField {
          grid-column: 1 / -1;
        }

        .formGrid input,
        .formGrid select,
        .formGrid textarea {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 13px;
          background: #ffffff;
          color: #0f172a;
          outline: none;
        }

        .formGrid input,
        .formGrid select {
          height: 46px;
          padding: 0 12px;
        }

        .formGrid textarea {
          min-height: 100px;
          padding: 12px;
          resize: vertical;
          line-height: 1.5;
        }

        .formGrid input:focus,
        .formGrid select:focus,
        .formGrid textarea:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.11);
        }

        .imagePicker {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: end;
          gap: 12px;
          padding: 13px;
          border: 1px solid #dbe5df;
          border-radius: 16px;
          background: #f8fbf9;
        }

        .previewFrame {
          aspect-ratio: 16 / 9;
          overflow: hidden;
          border: 1px dashed #a7b8af;
          border-radius: 13px;
          background: #eef5f1;
        }

        .previewFrame img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .previewPlaceholder {
          height: 100%;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 4px;
          padding: 18px;
          color: #64748b;
          text-align: center;
        }

        .previewPlaceholder strong {
          color: #334155;
        }

        .fileButton {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 13px;
          border-radius: 11px;
          background: #dcfce7;
          color: #166534;
          white-space: nowrap;
          cursor: pointer;
          font-weight: 900;
        }

        .fileButton input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .residentPreview {
          align-self: start;
          padding: 18px;
          border: 1px solid #dbeafe;
          border-radius: 20px;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
        }

        .phoneFrame {
          margin-top: 8px;
          padding: 12px;
          border: 7px solid #0f172a;
          border-radius: 28px;
          background: #f8fafc;
        }

        .phoneNotch {
          width: 68px;
          height: 6px;
          margin: 0 auto 14px;
          border-radius: 999px;
          background: #cbd5e1;
        }

        .previewAd {
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
        }

        .previewImage {
          aspect-ratio: 16 / 9;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: #e2e8f0;
          color: #64748b;
          font-size: 12px;
        }

        .previewImage img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .previewCopy {
          padding: 14px;
        }

        .previewCopy small {
          color: #059669;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .previewCopy strong {
          display: block;
          margin-top: 5px;
          color: #0f172a;
          font-size: 16px;
          line-height: 1.35;
        }

        .previewCopy p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.5;
        }

        .previewCopy button {
          width: 100%;
          min-height: 36px;
          margin-top: 11px;
          border: 0;
          border-radius: 10px;
          background: #059669;
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
        }

        .composerActions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 18px 24px 24px;
          border-top: 1px solid #e2e8f0;
        }

        @media (max-width: 1080px) {
          .statsGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .adsGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .composerGrid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .adsHero,
          .composerHeader {
            flex-direction: column;
          }

          .statsGrid,
          .adsGrid,
          .formGrid {
            grid-template-columns: 1fr;
          }

          .fullField {
            grid-column: auto;
          }

          .imagePicker {
            grid-template-columns: 1fr;
          }

          .adsHero {
            padding: 24px;
          }

          .primaryButton {
            width: 100%;
          }

          .composerActions {
            flex-direction: column;
          }

          .composerActions button {
            width: 100%;
          }
        }
      `}</style>
    </DashboardShell>
  );
}


function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image could not be opened."));
    };

    image.src = objectUrl;
  });
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not compress the image."));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function optimizeAdvertisementImage(file: File): Promise<File> {
  const source = await loadBrowserImage(file);
  const initialScale = Math.min(
    1,
    MAX_IMAGE_WIDTH / Math.max(1, source.naturalWidth),
    MAX_IMAGE_HEIGHT / Math.max(1, source.naturalHeight),
  );

  let width = Math.max(1, Math.round(source.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(source.naturalHeight * initialScale));
  let finalBlob: Blob | null = null;

  for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("The browser does not support image compression.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);

    for (const quality of [0.82, 0.74, 0.66, 0.58, 0.5]) {
      const blob = await canvasToJpegBlob(canvas, quality);
      finalBlob = blob;

      if (blob.size <= MAX_DATABASE_IMAGE_BYTES) {
        return new File(
          [blob],
          `${file.name.replace(/\.[^.]+$/, "") || "advertisement"}-optimized.jpg`,
          { type: "image/jpeg", lastModified: Date.now() },
        );
      }
    }

    width = Math.max(480, Math.round(width * 0.82));
    height = Math.max(270, Math.round(height * 0.82));
  }

  if (!finalBlob) {
    throw new Error("The advertisement image could not be compressed.");
  }

  return new File(
    [finalBlob],
    `${file.name.replace(/\.[^.]+$/, "") || "advertisement"}-optimized.jpg`,
    { type: "image/jpeg", lastModified: Date.now() },
  );
}

function AdvertisementImage({
  advertisementId,
  alt,
}: {
  advertisementId: string;
  alt: string;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;

    const loadImage = async () => {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Administrator session is unavailable.");

        const response = await fetch(
          `/api/advertisements?id=${encodeURIComponent(advertisementId)}`,
          {
            method: "GET",
            headers: {
              Accept: "image/jpeg,image/png,image/webp,application/json",
              Authorization: `Bearer ${await user.getIdToken()}`,
            },
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error("Advertisement image is unavailable.");
        }

        const blob = await response.blob();
        if (blob.size <= 0) throw new Error("Advertisement image is empty.");

        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSource(objectUrl);
      } catch (imageError) {
        console.error("Load advertisement preview failed:", imageError);
        if (!cancelled) setFailed(true);
      }
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [advertisementId]);

  if (failed) {
    return <div className="missingImage">Image unavailable</div>;
  }

  if (!source) {
    return <div className="missingImage">Loading image…</div>;
  }

  return <img src={source} alt={alt} />;
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "blue" | "gray";
}) {
  return (
    <div className={`statCard ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
