
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { airtableFetch } from "@/lib/airtable";

export const FACEBOOK_BATCH_PREFIX =
  "facebook-batches";

export const FACEBOOK_BATCH_INDEX_PREFIX =
  "facebook-batch-index";

export const FACEBOOK_BATCH_MAX_IMAGES =
  Math.min(
    Math.max(
      Number(
        process.env
          .FACEBOOK_BATCH_MAX_IMAGES ||
          40
      ) || 40,
      1
    ),
    80
  );

export const FACEBOOK_BATCH_DELETE_MEDIA_AFTER_SUCCESS =
  String(
    process.env
      .FACEBOOK_BATCH_DELETE_MEDIA_AFTER_SUCCESS ||
      "true"
  )
    .trim()
    .toLowerCase() !== "false";

export type FacebookBatchStatus =
  | "creating"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed";

export type FacebookBatchJobStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type FacebookBatchManifest = {
  id: string;
  name: string;
  status: FacebookBatchStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  groupCount: number;
  postCount: number;
  totalJobs: number;
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  totalImages: number;
  totalVideos?: number;
  lastError?: string;
};

export type FacebookBatchJob = {
  id: string;
  batchId: string;
  groupId: string;
  postId: string;
  groupNumber: number;
  postNumber: number;
  pageRecordId: string;
  pageName: string;
  pageId: string;
  message: string;
  imageUrls: string[];
  imageNames: string[];
  videoUrl?: string;
  videoName?: string;
  videoPosition?: "first" | "last";
  status: FacebookBatchJobStatus;
  priority?: number;
  notBefore: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  facebookPostId?: string;
  facebookImagePostId?: string;
  facebookVideoPostId?: string;
  lastError?: string;
};

export type FacebookPageConfig = {
  recordId: string;
  pageName: string;
  pageId: string;
  pageToken: string;
  active: boolean;
  defaultCaption: string;
};

type R2Config = {
  client: S3Client;
  bucketName: string;
  publicUrl: string;
};

let cachedR2Config:
  | R2Config
  | null = null;

function getR2Config(): R2Config {
  if (cachedR2Config) {
    return cachedR2Config;
  }

  const accountId =
    process.env.R2_ACCOUNT_ID || "";
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY || "";
  const bucketName =
    process.env.R2_BUCKET_NAME || "";
  const publicUrl =
    process.env.R2_PUBLIC_URL || "";

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !publicUrl
  ) {
    throw new Error(
      "R2 environment variables missing hain."
    );
  }

  cachedR2Config = {
    bucketName,
    publicUrl: publicUrl.replace(
      /\/+$/,
      ""
    ),
    client: new S3Client({
      region: "auto",
      endpoint:
        `https://${accountId}` +
        ".r2.cloudflarestorage.com",
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };

  return cachedR2Config;
}

function safeIdentifier(
  value: string,
  label: string
) {
  const clean = String(value || "")
    .trim()
    .replace(
      /[^A-Za-z0-9_-]+/g,
      "-"
    )
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);

  if (!clean) {
    throw new Error(
      `${label} invalid hai.`
    );
  }

  return clean;
}

function safeFileName(
  fileName: string
) {
  const clean = String(
    fileName || "image"
  )
    .trim()
    .replace(
      /[^A-Za-z0-9._-]+/g,
      "-"
    )
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);

  return clean || "image";
}

export function batchManifestKey(
  batchId: string
) {
  return (
    `${FACEBOOK_BATCH_PREFIX}/` +
    `${safeIdentifier(
      batchId,
      "Batch ID"
    )}/batch.json`
  );
}


export function batchIndexKey(
  batchId: string
) {
  return (
    `${FACEBOOK_BATCH_INDEX_PREFIX}/` +
    `${safeIdentifier(
      batchId,
      "Batch ID"
    )}.json`
  );
}

export function batchJobKey(
  batchId: string,
  jobId: string
) {
  return (
    `${FACEBOOK_BATCH_PREFIX}/` +
    `${safeIdentifier(
      batchId,
      "Batch ID"
    )}/jobs/` +
    `${safeIdentifier(
      jobId,
      "Job ID"
    )}.json`
  );
}

