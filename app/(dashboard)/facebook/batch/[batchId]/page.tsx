"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Film,
  Image as ImageIcon,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Save,
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

type DetailResponse = {
  success: boolean;
  message?: string;
  batch?: BatchSummary;
  jobs?: BatchJob[];
};

type PostStatus =
  | JobStatus
  | "partial";

type PostItem = {
  postId: string;
  groupId: string;
  groupNumber: number;
  postNumber: number;
  message: string;
  imageUrls: string[];
  imageNames: string[];
  videoUrl?: string;
  videoName?: string;
  videoPosition?: "first" | "last";
  priority: number;
  notBefore: string;
  status: PostStatus;
  jobs: BatchJob[];
  pendingJobs: number;
};

type EditState = {
  postId: string;
  label: string;
  message: string;
  notBefore: string;
};

const FILTERS = [
  "all",
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

type FilterValue =
  typeof FILTERS[number];

async function readJson<T>(
  response: Response
): Promise<T> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      text.slice(0, 500) ||
      "Server response valid JSON nahi hai."
    );
  }
}

function formatDate(
  value?: string
) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  );
}

function toDateTimeLocal(
  value: string
) {
  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const offset =
    date.getTimezoneOffset();
  const localDate =
    new Date(
      date.getTime() -
      offset * 60 * 1000
    );

  return localDate
    .toISOString()
    .slice(0, 16);
}

