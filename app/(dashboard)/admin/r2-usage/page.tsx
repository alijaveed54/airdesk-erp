"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  ChevronRight,
  Cloud,
  Database,
  File,
  Folder,
  HardDrive,
  Home,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";

type Metric = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

type ExplorerFolder = {
  name: string;
  prefix: string;
  objectCount: number;
  totalSize: number;
  latestModified: string;
};

type ExplorerObject = {
  name: string;
  key: string;
  size: number;
  lastModified: string;
};

type UsageData = {
  success: true;
  bucketName: string;
  explorer: {
    currentPrefix: string;
    parentPrefix: string;
    totalObjects: number;
    totalSize: number;
    latestModified: string;
    folders: ExplorerFolder[];
    objects: ExplorerObject[];
    objectsTruncated: boolean;
    directObjectCount: number;
  };
  cloudflare:
    | {
        available: false;
        message: string;
      }
    | {
        available: true;
        period: {
          start: string;
          end: string;
        };
        storage: {
          usedBytes: number;
          payloadBytes: number;
          metadataBytes: number;
          limitBytes: number;
          remainingBytes: number;
          percent: number;
          objectCount: number;
          pendingUploads: number;
          measuredAt: string;
        };
        operations: {
          classA: Metric;
          classB: Metric;
          freeOperations: number;
          unclassified: number;
          breakdown: Array<{
            actionType: string;
            requests: number;
            class: string;
          }>;
        };
      };
  note: string;
  refreshedAt: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(percent: number) {
  if (percent >= 90) return "Critical";
  if (percent >= 70) return "Warning";
  return "Healthy";
}

function progressClass(percent: number) {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function badgeClass(percent: number) {
  if (percent >= 90) return "bg-red-50 text-red-700 border-red-200";
  if (percent >= 70) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function UsageCard({
  title,
  subtitle,
  used,
  limit,
  remaining,
  percent,
  formatter,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  formatter: (value: number) => string;
  icon: typeof Database;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-700">
          <Icon size={23} />
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-xs font-black ${badgeClass(
            percent,
          )}`}
        >
          {statusLabel(percent)}
        </span>
      </div>

      <p className="mt-5 text-sm font-black text-slate-500">{title}</p>
      <p className="mt-1 text-3xl font-black text-slate-950">
        {formatter(used)}
      </p>
      <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>

      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${progressClass(
            percent,
          )}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs font-black">
        <span className="text-slate-500">{percent.toFixed(2)}% used</span>
        <span className="text-slate-800">
          {formatter(remaining)} remaining
        </span>
      </div>

      <p className="mt-2 text-xs font-bold text-slate-400">
        Free limit: {formatter(limit)}
      </p>
    </div>
  );
}

export default function R2UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [deleteTarget, setDeleteTarget] = useState("");

  const loadUsage = useCallback(async (prefix = currentPrefix) => {
    setLoading(true);
    setError("");

    try {
      const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      const response = await fetch(`/api/admin/r2-usage${query}`, {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "R2 usage load failed");
      }

      setData(result);
      setCurrentPrefix(result.explorer.currentPrefix || "");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "R2 usage load failed",
      );
    } finally {
      setLoading(false);
    }
  }, [currentPrefix]);

  useEffect(() => {
    void loadUsage("");
    // Intentionally load the bucket root only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topOperations = useMemo(() => {
    if (!data?.cloudflare.available) return [];
    return data.cloudflare.operations.breakdown.slice(0, 10);
  }, [data]);

  const breadcrumbs = useMemo(() => {
    if (!data?.explorer.currentPrefix) return [];

    const parts = data.explorer.currentPrefix.split("/").filter(Boolean);
    let built = "";
    return parts.map((part) => {
      built += `${part}/`;
      return { label: part, prefix: built };
    });
  }, [data]);

  async function deleteR2Target(
    target: { key: string } | { prefix: string },
    displayName: string,
  ) {
    const targetValue = "key" in target ? target.key : target.prefix;
    const type = "key" in target ? "file" : "folder";
    const typed = window.prompt(
      `WARNING: ${type} permanently delete hoga:\n\n${targetValue}\n\nConfirm karne ke liye DELETE type karein.`,
      "",
    );

    if (typed !== "DELETE") return;

    setDeleteTarget(targetValue);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/r2-usage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, confirm: "DELETE" }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "R2 delete failed");
      }

      setMessage(
        `${displayName}: ${formatNumber(result.deletedCount || 0)} object(s), ${formatBytes(
          result.deletedBytes || 0,
        )} deleted.`,
      );
      await loadUsage(currentPrefix);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "R2 delete failed",
      );
    } finally {
      setDeleteTarget("");
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="text-center">
          <Loader2
            size={36}
            className="mx-auto animate-spin text-blue-600"
          />
          <p className="mt-3 font-black text-slate-600">
            Scanning R2 storage...
          </p>
        </div>
      </div>
    );
  }

  const cloudflare = data?.cloudflare;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
            <ShieldCheck size={18} />
            Admin Only
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Cloudflare R2 Usage & Storage Explorer
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Exact live object/folder sizes, Cloudflare usage estimates and safe delete controls.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadUsage(currentPrefix)}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          Refresh / Rescan
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-red-600" size={20} />
            <div>
              <p className="font-black text-red-800">R2 operation failed</p>
              <p className="mt-1 text-sm font-bold text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-800">
          {message}
        </div>
      )}

      {data && (
        <>
          <div className="rounded-3xl bg-gradient-to-r from-emerald-600 to-blue-600 p-6 text-white shadow-lg">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15">
                  <Cloud size={28} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-white/75">
                    Active Bucket
                  </p>
                  <p className="text-2xl font-black">{data.bucketName}</p>
                </div>
              </div>

              <div className="text-sm font-bold text-white/85 md:text-right">
                <p>Live scanned: {formatNumber(data.explorer.totalObjects)} objects</p>
                <p className="mt-1">Refreshed: {formatDate(data.refreshedAt)}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <HardDrive size={23} />
              </div>
              <p className="mt-5 text-sm font-black text-slate-500">
                Live R2 Explorer Size
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {formatBytes(data.explorer.totalSize)}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {formatNumber(data.explorer.totalObjects)} objects under {data.explorer.currentPrefix || "bucket root"}
              </p>
            </div>

            {cloudflare?.available ? (
              <>
                <UsageCard
                  title="Cloudflare Storage Estimate"
                  subtitle={`${formatNumber(
                    cloudflare.storage.objectCount,
                  )} objects in analytics snapshot`}
                  used={cloudflare.storage.usedBytes}
                  limit={cloudflare.storage.limitBytes}
                  remaining={cloudflare.storage.remainingBytes}
                  percent={cloudflare.storage.percent}
                  formatter={formatBytes}
                  icon={Database}
                />

                <UsageCard
                  title="Class A Operations"
                  subtitle="Writes, uploads, listings and mutations this month"
                  used={cloudflare.operations.classA.used}
                  limit={cloudflare.operations.classA.limit}
                  remaining={cloudflare.operations.classA.remaining}
                  percent={cloudflare.operations.classA.percent}
                  formatter={formatNumber}
                  icon={Zap}
                />
              </>
            ) : (
              <div className="xl:col-span-2 rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                <p className="font-black">Cloudflare analytics unavailable</p>
                <p className="mt-2 text-sm font-bold">{cloudflare?.message}</p>
              </div>
            )}
          </div>

          {cloudflare?.available && (
            <div className="grid gap-5 lg:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-500">Payload</p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {formatBytes(cloudflare.storage.payloadBytes)}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-500">Metadata</p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {formatBytes(cloudflare.storage.metadataBytes)}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-500">Class B</p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {formatNumber(cloudflare.operations.classB.used)}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-500">Pending Uploads</p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {formatNumber(cloudflare.storage.pendingUploads)}
                </p>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950">
                    Storage Explorer
                  </h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    Folder size is calculated from all descendant R2 objects.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs font-black text-slate-600">
                  <button
                    type="button"
                    onClick={() => void loadUsage("")}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-slate-100"
                  >
                    <Home size={14} /> Root
                  </button>
                  {breadcrumbs.map((crumb) => (
                    <span key={crumb.prefix} className="inline-flex items-center gap-1">
                      <ChevronRight size={13} className="text-slate-400" />
                      <button
                        type="button"
                        onClick={() => void loadUsage(crumb.prefix)}
                        className="rounded-lg px-2 py-1.5 hover:bg-slate-100"
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 border-b border-slate-100 bg-blue-50 px-5 py-3 text-sm font-black text-blue-700">
                <Loader2 size={16} className="animate-spin" /> Scanning this folder...
              </div>
            )}

            {data.explorer.currentPrefix && (
              <div className="border-b border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => void loadUsage(data.explorer.parentPrefix)}
                  className="text-sm font-black text-blue-700 hover:underline"
                >
                  ← Back to {data.explorer.parentPrefix || "bucket root"}
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Folder / Object</th>
                    <th className="px-5 py-4 text-right">Objects</th>
                    <th className="px-5 py-4 text-right">Size</th>
                    <th className="px-5 py-4">Latest Modified</th>
                    <th className="px-5 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.explorer.folders.map((folder) => (
                    <tr key={folder.prefix} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => void loadUsage(folder.prefix)}
                          className="inline-flex items-center gap-2 font-black text-blue-700 hover:underline"
                        >
                          <Folder size={18} /> {folder.name}/
                        </button>
                        <p className="mt-1 font-mono text-[11px] font-bold text-slate-400">
                          {folder.prefix}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right font-black text-slate-700">
                        {formatNumber(folder.objectCount)}
                      </td>
                      <td className="px-5 py-4 text-right text-lg font-black text-slate-950">
                        {formatBytes(folder.totalSize)}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-500">
                        {formatDate(folder.latestModified)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          disabled={Boolean(deleteTarget)}
                          onClick={() =>
                            void deleteR2Target(
                              { prefix: folder.prefix },
                              `${folder.name}/`,
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-40"
                          title="Permanently delete this folder and all objects inside it"
                        >
                          {deleteTarget === folder.prefix ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Delete Folder
                        </button>
                      </td>
                    </tr>
                  ))}

                  {data.explorer.objects.map((object) => (
                    <tr key={object.key} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 font-black text-slate-800">
                          <File size={17} className="text-slate-400" /> {object.name}
                        </div>
                        <p className="mt-1 max-w-[600px] break-all font-mono text-[11px] font-bold text-slate-400">
                          {object.key}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right font-black text-slate-500">1</td>
                      <td className="px-5 py-4 text-right font-black text-slate-950">
                        {formatBytes(object.size)}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-500">
                        {formatDate(object.lastModified)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          disabled={Boolean(deleteTarget)}
                          onClick={() =>
                            void deleteR2Target({ key: object.key }, object.name)
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-40"
                        >
                          {deleteTarget === object.key ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}

                  {data.explorer.folders.length === 0 && data.explorer.objects.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center font-bold text-slate-500">
                        This R2 folder is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.explorer.objectsTruncated && (
              <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs font-black text-amber-800">
                This folder contains {formatNumber(data.explorer.directObjectCount)} direct objects. For safety/performance only the largest 500 are shown; folder totals include all objects.
              </div>
            )}
          </div>

          {cloudflare?.available && (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-xl font-black text-slate-950">
                  Operation Breakdown
                </h2>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  Top Cloudflare request types recorded during the current month.
                </p>
              </div>

              {topOperations.length === 0 ? (
                <p className="p-8 text-center font-bold text-slate-500">
                  No operations recorded for this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Operation</th>
                        <th className="px-5 py-4">Class</th>
                        <th className="px-5 py-4 text-right">Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topOperations.map((operation) => (
                        <tr
                          key={`${operation.actionType}-${operation.class}`}
                          className="border-t border-slate-100"
                        >
                          <td className="px-5 py-4 font-black text-slate-800">
                            {operation.actionType}
                          </td>
                          <td className="px-5 py-4">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                              {operation.class}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-black text-slate-950">
                            {formatNumber(operation.requests)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            <p>{data.note}</p>
            <p className="mt-2">
              Delete is permanent. Product/Facebook URLs stored elsewhere can break if their R2 object is deleted. Inspect the folder first before deleting.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
