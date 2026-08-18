import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@libsql/client";
import { getSession } from "@/lib/auth";

let usageClient: ReturnType<typeof createClient> | null = null;
let usageSchemaPromise: Promise<void> | null = null;

const trackingSuppression = new AsyncLocalStorage<boolean>();

export type ApiUsageRange = "1" | "7" | "30" | "all";

type ExternalApiTarget = {
  provider: string;
  endpoint: string;
  hostname: string;
};

function getTursoConfig() {
  const url = String(process.env.TURSO_DATABASE_URL || "").trim();
  const authToken = String(process.env.TURSO_AUTH_TOKEN || "").trim();

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is missing.");
  }

  if (
    !authToken &&
    !url.startsWith("file:") &&
    !url.startsWith("http://127.0.0.1") &&
    !url.startsWith("http://localhost")
  ) {
    throw new Error("TURSO_AUTH_TOKEN is missing.");
  }

  return {
    url,
    authToken: authToken || undefined,
  };
}

function getUsageSql() {
  if (!usageClient) {
    usageClient = createClient(getTursoConfig());
  }

  return usageClient;
}

function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function utcDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeStartDate(range: ApiUsageRange) {
  if (range === "all") return null;

  const days = Math.max(Number(range || 30), 1);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return utcDateOnly(date);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(
    init?.method ||
      (typeof Request !== "undefined" && input instanceof Request
        ? input.method
        : "GET"),
  )
    .trim()
    .toUpperCase();
}

function inputUrl(input: RequestInfo | URL) {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}

function configuredInternalHosts() {
  const hosts = new Set<string>();

  for (const rawValue of [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.ERP_BASE_URL,
  ]) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    try {
      const parsed = new URL(value.includes("://") ? value : `https://${value}`);
      if (parsed.hostname) hosts.add(parsed.hostname.toLowerCase());
    } catch {
      const host = normalizeHost(value);
      if (host) hosts.add(host);
    }
  }

  return hosts;
}

function tursoHost() {
  const value = String(process.env.TURSO_DATABASE_URL || "").trim();
  if (!value || value.startsWith("file:")) return "";

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function providerForHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (host === "api.airtable.com") return "Airtable";
  if (host === "graph.facebook.com" || host.endsWith(".facebook.com")) {
    return "Facebook";
  }
  if (host.includes("green-api")) return "GREEN-API";
  if (host.includes("tfm")) return "TFM";
  if (host.endsWith("cloudflarestorage.com")) return "Cloudflare R2";

  return hostname;
}

function normalizeEndpoint(url: URL) {
  const hostname = url.hostname.toLowerCase();

  if (hostname === "api.airtable.com") {
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));

    if (parts[0] === "v0" && parts[1] && parts[2]) {
      return `api.airtable.com/v0/${parts[1]}/${parts[2]}`;
    }
  }

  // Never persist query strings because they can contain tokens, record IDs,
  // filters, phone numbers, or other sensitive values.
  return `${url.hostname}${url.pathname || "/"}`;
}

function describeExternalApiTarget(
  input: RequestInfo | URL,
): ExternalApiTarget | null {
  let url: URL;

  try {
    url = new URL(inputUrl(input));
  } catch {
    // Relative/internal server fetches are not treated as external API usage.
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return null;
  }

  if (configuredInternalHosts().has(hostname)) {
    return null;
  }

  const databaseHost = tursoHost();
  if (databaseHost && hostname === databaseHost) {
    return null;
  }

  return {
    provider: providerForHost(hostname),
    endpoint: normalizeEndpoint(url),
    hostname,
  };
}

export function isVercelApiUsageTrackingEnabled() {
  const vercel = String(process.env.VERCEL || "").trim();
  const vercelEnvironment = String(process.env.VERCEL_ENV || "")
    .trim()
    .toLowerCase();

  return vercel === "1" && vercelEnvironment !== "development";
}

export function isApiUsageTrackingSuppressed() {
  return trackingSuppression.getStore() === true;
}

async function runWithoutApiUsageTracking<T>(work: () => Promise<T>) {
  return trackingSuppression.run(true, work);
}

