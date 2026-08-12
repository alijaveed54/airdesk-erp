import { analyzeProductImage } from "./classifier";
import { loadAIResult, saveAIResult } from "./storage";

export interface CompleteAIAnalysis {
  imageKey: string;
  imageUrl: string;
  sku?: string;
  fabric?: string;
  fabricConfidence?: number;
  model: {
    name: string;
    version: string;
  };
  analyzedAt: string;
  cachedAt: string;
}

export interface AnalyzeImageOptions {
  forceRefresh?: boolean;
}

export interface AnalyzeImageResponse {
  success: boolean;
  cached: boolean;
  result?: CompleteAIAnalysis;
  error?: string;
}

export async function analyzeImage(
  imageKey: string,
  imageUrl: string,
  sku?: string,
  options: AnalyzeImageOptions = {},
): Promise<AnalyzeImageResponse> {
  try {
    const cleanImageKey = imageKey.trim();
    const cleanImageUrl = imageUrl.trim();
    const cleanSku = sku?.trim() || undefined;

    if (!cleanImageKey) {
      throw new Error("Image key is required");
    }

    if (!cleanImageUrl) {
      throw new Error("Image URL is required");
    }

    if (!options.forceRefresh) {
      const cached = await loadAIResult<CompleteAIAnalysis>(cleanImageKey);

      if (cached?.imageKey === cleanImageKey) {
        return {
          success: true,
          cached: true,
          result: cached,
        };
      }
    }

    const analyzed = await analyzeProductImage({
      imageKey: cleanImageKey,
      imageUrl: cleanImageUrl,
      sku: cleanSku,
    });

    if (!analyzed.success || !analyzed.result) {
      throw new Error(analyzed.error || "Fabric analysis failed");
    }

    const now = new Date().toISOString();

    const result: CompleteAIAnalysis = {
      imageKey: cleanImageKey,
      imageUrl: cleanImageUrl,
      sku: cleanSku,
      fabric: analyzed.result.fabric,
      fabricConfidence: analyzed.result.fabricConfidence,
      model: {
        name: analyzed.result.model,
        version: analyzed.result.version,
      },
      analyzedAt: now,
      cachedAt: now,
    };

    await saveAIResult(cleanImageKey, result);

    return {
      success: true,
      cached: false,
      result,
    };
  } catch (error) {
    return {
      success: false,
      cached: false,
      error:
        error instanceof Error ? error.message : "Fabric analysis failed",
    };
  }
}

export async function refreshImageAnalysis(
  imageKey: string,
  imageUrl: string,
  sku?: string,
) {
  return analyzeImage(imageKey, imageUrl, sku, {
    forceRefresh: true,
  });
}

export async function getStoredImageAnalysis(imageKey: string) {
  return loadAIResult<CompleteAIAnalysis>(imageKey.trim());
}
