export type OfficialBarangay = {
  name: string;
  barangayKey: string;
  psgcCode: string;
  correspondenceCode: string;
  centerLatitude: number;
  centerLongitude: number;
  coordinateType: "openstreetmap-locality" | "barangay-boundary-interior-reference";
  coordinateSource: string;
};

export const CATBALOGAN_PSGC_SOURCE =
  "https://psa.gov.ph/classification/psgc/barangays/0806005000";

export const CATBALOGAN_BOUNDARY_SOURCE =
  "https://github.com/faeldon/philippines-json-maps/blob/master/2023/geojson/municities/hires/bgysubmuns-municity-806005000.0.1.json";

type BarangayReferencePoint = {
  latitude: number;
  longitude: number;
  coordinateType?: "openstreetmap-locality" | "barangay-boundary-interior-reference";
  coordinateSource?: string;
};

// One deterministic point inside each Catbalogan Barangay boundary. These are
// Barangay reference pins only; they are not Purok pins, service stops, road
// points, or turn-by-turn destinations. Each point was derived from the
// high-resolution 2023 PSGC-matched boundary polygon and verified to be inside
// its matching adm4_psgc polygon before inclusion here.
const BOUNDARY_REFERENCE_POINTS_BY_PSGC: Record<string, BarangayReferencePoint> = {
  "0806005001": { latitude: 11.8639601, longitude: 124.9006970 },
  "0806005002": { latitude: 11.8024331, longitude: 124.7030569 },
  "0806005003": { latitude: 11.8819921, longitude: 124.8755358 },
  "0806005004": { latitude: 11.7065407, longitude: 124.8775729 },
  "0806005005": { latitude: 11.8140154, longitude: 124.7399274 },
  "0806005006": { latitude: 11.7563303, longitude: 124.8925221 },
  "0806005007": { latitude: 11.8100766, longitude: 124.8272743 },
  "0806005008": { latitude: 11.8611849, longitude: 124.8786882 },
  "0806005009": { latitude: 11.8973785, longitude: 124.9427061 },
  "0806005011": { latitude: 11.8894925, longitude: 124.9045018 },
  "0806005012": { latitude: 11.8228386, longitude: 124.6819150 },
  "0806005013": { latitude: 11.8246805, longitude: 124.7274317 },
  "0806005014": { latitude: 11.7832165, longitude: 124.8880127 },
  "0806005015": { latitude: 11.7905319, longitude: 124.9182247 },
  "0806005016": { latitude: 11.8316604, longitude: 124.7042981 },
  "0806005017": { latitude: 11.7416971, longitude: 124.8757195 },
  "0806005018": { latitude: 11.7489970, longitude: 124.8710768 },
  "0806005019": { latitude: 11.7992244, longitude: 124.8338932 },
  "0806005020": { latitude: 11.7621647, longitude: 124.8902499 },
  "0806005021": { latitude: 11.8354795, longitude: 124.8542631 },
  "0806005022": { latitude: 11.7653899, longitude: 124.9072027 },
  "0806005023": { latitude: 11.8397233, longitude: 124.8934161 },
  "0806005024": { latitude: 11.8409853, longitude: 124.9262938 },
  "0806005025": { latitude: 11.8168376, longitude: 124.9115537 },
  "0806005026": { latitude: 11.7962994, longitude: 124.8784602 },
  "0806005027": { latitude: 11.7868941, longitude: 124.8800604 },
  "0806005028": { latitude: 11.8055595, longitude: 124.6901131 },
  "0806005029": { latitude: 11.8500648, longitude: 124.8419751 },
  "0806005030": { latitude: 11.8483363, longitude: 124.8208058 },
  "0806005031": { latitude: 11.8640578, longitude: 124.8622730 },
  "0806005032": { latitude: 11.7510276, longitude: 124.9139758 },
  "0806005033": { latitude: 11.8064245, longitude: 124.8767229 },
  "0806005034": { latitude: 11.7786440, longitude: 124.8807803 },
  "0806005035": { latitude: 11.7782758, longitude: 124.8820532 },
  "0806005036": { latitude: 11.7764692, longitude: 124.8808628 },
  "0806005037": { latitude: 11.7753639, longitude: 124.8812390 },
  "0806005038": { latitude: 11.7746092, longitude: 124.8819581 },
  "0806005039": { latitude: 11.7730541, longitude: 124.8822000 },
  "0806005040": { latitude: 11.7740520, longitude: 124.8850338 },
  "0806005041": { latitude: 11.7707625, longitude: 124.8831281 },
  "0806005042": { latitude: 11.7671612, longitude: 124.8857940 },
  "0806005043": { latitude: 11.7784973, longitude: 124.8842658 },
  "0806005044": { latitude: 11.7773692, longitude: 124.8845968 },
  "0806005045": { latitude: 11.7763282, longitude: 124.8849433 },
  "0806005046": { latitude: 11.7767849, longitude: 124.8893924 },
  "0806005047": { latitude: 11.7826483, longitude: 124.8833132 },
  "0806005048": { latitude: 11.8198511, longitude: 124.8727883 },
  "0806005049": { latitude: 11.7723611, longitude: 124.8998490 },
  "0806005050": { latitude: 11.8294967, longitude: 124.6937702 },
  "0806005051": { latitude: 11.7860823, longitude: 124.9012435 },
  "0806005052": { latitude: 11.7802846, longitude: 124.8825445 },
  "0806005053": { latitude: 11.8064173, longitude: 124.8339106 },
  "0806005054": { latitude: 11.8664452, longitude: 124.8396718 },
  "0806005055": { latitude: 11.8203971, longitude: 124.8453413 },
  "0806005056": { latitude: 11.8654084, longitude: 124.9314780 },
  "0806005057": { latitude: 11.7561904, longitude: 124.9018349 },
  "0806005059": { latitude: 11.7669989, longitude: 124.8934461 },
};


