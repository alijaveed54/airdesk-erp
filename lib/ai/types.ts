import type { ProductCategory } from "./categories";

export type AIJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface AIClassificationResult {
  fabric?: string;
  fabricConfidence?: number;
  model: string;
  version: string;
  analyzedAt: string;

  // Compatibility fields only. The AI no longer generates these values.
  category?: ProductCategory;
  confidence?: number;
  color?: string;
  work?: string;
  background?: string;
  quality?: "good" | "warning" | "poor";
}

export interface AIQueueItem {
  id: string;
  imageKey: string;
  sku?: string;
  status: AIJobStatus;
  retries: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIAnalyzeRequest {
  imageUrl: string;
  imageKey: string;
  sku?: string;
}

export interface AIAnalyzeResponse {
  success: boolean;
  result?: AIClassificationResult;
  error?: string;
}
