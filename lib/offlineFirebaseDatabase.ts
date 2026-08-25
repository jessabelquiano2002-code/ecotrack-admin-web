"use client";

import {
  get as firebaseGet,
  onValue as firebaseOnValue,
  push,
  ref,
  remove as firebaseRemove,
  serverTimestamp,
  set as firebaseSet,
  update as firebaseUpdate,
  type DataSnapshot,
  type DatabaseReference,
  type Query,
  type Unsubscribe,
} from "firebase/database";
import { db } from "./firebase";

export { push, ref, serverTimestamp };
export type { DataSnapshot, DatabaseReference, Query, Unsubscribe };

const DB_NAME = "wastetrack-offline-v1";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const WRITE_STORE = "writes";
const STATUS_EVENT = "wastetrack:offline-state";

type CachedSnapshotRecord = {
  path: string;
  value: unknown;
  updatedAt: number;
};

type QueuedWrite = {
  id: string;
  operation: "set" | "update" | "remove";
  path: string;
  value?: unknown;
  createdAt: number;
};

type OfflineState = {
  online: boolean;
  firebaseConnected: boolean;
  pendingWrites: number;
};

type SnapshotCallback = (snapshot: DataSnapshot) => unknown;

const localListeners = new Map<string, Set<SnapshotCallback>>();
let runtimeStarted = false;
let firebaseConnected = false;
let flushing = false;
let connectionUnsubscribe: Unsubscribe | null = null;

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openOfflineDatabase(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) return Promise.reject(new Error("IndexedDB is unavailable."));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "path" });
      }
      if (!database.objectStoreNames.contains(WRITE_STORE)) {
        database.createObjectStore(WRITE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Could not open the offline database."));
    };
  });

  return databasePromise;
}

async function putRecord(storeName: string, value: unknown): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

async function deleteRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const rows = await requestResult(transaction.objectStore(storeName).getAll()) as T[];
  await transactionDone(transaction);
  return rows;
}

function normalizePath(value: string): string {
  return value
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function pathFromQuery(query: Query): string {
  try {
    const value = new URL(query.toString());
    return normalizePath(decodeURIComponent(value.pathname).replace(/\.json$/i, ""));
  } catch {
    const raw = query.toString().split("?")[0] || "";
    return normalizePath(raw.replace(/^https?:\/\/[^/]+/i, "").replace(/\.json$/i, ""));
  }
}

function keyForPath(path: string): string | null {
  if (!path) return null;
  const parts = path.split("/");
  return parts[parts.length - 1] || null;
}

function getNestedValue(value: unknown, childPath: string): unknown {
  if (!childPath) return value;
  const parts = normalizePath(childPath).split("/").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined ? null : current;
}

function setNestedValue(rootValue: unknown, childPath: string, nextValue: unknown): unknown {
  if (!childPath) return nextValue;
  const parts = normalizePath(childPath).split("/").filter(Boolean);
  const root = rootValue && typeof rootValue === "object" && !Array.isArray(rootValue)
    ? { ...(rootValue as Record<string, unknown>) }
    : {} as Record<string, unknown>;

  let cursor: Record<string, unknown> = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      if (nextValue === null || nextValue === undefined) delete cursor[part];
      else cursor[part] = nextValue;
      return;
    }
    const existing = cursor[part];
    const child = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {} as Record<string, unknown>;
    cursor[part] = child;
    cursor = child;
  });
  return root;
}

function relation(basePath: string, mutationPath: string): "same" | "ancestor" | "descendant" | "none" {
  if (basePath === mutationPath) return "same";
  if (!basePath) return "ancestor";
  if (!mutationPath) return "descendant";
  if (mutationPath.startsWith(`${basePath}/`)) return "ancestor";
  if (basePath.startsWith(`${mutationPath}/`)) return "descendant";
  return "none";
}

function resolveLocalServerValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveLocalServerValues);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (object[".sv"] === "timestamp") return Date.now();
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, resolveLocalServerValues(child)]));
}

