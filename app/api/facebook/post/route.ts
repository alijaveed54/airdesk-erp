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
const URL_UPLOAD_CONCURRENCY = 4;
const MIN_SCHEDULE_SECONDS = 10 * 60;
const SCHEDULE_HISTORY_MARKER = "__SCHEDULED__|";

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

function cleanImageUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || "").trim()
        )
        .filter((url) =>
          /^https?:\/\//i.test(url)
        )
    )
  ).slice(0, MAX_IMAGES);
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

function getFacebookGraphVersion() {
  const configured = String(
    process.env.FACEBOOK_GRAPH_API_VERSION ||
      "v25.0"
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

  return configured
    .toLowerCase()
    .startsWith("v")
    ? configured
    : `v${configured}`;
}

function graphUrl(pathValue: string) {
  const cleanPath = String(
    pathValue || ""
  )
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

async function graphRequest(
  pathValue: string,
  pageToken: string,
  options: {
    method: "GET" | "POST";
    params?: Record<string, string>;
  }
) {
  const url = new URL(
    graphUrl(pathValue)
  );
  const params = {
    ...(options.params || {}),
    access_token: pageToken,
  };

  let response: Response;

  if (options.method === "GET") {
    Object.entries(params).forEach(
      ([key, value]) => {
        url.searchParams.set(
          key,
          value
        );
      }
    );

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
      body: new URLSearchParams(
        params
      ),
      cache: "no-store",
    });
  }

  const data =
    await response.json().catch(
      () => null
    );

  if (!response.ok || data?.error) {
    throw new Error(
      facebookErrorMessage(
        data,
        "Facebook Graph API request failed."
      )
    );
  }

  return data;
}

async function graphPost(
  pathValue: string,
  pageToken: string,
  params: Record<string, string>
) {
  return graphRequest(
    pathValue,
    pageToken,
    {
      method: "POST",
      params,
    }
  );
}

