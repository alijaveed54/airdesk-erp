// TFM_PUBLIC_TRACKING_FALLBACK_V1
// Public, unauthenticated TFM tracker fallback used only when the authenticated
// TFM tracking API fails or returns no readable status.

export type TfmPublicTrackResult = {
  awbNumber: string;
  status: string;
  lastActionDate: string;
  location: string;
  expectedDelivery: string;
  codReleased: boolean;
  codReleasedAt: string;
  sourceUrl: string;
  raw: unknown;
};

type PublicFetchResult = {
  response: Response;
  text: string;
  data: unknown;
  url: string;
  cookies: string;
};

type HtmlFormInput = {
  name: string;
  id: string;
  type: string;
  value: string;
  placeholder: string;
  ariaLabel: string;
};

type HtmlForm = {
  action: string;
  method: string;
  inputs: HtmlFormInput[];
};

const DEFAULT_PUBLIC_URL =
  "https://customer.tfmex.com/Skybill/TrackSkybill";
const DEFAULT_SECONDARY_URL =
  "https://customer.tfmex.com/SkyBill/Track";

const STATUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bout\s+for\s+delivery\b/i, label: "Out for Delivery" },
  { pattern: /\bdelivered\b/i, label: "Delivered" },
  {
    pattern: /\b(return(?:ed)?\s+to\s+shipper|returned|rto)\b/i,
    label: "Returned",
  },
  { pattern: /\b(cancelled|canceled|void(?:ed)?)\b/i, label: "Cancelled" },
  { pattern: /\bchecked\s*-?\s*in\b/i, label: "Checked In" },
  { pattern: /\bpicked\s*-?\s*up\b/i, label: "Picked Up" },
  { pattern: /\bcollected\b/i, label: "Collected" },
  {
    pattern: /\breceived\s+(?:at|in)\s+(?:the\s+)?hub\b/i,
    label: "Received at Hub",
  },
  { pattern: /\bin\s+transit\b/i, label: "In Transit" },
  { pattern: /\bdispatched\b/i, label: "Dispatched" },
  { pattern: /\bshipped\b/i, label: "Shipped" },
  { pattern: /\bmanifest(?:ed)?\b/i, label: "Manifested" },
  {
    pattern: /\bshipment\s+(?:created|booked|registered)\b/i,
    label: "Shipment Created",
  },
  { pattern: /\bdelivery\s+failed\b/i, label: "Delivery Failed" },
  { pattern: /\bon\s+hold\b/i, label: "On Hold" },
];

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?\b/,
  /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\b/i,
  /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\b/i,
  /\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\b/i,
];

function isPublicFallbackEnabled() {
  return String(process.env.TFM_PUBLIC_TRACKING_ENABLED ?? "true")
    .trim()
    .toLowerCase() !== "false";
}

function getTimeoutMs() {
  const configured = Number(process.env.TFM_PUBLIC_TRACKING_TIMEOUT_MS || 12000);
  if (!Number.isFinite(configured)) return 12000;
  return Math.min(30000, Math.max(3000, configured));
}

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/\s+/g, " ")
    .slice(0, 800);
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
  };

  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code) || 32),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(parseInt(code, 16) || 32),
    )
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function htmlToText(html: string) {
  return decodeHtml(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<\/(?:td|th)>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function parseAttributes(tag: string) {
  const result: Record<string, string> = {};
  const attributePattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(tag))) {
    const key = String(match[1] || "").trim().toLowerCase();
    if (!key || key === "input" || key === "form" || key === "button") continue;
    result[key] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return result;
}

function extractForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;

  while ((formMatch = formPattern.exec(html))) {
    const attrs = parseAttributes(formMatch[1] || "");
    const body = formMatch[2] || "";
    const inputs: HtmlFormInput[] = [];
    const inputPattern = /<input\b([^>]*)>/gi;
    let inputMatch: RegExpExecArray | null;

    while ((inputMatch = inputPattern.exec(body))) {
      const inputAttrs = parseAttributes(inputMatch[1] || "");
      inputs.push({
        name: inputAttrs.name || "",
        id: inputAttrs.id || "",
        type: (inputAttrs.type || "text").toLowerCase(),
        value: inputAttrs.value || "",
        placeholder: inputAttrs.placeholder || "",
        ariaLabel: inputAttrs["aria-label"] || "",
      });
    }

    forms.push({
      action: attrs.action || "",
      method: (attrs.method || "GET").toUpperCase(),
      inputs,
    });
  }

  return forms;
}