export function batchMediaKey(
  batchId: string,
  postId: string,
  fileName: string
) {
  return (
    `${FACEBOOK_BATCH_PREFIX}/` +
    `${safeIdentifier(
      batchId,
      "Batch ID"
    )}/media/` +
    `${safeIdentifier(
      postId,
      "Post ID"
    )}/` +
    `${crypto.randomUUID()}-` +
    `${safeFileName(fileName)}`
  );
}

export async function putBatchJson(
  key: string,
  value: unknown
) {
  const {
    client,
    bucketName,
  } = getR2Config();

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(
        value,
        null,
        2
      ),
      ContentType:
        "application/json; charset=utf-8",
      CacheControl:
        "no-store, max-age=0",
    })
  );
}

async function bodyToString(
  body: unknown
) {
  if (!body) {
    return "";
  }

  const stream =
    body as {
      transformToString?: (
        encoding?: string
      ) => Promise<string>;
      [Symbol.asyncIterator]?: () =>
        AsyncIterator<Uint8Array>;
    };

  if (
    typeof stream.transformToString ===
    "function"
  ) {
    return stream.transformToString(
      "utf-8"
    );
  }

  if (
    typeof stream[
      Symbol.asyncIterator
    ] === "function"
  ) {
    const chunks: Buffer[] = [];

    for await (
      const chunk of stream as AsyncIterable<Uint8Array>
    ) {
      chunks.push(
        Buffer.from(chunk)
      );
    }

    return Buffer.concat(
      chunks
    ).toString("utf-8");
  }

  throw new Error(
    "R2 response body read nahi ho saki."
  );
}

export async function getBatchJson<
  T
>(
  key: string
): Promise<T | null> {
  const {
    client,
    bucketName,
  } = getR2Config();

  try {
    const response =
      await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

    const text =
      await bodyToString(
        response.Body
      );

    if (!text.trim()) {
      return null;
    }

    return JSON.parse(text) as T;
  } catch (error) {
    const name = String(
      (
        error as {
          name?: string;
        }
      )?.name || ""
    );

    const status =
      Number(
        (
          error as {
            $metadata?: {
              httpStatusCode?: number;
            };
          }
        )?.$metadata
          ?.httpStatusCode || 0
      );

    if (
      name === "NoSuchKey" ||
      status === 404
    ) {
      return null;
    }

    throw error;
  }
}

export async function listBatchKeys(
  prefix: string
) {
  const {
    client,
    bucketName,
  } = getR2Config();

  const keys: string[] = [];
  let continuationToken:
    | string
    | undefined;

  do {
    const response =
      await client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken:
            continuationToken,
          MaxKeys: 1000,
        })
      );

    for (
      const item of
        response.Contents || []
    ) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    continuationToken =
      response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
  } while (continuationToken);

  return keys;
}

async function mapWithConcurrency<
  T,
  R
>(
  items: T[],
  limit: number,
  worker: (
    item: T,
    index: number
  ) => Promise<R>
) {
  if (items.length === 0) {
    return [] as R[];
  }

  const results =
    new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] =
        await worker(
          items[index],
          index
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          Math.max(1, limit),
          items.length
        ),
      },
      () => runWorker()
    )
  );

  return results;
}

export async function deleteBatchPostMedia(
  batchId: string,
  postId: string
) {
  // MYSMAR_R2_VERIFIED_CLEANUP_V1
  const safeBatchId =
    safeIdentifier(
      batchId,
      "Batch ID"
    );

  const safePostId =
    safeIdentifier(
      postId,
      "Post ID"
    );

  const prefix =
    `${FACEBOOK_BATCH_PREFIX}/` +
    `${safeBatchId}/media/` +
    `${safePostId}/`;

  let remainingKeys =
    await listBatchKeys(prefix);
  const initialCount =
    remainingKeys.length;

  if (initialCount === 0) {
    return 0;
  }

  const {
    client,
    bucketName,
  } = getR2Config();

  for (
    let attempt = 1;
    attempt <= 3 &&
    remainingKeys.length > 0;
    attempt += 1
  ) {
    for (
      let index = 0;
      index < remainingKeys.length;
      index += 1000
    ) {
      const batch =
        remainingKeys.slice(
          index,
          index + 1000
        );

      const response =
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects:
                batch.map(
                  (Key) => ({ Key })
                ),
              Quiet: false,
            },
          })
        );

      if (
        response.Errors &&
        response.Errors.length > 0
      ) {
        console.error(
          "Facebook batch R2 delete returned object errors:",
          response.Errors
        );
      }
    }

    remainingKeys =
      await listBatchKeys(prefix);

    if (
      remainingKeys.length > 0 &&
      attempt < 3
    ) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          attempt * 300
        )
      );
    }
  }

  if (remainingKeys.length > 0) {
    throw new Error(
      `R2 media cleanup incomplete for ${safeBatchId}/${safePostId}: ${remainingKeys.length} object(s) remain after 3 attempts.`
    );
  }

  return initialCount;
}

