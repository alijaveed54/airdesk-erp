"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  Images,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import {
  ChangeEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type DateOrder = "MDY" | "DMY";
type MappingConfidence = "High" | "Medium" | "Needs Review" | "Manual" | "Unmapped";

type ChatMessage = {
  index: number;
  dateText: string;
  timeText: string;
  timestamp: number | null;
  sender: string;
  body: string;
};

type SenderStat = {
  name: string;
  messageCount: number;
  skuLikeCount: number;
};

type MediaRef = {
  fileName: string;
  omitted: boolean;
};

type ProductBlock = {
  id: string;
  order: number;
  messageIndex: number;
  dateText: string;
  timeText: string;
  timestamp: number | null;
  sender: string;
  supplier: string;
  description: string;
  size: string;
  price: string;
  fabric: string;
  mediaRefs: MediaRef[];
  mediaMessageCount: number;
  linkedMediaCount: number;
  sku: string;
  skuMessageIndex: number | null;
  confidence: MappingConfidence;
  reviewed: boolean;
};

type ParseSummary = {
  messages: number;
  products: number;
  skuMessages: number;
  mapped: number;
  review: number;
  mediaMessages: number;
  exactMediaNames: number;
};

type BrowserFile = File & {
  webkitRelativePath?: string;
};

type DirectoryFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

type DirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterableIterator<DirectoryFileHandle | DirectoryHandle>;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<DirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | string | ArrayBuffer) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<DirectoryHandle>;
};

const DEFAULT_SUPPLIER_CODES = [
  "HRT",
  "FFT",
  "SML",
  "SRK",
  "FEU",
  "MAF",
  "BS",
  "DQ",
  "UMZ",
  "HT",
];

const DEFAULT_SKU_PREFIXES = [
  "PMM",
  "HRT",
  "FFT",
  "SML",
  "SRK",
  "UMZ",
  "HT",
];

const PRODUCT_KEYWORDS = [
  "fabric",
  "top",
  "bottom",
  "dupatta",
  "duppata",
  "lehenga",
  "lehnga",
  "choli",
  "gown",
  "kurti",
  "saree",
  "suit",
  "dress",
  "blouse",
  "plazzo",
  "palazzo",
  "inner",
  "sleeve",
  "rate",
  "price",
  "size",
  "stitched",
  "unstitched",
  "semi stitched",
  "embroidery",
  "sequence",
  "sequins",
];

const STRONG_PRODUCT_KEYWORDS = [
  "fabric",
  "top",
  "bottom",
  "dupatta",
  "duppata",
  "lehenga",
  "lehnga",
  "choli",
  "gown",
  "kurti",
  "saree",
  "blouse",
  "plazzo",
  "palazzo",
  "embroidery",
  "stitched",
  "unstitched",
  "semi stitched",
];

const MEDIA_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|avif|mp4|mov|m4v|pdf)$/i;

function normalizeList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,;|]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function detectDateOrder(text: string): DateOrder {
  const pattern = /^(\d{1,2})\/(\d{1,2})\/\d{2,4},/gm;
  let match: RegExpExecArray | null;
  let checked = 0;

  while ((match = pattern.exec(text)) && checked < 20000) {
    checked += 1;
    const first = Number(match[1]);
    const second = Number(match[2]);

    if (second > 12 && first <= 12) return "MDY";
    if (first > 12 && second <= 12) return "DMY";
  }

  return "MDY";
}

function parseTimestamp(
  dateText: string,
  timeText: string,
  order: DateOrder,
) {
  const dateParts = dateText.split("/").map(Number);
  if (dateParts.length !== 3 || dateParts.some(Number.isNaN)) return null;

  const first = dateParts[0];
  const second = dateParts[1];
  let year = dateParts[2];
  if (year < 100) year += year >= 70 ? 1900 : 2000;

  const month = order === "MDY" ? first : second;
  const day = order === "MDY" ? second : first;

  const timeMatch = timeText
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);

  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const ampm = timeMatch[3]?.toUpperCase();

  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const value = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  return Number.isFinite(value) ? value : null;
}

function parseDateInputStart(value: string) {
  if (!value) return null;

  const parts = value.split("-").map(Number);
  if (parts.length != 3 || parts.some(Number.isNaN)) return null;

  const [year, month, day] = parts;
  const timestamp = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseChatMessages(text: string) {
  const dateOrder = detectDateOrder(text);
  const headerPattern = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[\-–]\s*(.*)$/;
  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\u200e/, "");
    const match = line.match(headerPattern);

    if (match) {
      if (current) messages.push(current);

      const remainder = match[3];
      const senderSeparator = remainder.indexOf(": ");
      const sender = senderSeparator >= 0
        ? remainder.slice(0, senderSeparator).trim()
        : "";
      const body = senderSeparator >= 0
        ? remainder.slice(senderSeparator + 2)
        : remainder;

      current = {
        index: messages.length,
        dateText: match[1],
        timeText: match[2],
        timestamp: parseTimestamp(match[1], match[2], dateOrder),
        sender,
        body,
      };
      continue;
    }

    if (current) {
      current.body += `\n${rawLine}`;
    }
  }

  if (current) messages.push(current);
  return { messages, dateOrder };
}

function isMediaMessage(body: string) {
  return /<Media omitted>/i.test(body) || /\(file attached\)/i.test(body);
}

function extractMediaFileName(body: string) {
  const attached = body.match(
    /(?:^|\n)([^\n\\/]+\.(?:jpe?g|png|webp|gif|heic|avif|mp4|mov|m4v|pdf))\s*\(file attached\)/i,
  );
  return attached?.[1]?.trim() || "";
}

function isDeletedOrSystem(body: string) {
  const normalized = body.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "this message was deleted" ||
    normalized.includes("messages and calls are end-to-end encrypted") ||
    normalized.includes("changed the group") ||
    normalized.includes("created group") ||
    normalized.includes("was added") ||
    normalized.includes("left")
  );
}

function isSeparator(body: string) {
  const normalized = body.trim().toLowerCase();
  if (!normalized) return true;
  if (/^[\-_=+*/.\s]{2,}$/.test(normalized)) return true;
  if (normalized === "//") return true;
  if (normalized.includes("post together")) return true;
  return false;
}

