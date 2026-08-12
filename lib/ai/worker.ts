import {
  analyzeImage,
  getAllAIJobs,
  updateAIJobStatus,
} from "@/lib/ai";

export async function processPendingAIJobs(
  resolver: (imageKey: string) => Promise<{
    imageUrl: string;
    sku?: string;
  } | null>,
) {
  const pendingJobs = getAllAIJobs().filter(
    (job) => job.status === "pending",
  );

  const summary = {
    total: pendingJobs.length,
    completed: 0,
    failed: 0,
  };

  for (const job of pendingJobs) {
    updateAIJobStatus(job.imageKey, "processing");

    try {
      const image = await resolver(job.imageKey);

      if (!image) {
        throw new Error("Image not found");
      }

      const result = await analyzeImage(
        job.imageKey,
        image.imageUrl,
        image.sku ?? job.sku,
      );

      if (!result.success) {
        throw new Error(result.error || "AI analysis failed");
      }

      updateAIJobStatus(job.imageKey, "completed");
      summary.completed += 1;
    } catch (error) {
      console.error(`AI job failed for ${job.imageKey}:`, error);
      updateAIJobStatus(job.imageKey, "failed");
      summary.failed += 1;
    }
  }

  return summary;
}
