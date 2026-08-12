import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  AuditEvent,
} from "@/lib/audit-types";

const PREFIX = "audit-pending";

function getR2Config() {
  const accountId =
    process.env.R2_ACCOUNT_ID;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY;
  const bucket =
    process.env.R2_BUCKET_NAME;

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket
  ) {
    return null;
  }

  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint:
        `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

function pendingKey() {
  const date = new Date();
  const year = date
    .getUTCFullYear()
    .toString();
  const month = String(
    date.getUTCMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getUTCDate()
  ).padStart(2, "0");

  return (
    `${PREFIX}/${year}/${month}/` +
    `${day}/${crypto.randomUUID()}.json`
  );
}

export async function savePendingAuditBatch({
  events,
  error,
}: {
  events: AuditEvent[];
  error: unknown;
}) {
  const config = getR2Config();

  if (!config) {
    return false;
  }

  const message =
    error instanceof Error
      ? error.message
      : String(error || "Unknown error");

  await config.client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: pendingKey(),
      Body: JSON.stringify({
        version: 1,
        createdAt:
          new Date().toISOString(),
        error: message,
        events,
      }),
      ContentType:
        "application/json",
      CacheControl: "no-store",
      Metadata: {
        source:
          "mysmar-airtable-audit",
      },
    })
  );

  return true;
}

export async function listPendingAuditKeys(
  limit = 50
) {
  const config = getR2Config();

  if (!config) {
    return [];
  }

  const response =
    await config.client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `${PREFIX}/`,
        MaxKeys: Math.min(
          Math.max(limit, 1),
          1000
        ),
      })
    );

  return (response.Contents || [])
    .map((item: { Key?: string }) => item.Key || "")
    .filter(Boolean);
}

export async function readPendingAuditBatch(
  key: string
) {
  const config = getR2Config();

  if (!config) {
    return null;
  }

  const response =
    await config.client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );

  const text =
    await response.Body?.transformToString();

  if (!text) {
    return null;
  }

  const parsed = JSON.parse(text) as {
    events?: AuditEvent[];
  };

  return Array.isArray(parsed.events)
    ? parsed.events
    : [];
}

export async function deletePendingAuditKey(
  key: string
) {
  const config = getR2Config();

  if (!config) {
    return;
  }

  await config.client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );
}