function awbInputScore(input: HtmlFormInput) {
  if (!input.name && !input.id) return -100;
  if (["hidden", "submit", "button", "checkbox", "radio"].includes(input.type)) {
    return -100;
  }

  const haystack = [
    input.name,
    input.id,
    input.placeholder,
    input.ariaLabel,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (haystack.includes("awb")) score += 100;
  if (haystack.includes("sky") && haystack.includes("bill")) score += 80;
  if (haystack.includes("waybill")) score += 70;
  if (haystack.includes("tracking")) score += 50;
  if (haystack.includes("shipment")) score += 20;
  if (haystack.includes("ref")) score -= 80;
  return score;
}

function cookieHeader(response: Response) {
  const extended = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = extended.getSetCookie?.() || [];
  const raw = values.length ? values : [response.headers.get("set-cookie") || ""];

  return raw
    .flatMap((value) => String(value || "").split(/,(?=[^;,]+=)/g))
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchPublic(
  url: string,
  init: RequestInit = {},
  existingCookies = "",
): Promise<PublicFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const headers = new Headers(init.headers || {});
    headers.set(
      "Accept",
      "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    );
    headers.set("Accept-Language", "en-US,en;q=0.9");
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (compatible; MysmarERP/1.0; +https://tfmex.com/)",
    );
    if (existingCookies) headers.set("Cookie", existingCookies);

    const response = await globalThis.fetch(url, {
      ...init,
      headers,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = text;

    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw new Error(`Public TFM tracker HTTP ${response.status}`);
    }

    return {
      response,
      text,
      data,
      url: response.url || url,
      cookies: [existingCookies, cookieHeader(response)].filter(Boolean).join("; "),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Public TFM tracker timed out after ${getTimeoutMs()} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeKey(value: string) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function findValueByKeys(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 10 || value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByKeys(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const wanted = new Set(keys.map(normalizeKey));

  for (const [key, nested] of Object.entries(record)) {
    if (wanted.has(normalizeKey(key))) return nested;
  }

  for (const nested of Object.values(record)) {
    const found = findValueByKeys(nested, keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function firstText(value: unknown): string {
  if (Array.isArray(value)) return firstText(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstText(
      record.value ?? record.name ?? record.text ?? record.label ?? record.id ?? "",
    );
  }
  return String(value ?? "").trim();
}

function canonicalStatus(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  for (const candidate of STATUS_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.label;
  }
  return "";
}

function findDateText(value: string) {
  for (const pattern of DATE_PATTERNS) {
    const found = String(value || "").match(pattern)?.[0];
    if (found) return found.trim();
  }
  return "";
}

function dateToIso(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  const dmy = text.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (dmy) {
    let hour = Number(dmy[4] || 0);
    const minute = Number(dmy[5] || 0);
    const second = Number(dmy[6] || 0);
    const ampm = String(dmy[7] || "").toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const date = new Date(
      Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), hour, minute, second),
    );
    return Number.isNaN(date.getTime()) ? text : date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function extractLocationFromRow(rowHtml: string, status: string, dateText: string) {
  const cells = Array.from(rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
    .map((match) => htmlToText(match[1] || ""))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const candidates = cells.filter((cell) => {
    const normalized = cell.toLowerCase();
    if (status && canonicalStatus(cell) === status) return false;
    if (dateText && cell.includes(dateText)) return false;
    if (/^\d+$/.test(cell)) return false;
    if (/^(status|date|time|location|activity|event|remarks?)$/i.test(cell)) return false;
    if (normalized.includes("awb") || normalized.includes("skybill")) return false;
    return cell.length >= 2 && cell.length <= 160;
  });

  return candidates[candidates.length - 1] || "";
}

function parseHtmlTracking(html: string, awbNumber: string) {
  const plain = htmlToText(html);
  const lower = plain.toLowerCase();

  if (
    /\b(no\s+(?:record|shipment|result)|not\s+found|invalid\s+(?:awb|tracking))\b/i.test(
      plain,
    )
  ) {
    return null;
  }

  const rows = Array.from(html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)).map(
    (match) => match[0],
  );
  const events: Array<{
    status: string;
    lastActionDate: string;
    timestamp: number;
    location: string;
  }> = [];

  for (const row of rows) {
    const rowText = htmlToText(row).replace(/\s+/g, " ").trim();
    const status = canonicalStatus(rowText);
    if (!status) continue;
    const foundDate = findDateText(rowText);
    const isoDate = dateToIso(foundDate);
    const timestamp = isoDate ? new Date(isoDate).getTime() : Number.NaN;
    events.push({
      status,
      lastActionDate: isoDate,
      timestamp,
      location: extractLocationFromRow(row, status, foundDate),
    });
  }

  let selected = events[0];
  const datedEvents = events.filter((event) => Number.isFinite(event.timestamp));
  if (datedEvents.length) {
    selected = datedEvents.reduce((latest, event) =>
      event.timestamp > latest.timestamp ? event : latest,
    );
  }

  if (!selected) {
    const status = canonicalStatus(plain);
    if (!status) return null;
    const foundDate = findDateText(plain);
    selected = {
      status,
      lastActionDate: dateToIso(foundDate),
      timestamp: Number.NaN,
      location: "",
    };
  }

  const awbAppears = lower.includes(String(awbNumber || "").toLowerCase());
  const hasOperationalRows = events.length > 0;
  if (!awbAppears && !hasOperationalRows) return null;

  const expectedDeliveryMatch = plain.match(
    /(?:expected|estimated|future)\s+delivery(?:\s+date)?\s*[:\-]?\s*([^\n|]{4,60})/i,
  );
  const expectedDate = expectedDeliveryMatch
    ? dateToIso(findDateText(expectedDeliveryMatch[1]) || expectedDeliveryMatch[1].trim())
    : "";

  const codReleaseMatch = /\b(?:cod|cash|payment|remittance|amount)\s+(?:released|remitted|settled)\b/i.exec(
    plain,
  );
  let codReleasedAt = "";
  if (codReleaseMatch) {
    const nearby = plain.slice(
      Math.max(0, codReleaseMatch.index - 100),
      codReleaseMatch.index + 180,
    );
    codReleasedAt = dateToIso(findDateText(nearby));
  }

  return {
    status: selected.status,
    lastActionDate: selected.lastActionDate,
    location: selected.location,
    expectedDelivery: expectedDate,
    codReleased: Boolean(codReleaseMatch),
    codReleasedAt,
  };
}

function parseStructuredTracking(data: unknown) {
  if (!data || typeof data === "string") return null;

  const rawStatus = firstText(
    findValueByKeys(data, [
      "currentStatus",
      "shipmentStatus",
      "statusDescription",
      "statusName",
      "trackingStatus",
      "eventDescription",
      "activity",
      "description",
      "status",
    ]),
  );
  const status = canonicalStatus(rawStatus) || rawStatus;
  if (!status) return null;

  const lastActionDate = dateToIso(
    firstText(
      findValueByKeys(data, [
        "lastActionDate",
        "lastUpdated",
        "updatedAt",
        "statusDate",
        "eventDate",
        "activityDate",
        "dateTime",
        "scanDate",
        "date",
      ]),
    ),
  );
  const location = firstText(
    findValueByKeys(data, [
      "currentLocation",
      "trackingLocation",
      "location",
      "city",
      "lastLocation",
      "eventLocation",
      "scanLocation",
      "hubName",
      "facilityName",
    ]),
  );
  const expectedDelivery = dateToIso(
    firstText(
      findValueByKeys(data, [
        "expectedDelivery",
        "expectedDeliveryDate",
        "estimatedDelivery",
        "estimatedDeliveryDate",
        "futureDeliveryDate",
        "eta",
      ]),
    ),
  );
  const codStatus = firstText(
    findValueByKeys(data, [
      "codStatus",
      "codPaymentStatus",
      "paymentStatus",
      "remittanceStatus",
      "settlementStatus",
    ]),
  ).toLowerCase();
  const codReleased = ["released", "paid", "settled", "remitted", "received"].some(
    (word) => codStatus.includes(word),
  );
  const codReleasedAt = dateToIso(
    firstText(
      findValueByKeys(data, [
        "codReleasedAt",
        "codReleaseDate",
        "cashReleasedAt",
        "paymentReleasedAt",
        "remittanceDate",
        "settlementDate",
      ]),
    ),
  );

  return {
    status,
    lastActionDate,
    location,
    expectedDelivery,
    codReleased,
    codReleasedAt,
  };
}

function parseTrackingResult(result: PublicFetchResult, awbNumber: string) {
  const structured = parseStructuredTracking(result.data);
  if (structured) return structured;
  return parseHtmlTracking(result.text, awbNumber);
}

async function submitAwbForm(initial: PublicFetchResult, awbNumber: string) {
  const forms = extractForms(initial.text);
  const candidates = forms
    .map((form) => {
      const ranked = [...form.inputs]
        .map((input) => ({ input, score: awbInputScore(input) }))
        .sort((a, b) => b.score - a.score);
      return { form, best: ranked[0] };
    })
    .filter((item) => item.best && item.best.score > 0)
    .sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0));

  for (const candidate of candidates.slice(0, 3)) {
    const form = candidate.form;
    const awbInput = candidate.best!.input;
    const params = new URLSearchParams();

    for (const input of form.inputs) {
      if (!input.name) continue;
      if (["submit", "button", "file", "checkbox", "radio"].includes(input.type)) continue;
      params.set(input.name, input.name === awbInput.name ? awbNumber : input.value || "");
    }

    const actionUrl = new URL(form.action || initial.url, initial.url);
    const method = form.method === "POST" ? "POST" : "GET";

    try {
      let result: PublicFetchResult;
      if (method === "POST") {
        result = await fetchPublic(
          actionUrl.toString(),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Origin: actionUrl.origin,
              Referer: initial.url,
            },
            body: params.toString(),
          },
          initial.cookies,
        );
      } else {
        for (const [key, value] of params.entries()) actionUrl.searchParams.set(key, value);
        result = await fetchPublic(
          actionUrl.toString(),
          { method: "GET", headers: { Referer: initial.url } },
          initial.cookies,
        );
      }

      if (parseTrackingResult(result, awbNumber)) return result;
    } catch {
      // Continue with the next public form/candidate.
    }
  }

  return null;
}

async function tryCommonQueryParameters(baseUrl: string, awbNumber: string) {
  const names = ["awb", "AWB", "awbNo", "AWBNo", "skyBillNo", "trackingNumber"];

  for (const name of names) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set(name, awbNumber);
      const result = await fetchPublic(url.toString(), { method: "GET" });
      if (parseTrackingResult(result, awbNumber)) return result;
    } catch {
      // Continue with the next common public query parameter.
    }
  }

  return null;
}

async function tryPublicTrackerUrl(baseUrl: string, awbNumber: string) {
  const initial = await fetchPublic(baseUrl, { method: "GET" });
  const immediate = parseTrackingResult(initial, awbNumber);
  if (immediate) return { result: initial, parsed: immediate };

  const submitted = await submitAwbForm(initial, awbNumber);
  if (submitted) {
    const parsed = parseTrackingResult(submitted, awbNumber);
    if (parsed) return { result: submitted, parsed };
  }

  const queried = await tryCommonQueryParameters(baseUrl, awbNumber);
  if (queried) {
    const parsed = parseTrackingResult(queried, awbNumber);
    if (parsed) return { result: queried, parsed };
  }

  return null;
}

export async function trackTfmShipmentPublic(
  awbNumber: string,
): Promise<TfmPublicTrackResult> {
  if (!isPublicFallbackEnabled()) {
    throw new Error("TFM public tracking fallback is disabled");
  }

  const awb = String(awbNumber || "").trim();
  if (!awb) throw new Error("TFM public tracking fallback requires an AWB number");
  if (!/^[A-Za-z0-9-]{6,40}$/.test(awb)) {
    throw new Error("TFM public tracking fallback received an invalid AWB format");
  }

  const configuredPrimary = String(
    process.env.TFM_PUBLIC_TRACKING_URL || DEFAULT_PUBLIC_URL,
  ).trim();
  const configuredSecondary = String(
    process.env.TFM_PUBLIC_TRACKING_SECONDARY_URL || DEFAULT_SECONDARY_URL,
  ).trim();
  const urls = Array.from(
    new Set([configuredPrimary, configuredSecondary].filter(Boolean)),
  );
  const failures: string[] = [];

  for (const url of urls) {
    try {
      const found = await tryPublicTrackerUrl(url, awb);
      if (!found) {
        failures.push(`${new URL(url).host}: no readable public tracking result`);
        continue;
      }

      const { result, parsed } = found;
      return {
        awbNumber: awb,
        status: parsed.status,
        lastActionDate: parsed.lastActionDate,
        location: parsed.location,
        expectedDelivery: parsed.expectedDelivery,
        codReleased: parsed.codReleased,
        codReleasedAt: parsed.codReleasedAt,
        sourceUrl: result.url,
        raw: {
          source: "TFM public tracker",
          url: result.url,
          status: parsed.status,
          lastActionDate: parsed.lastActionDate,
          location: parsed.location,
          expectedDelivery: parsed.expectedDelivery,
          codReleased: parsed.codReleased,
          codReleasedAt: parsed.codReleasedAt,
        },
      };
    } catch (error) {
      let host = "public tracker";
      try {
        host = new URL(url).host;
      } catch {
        // Keep generic label.
      }
      failures.push(`${host}: ${cleanError(error)}`);
    }
  }

  throw new Error(
    `TFM public tracking fallback could not resolve AWB ${awb}. ${failures.join(" | ")}`,
  );
}