async function cacheSnapshot(path: string, value: unknown): Promise<void> {
  if (!canUseIndexedDb()) return;
  await putRecord(SNAPSHOT_STORE, {
    path: normalizePath(path),
    value,
    updatedAt: Date.now(),
  } satisfies CachedSnapshotRecord).catch(() => undefined);
}

async function readCachedRecord(path: string): Promise<CachedSnapshotRecord | null> {
  if (!canUseIndexedDb()) return null;
  const normalized = normalizePath(path);
  try {
    const database = await openOfflineDatabase();
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
    const exact = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(normalized)) as CachedSnapshotRecord | undefined;
    await transactionDone(transaction);
    if (exact) return exact;

    const rows = await getAllRecords<CachedSnapshotRecord>(SNAPSHOT_STORE);
    const parent = rows
      .filter((row) => row.path === "" || normalized.startsWith(`${row.path}/`))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (!parent) return null;
    const relativePath = parent.path ? normalized.slice(parent.path.length + 1) : normalized;
    return {
      path: normalized,
      value: getNestedValue(parent.value, relativePath),
      updatedAt: parent.updatedAt,
    };
  } catch {
    return null;
  }
}

class OfflineSnapshot {
  readonly key: string | null;
  readonly ref: DatabaseReference;

  constructor(
    private readonly storedValue: unknown,
    private readonly storedPath: string,
  ) {
    this.key = keyForPath(storedPath);
    this.ref = ref(db, storedPath);
  }

  val(): unknown {
    return this.storedValue === undefined ? null : this.storedValue;
  }

  exportVal(): unknown {
    return this.val();
  }

  exists(): boolean {
    return this.storedValue !== null && this.storedValue !== undefined;
  }

  child(childPath: string): DataSnapshot {
    const path = normalizePath([this.storedPath, childPath].filter(Boolean).join("/"));
    return new OfflineSnapshot(getNestedValue(this.storedValue, childPath), path) as unknown as DataSnapshot;
  }

  hasChild(childPath: string): boolean {
    const value = getNestedValue(this.storedValue, childPath);
    return value !== null && value !== undefined;
  }

  hasChildren(): boolean {
    return !!this.storedValue && typeof this.storedValue === "object" && Object.keys(this.storedValue as object).length > 0;
  }

  get size(): number {
    if (!this.storedValue || typeof this.storedValue !== "object") return 0;
    return Object.keys(this.storedValue as object).length;
  }

  forEach(action: (child: DataSnapshot) => boolean | void): boolean {
    if (!this.storedValue || typeof this.storedValue !== "object") return false;
    for (const [key, value] of Object.entries(this.storedValue as Record<string, unknown>)) {
      const childPath = normalizePath([this.storedPath, key].filter(Boolean).join("/"));
      const shouldStop = action(new OfflineSnapshot(value, childPath) as unknown as DataSnapshot);
      if (shouldStop === true) return true;
    }
    return false;
  }

  get priority(): string | number | null {
    return null;
  }

  toJSON(): object | null {
    const value = this.val();
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return value as object;
    return { ".value": value };
  }
}

function asSnapshot(value: unknown, path: string): DataSnapshot {
  return new OfflineSnapshot(value, normalizePath(path)) as unknown as DataSnapshot;
}

async function emitOfflineState(): Promise<void> {
  if (typeof window === "undefined") return;
  const pendingWrites = canUseIndexedDb()
    ? await getAllRecords<QueuedWrite>(WRITE_STORE).then((rows) => rows.length).catch(() => 0)
    : 0;
  const detail: OfflineState = {
    online: navigator.onLine,
    firebaseConnected,
    pendingWrites,
  };
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
}

async function notifyLocalListeners(mutationPath: string): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const [listenerPath, callbacks] of localListeners) {
    if (relation(listenerPath, mutationPath) === "none") continue;
    tasks.push((async () => {
      const cached = await readCachedRecord(listenerPath);
      if (!cached) return;
      const snapshot = asSnapshot(cached.value, listenerPath);
      callbacks.forEach((callback) => callback(snapshot));
    })());
  }
  await Promise.all(tasks);
}

