import { FacebookPostJob } from "./queue";


const queue: FacebookPostJob[] = [];


export function addFacebookJob(job: FacebookPostJob) {
  queue.push(job);
  return job;
}


export function getPendingFacebookJobs(limit = 10) {
  return queue
    .filter((job) => job.status === "pending")
    .slice(0, limit);
}


export function updateFacebookJobStatus(
  id: string,
  status: FacebookPostJob["status"],
  errorMessage?: string
) {
  const job = queue.find((item) => item.id === id);

  if (!job) {
    return null;
  }

  job.status = status;

  if (errorMessage) {
    job.errorMessage = errorMessage;
  }

  if (status === "posted" || status === "failed") {
    job.processedAt = new Date().toISOString();
  }

  return job;
}


export function getFacebookQueueStats() {
  return {
    total: queue.length,
    pending: queue.filter(
      (job) => job.status === "pending"
    ).length,
    processing: queue.filter(
      (job) => job.status === "processing"
    ).length,
    posted: queue.filter(
      (job) => job.status === "posted"
    ).length,
    failed: queue.filter(
      (job) => job.status === "failed"
    ).length,
  };
}