function statusLabel(
  status: PostStatus
) {
  const labels: Record<
    PostStatus,
    string
  > = {
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

function statusClass(
  status: PostStatus
) {
  const classes: Record<
    PostStatus,
    string
  > = {
    queued:
      "border-blue-200 bg-blue-50 text-blue-700",
    processing:
      "border-violet-200 bg-violet-50 text-violet-700",
    retrying:
      "border-orange-200 bg-orange-50 text-orange-700",
    completed:
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed:
      "border-red-200 bg-red-50 text-red-700",
    cancelled:
      "border-slate-200 bg-slate-100 text-slate-600",
    partial:
      "border-amber-200 bg-amber-50 text-amber-700",
  };

  return classes[status];
}

function calculatePostStatus(
  jobs: BatchJob[]
): PostStatus {
  if (
    jobs.some(
      (job) =>
        job.status ===
        "processing"
    )
  ) {
    return "processing";
  }

  if (
    jobs.every(
      (job) =>
        job.status ===
        "completed"
    )
  ) {
    return "completed";
  }

  if (
    jobs.every(
      (job) =>
        job.status ===
        "cancelled"
    )
  ) {
    return "cancelled";
  }

  if (
    jobs.every(
      (job) =>
        job.status ===
        "failed"
    )
  ) {
    return "failed";
  }

  if (
    jobs.some(
      (job) =>
        job.status ===
        "retrying"
    ) &&
    jobs.every(
      (job) =>
        [
          "queued",
          "retrying",
        ].includes(
          job.status
        )
    )
  ) {
    return "retrying";
  }

  if (
    jobs.every(
      (job) =>
        job.status ===
          "queued" ||
        job.status ===
          "retrying"
    )
  ) {
    return "queued";
  }

  return "partial";
}

function summarizePosts(
  jobs: BatchJob[]
): PostItem[] {
  const groups =
    new Map<
      string,
      BatchJob[]
    >();

  for (const job of jobs) {
    const existing =
      groups.get(job.postId) || [];

    existing.push(job);
    groups.set(
      job.postId,
      existing
    );
  }

  return Array.from(
    groups.entries()
  )
    .map(
      ([postId, postJobs]) => {
        const first =
          postJobs[0];

        const timeValues =
          postJobs
            .map((job) =>
              new Date(
                job.notBefore
              ).getTime()
            )
            .filter(
              Number.isFinite
            );

        const earliest =
          timeValues.length
            ? Math.min(
                ...timeValues
              )
            : Date.now();

        return {
          postId,
          groupId:
            first.groupId,
          groupNumber:
            first.groupNumber,
          postNumber:
            first.postNumber,
          message:
            first.message,
          imageUrls:
            first.imageUrls || [],
          imageNames:
            first.imageNames || [],
          videoUrl:
            first.videoUrl,
          videoName:
            first.videoName,
          videoPosition:
            first.videoPosition,
          priority:
            Math.max(
              ...postJobs.map(
                (job) =>
                  Number(
                    job.priority || 0
                  )
              )
            ),
          notBefore:
            new Date(
              earliest
            ).toISOString(),
          status:
            calculatePostStatus(
              postJobs
            ),
          jobs:
            [...postJobs].sort(
              (firstJob, secondJob) =>
                firstJob.pageName
                  .localeCompare(
                    secondJob.pageName
                  )
            ),
          pendingJobs:
            postJobs.filter(
              (job) =>
                job.status ===
                  "queued" ||
                job.status ===
                  "retrying"
            ).length,
        };
      }
    )
    .sort(
      (first, second) =>
        second.priority -
          first.priority ||
        new Date(
          first.notBefore
        ).getTime() -
          new Date(
            second.notBefore
          ).getTime() ||
        first.groupNumber -
          second.groupNumber ||
        first.postNumber -
          second.postNumber
    );
}

export default function FacebookBatchPostControlPage() {
  const params =
    useParams<{
      batchId: string;
    }>();

  const batchId =
    decodeURIComponent(
      String(
        params?.batchId || ""
      )
    );

  const [batch, setBatch] =
    useState<
      BatchSummary | null
    >(null);
  const [jobs, setJobs] =
    useState<BatchJob[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [filter, setFilter] =
    useState<FilterValue>("all");
  const [expandedPostId, setExpandedPostId] =
    useState<string | null>(null);
  const [busyPostId, setBusyPostId] =
    useState<string | null>(null);
  const [editState, setEditState] =
    useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] =
    useState(false);

  const loadDetails =
    useCallback(
      async (
        silent = false
      ) => {
        if (!batchId) {
          return;
        }

        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        try {
          const response =
            await fetch(
              `/api/facebook/batch?batchId=${encodeURIComponent(
                batchId
              )}`,
              {
                cache: "no-store",
              }
            );

          const data =
            await readJson<DetailResponse>(
              response
            );

          if (
            !response.ok ||
            !data.success ||
            !data.batch
          ) {
            throw new Error(
              data.message ||
              "Batch detail load nahi hui."
            );
          }

          setBatch(data.batch);
          setJobs(
            data.jobs || []
          );
          setError("");
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Batch detail load nahi hui."
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [batchId]
    );

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          if (
            !editState &&
            !busyPostId
          ) {
            void loadDetails(true);
          }
        },
        10000
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [
    busyPostId,
    editState,
    loadDetails,
  ]);

  const posts =
    useMemo(
      () => summarizePosts(jobs),
      [jobs]
    );

  const filteredPosts =
    useMemo(() => {
      if (filter === "all") {
        return posts;
      }

      if (filter === "pending") {
        return posts.filter(
          (post) =>
            post.status ===
              "queued" ||
            post.status ===
              "retrying" ||
            post.status ===
              "partial"
        );
      }

      return posts.filter(
        (post) =>
          post.status === filter
      );
    }, [filter, posts]);

  const counts =
    useMemo(
      () => ({
        all: posts.length,
        pending:
          posts.filter(
            (post) =>
              post.status ===
                "queued" ||
              post.status ===
                "retrying" ||
              post.status ===
                "partial"
          ).length,
        processing:
          posts.filter(
            (post) =>
              post.status ===
              "processing"
          ).length,
        completed:
          posts.filter(
            (post) =>
              post.status ===
              "completed"
          ).length,
        failed:
          posts.filter(
            (post) =>
              post.status ===
              "failed"
          ).length,
        cancelled:
          posts.filter(
            (post) =>
              post.status ===
              "cancelled"
          ).length,
      }),
      [posts]
    );

  const runPostAction =
    useCallback(
      async (
        postId: string,
        action: string,
        extra: Record<
          string,
          unknown
        > = {}
      ) => {
        setBusyPostId(postId);
        setMessage("");
        setError("");

        try {
          const response =
            await fetch(
              "/api/facebook/batch",
              {
                method: "PATCH",
                headers: {
                  "Content-Type":
                    "application/json",
                },
                body: JSON.stringify({
                  batchId,
                  postId,
                  action,
                  ...extra,
                }),
              }
            );

          const data =
            await readJson<DetailResponse>(
              response
            );

          if (
            !response.ok ||
            !data.success
          ) {
            throw new Error(
              data.message ||
              "Post action complete nahi hui."
            );
          }

          setMessage(
            data.message ||
            "Post update ho gayi."
          );
          await loadDetails(true);
        } catch (actionError) {
          setError(
            actionError instanceof Error
              ? actionError.message
              : "Post action complete nahi hui."
          );
        } finally {
          setBusyPostId(null);
        }
      },
      [batchId, loadDetails]
    );

  const openEdit =
    useCallback(
      (post: PostItem) => {
        setEditState({
          postId: post.postId,
          label:
            `Group ${post.groupNumber} · Post ${post.postNumber}`,
          message: post.message,
          notBefore:
            toDateTimeLocal(
              post.notBefore
            ),
        });
      },
      []
    );

  const saveEdit =
    useCallback(async () => {
      if (!editState) {
        return;
      }

      if (!editState.notBefore) {
        setError(
          "Date aur time required hai."
        );
        return;
      }

      setSavingEdit(true);
      setError("");
      setMessage("");

      try {
        const date =
          new Date(
            editState.notBefore
          );

        if (
          Number.isNaN(
            date.getTime()
          )
        ) {
          throw new Error(
            "Date aur time invalid hai."
          );
        }

        const response =
          await fetch(
            "/api/facebook/batch",
            {
              method: "PATCH",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                batchId,
                postId:
                  editState.postId,
                action:
                  "post_edit",
                message:
                  editState.message,
                notBefore:
                  date.toISOString(),
              }),
            }
          );

        const data =
          await readJson<DetailResponse>(
            response
          );

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
            "Post edit save nahi hui."
          );
        }

        setEditState(null);
        setMessage(
          data.message ||
          "Post update ho gayi."
        );
        await loadDetails(true);
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Post edit save nahi hui."
        );
      } finally {
        setSavingEdit(false);
      }
    }, [
      batchId,
      editState,
      loadDetails,
    ]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              href="/facebook/batch"
              className="inline-flex items-center gap-2 text-sm font-black text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft size={16} />
              Back to Facebook Batch
            </Link>

            <h1 className="mt-3 text-2xl font-black text-slate-950">
              Pending Post Control
            </h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {batch?.name || "Loading batch..."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {batch && (
              <>
                <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${statusClass(
                  batch.status === "partial"
                    ? "partial"
                    : batch.status === "creating" ||
                        batch.status === "paused"
                      ? "queued"
                      : batch.status
                )}`}>
                  {batch.status}
                </span>
                <span className="text-sm font-black text-slate-700">
                  {batch.progressPercent}% complete
                </span>
              </>
            )}

            <button
              type="button"
              onClick={() =>
                void loadDetails(true)
              }
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={
                  refreshing
                    ? "animate-spin"
                    : ""
                }
              />
              Refresh
            </button>
          </div>
        </div>

        {message && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            <CheckCircle2
              size={18}
              className="mt-0.5 shrink-0"
            />
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <AlertCircle
              size={18}
              className="mt-0.5 shrink-0"
            />
            {error}
          </div>
        )}

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() =>
                    setFilter(item)
                  }
                  className={`rounded-xl border px-3 py-2 text-xs font-black capitalize ${
                    filter === item
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item} ({counts[item]})
                </button>
              )
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-900">
            Har row ek source post hai. Same post multiple Facebook Pages par assigned ho to page-wise live status row expand kar ke nazar aayega. Priority isi batch ke pending posts par apply hoti hai. Completed aur currently processing jobs edit/cancel nahi hotin.
          </div>
        </section>

        <section className="mt-5 space-y-4">
          {loading ? (
            <div className="grid min-h-64 place-items-center rounded-3xl border border-slate-200 bg-white">
              <Loader2
                size={30}
                className="animate-spin text-slate-400"
              />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">
              Is filter mein koi post nahi mili.
            </div>
          ) : (
            filteredPosts.map(
              (post, index) => {
                const expanded =
                  expandedPostId ===
                  post.postId;
                const busy =
                  busyPostId ===
                  post.postId;
                const editable =
                  post.jobs.some(
                    (job) =>
                      job.status !==
                        "completed" &&
                      job.status !==
                        "processing"
                  );
                const cancellable =
                  post.jobs.some(
                    (job) =>
                      job.status ===
                        "queued" ||
                      job.status ===
                        "retrying" ||
                      job.status ===
                        "failed"
                  );
                const restorable =
                  post.jobs.some(
                    (job) =>
                      job.status ===
                        "cancelled"
                  );
                const retryable =
                  post.jobs.some(
                    (job) =>
                      job.status ===
                        "failed"
                  );
                const prioritizable =
                  post.pendingJobs > 0;

                return (
                  <article
                    key={post.postId}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-black text-white">
                              Priority #{index + 1}
                            </span>
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                              Group {post.groupNumber} · Post {post.postNumber}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(
                              post.status
                            )}`}>
                              {statusLabel(
                                post.status
                              )}
                            </span>
                          </div>

                          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">
                            {post.message || (
                              <span className="italic text-slate-400">
                                No caption
                              </span>
                            )}
                          </p>

                          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-slate-500">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarClock size={14} />
                              {formatDate(
                                post.notBefore
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <ImageIcon size={14} />
                              {post.imageUrls.length} image(s)
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Film size={14} />
                              {post.videoUrl
                                ? "1 video"
                                : "No video"}
                            </span>
                            <span>
                              {post.jobs.length} Page job(s)
                            </span>
                            <span>
                              Stored priority: {post.priority}
                            </span>
                          </div>
                        </div>

                        <div className="flex max-w-2xl flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void runPostAction(
                                post.postId,
                                "post_move_up"
                              )
                            }
                            disabled={
                              busy ||
                              !prioritizable ||
                              index === 0
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            title="Move priority up"
                          >
                            <ArrowUp size={14} />
                            Up
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void runPostAction(
                                post.postId,
                                "post_move_down"
                              )
                            }
                            disabled={
                              busy ||
                              !prioritizable ||
                              index ===
                                posts.length - 1
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            title="Move priority down"
                          >
                            <ArrowDown size={14} />
                            Down
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Is post ko is batch ki next due post banana hai? Iska scheduled time current time ho jayega."
                                )
                              ) {
                                void runPostAction(
                                  post.postId,
                                  "post_make_next"
                                );
                              }
                            }}
                            disabled={
                              busy ||
                              !prioritizable
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            <Send size={14} />
                            Make Next Now
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              openEdit(post)
                            }
                            disabled={
                              busy ||
                              !editable
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 px-3 py-2 text-xs font-black text-cyan-700 hover:bg-cyan-50 disabled:opacity-40"
                          >
                            <Edit3 size={14} />
                            Edit
                          </button>

                          {retryable && (
                            <button
                              type="button"
                              onClick={() =>
                                void runPostAction(
                                  post.postId,
                                  "post_retry"
                                )
                              }
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-orange-200 px-3 py-2 text-xs font-black text-orange-700 hover:bg-orange-50 disabled:opacity-40"
                            >
                              <RotateCcw size={14} />
                              Retry Failed
                            </button>
                          )}

                          {restorable && (
                            <button
                              type="button"
                              onClick={() =>
                                void runPostAction(
                                  post.postId,
                                  "post_restore"
                                )
                              }
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                            >
                              <PlayCircle size={14} />
                              Restore
                            </button>
                          )}

                          {cancellable && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Is source post ki tamam queued/retrying/failed Page jobs cancel karni hain? Completed aur processing jobs touch nahi hongi."
                                  )
                                ) {
                                  void runPostAction(
                                    post.postId,
                                    "post_cancel"
                                  );
                                }
                              }}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-40"
                            >
                              <Trash2 size={14} />
                              Cancel Post
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPostId(
                                expanded
                                  ? null
                                  : post.postId
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-50"
                          >
                            {expanded ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                            Page Status
                          </button>

                          {busy && (
                            <Loader2
                              size={18}
                              className="animate-spin text-slate-400"
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-slate-200 bg-slate-50 p-5">
                        <h3 className="text-sm font-black text-slate-900">
                          Live Page-job Status
                        </h3>

                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          {post.jobs.map(
                            (job) => (
                              <div
                                key={job.id}
                                className="rounded-2xl border border-slate-200 bg-white p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-black text-slate-900">
                                      {job.pageName}
                                    </p>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">
                                      Attempt {job.attempts}/{job.maxAttempts}
                                    </p>
                                  </div>
                                  <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(
                                    job.status
                                  )}`}>
                                    {statusLabel(
                                      job.status
                                    )}
                                  </span>
                                </div>

                                <div className="mt-3 space-y-1 text-xs font-semibold text-slate-500">
                                  <p>
                                    Due: {formatDate(
                                      job.notBefore
                                    )}
                                  </p>
                                  {job.startedAt && (
                                    <p>
                                      Started: {formatDate(
                                        job.startedAt
                                      )}
                                    </p>
                                  )}
                                  {job.completedAt && (
                                    <p>
                                      Finished: {formatDate(
                                        job.completedAt
                                      )}
                                    </p>
                                  )}
                                  {job.facebookPostId && (
                                    <p className="break-all">
                                      Facebook ID: {job.facebookPostId}
                                    </p>
                                  )}
                                </div>

                                {job.lastError && (
                                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">
                                    {job.lastError}
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              }
            )
          )}
        </section>
      </div>

      {editState && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !savingEdit
            ) {
              setEditState(null);
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-700">
                  <Edit3 size={20} />
                  <h2 className="text-lg font-black">
                    Edit Pending Post
                  </h2>
                </div>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {editState.label}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEditState(null)
                }
                disabled={savingEdit}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
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
                setEditState(
                  (current) =>
                    current
                      ? {
                          ...current,
                          message:
                            event.target.value,
                        }
                      : current
                )
              }
              disabled={savingEdit}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
            />

            <label className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600">
              Date and Time
            </label>
            <input
              type="datetime-local"
              value={editState.notBefore}
              onChange={(event) =>
                setEditState(
                  (current) =>
                    current
                      ? {
                          ...current,
                          notBefore:
                            event.target.value,
                        }
                      : current
                )
              }
              disabled={savingEdit}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
            />

            <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900">
              Caption aur schedule same source post ki tamam editable Page jobs par update honge. Completed aur currently processing Page jobs preserve rahengi. Media aur selected Pages queue create hone ke baad is screen se change nahi hotin.
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  setEditState(null)
                }
                disabled={savingEdit}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() =>
                  void saveEdit()
                }
                disabled={
                  savingEdit ||
                  !editState.notBefore
                }
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-black text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {savingEdit ? (
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                ) : (
                  <Save size={16} />
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
