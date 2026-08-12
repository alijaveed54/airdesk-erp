import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { shuffleFacebookImagesForPage } from "@/lib/facebook-image-shuffle";
import {
  airtableFetch,
  apiError,
  apiSuccess,
  handleApiError,
} from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGES_TABLE =
  process.env.FACEBOOK_PAGES_TABLE ||
  process.env.FACEBOOK_PAGES_TABLE_NAME ||
  "Facebook Pages";

const HISTORY_TABLE =
  process.env.FACEBOOK_POST_HISTORY_TABLE ||
  process.env.FACEBOOK_POST_HISTORY_TABLE_NAME ||
  process.env.FACEBOOK_HISTORY_TABLE ||
  "Facebook Post History";

const MAX_IMAGES = 80;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const CONFIGURED_MAX_VIDEO_MB = Number(
  process.env.FACEBOOK_MAX_VIDEO_MB || 100
);
const MAX_VIDEO_FILE_SIZE =
  (Number.isFinite(CONFIGURED_MAX_VIDEO_MB) &&
  CONFIGURED_MAX_VIDEO_MB > 0
    ? CONFIGURED_MAX_VIDEO_MB
    : 100) *
  1024 *
  1024;
const URL_UPLOAD_CONCURRENCY = 4;
const MIN_SCHEDULE_SECONDS = 10 * 60;
const SCHEDULE_HISTORY_MARKER = "__SCHEDULED__|";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

type PageConfig = {
  recordId: string;
  pageName: string;
  pageId: string;
  pageToken: string;
};

type HistoryStatus =
  | "Success"
  | "Failed"
  | "Scheduled";

type PublishMediaItem =
  | {
      type: "media";
      mediaId: string;
      label?: string;
    }
  | {
      type: "url";
      url: string;
    };

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

  if (!baseId) {
    throw new Error(
      "ERP_ADMIN_BASE_ID .env.local mein missing hai."
    );
  }

  if (!token) {
    throw new Error(
      "AIRTABLE_TOKEN .env.local mein missing hai."
    );
  }

  return { baseId, token };
}

function stringValue(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }

  return String(value ?? "").trim();
}


function parseScheduledPublishTime(
  value: unknown
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const timestamp = Number(value);

  if (
    !Number.isFinite(timestamp) ||
    !Number.isInteger(timestamp)
  ) {
    throw new Error(
      "Scheduled publish time valid UNIX timestamp nahi hai."
    );
  }

  const nowSeconds = Math.floor(
    Date.now() / 1000
  );

  const minimumSeconds =
    nowSeconds + MIN_SCHEDULE_SECONDS;

  const maximumDate = new Date();
  maximumDate.setUTCMonth(
    maximumDate.getUTCMonth() + 6
  );

  const maximumSeconds = Math.floor(
    maximumDate.getTime() / 1000
  );

  if (timestamp < minimumSeconds) {
    throw new Error(
      "Schedule time kam az kam 10 minutes future mein honi chahiye."
    );
  }

  if (timestamp > maximumSeconds) {
    throw new Error(
      "Schedule time maximum 6 months future tak ho sakti hai."
    );
  }

  return timestamp;
}

function scheduleFeedParams(
  scheduledPublishTime?: number
): Record<string, string> {
  if (!scheduledPublishTime) {
    return {};
  }

  return {
    published: "false",
    scheduled_publish_time:
      String(scheduledPublishTime),
  };
}

function getFacebookGraphVersion() {
  const configured = String(
    process.env.FACEBOOK_GRAPH_API_VERSION || "v25.0"
  )
    .trim()
    .replace(
      /^https?:\/\/graph\.facebook\.com\//i,
      ""
    )
    .replace(/^\/+|\/+$/g, "");

  if (!configured) {
    return "v25.0";
  }

  return configured.toLowerCase().startsWith("v")
    ? configured
    : `v${configured}`;
}

function graphUrl(pathValue: string) {
  const cleanPath = String(pathValue || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!cleanPath) {
    throw new Error(
      "Facebook Graph API path missing hai."
    );
  }

  return (
    `https://graph.facebook.com/` +
    `${getFacebookGraphVersion()}/${cleanPath}`
  );
}

