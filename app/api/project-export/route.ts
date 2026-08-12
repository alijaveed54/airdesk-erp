import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ProjectEntry = {
  relativePath: string;
  absolutePath: string;
  size: number;
  isDirectory: boolean;
};

type IncludedFile = {
  entry: ProjectEntry;
  content: string;
  language: string;
};

type PackageSnapshot = {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

type ExportSnapshot = {
  generatedAt: string;
  activeBaseName: string;
  treeEntries: number;
  directoryCount: number;
  fileCount: number;
  includedFiles: number;
  skippedFiles: number;
  embeddedBytes: number;
  pageFiles: string[];
  apiRouteFiles: string[];
  docsFiles: string[];
  backupFiles: string[];
  environmentVariableNames: string[];
  packageSnapshot: PackageSnapshot | null;
};

const ROOT = process.cwd();

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  ".idea",
  ".vscode",
  "tmp",
  "temp",
]);

const EXCLUDED_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".DS_Store",
]);

const SECRET_FILE_PATTERNS = [
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /credentials.*\.json$/i,
  /service[-_]?account.*\.json$/i,
  /secret.*\.json$/i,
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".sql",
  ".prisma",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".txt",
  ".xml",
  ".graphql",
  ".gql",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".csv",
]);

const IMPORTANT_EXTENSIONLESS_FILES = new Set([
  "Dockerfile",
  "Procfile",
  "Makefile",
]);

const MAX_SINGLE_FILE_BYTES = 1_500_000;
const MAX_TOTAL_CONTENT_BYTES = 18_000_000;
const MAX_TREE_ENTRIES = 8_000;

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function isEnvironmentFile(relativePath: string) {
  return path.basename(relativePath).toLowerCase().startsWith(".env");
}

function isSecretFile(relativePath: string) {
  const name = path.basename(relativePath);

  return SECRET_FILE_PATTERNS.some((pattern) =>
    pattern.test(name)
  );
}

function isTextFile(relativePath: string) {
  if (isEnvironmentFile(relativePath)) {
    return true;
  }

  const extension = path.extname(relativePath).toLowerCase();
  const name = path.basename(relativePath);

  return (
    TEXT_EXTENSIONS.has(extension) ||
    IMPORTANT_EXTENSIONLESS_FILES.has(name)
  );
}

function isBackupOrHistoricalFile(relativePath: string) {
  const normalized = normalizePath(relativePath).toLowerCase();

  return (
    normalized.startsWith("backups/") ||
    normalized.includes(".backup") ||
    normalized.endsWith(".bak") ||
    normalized.endsWith(".old") ||
    normalized.endsWith(".orig")
  );
}

function languageFor(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();

  const map: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".json": "json",
    ".md": "md",
    ".mdx": "mdx",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".html": "html",
    ".sql": "sql",
    ".prisma": "prisma",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".xml": "xml",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".sh": "bash",
    ".ps1": "powershell",
    ".bat": "bat",
    ".cmd": "bat",
    ".csv": "csv",
  };

  if (isEnvironmentFile(relativePath)) {
    return "dotenv";
  }

  return map[extension] || "text";
}

async function walkDirectory(
  absoluteDirectory: string,
  relativeDirectory = ""
): Promise<ProjectEntry[]> {
  const output: ProjectEntry[] = [];

  const directoryEntries = await fs.readdir(
    absoluteDirectory,
    { withFileTypes: true }
  );

  directoryEntries.sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of directoryEntries) {
    if (output.length >= MAX_TREE_ENTRIES) {
      break;
    }

    if (
      entry.isDirectory() &&
      EXCLUDED_DIRECTORIES.has(entry.name)
    ) {
      continue;
    }

    const relativePath = normalizePath(
      path.join(relativeDirectory, entry.name)
    );

    const absolutePath = path.join(
      absoluteDirectory,
      entry.name
    );

    if (entry.isDirectory()) {
      output.push({
        relativePath,
        absolutePath,
        size: 0,
        isDirectory: true,
      });

      const nested = await walkDirectory(
        absolutePath,
        relativePath
      );

      output.push(...nested);
      continue;
    }

    if (EXCLUDED_FILE_NAMES.has(entry.name)) {
      continue;
    }

    const stats = await fs.stat(absolutePath);

    output.push({
      relativePath,
      absolutePath,
      size: stats.size,
      isDirectory: false,
    });
  }

  return output.slice(0, MAX_TREE_ENTRIES);
}

function buildTree(entries: ProjectEntry[]) {
  return entries
    .map((entry) =>
      entry.isDirectory
        ? `${entry.relativePath}/`
        : entry.relativePath
    )
    .join("\n");
}

