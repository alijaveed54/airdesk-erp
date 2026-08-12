import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  airtableFetch,
  airtablePaginatedFetch,
  apiSuccess,
  handleApiError,
} from "@/lib/airtable";
import {
  getBatchJobs,
  listBatches,
} from "@/lib/facebook-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HISTORY_TABLE =
  process.env.FACEBOOK_POST_HISTORY_TABLE ||
  process.env.FACEBOOK_POST_HISTORY_TABLE_NAME ||
  process.env.FACEBOOK_HISTORY_TABLE ||
  "Facebook Post History";

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
      "Facebook History Airtable configuration missing hai.",
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

async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  if (session.role !== "Admin" && !session.superAdmin) {
    throw {
      status: 403,
      message: "Sirf Admin Batch History sync kar sakta hai.",
    };
  }

  return session;
}

export async function POST(_request: NextRequest) {
  try {
    await requireAdmin();
    const { baseId, token } = getAdminBaseConfig();

    const existingRecords = await airtablePaginatedFetch({
      baseId,
      token,
      table: HISTORY_TABLE,
      params: new URLSearchParams(),
    });

    const existingKeys = new Set(
      existingRecords
        .map((record) => {
          const fields = record.fields || {};
          const pageId = stringValue(fields["Page ID"]);
          const facebookPostId = stringValue(
            fields["Facebook Post ID"],
          );

          return pageId && facebookPostId
            ? `${pageId}|${facebookPostId}`
            : "";
        })
        .filter(Boolean),
    );

    const batches = await listBatches();
    let completedJobs = 0;
    let inserted = 0;
    let skipped = 0;

    for (const batch of batches) {
      const jobs = await getBatchJobs(batch.id);

      for (const job of jobs) {
        const facebookPostId = String(
          job.facebookPostId || "",
        ).trim();

        if (job.status !== "completed" || !facebookPostId) {
          continue;
        }

        completedJobs += 1;
        const uniqueKey = `${job.pageId}|${facebookPostId}`;

        if (existingKeys.has(uniqueKey)) {
          skipped += 1;
          continue;
        }

        await airtableFetch({
          baseId,
          token,
          table: HISTORY_TABLE,
          method: "POST",
          fields: {
            fields: {
              Date:
                job.completedAt ||
                job.updatedAt ||
                batch.completedAt ||
                batch.updatedAt ||
                new Date().toISOString(),
              User: batch.createdBy || "Facebook Batch Worker",
              "Page Name": job.pageName || "Facebook Page",
              "Page ID": job.pageId,
              Message: job.message || "",
              "Image URLs": [
                ...(job.imageUrls || []),
                ...(job.videoUrl
                  ? [`[Video] ${job.videoUrl}`]
                  : []),
              ].join("\n"),
              Status: "Success",
              "Facebook Post ID": facebookPostId,
              Error: "",
            },
          },
        });

        existingKeys.add(uniqueKey);
        inserted += 1;
      }
    }

    return apiSuccess({
      message:
        `Batch History sync complete: ${inserted} recovered, ` +
        `${skipped} already present, ${completedJobs} completed job(s) checked.`,
      inserted,
      skipped,
      completedJobs,
    });
  } catch (error) {
    return handleApiError(error, "Facebook Batch History sync failed");
  }
}
