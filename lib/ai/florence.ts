"use client";

import {
  AutoProcessor,
  AutoTokenizer,
  env,
  Florence2ForConditionalGeneration,
  RawImage,
} from "@huggingface/transformers";

env.allowRemoteModels = true;
env.useBrowserCache = false;

const MODEL_ID = "onnx-community/Florence-2-base-ft";
const MODEL_VERSION = "1.0.0";
const TASK = "<MORE_DETAILED_CAPTION>";

type FlorenceModel = Awaited<
  ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>
>;

type FlorenceProcessor = Awaited<
  ReturnType<typeof AutoProcessor.from_pretrained>
>;

type FlorenceTokenizer = Awaited<
  ReturnType<typeof AutoTokenizer.from_pretrained>
>;

type FlorencePromptProcessor = {
  construct_prompts: (task: string) => string[];
  post_process_generation: (
    generatedText: string,
    task: string,
    imageSize: [number, number] | number[],
  ) => Record<string, unknown>;
};

let modelPromise: Promise<FlorenceModel> | null = null;
let processorPromise: Promise<FlorenceProcessor> | null = null;
let tokenizerPromise: Promise<FlorenceTokenizer> | null = null;

function getModel() {
  if (!modelPromise) {
    modelPromise = Florence2ForConditionalGeneration.from_pretrained(
      MODEL_ID,
      {
        dtype: "q8",
      },
    );
  }

  return modelPromise;
}

function getProcessor() {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }

  return processorPromise;
}

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  }

  return tokenizerPromise;
}

export interface FlorenceCaptionResult {
  caption: string;
  model: string;
  version: string;
  task: typeof TASK;
  generatedAt: string;
}

export async function generateDetailedCaption(
  imageUrl: string,
): Promise<FlorenceCaptionResult> {
  const trimmedUrl = imageUrl.trim();

  if (!trimmedUrl) {
    throw new Error("Image URL is required");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("Invalid image URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP or HTTPS image URLs are supported");
  }

  const [model, processor, tokenizer, image] = await Promise.all([
    getModel(),
    getProcessor(),
    getTokenizer(),
    RawImage.fromURL(trimmedUrl),
  ]);

  const promptProcessor =
    processor as unknown as FlorencePromptProcessor;

  const visionInputs = await processor(image);
  const prompts = promptProcessor.construct_prompts(TASK);
  const textInputs = tokenizer(prompts);

  const generatedIds = await model.generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: 160,
  });

  const generatedText = tokenizer.batch_decode(
    generatedIds as unknown as number[][],
    {
      skip_special_tokens: false,
    },
  )[0];

  const processed = promptProcessor.post_process_generation(
    generatedText,
    TASK,
    image.size,
  );

  const caption =
    typeof processed[TASK] === "string"
      ? processed[TASK].trim()
      : "";

  if (!caption) {
    throw new Error("Florence-2 returned an empty caption");
  }

  return {
    caption,
    model: MODEL_ID,
    version: MODEL_VERSION,
    task: TASK,
    generatedAt: new Date().toISOString(),
  };
}

export async function preloadFlorenceModel() {
  await Promise.all([getModel(), getProcessor(), getTokenizer()]);
}