function redactEnvironmentFile(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        !trimmed.includes("=")
      ) {
        return line;
      }

      const equalsIndex = line.indexOf("=");
      const key = line.slice(0, equalsIndex);

      return `${key}=<REDACTED>`;
    })
    .join("\n");
}

function redactObviousCredentials(content: string) {
  return content
    .replace(
      /\bpat[a-zA-Z0-9]{20,}\b/g,
      "<REDACTED_AIRTABLE_TOKEN>"
    )
    .replace(
      /\bBearer\s+[a-zA-Z0-9._~+/=-]{20,}\b/gi,
      "Bearer <REDACTED_TOKEN>"
    )
    .replace(
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      "<REDACTED_JWT>"
    )
    .replace(
      /((?:password|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|refresh[_-]?token|token)\s*[:=]\s*)["'][^"'\r\n]{8,}["']/gi,
      '$1"<REDACTED>"'
    )
    .replace(
      /([?&](?:access_token|token|api_key|key|secret)=)[^&\s"'`]+/gi,
      "$1<REDACTED>"
    );
}

function collectEnvironmentVariableNames(
  rawContent: string,
  output: Set<string>
) {
  const dotPattern =
    /process\.env\.([A-Z][A-Z0-9_]*)/g;

  const bracketPattern =
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;

  for (const pattern of [dotPattern, bracketPattern]) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(rawContent))) {
      output.add(match[1]);
    }
  }
}

function isPageFile(relativePath: string) {
  return /^app\/.*\/page\.(ts|tsx|js|jsx)$/i.test(
    normalizePath(relativePath)
  ) || /^app\/page\.(ts|tsx|js|jsx)$/i.test(
    normalizePath(relativePath)
  );
}

function isApiRouteFile(relativePath: string) {
  return /^app\/api\/.*\/route\.(ts|tsx|js|jsx)$/i.test(
    normalizePath(relativePath)
  );
}

function appFileToRoute(relativePath: string) {
  const normalized = normalizePath(relativePath);

  let route = normalized.replace(/^app\//, "");

  route = route.replace(
    /(^|\/)(page|route)\.(ts|tsx|js|jsx)$/i,
    ""
  );

  const parts = route
    .split("/")
    .filter(Boolean)
    .filter(
      (part) =>
        !(part.startsWith("(") && part.endsWith(")"))
    );

  return `/${parts.join("/")}`.replace(/\/+/g, "/");
}

function normalizeStringMap(
  value: unknown
): Record<string, string> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([, item]) =>
          typeof item === "string"
      )
      .map(([key, item]) => [key, String(item)])
  );
}

function parsePackageSnapshot(
  includedFiles: IncludedFile[]
): PackageSnapshot | null {
  const packageFile = includedFiles.find(
    (item) =>
      item.entry.relativePath === "package.json"
  );

  if (!packageFile) {
    return null;
  }

  try {
    const data = JSON.parse(packageFile.content);

    return {
      name: String(data?.name || ""),
      version: String(data?.version || ""),
      scripts: normalizeStringMap(data?.scripts),
      dependencies: normalizeStringMap(
        data?.dependencies
      ),
      devDependencies: normalizeStringMap(
        data?.devDependencies
      ),
    };
  } catch {
    return null;
  }
}

function markdownList(
  items: string[],
  emptyLabel = "(none detected)"
) {
  if (items.length === 0) {
    return `- ${emptyLabel}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function packageSection(
  packageSnapshot: PackageSnapshot | null
) {
  if (!packageSnapshot) {
    return `Package metadata could not be parsed from package.json.`;
  }

  const scripts = Object.entries(
    packageSnapshot.scripts
  )
    .map(
      ([name, command]) =>
        `- \`${name}\`: \`${command}\``
    )
    .join("\n");

  const dependencies = Object.entries({
    ...packageSnapshot.dependencies,
    ...packageSnapshot.devDependencies,
  })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, version]) =>
        `- \`${name}\`: \`${version}\``
    )
    .join("\n");

  return `Project package: \`${packageSnapshot.name || "(unnamed)"}\`
Package version: \`${packageSnapshot.version || "(not set)"}\`

### Package scripts
${scripts || "- (none)"}

### Dependencies and devDependencies
${dependencies || "- (none)"}`;
}

function routeInventory(
  files: string[]
) {
  if (files.length === 0) {
    return "- (none detected)";
  }

  return files
    .map(
      (file) =>
        `- \`${appFileToRoute(file)}\` ← \`${file}\``
    )
    .join("\n");
}

