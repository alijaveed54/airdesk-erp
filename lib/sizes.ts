export const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL",
  "9XL",
  "10XL",
  "11XL",
  "12XL",
  "13XL",
  "14XL",
  "15XL",
] as const;

export type StandardSize = (typeof SIZE_ORDER)[number];
export type ProductSize = StandardSize | "FREE SIZE";

export const NUMERIC_TO_STANDARD_SIZE: Record<string, StandardSize> = {
  "32": "XXS",
  "34": "XS",
  "36": "S",
  "38": "M",
  "40": "L",
  "42": "XL",
  "44": "2XL",
  "46": "3XL",
  "48": "4XL",
  "50": "5XL",
  "52": "6XL",
  "54": "7XL",
  "56": "8XL",
  "58": "9XL",
  "60": "10XL",
  "62": "11XL",
  "64": "12XL",
  "66": "13XL",
  "68": "14XL",
  "70": "15XL",
};

export const STANDARD_TO_NUMERIC_SIZE: Record<StandardSize, string> = {
  XXS: "32",
  XS: "34",
  S: "36",
  M: "38",
  L: "40",
  XL: "42",
  "2XL": "44",
  "3XL": "46",
  "4XL": "48",
  "5XL": "50",
  "6XL": "52",
  "7XL": "54",
  "8XL": "56",
  "9XL": "58",
  "10XL": "60",
  "11XL": "62",
  "12XL": "64",
  "13XL": "66",
  "14XL": "68",
  "15XL": "70",
};

const FREE_SIZE_ALIASES = new Set([
  "FREE",
  "FREE SIZE",
  "FREESIZE",
  "ONE SIZE",
  "ONESIZE",
  "OS",
  "F",
]);

const LETTER_SIZE_ALIASES: Record<string, StandardSize> = {
  XXS: "XXS",
  XS: "XS",
  S: "S",
  SMALL: "S",
  M: "M",
  MEDIUM: "M",
  L: "L",
  LARGE: "L",
  XL: "XL",
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
  XXXXXL: "5XL",
};

function cleanSizeToken(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

export function normalizeSize(value: string): ProductSize | null {
  const cleaned = cleanSizeToken(value);

  if (!cleaned) return null;

  if (FREE_SIZE_ALIASES.has(cleaned)) {
    return "FREE SIZE";
  }

  const withoutSpaces = cleaned.replace(/\s+/g, "");

  if (NUMERIC_TO_STANDARD_SIZE[withoutSpaces]) {
    return NUMERIC_TO_STANDARD_SIZE[withoutSpaces];
  }

  if (LETTER_SIZE_ALIASES[withoutSpaces]) {
    return LETTER_SIZE_ALIASES[withoutSpaces];
  }

  const xlMatch = withoutSpaces.match(/^(\d{1,2})XL$/);

  if (xlMatch) {
    const normalized = `${Number(xlMatch[1])}XL` as StandardSize;

    if (SIZE_ORDER.includes(normalized)) {
      return normalized;
    }
  }

  const mixedMatch = cleaned.match(
    /^(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)\s*[/=-]\s*(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)$/i,
  );

  if (mixedMatch) {
    return normalizeSize(mixedMatch[1]) || normalizeSize(mixedMatch[2]);
  }

  return null;
}

function expandRange(startValue: string, endValue: string): ProductSize[] {
  const start = normalizeSize(startValue);
  const end = normalizeSize(endValue);

  if (!start || !end || start === "FREE SIZE" || end === "FREE SIZE") {
    return [];
  }

  const startIndex = SIZE_ORDER.indexOf(start);
  const endIndex = SIZE_ORDER.indexOf(end);

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return [];
  }

  return SIZE_ORDER.slice(startIndex, endIndex + 1);
}

export function parseSizes(value: string): ProductSize[] {
  const cleaned = value
    .trim()
    .replace(/\bSIZE\s*[:-]?\s*/gi, "")
    .replace(/\bTO\b/gi, "to")
    .replace(/\s+/g, " ");

  if (!cleaned) return [];

  const directFreeSize = normalizeSize(cleaned);

  if (directFreeSize === "FREE SIZE") {
    return ["FREE SIZE"];
  }

  const rangeMatch = cleaned.match(
    /^(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|XXL|XXXL|XXXXL|XXXXXL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)\s*(?:to|-)\s*(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|XXL|XXXL|XXXXL|XXXXXL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)$/i,
  );

  if (rangeMatch) {
    return expandRange(rangeMatch[1], rangeMatch[2]);
  }

  const normalized = cleaned
    .split(/\s*(?:,|\/|\||&|\+|;)\s*/)
    .flatMap((part) => {
      const partRange = part.match(
        /^(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|XXL|XXXL|XXXXL|XXXXXL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)\s*(?:to|-)\s*(XXS|XS|S|M|L|XL|(?:[2-9]|1[0-5])XL|XXL|XXXL|XXXXL|XXXXXL|32|34|36|38|40|42|44|46|48|50|52|54|56|58|60|62|64|66|68|70)$/i,
      );

      if (partRange) {
        return expandRange(partRange[1], partRange[2]);
      }

      const size = normalizeSize(part);
      return size ? [size] : [];
    });

  return normalized.filter(
    (size, index, all) => all.indexOf(size) === index,
  );
}

export function formatSizes(
  sizes: ProductSize[],
  output: "standard" | "numeric" | "both" = "standard",
) {
  return sizes
    .map((size) => {
      if (size === "FREE SIZE") return size;

      const numeric = STANDARD_TO_NUMERIC_SIZE[size];

      if (output === "numeric") return numeric;
      if (output === "both") return `${size} (${numeric})`;

      return size;
    })
    .join(", ");
}

export function getNumericSize(size: ProductSize) {
  if (size === "FREE SIZE") return null;
  return STANDARD_TO_NUMERIC_SIZE[size];
}

export function getStandardSize(numericSize: string) {
  return NUMERIC_TO_STANDARD_SIZE[numericSize.trim()] || null;
}

export function isValidSize(value: string) {
  return normalizeSize(value) !== null;
}