async function applySetToCache(mutationPath: string, nextValue: unknown): Promise<void> {
  if (!canUseIndexedDb()) return;
  const normalizedMutation = normalizePath(mutationPath);
  const localValue = resolveLocalServerValues(nextValue);
  const rows = await getAllRecords<CachedSnapshotRecord>(SNAPSHOT_STORE).catch(() => []);
  const changed = new Map<string, CachedSnapshotRecord>();

  for (const row of rows) {
    const state = relation(row.path, normalizedMutation);
    if (state === "none") continue;
    let value = row.value;
    if (state === "same") value = localValue;
    if (state === "ancestor") {
      const relative = row.path ? normalizedMutation.slice(row.path.length + 1) : normalizedMutation;
      value = setNestedValue(row.value, relative, localValue);
    }
    if (state === "descendant") {
      const relative = normalizedMutation ? row.path.slice(normalizedMutation.length + 1) : row.path;
      value = getNestedValue(localValue, relative);
    }
    changed.set(row.path, { path: row.path, value, updatedAt: Date.now() });
  }

  if (!changed.has(normalizedMutation)) {
    changed.set(normalizedMutation, {
      path: normalizedMutation,
      value: localValue,
      updatedAt: Date.now(),
    });
  }

  await Promise.all([...changed.values()].map((row) => putRecord(SNAPSHOT_STORE, row).catch(() => undefined)));
  await notifyLocalListeners(normalizedMutation);
}

async function applyUpdateToCache(basePath: string, values: object): Promise<void> {
  const normalizedBase = normalizePath(basePath);
  for (const [childPath, value] of Object.entries(values as Record<string, unknown>)) {
    const fullPath = normalizePath([normalizedBase, childPath].filter(Boolean).join("/"));
    await applySetToCache(fullPath, value);
  }
}

function createWriteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `write-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function queueWrite(operation: QueuedWrite["operation"], path: string, value?: unknown): Promise<QueuedWrite> {
  const write: QueuedWrite = {
    id: createWriteId(),
    operation,
    path: normalizePath(path),
    value,
    createdAt: Date.now(),
  };
  if (canUseIndexedDb()) await putRecord(WRITE_STORE, write).catch(() => undefined);
  await emitOfflineState();
  return write;
}

async function executeQueuedWrite(write: QueuedWrite): Promise<void> {
  const target = ref(db, write.path);
  if (write.operation === "set") await firebaseSet(target, write.value);
  if (write.operation === "update") await firebaseUpdate(target, (write.value || {}) as object);
  if (write.operation === "remove") await firebaseRemove(target);
}

export async function flushOfflineWrites(): Promise<void> {
  if (flushing || typeof window === "undefined" || !navigator.onLine || !firebaseConnected || !canUseIndexedDb()) return;
  flushing = true;
  try {
    const writes = await getAllRecords<QueuedWrite>(WRITE_STORE);
    writes.sort((left, right) => left.createdAt - right.createdAt);
    for (const write of writes) {
      if (!navigator.onLine || !firebaseConnected) break;
      try {
        await executeQueuedWrite(write);
        await deleteRecord(WRITE_STORE, write.id);
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
    await emitOfflineState();
  }
}

export function startOfflineRuntime(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (runtimeStarted) {
    void emitOfflineState();
    return () => undefined;
  }
  runtimeStarted = true;

  const handleOnline = () => {
    void emitOfflineState();
    void flushOfflineWrites();
  };
  const handleOffline = () => void emitOfflineState();
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  connectionUnsubscribe = firebaseOnValue(ref(db, ".info/connected"), (snapshot) => {
    firebaseConnected = snapshot.val() === true;
    void emitOfflineState();
    if (firebaseConnected) void flushOfflineWrites();
  });

  void emitOfflineState();
  if (navigator.onLine) void flushOfflineWrites();

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    connectionUnsubscribe?.();
    connectionUnsubscribe = null;
    runtimeStarted = false;
  };
}

export function subscribeOfflineState(listener: (state: OfflineState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<OfflineState>).detail);
  window.addEventListener(STATUS_EVENT, handler);
  void emitOfflineState();
  return () => window.removeEventListener(STATUS_EVENT, handler);
}

export async function clearOfflineDatabase(): Promise<void> {
  if (!canUseIndexedDb()) return;
  try {
    const database = await openOfflineDatabase();
    const transaction = database.transaction([SNAPSHOT_STORE, WRITE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).clear();
    transaction.objectStore(WRITE_STORE).clear();
    await transactionDone(transaction);
  } catch {
    // Best effort. A sign-out should not be blocked by browser storage errors.
  }
  await emitOfflineState();
}

export function onValue(
  query: Query,
  callback: SnapshotCallback,
  cancelCallback?: (error: Error) => unknown,
): Unsubscribe {
  const path = pathFromQuery(query);
  let active = true;
  let receivedServerValue = false;
  let cacheDelivered = false;

  if (!localListeners.has(path)) localListeners.set(path, new Set());
  localListeners.get(path)!.add(callback);

  void readCachedRecord(path).then((cached) => {
    if (!active || !cached || receivedServerValue) return;
    cacheDelivered = true;
    callback(asSnapshot(cached.value, path));
  });

  const unsubscribe = firebaseOnValue(
    query,
    (snapshot) => {
      receivedServerValue = true;
      void cacheSnapshot(path, snapshot.val());
      callback(snapshot);
    },
    (error) => {
      void readCachedRecord(path).then((cached) => {
        if (!active) return;
        if (cached && !cacheDelivered) {
          cacheDelivered = true;
          callback(asSnapshot(cached.value, path));
          return;
        }
        if (!cached) cancelCallback?.(error);
      });
    },
  );

  return () => {
    active = false;
    unsubscribe();
    const callbacks = localListeners.get(path);
    callbacks?.delete(callback);
    if (callbacks?.size === 0) localListeners.delete(path);
  };
}

export async function get(query: Query): Promise<DataSnapshot> {
  const path = pathFromQuery(query);
  if (typeof window !== "undefined" && !navigator.onLine) {
    const cached = await readCachedRecord(path);
    if (cached) return asSnapshot(cached.value, path);
  }

  try {
    const snapshot = await firebaseGet(query);
    await cacheSnapshot(path, snapshot.val());
    return snapshot;
  } catch (error) {
    const cached = await readCachedRecord(path);
    if (cached) return asSnapshot(cached.value, path);
    throw error;
  }
}

export async function set(target: DatabaseReference, value: unknown): Promise<void> {
  const path = pathFromQuery(target);
  const queued = await queueWrite("set", path, value);
  await applySetToCache(path, value);

  if (typeof window !== "undefined" && (!navigator.onLine || !firebaseConnected)) return;
  try {
    await firebaseSet(target, value);
    await deleteRecord(WRITE_STORE, queued.id).catch(() => undefined);
    await emitOfflineState();
  } catch {
    // Keep the durable IndexedDB write queued. It will retry when connectivity returns.
  }
}

export async function update(target: DatabaseReference, values: object): Promise<void> {
  const path = pathFromQuery(target);
  const queued = await queueWrite("update", path, values);
  await applyUpdateToCache(path, values);

  if (typeof window !== "undefined" && (!navigator.onLine || !firebaseConnected)) return;
  try {
    await firebaseUpdate(target, values);
    await deleteRecord(WRITE_STORE, queued.id).catch(() => undefined);
    await emitOfflineState();
  } catch {
    // Keep the durable IndexedDB write queued. It will retry when connectivity returns.
  }
}

export async function remove(target: DatabaseReference): Promise<void> {
  const path = pathFromQuery(target);
  const queued = await queueWrite("remove", path);
  await applySetToCache(path, null);

  if (typeof window !== "undefined" && (!navigator.onLine || !firebaseConnected)) return;
  try {
    await firebaseRemove(target);
    await deleteRecord(WRITE_STORE, queued.id).catch(() => undefined);
    await emitOfflineState();
  } catch {
    // Keep the durable IndexedDB write queued. It will retry when connectivity returns.
  }
}
