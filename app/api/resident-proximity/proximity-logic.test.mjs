// Run:  node proximity-logic.test.mjs
import assert from "node:assert/strict";
import {
  effectiveScheduleDriverId, extractCoverageAreas, matchesCoverage, proximityStage,
} from "./proximity-logic.mjs";

const D = "2026-10-01";

// --- substitute driver resolution (must match /api/gps) ---
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg" }, D), "reg");
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { [D]: { substituteDriverId: "sub", status: "active" } } }, D), "sub");
// range override NOT keyed by today's date (the bug case)
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { x1: { substituteDriverId: "sub", rangeStartDate: "2026-09-30", rangeEndDate: "2026-10-03" } } }, D), "sub");
// explicit `date` field under an arbitrary key
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { k: { substituteDriverId: "sub", date: D, status: "scheduled" } } }, D), "sub");
// non-"active" but not cancelled statuses still count (gps treats them as active)
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { [D]: { substituteDriverId: "sub", status: "approved" } } }, D), "sub");
// cancelled / out of range -> regular driver
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { [D]: { substituteDriverId: "sub", status: "cancelled" } } }, D), "reg");
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg",
  driverOverrides: { a: { substituteDriverId: "sub", rangeStartDate: "2026-09-01", rangeEndDate: "2026-09-02" } } }, D), "reg");
// newest overlapping override wins
assert.equal(effectiveScheduleDriverId({ assignedDriverId: "reg", driverOverrides: {
  a: { substituteDriverId: "old", rangeStartDate: "2026-09-30", rangeEndDate: "2026-10-05", createdAt: 1 },
  b: { substituteDriverId: "new", rangeStartDate: "2026-09-30", rangeEndDate: "2026-10-05", createdAt: 2 } } }, D), "new");

// --- coverage: schedule fields, then route fallback ---
let areas = extractCoverageAreas({ barangay: "Guindaponan", puroks: ["Purok 1"] }, {});
assert.equal(areas.length, 1);
areas = extractCoverageAreas({}, { barangays: ["Guindaponan"], puroks: ["Purok 2"] });
assert.equal(areas.length, 1, "route-level coverage must be used");
areas = extractCoverageAreas({}, { areas: [{ barangay: "Mercedes", purok: "Purok 4" }] });
assert.equal(areas[0].barangayKey, "mercedes");
areas = extractCoverageAreas({ areas: [{ barangay: "A", purok: "Purok 1" }] }, { barangays: ["B"] });
assert.equal(areas[0].barangayKey, "a", "schedule.areas wins over route");
assert.equal(extractCoverageAreas({}, {}).length, 0);

// --- resident token matching ---
const cov = extractCoverageAreas({ barangay: "Guindaponan", puroks: ["Purok 1"] }, {});
assert.ok(matchesCoverage({ barangay: "Guindaponan", purok: "Purok 1" }, cov));
assert.ok(!matchesCoverage({ barangay: "Guindaponan", purok: "Purok 2" }, cov));

// --- stages ---
assert.equal(proximityStage(50, 500), "arrived");
assert.equal(proximityStage(300, 500), "approaching");
assert.equal(proximityStage(900, 500), null);
console.log("all tests passed");
