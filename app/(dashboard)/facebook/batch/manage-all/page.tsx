"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Layers3,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type JobStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

type BatchStatus =
  | "creating"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed";

type BatchSummary = {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  totalJobs: number;
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  progressPercent: number;
};

type BatchJob = {
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
  status: JobStatus;
  priority?: number;
  notBefore: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  facebookPostId?: string;
  lastError?: string;
};

type LoadedJob = BatchJob & {
  batchName: string;
  batchStatus: BatchStatus;
};

type PostStatus = JobStatus | "partial";

type PostItem = {
  key: string;
  batchId: string;
  batchName: string;
  batchStatus: BatchStatus;
  postId: string;
  groupNumber: number;
  postNumber: number;
  message: string;
  imageCount: number;
  hasVideo: boolean;
  priority: number;
  notBefore: string;
  status: PostStatus;
  jobs: LoadedJob[];
  pendingJobs: number;
};

type EditState = {
  batchId: string;
  postId: string;
  label: string;
  message: string;
  notBefore: string;
};

type BatchesResponse = {
  success: boolean;
  message?: string;
  batches?: BatchSummary[];
};

type DetailResponse = {
  success: boolean;
  message?: string;
  batch?: BatchSummary;
  jobs?: BatchJob[];
};

const FILTERS = [
  "all",
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

type FilterValue = (typeof FILTERS)[number];

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      text.slice(0, 500) ||
        "Server response valid JSON nahi hai.",
    );
  }
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

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

function statusLabel(status: PostStatus) {
  const labels: Record<PostStatus, string> = {
    queued: "Queued",
    processing: "Processing",
    retrying: "Retrying",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    partial: "Partial",
  };

  return labels[status];
}

function statusClass(status: PostStatus) {
  const classes: Record<PostStatus, string> = {
    queued: "border-blue-200 bg-blue-50 text-blue-700",
    processing: "border-violet-200 bg-violet-50 text-violet-700",
    retrying: "border-orange-200 bg-orange-50 text-orange-700",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-red-200 bg-red-50 text-red-700",
    cancelled: "border-slate-200 bg-slate-100 text-slate-600",
    partial: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return classes[status];
}

function calculatePostStatus(jobs: LoadedJob[]): PostStatus {
  if (jobs.some((job) => job.status === "processing")) return "processing";
  if (jobs.every((job) => job.status === "completed")) return "completed";
  if (jobs.every((job) => job.status === "cancelled")) return "cancelled";
  if (jobs.every((job) => job.status === "failed")) return "failed";

  if (
    jobs.some((job) => job.status === "retrying") &&
    jobs.every((job) => ["queued", "retrying"].includes(job.status))
  ) {
    return "retrying";
  }

  if (
    jobs.every(
      (job) => job.status === "queued" || job.status === "retrying",
    )
  ) {
    return "queued";
  }

  return "partial";
}

function summarizePosts(jobs: LoadedJob[]): PostItem[] {
  const groups = new Map<string, LoadedJob[]>();

  for (const job of jobs) {
    const key = `${job.batchId}:${job.postId}`;
    const existing = groups.get(key) || [];
    existing.push(job);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, postJobs]) => {
      const first = postJobs[0];
      const timeValues = postJobs
        .map((job) => new Date(job.notBefore).getTime())
        .filter(Number.isFinite);
      const earliest = timeValues.length
        ? Math.min(...timeValues)
        : Date.now();

      return {
        key,
        batchId: first.batchId,
        batchName: first.batchName,
        batchStatus: first.batchStatus,
        postId: first.postId,
        groupNumber: first.groupNumber,
        postNumber: first.postNumber,
        message: first.message,
        imageCount: first.imageUrls?.length || 0,
        hasVideo: Boolean(first.videoUrl),
        priority: Math.max(
          ...postJobs.map((job) => Number(job.priority || 0)),
        ),
        notBefore: new Date(earliest).toISOString(),
        status: calculatePostStatus(postJobs),
        jobs: [...postJobs].sort((a, b) =>
          a.pageName.localeCompare(b.pageName),
        ),
        pendingJobs: postJobs.filter(
          (job) => job.status === "queued" || job.status === "retrying",
        ).length,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.notBefore).getTime() -
          new Date(b.notBefore).getTime() ||
        b.priority - a.priority ||
        a.batchName.localeCompare(b.batchName),
    );
}

export default function ManageAllFacebookBatchPostsPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [jobs, setJobs] = useState<LoadedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const batchResponse = await fetch("/api/facebook/batch", {
        cache: "no-store",
      });
      const batchData = await readJson<BatchesResponse>(batchResponse);

      if (!batchResponse.ok || !batchData.success) {
        throw new Error(
          batchData.message || "Facebook batches load nahi ho sake.",
        );
      }

      const batchList = batchData.batches || [];
      const detailResults = await mapWithConcurrency(
        batchList,
        4,
        async (batch) => {
          try {
            const response = await fetch(
              `/api/facebook/batch?batchId=${encodeURIComponent(batch.id)}`,
              { cache: "no-store" },
            );
            const data = await readJson<DetailResponse>(response);

            if (!response.ok || !data.success) {
              throw new Error(
                data.message || `${batch.name} detail load nahi hui.`,
              );
            }

            const effectiveBatch = data.batch || batch;
            return {
              jobs: (data.jobs || []).map((job) => ({
                ...job,
                batchName: effectiveBatch.name,
                batchStatus: effectiveBatch.status,
              })),
              error: "",
            };
          } catch (detailError) {
            return {
              jobs: [] as LoadedJob[],
              error:
                detailError instanceof Error
                  ? detailError.message
                  : `${batch.name} detail load nahi hui.`,
            };
          }
        },
      );

      const detailErrors = detailResults
        .map((result) => result.error)
        .filter(Boolean);

      setBatches(batchList);
      setJobs(detailResults.flatMap((result) => result.jobs));
      setError(
        detailErrors.length
          ? `${detailErrors.length} batch detail load issue: ${detailErrors[0]}`
          : "",
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "All Facebook posts load nahi ho sake.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!editState && !busyKey) void loadAll(true);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [busyKey, editState, loadAll]);

  const posts = useMemo(() => summarizePosts(jobs), [jobs]);

  const counts = useMemo(
    () => ({
      all: posts.length,
      pending: posts.filter((post) =>
        ["queued", "retrying", "partial"].includes(post.status),
      ).length,
      processing: posts.filter((post) => post.status === "processing").length,
      completed: posts.filter((post) => post.status === "completed").length,
      failed: posts.filter((post) => post.status === "failed").length,
      cancelled: posts.filter((post) => post.status === "cancelled").length,
    }),
    [posts],
  );

  const filteredPosts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return posts.filter((post) => {
      const statusMatches =
        filter === "all"
          ? true
          : filter === "pending"
            ? ["queued", "retrying", "partial"].includes(post.status)
            : post.status === filter;

      if (!statusMatches) return false;
      if (!normalizedSearch) return true;

      return [
        post.batchName,
        post.message,
        `group ${post.groupNumber}`,
        `post ${post.postNumber}`,
        ...post.jobs.map((job) => job.pageName),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [filter, posts, search]);

  const runPostAction = useCallback(
    async (
      post: PostItem,
      action: string,
      extra: Record<string, unknown> = {},
    ) => {
      setBusyKey(post.key);
      setError("");
      setMessage("");

      try {
        const response = await fetch("/api/facebook/batch", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: post.batchId,
            postId: post.postId,
            action,
            ...extra,
          }),
        });
        const data = await readJson<DetailResponse>(response);

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Post action complete nahi hui.",
          );
        }

        setMessage(data.message || "Post update ho gayi.");
        await loadAll(true);
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Post action complete nahi hui.",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [loadAll],
  );

  const openEdit = useCallback((post: PostItem) => {
    setEditState({
      batchId: post.batchId,
      postId: post.postId,
      label: `${post.batchName} · Group ${post.groupNumber} · Post ${post.postNumber}`,
      message: post.message,
      notBefore: toDateTimeLocal(post.notBefore),
    });
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editState) return;
    if (!editState.notBefore) {
      setError("Date aur time required hai.");
      return;
    }

    setSavingEdit(true);
    setError("");
    setMessage("");

    try {
      const date = new Date(editState.notBefore);
      if (Number.isNaN(date.getTime())) {
        throw new Error("Date aur time invalid hai.");
      }

      const response = await fetch("/api/facebook/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: editState.batchId,
          postId: editState.postId,
          action: "post_edit",
          message: editState.message,
          notBefore: date.toISOString(),
        }),
      });
      const data = await readJson<DetailResponse>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Post edit save nahi hui.");
      }

      setEditState(null);
      setMessage(data.message || "Post update ho gayi.");
      await loadAll(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Post edit save nahi hui.",
      );
    } finally {
      setSavingEdit(false);
    }
  }, [editState, loadAll]);

  async function cleanupR2Media() {
    setCleaning(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/facebook/batch/media-cleanup", {
        method: "POST",
      });
      const data = await readJson<{
        success: boolean;
        message?: string;
        cleanedPosts?: number;
        deletedObjects?: number;
        failures?: unknown[];
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.message || "R2 media cleanup failed.");
      }

      setMessage(
        data.message ||
          `R2 cleanup complete: ${data.deletedObjects || 0} file(s) deleted.`,
      );
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "R2 media cleanup failed.",
      );
    } finally {
      setCleaning(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <Link
                href="/facebook/batch"
                className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-800"
              >
                <ArrowLeft size={14} />
                Back to Facebook Batch
              </Link>
              <div className="mt-3 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <Layers3 size={20} />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-slate-950">
                    Manage All Batch Posts
                  </h1>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {batches.length} batch(es) · {posts.length} source post(s) · auto-refresh every 15 seconds
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAll(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={refreshing ? "animate-spin" : ""}
                />
                Refresh All
              </button>
              <button
                type="button"
                onClick={() => void cleanupR2Media()}
                disabled={cleaning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {cleaning ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                Cleanup R2 Media
              </button>
            </div>
          </div>
        </header>

        {message && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            {message}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black capitalize ${
                    filter === item
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item} ({counts[item]})
                </button>
              ))}
            </div>

            <label className="relative block w-full xl:w-[360px]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search batch, caption or Page..."
                className="h-9 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs font-bold outline-none focus:border-violet-400"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          {loading ? (
            <div className="grid min-h-64 place-items-center rounded-3xl border border-slate-200 bg-white">
              <Loader2 size={30} className="animate-spin text-slate-400" />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">
              Is filter/search mein koi post nahi mili.
            </div>
          ) : (
            filteredPosts.map((post) => {
              const expanded = expandedKey === post.key;
              const busy = busyKey === post.key;
              const editable = post.jobs.some(
                (job) =>
                  job.status !== "completed" && job.status !== "processing",
              );
              const cancellable = post.jobs.some((job) =>
                ["queued", "retrying", "failed"].includes(job.status),
              );
              const restorable = post.jobs.some(
                (job) => job.status === "cancelled",
              );
              const retryable = post.jobs.some(
                (job) => job.status === "failed",
              );
              const prioritizable = post.pendingJobs > 0;

              return (
                <article
                  key={post.key}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/facebook/batch/${encodeURIComponent(post.batchId)}`}
                            className="max-w-[420px] truncate rounded-lg bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-800 hover:bg-violet-200"
                          >
                            {post.batchName}
                          </Link>
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">
                            Group {post.groupNumber} · Post {post.postNumber}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${statusClass(post.status)}`}
                          >
                            {statusLabel(post.status)}
                          </span>
                        </div>

                        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">
                          {post.message || (
                            <span className="italic text-slate-400">
                              No caption
                            </span>
                          )}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-bold text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock size={13} />
                            {formatDate(post.notBefore)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <ImageIcon size={13} />
                            {post.imageCount} image(s)
                          </span>
                          <span>{post.hasVideo ? "1 video" : "No video"}</span>
                          <span>{post.jobs.length} Page job(s)</span>
                        </div>
                      </div>

                      <div className="flex max-w-2xl flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Is post ko is batch ki next due post banana hai?",
                              )
                            ) {
                              void runPostAction(post, "post_make_next");
                            }
                          }}
                          disabled={busy || !prioritizable}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <Send size={13} />
                          Next Now
                        </button>

                        <button
                          type="button"
                          onClick={() => openEdit(post)}
                          disabled={busy || !editable}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-200 px-2.5 py-1.5 text-[11px] font-black text-cyan-700 hover:bg-cyan-50 disabled:opacity-40"
                        >
                          <Edit3 size={13} />
                          Edit
                        </button>

                        {retryable && (
                          <button
                            type="button"
                            onClick={() =>
                              void runPostAction(post, "post_retry")
                            }
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2.5 py-1.5 text-[11px] font-black text-orange-700 hover:bg-orange-50 disabled:opacity-40"
                          >
                            <RotateCcw size={13} />
                            Retry
                          </button>
                        )}

                        {restorable && (
                          <button
                            type="button"
                            onClick={() =>
                              void runPostAction(post, "post_restore")
                            }
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-[11px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                          >
                            <PlayCircle size={13} />
                            Restore
                          </button>
                        )}

                        {cancellable && (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Is source post ki queued/retrying/failed Page jobs cancel karni hain?",
                                )
                              ) {
                                void runPostAction(post, "post_cancel");
                              }
                            }}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-black text-red-700 hover:bg-red-50 disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                            Cancel
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setExpandedKey(expanded ? null : post.key)}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-2.5 py-1.5 text-[11px] font-black text-violet-700 hover:bg-violet-50"
                        >
                          {expanded ? (
                            <ChevronUp size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                          Page Status
                        </button>

                        <Link
                          href={`/facebook/batch/${encodeURIComponent(post.batchId)}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink size={13} />
                          Batch
                        </Link>

                        {busy && (
                          <Loader2 size={16} className="animate-spin text-slate-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                        {post.jobs.map((job) => (
                          <div
                            key={job.id}
                            className="rounded-xl border border-slate-200 bg-white p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-black text-slate-900">
                                  {job.pageName}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                                  Attempt {job.attempts}/{job.maxAttempts}
                                </p>
                              </div>
                              <span
                                className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusClass(job.status)}`}
                              >
                                {statusLabel(job.status)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] font-semibold text-slate-500">
                              <p>Due: {formatDate(job.notBefore)}</p>
                              {job.completedAt && (
                                <p>Finished: {formatDate(job.completedAt)}</p>
                              )}
                              {job.facebookPostId && (
                                <p className="break-all">
                                  Facebook ID: {job.facebookPostId}
                                </p>
                              )}
                            </div>
                            {job.lastError && (
                              <div className="mt-2 rounded-lg border border-red-100 bg-red-50 p-2 text-[11px] font-semibold leading-5 text-red-700">
                                {job.lastError}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>

      {editState && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingEdit) {
              setEditState(null);
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-700">
                  <Edit3 size={20} />
                  <h2 className="text-lg font-black">Edit Pending Post</h2>
                </div>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {editState.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditState(null)}
                disabled={savingEdit}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-600">
              Caption / Message
            </label>
            <textarea
              rows={8}
              value={editState.message}
              onChange={(event) =>
                setEditState((current) =>
                  current
                    ? { ...current, message: event.target.value }
                    : current,
                )
              }
              disabled={savingEdit}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400 disabled:opacity-50"
            />

            <label className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600">
              Date and Time
            </label>
            <input
              type="datetime-local"
              value={editState.notBefore}
              onChange={(event) =>
                setEditState((current) =>
                  current
                    ? { ...current, notBefore: event.target.value }
                    : current,
                )
              }
              disabled={savingEdit}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400 disabled:opacity-50"
            />

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditState(null)}
                disabled={savingEdit}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={savingEdit || !editState.notBefore}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-black text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {savingEdit ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
