import type {
  AuditFieldChange,
  JsonValue,
} from "@/lib/audit-types";

const REDACTED = "[REDACTED]";

const SENSITIVE_PARTS = [
  "password",
  "passcode",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "api key",
  "apikey",
  "access key",
  "private key",
  "client secret",
];

function isSensitiveKey(
  key: string
) {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  return SENSITIVE_PARTS.some(
    (part) =>
      normalized.includes(part)
  );
}

function toJsonValue(
  value: unknown,
  seen: WeakSet<object>
): JsonValue {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      toJsonValue(item, seen)
    );
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    const output: Record<
      string,
      JsonValue
    > = {};

    for (const [key, item] of
      Object.entries(
        value as Record<
          string,
          unknown
        >
      )) {
      output[key] = isSensitiveKey(
        key
      )
        ? REDACTED
        : toJsonValue(item, seen);
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}

export function redactAuditValue(
  value: unknown
): JsonValue {
  return toJsonValue(
    value,
    new WeakSet<object>()
  );
}

function stableValue(
  value: JsonValue
): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          stableValue(value[key]),
        ])
    );
  }

  return value;
}

function valuesEqual(
  left: JsonValue,
  right: JsonValue
) {
  return (
    JSON.stringify(
      stableValue(left)
    ) ===
    JSON.stringify(
      stableValue(right)
    )
  );
}

function objectValue(
  value: unknown
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<
    string,
    unknown
  >;
}

export function buildFieldChanges({
  oldFields,
  newFields,
  fieldNames,
}: {
  oldFields: unknown;
  newFields: unknown;
  fieldNames?: string[];
}) {
  const previous = objectValue(
    oldFields
  );
  const next = objectValue(newFields);

  const keys = fieldNames?.length
    ? Array.from(
        new Set(fieldNames)
      )
    : Array.from(
        new Set([
          ...Object.keys(previous),
          ...Object.keys(next),
        ])
      );

  const changes: Record<
    string,
    AuditFieldChange
  > = {};

  for (const key of keys) {
    const oldValue = isSensitiveKey(
      key
    )
      ? REDACTED
      : redactAuditValue(
          previous[key]
        );

    const newValue = isSensitiveKey(
      key
    )
      ? REDACTED
      : redactAuditValue(next[key]);

    if (
      !valuesEqual(
        oldValue,
        newValue
      )
    ) {
      changes[key] = {
        old: oldValue,
        new: newValue,
      };
    }
  }

  return changes;
}

export function parseLegacyValue(
  value?: string
): JsonValue {
  if (!value) {
    return null;
  }

  try {
    return redactAuditValue(
      JSON.parse(value)
    );
  } catch {
    return redactAuditValue(value);
  }
}