function facebookErrorMessage(
  data: any,
  fallback: string
) {
  const message = String(
    data?.error?.message || fallback
  ).trim();

  const details = [
    data?.error?.type
      ? `type: ${data.error.type}`
      : "",
    data?.error?.code !== undefined
      ? `code: ${data.error.code}`
      : "",
    data?.error?.error_subcode !== undefined
      ? `subcode: ${data.error.error_subcode}`
      : "",
  ].filter(Boolean);

  return details.length > 0
    ? `${message} (${details.join(", ")})`
    : message;
}

async function parseFacebookResponse(
  response: Response,
  fallback: string
) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.error) {
    throw new Error(
      facebookErrorMessage(data, fallback)
    );
  }

  return data;
}

async function graphGet(
  pathValue: string,
  pageToken: string,
  params: Record<string, string>
) {
  const url = new URL(graphUrl(pathValue));

  Object.entries({
    ...params,
    access_token: pageToken,
  }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  return parseFacebookResponse(
    response,
    "Facebook Graph API GET request failed."
  );
}

async function graphFormPost(
  pathValue: string,
  pageToken: string,
  params: Record<string, string>
) {
  const response = await fetch(graphUrl(pathValue), {
    method: "POST",
    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...params,
      access_token: pageToken,
    }),
    cache: "no-store",
  });

  return parseFacebookResponse(
    response,
    "Facebook Graph API POST request failed."
  );
}

async function graphFilePost(input: {
  pageToken: string;
  fileName: string;
  fileType: string;
  bytes: ArrayBuffer;
}) {
  const facebookFormData = new FormData();

  facebookFormData.append(
    "access_token",
    input.pageToken
  );
  facebookFormData.append(
    "published",
    "false"
  );
  facebookFormData.append(
    "source",
    new Blob([input.bytes], {
      type: input.fileType,
    }),
    input.fileName
  );

  const response = await fetch(
    graphUrl("me/photos"),
    {
      method: "POST",
      body: facebookFormData,
      cache: "no-store",
    }
  );

  return parseFacebookResponse(
    response,
    `${input.fileName}: direct Facebook upload failed.`
  );
}

async function graphVideoFilePost(input: {
  pageToken: string;
  fileName: string;
  fileType: string;
  bytes: ArrayBuffer;
  message: string;
  scheduledPublishTime?: number;
}) {
  const facebookFormData = new FormData();

  facebookFormData.append("access_token", input.pageToken);
  facebookFormData.append(
    "source",
    new Blob([input.bytes], {
      type: input.fileType,
    }),
    input.fileName
  );
  facebookFormData.append(
    "title",
    input.fileName.replace(/\.[^.]+$/, "")
  );

  if (input.message) {
    facebookFormData.append("description", input.message);
  }

  if (input.scheduledPublishTime) {
    facebookFormData.append("published", "false");
    facebookFormData.append(
      "scheduled_publish_time",
      String(input.scheduledPublishTime)
    );
  } else {
    facebookFormData.append("published", "true");
  }

  const response = await fetch(graphUrl("me/videos"), {
    method: "POST",
    body: facebookFormData,
    cache: "no-store",
  });

  return parseFacebookResponse(
    response,
    `${input.fileName}: Facebook video upload failed.`
  );
}

async function graphVideoUrlPost(input: {
  pageToken: string;
  videoUrl: string;
  label: string;
  message: string;
  scheduledPublishTime?: number;
}) {
  const params: Record<string, string> = {
    file_url: input.videoUrl,
    title: input.label.replace(/\.[^.]+$/, ""),
  };

  if (input.message) {
    params.description = input.message;
  }

  if (input.scheduledPublishTime) {
    params.published = "false";
    params.scheduled_publish_time = String(
      input.scheduledPublishTime
    );
  } else {
    params.published = "true";
  }

  return graphFormPost("me/videos", input.pageToken, params);
}

