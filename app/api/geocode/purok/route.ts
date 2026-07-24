import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const APP_USER_AGENT =
  "WasteTrack-Catbalogan/2.0 (https://github.com/jessabelquiano2002-code/ecotrack-admin-web)";

// Geographic bias around Catbalogan City. Nominatim expects:
// left longitude, top latitude, right longitude, bottom latitude.
const CATBALOGAN_VIEWBOX = "124.80,11.86,124.97,11.68";

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  category?: string;
  type?: string;
  importance?: number;
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  address?: Record<string, string>;
  namedetails?: Record<string, string>;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/barangay/g, "")
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesNormalized(haystack: unknown, needle: unknown): boolean {
  const normalizedNeedle = normalize(needle);
  return normalizedNeedle.length > 0 && normalize(haystack).includes(normalizedNeedle);
}

function searchableText(result: NominatimResult): string {
  return [
    result.display_name,
    ...Object.values(result.address ?? {}),
    ...Object.values(result.namedetails ?? {}),
  ]
    .filter(Boolean)
    .join(" ");
}

function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function openStreetMapUrl(result: NominatimResult): string | undefined {
  if (!result.osm_type || !result.osm_id) return undefined;
  return `https://www.openstreetmap.org/${result.osm_type}/${result.osm_id}`;
}

function parseCoordinate(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "10",
    countrycodes: "ph",
    addressdetails: "1",
    namedetails: "1",
    viewbox: CATBALOGAN_VIEWBOX,
    bounded: "1",
    "accept-language": "en",
  });

  const response = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: {
      "User-Agent": APP_USER_AGENT,
      Referer: "https://github.com/jessabelquiano2002-code/ecotrack-admin-web",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap geocoding returned HTTP ${response.status}.`);
  }

  return (await response.json()) as NominatimResult[];
}

function scoreResult(
  result: NominatimResult,
  mode: "barangay" | "purok",
  barangay: string,
  purok: string,
): number {
  const text = searchableText(result);
  let score = 0;

  if (includesNormalized(text, barangay)) score += 25;
  if (includesNormalized(text, "Catbalogan")) score += 20;
  if (includesNormalized(text, "Samar")) score += 8;

  if (mode === "purok" && includesNormalized(text, purok)) score += 35;

  if (
    ["neighbourhood", "quarter", "suburb", "village", "administrative"].includes(
      String(result.type),
    )
  ) {
    score += 5;
  }

  score += Math.max(0, Math.min(4, Number(result.importance || 0) * 4));
  return score;
}

export async function GET(request: NextRequest) {
  try {
    const mode =
      request.nextUrl.searchParams.get("mode") === "barangay" ? "barangay" : "purok";
    const barangay = request.nextUrl.searchParams.get("barangay")?.trim() ?? "";
    const purok = request.nextUrl.searchParams.get("purok")?.trim() ?? "";

    if (!barangay) {
      return NextResponse.json({ error: "barangay is required." }, { status: 400 });
    }

    if (mode === "purok" && !purok) {
      return NextResponse.json(
        { error: "purok is required for purok lookup." },
        { status: 400 },
      );
    }

    const query =
      mode === "barangay"
        ? `Barangay ${barangay}, Catbalogan City, Samar, Philippines`
        : `${purok}, Barangay ${barangay}, Catbalogan City, Samar, Philippines`;

    const results = await searchNominatim(query);
    const ranked = results
      .map((result) => ({
        result,
        score: scoreResult(result, mode, barangay, purok),
      }))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    const mapsUrl = googleMapsUrl(query);

    if (!best) {
      return NextResponse.json({
        found: false,
        mode,
        query,
        googleMapsUrl: mapsUrl,
        message:
          "No public-map result was found. Open Google Maps for visual review, then place the pin manually.",
      });
    }

    const text = searchableText(best.result);
    const exactBarangayMatch = includesNormalized(text, barangay);
    const exactPurokMatch = mode === "barangay" || includesNormalized(text, purok);
    const catbaloganMatch = includesNormalized(text, "Catbalogan");

    // Never return a broad result as a real Purok point.
    if (!exactBarangayMatch || !catbaloganMatch || !exactPurokMatch) {
      return NextResponse.json({
        found: false,
        mode,
        query,
        googleMapsUrl: mapsUrl,
        message:
          mode === "purok"
            ? "No exact Purok + Barangay + Catbalogan match exists in the public map data."
            : "No exact Barangay + Catbalogan match exists in the public map data.",
      });
    }

    const lat = parseCoordinate(best.result.lat);
    const lng = parseCoordinate(best.result.lon);

    if (lat === null || lng === null) {
      return NextResponse.json({
        found: false,
        mode,
        query,
        googleMapsUrl: mapsUrl,
        message: "The map result did not include valid coordinates.",
      });
    }

    return NextResponse.json({
      found: true,
      mode,
      query,
      location: {
        lat,
        lng,
        displayName: best.result.display_name || query,
        source: "openstreetmap",
        sourceLabel: "OpenStreetMap exact text match — administrator review required",
        sourceUrl: openStreetMapUrl(best.result),
        googleMapsUrl: mapsUrl,
        exactPurokMatch,
        exactBarangayMatch,
        confidence: Math.min(100, Math.round(best.score)),
      },
    });
  } catch (error: unknown) {
    console.error("Purok geocoding failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to search the map provider.",
      },
      { status: 502 },
    );
  }
}