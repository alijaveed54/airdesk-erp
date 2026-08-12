import {
  getTfmAuthPath,
  getTfmCredentials,
  joinTfmUrl,
} from "@/lib/tfm";

type JsonRecord = Record<string, unknown>;

type TfmAuthApiResponse = {
  statusCode?: number;
  message?: string;
  title?: string;
  detail?: string;
  error?: unknown;
  errors?: unknown;
  isError?: boolean;
  result?: {
    userId?: number | string;
    token?: string;
    expires?: string;
    refreshToken?: string;
    expiresUnixTimeStamp?: number | string;
    tokenType?: string;
  };
};

export type TfmAuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  shipperId: string;
  tokenType: string;
  expiresAt: string;
  expiresAtMs: number;
};

let cachedSession: TfmAuthSession | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function decodeJwtPayload(token: string): JsonRecord {
  const parts = String(token || "").split(".");

  if (parts.length < 2) {
    throw new Error("TFM returned an invalid JWT token");
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(parts[1]));

    if (!isRecord(parsed)) {
      throw new Error("JWT payload is not an object");
    }

    return parsed;
  } catch {
    throw new Error("TFM JWT payload could not be decoded");
  }
}

function findValueByKey(
  value: unknown,
  targetKey: string,
  depth = 0,
): unknown {
  if (depth > 8) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByKey(item, targetKey, depth + 1);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  if (!isRecord(value)) return undefined;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (normalizedKey(key) === normalizedKey(targetKey)) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const found = findValueByKey(nestedValue, targetKey, depth + 1);

    if (found !== undefined) return found;
  }

  return undefined;
}

function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractShipperId(token: string) {
  const payload = decodeJwtPayload(token);
  const direct = findValueByKey(payload, "ShipperId");

  if (direct !== undefined && String(direct).trim()) {
    return String(direct).trim();
  }

  for (const [key, rawValue] of Object.entries(payload)) {
    if (!normalizedKey(key).includes("userdata")) continue;

    const userData = parseEmbeddedJson(rawValue);
    const nested = findValueByKey(userData, "ShipperId");

    if (nested !== undefined && String(nested).trim()) {
      return String(nested).trim();
    }
  }

  throw new Error(
    "TFM authentication succeeded, but Shipper ID was not present in the token",
  );
}

function getJwtExpiryMs(token: string) {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload.exp || 0);

  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

function parseResponseExpiryMs(
  result: NonNullable<TfmAuthApiResponse["result"]>,
) {
  const unixValue = Number(result.expiresUnixTimeStamp || 0);

  if (Number.isFinite(unixValue) && unixValue > 0) {
    return unixValue > 10_000_000_000
      ? unixValue
      : unixValue * 1000;
  }

  const isoValue = Date.parse(String(result.expires || ""));

  return Number.isFinite(isoValue) ? isoValue : 0;
}

function redactSensitiveText(value: string) {
  return String(value || "")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /("(?:password|token|refreshToken)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2",
    )
    .slice(0, 1200);
}

function flattenErrorValue(
  value: unknown,
  path = "",
  output: string[] = [],
  depth = 0,
) {
  if (depth > 5 || output.length >= 12) return output;

  if (value === null || value === undefined || value === "") {
    return output;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = String(value).trim();

    if (text) {
      output.push(path ? `${path}: ${text}` : text);
    }

    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenErrorValue(
        item,
        path ? `${path}[${index}]` : `[${index}]`,
        output,
        depth + 1,
      );
    });

    return output;
  }

  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(
      ([key, nestedValue]) => {
        flattenErrorValue(
          nestedValue,
          path ? `${path}.${key}` : key,
          output,
          depth + 1,
        );
      },
    );
  }

  return output;
}