export async function cleanupCompletedPostMedia(
  batchId: string,
  postId: string
) {
  if (
    !FACEBOOK_BATCH_DELETE_MEDIA_AFTER_SUCCESS
  ) {
    return {
      eligible: false,
      deletedCount: 0,
      reason: "disabled",
    };
  }

  const jobs =
    await getBatchJobs(batchId);

  const relatedJobs =
    jobs.filter(
      (job) =>
        job.postId === postId
    );

  if (
    relatedJobs.length === 0
  ) {
    return {
      eligible: false,
      deletedCount: 0,
      reason: "no-related-jobs",
    };
  }

  const allCompleted =
    relatedJobs.every(
      (job) =>
        job.status ===
        "completed"
    );

  if (!allCompleted) {
    return {
      eligible: false,
      deletedCount: 0,
      reason:
        "related-jobs-not-completed",
    };
  }

  const deletedCount =
    await deleteBatchPostMedia(
      batchId,
      postId
    );

  return {
    eligible: true,
    deletedCount,
    reason: "completed",
  };
}

export async function putBatchMedia(
  input: {
    batchId: string;
    postId: string;
    fileName: string;
    contentType: string;
    bytes: Buffer;
  }
) {
  const {
    client,
    bucketName,
    publicUrl,
  } = getR2Config();

  const key = batchMediaKey(
    input.batchId,
    input.postId,
    input.fileName
  );

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: input.bytes,
      ContentType:
        input.contentType,
      CacheControl:
        "public, max-age=31536000, immutable",
      ContentDisposition: "inline",
      Metadata: {
        batch_id:
          safeIdentifier(
            input.batchId,
            "Batch ID"
          ),
        post_id:
          safeIdentifier(
            input.postId,
            "Post ID"
          ),
        original_file_name:
          safeFileName(
            input.fileName
          ),
      },
    })
  );

  return {
    key,
    url: `${publicUrl}/${key}`,
  };
}

export async function saveBatch(
  batch: FacebookBatchManifest
) {
  await Promise.all([
    putBatchJson(
      batchManifestKey(
        batch.id
      ),
      batch
    ),
    putBatchJson(
      batchIndexKey(
        batch.id
      ),
      batch
    ),
  ]);

  return batch;
}

export async function getBatch(
  batchId: string
) {
  return getBatchJson<
    FacebookBatchManifest
  >(
    batchManifestKey(batchId)
  );
}

export async function saveBatchJob(
  job: FacebookBatchJob
) {
  await putBatchJson(
    batchJobKey(
      job.batchId,
      job.id
    ),
    job
  );

  return job;
}

export async function getBatchJobs(
  batchId: string
) {
  const safeBatchId =
    safeIdentifier(
      batchId,
      "Batch ID"
    );

  const prefix =
    `${FACEBOOK_BATCH_PREFIX}/` +
    `${safeBatchId}/jobs/`;

  const keys = (
    await listBatchKeys(prefix)
  ).filter((key) =>
    key.endsWith(".json")
  );

  const jobs =
    await mapWithConcurrency(
      keys,
      8,
      async (key) =>
        getBatchJson<
          FacebookBatchJob
        >(key)
    );

  return jobs
    .filter(
      (
        job
      ): job is FacebookBatchJob =>
        Boolean(job)
    )
    .sort((first, second) => {
      const priorityDifference =
        Number(second.priority || 0) -
        Number(first.priority || 0);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const timeDifference =
        new Date(first.notBefore).getTime() -
        new Date(second.notBefore).getTime();

      if (timeDifference !== 0) {
        return timeDifference;
      }

      if (first.groupNumber !== second.groupNumber) {
        return first.groupNumber - second.groupNumber;
      }

      if (first.postNumber !== second.postNumber) {
        return first.postNumber - second.postNumber;
      }

      return first.id.localeCompare(second.id);
    });
}