function looksLikeProductDescription(body: string) {
  const normalized = body.trim();
  if (normalized.length < 45) return false;
  if (isDeletedOrSystem(normalized) || isMediaMessage(normalized)) return false;

  const lower = normalized.toLowerCase();
  const keywordHits = PRODUCT_KEYWORDS.filter((keyword) =>
    lower.includes(keyword),
  ).length;
  const strongKeywordHits = STRONG_PRODUCT_KEYWORDS.filter((keyword) =>
    lower.includes(keyword),
  ).length;
  const lineCount = normalized
    .split("\n")
    .filter((line) => line.trim()).length;

  const looksOperational = [
    "send me the images",
    "recheck availability",
    "ensure all images",
    "price badge",
    "is it done",
    "please check",
    "post together",
    "upload it",
  ].some((phrase) => lower.includes(phrase));

  if (looksOperational && normalized.length < 180) return false;

  const hasPricedProductOffer =
    lineCount >= 4 &&
    normalized.length >= 100 &&
    /\b(?:product|stock|collection|article|design|saree|dress)\b/i.test(lower) &&
    /\b(?:price|rate)\b/i.test(lower) &&
    /\b(?:sale|offer|booking|available|stock|fabric|blouse|saree)\b/i.test(lower);

  return (
    (strongKeywordHits >= 2 &&
      (lineCount >= 2 || normalized.length >= 90)) ||
    (strongKeywordHits >= 1 &&
      keywordHits >= 3 &&
      (lineCount >= 3 || normalized.length >= 140)) ||
    (lineCount >= 5 && keywordHits >= 2 && normalized.length >= 120) ||
    hasPricedProductOffer
  );
}

function findSupplierCode(body: string, supplierCodes: string[]) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 80) return "";

  for (const code of supplierCodes) {
    const pattern = new RegExp(
      `(^|[^A-Z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`,
      "i",
    );
    if (pattern.test(trimmed)) return code;
  }

  return "";
}

type PricePair = {
  supplier: string;
  price: string;
};

const SIZE_NUMBER_TO_LABEL: Record<string, string> = {
  "34": "XS",
  "36": "S",
  "38": "M",
  "40": "L",
  "42": "XL",
  "44": "2XL",
};

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

const FABRIC_FALLBACK_PATTERN = /\b(?:pure\s+)?(?:(?:heavy|faux|fox|blooming|butterfly|butarflay|banarasi|banarashi|japan|dull|micro|soft|tissue|dola|art|raw)\s+){0,2}(?:georgette|net|organza|velvet|silk|cotton|rayon|satin|santoon|jacquard|chiffon|crepe|creape|crape|linen|lycra|viscose|denim|muslin|lawn|khaddar|cambric|brocade|taffeta|tafeta)(?:\s+(?:georgette|net|organza|velvet|silk|cotton|rayon|satin|santoon|jacquard|chiffon|crepe|creape|crape|linen|lycra|viscose|denim|muslin|lawn|khaddar|cambric|brocade|taffeta|tafeta)){0,2}\b/i;

function normalizePriceNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return "";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function extractSupplierPricePairs(
  body: string,
  supplierCodes: string[],
): PricePair[] {
  const pairs: PricePair[] = [];

  for (const code of supplierCodes) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|[^A-Z0-9])${escaped}\\s*[:=\\-]?\\s*(?:AED|QAR|MUR|INR|RS\\.?|PKR)?\\s*([0-9]{2,6}(?:\\.[0-9]+)?)(?=$|[^0-9])`,
      "ig",
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body))) {
      const price = normalizePriceNumber(match[1]);
      if (!price) continue;
      pairs.push({ supplier: code, price });
    }
  }

  return pairs;
}

function extractPrice(
  body: string,
  preferredSupplier: string,
  supplierCodes: string[],
) {
  const trimmed = body.trim();
  const supplierPairs = extractSupplierPricePairs(trimmed, supplierCodes);
  const preferred = preferredSupplier.trim().toUpperCase();

  if (preferred) {
    const preferredPair = supplierPairs.find(
      (pair) => pair.supplier.toUpperCase() === preferred,
    );
    if (preferredPair) return preferredPair.price;
  }

  if (supplierPairs.length === 1) return supplierPairs[0].price;

  if (supplierPairs.length > 1) {
    const uniquePrices = Array.from(
      new Set(supplierPairs.map((pair) => pair.price)),
    );
    if (uniquePrices.length === 1) return uniquePrices[0];
  }

  const currencyMatch = trimmed.match(
    /\b(?:AED|QAR|MUR|INR|RS\.?|PKR)\s*[,.:\-]?\s*([0-9]{2,6}(?:\.[0-9]+)?)/i,
  );
  if (currencyMatch) return normalizePriceNumber(currencyMatch[1]);

  const genericRate = trimmed.match(
    /\b(?:wholesale\s+rate|sale\s+price|rate|price)\s*[:=\-]?\s*(?:AED|QAR|MUR|INR|RS\.?|PKR)?\s*([0-9]{2,6}(?:\.[0-9]+)?)/i,
  );
  if (genericRate) return normalizePriceNumber(genericRate[1]);

  if (trimmed.length <= 24) {
    const standalone = trimmed.match(
      /^\s*(?:AED|QAR|MUR|INR|RS\.?|PKR)?\s*[:=\-]?\s*([0-9]{2,6}(?:\.[0-9]+)?)\s*(?:\/-)?\s*$/i,
    );
    if (standalone) {
      const price = normalizePriceNumber(standalone[1]);
      const numeric = Number(price);
      if (numeric >= 50) return price;
    }
  }

  return "";
}

function normalizeSizeToken(value: string) {
  const token = value.toUpperCase().replace(/\s+/g, "");
  if (token === "XXL") return "2XL";
  if (token === "XXXL") return "3XL";
  if (token === "XXXXL") return "4XL";
  return token;
}

function formatSizeRange(tokens: string[]) {
  const unique = Array.from(new Set(tokens))
    .filter((token) => SIZE_ORDER.includes(token))
    .sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));

  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  return `${unique[0]} to ${unique[unique.length - 1]}`;
}

function normalizeSizeCandidate(value: string) {
  const cleaned = value
    .replace(/[*_⭐️🎭👉👗💥💕👌🦋🧵🌟🥥🩱🧣🧶📌#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.:=\-\s]+/, "")
    .replace(/[,*]+$/, "")
    .trim();

  if (!cleaned) return "";

  const alphaMatches = Array.from(
    cleaned.matchAll(/\b(XXXXL|XXXL|XXL|XL|XS|[SML]|[234]XL)\b/gi),
  ).map((match) => normalizeSizeToken(match[1]));

  // User rule: when alphabet and number both exist, alphabet wins.
  if (alphaMatches.length > 0) return formatSizeRange(alphaMatches);

  const mappedNumbers = Array.from(cleaned.matchAll(/\b(34|36|38|40|42|44)\b/g))
    .map((match) => SIZE_NUMBER_TO_LABEL[match[1]])
    .filter(Boolean);

  if (mappedNumbers.length > 1) return formatSizeRange(mappedNumbers);

  if (mappedNumbers.length === 1) {
    const mapped = mappedNumbers[0];
    const isUpTo = /\b(?:free\s*size|max(?:imum)?\s*up\s*to|up\s*to)\b/i.test(cleaned);
    const mappedIndex = SIZE_ORDER.indexOf(mapped);
    const mediumIndex = SIZE_ORDER.indexOf("M");

    if (isUpTo && mappedIndex >= mediumIndex) {
      return mapped === "M" ? "M" : `M to ${mapped}`;
    }

    return mapped;
  }

  // Unsupported sizes such as 46/48 are kept so they can be edited manually.
  return cleaned.slice(0, 70);
}

function extractProductSize(body: string) {
  const cleanedLines = body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const values: string[] = [];

  for (const line of cleanedLines) {
    const match = line.match(
      /\b(?:(?:gown|top|choli|blouse|lehenga|lehnga|kurti|suit|dress|koti|plazzo|palazzo)\s+)?size\b\s*[.:=\-]*\s*(.{1,70})$/i,
    );
    if (!match) continue;

    const normalized = normalizeSizeCandidate(match[1]);
    if (
      normalized &&
      !values.some((item) => item.toLowerCase() === normalized.toLowerCase())
    ) {
      values.push(normalized);
    }
  }

  if (values.length > 0) return values.slice(0, 3).join(" | ");

  const stitchedUpTo = body.match(
    /\b(?:free\s*size|fully?\s*stitched|full\s*stitched|max(?:imum)?\s*up\s*to)\b[^\n]{0,35}?\b(34|36|38|40|42|44)\b/i,
  );
  if (stitchedUpTo) {
    return normalizeSizeCandidate(`Up to ${stitchedUpTo[1]}`);
  }

  const inlineMatch = body.match(
    /\b(?:size|free\s*size)\b\s*[.:=\-]*\s*((?:up\s*to\s*)?(?:free|xs|s|m|l|xl|xxl|xxxl|[234]xl|[0-9]{2,3})(?:\s*[()\-/,a-z0-9+ ]{0,35})?)/i,
  );

  return inlineMatch ? normalizeSizeCandidate(inlineMatch[1]) : "";
}

function normalizeFabric(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[:&\-–—_]+/g, " ")
    .replace(/\bpure\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return "";

  return cleaned.replace(
    /(^|\s)([\p{L}\p{N}])/gu,
    (_match, space: string, character: string) =>
      `${space}${character.toUpperCase()}`,
  );
}

function cleanFabricCandidate(value: string) {
  const cleaned = value
    .replace(/^\s*(?:top|gown|lehenga|lehnga|choli|blouse|kurti|saree|dress|dupatta|duppata|bottom|inner)\s*[-:]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^details?\b/i.test(cleaned)) return "";

  const beforeWork = cleaned
    .split(/\s+(?:with|having)\s+|\s+work\b|[,;|]/i)[0]
    .replace(/[.:=\-\s]+$/g, "")
    .trim();

  if (!beforeWork || beforeWork.length > 45) return "";
  return normalizeFabric(beforeWork);
}

function extractFabric(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const explicitFabric = line.match(/\bfabric\b\s*[.:=\-]*\s*(.{2,80})$/i);
    if (explicitFabric) {
      const candidate = cleanFabricCandidate(explicitFabric[1]);
      if (candidate) return candidate;
    }
  }

  for (const line of lines) {
    const garmentLine = line.match(
      /^\s*(?:top|gown|lehenga|lehnga|choli|blouse|kurti|saree|dress)\s*[.:=\-]+\s*(.{2,80})$/i,
    );
    if (garmentLine) {
      const candidate = cleanFabricCandidate(garmentLine[1]);
      if (candidate && FABRIC_FALLBACK_PATTERN.test(candidate)) return candidate;
    }
  }

  const fallback = body.match(FABRIC_FALLBACK_PATTERN);
  return fallback ? cleanFabricCandidate(fallback[0]) : "";
}

function extractInternalSku(body: string, prefixes: string[]) {
  const cleaned = body
    .trim()
    .replace(/^sku\s*[:#\-]?\s*/i, "")
    .replace(/\s+old\s+sku.*$/i, "")
    .trim();

  if (!cleaned || cleaned.length > 60) return "";
  if (/^(AED|QAR|MUR|INR|RS|PKR)\b/i.test(cleaned)) return "";

  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `^${escaped}[\s_-]*[0-9]{2,10}[A-Z0-9_-]*$`,
      "i",
    );

    if (pattern.test(cleaned)) {
      return cleaned.toUpperCase().replace(/\s+/g, "");
    }
  }

  return "";
}

function sanitizeFolderName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);

  return cleaned || "UNASSIGNED";
}

async function collectFilesFromDirectory(
  directory: DirectoryHandle,
  output: Map<string, File>,
) {
  for await (const entry of directory.values()) {
    if (entry.kind === "file") {
      if (!MEDIA_EXTENSIONS.test(entry.name)) continue;
      const file = await entry.getFile();
      output.set(entry.name.toLowerCase(), file);
      continue;
    }

    await collectFilesFromDirectory(entry, output);
  }
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function confidenceClass(confidence: MappingConfidence) {
  if (confidence === "High" || confidence === "Manual") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (confidence === "Medium") return "bg-blue-100 text-blue-800";
  if (confidence === "Needs Review") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

const START_AFTER_SKU_STORAGE_PREFIX = "mysmar:whatsapp:start-after-sku:";

function normalizeSkuMarker(value: string) {
  return value
    .trim()
    .replace(/^sku\s*[:#\-]?\s*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function getStartAfterSkuStorageKey(chatFileName: string) {
  const normalizedFileName = chatFileName
    .trim()
    .toLowerCase()
    .replace(/\s+\(\d+\)(?=\.txt$)/i, "");

  return `${START_AFTER_SKU_STORAGE_PREFIX}${normalizedFileName}`;
}

function findLatestSkuMarkerMessageIndex(
  messages: ChatMessage[],
  marker: string,
  prefixes: string[],
) {
  let latestIndex = -1;

  for (const message of messages) {
    const extractedSku = normalizeSkuMarker(
      extractInternalSku(message.body, prefixes),
    );
    const exactLineMatch = message.body
      .split("\n")
      .some((line) => normalizeSkuMarker(line) === marker);

    if (extractedSku === marker || exactLineMatch) {
      latestIndex = message.index;
    }
  }

  return latestIndex;
}

export default function WhatsAppSupplierImportPage() {
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const mediaFolderInputRef = useRef<HTMLInputElement | null>(null);
  const mediaFilesRef = useRef<Map<string, File>>(new Map());

  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [saveProgress, setSaveProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [senderStats, setSenderStats] = useState<SenderStat[]>([]);
  const [selectedMySenders, setSelectedMySenders] = useState<string[]>([]);
  const [supplierCodesText, setSupplierCodesText] = useState(
    DEFAULT_SUPPLIER_CODES.join(", "),
  );
  const [skuPrefixesText, setSkuPrefixesText] = useState(
    DEFAULT_SKU_PREFIXES.join(", "),
  );
  const [chatStartDate, setChatStartDate] = useState("");
  const [startAfterSku, setStartAfterSku] = useState("");
  const [products, setProducts] = useState<ProductBlock[]>([]);
  const [summary, setSummary] = useState<ParseSummary>({
    messages: 0,
    products: 0,
    skuMessages: 0,
    mapped: 0,
    review: 0,
    mediaMessages: 0,
    exactMediaNames: 0,
  });
  const [mediaFilesCount, setMediaFilesCount] = useState(0);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openProductDetails, setOpenProductDetails] = useState<
    Record<string, boolean>
  >({});
  const [openProductDescriptions, setOpenProductDescriptions] = useState<
    Record<string, boolean>
  >({});

  const supplierCodes = useMemo(
    () => normalizeList(supplierCodesText),
    [supplierCodesText],
  );
  const skuPrefixes = useMemo(
    () => normalizeList(skuPrefixesText),
    [skuPrefixesText],
  );

  const suppliers = useMemo(
    () =>
      Array.from(new Set(products.map((product) => product.supplier)))
        .filter(Boolean)
        .sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      if (supplierFilter && product.supplier !== supplierFilter) return false;
      if (statusFilter && product.confidence !== statusFilter) return false;

      if (!query) return true;

      return [
        product.sku,
        product.supplier,
        product.size,
        product.price,
        product.fabric,
        product.sender,
        product.description,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [products, search, supplierFilter, statusFilter]);

  function setAllProductSections(isOpen: boolean) {
    const visibleProductIds = filteredProducts.map((product) => product.id);
    if (visibleProductIds.length === 0) return;

    setOpenProductDetails((current) => {
      const next = { ...current };
      for (const productId of visibleProductIds) next[productId] = isOpen;
      return next;
    });

    setOpenProductDescriptions((current) => {
      const next = { ...current };
      for (const productId of visibleProductIds) next[productId] = isOpen;
      return next;
    });
  }

  async function handleTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLoadingText(true);
    setError("");
    setMessage("");
    setProducts([]);
    setOpenProductDetails({});
    setOpenProductDescriptions({});
    mediaFilesRef.current = new Map();
    setMediaFilesCount(0);

    try {
      const text = await file.text();
      const { messages } = parseChatMessages(text);
      const stats = new Map<string, SenderStat>();

      for (const item of messages) {
        if (!item.sender) continue;

        const existing = stats.get(item.sender) || {
          name: item.sender,
          messageCount: 0,
          skuLikeCount: 0,
        };

        existing.messageCount += 1;
        if (extractInternalSku(item.body, skuPrefixes)) {
          existing.skuLikeCount += 1;
        }
        stats.set(item.sender, existing);
      }

      const sortedStats = Array.from(stats.values()).sort(
        (a, b) =>
          b.skuLikeCount - a.skuLikeCount ||
          b.messageCount - a.messageCount,
      );

      const autoSelected = sortedStats
        .filter((item) => item.skuLikeCount >= 3)
        .slice(0, 8)
        .map((item) => item.name);

      const savedStartAfterSku = window.localStorage.getItem(
        getStartAfterSkuStorageKey(file.name),
      ) || "";

      setFileName(file.name);
      setRawText(text);
      setSenderStats(sortedStats);
      setSelectedMySenders(autoSelected);
      setStartAfterSku(savedStartAfterSku);
      setMessage(
        `${messages.length.toLocaleString()} messages loaded.${
          savedStartAfterSku
            ? ` Saved Start After SKU marker ${savedStartAfterSku} load ho gaya.`
            : ""
        } Apne SKU reply senders confirm karke Analyze Chat press karein.`,
      );
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "Chat file could not be read.",
      );
    } finally {
      setLoadingText(false);
    }
  }

  function toggleMySender(name: string) {
    setSelectedMySenders((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  }

  function clearStartAfterSku() {
    setStartAfterSku("");

    if (fileName) {
      window.localStorage.removeItem(getStartAfterSkuStorageKey(fileName));
      setMessage("Saved Start After SKU marker clear ho gaya.");
    }
  }

  function analyzeChat() {
    if (!rawText || analyzing) return;

    setAnalyzing(true);
    setError("");
    setMessage("");

    window.setTimeout(() => {
      try {
        const { messages: allMessages } = parseChatMessages(rawText);
        const normalizedStartAfterSku = normalizeSkuMarker(startAfterSku);
        let skuMarkerMessageIndex = -1;
        let messagesAfterSku = allMessages;

        if (normalizedStartAfterSku) {
          skuMarkerMessageIndex = findLatestSkuMarkerMessageIndex(
            allMessages,
            normalizedStartAfterSku,
            skuPrefixes,
          );

          if (skuMarkerMessageIndex < 0) {
            throw new Error(
              `Start After SKU "${normalizedStartAfterSku}" chat mein nahi mila. SKU check karein ya Clear press karein.`,
            );
          }

          messagesAfterSku = allMessages.filter(
            (item) => item.index > skuMarkerMessageIndex,
          );
        }

        const ignoredBySku = allMessages.length - messagesAfterSku.length;
        const startTimestamp = parseDateInputStart(chatStartDate);
        const messages =
          startTimestamp === null
            ? messagesAfterSku
            : messagesAfterSku.filter(
                (item) =>
                  item.timestamp !== null && item.timestamp >= startTimestamp,
              );
        const ignoredByDate = messagesAfterSku.length - messages.length;

        const selectedSenderSet = new Set(selectedMySenders);
        const productList: ProductBlock[] = [];
        const skuEvents: Array<{
          messageIndex: number;
          timestamp: number | null;
          sku: string;
        }> = [];

        let activeSupplier = "UNASSIGNED";
        let currentProduct: ProductBlock | null = null;
        let pendingMediaRefs: MediaRef[] = [];
        let pendingMediaMessageCount = 0;
        let pendingFirstMessage: ChatMessage | null = null;
        let pendingSupplier = "";
        let pendingPrice = "";
        let mediaMessages = 0;
        let exactMediaNames = 0;

        const clearPendingBlock = () => {
          pendingMediaRefs = [];
          pendingMediaMessageCount = 0;
          pendingFirstMessage = null;
          pendingSupplier = "";
          pendingPrice = "";
        };

        const rememberPendingStart = (chatMessage: ChatMessage) => {
          if (!pendingFirstMessage) pendingFirstMessage = chatMessage;
        };

        for (const chatMessage of messages) {
          const body = chatMessage.body.trim();
          if (!body || isDeletedOrSystem(body)) continue;

          const internalSku = selectedSenderSet.has(chatMessage.sender)
            ? extractInternalSku(body, skuPrefixes)
            : "";

          if (internalSku) {
            currentProduct = null;
            clearPendingBlock();
            skuEvents.push({
              messageIndex: chatMessage.index,
              timestamp: chatMessage.timestamp,
              sku: internalSku,
            });
            continue;
          }

          if (isSeparator(body)) {
            currentProduct = null;
            clearPendingBlock();
            continue;
          }

          const supplierPairs = extractSupplierPricePairs(body, supplierCodes);
          const supplierCode = findSupplierCode(body, supplierCodes);
          const multipleSupplierPrices = supplierPairs.length > 1;
          const supplierMarker = multipleSupplierPrices ? "" : supplierCode;
          const preferredSupplier =
            currentProduct?.supplier && currentProduct.supplier !== "UNASSIGNED"
              ? currentProduct.supplier
              : pendingSupplier || activeSupplier;
          const detectedPrice = extractPrice(
            body,
            preferredSupplier,
            supplierCodes,
          );
          const mediaMessage = isMediaMessage(body);

          if (mediaMessage) {
            mediaMessages += 1;
            const fileNameValue = extractMediaFileName(body);
            if (fileNameValue) exactMediaNames += 1;

            const mediaRef: MediaRef = {
              fileName: fileNameValue,
              omitted: !fileNameValue,
            };

            if (currentProduct) {
              currentProduct.mediaMessageCount += 1;
              currentProduct.mediaRefs.push(mediaRef);
            } else {
              rememberPendingStart(chatMessage);
              pendingMediaMessageCount += 1;
              pendingMediaRefs.push(mediaRef);
            }
            continue;
          }

          if (supplierMarker) {
            activeSupplier = supplierMarker;
            if (currentProduct) {
              currentProduct.supplier = supplierMarker;
            } else {
              rememberPendingStart(chatMessage);
              pendingSupplier = supplierMarker;
            }
          }

          if (looksLikeProductDescription(body)) {
            const blockStart = pendingFirstMessage || chatMessage;

            const product: ProductBlock = {
              id: `product-${productList.length + 1}-${blockStart.index}`,
              order: productList.length + 1,
              messageIndex: blockStart.index,
              dateText: blockStart.dateText,
              timeText: blockStart.timeText,
              timestamp: blockStart.timestamp,
              sender: chatMessage.sender || "Unknown",
              supplier:
                supplierMarker ||
                pendingSupplier ||
                (activeSupplier || "UNASSIGNED"),
              description: body,
              size: extractProductSize(body),
              price: detectedPrice || pendingPrice,
              fabric: extractFabric(body),
              mediaRefs: [...pendingMediaRefs],
              mediaMessageCount: pendingMediaMessageCount,
              linkedMediaCount: 0,
              sku: "",
              skuMessageIndex: null,
              confidence: "Unmapped",
              reviewed: false,
            };

            productList.push(product);
            currentProduct = product;
            clearPendingBlock();
            continue;
          }

          if (currentProduct) {
            if (detectedPrice) currentProduct.price = detectedPrice;

            if (!currentProduct.size) {
              const laterSize = extractProductSize(body);
              if (laterSize) currentProduct.size = laterSize;
            }

            if (!currentProduct.fabric) {
              const laterFabric = extractFabric(body);
              if (laterFabric) currentProduct.fabric = laterFabric;
            }

            // A separate short price message normally closes one product block.
            // This allows the next product's images to arrive before its description.
            if (detectedPrice && body.length <= 80) {
              currentProduct = null;
            }
            continue;
          }

          if (supplierMarker || detectedPrice) {
            rememberPendingStart(chatMessage);
            if (supplierMarker) pendingSupplier = supplierMarker;
            if (detectedPrice) pendingPrice = detectedPrice;
          }
        }

        const queue: ProductBlock[] = [];
        const events = [
          ...productList.map((product) => ({
            type: "product" as const,
            messageIndex: product.messageIndex,
            timestamp: product.timestamp,
            product,
          })),
          ...skuEvents.map((skuEvent) => ({
            type: "sku" as const,
            ...skuEvent,
          })),
        ].sort((a, b) => a.messageIndex - b.messageIndex);

        for (const event of events) {
          if (event.type === "product") {
            queue.push(event.product);
            continue;
          }

          while (queue.length > 0) {
            const candidate = queue[0];
            const productTime = candidate.timestamp;
            const skuTime = event.timestamp;
            const gap =
              productTime !== null && skuTime !== null
                ? skuTime - productTime
                : null;

            if (gap !== null && gap > 72 * 60 * 60 * 1000) {
              queue.shift();
              candidate.confidence = "Needs Review";
              continue;
            }

            break;
          }

          const candidate = queue.shift();
          if (!candidate) continue;

          candidate.sku = event.sku;
          candidate.skuMessageIndex = event.messageIndex;

          const gap =
            candidate.timestamp !== null && event.timestamp !== null
              ? event.timestamp - candidate.timestamp
              : null;

          if (gap !== null && gap >= 0 && gap <= 8 * 60 * 60 * 1000) {
            candidate.confidence = "High";
          } else if (
            gap !== null &&
            gap >= 0 &&
            gap <= 36 * 60 * 60 * 1000
          ) {
            candidate.confidence = "Medium";
          } else {
            candidate.confidence = "Needs Review";
          }
        }

        const mediaMap = mediaFilesRef.current;
        for (const product of productList) {
          product.linkedMediaCount = product.mediaRefs.filter(
            (media) =>
              media.fileName &&
              mediaMap.has(media.fileName.toLowerCase()),
          ).length;
        }

        const mapped = productList.filter((product) => product.sku).length;
        const review = productList.filter(
          (product) =>
            product.confidence === "Needs Review" || !product.sku,
        ).length;

        setProducts(productList);
        setOpenProductDetails({});
        setOpenProductDescriptions({});
        setSummary({
          messages: messages.length,
          products: productList.length,
          skuMessages: skuEvents.length,
          mapped,
          review,
          mediaMessages,
          exactMediaNames,
        });

        if (fileName) {
          const storageKey = getStartAfterSkuStorageKey(fileName);
          if (normalizedStartAfterSku) {
            window.localStorage.setItem(storageKey, normalizedStartAfterSku);
            setStartAfterSku(normalizedStartAfterSku);
          } else {
            window.localStorage.removeItem(storageKey);
          }
        }

        const skuMarkerNote = normalizedStartAfterSku
          ? ` ${ignoredBySku.toLocaleString()} message(s) ${normalizedStartAfterSku} tak skip hue.`
          : "";
        const dateNote =
          startTimestamp === null
            ? ""
            : ` ${ignoredByDate.toLocaleString()} additional message(s) date filter se ignore hue.`;

        setMessage(
          `${mapped.toLocaleString()} product(s) SKU ke saath sequence-map hue.${skuMarkerNote}${dateNote} Sirf selected filters ke baad wali chat analyze hui.`,
        );
      } catch (parseError) {
        setError(
          parseError instanceof Error
            ? parseError.message
            : "Chat analysis failed.",
        );
      } finally {
        setAnalyzing(false);
      }
    }, 30);
  }

  async function handleSelectMediaFolder() {
    if (loadingMedia) return;

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      mediaFolderInputRef.current?.click();
      return;
    }

    setLoadingMedia(true);
    setError("");
    setMessage("");

    try {
      const directory = await picker.call(window, { mode: "read" });
      const fileMap = new Map<string, File>();
      await collectFilesFromDirectory(directory, fileMap);
      mediaFilesRef.current = fileMap;
      setMediaFilesCount(fileMap.size);

      setProducts((current) =>
        current.map((product) => ({
          ...product,
          linkedMediaCount: product.mediaRefs.filter(
            (media) =>
              media.fileName &&
              fileMap.has(media.fileName.toLowerCase()),
          ).length,
        })),
      );

      setMessage(
        `${fileMap.size.toLocaleString()} media file(s) loaded. Filename available honay wali chat media exact match ho gayi.`,
      );
    } catch (folderError) {
      const cancelled =
        folderError instanceof DOMException && folderError.name === "AbortError";
      if (!cancelled) {
        setError(
          folderError instanceof Error
            ? folderError.message
            : "Media folder could not be read.",
        );
      }
    } finally {
      setLoadingMedia(false);
    }
  }

  function handleFallbackMediaFolder(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files || []) as File[];
    event.target.value = "";
    const fileMap = new Map<string, File>();

    for (const file of files) {
      if (!MEDIA_EXTENSIONS.test(file.name)) continue;
      fileMap.set(file.name.toLowerCase(), file);
    }

    mediaFilesRef.current = fileMap;
    setMediaFilesCount(fileMap.size);
    setProducts((current) =>
      current.map((product) => ({
        ...product,
        linkedMediaCount: product.mediaRefs.filter(
          (media) =>
            media.fileName &&
            fileMap.has(media.fileName.toLowerCase()),
        ).length,
      })),
    );
  }

  function updateProduct(id: string, patch: Partial<ProductBlock>) {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, ...patch } : product,
      ),
    );
  }

  function recalculateSummary() {
    const mapped = products.filter((product) => product.sku).length;
    const review = products.filter(
      (product) =>
        product.confidence === "Needs Review" || !product.sku,
    ).length;

    setSummary((current) => ({ ...current, mapped, review }));
  }

  async function copySkuReply(product: ProductBlock) {
    if (!product.sku) return;
    await navigator.clipboard.writeText(`SKU: ${product.sku}`);
    setMessage(`Copied: SKU: ${product.sku}`);
  }

  function exportExcel() {
    if (products.length === 0) return;

    const rows = products.map((product) => [
      product.sku ?? "",
      product.price ?? "",
      product.size ?? "",
      normalizeFabric(product.fabric ?? ""),
    ]);

    const headerCells = ["SKU", "Price", "Size", "Fabric"]
      .map(
        (value) =>
          `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`,
      )
      .join("");

    const dataRows = rows
      .map((row) => {
        const cells = row
          .map((value, columnIndex) => {
            const isNumericPrice =
              columnIndex === 1 &&
              String(value).trim() !== "" &&
              Number.isFinite(Number(value));
            const type = isNumericPrice ? "Number" : "String";
            return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
          })
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");

    const excelXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Products">
  <Table>
   <Column ss:Width="110"/>
   <Column ss:Width="75"/>
   <Column ss:Width="110"/>
   <Column ss:Width="150"/>
   <Row ss:Height="24">${headerCells}</Row>
   ${dataRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    downloadBlob(
      new Blob(["\uFEFF", excelXml], {
        type: "application/vnd.ms-excel;charset=utf-8",
      }),
      "whatsapp-products-sku-price-size-fabric.xls",
    );
  }

  async function saveOrganizedMedia() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError("Organized folder saving requires Chrome or Microsoft Edge.");
      return;
    }

    if (mediaFilesRef.current.size === 0) {
      setError("Pehle Select Media Folder se extracted WhatsApp media load karein.");
      return;
    }

    const eligible = products.filter(
      (product) => product.sku && product.linkedMediaCount > 0,
    );

    if (eligible.length === 0) {
      setError("Exact filename-linked media ke saath koi mapped SKU nahi mila.");
      return;
    }

    setSavingMedia(true);
    setError("");
    setMessage("");

    try {
      const root = await picker.call(window, { mode: "readwrite" });
      let completed = 0;

      for (const product of eligible) {
        const supplierDirectory = await root.getDirectoryHandle(
          sanitizeFolderName(product.supplier),
          { create: true },
        );
        const skuDirectory = await supplierDirectory.getDirectoryHandle(
          sanitizeFolderName(product.sku),
          { create: true },
        );

        for (const media of product.mediaRefs) {
          if (!media.fileName) continue;
          const file = mediaFilesRef.current.get(media.fileName.toLowerCase());
          if (!file) continue;

          const fileHandle = await skuDirectory.getFileHandle(
            sanitizeFolderName(file.name),
            { create: true },
          );
          const writable = await fileHandle.createWritable();
          await writable.write(file);
          await writable.close();
        }

        const detailsHandle = await skuDirectory.getFileHandle(
          "description.txt",
          { create: true },
        );
        const detailsWritable = await detailsHandle.createWritable();
        await detailsWritable.write(
          [
            `Supplier: ${product.supplier}`,
            `SKU: ${product.sku}`,
            `Size: ${product.size}`,
            `Price: ${product.price}`,
            `Fabric: ${normalizeFabric(product.fabric ?? "")}`,
            `Date: ${product.dateText} ${product.timeText}`,
            "",
            product.description,
          ].join("\r\n"),
        );
        await detailsWritable.close();

        completed += 1;
        setSaveProgress(`${completed} / ${eligible.length}`);
      }

      setMessage(
        `${completed} SKU folder(s) supplier-wise save ho gaye. Omitted media without filename exact link nahi ho sakti.`,
      );
    } catch (saveError) {
      const cancelled =
        saveError instanceof DOMException && saveError.name === "AbortError";
      if (!cancelled) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Organized media save failed.",
        );
      }
    } finally {
      setSavingMedia(false);
      setSaveProgress("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black text-emerald-700">
            WhatsApp Supplier Import
          </p>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Chat History, SKU Mapping & Media Organizer
          </h1>
          <p className="mt-2 max-w-4xl text-sm font-bold text-slate-500">
            WhatsApp export TXT locally parse hoti hai. Start date ke baad wali
            chat use hoti hai, description se pehle/baad ki media product block mein
            include hoti hai, aur SKU replies sequence ke mutabiq map hote hain.
            Data browser se server par upload nahi hota.
          </p>
        </div>

        <button
          type="button"
          onClick={exportExcel}
          disabled={products.length === 0}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={18} />
          {products.length === 0
            ? "Excel Available After Analyze"
            : "Download Excel (.xls)"}
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">
                1. Load Chat Export
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Export Chat ki .txt file select karein. 1GB media ZIP upload karna
                zaroori nahi.
              </p>
            </div>

            <button
              type="button"
              onClick={() => textInputRef.current?.click()}
              disabled={loadingText}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
            >
              {loadingText ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Upload size={17} />
              )}
              {loadingText ? "Reading..." : "Select Chat TXT"}
            </button>

            <input
              ref={textInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={handleTextFile}
            />
          </div>

          {fileName && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <FileText size={20} className="text-emerald-700" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">
                  {fileName}
                </p>
                <p className="text-xs font-bold text-slate-500">
                  {(rawText.length / 1024 / 1024).toFixed(1)} MB loaded locally
                </p>
              </div>
            </div>
          )}

          {senderStats.length > 0 && (
            <div className="mt-6">
              <h3 className="font-black text-slate-950">
                Apne SKU Reply Senders Select Karein
              </h3>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Sirf un WhatsApp names ko select karein jin accounts se aap SKU
                replies bhejte thay. Currency messages SKU nahi samjhe jayenge.
              </p>

              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
                {senderStats.map((sender) => (
                  <label
                    key={sender.name}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedMySenders.includes(sender.name)}
                        onChange={() => toggleMySender(sender.name)}
                        className="h-4 w-4"
                      />
                      <span className="font-black text-slate-800">
                        {sender.name}
                      </span>
                    </span>
                    <span className="text-xs font-bold text-slate-500">
                      {sender.messageCount.toLocaleString()} msgs · {sender.skuLikeCount.toLocaleString()} SKU-like
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">
            2. Detection Rules
          </h2>

          <label className="mt-4 block">
            <span className="text-xs font-black uppercase text-slate-500">
              Start After SKU
            </span>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={startAfterSku}
                onChange={(event) => setStartAfterSku(event.target.value.toUpperCase())}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-300 px-3 text-sm font-black uppercase outline-none focus:border-emerald-500"
                placeholder="Example: HRT1234"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={clearStartAfterSku}
                disabled={!startAfterSku && !fileName}
                className="rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
            <span className="mt-2 block text-xs font-bold text-slate-500">
              Entered SKU ki latest exact occurrence aur us se pehle ki tamam chat
              skip hogi. Analysis us SKU ke next message se start hogi. Successful
              analysis ke baad marker isi chat filename ke liye browser mein save
              rahega.
            </span>
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-black uppercase text-slate-500">
              Use Chat From Date
            </span>
            <input
              type="date"
              value={chatStartDate}
              onChange={(event) => setChatStartDate(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
            />
            <span className="mt-2 block text-xs font-bold text-slate-500">
              Selected date inclusive hai. Is date se purani descriptions, media
              aur SKU replies analysis mein use nahi honge. Blank chhorne par
              complete chat analyze hogi.
            </span>
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-black uppercase text-slate-500">
              Supplier Codes
            </span>
            <textarea
              value={supplierCodesText}
              onChange={(event) => setSupplierCodesText(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-2xl border border-slate-300 p-3 text-sm font-bold outline-none focus:border-emerald-500"
              placeholder="HRT, FFT, SML, SRK"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-black uppercase text-slate-500">
              Internal SKU Prefixes
            </span>
            <textarea
              value={skuPrefixesText}
              onChange={(event) => setSkuPrefixesText(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-2xl border border-slate-300 p-3 text-sm font-bold outline-none focus:border-emerald-500"
              placeholder="PMM, HRT, FFT, UMZ"
            />
          </label>

          <button
            type="button"
            onClick={analyzeChat}
            disabled={!rawText || selectedMySenders.length === 0 || analyzing}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {analyzing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <RefreshCw size={18} />
            )}
            {analyzing ? "Analyzing Large Chat..." : "Analyze Chat"}
          </button>
        </section>
      </div>

      {(message || error) && (
        <div
          className={[
            "rounded-2xl border p-4 text-sm font-black",
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          ].join(" ")}
        >
          {error || message}
        </div>
      )}

      {summary.messages > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["Messages", summary.messages],
            ["Products", summary.products],
            ["SKU Replies", summary.skuMessages],
            ["Mapped", summary.mapped],
            ["Needs Review", summary.review],
            ["Media Markers", summary.mediaMessages],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-black uppercase text-slate-400">
                {label}
              </p>
              <p className="mt-1 text-2xl font-black text-slate-950">
                {Number(value).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {products.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">
                3. Product Mapping Review
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Export TXT reply-link preserve nahi karta, is liye mapping FIFO
                sequence se hoti hai. Product Details ko collapse kar sakte hain;
                Reviewed tick karne par details automatically close ho jati hain.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllProductSections(true)}
                disabled={filteredProducts.length === 0}
                title="Open Product Details and Product Description for all visible products"
                className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Expand All
              </button>

              <button
                type="button"
                onClick={() => setAllProductSections(false)}
                disabled={filteredProducts.length === 0}
                title="Close Product Details and Product Description for all visible products"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Collapse All
              </button>

              <button
                type="button"
                onClick={handleSelectMediaFolder}
                disabled={loadingMedia}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
              >
                {loadingMedia ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <FolderOpen size={16} />
                )}
                {loadingMedia
                  ? "Reading Media..."
                  : mediaFilesCount > 0
                    ? `Media Loaded (${mediaFilesCount.toLocaleString()})`
                    : "Select Media Folder"}
              </button>

              <input
                ref={mediaFolderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFallbackMediaFolder}
                {...({
                  webkitdirectory: "",
                  directory: "",
                } as {
                  webkitdirectory: string;
                  directory: string;
                })}
              />

              <button
                type="button"
                onClick={saveOrganizedMedia}
                disabled={savingMedia || mediaFilesCount === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
              >
                {savingMedia ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Images size={16} />
                )}
                {savingMedia
                  ? `Saving ${saveProgress}`
                  : "Save Supplier/SKU Folders"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <label className="relative block">
              <Search
                size={17}
                className="absolute left-3 top-3.5 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SKU, supplier or description"
                className="h-11 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-500"
              />
            </label>

            <select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
            >
              <option value="">All Statuses</option>
              {(["High", "Medium", "Needs Review", "Manual", "Unmapped"] as MappingConfidence[]).map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="mt-5 space-y-4">
            {filteredProducts.map((product) => (
              <article
                key={product.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                        #{product.order}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${confidenceClass(product.confidence)}`}
                      >
                        {product.confidence}
                      </span>
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">
                        {product.supplier}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-500">
                      {product.dateText} {product.timeText} · {product.sender}
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-black text-slate-600">
                    <input
                      type="checkbox"
                      checked={product.reviewed}
                      onChange={(event) => {
                        const reviewed = event.target.checked;
                        updateProduct(product.id, { reviewed });
                        setOpenProductDetails((current) => ({
                          ...current,
                          [product.id]: !reviewed,
                        }));
                      }}
                    />
                    Reviewed
                  </label>
                </div>

                <details
                  open={openProductDetails[product.id] ?? !product.reviewed}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenProductDetails((current) =>
                      current[product.id] === isOpen
                        ? current
                        : { ...current, [product.id]: isOpen },
                    );
                  }}
                  className="mt-4 rounded-2xl border border-slate-200 bg-white"
                >
                  <summary className="cursor-pointer select-none px-4 py-3 text-sm font-black text-slate-800">
                    Product Details
                    <span className="ml-2 text-xs font-bold text-slate-400">
                      {product.reviewed ? "Finalized · click to show" : "click to hide"}
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 px-4 pb-4">
                <div className="mt-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-5">
                  <label>
                    <span className="text-[11px] font-black uppercase text-slate-400">
                      Supplier
                    </span>
                    <input
                      value={product.supplier}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          supplier: event.target.value.toUpperCase(),
                          confidence: "Manual",
                        })
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-black outline-none focus:border-emerald-500"
                    />
                  </label>

                  <label>
                    <span className="text-[11px] font-black uppercase text-slate-400">
                      Assigned SKU
                    </span>
                    <input
                      value={product.sku}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          sku: event.target.value.toUpperCase().trim(),
                          confidence: "Manual",
                        })
                      }
                      onBlur={recalculateSummary}
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-black outline-none focus:border-emerald-500"
                      placeholder="HRT1234"
                    />
                  </label>

                  <label>
                    <span className="text-[11px] font-black uppercase text-slate-400">
                      Size
                    </span>
                    <input
                      value={product.size ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          size: event.target.value,
                        })
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
                      placeholder="XXL (44) / Up to 44"
                    />
                  </label>

                  <label>
                    <span className="text-[11px] font-black uppercase text-slate-400">
                      Price
                    </span>
                    <input
                      value={product.price ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          price: event.target.value,
                        })
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
                    />
                  </label>

                  <label>
                    <span className="text-[11px] font-black uppercase text-slate-400">
                      Fabric
                    </span>
                    <input
                      value={product.fabric ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          fabric: event.target.value,
                        })
                      }
                      onBlur={(event) =>
                        updateProduct(product.id, {
                          fabric: normalizeFabric(event.target.value),
                        })
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-emerald-500"
                      placeholder="Crape Silk"
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                    Media markers: {product.mediaMessageCount}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                    Exact files linked: {product.linkedMediaCount}
                  </span>
                  <span className="rounded-full bg-slate-50 px-3 py-1 text-slate-600">
                    Omitted without filename: {product.mediaRefs.filter((item) => item.omitted).length}
                  </span>
                </div>

                  </div>
                </details>

                <details
                  open={openProductDescriptions[product.id] ?? false}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenProductDescriptions((current) =>
                      current[product.id] === isOpen
                        ? current
                        : { ...current, [product.id]: isOpen },
                    );
                  }}
                  className="mt-3 rounded-xl bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer text-sm font-black text-slate-800">
                    Product Description
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs font-bold leading-6 text-slate-700">
                    {product.description}
                  </pre>
                </details>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!product.sku}
                    onClick={() => void copySkuReply(product)}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
                  >
                    <Clipboard size={15} />
                    Copy SKU Reply
                  </button>

                  {product.confidence === "Needs Review" || !product.sku ? (
                    <span className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-800">
                      <AlertTriangle size={15} />
                      Manual verification required
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-800">
                      <CheckCircle2 size={15} />
                      Sequence mapping available
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