// Public-map locality points verified against OpenStreetMap for the Barangays
// most commonly used by the MetroWaste route workflow. These are named
// Barangay/locality points, not arbitrary demo points inside a polygon.
// They intentionally override the older boundary-interior reference points.
const VERIFIED_LOCALITY_POINTS_BY_PSGC: Record<string, BarangayReferencePoint> = {
  // Canlapwas — OSM node 3327993248
  "0806005014": {
    latitude: 11.78221,
    longitude: 124.88946,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3327993248",
  },
  // Lagundi — OSM node 3327993249
  "0806005022": {
    latitude: 11.75976,
    longitude: 124.9053,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3327993249",
  },
  // Maulong — OSM node 3327993247
  "0806005026": {
    latitude: 11.79269,
    longitude: 124.86605,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3327993247",
  },
  // Mercedes / Catbalogan locality — OSM node 3327993246
  "0806005027": {
    latitude: 11.78392,
    longitude: 124.87599,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3327993246",
  },
  // Poblacion 13 / Barangay 13 — OSM node 3400276276
  "0806005046": {
    latitude: 11.7783,
    longitude: 124.88684,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3400276276",
  },
  // Guindaponan (mapped in OSM as Guindapunan) — OSM node 2603423585
  "0806005049": {
    latitude: 11.77131,
    longitude: 124.88415,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/2603423585",
  },
  // San Andres — OSM node 2531567002
  "0806005051": {
    latitude: 11.7873,
    longitude: 124.89722,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/2531567002",
  },
  // Socorro — OSM node 3327993245
  "0806005059": {
    latitude: 11.76611,
    longitude: 124.89214,
    coordinateType: "openstreetmap-locality",
    coordinateSource: "https://www.openstreetmap.org/node/3327993245",
  },
};

