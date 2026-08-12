import { analyzeProductImage } from "./classifier";
import {
  aiResultExists,
  loadAIResult,
  saveAIResult,
} from "./storage";
import type {
  AIAnalyzeResponse,
  AIClassificationResult,
} from "./types";

export interface CachedAIResult {
  imageKey: string;
  imageUrl: string;
  sku?: string;
  result: AIClassificationResult;
  cachedAt: string;
}

export async function getCachedAIResult(
  imageKey: string,
): Promise<CachedAIResult | null> {
  return loadAIResult<CachedAIResult>(imageKey);
}

export async function getOrAnalyzeImage(
  imageKey: string,
  imageUrl: string,
  sku?: string,
): Promise<AIAnalyzeResponse> {
  const cached = await getCachedAIResult(imageKey);

  if (cached?.result) {
    return {
      success: true,
      result: cached.result,
    };
  }

  const analyzed = await analyzeProductImage({
    imageKey,
    imageUrl,
    sku,
  });

  if (!analyzed.success || !analyzed.result) {
    return analyzed;
  }

  const payload: CachedAIResult = {
    imageKey,
    imageUrl,
    sku,
    result: analyzed.result,
    cachedAt: new Date().toISOString(),
  };

  await saveAIResult(imageKey, payload);

  return analyzed;
}

export async function hasCachedAIResult(imageKey: string) {
  return aiResultExists(imageKey);
}

export async function refreshAIResult(
  imageKey: string,
  imageUrl: string,
  sku?: string,
): Promise<AIAnalyzeResponse> {
  const analyzed = await analyzeProductImage({
    imageKey,
    imageUrl,
    sku,
  });

  if (!analyzed.success || !analyzed.result) {
    return analyzed;
  }

  const payload: CachedAIResult = {
    imageKey,
    imageUrl,
    sku,
    result: analyzed.result,
    cachedAt: new Date().toISOString(),
  };

  await saveAIResult(imageKey, payload);

  return analyzed;
}