async function loadPageConfig(
  recordId: string
): Promise<PageConfig> {
  const { baseId, token } =
    getAdminBaseConfig();

  const record = (await airtableFetch({
    baseId,
    token,
    table: PAGES_TABLE,
    recordId,
  })) as AirtableRecord;

  const fields = record.fields || {};

  const page: PageConfig = {
    recordId: record.id,
    pageName: stringValue(
      fields["Page Name"]
    ),
    pageId: stringValue(
      fields["Page ID"]
    ),
    pageToken: stringValue(
      fields["Page Token"]
    ),
  };

  if (!page.pageId || !page.pageToken) {
    throw new Error(
      "Saved Page ID ya Page Token missing hai."
    );
  }

  return page;
}

async function verifyPageToken(
  page: PageConfig
) {
  const data = await graphGet(
    "me",
    page.pageToken,
    {
      fields: "id,name",
    }
  );

  const tokenPageId = String(
    data?.id || ""
  ).trim();

  if (!tokenPageId) {
    throw new Error(
      "Facebook Page Token se Page ID retrieve nahi hui."
    );
  }

  if (
    tokenPageId !==
    String(page.pageId).trim()
  ) {
    throw new Error(
      `Saved token Page ID ${tokenPageId} ka hai, ` +
        `lekin selected record mein ` +
        `${page.pageId} saved hai.`
    );
  }
}

async function mapWithConcurrency<T, R>(
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

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(
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

async function saveHistory(input: {
  username: string;
  page: PageConfig;
  message: string;
  mediaLabels: string[];
  status: HistoryStatus;
  facebookPostId?: string;
  error?: string;
  scheduledAt?: string;
}) {
  const { baseId, token } =
    getAdminBaseConfig();

  const isScheduled =
    input.status === "Scheduled";

  const historyDate =
    isScheduled &&
    input.scheduledAt
      ? input.scheduledAt
      : new Date().toISOString();

  const storedStatus =
    isScheduled
      ? "Success"
      : input.status;

  const storedError =
    isScheduled &&
    input.scheduledAt
      ? `${SCHEDULE_HISTORY_MARKER}${input.scheduledAt}`
      : input.error || "";

  try {
    await airtableFetch({
      baseId,
      token,
      table: HISTORY_TABLE,
      method: "POST",
      fields: {
        fields: {
          Date: historyDate,
          User: input.username,
          "Page Name": input.page.pageName,
          "Page ID": input.page.pageId,
          Message: input.message,
          "Image URLs":
            input.mediaLabels.join("\n"),
          Status: storedStatus,
          "Facebook Post ID":
            input.facebookPostId || "",
          Error: storedError,
        },
      },
    });
  } catch (historyError) {
    console.error(
      "Facebook history save failed",
      historyError
    );
  }
}

function parsePublishMedia(
  value: unknown
): PublishMediaItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: PublishMediaItem[] = [];

  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      (item as any).type === "media"
    ) {
      const mediaId = String(
        (item as any).mediaId || ""
      ).trim();

      if (!mediaId) {
        throw new Error(
          "Facebook uploaded media ID missing hai."
        );
      }

      items.push({
        type: "media",
        mediaId,
        label: String(
          (item as any).label || ""
        ).trim(),
      });

      continue;
    }

    if (
      item &&
      typeof item === "object" &&
      (item as any).type === "url"
    ) {
      const url = String(
        (item as any).url || ""
      ).trim();

      if (!/^https?:\/\//i.test(url)) {
        throw new Error(
          "Facebook image URL invalid hai."
        );
      }

      items.push({
        type: "url",
        url,
      });

      continue;
    }

    throw new Error(
      "Facebook publish media item invalid hai."
    );
  }

  if (items.length > MAX_IMAGES) {
    throw new Error(
      `Maximum ${MAX_IMAGES} images allowed hain.`
    );
  }

  return items;
}

function enforceNonOriginalOrder<T>(
  original: readonly T[],
  ordered: readonly T[],
  enabled: boolean
) {
  const result = [...ordered];

  if (!enabled || result.length < 2) {
    return result;
  }

  const sameOrder = result.every(
    (item, index) => item === original[index]
  );

  // Additional safety: when shuffle is enabled, never send the original
  // sequence. The stable helper already excludes it, but this rotation keeps
  // the rule true even if the helper is changed later.
  if (sameOrder) {
    return [
      ...result.slice(1),
      result[0],
    ];
  }

  return result;
}

