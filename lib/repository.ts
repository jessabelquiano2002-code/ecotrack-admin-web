import {
  get,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type DataSnapshot,
  type Unsubscribe,
} from "firebase/database";
import { db } from "./firebase";
import {
  COLLECTIONS,
  EMPTY_DRAFT,
  type AdminConfig,
  type CollectionId,
  type ContentDraft,
  type ContentItem,
  type ResidentAcknowledgment,
  type ReviewStatus,
  type VersionMeta,
} from "./types";

const ADMIN_CONFIG = "content/admin/config";
const ADMIN_VERSIONS = "content/admin/versions";
const PUBLIC_CONFIG = "content/public/config";
const PUBLIC_VERSIONS = "content/public/versions";
const REVIEWS = "residentOnboarding";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
const asString = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const asBoolean = (value: unknown, fallback = false) => typeof value === "boolean" ? value : fallback;
const asNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

const emptyCollections = (): Record<CollectionId, ContentItem[]> => ({
  advertisements: [],
  videos: [],
  announcements: [],
  guides: [],
  violations: [],
  schedules: [],
});

const parseAdminConfig = (value: unknown): AdminConfig => {
  const raw = asRecord(value);
  return {
    draftVersion: Math.max(1, asNumber(raw.draftVersion, 1)),
    lastPublishedVersion: Math.max(0, asNumber(raw.lastPublishedVersion, 0)),
    publicAvailable: asBoolean(raw.publicAvailable, false),
    updatedAt: asNumber(raw.updatedAt, 0) || null,
    updatedBy: asString(raw.updatedBy),
  };
};

const parseMeta = (value: unknown, version: number): VersionMeta => {
  const raw = asRecord(value);
  return {
    version,
    title: asString(raw.title, "Waste Management Orientation"),
    status: raw.status === "published" ? "published" : "draft",
    forceReview: asBoolean(raw.forceReview, true),
    allowOptionalSkip: asBoolean(raw.allowOptionalSkip, true),
    createdAt: asNumber(raw.createdAt, 0) || null,
    createdBy: asString(raw.createdBy),
    updatedAt: asNumber(raw.updatedAt, 0) || null,
    updatedBy: asString(raw.updatedBy),
    publishedAt: asNumber(raw.publishedAt, 0) || null,
    publishedBy: asString(raw.publishedBy),
  };
};

const parseItem = (
  id: string,
  version: number,
  collection: CollectionId,
  value: unknown,
): ContentItem => {
  const raw = asRecord(value);
  return {
    ...EMPTY_DRAFT,
    id,
    version,
    collection,
    title: asString(raw.title),
    description: asString(raw.description, asString(raw.body, asString(raw.message))),
    category: asString(raw.category),
    audience: asString(raw.audience),
    imageUrl: asString(raw.imageUrl),
    imageDataUrl: asString(raw.imageDataUrl),
    videoSourceType: raw.videoSourceType === "bundled" ? "bundled" : "hosted",
    videoUrl: asString(raw.videoUrl, asString(raw.url)),
    bundledResourceName: asString(raw.bundledResourceName),
    thumbnailUrl: asString(raw.thumbnailUrl),
    thumbnailDataUrl: asString(raw.thumbnailDataUrl),
    penalty: asString(raw.penalty),
    ordinanceReference: asString(raw.ordinanceReference),
    serviceArea: asString(raw.serviceArea),
    scheduleDay: asString(raw.scheduleDay),
    collectionTime: asString(raw.collectionTime),
    notes: asString(raw.notes, asString(raw.examples)),
    order: Math.max(1, asNumber(raw.order, 1)),
    required: asBoolean(raw.required, false),
    published: asBoolean(raw.published, false),
    createdAt: asNumber(raw.createdAt, 0) || null,
    createdBy: asString(raw.createdBy),
    updatedAt: asNumber(raw.updatedAt, 0) || null,
    updatedBy: asString(raw.updatedBy),
  };
};

const parseVersion = (snapshot: DataSnapshot, version: number) => {
  const value = asRecord(snapshot.val());
  const collections = emptyCollections();
  for (const collection of COLLECTIONS) {
    const rows = asRecord(value[collection]);
    collections[collection] = Object.entries(rows)
      .map(([id, row]) => parseItem(id, version, collection, row))
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  }
  return { meta: parseMeta(value.meta, version), collections };
};