async function verifyPageToken(
  page: PageConfig
) {
  const data = await graphRequest(
    "me",
    page.pageToken,
    {
      method: "GET",
      params: {
        fields: "id,name",
      },
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
        `lekin selected record mein ${page.pageId} saved hai.`
    );
  }
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

async function publishToPage(input: {
  page: PageConfig;
  message: string;
  imageUrls: string[];
  scheduledPublishTime?: number;
}) {
  const {
    page,
    message,
    imageUrls,
    scheduledPublishTime,
  } = input;

  await verifyPageToken(page);

  if (imageUrls.length === 0) {
    const params: Record<
      string,
      string
    > = {
      ...scheduleFeedParams(
        scheduledPublishTime
      ),
    };

    if (message) {
      params.message = message;
    }

    const result = await graphPost(
      "me/feed",
      page.pageToken,
      params
    );

    return String(
      result.id || ""
    );
  }

  if (
    imageUrls.length === 1 &&
    !scheduledPublishTime
  ) {
    const result = await graphPost(
      "me/photos",
      page.pageToken,
      {
        url: imageUrls[0],
        caption: message,
        published: "true",
      }
    );

    return String(
      result.post_id ||
        result.id ||
        ""
    );
  }

  const uploadedMediaIds =
    await mapWithConcurrency(
      imageUrls,
      URL_UPLOAD_CONCURRENCY,
      async (imageUrl) => {
        const upload =
          await graphPost(
            "me/photos",
            page.pageToken,
            {
              url: imageUrl,
              published: "false",
            }
          );

        const mediaId = String(
          upload?.id || ""
        ).trim();

        if (!mediaId) {
          throw new Error(
            "Facebook image upload ID receive nahi hua."
          );
        }

        return mediaId;
      }
    );

  const params: Record<
    string,
    string
  > = {
    attached_media:
      JSON.stringify(
        uploadedMediaIds.map(
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

  const result = await graphPost(
    "me/feed",
    page.pageToken,
    params
  );

  return String(
    result.id || ""
  );
}

async function saveHistory(input: {
  username: string;
  page: PageConfig;
  message: string;
  imageUrls: string[];
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
          "Page Name":
            input.page.pageName,
          "Page ID":
            input.page.pageId,
          Message: input.message,
          "Image URLs":
            input.imageUrls.join(
              "\n"
            ),
          Status: storedStatus,
          "Facebook Post ID":
            input.facebookPostId ||
            "",
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

export async function POST(
  request: NextRequest
) {
  try {
    const session =
      await getSession();

    if (!session) {
      return apiError(
        "Not authenticated",
        401
      );
    }

    if (
      session.role === "Supplier"
    ) {
      return apiError(
        "Supplier Facebook par post nahi kar sakta.",
        403
      );
    }

    const body =
      await request.json();

    const pageRecordIds:
      string[] = Array.isArray(
        body.pageRecordIds
      )
      ? Array.from(
          new Set<string>(
            body.pageRecordIds
              .map(
                (id: unknown) =>
                  String(
                    id || ""
                  ).trim()
              )
              .filter(
                (id: string) =>
                  id.length > 0
              )
          )
        ).slice(0, 50)
      : [];

    const message =
      stringValue(body.message);

    const imageUrls =
      cleanImageUrls(
        body.imageUrls
      );

    const scheduledPublishTime =
      parseScheduledPublishTime(
        body.scheduledPublishTime
      );

    const autoShuffleImages =
      body.autoShuffleImages === true;

    const shuffleKey =
      stringValue(body.shuffleKey) ||
      crypto.randomUUID();

    if (
      pageRecordIds.length === 0
    ) {
      return apiError(
        "Kam az kam ek Facebook Page select karein.",
        400
      );
    }

    if (
      !message &&
      imageUrls.length === 0
    ) {
      return apiError(
        "Caption ya kam az kam ek image URL required hai.",
        400
      );
    }

    const { baseId, token } =
      getAdminBaseConfig();

    const pageRecords =
      await Promise.all(
        pageRecordIds.map(
          (recordId) =>
            airtableFetch({
              baseId,
              token,
              table:
                PAGES_TABLE,
              recordId,
            }) as Promise<AirtableRecord>
        )
      );

    const pages: PageConfig[] =
      pageRecords.map(
        (record) => {
          const fields =
            record.fields || {};

          return {
            recordId:
              record.id,
            pageName:
              stringValue(
                fields[
                  "Page Name"
                ]
              ),
            pageId:
              stringValue(
                fields[
                  "Page ID"
                ]
              ),
            pageToken:
              stringValue(
                fields[
                  "Page Token"
                ]
              ),
          };
        }
      );

    const results = [];

    for (
      let pageIndex = 0;
      pageIndex < pages.length;
      pageIndex += 1
    ) {
      const page = pages[pageIndex];
      const pageImageUrls =
        shuffleFacebookImagesForPage(
          imageUrls,
          {
            enabled: autoShuffleImages,
            seed: shuffleKey,
            pageIndex,
          }
        );
      if (
        !page.pageId ||
        !page.pageToken
      ) {
        const failureMessage =
          "Saved Page ID ya Page Token missing hai.";

        results.push({
          recordId:
            page.recordId,
          pageName:
            page.pageName ||
            "Unknown Page",
          pageId: page.pageId,
          success: false,
          message:
            failureMessage,
        });

        await saveHistory({
          username:
            session.fullName ||
            session.username,
          page,
          message,
          imageUrls: pageImageUrls,
          status: "Failed",
          error:
            failureMessage,
        });

        continue;
      }

      try {
        const facebookPostId =
          await publishToPage({
            page,
            message,
            imageUrls: pageImageUrls,
            scheduledPublishTime,
          });

        const scheduledAt =
          scheduledPublishTime
            ? new Date(
                scheduledPublishTime *
                  1000
              ).toISOString()
            : undefined;

        results.push({
          recordId:
            page.recordId,
          pageName:
            page.pageName,
          pageId:
            page.pageId,
          success: true,
          facebookPostId,
          scheduled:
            Boolean(
              scheduledPublishTime
            ),
          scheduledAt,
          shuffleApplied:
            autoShuffleImages &&
            pageImageUrls.length > 1,
          imageOrder:
            pageImageUrls,
        });

        await saveHistory({
          username:
            session.fullName ||
            session.username,
          page,
          message,
          imageUrls: pageImageUrls,
          status:
            scheduledPublishTime
              ? "Scheduled"
              : "Success",
          facebookPostId,
          scheduledAt,
        });
      } catch (postError) {
        const failureMessage =
          postError instanceof
          Error
            ? postError.message
            : "Facebook post failed.";

        results.push({
          recordId:
            page.recordId,
          pageName:
            page.pageName,
          pageId:
            page.pageId,
          success: false,
          message:
            failureMessage,
        });

        await saveHistory({
          username:
            session.fullName ||
            session.username,
          page,
          message,
          imageUrls: pageImageUrls,
          status: "Failed",
          error:
            failureMessage,
        });
      }
    }

    const successful =
      results.filter(
        (result) =>
          result.success
      ).length;

    const failed =
      results.length -
      successful;

    const actionLabel =
      scheduledPublishTime
        ? "schedule"
        : "post";

    return apiSuccess({
      message:
        `${successful} Page(s) par ${actionLabel} ho gaya` +
        `${failed ? `, ${failed} failed` : ""}.`,
      results,
    });
  } catch (error) {
    return handleApiError(
      error,
      "Facebook posting failed"
    );
  }
}