import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  airtableFetch,
  airtablePaginatedFetch,
  apiError,
  apiSuccess,
  handleApiError,
} from "@/lib/airtable";

const HISTORY_TABLE =
  process.env.FACEBOOK_POST_HISTORY_TABLE ||
  process.env.FACEBOOK_POST_HISTORY_TABLE_NAME ||
  process.env.FACEBOOK_HISTORY_TABLE ||
  "Facebook Post History";

const PAGES_TABLE =
  process.env.FACEBOOK_PAGES_TABLE ||
  process.env.FACEBOOK_PAGES_TABLE_NAME ||
  "Facebook Pages";

const SCHEDULE_HISTORY_MARKER = "__SCHEDULED__|";

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
  createdTime?: string;
};

type PageConfig = {
  recordId: string;
  pageName: string;
  pageId: string;
  pageToken: string;
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
    throw new Error("ERP_ADMIN_BASE_ID .env.local mein missing hai.");
  }

  if (!token) {
    throw new Error("AIRTABLE_TOKEN .env.local mein missing hai.");
  }

  return { baseId, token };
}

async function requireUser() {
  const session = await getSession();

  if (!session) {
    throw {
      status: 401,
      message: "Not authenticated",
    };
  }

  if (session.role === "Supplier") {
    throw {
      status: 403,
      message: "Supplier Facebook history access nahi kar sakta.",
    };
  }

  return session;
}

async function requireAdmin() {
  const session = await requireUser();

  if (session.role !== "Admin" && !session.superAdmin) {
    throw {
      status: 403,
      message: "Sirf Admin Facebook history delete kar sakta hai.",
    };
  }

  return session;
}