const itemForWrite = (
  draft: ContentDraft,
  existing: ContentItem | undefined,
  id: string,
  version: number,
  collection: CollectionId,
  uid: string,
) => ({
  ...draft,
  id,
  version,
  collection,
  title: draft.title.trim(),
  description: draft.description.trim(),
  category: draft.category.trim(),
  audience: draft.audience.trim(),
  imageUrl: draft.imageUrl.trim(),
  videoUrl: draft.videoUrl.trim(),
  bundledResourceName: draft.bundledResourceName.trim(),
  thumbnailUrl: draft.thumbnailUrl.trim(),
  penalty: draft.penalty.trim(),
  ordinanceReference: draft.ordinanceReference.trim(),
  serviceArea: draft.serviceArea.trim(),
  scheduleDay: draft.scheduleDay.trim(),
  collectionTime: draft.collectionTime.trim(),
  notes: draft.notes.trim(),
  createdAt: existing?.createdAt ?? serverTimestamp(),
  createdBy: existing?.createdBy || uid,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});

/**
 * DEVELOPMENT / FIREBASE TEST-MODE AUTHORIZATION
 *
 * Firebase Realtime Database test-mode rules already decide whether the
 * request may read or write. During development, do not require a second
 * admins/{uid}/active record because the existing dashboard authentication
 * may store the administrator role somewhere else.
 *
 * Before production, replace this with a single authorization source that
 * matches your deployed database rules or Firebase custom claims.
 */
const assertAdmin = async (uid: string): Promise<void> => {
  if (!uid || !uid.trim()) {
    throw new Error("Administrator authentication is required.");
  }
};

const assertDraft = async (version: number) => {
  const snapshot = await get(ref(db, `${ADMIN_VERSIONS}/${version}/meta/status`));
  if (snapshot.val() === "published") {
    throw new Error("Published versions are locked. Create a new version before editing.");
  }
};

export async function ensureContentSchema(uid: string): Promise<void> {
  await assertAdmin(uid);
  const configSnapshot = await get(ref(db, ADMIN_CONFIG));
  if (configSnapshot.exists()) return;

  const now = serverTimestamp();
  await update(ref(db), {
    [ADMIN_CONFIG]: {
      draftVersion: 1,
      lastPublishedVersion: 0,
      publicAvailable: false,
      updatedAt: now,
      updatedBy: uid,
    },
    [`${ADMIN_VERSIONS}/1/meta`]: {
      version: 1,
      title: "Waste Management Orientation",
      status: "draft",
      forceReview: true,
      allowOptionalSkip: true,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
      publishedAt: null,
      publishedBy: "",
    },
    [PUBLIC_CONFIG]: {
      available: false,
      publicAvailable: false,
      activeVersion: 0,
      lastPublishedVersion: 0,
      updatedAt: now,
      updatedBy: uid,
    },
  });
}

export function subscribeAdminConfig(
  onData: (config: AdminConfig) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(db, ADMIN_CONFIG),
    (snapshot) => onData(parseAdminConfig(snapshot.val())),
    onError,
  );
}

export function subscribeVersion(
  version: number,
  onData: (meta: VersionMeta, collections: Record<CollectionId, ContentItem[]>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(db, `${ADMIN_VERSIONS}/${version}`),
    (snapshot) => {
      const parsed = parseVersion(snapshot, version);
      onData(parsed.meta, parsed.collections);
    },
    onError,
  );
}

export function createContentItemId(version: number, collection: CollectionId): string {
  const key = push(ref(db, `${ADMIN_VERSIONS}/${version}/${collection}`)).key;
  if (!key) throw new Error("Could not create a content ID.");
  return key;
}

