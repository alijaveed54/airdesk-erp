export type GalleryImage = {
  key: string;
  url: string;
  sku: string;
  currency: string;
  size: number;
  lastModified: string;
  imageNumber: string;
};

export type GalleryGroup = {
  sku: string;
  currency: string;
  count: number;
  totalSize: number;
  coverUrl: string;
  latestUpload: string;
  images: GalleryImage[];
};

export type GalleryResponse = {
  success: boolean;
  message?: string;
  groups?: GalleryGroup[];
  summary?: {
    totalImages: number;
    totalSkus: number;
    totalGroups: number;
    totalSize: number;
  };
};

export type AIResult = {
  category: string;
  confidence: number;
  model: string;
  version: string;
  analyzedAt: string;
  quality?: "good" | "warning" | "poor";
  fabric?: string;
fabricConfidence?: number;
};

export type AIResponse = {
  success: boolean;
  result?: AIResult;
  error?: string;
};