export async function ensureApiUsageSchema() {
  if (usageSchemaPromise) {
    return usageSchemaPromise;
  }

  usageSchemaPromise = runWithoutApiUsageTracking(async () => {
    const sql = getUsageSql();

    await sql.batch(
      [
        {
          sql: `
            CREATE TABLE IF NOT EXISTS api_usage_outbound_daily (
              usage_date TEXT NOT NULL,
              username TEXT NOT NULL,
              full_name TEXT NOT NULL DEFAULT '',
              role TEXT NOT NULL DEFAULT '',
              company_name TEXT NOT NULL DEFAULT '',
              provider TEXT NOT NULL DEFAULT '',
              endpoint TEXT NOT NULL,
              method TEXT NOT NULL,
              call_count INTEGER NOT NULL DEFAULT 0,
              first_called_at TEXT NOT NULL,
              last_called_at TEXT NOT NULL,
              PRIMARY KEY (
                usage_date,
                username,
                company_name,
                provider,
                endpoint,
                method
              )
            )
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS api_usage_outbound_user_idx
            ON api_usage_outbound_daily (username, usage_date DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS api_usage_outbound_provider_idx
            ON api_usage_outbound_daily (provider, usage_date DESC)
          `,
          args: [],
        },
        {
          sql: `
            CREATE INDEX IF NOT EXISTS api_usage_outbound_date_idx
            ON api_usage_outbound_daily (usage_date DESC)
          `,
          args: [],
        },
      ],
      "write",
    );
  }).catch((error) => {
    usageSchemaPromise = null;
    throw error;
  });

  return usageSchemaPromise;
}

export async function recordExternalApiUsageForCurrentUser(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (!isVercelApiUsageTrackingEnabled()) return;
  if (isApiUsageTrackingSuppressed()) return;

  const target = describeExternalApiTarget(input);
  if (!target) return;

  let session: Awaited<ReturnType<typeof getSession>> = null;

  try {
    session = await getSession();
  } catch {
    // Fetch can also run during startup/background work where request cookies
    // are unavailable. Those calls are not user-attributable and are ignored.
    return;
  }

  if (!session?.username) return;

  const activeBase =
    session.selectedBase ||
    (Array.isArray(session.permissions) ? session.permissions[0] : null);

  const calledAt = new Date();
  const usageDate = utcDateOnly(calledAt);
  const method = requestMethod(input, init);

  await runWithoutApiUsageTracking(async () => {
    await ensureApiUsageSchema();

    const sql = getUsageSql();

    await sql.execute({
      sql: `
        INSERT INTO api_usage_outbound_daily (
          usage_date,
          username,
          full_name,
          role,
          company_name,
          provider,
          endpoint,
          method,
          call_count,
          first_called_at,
          last_called_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (
          usage_date,
          username,
          company_name,
          provider,
          endpoint,
          method
        ) DO UPDATE SET
          call_count = api_usage_outbound_daily.call_count + 1,
          full_name = excluded.full_name,
          role = excluded.role,
          last_called_at = excluded.last_called_at
      `,
      args: [
        usageDate,
        String(session.username || "").trim(),
        String(session.fullName || "").trim(),
        String(session.role || "").trim(),
        String(activeBase?.baseName || "").trim(),
        target.provider,
        target.endpoint,
        method,
        calledAt.toISOString(),
        calledAt.toISOString(),
      ],
    });
  });
}

export async function getApiUsageReport(range: ApiUsageRange = "30") {
  await ensureApiUsageSchema();

  const sql = getUsageSql();
  const startDate = rangeStartDate(range);
  const whereSql = startDate ? "WHERE usage_date >= ?" : "";
  const args = startDate ? [startDate] : [];

  const [userResult, endpointResult] = await runWithoutApiUsageTracking(() =>
    Promise.all([
      sql.execute({
        sql: `
          SELECT
            username,
            MAX(full_name) AS full_name,
            MAX(role) AS role,
            SUM(call_count) AS total_calls,
            COUNT(DISTINCT provider || '|' || method || ' ' || endpoint) AS endpoint_count,
            MAX(last_called_at) AS last_call_at
          FROM api_usage_outbound_daily
          ${whereSql}
          GROUP BY username
          ORDER BY total_calls DESC, username ASC
        `,
        args,
      }),
      sql.execute({
        sql: `
          SELECT
            username,
            company_name,
            provider,
            endpoint,
            method,
            SUM(call_count) AS call_count,
            MIN(first_called_at) AS first_called_at,
            MAX(last_called_at) AS last_called_at
          FROM api_usage_outbound_daily
          ${whereSql}
          GROUP BY username, company_name, provider, endpoint, method
          ORDER BY call_count DESC, last_called_at DESC
          LIMIT 5000
        `,
        args,
      }),
    ]),
  );

  const users = userResult.rows.map((row) => ({
    username: textValue(row.username),
    fullName: textValue(row.full_name),
    role: textValue(row.role),
    totalCalls: numberValue(row.total_calls),
    endpointCount: numberValue(row.endpoint_count),
    lastCallAt: textValue(row.last_call_at),
  }));

  const endpoints = endpointResult.rows.map((row) => ({
    username: textValue(row.username),
    companyName: textValue(row.company_name),
    provider: textValue(row.provider),
    route: textValue(row.endpoint),
    method: textValue(row.method),
    callCount: numberValue(row.call_count),
    firstCalledAt: textValue(row.first_called_at),
    lastCalledAt: textValue(row.last_called_at),
  }));

  return {
    range,
    startDate,
    totalCalls: users.reduce((sum, item) => sum + item.totalCalls, 0),
    users,
    endpoints,
  };
}