async function handleUpload(
  request: NextRequest,
  username: string
) {
  const contentType = String(
    request.headers.get("content-type") || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/octet-stream") {
    return apiError(
      `Direct image upload ko application/octet-stream required hai. ` +
        `Received: ${contentType || "missing Content-Type"}.`,
      415
    );
  }

  const pageRecordId = String(
    request.headers.get(
      "x-facebook-page-record-id"
    ) || ""
  ).trim();

  const encodedFileName = String(
    request.headers.get(
      "x-facebook-file-name"
    ) || ""
  ).trim();

  const fileType = String(
    request.headers.get(
      "x-facebook-file-type"
    ) || ""
  )
    .trim()
    .toLowerCase();

  const declaredSize = Number(
    request.headers.get(
      "x-facebook-file-size"
    ) || 0
  );

  let fileName = "facebook-image";

  try {
    fileName = decodeURIComponent(
      encodedFileName
    ).trim() || fileName;
  } catch {
    fileName = encodedFileName || fileName;
  }

  if (!pageRecordId) {
    return apiError(
      "Facebook Page record ID missing hai.",
      400
    );
  }

  if (!ALLOWED_IMAGE_TYPES.has(fileType)) {
    return apiError(
      `${fileName}: only JPG, PNG and WebP allowed hain.`,
      400
    );
  }

  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_FILE_SIZE
  ) {
    return apiError(
      `${fileName}: maximum file size 20 MB hai.`,
      400
    );
  }

  const bytes = await request.arrayBuffer();

  if (bytes.byteLength === 0) {
    return apiError(
      `${fileName}: uploaded file empty hai.`,
      400
    );
  }

  if (bytes.byteLength > MAX_FILE_SIZE) {
    return apiError(
      `${fileName}: maximum file size 20 MB hai.`,
      400
    );
  }

  if (
    declaredSize > 0 &&
    declaredSize !== bytes.byteLength
  ) {
    return apiError(
      `${fileName}: upload size mismatch hua. Dobara try karein.`,
      400
    );
  }

  const page = await loadPageConfig(
    pageRecordId
  );

  const upload = await graphFilePost({
    pageToken: page.pageToken,
    fileName,
    fileType,
    bytes,
  });

  const mediaId = String(
    upload?.id || ""
  ).trim();

  if (!mediaId) {
    return apiError(
      `${fileName}: Facebook media ID receive nahi hua.`,
      502
    );
  }

  return apiSuccess({
    message:
      `${fileName} direct Facebook par upload ho gayi.`,
    mediaId,
    fileName,
    pageRecordId,
    pageName: page.pageName,
    uploadedBy: username,
  });
}


async function handleUrlUpload(
  request: NextRequest,
  username: string
) {
  const contentType = String(
    request.headers.get("content-type") || ""
  ).toLowerCase();

  if (!contentType.startsWith("application/json")) {
    return apiError(
      "URL image upload request ko application/json required hai.",
      415
    );
  }

  const body = await request.json();
  const pageRecordId = stringValue(body.pageRecordId);
  const imageUrl = stringValue(body.url);
  const label = stringValue(body.label) || imageUrl;

  if (!pageRecordId) {
    return apiError(
      "Facebook Page record ID missing hai.",
      400
    );
  }

  if (!/^https:\/\//i.test(imageUrl)) {
    return apiError(
      "Facebook image URL valid HTTPS URL honi chahiye.",
      400
    );
  }

  const page = await loadPageConfig(pageRecordId);
  const upload = await graphFormPost(
    "me/photos",
    page.pageToken,
    {
      url: imageUrl,
      published: "false",
    }
  );

  const mediaId = String(upload?.id || "").trim();

  if (!mediaId) {
    return apiError(
      `${label}: Facebook media ID receive nahi hua.`,
      502
    );
  }

  return apiSuccess({
    message: `${label} Facebook par upload ho gayi.`,
    mediaId,
    fileName: label,
    pageRecordId,
    pageName: page.pageName,
    uploadedBy: username,
  });
}

function decodeHeaderValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function handleVideoPublish(
  request: NextRequest,
  username: string
) {
  const contentType = String(
    request.headers.get("content-type") || ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/octet-stream") {
    return apiError(
      "Direct video upload ko application/octet-stream required hai.",
      415
    );
  }

  const pageRecordId = stringValue(
    request.headers.get("x-facebook-page-record-id")
  );
  const fileName =
    decodeHeaderValue(
      stringValue(request.headers.get("x-facebook-file-name"))
    ) || "facebook-video.mp4";
  const fileType = stringValue(
    request.headers.get("x-facebook-file-type")
  ).toLowerCase();
  const declaredSize = Number(
    request.headers.get("x-facebook-file-size") || 0
  );
  const message = decodeHeaderValue(
    stringValue(request.headers.get("x-facebook-message"))
  );
  const scheduledPublishTime = parseScheduledPublishTime(
    request.headers.get("x-facebook-scheduled-publish-time") ||
      undefined
  );

  if (!pageRecordId) {
    return apiError("Facebook Page record ID missing hai.", 400);
  }

  if (!ALLOWED_VIDEO_TYPES.has(fileType)) {
    return apiError(
      `${fileName}: only MP4, MOV and WebM video allowed hain.`,
      400
    );
  }

  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_VIDEO_FILE_SIZE
  ) {
    return apiError(
      `${fileName}: maximum video size ${Math.round(
        MAX_VIDEO_FILE_SIZE / 1024 / 1024
      )} MB hai.`,
      400
    );
  }

  const bytes = await request.arrayBuffer();

  if (bytes.byteLength === 0) {
    return apiError(`${fileName}: uploaded video empty hai.`, 400);
  }

  if (bytes.byteLength > MAX_VIDEO_FILE_SIZE) {
    return apiError(
      `${fileName}: maximum video size ${Math.round(
        MAX_VIDEO_FILE_SIZE / 1024 / 1024
      )} MB hai.`,
      400
    );
  }

  if (declaredSize > 0 && declaredSize !== bytes.byteLength) {
    return apiError(
      `${fileName}: video upload size mismatch hua. Dobara try karein.`,
      400
    );
  }

  const page = await loadPageConfig(pageRecordId);
  const mediaLabels = [`[Video] ${fileName}`];

  try {
    await verifyPageToken(page);

    const upload = await graphVideoFilePost({
      pageToken: page.pageToken,
      fileName,
      fileType,
      bytes,
      message,
      scheduledPublishTime,
    });

    const facebookPostId = String(upload?.id || "").trim();

    if (!facebookPostId) {
      throw new Error(
        `${fileName}: Facebook video ID receive nahi hui.`
      );
    }

    const scheduledAt = scheduledPublishTime
      ? new Date(scheduledPublishTime * 1000).toISOString()
      : undefined;

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status: scheduledPublishTime ? "Scheduled" : "Success",
      facebookPostId,
      scheduledAt,
    });

    return apiSuccess({
      message: scheduledPublishTime
        ? `${page.pageName} par video schedule ho gayi.`
        : `${page.pageName} par video publish ho gayi.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: true,
        facebookPostId,
        scheduled: Boolean(scheduledPublishTime),
        scheduledAt,
        shuffleApplied: false,
        imageOrder: mediaLabels,
      },
    });
  } catch (publishError) {
    const failureMessage =
      publishError instanceof Error
        ? publishError.message
        : "Facebook video post failed.";

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status: "Failed",
      error: failureMessage,
    });

    return apiSuccess({
      message: `${page.pageName} par video failed.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: false,
        message: failureMessage,
      },
    });
  }
}

