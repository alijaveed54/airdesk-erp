export type FacebookImageShuffleOptions = {
  enabled: boolean;
  seed: string;
  pageIndex?: number;
};

function hashString(value: string) {
  let hash = 2166136261;

  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleIndexes(indexes: number[], seed: number) {
  const result = [...indexes];
  const random = createRandom(seed);

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

/**
 * Creates a stable Page-specific image order.
 *
 * Enabled rules:
 * - 0/1 image remains unchanged because no alternative exists.
 * - The original first image is NEVER first, so the Facebook cover image
 *   visibly changes and the original sequence can never be used.
 * - Consecutive Page indexes receive different first images while possible.
 * - The same seed and Page index always return the same order for retries.
 */
export function shuffleFacebookImagesForPage<T>(
  items: readonly T[],
  options: FacebookImageShuffleOptions,
): T[] {
  const copy = [...items];

  if (!options.enabled || copy.length < 2) {
    return copy;
  }

  const pageIndex = Math.max(0, Math.trunc(Number(options.pageIndex || 0)));
  const baseSeed = hashString(options.seed);

  // Original index 0 is intentionally excluded from the first-image choices.
  // This guarantees a visibly different Facebook cover image.
  const firstOriginalIndex =
    1 + ((baseSeed + pageIndex) % (copy.length - 1));

  const remainingIndexes = Array.from(
    { length: copy.length },
    (_, index) => index,
  ).filter((index) => index !== firstOriginalIndex);

  const mixedSeed =
    (baseSeed ^ Math.imul(pageIndex + 1, 0x9e3779b1)) >>> 0;

  const order = [
    firstOriginalIndex,
    ...shuffleIndexes(remainingIndexes, mixedSeed),
  ];

  return order.map((originalIndex) => copy[originalIndex]);
}
