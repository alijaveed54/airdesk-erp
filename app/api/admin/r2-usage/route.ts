import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FREE_LIMITS = {
  storageBytes: 10 * 1024 * 1024 * 1024,
  classA: 1_000_000,
  classB: 10_000_000,
} as const;

const CLASS_A_ACTIONS = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const CLASS_B_ACTIONS = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

type OperationRow = {
  sum?: { requests?: number | null } | null;
  dimensions?: { actionType?: string | null } | null;
};

type StorageRow = {
  max?: {
    objectCount?: number | null;
    uploadCount?: number | null;
    payloadSize?: number | null;
    metadataSize?: number | null;
  } | null;
  dimensions?: { datetime?: string | null } | null;
};

type GraphQlResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2OperationsAdaptiveGroups?: OperationRow[];
        r2StorageAdaptiveGroups?: StorageRow[];
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ListedObject = {
  key: string;
  size: number;
  lastModified: string;
};

type ExplorerFolder = {
  name: string;
  prefix: string;
  objectCount: number;
  totalSize: number;
  latestModified: string;
};

type ExplorerObject = {
  name: string;
  key: string;
  size: number;
  lastModified: string;
};

function monthRangeUtc() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );

  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
  };
}

function remaining(limit: number, used: number) {
  return Math.max(0, limit - used);
}

function percent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  const isAdmin =
    String(session.role || "").trim().toLowerCase() === "admin" ||
    Boolean(session.superAdmin);

  if (!isAdmin) {
    throw { status: 403, message: "Only Admin can manage R2 storage" };
  }

  return session;
}

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY or R2_BUCKET_NAME is missing",
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  };
}

function getR2Client(config: ReturnType<typeof getR2Config>) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function normalizePrefix(value: unknown) {
  const raw = String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");

  if (!raw) return "";
  if (raw.includes("..")) {
    throw { status: 400, message: "Invalid R2 prefix" };
  }

  return raw.endsWith("/") ? raw : `${raw}/`;
}

function normalizeKey(value: unknown) {
  const raw = String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");

  if (!raw || raw.includes("..") || raw.endsWith("/")) {
    throw { status: 400, message: "Invalid R2 object key" };
  }

  return raw;
}

async function listAllObjects({
  client,
  bucketName,
  prefix,
}: {
  client: S3Client;
  bucketName: string;
  prefix: string;
}) {
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const object of response.Contents || []) {
      if (!object.Key || object.Key.endsWith("/")) continue;

      objects.push({
        key: object.Key,
        size: Number(object.Size || 0),
        lastModified: object.LastModified?.toISOString() || "",
      });
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return objects;
}

function buildExplorer(objects: ListedObject[], currentPrefix: string) {
  const folderMap = new Map<string, ExplorerFolder>();
  const directObjects: ExplorerObject[] = [];

  for (const object of objects) {
    const relativeKey = currentPrefix
      ? object.key.slice(currentPrefix.length)
      : object.key;

    if (!relativeKey) continue;

    const slashIndex = relativeKey.indexOf("/");

    if (slashIndex === -1) {
      directObjects.push({
        name: relativeKey,
        key: object.key,
        size: object.size,
        lastModified: object.lastModified,
      });
      continue;
    }

    const childName = relativeKey.slice(0, slashIndex);
    const childPrefix = `${currentPrefix}${childName}/`;
    const current = folderMap.get(childPrefix) || {
      name: childName,
      prefix: childPrefix,
      objectCount: 0,
      totalSize: 0,
      latestModified: "",
    };

    current.objectCount += 1;
    current.totalSize += object.size;
    if (object.lastModified > current.latestModified) {
      current.latestModified = object.lastModified;
    }

    folderMap.set(childPrefix, current);
  }

  const folders = Array.from(folderMap.values()).sort(
    (a, b) => b.totalSize - a.totalSize || a.name.localeCompare(b.name),
  );

  directObjects.sort(
    (a, b) => b.size - a.size || a.name.localeCompare(b.name),
  );

  const totalSize = objects.reduce((sum, object) => sum + object.size, 0);
  const latestModified = objects.reduce(
    (latest, object) =>
      object.lastModified > latest ? object.lastModified : latest,
    "",
  );

  return {
    currentPrefix,
    parentPrefix: currentPrefix
      ? (() => {
          const withoutTrailing = currentPrefix.replace(/\/$/, "");
          const lastSlash = withoutTrailing.lastIndexOf("/");
          return lastSlash >= 0 ? `${withoutTrailing.slice(0, lastSlash + 1)}` : "";
        })()
      : "",
    totalObjects: objects.length,
    totalSize,
    latestModified,
    folders,
    objects: directObjects.slice(0, 500),
    objectsTruncated: directObjects.length > 500,
    directObjectCount: directObjects.length,
  };
}