function buildAuthenticationError({
  responseStatus,
  data,
  raw,
  userName,
  passwordLength,
}: {
  responseStatus: number;
  data: TfmAuthApiResponse;
  raw: string;
  userName: string;
  passwordLength: number;
}) {
  const messages = Array.from(
    new Set(
      [
        data.message,
        data.title,
        data.detail,
        ...flattenErrorValue(data.errors),
        ...flattenErrorValue(data.error),
        ...(typeof data.result === "string"
          ? [data.result]
          : []),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (!messages.length) {
    const safeRaw = redactSensitiveText(raw);

    if (safeRaw) messages.push(safeRaw);
  }

  const maskedUserName = userName
    ? userName.length <= 3
      ? `${userName[0] || "*"}***`
      : `${userName.slice(0, 2)}***${userName.slice(-2)}`
    : "missing";

  const detail = messages.length
    ? messages.join(" | ")
    : "TFM did not return an error description";

  return new Error(
    [
      `TFM authentication rejected the request (HTTP ${responseStatus}).`,
      detail,
      `Credential check: username ${maskedUserName}; password length ${passwordLength}.`,
      "Verify the sandbox username/password and .env.local special characters.",
    ].join(" "),
  );
}

function parseApiResponse(raw: string): TfmAuthApiResponse {
  try {
    return JSON.parse(raw) as TfmAuthApiResponse;
  } catch {
    throw new Error(
      raw.trim() ||
        "TFM authentication returned a response that was not valid JSON",
    );
  }
}

function isCacheUsable(session: TfmAuthSession | null) {
  if (!session) return false;

  // Generate a fresh token two minutes before expiry.
  return session.expiresAtMs - Date.now() > 120_000;
}

export function clearTfmAuthCache() {
  cachedSession = null;
}

export async function authenticateTfm(options?: {
  forceRefresh?: boolean;
}): Promise<TfmAuthSession> {
  if (!options?.forceRefresh && isCacheUsable(cachedSession)) {
    return cachedSession as TfmAuthSession;
  }

  const credentials = getTfmCredentials();

  if (!credentials.userName || !credentials.password) {
    throw new Error(
      "TFM username/password are missing from .env.local",
    );
  }

  const placeholderValues = new Set([
    "your_tfm_sandbox_username",
    "your_tfm_sandbox_password",
    "username",
    "password",
  ]);

  if (
    placeholderValues.has(credentials.userName.toLowerCase()) ||
    placeholderValues.has(credentials.password.toLowerCase())
  ) {
    throw new Error(
      "TFM credentials still contain placeholder values in .env.local",
    );
  }

  const response = await fetch(joinTfmUrl(getTfmAuthPath()), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/plain",
    },
    body: JSON.stringify({
      userName: credentials.userName,
      password: credentials.password,
    }),
    cache: "no-store",
  });

  const raw = await response.text();
  const data = parseApiResponse(raw);
  const result = data.result;

  if (
    !response.ok ||
    data.isError === true ||
    Number(data.statusCode || response.status) >= 400 ||
    !result?.token
  ) {
    throw buildAuthenticationError({
      responseStatus: response.status,
      data,
      raw,
      userName: credentials.userName,
      passwordLength: credentials.password.length,
    });
  }

  const accessToken = String(result.token).trim();
  const shipperId = extractShipperId(accessToken);
  const responseExpiryMs = parseResponseExpiryMs(result);
  const jwtExpiryMs = getJwtExpiryMs(accessToken);
  const expiresAtMs =
    responseExpiryMs || jwtExpiryMs || Date.now() + 15 * 60 * 1000;

  const session: TfmAuthSession = {
    accessToken,
    refreshToken: String(result.refreshToken || "").trim(),
    userId: String(result.userId || "").trim(),
    shipperId,
    tokenType: String(result.tokenType || "bearer").trim() || "bearer",
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };

  cachedSession = session;

  return session;
}

export async function getTfmAuthorizationContext() {
  const session = await authenticateTfm();
  const scheme =
    session.tokenType.toLowerCase() === "bearer"
      ? "Bearer"
      : session.tokenType;

  return {
    authorizationHeader: `${scheme} ${session.accessToken}`,
    shipperId: session.shipperId,
    userId: session.userId,
    expiresAt: session.expiresAt,
  };
}