// Philippine Statistics Authority, City of Catbalogan PSGC registry.
// The names and codes below are the official city list shown by PSA as of
// 31 July 2025 and rechecked on 28 August 2026. Puroks are intentionally not
// pre-generated: an administrator selects the locally recognized Purok number.
const BARANGAY_ROWS: Array<[string, string, string]> = [
  ["Albalate", "0806005001", "086005001"],
  ["Bagongon", "0806005002", "086005002"],
  ["Bangon", "0806005003", "086005003"],
  ["Basiao", "0806005004", "086005004"],
  ["Buluan", "0806005005", "086005005"],
  ["Bunuanan", "0806005006", "086005006"],
  ["Cabugawan", "0806005007", "086005007"],
  ["Cagudalo", "0806005008", "086005008"],
  ["Cagusipan", "0806005009", "086005009"],
  ["Cagutian", "0806005011", "086005011"],
  ["Cagutsan", "0806005012", "086005012"],
  ["Canhawan Gote", "0806005013", "086005013"],
  ["Canlapwas", "0806005014", "086005014"],
  ["Cawayan", "0806005015", "086005015"],
  ["Cinco", "0806005016", "086005016"],
  ["Darahuway Daco", "0806005017", "086005017"],
  ["Darahuway Gote", "0806005018", "086005018"],
  ["Estaka", "0806005019", "086005019"],
  ["Guinsorongan", "0806005020", "086005020"],
  ["Iguid", "0806005021", "086005021"],
  ["Lagundi", "0806005022", "086005022"],
  ["Libas", "0806005023", "086005023"],
  ["Lobo", "0806005024", "086005024"],
  ["Manguehay", "0806005025", "086005025"],
  ["Maulong", "0806005026", "086005026"],
  ["Mercedes", "0806005027", "086005027"],
  ["Mombon", "0806005028", "086005028"],
  ["New Mahayag", "0806005029", "086005029"],
  ["Old Mahayag", "0806005030", "086005030"],
  ["Palanyogon", "0806005031", "086005031"],
  ["Pangdan", "0806005032", "086005032"],
  ["Payao", "0806005033", "086005033"],
  ["Poblacion 1", "0806005034", "086005034"],
  ["Poblacion 2", "0806005035", "086005035"],
  ["Poblacion 3", "0806005036", "086005036"],
  ["Poblacion 4", "0806005037", "086005037"],
  ["Poblacion 5", "0806005038", "086005038"],
  ["Poblacion 6", "0806005039", "086005039"],
  ["Poblacion 7", "0806005040", "086005040"],
  ["Poblacion 8", "0806005041", "086005041"],
  ["Poblacion 9", "0806005042", "086005042"],
  ["Poblacion 10", "0806005043", "086005043"],
  ["Poblacion 11", "0806005044", "086005044"],
  ["Poblacion 12", "0806005045", "086005045"],
  ["Poblacion 13", "0806005046", "086005046"],
  ["Muñoz", "0806005047", "086005047"],
  ["Pupua", "0806005048", "086005048"],
  ["Guindaponan", "0806005049", "086005049"],
  ["Rama", "0806005050", "086005050"],
  ["San Andres", "0806005051", "086005051"],
  ["San Pablo", "0806005052", "086005052"],
  ["San Roque", "0806005053", "086005053"],
  ["San Vicente", "0806005054", "086005054"],
  ["Silanga", "0806005055", "086005055"],
  ["Totoringon", "0806005056", "086005056"],
  ["Ibol", "0806005057", "086005057"],
  ["Socorro", "0806005059", "086005059"],
];

export function makeBarangayKey(value: string): string {
  const key = String(value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/barangay|brgy/g, "")
    .replace(/[^a-z0-9ñ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  if (["13", "poblacion13"].includes(key)) return "poblacion_13";
  if (["guindapunan", "gundaponan"].includes(key)) return "guindaponan";
  return key;
}

export function normalizePurokLabel(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const number = raw.match(/\d+/)?.[0];
  if (!number || Number(number) < 1 || Number(number) > 99) return "";
  return `Purok ${Number(number)}`;
}

export function makePurokKey(value: string): string {
  const label = normalizePurokLabel(value);
  const number = label.match(/\d+/)?.[0];
  return number ? `purok_${Number(number)}` : "";
}

export const OFFICIAL_CATBALOGAN_BARANGAYS: readonly OfficialBarangay[] =
  BARANGAY_ROWS.map(([name, psgcCode, correspondenceCode]) => {
    const referencePoint =
      VERIFIED_LOCALITY_POINTS_BY_PSGC[psgcCode] ||
      BOUNDARY_REFERENCE_POINTS_BY_PSGC[psgcCode];
    if (!referencePoint) {
      throw new Error(`Missing Barangay reference point for PSGC ${psgcCode}`);
    }
    return {
      name,
      barangayKey: makeBarangayKey(name),
      psgcCode,
      correspondenceCode,
      centerLatitude: referencePoint.latitude,
      centerLongitude: referencePoint.longitude,
      coordinateType:
        referencePoint.coordinateType || "barangay-boundary-interior-reference",
      coordinateSource:
        referencePoint.coordinateSource || CATBALOGAN_BOUNDARY_SOURCE,
    };
  });

export function findOfficialBarangay(value: string): OfficialBarangay | undefined {
  const key = makeBarangayKey(value);
  return OFFICIAL_CATBALOGAN_BARANGAYS.find((item) => item.barangayKey === key);
}
