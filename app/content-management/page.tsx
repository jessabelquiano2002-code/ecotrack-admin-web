"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { DashboardShell } from "../components/DashboardShell";
import { auth } from "../../lib/firebase";
import { compressImageForRealtimeDatabase } from "../../lib/imageCompression";
import {
  createNextVersion,
  createContentItemId,
  databaseErrorMessage,
  deleteContentItem,
  migrateLegacyContent,
  publishVersion,
  reorderCollection,
  saveContentItem,
  setItemPublished,
  subscribeAcknowledgments,
  subscribeAdminConfig,
  subscribeVersion,
  unpublishActiveVersion,
  updateVersionMeta,
  withRetry,
} from "../../lib/repository";
import {
  COLLECTIONS,
  COLLECTION_LABELS,
  EMPTY_DRAFT,
  type AdminConfig,
  type CollectionId,
  type ContentDraft,
  type ContentItem,
  type ResidentAcknowledgment,
  type VersionMeta,
} from "../../lib/types";
import { validateContentDraft, type ValidationErrors } from "../../lib/validation";
import { parseVideoUrl } from "../../lib/video";
import styles from "./content-management.module.css";

type Tab = CollectionId | "acknowledgments";
type Toast = { kind: "success" | "error" | "info"; message: string };
type ConfirmState = { title: string; body: string; confirmLabel: string; danger?: boolean; action: () => Promise<void> };

const emptyCollections = (): Record<CollectionId, ContentItem[]> => ({
  advertisements: [],
  videos: [],
  announcements: [],
  guides: [],
  violations: [],
  schedules: [],
});
const formatDate = (value: number | null | undefined) => value
  ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(value)
  : "Not yet";

const itemToDraft = (item: ContentItem): ContentDraft => ({
  title: item.title,
  description: item.description,
  category: item.category,
  audience: item.audience,
  imageUrl: item.imageUrl,
  imageDataUrl: item.imageDataUrl,
  videoSourceType: item.videoSourceType,
  videoUrl: item.videoUrl,
  bundledResourceName: item.bundledResourceName,
  thumbnailUrl: item.thumbnailUrl,
  thumbnailDataUrl: item.thumbnailDataUrl,
  penalty: item.penalty,
  ordinanceReference: item.ordinanceReference,
  serviceArea: item.serviceArea,
  scheduleDay: item.scheduleDay,
  collectionTime: item.collectionTime,
  notes: item.notes,
  order: item.order,
  required: item.required,
  published: item.published,
});