export async function saveContentItem(
  version: number,
  collection: CollectionId,
  draft: ContentDraft,
  uid: string,
  existing?: ContentItem,
  stableNewId?: string,
): Promise<void> {
  await assertAdmin(uid);
  await assertDraft(version);
  const id = existing?.id ?? stableNewId ?? createContentItemId(version, collection);
  await set(
    ref(db, `${ADMIN_VERSIONS}/${version}/${collection}/${id}`),
    itemForWrite(draft, existing, id, version, collection, uid),
  );
  await update(ref(db, `${ADMIN_VERSIONS}/${version}/meta`), {
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function deleteContentItem(
  version: number,
  collection: CollectionId,
  id: string,
): Promise<void> {
  await assertDraft(version);
  await remove(ref(db, `${ADMIN_VERSIONS}/${version}/${collection}/${id}`));
}

export async function setItemPublished(
  version: number,
  collection: CollectionId,
  id: string,
  published: boolean,
  uid: string,
): Promise<void> {
  await assertAdmin(uid);
  await assertDraft(version);
  await update(ref(db, `${ADMIN_VERSIONS}/${version}/${collection}/${id}`), {
    published,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function reorderCollection(
  version: number,
  collection: CollectionId,
  rows: ContentItem[],
  uid: string,
): Promise<void> {
  await assertAdmin(uid);
  await assertDraft(version);
  const changes: Record<string, unknown> = {};
  rows.forEach((row, index) => {
    const path = `${ADMIN_VERSIONS}/${version}/${collection}/${row.id}`;
    changes[`${path}/order`] = index + 1;
    changes[`${path}/updatedAt`] = serverTimestamp();
    changes[`${path}/updatedBy`] = uid;
  });
  await update(ref(db), changes);
}

export async function updateVersionMeta(
  version: number,
  patch: Partial<VersionMeta>,
  uid: string,
): Promise<void> {
  await assertAdmin(uid);
  await assertDraft(version);
  const allowed: Record<string, unknown> = {};
  if (typeof patch.title === "string" && patch.title.trim()) allowed.title = patch.title.trim();
  if (typeof patch.forceReview === "boolean") allowed.forceReview = patch.forceReview;
  if (typeof patch.allowOptionalSkip === "boolean") allowed.allowOptionalSkip = patch.allowOptionalSkip;
  if (!Object.keys(allowed).length) return;
  allowed.updatedAt = serverTimestamp();
  allowed.updatedBy = uid;
  await update(ref(db, `${ADMIN_VERSIONS}/${version}/meta`), allowed);
}

export async function publishVersion(
  version: number,
  _visibleMeta: VersionMeta,
  _visibleCollections: Record<CollectionId, ContentItem[]>,
  uid: string,
): Promise<void> {
  await assertAdmin(uid);
  const snapshot = await get(ref(db, `${ADMIN_VERSIONS}/${version}`));
  if (!snapshot.exists()) throw new Error(`Version ${version} does not exist.`);
  const { meta, collections } = parseVersion(snapshot, version);
  if (meta.status === "published") throw new Error("This version is already published.");
  if (!meta.title.trim()) throw new Error("Enter a version title before publishing.");

  const publicVersion: Record<string, unknown> = {};
  let publishedItemCount = 0;
  let requiredItemCount = 0;

  for (const collection of COLLECTIONS) {
    const publishedRows = collections[collection].filter((item) => item.published);
    if (!publishedRows.length) continue;
    publicVersion[collection] = Object.fromEntries(publishedRows.map((item) => {
      publishedItemCount++;
      if (item.required) requiredItemCount++;
      return [item.id, { ...item, published: true }];
    }));
  }
  if (!publishedItemCount) throw new Error("Mark at least one content item for publishing.");

  const now = serverTimestamp();
  const publicMeta = {
    ...meta,
    status: "published" as const,
    publishedAt: now,
    publishedBy: uid,
    updatedAt: now,
    updatedBy: uid,
  };
  publicVersion.meta = publicMeta;

  await update(ref(db), {
    [`${PUBLIC_VERSIONS}/${version}`]: publicVersion,
    [PUBLIC_CONFIG]: {
      available: true,
      publicAvailable: true,
      activeVersion: version,
      lastPublishedVersion: version,
      title: meta.title.trim(),
      forceReview: meta.forceReview,
      allowOptionalSkip: meta.allowOptionalSkip,
      publishedItemCount,
      requiredItemCount,
      publishedAt: now,
      publishedBy: uid,
      updatedAt: now,
      updatedBy: uid,
    },
    [`${ADMIN_VERSIONS}/${version}/meta/status`]: "published",
    [`${ADMIN_VERSIONS}/${version}/meta/publishedAt`]: now,
    [`${ADMIN_VERSIONS}/${version}/meta/publishedBy`]: uid,
    [`${ADMIN_VERSIONS}/${version}/meta/updatedAt`]: now,
    [`${ADMIN_VERSIONS}/${version}/meta/updatedBy`]: uid,
    [`${ADMIN_CONFIG}/draftVersion`]: version,
    [`${ADMIN_CONFIG}/lastPublishedVersion`]: version,
    [`${ADMIN_CONFIG}/publicAvailable`]: true,
    [`${ADMIN_CONFIG}/updatedAt`]: now,
    [`${ADMIN_CONFIG}/updatedBy`]: uid,
  });
}

export async function unpublishActiveVersion(version: number, uid: string): Promise<void> {
  await assertAdmin(uid);
  const config = parseAdminConfig((await get(ref(db, ADMIN_CONFIG))).val());
  if (!config.publicAvailable || config.lastPublishedVersion !== version) {
    throw new Error(`Version ${version} is not the active public version.`);
  }
  const now = serverTimestamp();
  await update(ref(db), {
    [`${PUBLIC_CONFIG}/available`]: false,
    [`${PUBLIC_CONFIG}/publicAvailable`]: false,
    [`${PUBLIC_CONFIG}/activeVersion`]: 0,
    [`${PUBLIC_CONFIG}/updatedAt`]: now,
    [`${PUBLIC_CONFIG}/updatedBy`]: uid,
    [`${ADMIN_CONFIG}/publicAvailable`]: false,
    [`${ADMIN_CONFIG}/updatedAt`]: now,
    [`${ADMIN_CONFIG}/updatedBy`]: uid,
  });
}

export async function createNextVersion(config: AdminConfig, uid: string): Promise<number> {
  await assertAdmin(uid);
  const sourceSnapshot = await get(ref(db, `${ADMIN_VERSIONS}/${config.draftVersion}`));
  if (!sourceSnapshot.exists()) throw new Error("The current version could not be found.");
  const source = parseVersion(sourceSnapshot, config.draftVersion);
  if (source.meta.status !== "published") {
    throw new Error("Finish or publish the current draft before creating another version.");
  }

  const nextVersion = Math.max(config.draftVersion, config.lastPublishedVersion) + 1;
  const destination = await get(ref(db, `${ADMIN_VERSIONS}/${nextVersion}`));
  if (destination.exists()) throw new Error(`Version ${nextVersion} already exists. Reload and try again.`);

  const now = serverTimestamp();
  const next: Record<string, unknown> = {
    meta: {
      ...source.meta,
      version: nextVersion,
      status: "draft",
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
      publishedAt: null,
      publishedBy: "",
    },
  };
  for (const collection of COLLECTIONS) {
    if (!source.collections[collection].length) continue;
    next[collection] = Object.fromEntries(source.collections[collection].map((item) => [
      item.id,
      {
        ...item,
        version: nextVersion,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
    ]));
  }

  await update(ref(db), {
    [`${ADMIN_VERSIONS}/${nextVersion}`]: next,
    [`${ADMIN_CONFIG}/draftVersion`]: nextVersion,
    [`${ADMIN_CONFIG}/updatedAt`]: now,
    [`${ADMIN_CONFIG}/updatedBy`]: uid,
  });
  return nextVersion;
}

export async function migrateLegacyContent(uid: string): Promise<number> {
  await assertAdmin(uid);
  const config = parseAdminConfig((await get(ref(db, ADMIN_CONFIG))).val());
  await assertDraft(config.draftVersion);

  const [wasteSnapshot, onboardingSnapshot] = await Promise.all([
    get(ref(db, "wasteContent")),
    get(ref(db, `onboarding/versions/${config.draftVersion}`)),
  ]);
  const sources = [asRecord(wasteSnapshot.val()), asRecord(onboardingSnapshot.val())];
  const changes: Record<string, unknown> = {};
  let imported = 0;

  for (const collection of COLLECTIONS) {
    for (const source of sources) {
      const rows = asRecord(source[collection]);
      for (const [legacyId, value] of Object.entries(rows)) {
        const id = `legacy_${collection}_${legacyId}`.replace(/[.#$\[\]/]/g, "_");
        const item = parseItem(id, config.draftVersion, collection, value);
        const target = `${ADMIN_VERSIONS}/${config.draftVersion}/${collection}/${id}`;
        const exists = await get(ref(db, target));
        if (exists.exists()) continue;
        changes[target] = itemForWrite(item, undefined, id, config.draftVersion, collection, uid);
        imported++;
      }
    }
  }

  if (imported) await update(ref(db), changes);
  return imported;
}

export function subscribeAcknowledgments(
  version: number,
  onData: (rows: ResidentAcknowledgment[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(ref(db, `${REVIEWS}/${version}`), (snapshot) => {
    const rows = Object.entries(asRecord(snapshot.val())).map(([uid, value]) => {
      const raw = asRecord(value);
      const status: ReviewStatus = raw.status === "completed" || raw.status === "skipped"
        ? raw.status
        : "in_progress";
      return {
        uid,
        version,
        displayName: asString(raw.displayName),
        email: asString(raw.email),
        status,
        requiredItemCount: asNumber(raw.requiredItemCount, 0),
        reviewedRequiredCount: asNumber(raw.reviewedRequiredCount, 0),
        reviewedItemCount: asNumber(raw.reviewedItemCount, 0),
        skippedItemCount: asNumber(raw.skippedItemCount, 0),
        startedAt: asNumber(raw.startedAt, 0) || null,
        updatedAt: asNumber(raw.updatedAt, 0) || null,
        completedAt: asNumber(raw.completedAt, 0) || null,
        skippedAt: asNumber(raw.skippedAt, 0) || null,
      };
    }).sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    onData(rows);
  }, onError);
}

export async function withRetry<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => window.setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

export function databaseErrorMessage(error: unknown): string {
  const value = error as { code?: string; message?: string };
  if (value.code?.includes("permission-denied")) {
    return "Firebase denied this operation. Check the deployed Realtime Database rules and confirm that Firebase Authentication is connected to this project.";
  }
  if (value.code?.includes("network")) return "The network request failed. Check the connection and try again.";
  return value.message || "The operation could not be completed.";
}