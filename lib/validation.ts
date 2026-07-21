import type { CollectionId, ContentDraft } from "./types";

export type ValidationErrors = Partial<Record<keyof ContentDraft, string>>;

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const dataUrlBytes = (value: string) => {
  const comma = value.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const payload = value.slice(comma + 1).replace(/\s/g, "");
  return Math.ceil((payload.length * 3) / 4);
};

export function validateContentDraft(
  collection: CollectionId,
  draft: ContentDraft,
): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.title.trim()) errors.title = "Title is required.";
  if (draft.title.trim().length > 120) errors.title = "Use 120 characters or fewer.";
  if (draft.description.trim().length > 2_000) errors.description = "Use 2,000 characters or fewer.";
  if (!Number.isInteger(draft.order) || draft.order < 1 || draft.order > 9_999) {
    errors.order = "Order must be a whole number from 1 to 9,999.";
  }

  if (draft.imageUrl && !isHttpsUrl(draft.imageUrl)) errors.imageUrl = "Use a valid HTTPS image URL.";
  if (draft.thumbnailUrl && !isHttpsUrl(draft.thumbnailUrl)) errors.thumbnailUrl = "Use a valid HTTPS image URL.";
  if (draft.imageDataUrl && (!draft.imageDataUrl.startsWith("data:image/") || dataUrlBytes(draft.imageDataUrl) > 350_000)) {
    errors.imageDataUrl = "The compressed image must be an image data URL no larger than 350 KB.";
  }
  if (draft.thumbnailDataUrl && (!draft.thumbnailDataUrl.startsWith("data:image/") || dataUrlBytes(draft.thumbnailDataUrl) > 350_000)) {
    errors.thumbnailDataUrl = "The compressed thumbnail must be an image data URL no larger than 350 KB.";
  }

  if (collection === "videos") {
    if (draft.videoSourceType === "hosted") {
      if (!draft.videoUrl.trim()) errors.videoUrl = "Video URL is required.";
      else if (!isHttpsUrl(draft.videoUrl)) errors.videoUrl = "Use a valid HTTPS video URL.";
    } else if (!/^[a-z][a-z0-9_]*$/.test(draft.bundledResourceName)) {
      errors.bundledResourceName = "Use a valid Android raw resource name, without .mp4.";
    }
  }

  if (collection === "announcements" && !draft.audience.trim()) {
    errors.audience = "Audience is required.";
  }
  if (collection === "violations" && !draft.penalty.trim()) {
    errors.penalty = "Penalty or enforcement action is required.";
  }
  if (collection === "schedules") {
    if (!draft.serviceArea.trim()) errors.serviceArea = "Service area is required.";
    if (!draft.scheduleDay.trim()) errors.scheduleDay = "Collection day is required.";
    if (!draft.collectionTime.trim()) errors.collectionTime = "Collection time is required.";
  }
  return errors;
}