export async function listBatches() {
  const keys = (
    await listBatchKeys(
      `${FACEBOOK_BATCH_INDEX_PREFIX}/`
    )
  ).filter((key) =>
    key.endsWith(".json")
  );

  const manifests =
    await mapWithConcurrency(
      keys,
      8,
      async (key) =>
        getBatchJson<
          FacebookBatchManifest
        >(key)
    );

  return manifests
    .filter(
      (
        item
      ): item is FacebookBatchManifest =>
        Boolean(item)
    )
    .sort(
      (first, second) =>
        new Date(
          second.createdAt
        ).getTime() -
        new Date(
          first.createdAt
        ).getTime()
    );
}

function summarizeJobs(
  jobs: FacebookBatchJob[]
) {
  return {
    totalJobs: jobs.length,
    queuedJobs: jobs.filter(
      (job) =>
        job.status === "queued" ||
        job.status === "retrying"
    ).length,
    processingJobs: jobs.filter(
      (job) =>
        job.status === "processing"
    ).length,
    completedJobs: jobs.filter(
      (job) =>
        job.status === "completed"
    ).length,
    failedJobs: jobs.filter(
      (job) =>
        job.status === "failed"
    ).length,
    cancelledJobs: jobs.filter(
      (job) =>
        job.status === "cancelled"
    ).length,
  };
}

export async function refreshBatchSummary(
  batchId: string
) {
  const batch =
    await getBatch(batchId);

  if (!batch) {
    throw new Error(
      "Facebook batch nahi mila."
    );
  }

  const jobs =
    await getBatchJobs(batchId);

  const summary =
    summarizeJobs(jobs);

  const now =
    new Date().toISOString();

  let status =
    batch.status;

  if (
    status !== "paused" &&
    status !== "cancelled" &&
    status !== "failed"
  ) {
    if (
      summary.totalJobs > 0 &&
      summary.completedJobs ===
        summary.totalJobs
    ) {
      status = "completed";
    } else if (
      summary.processingJobs > 0
    ) {
      status = "processing";
    } else if (
      summary.queuedJobs > 0
    ) {
      status = "queued";
    } else if (
      summary.failedJobs > 0
    ) {
      status = "partial";
    }
  }

  const updated:
    FacebookBatchManifest = {
      ...batch,
      ...summary,
      status,
      updatedAt: now,
      startedAt:
        batch.startedAt ||
        (
          summary.processingJobs > 0 ||
          summary.completedJobs > 0
            ? now
            : undefined
        ),
      completedAt:
        status === "completed" ||
        status === "partial"
          ? batch.completedAt ||
            now
          : undefined,
    };

  await saveBatch(updated);

  return {
    batch: updated,
    jobs,
  };
}

function getAdminBaseConfig() {
  const baseId =
    process.env.ERP_ADMIN_AIRTABLE_BASE_ID ||
    process.env.ERP_ADMIN_BASE_ID ||
    process.env.AIRTABLE_ADMIN_BASE_ID ||
    process.env.AUTH_AIRTABLE_BASE_ID ||
    process.env.AIRTABLE_BASE_ID ||
    "";

  const token =
    process.env.ERP_ADMIN_AIRTABLE_TOKEN ||
    process.env.AIRTABLE_ADMIN_TOKEN ||
    process.env.AIRTABLE_TOKEN ||
    process.env.AUTH_AIRTABLE_TOKEN ||
    "";

  if (!baseId || !token) {
    throw new Error(
      "Facebook Page Airtable configuration missing hai."
    );
  }

  return {
    baseId,
    token,
  };
}

function stringValue(
  value: unknown
) {
  if (Array.isArray(value)) {
    return String(
      value[0] ?? ""
    ).trim();
  }

  return String(
    value ?? ""
  ).trim();
}