function projectContext(snapshot: ExportSnapshot) {
  return `# Mysmar ERP — MASTER AI PROJECT HANDOVER

Generated: ${snapshot.generatedAt}
Active business/base at export time: ${snapshot.activeBaseName || "Unknown"}
Local Windows project root: \`C:\\airdesk-erp\`
Export format version: 2

---

# 0. READ THIS FIRST — CHATGPT / AI OPERATING CONTRACT

You are continuing the **Mysmar ERP** project.

This export is intended to prevent the project owner from having to explain the project again in a new ChatGPT/AI conversation.

## 0.1 Source-of-truth priority

When information conflicts, use this order:

1. The user's latest explicit instruction in the current conversation.
2. The actual latest project source file being changed.
3. Current live Airtable schema for real table/field names.
4. The current-context sections in this export.
5. Historical documentation under \`docs/\`.
6. Backup/legacy files.
7. Model memory or assumptions.

Never allow an old roadmap, backup file, or old documentation note to override current working code automatically.

## 0.2 Mandatory ChatGPT working rules

- Read the relevant actual exported source before writing code.
- Never invent completed work.
- Never claim runtime testing that did not happen.
- Never say a feature is complete merely because a file exists.
- Preserve existing functionality unless the user explicitly replaces it.
- Do not redesign UI unless the user requests a redesign.
- Prefer modifying existing files over creating duplicate files.
- Avoid duplicate pages, APIs, components, and business logic.
- Preserve backward compatibility.
- Keep explanations short and prioritize working output.
- Return **READY TO REPLACE FILES** whenever practical.
- Always give the exact Windows path for every changed file.
- ERP responses should begin with Pakistan time:
  \`[DD Mon YYYY | HH:MM AM/PM PKT]\`
- Do not ask the user to repeat information already documented in this export.
- State conflicts between code and documentation instead of silently guessing.
- If a change is only statically reviewed, explicitly say:
  **Static review only — not runtime-tested.**

## 0.3 User-state preservation rule

Normal edits should not unnecessarily reset:

- search
- filters
- pagination
- sort
- row selection
- scroll position

Avoid unnecessary full-page reloads and unnecessary router refreshes.

## 0.4 Performance rule

Performance is more important than decorative animation.

Prefer:

- server-side filtering where practical
- pagination for large Airtable datasets
- minimal Airtable requests
- minimal duplicate API calls
- lazy image loading where practical
- reuse of already-loaded data where safe
- avoiding unnecessary React re-renders

## 0.5 Security rule

- Never trust client-side UI permissions alone.
- Sensitive APIs must enforce authorization themselves.
- Supplier users must not gain internal order-editing access.
- Never expose Airtable, R2, Facebook, courier, database, or auth secrets.
- Never invent Airtable field names.
- Never rename/delete Airtable fields without explicit approval and migration planning.
- Treat authentication, authorization, deletion, dispatch, finance, and bulk mutations as high-risk changes.
- Secret values are intentionally excluded/redacted from this handover.

## 0.6 Next.js rule

The project contains \`AGENTS.md\`, which warns that the installed Next.js version can differ from model training knowledge.

For framework-sensitive changes, inspect the project's local Next.js documentation under:

\`node_modules/next/dist/docs/\`

when available in the real development environment.

## 0.7 Hidden platform prompts

This handover contains **project-specific user-defined ChatGPT/AI rules and project context**.

Hidden OpenAI/platform/system/developer prompts are not project assets and are intentionally not exported.

---

# 1. PROJECT IDENTITY

Project name: **Mysmar ERP**

Previous name: **Madni Hotel ERP**

Project root:

\`C:\\airdesk-erp\`

Primary purpose:

A multi-company ERP built around Airtable operational data with Next.js application/API layers. It covers orders, customers, products, suppliers, inventory/stock, reports, dispatch, courier work, permissions, media/image workflows, audit history, and administration.

Core architecture principle:

**One ERP application, multiple business/base configurations.**

The selected business/base can change:

- Airtable base
- invoice table
- order-entry table
- customer table
- product table
- user permissions
- business workflow availability

Never assume one base's field/table mapping is valid for every base.

---

# 2. REGISTERED BUSINESS CONTEXT

Documented business/base labels:

1. BS
2. i5Q/DQ
3. FAB Doha Non Stock
4. FAB Doha Stock
5. TAT

Export-time selected base:

**${snapshot.activeBaseName || "Unknown"}**

The exact live base ID, token, table names, and field names must come from the current session/configuration or live Airtable schema — not guesses.

---

# 3. CURRENT TECHNICAL SNAPSHOT

- Tree entries: ${snapshot.treeEntries}
- Directories: ${snapshot.directoryCount}
- Files in tree: ${snapshot.fileCount}
- Embedded text/source/config files: ${snapshot.includedFiles}
- API route files detected: ${snapshot.apiRouteFiles.length}
- Page files detected: ${snapshot.pageFiles.length}
- Documentation files detected: ${snapshot.docsFiles.length}
- Backup/historical files detected: ${snapshot.backupFiles.length}
- Embedded source/config size: ${snapshot.embeddedBytes} bytes
- Skipped files: ${snapshot.skippedFiles}

${packageSection(snapshot.packageSnapshot)}

---

# 4. AUTHENTICATION / SESSION / PERMISSIONS

Current project auth source uses a signed cookie session.

Known current session concepts include:

- username
- full name
- role
- super-admin flag
- default base
- available/base permissions
- selected base

Known role values in the main auth layer include:

- Admin
- Manager
- Employee
- Warehouse
- Accounts
- Supplier

A legacy/smaller role helper may still exist elsewhere in the project. Do not normalize roles blindly; trace the actual imports/usage of the affected module first.

## Supplier rule

Supplier accounts must not access internal order-editing functions such as:

- Orders Quick Edit
- order inline editing
- UAE Dispatch Update
- other internal order-editing APIs/pages

This restriction must exist in API/server authorization, not only Sidebar/UI visibility.

---

# 5. AIRTABLE DATA RULES

Airtable is the primary operational data store.

Permanent rules:

- Verify exact table and field names before hardcoding.
- Preserve field casing/spelling used by the real base.
- Do not rename existing Airtable fields merely to make code cleaner.
- Do not delete fields without explicit approval.
- Prefer additive/mapped migrations.
- Keep multi-base mappings explicit.
- Be careful with lookup, linked-record, rollup, attachment, single-select, and formula fields.

Known business identifiers/relationships from project documentation include concepts such as:

- SKU for products
- contact number for customers
- bill number for invoice/order-item workflows

---

# 6. CORE MODULE MAP

The current project tree/source contains surfaces for the following areas. File presence proves source exists; it does **not** automatically prove production/runtime completion.

## Authentication
- login
- logout
- current user/session
- base access/selection
- change password

## Dashboard
- main ERP dashboard
- role/base-aware navigation

## Orders
- Orders List
- Grouped Orders
- Edit Order
- View Order
- Print
- Quick Edit
- UAE Dispatch
- create/update/bulk-update APIs
- order-item create/update/delete APIs
- options/search/history
- courier download
- driver sheet
- FAB stock movement workflow

## Products
- product list
- create/product APIs
- product UI components

## Customers
- customer API
- customer update API
- customer search components

## Suppliers
- supplier page
- supplier orders
- supplier options
- line update
- bulk update
- supplier-related report/share functionality

## Inventory
- inventory list
- stock received
- DQ/FAB stock receive flows

## Reports
Current report surfaces include:
- COD
- Courier
- Courier Pending Update
- Delivered Orders
- Monthly COD
- Order Pending
- Pending
- Ready to Process
- Supplier Activity
- Supplier Bill Dispatch
- Supplier Pending Receive
- store-wise API/report logic

## Courier / TFM
- TFM configuration
- TFM orders
- TFM shipments
- auth test
- AWB import preview/apply
- courier page/printing/import workflows

## Facebook
- connection
- pages
- post
- direct post
- media
- history
- batch upload/process/manage
- worker-related code

## Images / R2
- image pages
- batch editor
- product image generator
- R2 upload
- R2 gallery
- R2 image/file API
- R2 usage/admin

## AI
- classify
- classify-all
- queue
- worker
- result
- AI library/pipeline/cache/classifier-related source

## Audit / Activity
- Activity Log UI
- audit API
- SQL audit schema
- audit DB helpers
- Airtable mutation audit wrapper
- redaction/types
- pending/fallback audit persistence

## Users / Admin / Settings
- users
- schema/admin tools
- settings
- schema export
- R2 usage
- Project Export

## Public Stock
Public route:
\`/stock/doha\`

It must remain accessible without login.

---

# 7. IMPORTANT CURRENT BUSINESS RULES

## 7.1 Public Doha Stock

Required behavior documented/currently represented in source:

- route: \`/stock/doha\`
- public/no login
- show only \`Balance Stock >= 1\`
- zero stock disappears automatically
- show product image
- category
- color
- size
- Doha Price
- dependent category/color/size filters
- equal-height product cards
- mobile-friendly layout
- large image preview
- WhatsApp stock sharing should use text/link rather than sending the image itself

## 7.2 Orders List

Preserve existing capabilities such as:

- search
- filters
- pagination
- bulk courier update
- dispatch-ready workflow
- print
- driver sheet
- courier download
- eligible FAB stock move action
- compact/symbol action controls with tooltips where already implemented

Row-level inline status/courier behavior must be runtime-verified on the relevant bases before being called complete.

## 7.3 Orders Quick Edit

Current workflow includes concepts for:

- Quantity
- Supplier
- Bill No.
- warehouse/received/dispatched status
- Sold Out
- Order Number

The searchable Order Number workflow and move/clear behavior must be checked against current code and runtime before claiming completion.

## 7.4 UAE Dispatch Update

Route:

\`/orders/uae-dispatch\`

Documented scope:

- FAB Doha Non Stock
- Supplier blocked

Documented filters include:

- order status = Order Received or Processing
- bill number non-empty
- bill number not Stock Out
- bill number not Sold Out
- case-insensitive Stock Out/Sold Out exclusion
- warehouse received flag = Yes

Documented editable outputs include:

- dispatched flag = Yes
- dispatch date = selected date

Current UI/source supports concepts such as:

- single-row edit
- bulk selection/edit
- Order Number sorting
- image thumbnail/preview
- lookup/direct attachment image fallback

Verify exact live Airtable field mappings before changing this workflow.

## 7.5 Supplier Bill Dispatch

Preserved requirement:

- keep supplier filter
- keep bill number filter
- keep Stock Out
- keep Sold Out
- keep received and other existing filters
- remove only the Order Status filter when that requirement applies to the current implementation

## 7.6 Dispatched From India wording

Current source uses the user-facing wording **"Dispatched From India"** in relevant order/report UI.

Do not casually replace that label with an older warehouse phrase.

Preserve the underlying Airtable field mapping unless the user explicitly approves a schema migration.

## 7.7 Delivered Orders

Current source explicitly describes this report as:

**TS + BS delivered orders**

and states that the global Base Selector does not affect the report.

Do not force this report to follow the normal selected-base model unless the owner explicitly changes that business rule.

---

# 8. AUDIT / HISTORY RULES

The current project contains substantial audit infrastructure.

Do not treat an old documentation line saying "Audit Log pending" as stronger than current source.

Current audit architecture includes:

- structured Airtable create/update/delete change events
- SQL/libSQL/Turso-style audit persistence
- audit redaction
- record/user/company/module/action metadata
- R2 pending/fallback support in relevant audit code
- Activity Log UI

Important distinction:

**Source present** does not automatically mean **full audit coverage verified**.

Full mutation-path coverage and safe Undo behavior should still be explicitly tested/verified.

---

# 9. BACKUP / HISTORICAL FILE RULE

This export detected ${snapshot.backupFiles.length} backup/historical files.

They remain in the tree/source for forensic context, but:

- active non-backup files are stronger evidence
- never copy an old backup over a current file without tracing why
- backup code may contain stale APIs, UI, business rules, or experiments

Backup/historical paths detected:

${markdownList(snapshot.backupFiles)}

---

# 10. DOCUMENTATION CONFLICT POLICY

Historical \`docs/\` files are valuable project memory but can become stale.

If docs and current code conflict:

1. inspect the current active source
2. identify the conflict
3. preserve current working behavior
4. tell the user about the conflict
5. update documentation after the real implementation is corrected/verified

Do not use old percentage-complete roadmap values as live truth without verification.

Documentation files detected in this export:

${markdownList(snapshot.docsFiles)}

---

# 11. SECURITY / PRODUCTION HARDENING CHECKLIST

When touching production-sensitive areas, review:

- authentication secret configuration
- password storage/verification design
- cookie/session security
- server-side permission checks
- Supplier isolation
- deletion permissions
- Airtable credential handling
- Cloudflare R2 credentials
- Facebook credentials/tokens
- courier/TFM credentials
- audit database credentials
- environment variable exposure
- credential-like console/debug logging
- CSP/image-host production behavior
- bulk mutation validation
- destructive-operation confirmation/audit

Do not claim these are all fixed merely because this checklist exists.

---

# 12. TESTING / REGRESSION DISCIPLINE

Before calling a shared ERP change complete, test the affected areas as relevant:

- login/logout/session
- base selection
- permissions
- Admin behavior
- Supplier isolation
- Orders List
- search
- filters
- pagination
- inline edits
- bulk edits
- Grouped Orders
- Quick Edit
- UAE Dispatch
- suppliers
- inventory
- report totals
- report filters
- Excel/export output
- images/R2
- audit logging
- Facebook
- TFM/courier
- public stock without login

For shared dynamic-base code, do not test only one base if the change can affect other bases.

Use truthful status language such as:

- Static review only — not runtime-tested.
- Build passed; workflow not end-to-end tested.
- Runtime-tested on <route/base>.
- Remaining bases not yet tested.

---

# 13. CURRENT MASTER VERIFICATION / PENDING LIST

Keep these visible until actually verified/completed:

1. Full runtime regression across the documented business bases.
2. Orders List inline edit verification where applicable.
3. Quick Edit searchable Order Number verification.
4. Quick Edit move/clear Order Number behavior verification.
5. Supplier option/single-select save verification per relevant base.
6. Remaining bulk Quick Edit regression.
7. Full audit coverage verification across mutation routes.
8. Safe Undo design/implementation verification.
9. Full API permission audit.
10. Supplier-isolation regression.
11. Production image/R2 URL and policy verification.
12. Auth/security production-hardening review.
13. Reconcile stale documentation statuses with active source.
14. TFM/courier end-to-end regression where currently in use.
15. Keep Project Export context synchronized with real code.

---

# 14. DYNAMIC ENVIRONMENT-VARIABLE INVENTORY

Only variable **names** are shown here. Values are not exported.

${markdownList(
  snapshot.environmentVariableNames.map(
    (name) => `\`${name}\``
  )
)}

