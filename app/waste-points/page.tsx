"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from "@/lib/offlineFirebaseDatabase";
import { db } from "../../lib/firebase";
import { DashboardShell } from "../components/DashboardShell";

type WastePointRecord = {
  name?: string;
  barangay?: string;
  landmark?: string;
  instructions?: string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  active?: boolean;
  category?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
};

type WastePoint = {
  id: string;
  name: string;
  barangay: string;
  landmark: string;
  instructions: string;
  latitude: number;
  longitude: number;
  active: boolean;
  updatedAt: number;
};

type FormState = {
  name: string;
  barangay: string;
  landmark: string;
  instructions: string;
  active: boolean;
};

const DEFAULT_CENTER: [number, number] = [124.886, 11.775];
const DEFAULT_ZOOM = 13;
const MIN_ZOOM = 4;
const MAX_ZOOM = 19;
const TILE_SIZE = 256;
const WEB_MERCATOR_MAX_LAT = 85.05112878;

type MapCenter = [longitude: number, latitude: number];
type PixelPoint = { x: number; y: number };
type MapDimensions = { width: number; height: number };

type InteractiveWasteMapProps = {
  center: MapCenter;
  zoom: number;
  points: WastePoint[];
  selectedId: string;
  draftLatitude: number | null;
  draftLongitude: number | null;
  placementMode: boolean;
  onViewChange: (center: MapCenter, zoom: number) => void;
  onChooseLocation: (latitude: number, longitude: number) => void;
  onSelectPoint: (point: WastePoint) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function worldSizeAtZoom(zoom: number) {
  return TILE_SIZE * 2 ** zoom;
}

function projectToWorld(latitude: number, longitude: number, zoom: number): PixelPoint {
  const lat = clamp(latitude, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT);
  const worldSize = worldSizeAtZoom(zoom);
  const x = ((wrapLongitude(longitude) + 180) / 360) * worldSize;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

function unprojectFromWorld(x: number, y: number, zoom: number): { latitude: number; longitude: number } {
  const worldSize = worldSizeAtZoom(zoom);
  const normalizedX = ((x % worldSize) + worldSize) % worldSize;
  const longitude = (normalizedX / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return {
    latitude: clamp(latitude, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT),
    longitude: wrapLongitude(longitude),
  };
}

function fitWastePoints(points: WastePoint[]): { center: MapCenter; zoom: number } {
  if (points.length === 0) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  if (points.length === 1) {
    return { center: [points[0].longitude, points[0].latitude], zoom: 16 };
  }

  const projected = points.map((point) => projectToWorld(point.latitude, point.longitude, 0));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.000001);
  const spanY = Math.max(maxY - minY, 0.000001);
  const targetWidth = 820;
  const targetHeight = 430;
  const zoomX = Math.log2(targetWidth / spanX);
  const zoomY = Math.log2(targetHeight / spanY);
  const zoom = clamp(Math.floor(Math.min(zoomX, zoomY)), 10, 17);
  const centerWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const unprojected = unprojectFromWorld(centerWorld.x, centerWorld.y, 0);
  return { center: [unprojected.longitude, unprojected.latitude], zoom };
}
const DEFAULT_FORM: FormState = {
  name: "",
  barangay: "",
  landmark: "",
  instructions: "Place properly segregated household waste at this official collection point.",
  active: true,
};

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatUpdatedAt(value: number) {
  if (!value) return "Not synced yet";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WasteBinIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={small ? "waste-bin-icon small" : "waste-bin-icon"}
    >
      <path d="M7.4 8.1h9.2l-.8 10.1a2 2 0 0 1-2 1.8h-3.6a2 2 0 0 1-2-1.8L7.4 8.1Zm-1.1-3h3.2l.7-1.3h3.6l.7 1.3h3.2v2H6.3v-2Zm3.7 5v6.9h1.6v-6.9H10Zm3.9 0v6.9h1.6v-6.9h-1.6Z" />
      <path d="M15.5 2.3c2.9.2 5 1.6 5.9 4-2.9.5-5.2-.1-6.8-1.7-.8 1.2-1 2.4-.7 3.7-1.8-2.3-1-4.8 1.6-6Z" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.4 7 13 7 13s7-7.6 7-13a7 7 0 0 0-7-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
    </svg>
  );
}

function WasteMapMarkerGraphic({
  active,
  selected,
  draft = false,
}: {
  active: boolean;
  selected: boolean;
  draft?: boolean;
}) {
  return (
    <span
      className={[
        "waste-map-marker",
        active ? "active" : "inactive",
        selected ? "selected" : "",
        draft ? "draft" : "",
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <span className="waste-marker-pin"><WasteBinIcon small /></span>
      <span className="waste-marker-shadow" />
    </span>
  );
}

function InteractiveWasteMap({
  center,
  zoom,
  points,
  selectedId,
  draftLatitude,
  draftLongitude,
  placementMode,
  onViewChange,
  onChooseLocation,
  onSelectPoint,
}: InteractiveWasteMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<MapCenter>(center);
  const zoomRef = useRef(zoom);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const [dimensions, setDimensions] = useState<MapDimensions>({ width: 960, height: 560 });
  const [tileWarning, setTileWarning] = useState(false);

  useEffect(() => {
    centerRef.current = center;
    zoomRef.current = zoom;
  }, [center, zoom]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : null;
    observer?.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const commitView = (nextCenter: MapCenter, nextZoom: number) => {
    const normalizedCenter: MapCenter = [
      wrapLongitude(nextCenter[0]),
      clamp(nextCenter[1], -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT),
    ];
    const normalizedZoom = clamp(Math.round(nextZoom), MIN_ZOOM, MAX_ZOOM);
    centerRef.current = normalizedCenter;
    zoomRef.current = normalizedZoom;
    onViewChange(normalizedCenter, normalizedZoom);
  };

  const mapGeometry = useMemo(() => {
    const worldCenter = projectToWorld(center[1], center[0], zoom);
    const left = worldCenter.x - dimensions.width / 2;
    const top = worldCenter.y - dimensions.height / 2;
    const right = worldCenter.x + dimensions.width / 2;
    const bottom = worldCenter.y + dimensions.height / 2;
    const tileCount = 2 ** zoom;
    const minTileX = Math.floor(left / TILE_SIZE) - 1;
    const maxTileX = Math.floor(right / TILE_SIZE) + 1;
    const minTileY = Math.max(0, Math.floor(top / TILE_SIZE) - 1);
    const maxTileY = Math.min(tileCount - 1, Math.floor(bottom / TILE_SIZE) + 1);
    const tiles: Array<{ key: string; x: number; y: number; src: string }> = [];

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const requestX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${zoom}-${tileX}-${tileY}`,
          x: tileX * TILE_SIZE - left,
          y: tileY * TILE_SIZE - top,
          src: `https://tile.openstreetmap.org/${zoom}/${requestX}/${tileY}.png`,
        });
      }
    }

    return { worldCenter, left, top, tiles };
  }, [center, zoom, dimensions]);

  const pointToViewport = (latitude: number, longitude: number) => {
    const pointWorld = projectToWorld(latitude, longitude, zoom);
    const worldSize = worldSizeAtZoom(zoom);
    let deltaX = pointWorld.x - mapGeometry.worldCenter.x;
    if (deltaX > worldSize / 2) deltaX -= worldSize;
    if (deltaX < -worldSize / 2) deltaX += worldSize;
    return {
      x: dimensions.width / 2 + deltaX,
      y: dimensions.height / 2 + (pointWorld.y - mapGeometry.worldCenter.y),
    };
  };

  const eventToCoordinates = (clientX: number, clientY: number) => {
    const element = rootRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const worldCenter = projectToWorld(centerRef.current[1], centerRef.current[0], zoomRef.current);
    return unprojectFromWorld(
      worldCenter.x + localX - rect.width / 2,
      worldCenter.y + localY - rect.height / 2,
      zoomRef.current,
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }

    if (drag.moved && (dx !== 0 || dy !== 0)) {
      const currentCenter = centerRef.current;
      const currentZoom = zoomRef.current;
      const centerWorld = projectToWorld(currentCenter[1], currentCenter[0], currentZoom);
      const next = unprojectFromWorld(centerWorld.x - dx, centerWorld.y - dy, currentZoom);
      commitView([next.longitude, next.latitude], currentZoom);
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released by the browser.
    }
    drag.active = false;

    if (!drag.moved && placementMode) {
      const coordinate = eventToCoordinates(event.clientX, event.clientY);
      if (coordinate) onChooseLocation(coordinate.latitude, coordinate.longitude);
    }
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    drag.moved = false;
  };

  const changeZoom = (nextZoom: number, anchorClientX?: number, anchorClientY?: number) => {
    const oldZoom = zoomRef.current;
    const targetZoom = clamp(Math.round(nextZoom), MIN_ZOOM, MAX_ZOOM);
    if (targetZoom === oldZoom) return;

    const element = rootRef.current;
    if (!element || anchorClientX === undefined || anchorClientY === undefined) {
      commitView(centerRef.current, targetZoom);
      return;
    }

    const rect = element.getBoundingClientRect();
    const localX = anchorClientX - rect.left;
    const localY = anchorClientY - rect.top;
    const oldCenterWorld = projectToWorld(centerRef.current[1], centerRef.current[0], oldZoom);
    const anchor = unprojectFromWorld(
      oldCenterWorld.x + localX - rect.width / 2,
      oldCenterWorld.y + localY - rect.height / 2,
      oldZoom,
    );
    const anchorWorldNew = projectToWorld(anchor.latitude, anchor.longitude, targetZoom);
    const nextCenterWorld = {
      x: anchorWorldNew.x - localX + rect.width / 2,
      y: anchorWorldNew.y - localY + rect.height / 2,
    };
    const nextCenter = unprojectFromWorld(nextCenterWorld.x, nextCenterWorld.y, targetZoom);
    commitView([nextCenter.longitude, nextCenter.latitude], targetZoom);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    changeZoom(zoomRef.current + delta, event.clientX, event.clientY);
  };

  const draftPosition = draftLatitude !== null && draftLongitude !== null
    ? pointToViewport(draftLatitude, draftLongitude)
    : null;
  const selectedPoint = selectedId ? points.find((point) => point.id === selectedId) : null;
  const draftMatchesSelected = Boolean(
    selectedPoint
    && draftLatitude !== null
    && draftLongitude !== null
    && Math.abs(selectedPoint.latitude - draftLatitude) < 0.0000001
    && Math.abs(selectedPoint.longitude - draftLongitude) < 0.0000001,
  );
  const metersPerPixel = 156543.03392 * Math.cos((center[1] * Math.PI) / 180) / 2 ** zoom;
  const scaleMeters = metersPerPixel > 20 ? 1000 : metersPerPixel > 5 ? 500 : metersPerPixel > 1 ? 100 : 50;
  const scaleWidth = clamp(scaleMeters / Math.max(metersPerPixel, 0.01), 42, 130);

  return (
    <div
      ref={rootRef}
      className={`native-waste-map ${placementMode ? "placing" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onWheel={handleWheel}
      onDoubleClick={(event) => {
        event.preventDefault();
        changeZoom(zoomRef.current + 1, event.clientX, event.clientY);
      }}
      role="application"
      tabIndex={0}
      aria-label="Interactive OpenStreetMap for official waste drop-off points. Drag to pan, use the zoom buttons or mouse wheel to zoom, and choose location before clicking the map."
    >
      <div className="native-map-tiles" aria-hidden="true">
        {mapGeometry.tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            draggable={false}
            loading="eager"
            style={{ left: tile.x, top: tile.y }}
            onLoad={() => setTileWarning(false)}
            onError={() => setTileWarning(true)}
          />
        ))}
      </div>

      {points.map((point) => {
        const position = pointToViewport(point.latitude, point.longitude);
        if (position.x < -70 || position.x > dimensions.width + 70 || position.y < -80 || position.y > dimensions.height + 80) {
          return null;
        }
        return (
          <button
            key={point.id}
            type="button"
            className="native-map-marker-button"
            style={{ left: position.x, top: position.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelectPoint(point);
            }}
            aria-label={`${point.name}. ${point.active ? "Visible to residents" : "Hidden"}. Click to edit.`}
            title={point.name}
          >
            <WasteMapMarkerGraphic active={point.active} selected={point.id === selectedId} />
          </button>
        );
      })}

      {draftPosition && !draftMatchesSelected && (
        <div
          className="native-map-draft-marker"
          style={{ left: draftPosition.x, top: draftPosition.y }}
          aria-hidden="true"
        >
          <WasteMapMarkerGraphic active selected draft />
        </div>
      )}

      <div className="native-map-provider-badge" aria-hidden="true">
        <span /> OpenStreetMap
      </div>

      {placementMode && (
        <div className="native-map-placement-hint" role="status">
          <MapPinIcon />
          <span><strong>Placement mode</strong> Click the exact drop-off location.</span>
        </div>
      )}

      <div className="native-map-controls" aria-label="Map controls">
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => changeZoom(zoomRef.current + 1)} aria-label="Zoom in">+</button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => changeZoom(zoomRef.current - 1)} aria-label="Zoom out">−</button>
        <button
          type="button"
          className="home-control"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => commitView(DEFAULT_CENTER, DEFAULT_ZOOM)}
          aria-label="Return to Catbalogan"
          title="Return to Catbalogan"
        >
          ◎
        </button>
      </div>

      <div className="native-map-scale" aria-hidden="true">
        <span style={{ width: scaleWidth }} />
        <small>{scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`}</small>
      </div>

      <div className="native-map-attribution">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>OpenStreetMap</a> contributors
      </div>

      {tileWarning && (
        <div className="native-map-network-note" role="status">
          Street tiles need internet. Saved waste-point coordinates remain available.
        </div>
      )}
    </div>
  );
}