export async function loadFacebookPage(
  recordId: string
): Promise<FacebookPageConfig> {
  const {
    baseId,
    token,
  } = getAdminBaseConfig();

  const table =
    process.env.FACEBOOK_PAGES_TABLE ||
    process.env.FACEBOOK_PAGES_TABLE_NAME ||
    "Facebook Pages";

  const record =
    await airtableFetch({
      baseId,
      token,
      table,
      recordId,
    }) as {
      id: string;
      fields?: Record<
        string,
        unknown
      >;
    };

  const fields =
    record.fields || {};

  return {
    recordId:
      record.id,
    pageName:
      stringValue(
        fields["Page Name"]
      ),
    pageId:
      stringValue(
        fields["Page ID"]
      ),
    pageToken:
      stringValue(
        fields["Page Token"]
      ),
    active:
      fields.Active !== false,
    defaultCaption:
      stringValue(
        fields["Default Caption"]
      ),
  };
}

function getFacebookGraphVersion() {
  const configured = String(
    process.env
      .FACEBOOK_GRAPH_API_VERSION ||
      "v25.0"
  )
    .trim()
    .replace(
      /^https?:\/\/graph\.facebook\.com\//i,
      ""
    )
    .replace(
      /^\/+|\/+$/g,
      ""
    );

  if (!configured) {
    return "v25.0";
  }

  return configured
    .toLowerCase()
    .startsWith("v")
    ? configured
    : `v${configured}`;
}

function graphUrl(
  pathValue: string
) {
  const cleanPath = String(
    pathValue || ""
  )
    .trim()
    .replace(
      /^\/+|\/+$/g,
      ""
    );

  if (!cleanPath) {
    throw new Error(
      "Facebook Graph path missing hai."
    );
  }

  return (
    "https://graph.facebook.com/" +
    `${getFacebookGraphVersion()}/` +
    cleanPath
  );
}

function facebookErrorMessage(
  data: any,
  fallback: string
) {
  const message = String(
    data?.error?.message ||
      fallback
  ).trim();

  const details = [
    data?.error?.type
      ? `type: ${data.error.type}`
      : "",
    data?.error?.code !==
    undefined
      ? `code: ${data.error.code}`
      : "",
    data?.error?.error_subcode !==
    undefined
      ? `subcode: ${data.error.error_subcode}`
      : "",
  ].filter(Boolean);

  return details.length
    ? `${message} (${details.join(
        ", "
      )})`
    : message;
}

async function graphRequest(
  pathValue: string,
  pageToken: string,
  options: {
    method: "GET" | "POST";
    params?: Record<
      string,
      string
    >;
  }
) {
  const url =
    new URL(
      graphUrl(pathValue)
    );

  const params = {
    ...(options.params || {}),
    access_token:
      pageToken,
  };

  let response:
    Response;

  if (
    options.method === "GET"
  ) {
    for (
      const [
        key,
        value,
      ] of Object.entries(
        params
      )
    ) {
      url.searchParams.set(
        key,
        value
      );
    }

    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body:
        new URLSearchParams(
          params
        ),
      cache: "no-store",
    });
  }

  const data =
    await response
      .json()
      .catch(() => null);

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      facebookErrorMessage(
        data,
        "Facebook Graph request failed."
      )
    );
  }

  return data;
}

async function verifyPageToken(
  page: FacebookPageConfig
) {
  const data =
    await graphRequest(
      "me",
      page.pageToken,
      {
        method: "GET",
        params: {
          fields: "id,name",
        },
      }
    );

  const tokenPageId =
    String(
      data?.id || ""
    ).trim();

  if (!tokenPageId) {
    throw new Error(
      "Facebook token se Page ID nahi mili."
    );
  }

  if (
    tokenPageId !==
    page.pageId
  ) {
    throw new Error(
      `Token Page ID ${tokenPageId} ka hai; ` +
      `selected Page ${page.pageId} hai.`
    );
  }
}

async function publishImageUrls(
  page: FacebookPageConfig,
  imageUrls: string[]
) {
  // Upload one-by-one in the order saved in the Page-specific batch job.
  // Concurrent uploads can cause Facebook to render the multi-photo post by
  // photo creation order instead of the intended attached_media sequence.
  const mediaIds: string[] = [];

  for (const imageUrl of imageUrls) {
    const upload =
      await graphRequest(
        "me/photos",
        page.pageToken,
        {
          method: "POST",
          params: {
            url: imageUrl,
            published:
              "false",
          },
        }
      );

    const mediaId =
      String(
        upload?.id || ""
      ).trim();

    if (!mediaId) {
      throw new Error(
        "Facebook image media ID receive nahi hui."
      );
    }

    mediaIds.push(mediaId);
  }

  return mediaIds;
}