async function handleVideoUrlPublish(
  request: NextRequest,
  username: string
) {
  const contentType = String(
    request.headers.get("content-type") || ""
  ).toLowerCase();

  if (!contentType.startsWith("application/json")) {
    return apiError(
      "Video URL publish request ko application/json required hai.",
      415
    );
  }

  const body = await request.json();
  const pageRecordId = stringValue(body.pageRecordId);
  const videoUrl = stringValue(body.url);
  const label = stringValue(body.label) || videoUrl;
  const message = stringValue(body.message);
  const scheduledPublishTime = parseScheduledPublishTime(
    body.scheduledPublishTime
  );

  if (!pageRecordId) {
    return apiError("Facebook Page record ID missing hai.", 400);
  }

  if (!/^https:\/\//i.test(videoUrl)) {
    return apiError(
      "Facebook video URL valid HTTPS URL honi chahiye.",
      400
    );
  }

  const page = await loadPageConfig(pageRecordId);
  const mediaLabels = [`[Video URL] ${label}`];

  try {
    await verifyPageToken(page);

    const upload = await graphVideoUrlPost({
      pageToken: page.pageToken,
      videoUrl,
      label,
      message,
      scheduledPublishTime,
    });

    const facebookPostId = String(upload?.id || "").trim();

    if (!facebookPostId) {
      throw new Error(`${label}: Facebook video ID receive nahi hui.`);
    }

    const scheduledAt = scheduledPublishTime
      ? new Date(scheduledPublishTime * 1000).toISOString()
      : undefined;

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status: scheduledPublishTime ? "Scheduled" : "Success",
      facebookPostId,
      scheduledAt,
    });

    return apiSuccess({
      message: scheduledPublishTime
        ? `${page.pageName} par video schedule ho gayi.`
        : `${page.pageName} par video publish ho gayi.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: true,
        facebookPostId,
        scheduled: Boolean(scheduledPublishTime),
        scheduledAt,
        shuffleApplied: false,
        imageOrder: mediaLabels,
      },
    });
  } catch (publishError) {
    const failureMessage =
      publishError instanceof Error
        ? publishError.message
        : "Facebook video URL post failed.";

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status: "Failed",
      error: failureMessage,
    });

    return apiSuccess({
      message: `${page.pageName} par video failed.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: false,
        message: failureMessage,
      },
    });
  }
}

