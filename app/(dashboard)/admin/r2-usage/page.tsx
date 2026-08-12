"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";

type Metric = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

type UsageData = {
  success: true;
  bucketName: string;
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
  note: string;
  refreshedAt: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${
    units[index]
  }`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
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
            percent
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
            percent
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

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/r2-usage", {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "R2 usage load failed");
      }

      setData(result);
    } catch (fetchError) {
      setData(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "R2 usage load failed"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const topOperations = useMemo(
    () => data?.operations.breakdown.slice(0, 10) || [],
    [data]
  );

  if (loading && !data) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="text-center">
          <Loader2
            size={36}
            className="mx-auto animate-spin text-blue-600"
          />
          <p className="mt-3 font-black text-slate-600">
            Loading R2 usage...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
            <ShieldCheck size={18} />
            Admin Only
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Cloudflare R2 Usage
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Free-tier storage and monthly operation usage estimates.
          </p>
        </div>

        <button
          type="button"
          onClick={loadUsage}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          Refresh Usage
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-red-600" size={20} />
            <div>
              <p className="font-black text-red-800">Usage could not load</p>
              <p className="mt-1 text-sm font-bold text-red-700">{error}</p>
            </div>
          </div>
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
                <p>
                  Current month:{" "}
                  {new Date(data.period.start).toLocaleDateString()} –{" "}
                  {new Date(data.period.end).toLocaleDateString()}
                </p>
                <p className="mt-1">
                  Refreshed:{" "}
                  {new Date(data.refreshedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <UsageCard
              title="Standard Storage"
              subtitle={`${formatNumber(
                data.storage.objectCount
              )} objects currently stored`}
              used={data.storage.usedBytes}
              limit={data.storage.limitBytes}
              remaining={data.storage.remainingBytes}
              percent={data.storage.percent}
              formatter={formatBytes}
              icon={Database}
            />

            <UsageCard
              title="Class A Operations"
              subtitle="Writes, uploads, listings and mutations this month"
              used={data.operations.classA.used}
              limit={data.operations.classA.limit}
              remaining={data.operations.classA.remaining}
              percent={data.operations.classA.percent}
              formatter={formatNumber}
              icon={Zap}
            />

            <UsageCard
              title="Class B Operations"
              subtitle="Reads, downloads and metadata requests this month"
              used={data.operations.classB.used}
              limit={data.operations.classB.limit}
              remaining={data.operations.classB.remaining}
              percent={data.operations.classB.percent}
              formatter={formatNumber}
              icon={Box}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase text-slate-500">
                Payload Data
              </p>
              <p className="mt-2 text-2xl font-black text-slate-950">
                {formatBytes(data.storage.payloadBytes)}
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase text-slate-500">
                Metadata
              </p>
              <p className="mt-2 text-2xl font-black text-slate-950">
                {formatBytes(data.storage.metadataBytes)}
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase text-slate-500">
                Free Operations
              </p>
              <p className="mt-2 text-2xl font-black text-slate-950">
                {formatNumber(data.operations.freeOperations)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-xl font-black text-slate-950">
                Operation Breakdown
              </h2>
              <p className="mt-1 text-sm font-bold text-slate-500">
                Top request types recorded during the current month.
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

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            {data.note}
          </div>
        </>
      )}
    </div>
  );
}
