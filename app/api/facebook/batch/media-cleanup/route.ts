import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteBatchPostMedia,
  getBatchJobs,
  listBatches,
} from "@/lib/facebook-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SessionLike = {
  role?: string;
  superAdmin?: boolean;
};

async function requireFacebookUser() {
  const session = (await getSession()) as SessionLike | null;

  if (!session) {
    throw { status: 401, message: "Not authenticated" };
  }

  const role = String(session.role || "").trim().toLowerCase();
  const allowed =
    role === "admin" ||
    role === "manager" ||
    role === "employee" ||
    role === "staff" ||
    Boolean(session.superAdmin);

  if (!allowed || role === "supplier") {
    throw {
      status: 403,
      message:
        "Facebook Batch cleanup sirf Admin, Manager aur Employee use kar sakte hain.",
    };
  }

  return session;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(limit, 1), items.length) },
      () => runWorker(),
    ),
  );

  return output;
}

export async function POST() {
  try {
    await requireFacebookUser();

    const batches = await listBatches();
    const results = await mapWithConcurrency(
      batches,
      3,
      async (batch) => {
        const jobs = await getBatchJobs(batch.id);
        const posts = new Map<string, typeof jobs>();

        for (const job of jobs) {
          const existing = posts.get(job.postId) || [];
          existing.push(job);
          posts.set(job.postId, existing);
        }

        let eligiblePosts = 0;
        let cleanedPosts = 0;
        let deletedObjects = 0;
        const failures: Array<{
          batchId: string;
          batchName: string;
          postId: string;
          message: string;
        }> = [];

        for (const [postId, postJobs] of posts.entries()) {
          if (
            postJobs.length === 0 ||
            !postJobs.every((job) => job.status === "completed")
          ) {
            continue;
          }

          eligiblePosts += 1;

          try {
            const deleted = await deleteBatchPostMedia(batch.id, postId);
            deletedObjects += deleted;
            if (deleted > 0) cleanedPosts += 1;
          } catch (error) {
            failures.push({
              batchId: batch.id,
              batchName: batch.name,
              postId,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown R2 cleanup error",
            });
          }
        }

        return {
          eligiblePosts,
          cleanedPosts,
          deletedObjects,
          failures,
        };
      },
    );

    const eligiblePosts = results.reduce(
      (total, result) => total + result.eligiblePosts,
      0,
    );
    const cleanedPosts = results.reduce(
      (total, result) => total + result.cleanedPosts,
      0,
    );
    const deletedObjects = results.reduce(
      (total, result) => total + result.deletedObjects,
      0,
    );
    const failures = results.flatMap((result) => result.failures);

    return NextResponse.json({
      success: true,
      message:
        `R2 cleanup checked ${batches.length} batch(es) and ${eligiblePosts} completed post(s). ` +
        `${deletedObjects} media file(s) deleted from ${cleanedPosts} post(s)` +
        `${failures.length ? `; ${failures.length} cleanup failure(s).` : "."}`,
      scannedBatches: batches.length,
      eligiblePosts,
      cleanedPosts,
      deletedObjects,
      failures,
    });
  } catch (error) {
    const known = error as { status?: number; message?: string };

    return NextResponse.json(
      {
        success: false,
        message:
          known?.message ||
          (error instanceof Error
            ? error.message
            : "Facebook batch R2 cleanup failed"),
      },
      { status: known?.status || 500 },
    );
  }
}
