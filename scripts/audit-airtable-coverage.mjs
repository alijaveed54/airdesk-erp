import {
  access,
  readdir,
  readFile,
} from "node:fs/promises";
import {
  join,
  relative,
} from "node:path";

const root = process.cwd();
const apiRoot = join(root, "app", "api");
const instrumentationPath = join(
  root,
  "instrumentation.ts"
);

const excludedParts = [
  "/facebook/",
  "/r2/",
  "/images/",
  "/ai/",
  "/audit/",
  "/auth/login/",
  "/auth/logout/",
  "/auth/me/",
  "/auth/select-base/",
  "/public/",
  "/dev/",
  "/admin/schema/",
  "/settings/schema-export/",
  "/project-export/",
];

async function walk(directory) {
  const entries = await readdir(
    directory,
    {
      withFileTypes: true,
    }
  );
  const files = [];

  for (const entry of entries) {
    const fullPath = join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizedPath(filePath) {
  return `/${relative(root, filePath)
    .replaceAll("\\", "/")}`;
}

function hasRawAirtableMutation(source) {
  const hasMutationMethod =
    /method\s*:\s*["'](?:POST|PATCH|DELETE)["']/i.test(
      source
    );
  const referencesAirtable =
    /api\.airtable\.com|airtableUrl\s*\(/i.test(
      source
    );

  return hasMutationMethod && referencesAirtable;
}

function shadowsFetch(source) {
  return (
    /(?:const|let|var)\s+fetch\s*=/.test(source) ||
    /function\s+fetch\s*\(/.test(source) ||
    /import\s+fetch\s+from/.test(source)
  );
}

const failures = [];
const detectedMutations = [];

try {
  await access(instrumentationPath);
  const instrumentation = await readFile(
    instrumentationPath,
    "utf8"
  );

  if (
    !/installGlobalAirtableAudit/.test(
      instrumentation
    )
  ) {
    failures.push(
      "instrumentation.ts does not install the global Airtable audit wrapper"
    );
  }
} catch {
  failures.push(
    "instrumentation.ts is missing"
  );
}

const wrapper = await readFile(
  join(
    root,
    "lib",
    "audit-airtable-fetch.ts"
  ),
  "utf8"
);

for (const required of [
  "installGlobalAirtableAudit",
  "MUTATION_METHODS",
  "insertAuditEvents",
  "isExcludedTable",
]) {
  if (!wrapper.includes(required)) {
    failures.push(
      `lib/audit-airtable-fetch.ts is missing ${required}`
    );
  }
}

const airtableLibrary = await readFile(
  join(root, "lib", "airtable.ts"),
  "utf8"
);

if (
  !/auditedFetch\s+as\s+fetch/.test(
    airtableLibrary
  )
) {
  failures.push(
    "lib/airtable.ts central wrapper is missing"
  );
}

if (
  !/installGlobalAirtableAudit\s*\(\s*\)/.test(
    airtableLibrary
  )
) {
  failures.push(
    "lib/airtable.ts does not bootstrap the global Airtable audit wrapper"
  );
}

const files = await walk(apiRoot);

for (const filePath of files) {
  const path = normalizedPath(filePath);

  if (
    excludedParts.some((part) =>
      path.includes(part)
    )
  ) {
    continue;
  }

  const source = await readFile(
    filePath,
    "utf8"
  );

  if (!hasRawAirtableMutation(source)) {
    continue;
  }

  detectedMutations.push(
    path.slice(1)
  );

  if (shadowsFetch(source)) {
    failures.push(
      `${path.slice(1)} shadows global fetch and may bypass automatic auditing`
    );
  }
}

if (failures.length) {
  console.error(
    "Airtable audit coverage FAILED:"
  );

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log(
  `Airtable audit coverage PASSED. Global wrapper active; ${detectedMutations.length} direct business mutation route(s) detected.`
);
