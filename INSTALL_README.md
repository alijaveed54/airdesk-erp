# Mysmar ERP — API Usage Tracker v2 (Actual Outbound Calls)

## Definition used by this version

This version counts **real outbound HTTP API attempts made by the ERP server** for the currently logged-in user.

Example:

- Browser calls `/api/orders/list` once.
- That Next.js route sends 5 separate requests to Airtable.
- Tracker count = **5**, not 1.

A failed outbound HTTP attempt is still counted because the request was sent.

## Localhost rule

Tracking runs only when:

- `VERCEL=1`
- `VERCEL_ENV` is not `development`

Therefore normal localhost / `npm run dev` usage is ignored even when the user is logged in.

## Exact files

1. REPLACE `C:\airdesk-erp\lib\api-usage.ts`
2. REPLACE `C:\airdesk-erp\lib\audit-airtable-fetch.ts`
3. REPLACE `C:\airdesk-erp\proxy.ts`
4. ADD/REPLACE `C:\airdesk-erp\app\api\admin\api-usage\route.ts`
5. ADD/REPLACE `C:\airdesk-erp\app\(dashboard)\admin\api-usage\page.tsx`
6. Apply `SIDEBAR_PATCH.txt` to `C:\airdesk-erp\components\layout\Sidebar.tsx`

`instrumentation.ts` does not need a change. It already installs `installGlobalAirtableAudit()`, and that existing global fetch layer now performs both audit interception and outbound API usage counting.

## Storage

The tracker uses the existing Turso/libSQL connection and automatically creates:

`api_usage_outbound_daily`

The old v1 table `api_usage_daily`, if it already exists, is left untouched and is no longer used by this tracker.

## What is stored

- username
- full name
- role
- selected company/base
- provider
- external endpoint without query string
- HTTP method
- daily call count
- first/last call timestamp

Query strings are intentionally not stored to avoid saving tokens, filters, phone numbers, or other sensitive values.

## Providers

The dashboard identifies common providers such as Airtable, Facebook, GREEN-API, TFM, and Cloudflare R2 when the traffic uses the server's global `fetch` path.

### Important coverage boundary

This tracker counts outbound HTTP calls that pass through the server's global `fetch` pipeline. Airtable traffic in this ERP does pass through that pipeline. A third-party SDK that uses its own Node HTTP transport instead of `fetch` will need a small provider-specific hook if you also want those SDK requests counted.

## Why `lib/audit-airtable-fetch.ts` is replaced

The ERP already globally wraps fetch for Airtable audit handling. Tracking at the final `nativeFetch()` layer means each actual network fetch is counted, including internal Airtable pre-reads made by the audit system. This reflects actual Airtable network/API consumption rather than one count per Next.js route.

## Verification

1. On localhost, log in and use the ERP heavily. API Usage must not increase.
2. Deploy to Vercel.
3. Log in as a test user.
4. Trigger a route known to make multiple Airtable requests.
5. Open `/admin/api-usage` as Admin.
6. Confirm the Airtable count increases by the actual number of outbound Airtable requests.
7. Confirm provider/endpoint breakdown appears.

Static review only — not runtime-tested in the real project.