async function loadCloudflareUsage({
  accountId,
  bucketName,
}: {
  accountId: string;
  bucketName: string;
}) {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!apiToken) {
    return {
      available: false as const,
      message: "CLOUDFLARE_API_TOKEN is missing; exact R2 object explorer still works.",
    };
  }

  const { startDate, endDate } = monthRangeUtc();
  const query = `
    query R2Usage(
      $accountTag: string!
      $startDate: Time
      $endDate: Time
      $bucketName: string
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: {
              datetime_geq: $startDate
              datetime_leq: $endDate
              bucketName: $bucketName
            }
          ) {
            sum { requests }
            dimensions { actionType }
          }
          r2StorageAdaptiveGroups(
            limit: 1
            filter: {
              datetime_geq: $startDate
              datetime_leq: $endDate
              bucketName: $bucketName
            }
            orderBy: [datetime_DESC]
          ) {
            max {
              objectCount
              uploadCount
              payloadSize
              metadataSize
            }
            dimensions { datetime }
          }
        }
      }
    }
  `;

  const response = await fetch(
    "https://api.cloudflare.com/client/v4/graphql",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          bucketName,
          startDate,
          endDate,
        },
      }),
      cache: "no-store",
    },
  );

  const result = (await response.json()) as GraphQlResponse;

  if (!response.ok || result.errors?.length) {
    return {
      available: false as const,
      message:
        result.errors?.map((item) => item.message).filter(Boolean).join("; ") ||
        `Cloudflare API returned HTTP ${response.status}`,
    };
  }

  const account = result.data?.viewer?.accounts?.[0];
  const operations = account?.r2OperationsAdaptiveGroups || [];
  const storageRow = account?.r2StorageAdaptiveGroups?.[0];

  let classA = 0;
  let classB = 0;
  let freeOperations = 0;
  let unclassified = 0;

  const operationBreakdown = operations
    .map((row) => {
      const actionType = String(row.dimensions?.actionType || "Unknown");
      const requests = Number(row.sum?.requests || 0);

      if (CLASS_A_ACTIONS.has(actionType)) {
        classA += requests;
        return { actionType, requests, class: "A" };
      }

      if (CLASS_B_ACTIONS.has(actionType)) {
        classB += requests;
        return { actionType, requests, class: "B" };
      }

      if (
        actionType === "DeleteObject" ||
        actionType === "DeleteBucket" ||
        actionType === "AbortMultipartUpload"
      ) {
        freeOperations += requests;
        return { actionType, requests, class: "Free" };
      }

      unclassified += requests;
      return { actionType, requests, class: "Other" };
    })
    .sort((a, b) => b.requests - a.requests);

  const payloadSize = Number(storageRow?.max?.payloadSize || 0);
  const metadataSize = Number(storageRow?.max?.metadataSize || 0);
  const storageBytes = payloadSize + metadataSize;
  const objectCount = Number(storageRow?.max?.objectCount || 0);
  const pendingUploads = Number(storageRow?.max?.uploadCount || 0);

  return {
    available: true as const,
    period: { start: startDate, end: endDate },
    storage: {
      usedBytes: storageBytes,
      payloadBytes: payloadSize,
      metadataBytes: metadataSize,
      limitBytes: FREE_LIMITS.storageBytes,
      remainingBytes: remaining(FREE_LIMITS.storageBytes, storageBytes),
      percent: percent(storageBytes, FREE_LIMITS.storageBytes),
      objectCount,
      pendingUploads,
      measuredAt: storageRow?.dimensions?.datetime || endDate,
    },
    operations: {
      classA: {
        used: classA,
        limit: FREE_LIMITS.classA,
        remaining: remaining(FREE_LIMITS.classA, classA),
        percent: percent(classA, FREE_LIMITS.classA),
      },
      classB: {
        used: classB,
        limit: FREE_LIMITS.classB,
        remaining: remaining(FREE_LIMITS.classB, classB),
        percent: percent(classB, FREE_LIMITS.classB),
      },
      freeOperations,
      unclassified,
      breakdown: operationBreakdown,
    },
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const requestUrl = new URL(request.url);
    const prefix = normalizePrefix(requestUrl.searchParams.get("prefix") || "");
    const uploadDate = String(requestUrl.searchParams.get("date") || "").trim();
    const config = getR2Config();
    const client = getR2Client(config);

    const [objects, cloudflare] = await Promise.all([
      listAllObjects({
        client,
        bucketName: config.bucketName,
        prefix,
      }),
      loadCloudflareUsage({
        accountId: config.accountId,
        bucketName: config.bucketName,
      }),
    ]);

    const filteredObjects = uploadDate
      ? objects.filter((object) =>
          object.lastModified.slice(0, 10) === uploadDate,
        )
      : objects;

    const explorer = buildExplorer(filteredObjects, prefix);

    return NextResponse.json({
      success: true,
      bucketName: config.bucketName,
      explorer,
      cloudflare,
      note:
        "Folder/object sizes are calculated from live R2 object listings. Cloudflare GraphQL analytics are estimates and are not the authoritative billing meter.",
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    const known = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          (error instanceof Error ? error.message : "R2 usage fetch failed"),
      },
      { status: known?.status || 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json()) as {
      key?: string;
      prefix?: string;
      prefixes?: string[];
      confirm?: string;
    };

    const bulkPrefixes = Array.isArray(body.prefixes)
      ? body.prefixes.filter(Boolean)
      : [];

    const hasKey = Boolean(String(body.key || "").trim());
    const hasPrefix = Boolean(String(body.prefix || "").trim());
    const hasBulk = bulkPrefixes.length > 0;

    if ([hasKey, hasPrefix, hasBulk].filter(Boolean).length !== 1) {
      return NextResponse.json(
        {
          success: false,
          message: "Send exactly one delete target: key, prefix or prefixes",
        },
        { status: 400 },
      );
    }

    if (String(body.confirm || "") !== "DELETE") {
      return NextResponse.json(
        {
          success: false,
          message: 'Deletion confirmation is required: confirm must equal "DELETE"',
        },
        { status: 400 },
      );
    }

    const config = getR2Config();
    const client = getR2Client(config);
    let keys: ListedObject[] = [];
    let target = "";

    if (hasKey) {
      const key = normalizeKey(body.key);
      target = key;

      const parentPrefix = key.includes("/")
        ? key.slice(0, key.lastIndexOf("/") + 1)
        : "";
      const candidates = await listAllObjects({
        client,
        bucketName: config.bucketName,
        prefix: parentPrefix,
      });
      keys = candidates.filter((object) => object.key === key);
    } else if (hasBulk) {
      const prefixes = bulkPrefixes.map((item) => normalizePrefix(item));

      if (prefixes.some((item) => !item || item === "/")) {
        return NextResponse.json(
          {
            success: false,
            message: "Full bucket deletion is blocked",
          },
          { status: 400 },
        );
      }

      target = `${prefixes.length} folders`;

      const results = await Promise.all(
        prefixes.map((prefix) =>
          listAllObjects({
            client,
            bucketName: config.bucketName,
            prefix,
          }),
        ),
      );

      keys = results.flat();
    } else {
      const prefix = normalizePrefix(body.prefix);

      if (!prefix || prefix === "/") {
        return NextResponse.json(
          {
            success: false,
            message: "Full bucket deletion is blocked",
          },
          { status: 400 },
        );
      }

      target = prefix;
      keys = await listAllObjects({
        client,
        bucketName: config.bucketName,
        prefix,
      });
    }

    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, message: "No matching R2 objects found" },
        { status: 404 },
      );
    }

    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);

      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucketName,
          Delete: {
            Objects: batch.map((object) => ({ Key: object.key })),
            Quiet: true,
          },
        }),
      );
    }

    const deletedBytes = keys.reduce((sum, object) => sum + object.size, 0);

    return NextResponse.json({
      success: true,
      target,
      deletedCount: keys.length,
      deletedBytes,
      message: `${keys.length} R2 object(s) deleted successfully`,
    });
  } catch (error) {
    const known = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          (error instanceof Error ? error.message : "R2 delete failed"),
      },
      { status: known?.status || 500 },
    );
  }
}