export default function WastePointsPage() {
  const [records, setRecords] = useState<Record<string, WastePointRecord>>({});
  const [mapCenter, setMapCenter] = useState<MapCenter>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [selectedId, setSelectedId] = useState("");
  const [draftLatitude, setDraftLatitude] = useState<number | null>(null);
  const [draftLongitude, setDraftLongitude] = useState<number | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState(0);

  useEffect(() => {
    return onValue(
      ref(db, "waste_disposal_points"),
      (snapshot) => {
        setRecords((snapshot.val() as Record<string, WastePointRecord> | null) || {});
        setLastUpdated(Date.now());
      },
      (firebaseError) => setError(firebaseError.message || "Unable to load waste disposal points."),
    );
  }, []);

  const points = useMemo<WastePoint[]>(() => {
    return Object.entries(records)
      .flatMap<WastePoint>(([id, record]) => {
        const latitude = toNumber(record.latitude ?? record.lat);
        const longitude = toNumber(record.longitude ?? record.lng);
        if (latitude === null || longitude === null) return [];
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
        return [{
          id,
          name: String(record.name || "Waste Drop-off Point"),
          barangay: String(record.barangay || ""),
          landmark: String(record.landmark || ""),
          instructions: String(record.instructions || ""),
          latitude,
          longitude,
          active: record.active !== false,
          updatedAt: normalizeTimestamp(record.updatedAt ?? record.createdAt),
        }];
      })
      .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
  }, [records]);

  const filteredPoints = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return points;
    return points.filter((point) => [point.name, point.barangay, point.landmark, point.instructions]
      .join(" ")
      .toLowerCase()
      .includes(keyword));
  }, [points, search]);

  const activeCount = useMemo(() => points.filter((point) => point.active).length, [points]);
  const inactiveCount = points.length - activeCount;
  const selectedPoint = useMemo(() => points.find((point) => point.id === selectedId) || null, [points, selectedId]);

  function beginAdd() {
    setSelectedId("");
    setForm(DEFAULT_FORM);
    setDraftLatitude(null);
    setDraftLongitude(null);
    setPlacementMode(true);
    setMapCenter(DEFAULT_CENTER);
    setMapZoom((current) => Math.max(current, DEFAULT_ZOOM));
    setError("");
    setNotice("Placement mode is ready. Click the exact location on the map where residents should bring their waste.");
  }

  function handleMapLocation(latitude: number, longitude: number) {
    setDraftLatitude(latitude);
    setDraftLongitude(longitude);
    setPlacementMode(false);
    setMapCenter([longitude, latitude]);
    setError("");
    setNotice("Location selected. Complete the details and publish the waste point.");
  }

  function selectPoint(point: WastePoint) {
    setSelectedId(point.id);
    setForm({
      name: point.name,
      barangay: point.barangay,
      landmark: point.landmark,
      instructions: point.instructions,
      active: point.active,
    });
    setDraftLatitude(point.latitude);
    setDraftLongitude(point.longitude);
    setPlacementMode(false);
    setError("");
    setNotice("");
    setMapCenter([point.longitude, point.latitude]);
    setMapZoom((current) => Math.max(current, 15));
  }

  function cancelEditing() {
    setSelectedId("");
    setForm(DEFAULT_FORM);
    setDraftLatitude(null);
    setDraftLongitude(null);
    setPlacementMode(false);
    setError("");
    setNotice("");
  }

  function chooseLocation() {
    setPlacementMode(true);
    setNotice("Click the map to choose the exact waste drop-off location.");
    setError("");
  }

  async function savePoint(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");

    const name = form.name.trim();
    const barangay = form.barangay.trim();
    if (!name) {
      setError("Enter a clear point name, for example “Barangay 13 Waste Drop-off”.");
      return;
    }
    if (!barangay) {
      setError("Enter the barangay so residents can recognize the location.");
      return;
    }
    if (draftLatitude === null || draftLongitude === null) {
      setError("Choose the point location on the map before saving.");
      return;
    }

    setSaving(true);
    try {
      const common = {
        name,
        barangay,
        landmark: form.landmark.trim(),
        instructions: form.instructions.trim(),
        latitude: Number(draftLatitude.toFixed(7)),
        longitude: Number(draftLongitude.toFixed(7)),
        active: form.active,
        category: "official_waste_dropoff",
        updatedAt: serverTimestamp(),
      };

      if (selectedId) {
        await update(ref(db, `waste_disposal_points/${selectedId}`), common);
        setNotice("Waste point updated. Residents will receive the change automatically.");
      } else {
        const nextRef = push(ref(db, "waste_disposal_points"));
        await set(nextRef, {
          ...common,
          createdAt: serverTimestamp(),
        });
        setSelectedId(nextRef.key || "");
        setNotice("Waste point published. Active points now appear on the Resident Home map.");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the waste point.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePoint(point: WastePoint) {
    setError("");
    try {
      await update(ref(db, `waste_disposal_points/${point.id}`), {
        active: !point.active,
        updatedAt: serverTimestamp(),
      });
      setNotice(!point.active
        ? "Point activated. Residents can now see it on their Home map."
        : "Point hidden from residents. You can reactivate it later.");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to change point status.");
    }
  }

  async function deletePoint(point: WastePoint) {
    const confirmed = window.confirm(
      `Delete “${point.name}”?\n\nThis removes it from the Admin map and from Resident Home maps.`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await remove(ref(db, `waste_disposal_points/${point.id}`));
      if (selectedId === point.id) cancelEditing();
      setNotice("Waste point deleted and removed from Resident Home maps.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the waste point.");
    }
  }

  function fitAllPoints() {
    if (points.length === 0) return;
    const fitted = fitWastePoints(points);
    setMapCenter(fitted.center);
    setMapZoom(fitted.zoom);
  }

  return (
    <DashboardShell
      title="Waste Drop-off Points"
      description="Manage the official collection locations shown to residents."
      hidePageHeader
    >
      <main className="waste-points-page">
        <section className="waste-points-hero">
          <div className="hero-icon"><WasteBinIcon /></div>
          <div className="hero-copy">
            <span className="hero-eyebrow">Resident Map Management</span>
            <h1>Official waste drop-off points</h1>
            <p>
              Place approved locations on the map. Active points are synchronized to the Resident Home map automatically.
            </p>
          </div>
          <button className="primary-action" type="button" onClick={beginAdd}>
            <PlusIcon /> Add waste point
          </button>
        </section>

        <section className="summary-grid" aria-label="Waste point summary">
          <article><span>Total points</span><strong>{points.length}</strong><small>Saved locations</small></article>
          <article><span>Visible to residents</span><strong>{activeCount}</strong><small>Active points</small></article>
          <article><span>Hidden</span><strong>{inactiveCount}</strong><small>Inactive points</small></article>
          <article><span>Last refresh</span><strong className="date-value">{lastUpdated ? formatUpdatedAt(lastUpdated) : "Loading…"}</strong><small>Realtime Database</small></article>
        </section>

        {(error || notice) && (
          <div className={`page-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
            <strong>{error ? "Action needed" : "Updated"}</strong>
            <span>{error || notice}</span>
          </div>
        )}

        <section className="workspace-grid">
          <div className={`map-card ${placementMode ? "placing" : ""}`}>
            <div className="map-toolbar">
              <div>
                <strong>Catbalogan waste point map</strong>
                <span>{placementMode ? "Click the exact location to place the marker." : "Select a marker to edit its details."}</span>
              </div>
              <div className="map-toolbar-actions">
                <button type="button" onClick={fitAllPoints} disabled={points.length === 0}>Show all</button>
                <button type="button" className={placementMode ? "active" : ""} onClick={chooseLocation}>
                  <MapPinIcon /> {placementMode ? "Click map now" : "Choose location"}
                </button>
              </div>
            </div>
            <div className="waste-map-shell">
              <InteractiveWasteMap
                center={mapCenter}
                zoom={mapZoom}
                points={points}
                selectedId={selectedId}
                draftLatitude={draftLatitude}
                draftLongitude={draftLongitude}
                placementMode={placementMode}
                onViewChange={(nextCenter, nextZoom) => {
                  setMapCenter(nextCenter);
                  setMapZoom(nextZoom);
                }}
                onChooseLocation={handleMapLocation}
                onSelectPoint={selectPoint}
              />
            </div>
            <div className="map-legend">
              <span><i className="legend-pin active"><WasteBinIcon small /></i> Visible to residents</span>
              <span><i className="legend-pin inactive"><WasteBinIcon small /></i> Hidden</span>
            </div>
          </div>

          <aside className="editor-card">
            <div className="editor-heading">
              <div className="editor-heading-icon"><WasteBinIcon /></div>
              <div>
                <span>{selectedId ? "Edit location" : "New location"}</span>
                <h2>{selectedPoint?.name || "Waste point details"}</h2>
              </div>
            </div>

            <form onSubmit={savePoint}>
              <label>
                Point name <b>Required</b>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Barangay 13 Waste Drop-off"
                  maxLength={80}
                />
              </label>

              <label>
                Barangay <b>Required</b>
                <input
                  value={form.barangay}
                  onChange={(event) => setForm((current) => ({ ...current, barangay: event.target.value }))}
                  placeholder="e.g. Poblacion 13"
                  maxLength={80}
                />
              </label>

              <label>
                Landmark / Purok
                <input
                  value={form.landmark}
                  onChange={(event) => setForm((current) => ({ ...current, landmark: event.target.value }))}
                  placeholder="Near barangay hall, Purok 2…"
                  maxLength={120}
                />
              </label>

              <label>
                Resident instructions
                <textarea
                  value={form.instructions}
                  onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
                  placeholder="What residents should know before leaving waste here"
                  rows={4}
                  maxLength={320}
                />
              </label>

              <div className={`coordinate-box ${draftLatitude !== null && draftLongitude !== null ? "ready" : ""}`}>
                <div className="coordinate-icon"><MapPinIcon /></div>
                <div>
                  <strong>{draftLatitude !== null && draftLongitude !== null ? "Map location selected" : "No map location selected"}</strong>
                  <span>
                    {draftLatitude !== null && draftLongitude !== null
                      ? formatCoordinates(draftLatitude, draftLongitude)
                      : "Click “Choose location”, then click the map."}
                  </span>
                </div>
                <button type="button" onClick={chooseLocation}>{draftLatitude === null ? "Choose" : "Move"}</button>
              </div>

              <label className="status-switch">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                />
                <span className="switch-track"><i /></span>
                <span>
                  <strong>Show to residents</strong>
                  <small>{form.active ? "Residents will see this marker on their Home map." : "Keep it saved but hide it from residents."}</small>
                </span>
              </label>

              <div className="editor-actions">
                <button type="button" className="secondary" onClick={cancelEditing}>Cancel</button>
                <button type="submit" className="save" disabled={saving}>{saving ? "Saving…" : selectedId ? "Save changes" : "Publish point"}</button>
              </div>
            </form>
          </aside>
        </section>

        <section className="points-list-card">
          <div className="list-heading">
            <div>
              <span>Location directory</span>
              <h2>Saved waste points</h2>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, barangay or landmark…"
              aria-label="Search waste disposal points"
            />
          </div>

          {filteredPoints.length === 0 ? (
            <div className="empty-points">
              <div><WasteBinIcon /></div>
              <strong>{points.length === 0 ? "No waste points yet" : "No matching locations"}</strong>
              <span>{points.length === 0 ? "Add the first official drop-off point for residents." : "Try another search term."}</span>
              {points.length === 0 && <button type="button" onClick={beginAdd}><PlusIcon /> Add first point</button>}
            </div>
          ) : (
            <div className="points-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Barangay / Landmark</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th className="actions-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPoints.map((point) => (
                    <tr key={point.id} className={selectedId === point.id ? "selected-row" : ""}>
                      <td>
                        <button type="button" className="location-cell" onClick={() => selectPoint(point)}>
                          <span className={`mini-marker ${point.active ? "active" : "inactive"}`}><WasteBinIcon small /></span>
                          <span><strong>{point.name}</strong><small>{formatCoordinates(point.latitude, point.longitude)}</small></span>
                        </button>
                      </td>
                      <td><strong>{point.barangay || "—"}</strong><small>{point.landmark || "No landmark added"}</small></td>
                      <td><span className={`status-pill ${point.active ? "active" : "inactive"}`}>{point.active ? "Visible" : "Hidden"}</span></td>
                      <td><span className="updated-text">{formatUpdatedAt(point.updatedAt)}</span></td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => selectPoint(point)}>Edit</button>
                          <button type="button" onClick={() => void togglePoint(point)}>{point.active ? "Hide" : "Show"}</button>
                          <button type="button" className="danger" onClick={() => void deletePoint(point)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <style jsx global>{`
        .waste-points-page {
          width: 100%;
          max-width: 1660px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          color: #14251d;
        }

        .waste-points-hero {
          min-height: 158px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 18px;
          padding: 24px 26px;
          border: 1px solid #d9e7df;
          border-radius: 24px;
          background: linear-gradient(120deg, #ffffff 0%, #f5fbf7 58%, #eaf7ee 100%);
          box-shadow: 0 12px 32px rgba(16, 35, 27, .065);
        }

        .hero-icon,
        .editor-heading-icon {
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: linear-gradient(145deg, #19a85c, #087a4f);
          color: white;
          box-shadow: 0 10px 24px rgba(8, 122, 79, .20);
        }
        .hero-icon { width: 70px; height: 70px; }
        .editor-heading-icon { width: 48px; height: 48px; border-radius: 14px; }
        .waste-bin-icon { width: 34px; height: 34px; fill: currentColor; }
        .waste-bin-icon.small { width: 20px; height: 20px; }

        .hero-eyebrow,
        .list-heading > div > span,
        .editor-heading > div:last-child > span {
          display: block;
          color: #16814c;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .035em;
          text-transform: uppercase;
        }
        .hero-copy h1 { margin: 5px 0 0; font-size: clamp(28px, 3vw, 38px); line-height: 1.08; letter-spacing: -.035em; }
        .hero-copy p { max-width: 760px; margin: 9px 0 0; color: #5c6e64; font-size: 16px; line-height: 1.55; }

        .primary-action,
        .map-toolbar-actions button,
        .editor-actions button,
        .coordinate-box button,
        .empty-points button,
        .row-actions button {
          min-height: 44px;
          border: 0;
          border-radius: 12px;
          font: inherit;
          font-weight: 850;
          cursor: pointer;
        }
        .primary-action {
          min-height: 50px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 0 19px;
          background: #087a4f;
          color: #fff;
          box-shadow: 0 10px 20px rgba(8, 122, 79, .18);
          font-size: 15px;
        }
        .primary-action svg,
        .map-toolbar-actions svg,
        .empty-points button svg { width: 20px; height: 20px; fill: currentColor; }

        .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
        .summary-grid article {
          min-height: 108px;
          padding: 17px 18px;
          border: 1px solid #dce8e1;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 7px 20px rgba(16, 35, 27, .045);
        }
        .summary-grid span { display: block; color: #52665b; font-size: 14px; font-weight: 800; }
        .summary-grid strong { display: block; margin-top: 6px; color: #12291e; font-size: 31px; line-height: 1; }
        .summary-grid strong.date-value { margin-top: 10px; font-size: 16px; line-height: 1.3; }
        .summary-grid small { display: block; margin-top: 8px; color: #718078; font-size: 13px; }

        .page-message { display: flex; gap: 12px; align-items: baseline; padding: 13px 16px; border-radius: 14px; border: 1px solid; font-size: 15px; }
        .page-message strong { flex: 0 0 auto; }
        .page-message.success { background: #effaf3; border-color: #b9e4c9; color: #17633d; }
        .page-message.error { background: #fff4f4; border-color: #f2c2c2; color: #a52b2b; }

        .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(380px, .72fr); gap: 16px; align-items: stretch; }
        .map-card,
        .editor-card,
        .points-list-card {
          border: 1px solid #dce7e1;
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 10px 28px rgba(16, 35, 27, .055);
          overflow: hidden;
        }
        .map-card.placing { box-shadow: 0 0 0 3px rgba(22, 163, 74, .13), 0 10px 28px rgba(16, 35, 27, .07); }
        .map-toolbar { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-bottom: 1px solid #e4ece7; }
        .map-toolbar strong { display: block; color: #183326; font-size: 16px; }
        .map-toolbar span { display: block; margin-top: 3px; color: #65766d; font-size: 13px; }
        .map-toolbar-actions { display: flex; gap: 8px; }
        .map-toolbar-actions button { display: inline-flex; align-items: center; gap: 7px; padding: 0 13px; background: #f0f6f2; color: #355348; font-size: 14px; }
        .map-toolbar-actions button.active { background: #087a4f; color: #fff; }
        .map-toolbar-actions button:disabled { cursor: not-allowed; opacity: .45; }
        .waste-map-shell {
          position: relative;
          width: 100%;
          height: 560px;
          min-height: 560px;
          overflow: hidden;
          background: #dbe8e1;
          user-select: none;
        }
        .native-waste-map {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #dce9e3;
          cursor: grab;
          touch-action: none;
          outline: none;
        }
        .native-waste-map:active { cursor: grabbing; }
        .native-waste-map.placing { cursor: crosshair; }
        .native-map-tiles { position: absolute; inset: 0; z-index: 1; overflow: hidden; background: #dce9e3; }
        .native-map-tiles img {
          position: absolute;
          width: 256px;
          height: 256px;
          max-width: none !important;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        .native-map-marker-button,
        .native-map-draft-marker {
          position: absolute;
          z-index: 30;
          width: 54px;
          height: 66px;
          padding: 0;
          border: 0;
          background: transparent;
          transform: translate(-50%, -100%);
        }
        .native-map-marker-button { cursor: pointer; }
        .native-map-marker-button:focus-visible { outline: 3px solid #126fdf; outline-offset: 4px; border-radius: 16px; }
        .native-map-draft-marker { z-index: 31; pointer-events: none; }
        .native-map-provider-badge {
          position: absolute;
          left: 14px;
          top: 14px;
          z-index: 60;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 34px;
          padding: 0 11px;
          border: 1px solid rgba(255,255,255,.92);
          border-radius: 999px;
          background: rgba(255,255,255,.95);
          color: #183326;
          box-shadow: 0 6px 18px rgba(16,35,27,.14);
          backdrop-filter: blur(8px);
          font-size: 12px;
          font-weight: 900;
          pointer-events: none;
        }
        .native-map-provider-badge span { width: 9px; height: 9px; border-radius: 50%; background: #12a05d; box-shadow: 0 0 0 4px rgba(18,160,93,.13); }
        .native-map-controls {
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 70;
          display: grid;
          gap: 6px;
        }
        .native-map-controls button {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border: 1px solid #d7e3dc;
          border-radius: 12px;
          background: rgba(255,255,255,.97);
          color: #17372a;
          box-shadow: 0 6px 18px rgba(16,35,27,.13);
          font: inherit;
          font-size: 24px;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
        }
        .native-map-controls button:hover { background: #f1faf4; color: #087a4f; }
        .native-map-controls button:focus-visible { outline: 3px solid rgba(18,111,223,.35); outline-offset: 2px; }
        .native-map-controls .home-control { font-size: 22px; }
        .native-map-placement-hint {
          position: absolute;
          left: 50%;
          top: 14px;
          z-index: 65;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 44px;
          max-width: calc(100% - 180px);
          padding: 0 14px;
          border: 1px solid #89cfaa;
          border-radius: 13px;
          background: rgba(238,252,244,.97);
          color: #17613d;
          box-shadow: 0 8px 22px rgba(16,35,27,.14);
          pointer-events: none;
        }
        .native-map-placement-hint svg { width: 20px; height: 20px; fill: #0c8a55; flex: 0 0 auto; }
        .native-map-placement-hint span { font-size: 13px; line-height: 1.25; }
        .native-map-placement-hint strong { margin-right: 4px; }
        .native-map-scale {
          position: absolute;
          left: 14px;
          bottom: 14px;
          z-index: 60;
          display: flex;
          flex-direction: column;
          gap: 2px;
          color: #17372a;
          pointer-events: none;
          text-shadow: 0 1px 2px rgba(255,255,255,.8);
        }
        .native-map-scale > span { display: block; height: 7px; border-left: 2px solid #17372a; border-right: 2px solid #17372a; border-bottom: 2px solid #17372a; }
        .native-map-scale small { font-size: 11px; font-weight: 850; }
        .native-map-attribution {
          position: absolute;
          right: 8px;
          bottom: 7px;
          z-index: 60;
          padding: 3px 6px;
          border-radius: 5px;
          background: rgba(255,255,255,.88);
          color: #475a50;
          font-size: 10px;
          line-height: 1.2;
        }
        .native-map-attribution a { color: #176f4a; font-weight: 700; }
        .native-map-network-note {
          position: absolute;
          left: 50%;
          bottom: 44px;
          z-index: 75;
          transform: translateX(-50%);
          max-width: min(560px, calc(100% - 30px));
          padding: 9px 12px;
          border: 1px solid #efd38c;
          border-radius: 11px;
          background: rgba(255,249,231,.97);
          color: #6d5419;
          box-shadow: 0 7px 18px rgba(16,35,27,.12);
          font-size: 12px;
          font-weight: 750;
          text-align: center;
          pointer-events: none;
        }
        .map-legend { display: flex; gap: 18px; align-items: center; min-height: 50px; padding: 9px 16px; border-top: 1px solid #e4ece7; color: #53665b; font-size: 13px; font-weight: 750; }
        .map-legend > span { display: inline-flex; align-items: center; gap: 8px; }
        .legend-pin, .mini-marker { display: grid; place-items: center; border-radius: 10px; color: white; }
        .legend-pin { width: 28px; height: 28px; }
        .mini-marker { width: 42px; height: 42px; flex: 0 0 42px; }
        .legend-pin.active, .mini-marker.active { background: #0c8a55; }
        .legend-pin.inactive, .mini-marker.inactive { background: #78857e; }

        .waste-map-marker {
          width: 54px;
          height: 66px;
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          transform-origin: 50% 100%;
          transition: transform .15s ease;
        }
        .waste-map-marker:hover,
        .waste-map-marker.selected { transform: scale(1.10) translateY(-2px); }
        .waste-marker-pin {
          width: 50px;
          height: 50px;
          display: grid;
          place-items: center;
          border: 4px solid #fff;
          border-radius: 50% 50% 50% 8px;
          color: #fff;
          background: linear-gradient(145deg, #19ad61, #067248);
          box-shadow: 0 9px 20px rgba(8, 79, 52, .30);
          transform: rotate(-45deg);
        }
        .waste-map-marker.inactive .waste-marker-pin { background: linear-gradient(145deg, #87938d, #5a6861); }
        .waste-map-marker.draft .waste-marker-pin { background: linear-gradient(145deg, #2c8cf0, #1762b2); animation: wasteMarkerPulse 1.2s ease-in-out infinite; }
        .waste-marker-pin .waste-bin-icon { width: 25px; height: 25px; fill: currentColor; transform: rotate(45deg); }
        .waste-marker-shadow { position: absolute; bottom: 4px; width: 24px; height: 7px; border-radius: 50%; background: rgba(13, 43, 29, .22); filter: blur(2px); }
        @keyframes wasteMarkerPulse { 0%,100% { box-shadow: 0 9px 20px rgba(23,98,178,.3), 0 0 0 0 rgba(44,140,240,.25); } 50% { box-shadow: 0 9px 20px rgba(23,98,178,.3), 0 0 0 9px rgba(44,140,240,0); } }

        .editor-card { padding: 18px; }
        .editor-heading { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #e6eee9; }
        .editor-heading h2 { margin: 3px 0 0; color: #173126; font-size: 21px; line-height: 1.2; }
        .editor-card form { display: flex; flex-direction: column; gap: 14px; padding-top: 16px; }
        .editor-card label:not(.status-switch) { color: #334d41; font-size: 14px; font-weight: 850; }
        .editor-card label b { margin-left: 5px; color: #11804c; font-size: 11px; text-transform: uppercase; }
        .editor-card input:not([type="checkbox"]),
        .editor-card textarea,
        .list-heading input {
          width: 100%;
          border: 1px solid #ccdcd3;
          border-radius: 12px;
          background: #fbfdfc;
          color: #172820;
          outline: none;
          font: inherit;
          font-size: 15px;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .editor-card input:not([type="checkbox"]) { height: 49px; margin-top: 7px; padding: 0 13px; }
        .editor-card textarea { margin-top: 7px; padding: 12px 13px; resize: vertical; line-height: 1.5; }
        .editor-card input:focus,
        .editor-card textarea:focus,
        .list-heading input:focus { border-color: #2a9b66; box-shadow: 0 0 0 3px rgba(42,155,102,.12); }

        .coordinate-box { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 12px; border: 1px dashed #c9d9d0; border-radius: 14px; background: #f7faf8; }
        .coordinate-box.ready { border-style: solid; border-color: #a8d9bd; background: #f2fbf5; }
        .coordinate-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; background: #e2f4e9; color: #087a4f; }
        .coordinate-icon svg { width: 23px; height: 23px; fill: currentColor; }
        .coordinate-box strong, .coordinate-box span { display: block; }
        .coordinate-box strong { color: #213b2f; font-size: 14px; }
        .coordinate-box span { margin-top: 3px; color: #687970; font-size: 12px; }
        .coordinate-box button { min-height: 38px; padding: 0 11px; background: #e4f2e9; color: #087a4f; font-size: 13px; }

        .status-switch { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 12px; align-items: center; cursor: pointer; padding: 13px; border-radius: 14px; background: #f5f9f6; }
        .status-switch input { position: absolute; opacity: 0; pointer-events: none; }
        .switch-track { grid-row: 1 / span 2; width: 48px; height: 27px; display: block; padding: 3px; border-radius: 999px; background: #9ca9a2; transition: background .15s; }
        .switch-track i { display: block; width: 21px; height: 21px; border-radius: 50%; background: #fff; box-shadow: 0 2px 7px rgba(0,0,0,.18); transition: transform .15s; }
        .status-switch input:checked + .switch-track { background: #159156; }
        .status-switch input:checked + .switch-track i { transform: translateX(21px); }
        .status-switch > span:last-child strong,
        .status-switch > span:last-child small { display: block; }
        .status-switch > span:last-child strong { color: #263f33; font-size: 14px; }
        .status-switch > span:last-child small { margin-top: 3px; color: #687970; font-size: 12px; line-height: 1.4; }

        .editor-actions { display: grid; grid-template-columns: .8fr 1.2fr; gap: 9px; padding-top: 3px; }
        .editor-actions button { min-height: 49px; font-size: 15px; }
        .editor-actions .secondary { background: #edf3ef; color: #3d5449; }
        .editor-actions .save { background: #087a4f; color: #fff; }
        .editor-actions .save:disabled { opacity: .6; cursor: wait; }

        .points-list-card { padding: 18px; }
        .list-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
        .list-heading h2 { margin: 4px 0 0; color: #173126; font-size: 22px; }
        .list-heading input { max-width: 390px; height: 47px; padding: 0 14px; }
        .points-table-wrap { overflow-x: auto; border: 1px solid #e0e9e4; border-radius: 14px; }
        .points-list-card table { width: 100%; min-width: 930px; border-collapse: collapse; }
        .points-list-card th { padding: 12px 14px; background: #f3f7f5; color: #52655a; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: .025em; }
        .points-list-card td { padding: 13px 14px; border-top: 1px solid #e7eee9; color: #344b40; vertical-align: middle; font-size: 14px; }
        .points-list-card tr.selected-row td { background: #f2fbf5; }
        .location-cell { width: 100%; display: flex; align-items: center; gap: 11px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
        .location-cell strong, .location-cell small, .points-list-card td > strong, .points-list-card td > small { display: block; }
        .location-cell strong, .points-list-card td > strong { color: #20382d; font-size: 15px; }
        .location-cell small, .points-list-card td > small { margin-top: 3px; color: #718078; font-size: 12px; }
        .status-pill { display: inline-flex; align-items: center; min-height: 30px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 900; }
        .status-pill.active { background: #e4f6eb; color: #137544; }
        .status-pill.inactive { background: #edf0ee; color: #5f6c65; }
        .updated-text { color: #63746a; font-size: 13px; }
        .row-actions { display: flex; justify-content: flex-end; gap: 6px; }
        .row-actions button { min-height: 36px; padding: 0 10px; background: #edf4f0; color: #305347; font-size: 12px; }
        .row-actions button.danger { background: #fff0f0; color: #b33a3a; }
        .actions-column { text-align: right !important; }

        .empty-points { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 28px; }
        .empty-points > div { width: 60px; height: 60px; display: grid; place-items: center; border-radius: 18px; background: #e9f6ed; color: #0b8150; }
        .empty-points strong { margin-top: 12px; color: #243c31; font-size: 18px; }
        .empty-points span { margin-top: 5px; color: #6a7b72; font-size: 14px; }
        .empty-points button { margin-top: 15px; display: inline-flex; align-items: center; gap: 7px; padding: 0 14px; background: #087a4f; color: #fff; }

        @media (max-width: 1180px) {
          .workspace-grid { grid-template-columns: 1fr; }
          .waste-map-shell { height: 500px; min-height: 500px; }
          .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 760px) {
          .waste-points-hero { grid-template-columns: auto 1fr; padding: 19px; }
          .waste-points-hero .primary-action { grid-column: 1 / -1; width: 100%; }
          .hero-icon { width: 58px; height: 58px; }
          .hero-copy h1 { font-size: 27px; }
          .hero-copy p { font-size: 14px; }
          .summary-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
          .summary-grid article { min-height: 98px; padding: 14px; }
          .map-toolbar { align-items: flex-start; flex-direction: column; }
          .map-toolbar-actions { width: 100%; }
          .map-toolbar-actions button { flex: 1; justify-content: center; }
          .waste-map-shell { height: 430px; min-height: 430px; }
          .map-legend { flex-wrap: wrap; }
          .editor-card, .points-list-card { padding: 14px; }
          .list-heading { align-items: stretch; flex-direction: column; }
          .list-heading input { max-width: none; }
        }
        @media (max-width: 480px) {
          .summary-grid { grid-template-columns: 1fr; }
          .coordinate-box { grid-template-columns: auto 1fr; }
          .coordinate-box button { grid-column: 1 / -1; width: 100%; }
        }
      `}</style>
    </DashboardShell>
  );
}
