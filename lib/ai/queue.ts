import type { AIQueueItem } from "./types";

const jobs = new Map<string, AIQueueItem>();

function now() {
  return new Date().toISOString();
}

export function createAIJob(imageKey: string, sku?: string): AIQueueItem {
  const existing = jobs.get(imageKey);

  if (existing) {
    return existing;
  }

  const job: AIQueueItem = {
    id: crypto.randomUUID(),
    imageKey,
    sku,
    status: "pending",
    retries: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  jobs.set(imageKey, job);
  return job;
}

export function getAIJob(imageKey: string) {
  return jobs.get(imageKey) ?? null;
}

export function getAllAIJobs() {
  return [...jobs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function updateAIJobStatus(
  imageKey: string,
  status: AIQueueItem["status"],
) {
  const job = jobs.get(imageKey);
  if (!job) return null;

  job.status = status;
  job.updatedAt = now();

  if (status === "failed") {
    job.retries += 1;
  }

  jobs.set(imageKey, job);
  return job;
}

export function removeAIJob(imageKey: string) {
  jobs.delete(imageKey);
}

export function clearCompletedJobs() {
  for (const [key, job] of jobs.entries()) {
    if (job.status === "completed") {
      jobs.delete(key);
    }
  }
}