export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json()) as {
      prefixes?: string[];
      destination?: string;
    };

    const prefixes = Array.isArray(body.prefixes)
      ? body.prefixes.map((item) => normalizePrefix(item))
      : [];

    const destination = normalizePrefix(body.destination || "");

    if (!prefixes.length || !destination) {
      return NextResponse.json(
        { success: false, message: "Source folders and destination are required" },
        { status: 400 },
      );
    }

    const config = getR2Config();
    const client = getR2Client(config);

    let movedCount = 0;

    for (const prefix of prefixes) {
      const objects = await listAllObjects({
        client,
        bucketName: config.bucketName,
        prefix,
      });

      for (const object of objects) {
        const newKey = `${destination}${object.key.slice(prefix.length)}`;

        await client.send(
          new CopyObjectCommand({
            Bucket: config.bucketName,
            CopySource: `${config.bucketName}/${object.key}`,
            Key: newKey,
          }),
        );

        movedCount++;
      }

      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucketName,
          Delete: {
            Objects: objects.map((object) => ({ Key: object.key })),
            Quiet: true,
          },
        }),
      );
    }

    return NextResponse.json({
      success: true,
      movedCount,
    });
  } catch (error) {
    const known = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          (error instanceof Error ? error.message : "R2 move failed"),
      },
      { status: known?.status || 500 },
    );
  }
}
