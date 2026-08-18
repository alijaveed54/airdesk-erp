import type { GreenApiHistoryMessage } from "@/lib/green-api";

export type TimelineMappingConfidence =
  | "High"
  | "Medium"
  | "Needs Review"
  | "Manual"
  | "Unmapped";

export type TimelineMedia = {
  idMessage: string;
  url: string;
  caption: string;
  fileName: string;
  mimeType: string;
  typeMessage: string;
  thumbnail: string;
};

export type TimelineProduct = {
  id: string;
  order: number;
  messageIndex: number;
  descriptionMessageId: string;
  timestamp: number | null;
  sender: string;
  supplier: string;
  description: string;
  size: string;
  price: string;
  fabric: string;
  media: TimelineMedia[];
  mediaMessageCount: number;
  sku: string;
  skuMessageId: string;
  confidence: TimelineMappingConfidence;
  replied: boolean;
};

export type TimelineParseSummary = {
  messages: number;
  products: number;
  skuMessages: number;
  mapped: number;
  pending: number;
  review: number;
  mediaMessages: number;
};

export type TimelineParseResult = {
  products: TimelineProduct[];
  summary: TimelineParseSummary;
};

type TimelineMessage = {
  index: number;
  idMessage: string;
  timestamp: number | null;
  sender: string;
  senderId: string;
  direction: string;
  body: string;
  quotedMessageId: string;
  media: TimelineMedia | null;
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

const AUTHORIZED_SKU_SENDER_PHONES = new Set([
  "923097979959",
  "923444446544",
]);

function normalizePhoneIdentity(value: unknown) {
  const raw = String(value || "").trim().replace(/@.*$/i, "");
  const digits = raw.replace(/\D+/g, "");

  if (digits.startsWith("0092") && digits.length >= 14) {
    return digits.slice(2);
  }

  if (digits.startsWith("03") && digits.length === 11) {
    return `92${digits.slice(1)}`;
  }

  return digits;
}

function isAuthorizedSkuSender(message: TimelineMessage) {
  // GetChatHistory does not provide senderId for outgoing messages.
  // Account 2 outgoing SKU replies therefore remain valid SKU anchors.
  if (message.direction === "outgoing") return true;

  const senderIdPhone = normalizePhoneIdentity(message.senderId);
  const senderLabelPhone = normalizePhoneIdentity(message.sender);

  if (AUTHORIZED_SKU_SENDER_PHONES.has(senderIdPhone)) return true;
  if (AUTHORIZED_SKU_SENDER_PHONES.has(senderLabelPhone)) return true;

  return false;
}

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

function messageBody(message: GreenApiHistoryMessage) {
  if (typeof message.textMessage === "string" && message.textMessage.trim()) {
    return message.textMessage.trim();
  }
  if (
    message.extendedTextMessage &&
    typeof message.extendedTextMessage.text === "string" &&
    message.extendedTextMessage.text.trim()
  ) {
    return message.extendedTextMessage.text.trim();
  }
  if (typeof message.caption === "string" && message.caption.trim()) {
    return message.caption.trim();
  }
  return "";
}

function quotedMessageId(message: GreenApiHistoryMessage) {
  return String(
    message.extendedTextMessage?.stanzaId ||
      message.quotedMessage?.stanzaId ||
      "",
  ).trim();
}

function normalizeHistory(history: GreenApiHistoryMessage[]): TimelineMessage[] {
  return [...history]
    .filter((message) => String(message.idMessage || "").trim())
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .map((message, index) => {
      const typeMessage = String(message.typeMessage || "");
      const url = String(message.downloadUrl || "").trim();
      const isMedia = [
        "imageMessage",
        "videoMessage",
        "documentMessage",
        "audioMessage",
        "stickerMessage",
      ].includes(typeMessage);
      const idMessage = String(message.idMessage || "").trim();
      const media: TimelineMedia | null = isMedia
        ? {
            idMessage,
            url,
            caption: String(message.caption || "").trim(),
            fileName: String(message.fileName || "").trim(),
            mimeType: String(message.mimeType || "").trim(),
            typeMessage,
            thumbnail: String(message.jpegThumbnail || "").trim(),
          }
        : null;

      return {
        index,
        idMessage,
        timestamp:
          Number.isFinite(Number(message.timestamp)) && Number(message.timestamp) > 0
            ? Number(message.timestamp) * 1000
            : null,
        sender: String(
          message.senderName ||
            message.senderContactName ||
            message.senderId ||
            (message.type === "outgoing" ? "You / API" : "Unknown"),
        ).trim(),
        senderId: String(message.senderId || "").trim(),
        direction: String(message.type || ""),
        body: messageBody(message),
        quotedMessageId: quotedMessageId(message),
        media,
      };
    });
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
  if (isDeletedOrSystem(normalized)) return false;

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

function normalizePriceNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return "";
  return String(parsed);
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

export function normalizeTimelineFabric(value: string) {
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
  return normalizeTimelineFabric(beforeWork);
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

function extractReplySku(body: string) {
  const cleaned = body
    .trim()
    .replace(/^[*_`~]+|[*_`~]+$/g, "")
    .replace(/^sku\s*[:#\-]?\s*/i, "")
    .replace(/\s+old\s+sku.*$/i, "")
    .trim();

  if (!cleaned || cleaned.length > 60) return "";
  if (/^(AED|QAR|MUR|INR|RS|PKR)\b/i.test(cleaned)) return "";

  const compact = cleaned.toUpperCase().replace(/\s+/g, "");

  // Timelines rule: the authorized user's reply itself is the SKU.
  // Do not depend on a hardcoded prefix whitelist. A valid SKU starts
  // with letters (supplier prefix) and then contains its numeric part.
  if (/^[A-Z]{1,10}[-_]*[0-9]{2,10}[A-Z0-9_-]*$/.test(compact)) {
    return compact;
  }

  return "";
}

function supplierFromSku(sku: string) {
  const compact = String(sku || "")
    .trim()
    .toUpperCase()
    .replace(/^SKU\s*[:#\-]?\s*/i, "")
    .replace(/\s+/g, "");

  const match = compact.match(/^([A-Z]{1,10})(?=[-_]*[0-9])/);
  return match ? match[1] : "";
}

function normalizeSkuMarker(value: string) {
  return String(value || "")
    .trim()
    .replace(/^sku\s*[:#\-]?\s*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function hasExactSkuMarker(message: TimelineMessage, marker: string) {
  if (!marker) return false;

  if (normalizeSkuMarker(message.body) === marker) return true;

  return message.body
    .split(/\r?\n/)
    .some((line) => normalizeSkuMarker(line) === marker);
}

export function parseTimelineHistory(
  history: GreenApiHistoryMessage[],
  options?: {
    supplierCodes?: string[];
    skuPrefixes?: string[];
    startAfterSku?: string;
  },
): TimelineParseResult {
  const supplierCodes = options?.supplierCodes?.length
    ? options.supplierCodes.map((item) => item.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SUPPLIER_CODES;
  // skuPrefixes remains accepted in options for backward compatibility,
  // but Timelines SKU detection now follows the authorized reply itself.
  void options?.skuPrefixes;
  const allMessages = normalizeHistory(history);
  const startAfterSku = normalizeSkuMarker(options?.startAfterSku || "");
  let messages = allMessages;

  if (startAfterSku) {
    let markerIndex = -1;

    // Preserve the original Supplier Import rule: latest exact occurrence wins.
    // Start After SKU is only a history boundary; it must not depend on sender
    // identification, otherwise valid history can be accidentally truncated.
    for (const message of allMessages) {
      if (hasExactSkuMarker(message, startAfterSku)) {
        markerIndex = message.index;
      }
    }

    if (markerIndex < 0) {
      throw new Error(
        `Start After SKU "${startAfterSku}" GREEN-API se mile ${allMessages.length.toLocaleString()} recent message(s) mein nahi mila. Agar SKU group mein purana hai to GREEN-API history/settings ki wajah se unavailable ho sakta hai.`,
      );
    }

    messages = allMessages.filter((message) => message.index > markerIndex);
  }

  const productList: TimelineProduct[] = [];
  const skuEvents: Array<{
    messageIndex: number;
    timestamp: number | null;
    sku: string;
    messageId: string;
    quotedMessageId: string;
  }> = [];

  let activeSupplier = "UNASSIGNED";
  let currentProduct: TimelineProduct | null = null;
  let pendingMedia: TimelineMedia[] = [];
  let pendingMediaMessageCount = 0;
  let pendingFirstMessage: TimelineMessage | null = null;
  let pendingSupplier = "";
  let pendingPrice = "";
  let mediaMessages = 0;

  const clearPendingBlock = () => {
    pendingMedia = [];
    pendingMediaMessageCount = 0;
    pendingFirstMessage = null;
    pendingSupplier = "";
    pendingPrice = "";
  };

  const rememberPendingStart = (message: TimelineMessage) => {
    if (!pendingFirstMessage) pendingFirstMessage = message;
  };

  for (const chatMessage of messages) {
    const body = chatMessage.body.trim();
    const authorizedSku = isAuthorizedSkuSender(chatMessage)
      ? extractReplySku(body)
      : "";

    if (authorizedSku) {
      currentProduct = null;
      clearPendingBlock();
      skuEvents.push({
        messageIndex: chatMessage.index,
        timestamp: chatMessage.timestamp,
        sku: authorizedSku,
        messageId: chatMessage.idMessage,
        quotedMessageId: chatMessage.quotedMessageId,
      });
      continue;
    }

    if (chatMessage.media) {
      mediaMessages += 1;
      if (currentProduct) {
        currentProduct.mediaMessageCount += 1;
        currentProduct.media.push(chatMessage.media);
      } else {
        rememberPendingStart(chatMessage);
        pendingMediaMessageCount += 1;
        pendingMedia.push(chatMessage.media);
      }

      // A caption can itself be the description.
      if (!body || !looksLikeProductDescription(body)) {
        continue;
      }
    }

    if (!body || isDeletedOrSystem(body)) continue;

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
    const detectedPrice = extractPrice(body, preferredSupplier, supplierCodes);

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
      const product: TimelineProduct = {
        id: `timeline-${productList.length + 1}-${chatMessage.idMessage}`,
        order: productList.length + 1,
        messageIndex: blockStart.index,
        descriptionMessageId: chatMessage.idMessage,
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
        media: [...pendingMedia],
        mediaMessageCount: pendingMediaMessageCount,
        sku: "",
        skuMessageId: "",
        confidence: "Unmapped",
        replied: false,
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

  const productByQuotedMessageId = new Map<string, TimelineProduct>();

  for (const product of productList) {
    if (product.descriptionMessageId) {
      productByQuotedMessageId.set(product.descriptionMessageId, product);
    }

    // SKU replies are often sent by replying to a product image instead of
    // the description text. Treat every linked media message as an exact
    // product anchor as well.
    for (const media of product.media) {
      if (media.idMessage) {
        productByQuotedMessageId.set(media.idMessage, product);
      }
    }
  }

  const consumedSkuEvents = new Set<string>();

  // First preference: exact WhatsApp quoted reply relation.
  for (const event of skuEvents) {
    if (!event.quotedMessageId) continue;
    const product = productByQuotedMessageId.get(event.quotedMessageId);
    if (!product) continue;

    product.sku = event.sku;
    product.supplier = supplierFromSku(event.sku) || product.supplier;
    product.skuMessageId = event.messageId;
    product.confidence = "High";
    product.replied = true;
    consumedSkuEvents.add(event.messageId);
  }

  // Fallback to the old Supplier Import FIFO logic for historic unquoted SKU replies.
  const queue = productList.filter((product) => !product.sku);
  const fallbackEvents = skuEvents
    .filter((event) => !consumedSkuEvents.has(event.messageId))
    .sort((a, b) => a.messageIndex - b.messageIndex);

  for (const event of fallbackEvents) {
    while (queue.length > 0) {
      const candidate = queue[0];
      if (candidate.messageIndex >= event.messageIndex) {
        break;
      }

      const gap =
        candidate.timestamp !== null && event.timestamp !== null
          ? event.timestamp - candidate.timestamp
          : null;

      if (gap !== null && gap > 72 * 60 * 60 * 1000) {
        queue.shift();
        candidate.confidence = "Needs Review";
        continue;
      }

      break;
    }

    const candidate = queue[0];
    if (!candidate || candidate.messageIndex >= event.messageIndex) continue;
    queue.shift();

    candidate.sku = event.sku;
    candidate.supplier = supplierFromSku(event.sku) || candidate.supplier;
    candidate.skuMessageId = event.messageId;
    candidate.replied = true;

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

  const mapped = productList.filter((product) => product.sku).length;
  const pending = productList.filter((product) => !product.replied).length;
  const review = productList.filter(
    (product) => product.confidence === "Needs Review" || !product.sku,
  ).length;

  return {
    products: productList,
    summary: {
      messages: messages.length,
      products: productList.length,
      skuMessages: skuEvents.length,
      mapped,
      pending,
      review,
      mediaMessages,
    },
  };
}

