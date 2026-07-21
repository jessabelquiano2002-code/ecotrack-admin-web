export const COLLECTIONS = [
  "advertisements",
  "videos",
  "announcements",
  "guides",
  "violations",
  "schedules",
] as const;

export type CollectionId = (typeof COLLECTIONS)[number];

export const COLLECTION_LABELS: Record<CollectionId, string> = {
  advertisements: "Featured Information",
  videos: "Educational Videos",
  announcements: "Announcements",
  guides: "Waste Guides",
  violations: "Violations & Penalties",
  schedules: "Collection Schedules",
};

export type VideoSourceType = "hosted" | "bundled";
export type VersionStatus = "draft" | "published";
export type ReviewStatus = "in_progress" | "completed" | "skipped";

export type AdminConfig = {
  draftVersion: number;
  lastPublishedVersion: number;
  publicAvailable: boolean;
  updatedAt: number | null;
  updatedBy: string;
};

export type VersionMeta = {
  version: number;
  title: string;
  status: VersionStatus;
  forceReview: boolean;
  allowOptionalSkip: boolean;
  createdAt: number | null;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string;
  publishedAt: number | null;
  publishedBy: string;
};

export type ContentDraft = {
  title: string;
  description: string;
  category: string;
  audience: string;
  imageUrl: string;
  imageDataUrl: string;
  videoSourceType: VideoSourceType;
  videoUrl: string;
  bundledResourceName: string;
  thumbnailUrl: string;
  thumbnailDataUrl: string;
  penalty: string;
  ordinanceReference: string;
  serviceArea: string;
  scheduleDay: string;
  collectionTime: string;
  notes: string;
  order: number;
  required: boolean;
  published: boolean;
};

export type ContentItem = ContentDraft & {
  id: string;
  version: number;
  collection: CollectionId;
  createdAt: number | null;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string;
};

export type ResidentAcknowledgment = {
  uid: string;
  version: number;
  displayName: string;
  email: string;
  status: ReviewStatus;
  requiredItemCount: number;
  reviewedRequiredCount: number;
  reviewedItemCount: number;
  skippedItemCount: number;
  startedAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  skippedAt: number | null;
};

export const EMPTY_DRAFT: ContentDraft = {
  title: "",
  description: "",
  category: "",
  audience: "",
  imageUrl: "",
  imageDataUrl: "",
  videoSourceType: "hosted",
  videoUrl: "",
  bundledResourceName: "",
  thumbnailUrl: "",
  thumbnailDataUrl: "",
  penalty: "",
  ordinanceReference: "",
  serviceArea: "",
  scheduleDay: "",
  collectionTime: "",
  notes: "",
  order: 1,
  required: false,
  published: true,
};
