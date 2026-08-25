export const ONLINE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const OFFLINE_MAP_STYLE = {
  version: 8,
  name: "WasteTrack Offline",
  sources: {},
  layers: [
    {
      id: "offline-background",
      type: "background",
      paint: {
        "background-color": "#edf4f1",
      },
    },
  ],
} as const;

export function getWasteTrackMapStyle(onlineStyle = ONLINE_MAP_STYLE) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return OFFLINE_MAP_STYLE as any;
  }
  return onlineStyle;
}
