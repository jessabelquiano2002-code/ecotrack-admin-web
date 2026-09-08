# WasteTrack Static Reference Dashboard Patch

This patch removes the Three.js / animated hero and uses the same static image workflow already present in your original dashboard.

## Replace these files

Put these two files in the same dashboard folder as your current files:

- `page.tsx`
- `dashboard-reference.css`

Keep your existing image file in that folder:

- `metrowaste-3d-hero.png`

The page already imports it with:

```tsx
import hero3d from "./metrowaste-3d-hero.png";
```

## Important

- Remove the old `<MetroWasteReal3DScene />` from this dashboard page if you previously added it.
- You do **not** need `@react-three/fiber`, `@react-three/drei`, or the GLB truck for this version.
- Firebase data logic is kept for trucks, residents, issues, schedules, routes, collection reports, notifications, and recent activity.
- The live card and completion ring are dynamic, but the visual scene itself is static.
- There are no CSS keyframe animations in this patch.

## If your routes differ

The metric cards currently link to:

- Active Trucks → `/live-map`
- Residents → `/residents`
- Open Issues → `/issues`
- Completion → `/reports`

Change only those href values if your project uses different paths.
