"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Copy,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Warehouse,
} from "lucide-react";

type ReadySegment = {
  key: string;
  kind: "new" | "old" | "supplier" | "instock";
  qty: number;
  supplier: string;
  label: string;
};

type ReadyOrder = {
  orderNo: string;
  totalPcs: number;
  newPcs: number;
  oldPcs: number;
  instockPcs: number;
  undatedReceivedPcs: number;
  formatted: string;
  segments: ReadySegment[];
  latestActivityDateTime: string;
};

type Summary = {
  totalOrders: number;
  totalPcs: number;
  newPcs: number;
  oldPcs: number;
  instockPcs: number;
  undatedReceivedPcs: number;
};

type ApiResponse = {
  success: boolean;
  message?: string;
  code?: string;
  baseName?: string;
  timezone?: string;
  generatedAt?: string;
  today?: string;
  orders?: ReadyOrder[];
  summary?: Summary;
};

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  totalPcs: 0,
  newPcs: 0,
  oldPcs: 0,
  instockPcs: 0,
  undatedReceivedPcs: 0,
};

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatUpdatedAt(value: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function segmentClass(kind: ReadySegment["kind"]) {
  switch (kind) {
    case "new":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "old":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "instock":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: typeof PackageCheck;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">
            {title}
          </p>
          <p className="mt-2 text-3xl font-black text-slate-950">
            {formatNumber(value)}
          </p>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon size={21} />
        </div>
      </div>
    </div>
  );
}

export default function ReadyToProcessOrderListPage() {
  const [orders, setOrders] = useState<ReadyOrder[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [baseName, setBaseName] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");
  const [copied, setCopied] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorCode("");

    try {
      const response = await fetch("/api/reports/ready-to-process", {
        cache: "no-store",
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.success) {
        setErrorCode(data.code || "");
        throw new Error(data.message || "Ready-to-process order list load failed");
      }

      setOrders(data.orders || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setBaseName(data.baseName || "BS Order Entry (UAE)");
      setGeneratedAt(data.generatedAt || "");
    } catch (loadError) {
      setOrders([]);
      setSummary(EMPTY_SUMMARY);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ready-to-process order list load failed",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orders;

    return orders.filter(
      (order) =>
        order.orderNo.toLowerCase().includes(query) ||
        order.formatted.toLowerCase().includes(query) ||
        order.segments.some((segment) =>
          segment.supplier.toLowerCase().includes(query),
        ),
    );
  }, [orders, search]);

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      alert("Copy failed. Please copy the text manually.");
    }
  }

  async function processOrders(orderNos: string[]) {
    if (orderNos.length === 0) {
      alert("Please select at least one order");
      return;
    }

    try {
      setProcessing(true);

      const response = await fetch("/api/reports/ready-to-process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderNos }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Process update failed");
      }

      const processedOrderNos = new Set<string>(
        Array.isArray(data.processedOrderNos) ? data.processedOrderNos : orderNos,
      );

      setSelectedOrders((current) =>
        current.filter((orderNo) => !processedOrderNos.has(orderNo)),
      );

      alert(data.message || "Order sent to Processing");
    } catch (processError) {
      alert(processError instanceof Error ? processError.message : "Process update failed");
    } finally {
      setProcessing(false);
    }
  }

  function toggleOrder(orderNo: string) {
    setSelectedOrders((current) =>
      current.includes(orderNo)
        ? current.filter((value) => value !== orderNo)
        : [...current, orderNo],
    );
  }

  function toggleSelectAllVisible() {
    const visibleOrderNos = filteredOrders.map((order) => order.orderNo);
    const allVisibleSelected =
      visibleOrderNos.length > 0 &&
      visibleOrderNos.every((orderNo) => selectedOrders.includes(orderNo));

    if (allVisibleSelected) {
      setSelectedOrders((current) =>
        current.filter((orderNo) => !visibleOrderNos.includes(orderNo)),
      );
      return;
    }

    setSelectedOrders((current) =>
      Array.from(new Set([...current, ...visibleOrderNos])),
    );
  }

  const visibleText = filteredOrders.map((order) => order.formatted).join("\n");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
            <CheckCircle2 size={18} />
            BS Order Entry (UAE) Only
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Ready to Process Order List
          </h1>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-slate-500">
            Only unprocessed Order Received orders where every piece is either
            received in UAE or already in stock.
          </p>
          <p className="mt-2 text-xs font-bold text-slate-400">
            {baseName || "BS Order Entry (UAE)"} · Pakistan time · Updated {formatUpdatedAt(generatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyText(visibleText, "all")}
            disabled={loading || filteredOrders.length === 0}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {copied === "all" ? <CheckCircle2 size={17} /> : <Clipboard size={17} />}
            {copied === "all" ? "Copied" : "Copy List"}
          </button>

          <button
            type="button"
            onClick={() => void processOrders(selectedOrders)}
            disabled={processing || selectedOrders.length === 0}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-50"
          >
            {processing ? <Loader2 size={17} className="animate-spin" /> : <PackageCheck size={17} />}
            Process Selected{selectedOrders.length ? ` (${selectedOrders.length})` : ""}
          </button>

          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="font-black text-red-800">Report could not load</p>
          <p className="mt-1 text-sm font-bold text-red-700">{error}</p>
          {errorCode === "BS_BASE_REQUIRED" && (
            <p className="mt-3 text-sm font-bold text-red-800">
              Use the business/base selector and select BS Order Entry (UAE), then refresh this page.
            </p>
          )}
        </div>
      )}

      {!error && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Ready Orders" value={summary.totalOrders} icon={PackageCheck} />
            <StatCard title="Total Pcs" value={summary.totalPcs} icon={Clipboard} />
            <StatCard title="New Pcs" value={summary.newPcs} icon={CheckCircle2} />
            <StatCard title="Old Pcs" value={summary.oldPcs} icon={RefreshCw} />
            <StatCard title="Instock Pcs" value={summary.instockPcs} icon={Warehouse} />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-950">
                  Formatted Processing List
                </h2>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  {filteredOrders.length} of {orders.length} ready orders
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={
                      filteredOrders.length > 0 &&
                      filteredOrders.every((order) => selectedOrders.includes(order.orderNo))
                    }
                    onChange={toggleSelectAllVisible}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Select All
                </label>

              <label className="relative block w-full lg:w-80">
                <Search
                  size={17}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event: { target: { value: string } }) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search order or supplier"
                  className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </label>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {loading && (
                <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-200 bg-slate-50">
                  <div className="text-center">
                    <Loader2 size={28} className="mx-auto animate-spin text-emerald-600" />
                    <p className="mt-3 font-black text-slate-600">
                      Checking ready orders...
                    </p>
                  </div>
                </div>
              )}

              {!loading && filteredOrders.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-14 text-center">
                  <PackageCheck size={32} className="mx-auto text-slate-300" />
                  <p className="mt-3 font-black text-slate-600">
                    No ready-to-process orders found.
                  </p>
                </div>
              )}

              {!loading &&
                filteredOrders.map((order) => (
                  <article
                    key={order.orderNo}
                    className="rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/30"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedOrders.includes(order.orderNo)}
                          onChange={() => toggleOrder(order.orderNo)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                          aria-label={`Select ${order.orderNo}`}
                        />
                        <div className="min-w-0">
                        <Link
                          href={`/orders/view/${encodeURIComponent(order.orderNo)}`}
                          className="break-words text-base font-black text-slate-950 hover:text-emerald-700"
                        >
                          {order.formatted}
                        </Link>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {order.segments.map((segment) => (
                            <span
                              key={`${order.orderNo}-${segment.key}`}
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${segmentClass(segment.kind)}`}
                            >
                              {segment.label}
                            </span>
                          ))}
                        </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(order.formatted, order.orderNo)
                        }
                        title="Copy this line"
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50"
                      >
                        {copied === order.orderNo ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                        {copied === order.orderNo ? "Copied" : "Copy"}
                      </button>

                      <button
                        type="button"
                        onClick={() => void processOrders([order.orderNo])}
                        disabled={processing}
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Process
                      </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