class FacebookBatchPublishError extends Error {
  facebookImagePostId: string;
  facebookVideoPostId: string;

  constructor(
    message: string,
    facebookImagePostId = "",
    facebookVideoPostId = ""
  ) {
    super(message);
    this.name = "FacebookBatchPublishError";
    this.facebookImagePostId =
      facebookImagePostId;
    this.facebookVideoPostId =
      facebookVideoPostId;
  }
}

async function publishVideoUrl({
  page,
  videoUrl,
  videoName,
  message,
}: {
  page: FacebookPageConfig;
  videoUrl: string;
  videoName: string;
  message: string;
}) {
  const params: Record<string, string> = {
    file_url: videoUrl,
    title:
      videoName.replace(/\.[^.]+$/, "") ||
      "Facebook Video",
    published: "true",
  };

  if (message.trim()) {
    params.description = message.trim();
  }

  const result = await graphRequest(
    "me/videos",
    page.pageToken,
    {
      method: "POST",
      params,
    }
  );

  const videoPostId = String(
    result?.id || result?.post_id || ""
  ).trim();

  if (!videoPostId) {
    throw new Error(
      "Facebook video ID receive nahi hui."
    );
  }

  return videoPostId;
}

export async function publishBatchJob(
  job: FacebookBatchJob
) {
  const page = await loadFacebookPage(
    job.pageRecordId
  );

  if (!page.active) {
    throw new Error(
      `${page.pageName} inactive hai.`
    );
  }

  if (!page.pageId || !page.pageToken) {
    throw new Error(
      "Facebook Page ID ya token missing hai."
    );
  }

  await verifyPageToken(page);

  const imageUrls = Array.from(
    new Set(
      job.imageUrls
        .map((url) => String(url || "").trim())
        .filter((url) => /^https:\/\//i.test(url))
    )
  ).slice(0, FACEBOOK_BATCH_MAX_IMAGES);

  const videoUrl = String(
    job.videoUrl || ""
  ).trim();
  const hasVideo = /^https:\/\//i.test(videoUrl);
  const videoName = String(
    job.videoName || "facebook-video.mp4"
  ).trim() || "facebook-video.mp4";
  const videoPosition =
    job.videoPosition === "first"
      ? "first"
      : "last";

  if (
    imageUrls.length === 0 &&
    !hasVideo &&
    !job.message.trim()
  ) {
    throw new Error(
      "Caption, image ya video required hai."
    );
  }

  let imagePostId = String(
    job.facebookImagePostId || ""
  ).trim();
  let videoPostId = String(
    job.facebookVideoPostId || ""
  ).trim();

  const publishImageOrText = async () => {
    let result: any;

    if (imageUrls.length === 0) {
      if (!job.message.trim() || hasVideo) {
        return "";
      }

      result = await graphRequest(
        "me/feed",
        page.pageToken,
        {
          method: "POST",
          params: {
            message: job.message,
          },
        }
      );
    } else {
      const mediaIds = await publishImageUrls(
        page,
        imageUrls
      );

      const params: Record<string, string> = {
        attached_media: JSON.stringify(
          mediaIds.map((mediaId) => ({
            media_fbid: mediaId,
          }))
        ),
      };

      if (job.message.trim()) {
        params.message = job.message.trim();
      }

      result = await graphRequest(
        "me/feed",
        page.pageToken,
        {
          method: "POST",
          params,
        }
      );
    }

    return String(
      result?.id || result?.post_id || ""
    ).trim();
  };

  const publishVideo = async () => {
    if (!hasVideo) return "";

    return publishVideoUrl({
      page,
      videoUrl,
      videoName,
      message: job.message,
    });
  };

  try {
    if (hasVideo && videoPosition === "first") {
      if (!videoPostId) {
        videoPostId = await publishVideo();
      }
      if (!imagePostId) {
        imagePostId = await publishImageOrText();
      }
    } else {
      if (!imagePostId) {
        imagePostId = await publishImageOrText();
      }
      if (!videoPostId) {
        videoPostId = await publishVideo();
      }
    }
  } catch (error) {
    throw new FacebookBatchPublishError(
      error instanceof Error
        ? error.message
        : "Facebook batch post failed.",
      imagePostId,
      videoPostId
    );
  }

  const facebookPostId = [
    imagePostId,
    videoPostId,
  ]
    .filter(Boolean)
    .join(" | ");

  if (!facebookPostId) {
    throw new Error(
      "Facebook post ID receive nahi hui."
    );
  }

  return {
    page,
    facebookPostId,
    facebookImagePostId: imagePostId,
    facebookVideoPostId: videoPostId,
  };
}

export async function saveBatchHistory(
  input: {
    username: string;
    job: FacebookBatchJob;
    status:
      | "Success"
      | "Failed";
    facebookPostId?: string;
    error?: string;
  }
) {
  const {
    baseId,
    token,
  } = getAdminBaseConfig();

  const table =
    process.env.FACEBOOK_POST_HISTORY_TABLE ||
    process.env.FACEBOOK_POST_HISTORY_TABLE_NAME ||
    process.env.FACEBOOK_HISTORY_TABLE ||
    "Facebook Post History";

  try {
    await airtableFetch({
      baseId,
      token,
      table,
      method: "POST",
      fields: {
        fields: {
          Date:
            new Date()
              .toISOString(),
          User:
            input.username,
          "Page Name":
            input.job.pageName,
          "Page ID":
            input.job.pageId,
          Message:
            input.job.message,
          "Image URLs": [
            ...input.job.imageUrls,
            ...(input.job.videoUrl
              ? [`[Video] ${input.job.videoUrl}`]
              : []),
          ].join("\n"),
          Status:
            input.status,
          "Facebook Post ID":
            input.facebookPostId ||
            "",
          Error:
            input.error || "",
        },
      },
    });
  } catch (error) {
    console.error(
      "Facebook batch history save failed:",
      error
    );
  }
}

function retryDelayMinutes(
  attempts: number
) {
  return Math.min(
    60,
    Math.max(
      5,
      attempts * 10
    )
  );
}

async function recoverStaleJobs(
  jobs: FacebookBatchJob[]
) {
  const staleBefore =
    Date.now() -
    45 * 60 * 1000;

  for (const job of jobs) {
    if (
      job.status !==
      "processing"
    ) {
      continue;
    }

    const startedAt =
      new Date(
        job.startedAt ||
        job.updatedAt
      ).getTime();

    if (
      Number.isFinite(
        startedAt
      ) &&
      startedAt <
        staleBefore
    ) {
      await saveBatchJob({
        ...job,
        status:
          job.attempts <
          job.maxAttempts
            ? "retrying"
            : "failed",
        notBefore:
          new Date(
            Date.now() +
              retryDelayMinutes(
                job.attempts
              ) *
                60 *
                1000
          ).toISOString(),
        lastError:
          "Previous worker execution interrupted.",
        updatedAt:
          new Date()
            .toISOString(),
      });
    }
  }
}

let activeProcessor:
  Promise<{
    processed: number;
    completed: number;
    retried: number;
    failed: number;
    jobs: Array<{
      batchId: string;
      jobId: string;
      status: string;
      message?: string;
    }>;
  }>
  | null = null;

async function processQueueInternal(
  limit: number
) {
  const result = {
    processed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    jobs: [] as Array<{
      batchId: string;
      jobId: string;
      status: string;
      message?: string;
    }>,
  };

  const batches =
    await listBatches();

  for (const batch of batches) {
    if (
      result.processed >=
      limit
    ) {
      break;
    }

    if (
      batch.status ===
        "paused" ||
      batch.status ===
        "cancelled" ||
      batch.status ===
        "completed" ||
      batch.status ===
        "partial" ||
      batch.status ===
        "failed"
    ) {
      continue;
    }

    let jobs =
      await getBatchJobs(
        batch.id
      );

    await recoverStaleJobs(
      jobs
    );

    jobs =
      await getBatchJobs(
        batch.id
      );

    const now =
      Date.now();

    const dueJobs =
      jobs.filter((job) => {
        if (
          job.status !==
            "queued" &&
          job.status !==
            "retrying"
        ) {
          return false;
        }

        return (
          new Date(
            job.notBefore
          ).getTime() <= now
        );
      });

    for (const job of dueJobs) {
      if (
        result.processed >=
        limit
      ) {
        break;
      }

      const currentBatch =
        await getBatch(
          batch.id
        );

      if (
        !currentBatch ||
        currentBatch.status ===
          "paused" ||
        currentBatch.status ===
          "cancelled"
      ) {
        break;
      }

      const startedAt =
        new Date()
          .toISOString();

      const processingJob:
        FacebookBatchJob = {
          ...job,
          status: "processing",
          attempts:
            job.attempts + 1,
          startedAt,
          updatedAt:
            startedAt,
          lastError: "",
        };

      await saveBatchJob(
        processingJob
      );

      await saveBatch({
        ...currentBatch,
        status: "processing",
        startedAt:
          currentBatch.startedAt ||
          startedAt,
        updatedAt:
          startedAt,
      });

      result.processed += 1;

      try {
        const published =
          await publishBatchJob(
            processingJob
          );

        const completedAt =
          new Date()
            .toISOString();

        const completedJob:
          FacebookBatchJob = {
            ...processingJob,
            status: "completed",
            facebookPostId:
              published.facebookPostId,
            facebookImagePostId:
              published.facebookImagePostId,
            facebookVideoPostId:
              published.facebookVideoPostId,
            completedAt,
            updatedAt:
              completedAt,
            lastError: "",
          };

        await saveBatchJob(
          completedJob
        );

        await saveBatchHistory({
          username:
            currentBatch.createdBy,
          job:
            completedJob,
          status: "Success",
          facebookPostId:
            published.facebookPostId,
        });

        try {
          const cleanup =
            await cleanupCompletedPostMedia(
              completedJob.batchId,
              completedJob.postId
            );

          if (
            cleanup.deletedCount > 0
          ) {
            console.log(
              "Facebook batch media deleted from R2:",
              {
                batchId:
                  completedJob.batchId,
                postId:
                  completedJob.postId,
                deletedCount:
                  cleanup.deletedCount,
              }
            );
          }
        } catch (cleanupError) {
          console.error(
            "Facebook batch media cleanup failed; Facebook post remains completed:",
            cleanupError
          );
        }

        result.completed += 1;
        result.jobs.push({
          batchId:
            batch.id,
          jobId:
            job.id,
          status:
            "completed",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Facebook batch post failed.";

        const shouldRetry =
          processingJob.attempts <
          processingJob.maxAttempts;

        const updatedAt =
          new Date()
            .toISOString();

        const partialImagePostId =
          error instanceof FacebookBatchPublishError
            ? error.facebookImagePostId
            : processingJob.facebookImagePostId || "";
        const partialVideoPostId =
          error instanceof FacebookBatchPublishError
            ? error.facebookVideoPostId
            : processingJob.facebookVideoPostId || "";

        await saveBatchJob({
          ...processingJob,
          facebookImagePostId:
            partialImagePostId || undefined,
          facebookVideoPostId:
            partialVideoPostId || undefined,
          facebookPostId: [
            partialImagePostId,
            partialVideoPostId,
          ]
            .filter(Boolean)
            .join(" | ") || undefined,
          status:
            shouldRetry
              ? "retrying"
              : "failed",
          notBefore:
            shouldRetry
              ? new Date(
                  Date.now() +
                    retryDelayMinutes(
                      processingJob.attempts
                    ) *
                      60 *
                      1000
                ).toISOString()
              : processingJob
                  .notBefore,
          updatedAt,
          completedAt:
            shouldRetry
              ? undefined
              : updatedAt,
          lastError:
            message,
        });

        if (shouldRetry) {
          result.retried += 1;
        } else {
          result.failed += 1;

          await saveBatchHistory({
            username:
              currentBatch.createdBy,
            job:
              processingJob,
            status: "Failed",
            error: message,
          });
        }

        result.jobs.push({
          batchId:
            batch.id,
          jobId:
            job.id,
          status:
            shouldRetry
              ? "retrying"
              : "failed",
          message,
        });
      }

      await refreshBatchSummary(
        batch.id
      );
    }
  }

  return result;
}

export async function processBatchQueue(
  limit = 1
) {

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 1,
        1
      ),
      3
    );


  const result =
    await processQueueInternal(
      safeLimit
    );


  return {
    busy:false,
    ...result
  };

}