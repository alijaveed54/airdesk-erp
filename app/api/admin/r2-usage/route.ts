import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function monthRangeUtc() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)
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

export async function GET() {
  try {
    const session = await getSession();
    const isAdmin =
      session?.role === "Admin" || Boolean(session?.superAdmin);

    if (!session) {
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );
    }

    if (!isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: "Only Admin can view R2 usage",
        },
        { status: 403 }
      );
    }

    const accountId = process.env.R2_ACCOUNT_ID;
    const bucketName = process.env.R2_BUCKET_NAME;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !bucketName || !apiToken) {
      return NextResponse.json(
        {
          success: false,
          message:
            "R2_ACCOUNT_ID, R2_BUCKET_NAME or CLOUDFLARE_API_TOKEN is missing",
        },
        { status: 500 }
      );
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
              sum {
                requests
              }
              dimensions {
                actionType
              }
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
              dimensions {
                datetime
              }
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
      }
    );

    const result = (await response.json()) as GraphQlResponse;

    if (!response.ok || result.errors?.length) {
      const errorMessage =
        result.errors?.map((item) => item.message).filter(Boolean).join("; ") ||
        `Cloudflare API returned HTTP ${response.status}`;

      throw new Error(errorMessage);
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

    return NextResponse.json({
      success: true,
      bucketName,
      period: {
        start: startDate,
        end: endDate,
      },
      storage: {
        usedBytes: storageBytes,
        payloadBytes: payloadSize,
        metadataBytes: metadataSize,
        limitBytes: FREE_LIMITS.storageBytes,
        remainingBytes: remaining(FREE_LIMITS.storageBytes, storageBytes),
        percent: percent(storageBytes, FREE_LIMITS.storageBytes),
        objectCount,
        pendingUploads,
        measuredAt:
          storageRow?.dimensions?.datetime || endDate,
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
      note:
        "Cloudflare GraphQL analytics are estimates and are not the authoritative billing meter.",
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "R2 usage fetch failed",
      },
      { status: 500 }
    );
  }
}
