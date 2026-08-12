import { pipeline, env } from "@huggingface/transformers";
import {
  CATEGORY_PROMPTS,
  DEFAULT_CATEGORY_CONFIDENCE_THRESHOLD,
  type ProductCategory,
} from "./categories";
import type { AIClassificationResult } from "./types";

// Cache model locally after first download
env.allowRemoteModels = true;
env.useBrowserCache = false;

const MODEL_NAME = "Xenova/clip-vit-base-patch32";
const MODEL_VERSION = "1.0.0";

let classifier: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getClassifier() {
  if (classifier) return classifier;

  classifier = await pipeline(
    "zero-shot-image-classification",
    MODEL_NAME,
  );

  return classifier;
}

export async function classifyImage(
  imageUrl: string,
): Promise<AIClassificationResult> {
  const ai = await getClassifier();

  const labels: string[] = [];
  const labelMap = new Map<string, ProductCategory>();

  for (const [category, prompts] of Object.entries(CATEGORY_PROMPTS)) {
    for (const prompt of prompts) {
      labels.push(prompt);
      labelMap.set(prompt, category as ProductCategory);
    }
  }

  const runClassifier =
    ai as unknown as (
      image: string,
      labels: string[],
    ) => Promise<
      Array<{
        label: string;
        score: number;
      }>
    >;

  const output = await runClassifier(imageUrl, labels);

  output.sort((a, b) => b.score - a.score);

  const best = output[0];

  const category =
    labelMap.get(best.label) ??
    ("Other" as ProductCategory);

  return {
    category,
    confidence: Number(best.score.toFixed(4)),
    model: MODEL_NAME,
    version: MODEL_VERSION,
    analyzedAt: new Date().toISOString(),
    quality:
      best.score >= DEFAULT_CATEGORY_CONFIDENCE_THRESHOLD
        ? "good"
        : "warning",
  };
}

export async function preloadAIModel() {
  await getClassifier();
}