Never ask a future AI to invent missing secret values.

---

# 15. DYNAMIC PAGE / ROUTE INVENTORY

## UI page routes

${routeInventory(snapshot.pageFiles)}

## API routes

${routeInventory(snapshot.apiRouteFiles)}

---

# 16. IMPORTANT WINDOWS PATHS

Project root:

\`C:\\airdesk-erp\`

High-value paths include:

- \`C:\\airdesk-erp\\app\\(dashboard)\\orders\\list\\page.tsx\`
- \`C:\\airdesk-erp\\app\\(dashboard)\\orders\\quick-edit\\page.tsx\`
- \`C:\\airdesk-erp\\app\\(dashboard)\\orders\\uae-dispatch\\page.tsx\`
- \`C:\\airdesk-erp\\app\\api\\orders\\list\\route.ts\`
- \`C:\\airdesk-erp\\app\\api\\orders\\quick-edit\\route.ts\`
- \`C:\\airdesk-erp\\app\\api\\orders\\quick-edit\\update\\route.ts\`
- \`C:\\airdesk-erp\\app\\api\\orders\\uae-dispatch\\route.ts\`
- \`C:\\airdesk-erp\\components\\layout\\Sidebar.tsx\`
- \`C:\\airdesk-erp\\lib\\auth.ts\`
- \`C:\\airdesk-erp\\lib\\airtable.ts\`
- \`C:\\airdesk-erp\\lib\\audit-db.ts\`
- \`C:\\airdesk-erp\\lib\\audit-airtable-fetch.ts\`
- \`C:\\airdesk-erp\\lib\\audit-pending.ts\`
- \`C:\\airdesk-erp\\lib\\tfm-client.ts\`
- \`C:\\airdesk-erp\\app\\api\\project-export\\route.ts\`
- \`C:\\airdesk-erp\\docs\\00_PROJECT_MEMORY.md\`
- \`C:\\airdesk-erp\\docs\\08_FIELD_MAPPING.md\`
- \`C:\\airdesk-erp\\docs\\11_RELEASE_CHECKLIST.md\`

Use the full generated tree below for every other path.

---

# 17. HOW THE NEXT CHATGPT SHOULD HANDLE A CHANGE

For every new development request:

1. Identify the actual active file(s).
2. Read the complete relevant UI/API/data/auth path.
3. Check role/permission impact.
4. Check multi-base impact.
5. Check Airtable field/table mapping.
6. Check whether the same logic already exists elsewhere.
7. Preserve existing functionality.
8. Produce complete ready-to-replace file(s).
9. Give exact \`C:\\airdesk-erp\\...\` path(s).
10. State runtime-test/build-test status truthfully.
11. Update project documentation/export context after meaningful verified changes.

Do not start by asking the owner to reconstruct project history that is already in this export.

---

# 18. A–Z PROJECT INDEX

**A — Airtable / Audit / Admin**  
Operational records, audit history, admin tools.

**B — Bases / Bill workflows / Backups**  
Multi-base architecture and bill-linked order flows.

**C — Customers / Courier**  
Customer records, courier reports, TFM operations.

**D — Dashboard / Dispatch / Documentation**  
Main dashboard, warehouse/UAE dispatch, project docs.

**E — Exceptions / Excel / Export**  
Exceptions, spreadsheet/report export, Project Export.

**F — Facebook**  
Pages, posts, batches, media, history.

**G — Grouped Orders**  
Grouped/bill-oriented order views.

**H — History**  
Airtable mutation history/audit.

**I — Inventory / Images**  
Stock receive/list and image/R2 tooling.

**J — Jobs / Workers**  
AI and Facebook worker-style processes.

**K — Keys / Secrets**  
Never expose values; export only safe metadata.

**L — Login / libSQL**  
Session auth and SQL audit layer.

**M — Multi-base / Media**  
Dynamic business selection and media workflows.

**N — Next.js**  
App Router project; use installed-version docs.

**O — Orders**  
List, grouped, edit, view, quick edit, print, dispatch, bulk.

**P — Products / Permissions / Public Stock**  
Products, per-base permissions, public Doha stock.

**Q — Quick Edit**  
Fast order-item editing workflows.

**R — Reports / R2 / Roles**  
Reporting suite, object storage, authorization roles.

**S — Suppliers / Security / Schema**  
Supplier workflows, isolation, Airtable schema discipline.

**T — TFM / TypeScript**  
Courier integration and primary code language.

**U — UAE Dispatch / Undo**  
Dispatch workflow; Undo requires safe audit-backed verification.

**V — Verification**  
Never confuse source presence with runtime completion.

**W — WhatsApp / Warehouse**  
Text/link sharing and warehouse-related operational states.

**X — XLSX / Excel tooling**  
Report/export functionality.

**Y — Yes/No business flags**  
Exact Airtable status values can be workflow-critical.

**Z — Zero-stock rule**  
Public Doha stock hides Balance Stock below 1.

---

# 19. EXPORT SAFETY NOTES

- Environment values are redacted.
- Credential/key files are excluded.
- Obvious token/secret literals are redacted when detected.
- Build outputs/dependencies are excluded.
- Unsupported/binary files remain visible in the tree but are not embedded.
- Backup files are clearly treated as historical context.
- The source tree and embedded active files are stronger implementation evidence than narrative status notes.
- If the app is deployed to a platform that does not retain source files at runtime, server-side project export may be incomplete.

---

# 20. FINAL CONTINUATION INSTRUCTION

Treat the **actual exported current source** as the strongest implementation evidence.

Treat this top master context as the project's continuity contract and business-rule index.

If a narrative statement conflicts with current code, report the conflict and verify before changing behavior.

Never fabricate a field, route, completed feature, test result, credential, or business rule.
`;
}

