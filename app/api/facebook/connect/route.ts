import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
};

type FacebookPagesResponse = {
  data?: FacebookPage[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
  };
};

function getConfig() {
  const airtableToken =
    process.env.ERP_ADMIN_AIRTABLE_TOKEN ||
    process.env.AIRTABLE_ADMIN_TOKEN ||
    process.env.AIRTABLE_TOKEN;

  const airtableBaseId =
    process.env.ERP_ADMIN_AIRTABLE_BASE_ID ||
    process.env.AIRTABLE_ADMIN_BASE_ID;

  const tableName =
    process.env.FACEBOOK_PAGES_TABLE_NAME || "Facebook Pages";

  const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION;

  if (!airtableToken || !airtableBaseId) {
    throw new Error(
      "ERP Admin Airtable environment variables are missing."
    );
  }

  if (!graphVersion) {
    throw new Error(
      "FACEBOOK_GRAPH_API_VERSION is missing, for example vXX.X."
    );
  }

  return {
    airtableToken,
    airtableBaseId,
    tableName,
    graphVersion,
  };
}

function airtableUrl(baseId: string, tableName: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}`;
}

async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  if (session.role !== "Admin" && !session.superAdmin) {
    throw {
      status: 403,
      message: "Only Admin can connect Facebook Pages",
    };
  }

  return session;
}

async function loadFacebookPages(
  userAccessToken: string,
  graphVersion: string
) {
  const pages: FacebookPage[] = [];
  let nextUrl =
    `https://graph.facebook.com/${graphVersion}/me/accounts` +
    `?fields=id,name,access_token,picture.type(square)` +
    `&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, { cache: "no-store" });
    const data = (await response.json()) as FacebookPagesResponse;

    if (!response.ok || data.error) {
      throw new Error(
        data.error?.message || "Unable to load Facebook Pages"
      );
    }

    pages.push(...(data.data || []));
    nextUrl = data.paging?.next || "";
  }

  return pages;
}

async function findExistingRecord(
  baseId: string,
  tableName: string,
  airtableToken: string,
  pageId: string
) {
  const formula = `{Page ID}="${pageId.replace(/"/g, '\\"')}"`;
  const url =
    `${airtableUrl(baseId, tableName)}` +
    `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Unable to check Facebook Page record"
    );
  }

  return data?.records?.[0]?.id as string | undefined;
}

async function savePage({
  config,
  page,
  username,
}: {
  config: ReturnType<typeof getConfig>;
  page: FacebookPage;
  username: string;
}) {
  const recordId = await findExistingRecord(
    config.airtableBaseId,
    config.tableName,
    config.airtableToken,
    page.id
  );

  const fields = {
    "Page ID": page.id,
    "Page Name": page.name,
    "Access Token": page.access_token,
    "Profile Image": page.picture?.data?.url || "",
    Enabled: true,
    "Connected By": username,
    "Connected Date": new Date().toISOString(),
    "Last Refresh": new Date().toISOString(),
  };

  const response = await fetch(
    recordId
      ? `${airtableUrl(
          config.airtableBaseId,
          config.tableName
        )}/${recordId}`
      : airtableUrl(config.airtableBaseId, config.tableName),
    {
      method: recordId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${config.airtableToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Unable to save Facebook Page ${page.name}`
    );
  }

  return {
    recordId: data.id,
    pageId: page.id,
    pageName: page.name,
  };
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const config = getConfig();

    const body = await request.json();
    const userAccessToken = String(
      body.userAccessToken || body.accessToken || ""
    ).trim();

    const selectedPageIds = Array.isArray(body.pageIds)
      ? body.pageIds.map(String)
      : [];

    if (!userAccessToken) {
      return NextResponse.json(
        {
          success: false,
          message: "Facebook user access token is required",
        },
        { status: 400 }
      );
    }

    const availablePages = await loadFacebookPages(
      userAccessToken,
      config.graphVersion
    );

    const pagesToSave =
      selectedPageIds.length > 0
        ? availablePages.filter((page) =>
            selectedPageIds.includes(page.id)
          )
        : availablePages;

    if (pagesToSave.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No Facebook Pages were found or selected",
          availablePages: availablePages.map((page) => ({
            id: page.id,
            name: page.name,
            picture: page.picture?.data?.url || "",
          })),
        },
        { status: 400 }
      );
    }

    const saved = [];
    const failed = [];

    for (const page of pagesToSave) {
      try {
        saved.push(
          await savePage({
            config,
            page,
            username: session.username,
          })
        );
      } catch (error) {
        failed.push({
          pageId: page.id,
          pageName: page.name,
          message:
            error instanceof Error
              ? error.message
              : "Unable to save page",
        });
      }
    }

    return NextResponse.json({
      success: saved.length > 0,
      message: `${saved.length} Facebook Page(s) connected`,
      savedCount: saved.length,
      failedCount: failed.length,
      saved,
      failed,
      availablePages: availablePages.map((page) => ({
        id: page.id,
        name: page.name,
        picture: page.picture?.data?.url || "",
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : error?.message || "Facebook connection failed",
      },
      { status: error?.status || 500 }
    );
  }
}