function stringValue(value: unknown) {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function normalizeRecord(record: AirtableRecord) {
  const fields = record.fields || {};
  const rawUrls = stringValue(fields["Image URLs"]);
  const storedError = stringValue(fields["Error"]);
  const isScheduled = storedError.startsWith(
    SCHEDULE_HISTORY_MARKER
  );
  const scheduledAt = isScheduled
    ? storedError
        .slice(SCHEDULE_HISTORY_MARKER.length)
        .trim()
    : "";

  return {
    id: record.id,
    date:
      stringValue(fields["Date"]) ||
      record.createdTime ||
      "",
    user: stringValue(fields["User"]),
    pageName: stringValue(fields["Page Name"]),
    pageId: stringValue(fields["Page ID"]),
    message: stringValue(fields["Message"]),
    imageUrls: rawUrls
      .split(/\r?\n|,/)
      .map((url) => url.trim())
      .filter(Boolean),
    status: isScheduled
      ? "Scheduled"
      : stringValue(fields["Status"]),
    scheduledAt,
    facebookPostId: stringValue(fields["Facebook Post ID"]),
    error: isScheduled ? "" : storedError,
  };
}

function includesSearch(record: ReturnType<typeof normalizeRecord>, search: string) {
  if (!search) return true;

  const haystack = [
    record.user,
    record.pageName,
    record.pageId,
    record.message,
    record.facebookPostId,
    record.error,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function withinDateRange(
  recordDate: string,
  dateFrom: string,
  dateTo: string
) {
  if (!dateFrom && !dateTo) return true;

  const time = new Date(recordDate).getTime();
  if (Number.isNaN(time)) return false;

  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`).getTime();
    if (time < from) return false;
  }

  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`).getTime();
    if (time > to) return false;
  }

  return true;
}

async function graphPost(
  path: string,
  pageToken: string,
  params: Record<string, string>
) {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || "v25.0";
  const body = new URLSearchParams({
    ...params,
    access_token: pageToken,
  });

  const response = await fetch(
    `https://graph.facebook.com/${version}/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok || data?.error) {
    throw new Error(
      data?.error?.message || "Facebook Graph API request failed."
    );
  }

  return data;
}

async function publishToPage(
  page: PageConfig,
  message: string,
  imageUrls: string[]
) {
  if (imageUrls.length === 0) {
    const result = await graphPost(
      `${encodeURIComponent(page.pageId)}/feed`,
      page.pageToken,
      { message }
    );

    return String(result.id || "");
  }

  if (imageUrls.length === 1) {
    const result = await graphPost(
      `${encodeURIComponent(page.pageId)}/photos`,
      page.pageToken,
      {
        url: imageUrls[0],
        caption: message,
        published: "true",
      }
    );

    return String(result.post_id || result.id || "");
  }

  const uploadedMediaIds: string[] = [];

  for (const imageUrl of imageUrls) {
    const upload = await graphPost(
      `${encodeURIComponent(page.pageId)}/photos`,
      page.pageToken,
      {
        url: imageUrl,
        published: "false",
      }
    );

    const mediaId = String(upload.id || "");

    if (!mediaId) {
      throw new Error("Facebook image upload ID receive nahi hua.");
    }

    uploadedMediaIds.push(mediaId);
  }

  const result = await graphPost(
    `${encodeURIComponent(page.pageId)}/feed`,
    page.pageToken,
    {
      message,
      attached_media: JSON.stringify(
        uploadedMediaIds.map((mediaId) => ({
          media_fbid: mediaId,
        }))
      ),
    }
  );

  return String(result.id || "");
}

async function findFacebookPage(pageId: string) {
  const { baseId, token } = getAdminBaseConfig();
  const params = new URLSearchParams();

  params.set(
    "filterByFormula",
    `{Page ID}='${pageId.replace(/'/g, "\\'")}'`
  );
  params.set("maxRecords", "1");

  const result = await airtableFetch({
    baseId,
    token,
    table: PAGES_TABLE,
    params,
  });

  const record = (result.records || [])[0] as AirtableRecord | undefined;

  if (!record) {
    throw new Error("Saved Facebook Page configuration nahi mili.");
  }

  return {
    recordId: record.id,
    pageName: stringValue(record.fields?.["Page Name"]),
    pageId: stringValue(record.fields?.["Page ID"]),
    pageToken: stringValue(record.fields?.["Page Token"]),
  } satisfies PageConfig;
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const { baseId, token } = getAdminBaseConfig();

    const requestedPage = Number(
      request.nextUrl.searchParams.get("page") || "1"
    );
    const requestedPageSize = Number(
      request.nextUrl.searchParams.get("pageSize") || "20"
    );

    const page = Number.isFinite(requestedPage)
      ? Math.max(1, Math.floor(requestedPage))
      : 1;

    const pageSize = Number.isFinite(requestedPageSize)
      ? Math.min(100, Math.max(5, Math.floor(requestedPageSize)))
      : 20;

    const search =
      request.nextUrl.searchParams.get("search")?.trim() || "";
    const status =
      request.nextUrl.searchParams.get("status")?.trim() || "All";
    const dateFrom =
      request.nextUrl.searchParams.get("dateFrom")?.trim() || "";
    const dateTo =
      request.nextUrl.searchParams.get("dateTo")?.trim() || "";

    const params = new URLSearchParams();
    params.set("sort[0][field]", "Date");
    params.set("sort[0][direction]", "desc");

    const records = await airtablePaginatedFetch({
      baseId,
      token,
      table: HISTORY_TABLE,
      params,
    });

    const normalized = records
      .map(normalizeRecord)
      .filter((record) => status === "All" || record.status === status)
      .filter((record) => includesSearch(record, search))
      .filter((record) => withinDateRange(record.date, dateFrom, dateTo));

    const total = normalized.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const history = normalized.slice(start, start + pageSize);

    return apiSuccess({
      history,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return handleApiError(error, "Facebook history load failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireUser();
    const body = await request.json();

    if (body.action !== "retry") {
      return apiError("Invalid history action.", 400);
    }

    const recordId = stringValue(body.recordId);

    if (!recordId) {
      return apiError("History record ID missing hai.", 400);
    }

    const { baseId, token } = getAdminBaseConfig();

    const historyRecord = (await airtableFetch({
      baseId,
      token,
      table: HISTORY_TABLE,
      recordId,
    })) as AirtableRecord;

    const fields = historyRecord.fields || {};
    const pageId = stringValue(fields["Page ID"]);
    const message = stringValue(fields["Message"]);
    const imageUrls = stringValue(fields["Image URLs"])
      .split(/\r?\n|,/)
      .map((url) => url.trim())
      .filter(Boolean);

    if (!pageId) {
      return apiError("History mein Facebook Page ID missing hai.", 400);
    }

    if (!message && imageUrls.length === 0) {
      return apiError("Retry ke liye caption ya image required hai.", 400);
    }

    const page = await findFacebookPage(pageId);

    if (!page.pageToken) {
      return apiError("Saved Facebook Page token missing hai.", 400);
    }

    try {
      const facebookPostId = await publishToPage(
        page,
        message,
        imageUrls
      );

      await airtableFetch({
        baseId,
        token,
        table: HISTORY_TABLE,
        recordId,
        method: "PATCH",
        fields: {
          fields: {
            Date: new Date().toISOString(),
            User: session.fullName || session.username,
            Status: "Success",
            "Facebook Post ID": facebookPostId,
            Error: "",
          },
        },
      });

      return apiSuccess({
        message: `${page.pageName} par post dobara publish ho gaya.`,
      });
    } catch (postError) {
      const failureMessage =
        postError instanceof Error
          ? postError.message
          : "Facebook retry failed.";

      await airtableFetch({
        baseId,
        token,
        table: HISTORY_TABLE,
        recordId,
        method: "PATCH",
        fields: {
          fields: {
            Date: new Date().toISOString(),
            User: session.fullName || session.username,
            Status: "Failed",
            Error: failureMessage,
          },
        },
      });

      return apiError(failureMessage, 400);
    }
  } catch (error) {
    return handleApiError(error, "Facebook retry failed");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
    const recordId =
      request.nextUrl.searchParams.get("recordId")?.trim() || "";

    if (!recordId) {
      return apiError("History record ID missing hai.", 400);
    }

    const { baseId, token } = getAdminBaseConfig();

    await airtableFetch({
      baseId,
      token,
      table: HISTORY_TABLE,
      recordId,
      method: "DELETE",
    });

    return apiSuccess({
      message: "Facebook history record delete ho gaya.",
    });
  } catch (error) {
    return handleApiError(error, "Facebook history delete failed");
  }
}