async function collectIncludedFiles(
  entries: ProjectEntry[]
) {
  const includedFiles: IncludedFile[] = [];
  const skipped: string[] = [];
  const environmentVariableNames =
    new Set<string>();

  let totalContentBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }

    if (!isTextFile(entry.relativePath)) {
      skipped.push(
        `${entry.relativePath} — binary or unsupported text format`
      );
      continue;
    }

    if (entry.size > MAX_SINGLE_FILE_BYTES) {
      skipped.push(
        `${entry.relativePath} — larger than ${MAX_SINGLE_FILE_BYTES} bytes`
      );
      continue;
    }

    if (
      totalContentBytes + entry.size >
      MAX_TOTAL_CONTENT_BYTES
    ) {
      skipped.push(
        `${entry.relativePath} — total export content limit reached`
      );
      continue;
    }

    if (
      isSecretFile(entry.relativePath) &&
      !isEnvironmentFile(entry.relativePath)
    ) {
      skipped.push(
        `${entry.relativePath} — credential/key file excluded`
      );
      continue;
    }

    let rawContent: string;

    try {
      rawContent = await fs.readFile(
        entry.absolutePath,
        "utf8"
      );
    } catch {
      skipped.push(
        `${entry.relativePath} — unable to read as UTF-8 text`
      );
      continue;
    }

    collectEnvironmentVariableNames(
      rawContent,
      environmentVariableNames
    );

    const content = isEnvironmentFile(
      entry.relativePath
    )
      ? redactEnvironmentFile(rawContent)
      : redactObviousCredentials(rawContent);

    const contentBytes = Buffer.byteLength(
      content,
      "utf8"
    );

    if (
      totalContentBytes + contentBytes >
      MAX_TOTAL_CONTENT_BYTES
    ) {
      skipped.push(
        `${entry.relativePath} — total export content limit reached after redaction`
      );
      continue;
    }

    includedFiles.push({
      entry,
      content,
      language: languageFor(entry.relativePath),
    });

    totalContentBytes += contentBytes;
  }

  return {
    includedFiles,
    skipped,
    totalContentBytes,
    environmentVariableNames: Array.from(
      environmentVariableNames
    ).sort((a, b) => a.localeCompare(b)),
  };
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Not authenticated",
        },
        { status: 401 }
      );
    }

    const role = String(session.role || "")
      .trim()
      .toLowerCase();

    const isAdmin =
      role === "admin" ||
      Boolean(session.superAdmin);

    if (!isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Only Admin users can export the complete project",
        },
        { status: 403 }
      );
    }

    const entries = await walkDirectory(ROOT);
    const tree = buildTree(entries);

    const {
      includedFiles,
      skipped,
      totalContentBytes,
      environmentVariableNames,
    } = await collectIncludedFiles(entries);

    const pageFiles = entries
      .filter(
        (entry) =>
          !entry.isDirectory &&
          isPageFile(entry.relativePath)
      )
      .map((entry) => entry.relativePath)
      .sort((a, b) => a.localeCompare(b));

    const apiRouteFiles = entries
      .filter(
        (entry) =>
          !entry.isDirectory &&
          isApiRouteFile(entry.relativePath)
      )
      .map((entry) => entry.relativePath)
      .sort((a, b) => a.localeCompare(b));

    const docsFiles = entries
      .filter(
        (entry) =>
          !entry.isDirectory &&
          normalizePath(
            entry.relativePath
          ).startsWith("docs/")
      )
      .map((entry) => entry.relativePath)
      .sort((a, b) => a.localeCompare(b));

    const backupFiles = entries
      .filter(
        (entry) =>
          !entry.isDirectory &&
          isBackupOrHistoricalFile(
            entry.relativePath
          )
      )
      .map((entry) => entry.relativePath)
      .sort((a, b) => a.localeCompare(b));

    const packageSnapshot =
      parsePackageSnapshot(includedFiles);

    const generatedAt = new Date().toISOString();

    const activeBaseName =
      String(
        session.selectedBase?.baseName ||
          session.defaultBase ||
          ""
      ).trim() || "Unknown";

    const snapshot: ExportSnapshot = {
      generatedAt,
      activeBaseName,
      treeEntries: entries.length,
      directoryCount: entries.filter(
        (entry) => entry.isDirectory
      ).length,
      fileCount: entries.filter(
        (entry) => !entry.isDirectory
      ).length,
      includedFiles: includedFiles.length,
      skippedFiles: skipped.length,
      embeddedBytes: totalContentBytes,
      pageFiles,
      apiRouteFiles,
      docsFiles,
      backupFiles,
      environmentVariableNames,
      packageSnapshot,
    };

    const sections: string[] = [
      projectContext(snapshot),

      "\n# 21. COMPLETE PROJECT FILE TREE\n",
      "```text",
      tree || "(No project files found)",
      "```",

      "\n# 22. INCLUDED SOURCE / CONFIGURATION FILES\n",
      "The files below are embedded from the project at export time.",
      "Active non-backup source is stronger implementation evidence than backup/historical files.",
    ];

    for (const file of includedFiles) {
      const historicalLabel =
        isBackupOrHistoricalFile(
          file.entry.relativePath
        )
          ? " — BACKUP / HISTORICAL"
          : "";

      sections.push(
        `\n## \`${file.entry.relativePath}\`${historicalLabel}\n`,
        `~~~~${file.language}`,
        file.content,
        "~~~~"
      );
    }

    sections.push(
      "\n# 23. EXPORT STATISTICS\n",
      `- Generated: ${generatedAt}`,
      `- Active base: ${activeBaseName}`,
      `- File tree entries: ${entries.length}`,
      `- Directories: ${snapshot.directoryCount}`,
      `- Files in tree: ${snapshot.fileCount}`,
      `- Source/config files embedded: ${includedFiles.length}`,
      `- API route files detected: ${apiRouteFiles.length}`,
      `- Page files detected: ${pageFiles.length}`,
      `- Documentation files detected: ${docsFiles.length}`,
      `- Backup/historical files detected: ${backupFiles.length}`,
      `- Embedded content size: ${totalContentBytes} bytes`,
      `- Skipped file count: ${skipped.length}`
    );

    if (skipped.length > 0) {
      sections.push(
        "\n# 24. SKIPPED FILES\n",
        ...skipped.map((item) => `- ${item}`)
      );
    }

    sections.push(
      "\n# 25. FINAL INSTRUCTION TO THE NEXT AI\n",
      "Use the actual embedded current source as the strongest implementation evidence.",
      "Use the master context for project rules, workflow constraints, and continuity.",
      "If code and documentation disagree, state the conflict and verify before changing behavior.",
      "Never claim runtime testing or completion that did not actually happen."
    );

    const output = sections.join("\n");

    const date = generatedAt.slice(0, 10);

    const fileName =
      `Mysmar_ERP_MASTER_Project_Handover_${date}.md`;

    return new NextResponse(output, {
      status: 200,
      headers: {
        "Content-Type":
          "text/markdown; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="${fileName}"`,
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
        "X-Mysmar-Export-Version": "2",
        "X-Mysmar-Tree-Entries": String(
          entries.length
        ),
        "X-Mysmar-Included-Files": String(
          includedFiles.length
        ),
        "X-Mysmar-Skipped-Files": String(
          skipped.length
        ),
        "X-Mysmar-Api-Routes": String(
          apiRouteFiles.length
        ),
        "X-Mysmar-Pages": String(
          pageFiles.length
        ),
      },
    });
  } catch (error) {
    console.error(
      "Project export generation failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to generate complete project export",
      },
      { status: 500 }
    );
  }
}
