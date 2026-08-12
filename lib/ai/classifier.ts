import { extractFabric } from "./attributes";
import { generateDetailedCaption } from "./florence";
import type {
  AIAnalyzeRequest,
  AIAnalyzeResponse,
  AIClassificationResult,
} from "./types";

function validateAnalyzeRequest(input: AIAnalyzeRequest) {
  if (!input.imageUrl?.trim()) {
    throw new Error("Image URL is required");
  }

  if (!input.imageKey?.trim()) {
    throw new Error("Image key is required");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(input.imageUrl);
  } catch {
    throw new Error("Invalid image URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP or HTTPS image URLs are supported");
  }
}

export async function analyzeProductImage(
  input: AIAnalyzeRequest,
): Promise<AIAnalyzeResponse> {
  try {
    validateAnalyzeRequest(input);

    const captionResult = await generateDetailedCaption(input.imageUrl.trim());
    const fabric = extractFabric(captionResult.caption);

    const result: AIClassificationResult = {
      fabric,
      fabricConfidence: fabric ? 0.75 : undefined,
      model: captionResult.model,
      version: captionResult.version,
      analyzedAt: new Date().toISOString(),
    };

    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Fabric analysis failed",
    };
  }
}

export function isLowConfidenceResult(
  result: AIClassificationResult,
  minimumConfidence = 0.35,
) {
  return (result.fabricConfidence ?? 0) < minimumConfidence;
}

export function formatConfidence(confidence: number) {
  const safeConfidence = Math.min(Math.max(confidence, 0), 1);
  return `${Math.round(safeConfidence * 100)}%`;
}
