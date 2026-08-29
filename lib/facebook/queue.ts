export type FacebookJobStatus =
  | "pending"
  | "processing"
  | "posted"
  | "failed";


export interface FacebookPostJob {
  id: string;

  campaignId: string;

  productId: string;

  sku: string;

  pageId: string;

  imageUrls: string[];

  status: FacebookJobStatus;

  retryCount: number;

  facebookPostId?: string;

  errorMessage?: string;

  createdAt: string;

  processedAt?: string;
}