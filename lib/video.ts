export type ParsedVideo =
  | { kind: "mp4"; mediaUrl: string; embedUrl: string }
  | { kind: "youtube" | "vimeo"; mediaUrl: string; embedUrl: string };

export function parseVideoUrl(value: string): ParsedVideo {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Video URLs must use HTTPS.");

  const path = url.pathname.toLowerCase();
  if (/\.(mp4|m3u8|3gp)$/.test(path)) {
    return { kind: "mp4", mediaUrl: url.toString(), embedUrl: url.toString() };
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!id) throw new Error("The YouTube URL is missing a video ID.");
    return { kind: "youtube", mediaUrl: url.toString(), embedUrl: `https://www.youtube.com/embed/${id}` };
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    if (!id) throw new Error("The YouTube URL is missing a video ID.");
    return { kind: "youtube", mediaUrl: url.toString(), embedUrl: `https://www.youtube.com/embed/${id}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).reverse().find((segment) => /^\d+$/.test(segment));
    if (!id) throw new Error("The Vimeo URL is missing a numeric video ID.");
    return { kind: "vimeo", mediaUrl: url.toString(), embedUrl: `https://player.vimeo.com/video/${id}` };
  }

  throw new Error("Use a direct HTTPS MP4/HLS/3GP, YouTube, or Vimeo URL.");
}
