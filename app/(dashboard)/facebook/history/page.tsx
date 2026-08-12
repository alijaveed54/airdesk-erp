"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Share2,
  ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type HistoryItem = {
  id: string;
  date: string;
  user: string;
  pageName: string;
  pageId: string;
  message: string;
  imageUrls: string[];
  status: "Success" | "Failed" | "Scheduled" | string;
  scheduledAt?: string;
  facebookPostId: string;
  error: string;
};

type HistoryResponse = {
  success: boolean;
  message?: string;
  history?: HistoryItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ActionResponse = {
  success: boolean;
  message?: string;
};

function formatDate(value: string) {
  if (!value) return "â€”";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function truncate(value: string, limit = 130) {
  if (!value) return "No caption";
  return value.length > limit ? `${value.slice(0, limit)}â€¦` : value;
}

export default function FacebookHistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [syncingBatchHistory, setSyncingBatchHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });

    if (search.trim()) params.set("search", search.trim());
    if (status !== "All") params.set("status", status);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    return params.toString();
  }, [dateFrom, dateTo, page, pageSize, search, status]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/facebook/history?${queryString}`, {
        cache: "no-store",
      });
      const data: HistoryResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook history load nahi hui.");
      }

      setHistory(data.history || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(Math.max(1, data.pagination?.totalPages || 1));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Facebook history load nahi hui."
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setPage(1);
  }, [search, status, dateFrom, dateTo]);

  async function syncBatchHistory() {
    setSyncingBatchHistory(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/facebook/history/sync-batch", {
        method: "POST",
      });
      const data: ActionResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Batch history sync failed.");
      }

      setNotice(data.message || "Batch history sync complete.");
      await loadHistory();
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Batch history sync failed.",
      );
    } finally {
      setSyncingBatchHistory(false);
    }
  }
  async function retryPost(recordId: string) {
    setBusyId(recordId);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/facebook/history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "retry",
          recordId,
        }),
      });

      const data: ActionResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Retry failed.");
      }

      setNotice(data.message || "Post dobara publish ho gaya.");
      await loadHistory();
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "Retry failed."
      );
    } finally {
      setBusyId("");
    }
  }

  async function deleteHistory(recordId: string) {
    const confirmed = window.confirm(
      "Ye Facebook history record delete karna hai?"
    );

    if (!confirmed) return;

    setBusyId(recordId);
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/facebook/history?recordId=${encodeURIComponent(recordId)}`,
        {
          method: "DELETE",
        }
      );
      const data: ActionResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "History delete nahi hui.");
      }

      setNotice(data.message || "History record delete ho gaya.");

      if (history.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        await loadHistory();
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "History delete nahi hui."
      );
    } finally {
      setBusyId("");
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("All");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-700">
              <Share2 size={22} />
            </div>

            <div>
              <h1 className="text-2xl font-black text-slate-900">
                Facebook Post History
              </h1>
              <p className="text-sm text-slate-500">
                Published aur failed posts ka complete record.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void syncBatchHistory()}
              disabled={syncingBatchHistory || loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
              title="Recover completed Facebook Batch posts from R2 job history"
            >
              <RotateCcw
                size={17}
                className={syncingBatchHistory ? "animate-spin" : ""}
              />
              {syncingBatchHistory ? "Syncing..." : "Sync Batch History"}
            </button>
          <button
            type="button"
            onClick={loadHistory}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          </div>
        </div>
      </section>

      {(notice || error) && (
        <section
          className={[
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold",
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          ].join(" ")}
        >
          {error ? <XCircle size={19} /> : <CheckCircle2 size={19} />}
          <span>{error || notice}</span>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_180px_180px_180px_auto]">
          <label className="relative">
            <Search
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Page, user, caption ya Post ID search..."
              className="h-12 w-full rounded-2xl border border-slate-200 pl-11 pr-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          >
            <option value="All">All Status</option>
            <option value="Success">Success</option>
            <option value="Scheduled">Scheduled</option>
            <option value="Failed">Failed</option>
          </select>

          <label className="relative">
            <CalendarDays
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <label className="relative">
            <CalendarDays
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <button
            type="button"
            onClick={clearFilters}
            className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-7">
          <h2 className="font-black text-slate-900">Records: {total}</h2>
          <span className="text-xs font-bold text-slate-500">
            Page {page} of {totalPages}
          </span>
        </div>

        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 size={28} className="animate-spin text-blue-600" />
          </div>
        ) : history.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-6 text-center">
            <div>
              <Share2 className="mx-auto mb-3 text-slate-300" size={38} />
              <p className="font-bold text-slate-700">
                Koi Facebook history record nahi mila.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-4 sm:px-7">Date</th>
                  <th className="px-5 py-4">Page</th>
                  <th className="px-5 py-4">Caption</th>
                  <th className="px-5 py-4">Images</th>
                  <th className="px-5 py-4">User</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right sm:pr-7">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {history.map((item) => {
                  const busy = busyId === item.id;
                  const failed = item.status === "Failed";
                  const scheduled = item.status === "Scheduled";

                  return (
                    <tr key={item.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-600 sm:px-7">
                        {formatDate(item.date)}
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-black text-slate-900">
                          {item.pageName || "Unknown Page"}
                        </p>
                        <p className="text-xs text-slate-500">{item.pageId}</p>
                      </td>

                      <td className="max-w-sm px-5 py-4 text-sm text-slate-600">
                        {truncate(item.message)}
                      </td>

                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-600">
                          <ImageIcon size={14} />
                          {item.imageUrls.length}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-sm font-semibold text-slate-600">
                        {item.user || "â€”"}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={[
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black",
                            scheduled
                              ? "bg-violet-100 text-violet-700"
                              : failed
                                ? "bg-red-100 text-red-700"
                                : "bg-emerald-100 text-emerald-700",
                          ].join(" ")}
                        >
                          {scheduled ? (
                            <CalendarDays size={14} />
                          ) : failed ? (
                            <XCircle size={14} />
                          ) : (
                            <CheckCircle2 size={14} />
                          )}
                          {item.status}
                        </span>
                      </td>

                      <td className="px-5 py-4 sm:pr-7">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelected(item)}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100"
                            title="View details"
                          >
                            <Eye size={16} />
                          </button>

                          {failed && (
                            <button
                              type="button"
                              onClick={() => retryPost(item.id)}
                              disabled={busy}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-blue-200 text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                              title="Retry post"
                            >
                              {busy ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <RotateCcw size={16} />
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => deleteHistory(item.id)}
                            disabled={busy}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-red-200 text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                            title="Delete history"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft size={16} />
            Previous
          </button>

          <span className="text-sm font-bold text-slate-500">
            {page} / {totalPages}
          </span>

          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={page >= totalPages || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  {selected.pageName}
                </h2>
                <p className="text-xs text-slate-500">
                  {formatDate(selected.date)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5 sm:p-7">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
                  Caption
                </p>
                <div className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {selected.message || "No caption"}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
                  Image URLs
                </p>
                {selected.imageUrls.length === 0 ? (
                  <p className="text-sm text-slate-500">No images</p>
                ) : (
                  <div className="space-y-2">
                    {selected.imageUrls.map((url, index) => (
                      <a
                        key={`${url}-${index}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Image {index + 1}: {url}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Facebook Post ID
                  </p>
                  <p className="mt-1 break-all text-sm font-bold text-slate-700">
                    {selected.facebookPostId || "â€”"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-black uppercase text-slate-400">
                    Posted By
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-700">
                    {selected.user || "â€”"}
                  </p>
                </div>
              </div>

              {selected.error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-black uppercase text-red-500">
                    Error
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-red-700">
                    {selected.error}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