async function handlePublish(
  request: NextRequest,
  username: string
) {
  const contentType = String(
    request.headers.get("content-type") || ""
  ).toLowerCase();

  if (
    !contentType.startsWith(
      "application/json"
    )
  ) {
    return apiError(
      `Final Facebook publish request ko application/json required hai. ` +
        `Received: ${contentType || "missing Content-Type"}.`,
      415
    );
  }

  const body =
    await request.json();

  const pageRecordId = stringValue(
    body.pageRecordId
  );
  const message = stringValue(
    body.message
  );
  const originalMedia =
    parsePublishMedia(
      body.media
    );

  const autoShuffleImages =
    body.autoShuffleImages === true;

  const shuffleKey =
    stringValue(body.shuffleKey) ||
    crypto.randomUUID();

  const shufflePageIndex = Math.max(
    0,
    Math.trunc(
      Number(body.shufflePageIndex) || 0
    )
  );

  const media =
    enforceNonOriginalOrder(
      originalMedia,
      shuffleFacebookImagesForPage(
        originalMedia,
        {
          enabled: autoShuffleImages,
          seed: shuffleKey,
          pageIndex: shufflePageIndex,
        }
      ),
      autoShuffleImages
    );

  const scheduledPublishTime =
    parseScheduledPublishTime(
      body.scheduledPublishTime
    );

  if (!pageRecordId) {
    return apiError(
      "Facebook Page record ID missing hai.",
      400
    );
  }

  if (!message && media.length === 0) {
    return apiError(
      "Caption ya kam az kam ek image required hai.",
      400
    );
  }

  const page =
    await loadPageConfig(
      pageRecordId
    );

  const mediaLabels = media.map(
    (item) =>
      item.type === "url"
        ? item.url
        : `[PC Direct] ${
            item.label ||
            item.mediaId
          }`
  );

  try {
    await verifyPageToken(page);

    const urlItems = media.filter(
      (
        item
      ): item is Extract<
        PublishMediaItem,
        { type: "url" }
      > => item.type === "url"
    );

    const uploadedUrlIds: string[] = [];

    for (const item of urlItems) {
      const upload =
        await graphFormPost(
          "me/photos",
          page.pageToken,
          {
            url: item.url,
            published: "false",
          }
        );

      const mediaId = String(
        upload?.id || ""
      ).trim();

      if (!mediaId) {
        throw new Error(
          "Facebook URL image media ID receive nahi hua."
        );
      }

      uploadedUrlIds.push(mediaId);
    }

    let urlIndex = 0;

    const finalMediaIds =
      media.map((item) => {
        if (item.type === "media") {
          return item.mediaId;
        }

        const mediaId =
          uploadedUrlIds[urlIndex];
        urlIndex += 1;
        return mediaId;
      });

    let facebookPostId = "";

    if (finalMediaIds.length === 0) {
      const params: Record<string, string> = {
        ...scheduleFeedParams(
          scheduledPublishTime
        ),
      };

      if (message) {
        params.message = message;
      }

      const result =
        await graphFormPost(
          "me/feed",
          page.pageToken,
          params
        );

      facebookPostId = String(
        result?.id || ""
      );
    } else {
      const params: Record<string, string> = {
        attached_media: JSON.stringify(
          finalMediaIds.map(
            (mediaId) => ({
              media_fbid: mediaId,
            })
          )
        ),
        ...scheduleFeedParams(
          scheduledPublishTime
        ),
      };

      if (message) {
        params.message = message;
      }

      const result =
        await graphFormPost(
          "me/feed",
          page.pageToken,
          params
        );

      facebookPostId = String(
        result?.id || ""
      );
    }

    const scheduledAt =
      scheduledPublishTime
        ? new Date(
            scheduledPublishTime *
              1000
          ).toISOString()
        : undefined;

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status:
        scheduledPublishTime
          ? "Scheduled"
          : "Success",
      facebookPostId,
      scheduledAt,
    });

    return apiSuccess({
      message:
        scheduledPublishTime
          ? `${page.pageName} par post successfully schedule ho gaya.`
          : `${page.pageName} par post successfully publish ho gaya.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: true,
        facebookPostId,
        scheduled:
          Boolean(
            scheduledPublishTime
          ),
        scheduledAt,
        shuffleApplied:
          autoShuffleImages &&
          media.length > 1,
        imageOrder:
          mediaLabels,
      },
    });
  } catch (publishError) {
    const failureMessage =
      publishError instanceof Error
        ? publishError.message
        : "Facebook direct post failed.";

    await saveHistory({
      username,
      page,
      message,
      mediaLabels,
      status: "Failed",
      error: failureMessage,
    });

    return apiSuccess({
      message:
        `${page.pageName} par post failed.`,
      result: {
        recordId: page.recordId,
        pageName: page.pageName,
        pageId: page.pageId,
        success: false,
        message: failureMessage,
      },
    });
  }
}

export async function POST(
  request: NextRequest
) {
  try {
    const session = await getSession();

    if (!session) {
      return apiError(
        "Not authenticated",
        401
      );
    }

    if (session.role === "Supplier") {
      return apiError(
        "Supplier Facebook par post nahi kar sakta.",
        403
      );
    }

    const contentType = String(
      request.headers.get("content-type") || ""
    )
      .trim()
      .toLowerCase();

    const requestUrl = new URL(request.url);

    const explicitAction = String(
      request.nextUrl.searchParams.get("action") ||
        requestUrl.searchParams.get("action") ||
        request.headers.get("x-facebook-action") ||
        ""
    )
      .trim()
      .toLowerCase();

    const inferredAction =
      contentType.startsWith(
        "application/octet-stream"
      )
        ? "upload"
        : contentType.startsWith(
              "application/json"
            )
          ? "publish"
          : "";

    const action =
      explicitAction || inferredAction;

    const username =
      session.fullName ||
      session.username;

    if (action === "upload") {
      return handleUpload(
        request,
        username
      );
    }

    if (action === "upload-url") {
      return handleUrlUpload(
        request,
        username
      );
    }

    if (action === "video-publish") {
      return handleVideoPublish(request, username);
    }

    if (action === "video-publish-url") {
      return handleVideoUrlPublish(request, username);
    }

    if (action === "publish") {
      return handlePublish(
        request,
        username
      );
    }

    return apiError(
      `Facebook direct-post request identify nahi hui. ` +
        `Received Content-Type: ${
          contentType || "missing"
        }.`,
      400
    );
  } catch (error) {
    return handleApiError(
      error,
      "Direct Facebook posting failed"
    );
  }
}