export default function ContentManagementPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [meta, setMeta] = useState<VersionMeta | null>(null);
  const [collections, setCollections] = useState<Record<CollectionId, ContentItem[]>>(emptyCollections);
  const [acknowledgments, setAcknowledgments] = useState<ResidentAcknowledgment[]>([]);
  const [tab, setTab] = useState<Tab>("advertisements");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastRetry, setLastRetry] = useState<(() => Promise<void>) | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [draft, setDraft] = useState<ContentDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [showPreview, setShowPreview] = useState(false);
  const titleSaveTimer = useRef<number | null>(null);

  useEffect(() => onAuthStateChanged(auth, (current) => {
    setUser(current);
    setAuthReady(true);
    if (!current) setLoading(false);
  }), []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let unsubscribeConfig: () => void = () => {};

    setLoading(true);
    setConfig(null);
    setMeta(null);
    setCollections(emptyCollections());
    setToast(null);

    const connect = async () => {
      try {
        // Refresh the Firebase token so newly assigned administrator claims
        // are available without requiring the user to sign out first.
        await user.getIdToken(true);
        if (cancelled) return;

        // Load the existing content configuration directly. The previous
        // ensureContentSchema() call was blocking this page because it used a
        // second, mismatched administrator record. Firebase Database rules
        // remain responsible for enforcing access.
        unsubscribeConfig = subscribeAdminConfig(
          (nextConfig) => {
            if (cancelled) return;
            setConfig(nextConfig);
          },
          (error) => {
            if (cancelled) return;
            setToast({ kind: "error", message: databaseErrorMessage(error) });
            setLoading(false);
          },
        );
      } catch (error) {
        if (cancelled) return;
        setToast({ kind: "error", message: databaseErrorMessage(error) });
        setLoading(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      unsubscribeConfig();
    };
  }, [user]);

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    return subscribeVersion(config.draftVersion, (nextMeta, nextCollections) => {
      setMeta(nextMeta);
      setCollections(nextCollections);
      setLoading(false);
    }, (error) => {
      setToast({ kind: "error", message: databaseErrorMessage(error) });
      setLoading(false);
    });
  }, [config?.draftVersion]);

  useEffect(() => {
    const version = config?.lastPublishedVersion ?? 0;
    const hasLiveVersion = Boolean(config?.publicAvailable && version > 0);

    // Do not subscribe to resident review records while the system only has a
    // draft. Some Firebase rule sets protect acknowledgments more strictly than
    // the editable content tree, which can otherwise produce a misleading
    // "not an active administrator" permission message during initial setup.
    if (!user || !hasLiveVersion) {
      setAcknowledgments([]);
      return;
    }

    return subscribeAcknowledgments(
      version,
      setAcknowledgments,
      (error) => {
        setToast({
          kind: "error",
          message: `Resident reviews could not be loaded: ${databaseErrorMessage(error)}`,
        });
      },
    );
  }, [config?.publicAvailable, config?.lastPublishedVersion, user]);

  useEffect(() => () => {
    if (titleSaveTimer.current) window.clearTimeout(titleSaveTimer.current);
  }, []);

  const activeCollection = tab === "acknowledgments" ? null : tab;
  const items = activeCollection ? collections[activeCollection] : [];
  const publishedCount = items.filter((item) => item.published).length;
  const isLocked = meta?.status === "published";
  const acknowledgmentCounts = useMemo(() => ({
    in_progress: acknowledgments.filter((item) => item.status === "in_progress").length,
    completed: acknowledgments.filter((item) => item.status === "completed").length,
    skipped: acknowledgments.filter((item) => item.status === "skipped").length,
  }), [acknowledgments]);

  const runAction = async (label: string, action: () => Promise<void>, successMessage?: string) => {
    setBusy(label); setProgress(15); setToast(null); setLastRetry(null);
    const retry = async () => runAction(label, action, successMessage);
    try {
      await withRetry(action);
      setProgress(100);
      if (successMessage) setToast({ kind: "success", message: successMessage });
    } catch (error) {
      setToast({ kind: "error", message: databaseErrorMessage(error) });
      setLastRetry(() => retry);
    } finally {
      window.setTimeout(() => setProgress(0), 350);
      setBusy("");
    }
  };

  const openNew = () => {
    if (!activeCollection || isLocked) return;
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT, order: items.length + 1 });
    setErrors({});
    setShowPreview(false);
    setShowForm(true);
  };

  const openEdit = (item: ContentItem) => {
    if (isLocked) return;
    setEditing(item);
    setDraft(itemToDraft(item));
    setErrors({});
    setShowPreview(false);
    setShowForm(true);
  };

  const setField = <K extends keyof ContentDraft>(field: K, value: ContentDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleImage = async (event: ChangeEvent<HTMLInputElement>, thumbnail: boolean) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("Compressing image"); setProgress(5); setToast(null);
    try {
      const compressed = await compressImageForRealtimeDatabase(file, setProgress);
      if (thumbnail) {
        setDraft((current) => ({ ...current, thumbnailDataUrl: compressed.dataUrl, thumbnailUrl: "" }));
      } else {
        setDraft((current) => ({ ...current, imageDataUrl: compressed.dataUrl, imageUrl: "" }));
      }
      setToast({ kind: "success", message: `Image compressed to ${Math.ceil(compressed.bytes / 1024)} KB and is ready to save.` });
    } catch (error) {
      setToast({ kind: "error", message: databaseErrorMessage(error) });
    } finally {
      setBusy("");
      window.setTimeout(() => setProgress(0), 350);
    }
  };

  const saveItem = async () => {
    if (!activeCollection || !meta || !user || isLocked) return;
    const validation = validateContentDraft(activeCollection, draft);
    setErrors(validation);
    if (Object.keys(validation).length) {
      setToast({ kind: "error", message: "Correct the highlighted fields before saving." });
      return;
    }
    const stableNewId = editing ? undefined : createContentItemId(meta.version, activeCollection);
    await runAction("Saving content", async () => {
      setProgress(55);
      await saveContentItem(meta.version, activeCollection, draft, user.uid, editing ?? undefined, stableNewId);
      setShowForm(false);
      setEditing(null);
    }, "Content saved successfully.");
  };

  const requestPublishVersion = () => {
    if (!meta || !user || isLocked) return;
    setConfirmState({
      title: `Publish version ${meta.version}?`,
      body: "Only items marked Published will be copied to the resident app. Residents may be required to review this version.",
      confirmLabel: "Publish version",
      action: async () => runAction("Publishing version", () => publishVersion(meta.version, meta, collections, user.uid), `Version ${meta.version} is now live.`),
    });
  };

  const requestUnpublishVersion = () => {
    if (!meta || !user) return;
    setConfirmState({
      title: `Unpublish version ${meta.version}?`,
      body: "The resident app will stop offering the current orientation. Existing acknowledgment records will be preserved.",
      confirmLabel: "Unpublish",
      danger: true,
      action: async () => runAction("Unpublishing version", () => unpublishActiveVersion(meta.version, user.uid), `Version ${meta.version} is no longer available to residents.`),
    });
  };

  const requestDelete = (item: ContentItem) => {
    if (isLocked) return;
    setConfirmState({
      title: `Delete “${item.title}”?`,
      body: "This removes the item from the editable version. A previously published version is preserved until you publish again.",
      confirmLabel: "Delete content",
      danger: true,
      action: async () => runAction("Deleting content", () => deleteContentItem(item.version, item.collection, item.id), "Content deleted."),
    });
  };

  const moveItem = async (item: ContentItem, direction: -1 | 1) => {
    if (!user || !activeCollection || !meta || isLocked) return;
    const index = items.findIndex((row) => row.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await runAction("Updating order", () => reorderCollection(meta.version, activeCollection, reordered, user.uid), "Display order updated.");
  };

  const saveMetaField = (patch: Partial<VersionMeta>) => {
    if (!meta || !user || isLocked) return;
    setMeta({ ...meta, ...patch });
    void runAction("Saving version settings", () => updateVersionMeta(meta.version, patch, user.uid));
  };

  const changeTitle = (title: string) => {
    if (!meta || !user || isLocked) return;
    setMeta({ ...meta, title });
    if (titleSaveTimer.current) window.clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = window.setTimeout(() => {
      if (title.trim()) void runAction("Saving version title", () => updateVersionMeta(meta.version, { title: title.trim() }, user.uid));
    }, 700);
  };

  if (!authReady || loading) return <DashboardShell title="Media & Education" description="Loading content management…"><div className={styles.loadingCard}><span className={styles.spinner} />Loading Realtime Database content…</div></DashboardShell>;
  if (!user) return <DashboardShell title="Media & Education" description="Administrator access required"><div className={styles.errorCard}><h2>Sign in required</h2><p>Sign in with an administrator account before opening content management.</p></div></DashboardShell>;
  if (!config || !meta) return <DashboardShell title="Media & Education" description="Content management unavailable"><div className={styles.errorCard}><h2>Could not load the content schema</h2><p>{toast?.message ?? "Verify the Firebase configuration and database rules."}</p>{lastRetry && <button onClick={() => void lastRetry()}>Retry</button>}</div></DashboardShell>;

  return <DashboardShell title="Media & Education" description="Publish resident announcements, education, rules, schedules, and onboarding content.">
    <div className={styles.page}>
      {progress > 0 && <div className={styles.progressTrack} aria-label={`${busy} ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
      {toast && <div className={`${styles.toast} ${styles[toast.kind]}`} role="status"><span>{toast.message}</span><div>{toast.kind === "error" && lastRetry && <button onClick={() => void lastRetry()}>Retry</button>}<button aria-label="Close message" onClick={() => setToast(null)}>×</button></div></div>}

      <section className={styles.versionCard}>
        <div className={styles.versionTop}>
          <div><span className={`${styles.statusPill} ${meta.status === "published" ? styles.live : styles.draft}`}>{meta.status}</span><h2>Onboarding version {meta.version}</h2><p>Draft changes are private until this version is published.</p></div>
          <div className={styles.actionRow}>
            <button disabled={Boolean(busy) || !isLocked} onClick={() => void runAction("Creating version", async () => { const next = await createNextVersion(config, user.uid); setToast({ kind: "success", message: `Version ${next} created as a draft.` }); }, undefined)}>Create New Version</button>
            <button disabled={Boolean(busy) || isLocked} onClick={() => void runAction("Migrating content", async () => { const count = await migrateLegacyContent(user.uid); setToast({ kind: "success", message: `${count} legacy content items imported.` }); }, undefined)}>Import Existing Content</button>
            {config.publicAvailable && config.lastPublishedVersion === meta.version && <button className={styles.dangerButton} disabled={Boolean(busy)} onClick={requestUnpublishVersion}>Disable Live Version</button>}
            {meta.status !== "published" && <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={requestPublishVersion}>{config.publicAvailable && config.lastPublishedVersion === meta.version ? "Publish Updates" : "Publish Version"}</button>}
          </div>
        </div>
        <div className={styles.versionSettings}>
          <label className={styles.titleField}>Version title<input value={meta.title} maxLength={120} disabled={isLocked} onChange={(event) => changeTitle(event.target.value)} /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={meta.forceReview} disabled={isLocked} onChange={(event) => saveMetaField({ forceReview: event.target.checked })} />Require residents to review</label>
          <label className={styles.checkbox}><input type="checkbox" checked={meta.allowOptionalSkip} disabled={isLocked} onChange={(event) => saveMetaField({ allowOptionalSkip: event.target.checked })} />Allow optional items to be skipped</label>
          <div className={styles.versionStat}><span>Last published</span><strong>{formatDate(meta.publishedAt)}</strong></div>
        </div>
      </section>

      <nav className={styles.tabs} aria-label="Content sections">
        {COLLECTIONS.map((id) => <button key={id} className={tab === id ? styles.activeTab : ""} onClick={() => { setTab(id); setShowForm(false); }}>{COLLECTION_LABELS[id]}</button>)}
        <button className={tab === "acknowledgments" ? styles.activeTab : ""} onClick={() => { setTab("acknowledgments"); setShowForm(false); }}>Resident Reviews</button>
      </nav>

      {activeCollection ? <section className={styles.panel}>
        <header className={styles.panelHead}><div><h2>{COLLECTION_LABELS[activeCollection]}</h2><p>{publishedCount} marked for publishing · {items.length} total{isLocked ? " · Published versions are locked" : ""}</p></div><button className={styles.primaryButton} disabled={Boolean(busy) || isLocked} onClick={openNew}>Add Content</button></header>
        {items.length === 0 ? <div className={styles.empty}><div>＋</div><h3>No {COLLECTION_LABELS[activeCollection].toLowerCase()} yet</h3><p>Create the first item or import content from the previous database structure.</p><button onClick={openNew}>Create first item</button></div>
          : <div className={styles.itemList}>{items.map((item, index) => <article className={styles.itemCard} key={item.id}>
            <div className={styles.orderControls}><button disabled={index === 0 || Boolean(busy) || isLocked} aria-label="Move up" onClick={() => void moveItem(item, -1)}>↑</button><strong>{index + 1}</strong><button disabled={index === items.length - 1 || Boolean(busy) || isLocked} aria-label="Move down" onClick={() => void moveItem(item, 1)}>↓</button></div>
            {(item.imageDataUrl || item.imageUrl || item.thumbnailDataUrl || item.thumbnailUrl) && <img className={styles.thumb} src={item.imageDataUrl || item.imageUrl || item.thumbnailDataUrl || item.thumbnailUrl} alt="" />}
            <div className={styles.itemCopy}><div><h3>{item.title}</h3>{item.required && <span className={styles.requiredPill}>Required</span>}<span className={`${styles.itemStatus} ${item.published ? styles.itemLive : ""}`}>{item.published ? "Ready to publish" : "Draft item"}</span></div><p>{item.description || item.penalty || `${item.scheduleDay} ${item.collectionTime}` || "No description"}</p><small>Updated {formatDate(item.updatedAt)}</small></div>
            <div className={styles.itemActions}><button disabled={isLocked} onClick={() => openEdit(item)}>Edit</button><button disabled={Boolean(busy) || isLocked} onClick={() => void runAction("Updating status", () => setItemPublished(item.version, item.collection, item.id, !item.published, user.uid), item.published ? "Item returned to draft." : "Item marked for publishing.")}>{item.published ? "Unpublish" : "Publish"}</button><button disabled={isLocked} className={styles.textDanger} onClick={() => requestDelete(item)}>Delete</button></div>
          </article>)}</div>}
      </section> : <AcknowledgmentsPanel version={config.lastPublishedVersion} rows={acknowledgments} counts={acknowledgmentCounts} />}
    </div>

    {showForm && activeCollection && <ContentForm collection={activeCollection} draft={draft} errors={errors} editing={Boolean(editing)} busy={busy} preview={showPreview} onPreview={() => setShowPreview((value) => !value)} onClose={() => setShowForm(false)} onSave={() => void saveItem()} onField={setField} onImage={handleImage} />}
    {confirmState && <ConfirmDialog state={confirmState} busy={busy} onClose={() => setConfirmState(null)} />}
  </DashboardShell>;
}

function AcknowledgmentsPanel({ version, rows, counts }: { version: number; rows: ResidentAcknowledgment[]; counts: Record<string, number> }) {
  return <section className={styles.panel}>
    <header className={styles.panelHead}><div><h2>Resident Reviews</h2><p>Published version {version || "none"}</p></div></header>
    <div className={styles.metrics}><div><span>Completed</span><strong>{counts.completed}</strong></div><div><span>Skipped</span><strong>{counts.skipped}</strong></div><div><span>In progress</span><strong>{counts.in_progress}</strong></div><div><span>Total records</span><strong>{rows.length}</strong></div></div>
    {!version ? <div className={styles.empty}><h3>No published version</h3><p>Publish a content version before collecting resident review records.</p></div>
      : rows.length === 0 ? <div className={styles.empty}><h3>No resident activity yet</h3><p>Review records will appear here in real time.</p></div>
        : <div className={styles.tableWrap}><table><thead><tr><th>Resident</th><th>Status</th><th>Required progress</th><th>Updated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.uid}><td><strong>{row.displayName || "Resident"}</strong><span>{row.email || row.uid}</span></td><td><span className={`${styles.reviewStatus} ${styles[row.status]}`}>{row.status}</span></td><td>{row.reviewedRequiredCount} / {row.requiredItemCount}</td><td>{formatDate(row.updatedAt)}</td></tr>)}</tbody></table></div>}
  </section>;
}

function ContentForm({ collection, draft, errors, editing, busy, preview, onPreview, onClose, onSave, onField, onImage }: {
  collection: CollectionId;
  draft: ContentDraft;
  errors: ValidationErrors;
  editing: boolean;
  busy: string;
  preview: boolean;
  onPreview: () => void;
  onClose: () => void;
  onSave: () => void;
  onField: <K extends keyof ContentDraft>(field: K, value: ContentDraft[K]) => void;
  onImage: (event: ChangeEvent<HTMLInputElement>, thumbnail: boolean) => Promise<void>;
}) {
  const usesMainImage = collection === "advertisements" || collection === "guides" || collection === "announcements";
  return <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={`${editing ? "Edit" : "Add"} ${COLLECTION_LABELS[collection]}`}>
    <header className={styles.modalHead}><div><small>{editing ? "EDIT CONTENT" : "NEW CONTENT"}</small><h2>{COLLECTION_LABELS[collection]}</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
    <div className={styles.formGrid}>
      <Field label="Title" error={errors.title} wide><input value={draft.title} maxLength={120} onChange={(event) => onField("title", event.target.value)} /></Field>
      <Field label="Description / main message" error={errors.description} wide><textarea rows={4} value={draft.description} maxLength={2000} onChange={(event) => onField("description", event.target.value)} /></Field>

      {collection === "videos" && <>
        <Field label="Video source"><select value={draft.videoSourceType} onChange={(event) => onField("videoSourceType", event.target.value as ContentDraft["videoSourceType"])}><option value="hosted">Hosted URL</option><option value="bundled">Android raw resource</option></select></Field>
        <Field label="Category" error={errors.category}><input value={draft.category} maxLength={80} onChange={(event) => onField("category", event.target.value)} /></Field>
        {draft.videoSourceType === "hosted" ? <Field label="YouTube, Vimeo, or direct HTTPS MP4 URL" error={errors.videoUrl} wide><input type="url" placeholder="https://…" value={draft.videoUrl} onChange={(event) => onField("videoUrl", event.target.value)} /></Field>
          : <Field label="Android raw resource name" error={errors.bundledResourceName} wide><input placeholder="waste_intro" value={draft.bundledResourceName} onChange={(event) => onField("bundledResourceName", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} /><small>Place the matching MP4 in app/src/main/res/raw/. Do not include .mp4 here.</small></Field>}
        <ImageFields label="Video thumbnail" url={draft.thumbnailUrl} dataUrl={draft.thumbnailDataUrl} error={errors.thumbnailUrl || errors.thumbnailDataUrl} onUrl={(value) => { onField("thumbnailUrl", value); if (value) onField("thumbnailDataUrl", ""); }} onFile={(event) => void onImage(event, true)} onClear={() => { onField("thumbnailUrl", ""); onField("thumbnailDataUrl", ""); }} />
      </>}

      {usesMainImage && <ImageFields label="Small image" url={draft.imageUrl} dataUrl={draft.imageDataUrl} error={errors.imageUrl || errors.imageDataUrl} onUrl={(value) => { onField("imageUrl", value); if (value) onField("imageDataUrl", ""); }} onFile={(event) => void onImage(event, false)} onClear={() => { onField("imageUrl", ""); onField("imageDataUrl", ""); }} />}
      {collection === "announcements" && <Field label="Audience" error={errors.audience}><input value={draft.audience} maxLength={80} onChange={(event) => onField("audience", event.target.value)} /></Field>}
      {collection === "violations" && <><Field label="Penalty" error={errors.penalty}><input value={draft.penalty} maxLength={240} onChange={(event) => onField("penalty", event.target.value)} /></Field><Field label="Ordinance reference"><input value={draft.ordinanceReference} maxLength={160} onChange={(event) => onField("ordinanceReference", event.target.value)} /></Field></>}
      {collection === "schedules" && <><Field label="Service area" error={errors.serviceArea}><input value={draft.serviceArea} maxLength={120} onChange={(event) => onField("serviceArea", event.target.value)} /></Field><Field label="Collection day" error={errors.scheduleDay}><input placeholder="Monday and Thursday" value={draft.scheduleDay} maxLength={100} onChange={(event) => onField("scheduleDay", event.target.value)} /></Field><Field label="Collection time" error={errors.collectionTime}><input placeholder="6:00 AM–9:00 AM" value={draft.collectionTime} maxLength={100} onChange={(event) => onField("collectionTime", event.target.value)} /></Field></>}
      <Field label="Notes / additional instructions" error={errors.notes} wide><textarea rows={3} value={draft.notes} maxLength={1500} onChange={(event) => onField("notes", event.target.value)} /></Field>
      <Field label="Display order" error={errors.order}><input type="number" min="1" max="9999" value={draft.order} onChange={(event) => onField("order", Number(event.target.value))} /></Field>
      <div className={styles.checkGroup}><label><input type="checkbox" checked={draft.published} onChange={(event) => onField("published", event.target.checked)} />Include when version is published</label><label><input type="checkbox" checked={draft.required} onChange={(event) => onField("required", event.target.checked)} />Resident must review</label></div>
    </div>
    {preview && <ContentPreview collection={collection} draft={draft} />}
    <footer className={styles.modalActions}><button onClick={onClose}>Cancel</button><button onClick={onPreview}>{preview ? "Hide Preview" : "Preview"}</button><button className={styles.primaryButton} disabled={Boolean(busy)} onClick={onSave}>{busy === "Saving content" ? "Saving…" : "Save Content"}</button></footer>
  </section></div>;
}

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return <label className={`${styles.field} ${wide ? styles.wide : ""}`}><span>{label}</span>{children}{error && <em>{error}</em>}</label>;
}

function ImageFields({ label, url, dataUrl, error, onUrl, onFile, onClear }: { label: string; url: string; dataUrl: string; error?: string; onUrl: (value: string) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onClear: () => void }) {
  return <div className={`${styles.imageFields} ${styles.wide}`}><Field label={`${label} URL`} error={error}><input type="url" placeholder="https://…/image.jpg" value={url} onChange={(event) => onUrl(event.target.value)} /></Field><label className={styles.filePicker}><span>Or choose a JPG, PNG, or WebP (max 8 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} /><strong>{dataUrl ? "Compressed image ready ✓" : "Choose and compress image"}</strong></label>{(url || dataUrl) && <button className={styles.clearMedia} type="button" onClick={onClear}>Remove image</button>}</div>;
}

function ContentPreview({ collection, draft }: { collection: CollectionId; draft: ContentDraft }) {
  let video: ReturnType<typeof parseVideoUrl> | null = null;
  let videoError = "";
  if (collection === "videos" && draft.videoSourceType === "hosted" && draft.videoUrl) {
    try { video = parseVideoUrl(draft.videoUrl); } catch (error) { videoError = databaseErrorMessage(error); }
  }
  return <div className={styles.preview}><small>RESIDENT PREVIEW</small>{collection === "videos" && video?.kind === "mp4" && <video controls preload="metadata" src={video.mediaUrl} />}{collection === "videos" && video && video.kind !== "mp4" && <iframe src={video.embedUrl} title={draft.title || "Video preview"} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />}{collection === "videos" && draft.videoSourceType === "bundled" && <div className={styles.previewNote}>Bundled Android resource: <strong>{draft.bundledResourceName || "resource name required"}</strong></div>}{videoError && <div className={styles.previewError}>{videoError}</div>}{(draft.imageDataUrl || draft.imageUrl || draft.thumbnailDataUrl || draft.thumbnailUrl) && <img src={draft.imageDataUrl || draft.imageUrl || draft.thumbnailDataUrl || draft.thumbnailUrl} alt="Preview" />}<h3>{draft.title || "Untitled content"}</h3><p>{draft.description || "No description yet."}</p>{draft.penalty && <strong>Penalty: {draft.penalty}</strong>}{draft.serviceArea && <strong>{draft.serviceArea}: {draft.scheduleDay}, {draft.collectionTime}</strong>}</div>;
}

function ConfirmDialog({ state, busy, onClose }: { state: ConfirmState; busy: string; onClose: () => void }) {
  const confirm = async () => { await state.action(); onClose(); };
  return <div className={styles.backdrop}><section className={styles.confirmDialog} role="alertdialog" aria-modal="true"><h2>{state.title}</h2><p>{state.body}</p><div><button disabled={Boolean(busy)} onClick={onClose}>Cancel</button><button disabled={Boolean(busy)} className={state.danger ? styles.dangerButton : styles.primaryButton} onClick={() => void confirm()}>{busy || state.confirmLabel}</button></div></section></div>;
}
