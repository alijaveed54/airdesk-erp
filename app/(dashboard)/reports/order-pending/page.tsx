"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type PendingRow = {
  id: string;
  source: string;
  orderNo: string;
  orderDate: string;
  pendingDays: number;
  customerName: string;
  customerMobile: string;
  sku: string;
  qty: number;
  supplier: string;
  billNo: string;
  receivedInWh1: string;
  receivedInWh1Yes: boolean;
  receivedInUae: string;
  receivedInUaeYes: boolean;
  receivedInUaeDate: string;
  imageUrl: string;
  stockOut: boolean;
};

type Summary = {
  totalLines: number;
  totalQty: number;
  stockOutLines: number;
  receivedUaeLines: number;
  receivedWh1Lines: number;
  pendingLines: number;
};

const EMPTY_SUMMARY: Summary = {
  totalLines: 0,
  totalQty: 0,
  stockOutLines: 0,
  receivedUaeLines: 0,
  receivedWh1Lines: 0,
  pendingLines: 0,
};

function formatDate(value: string) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function rowClass(row: PendingRow) {
  if (row.stockOut) return "bg-red-100 hover:bg-red-200";
  if (row.receivedInUaeYes) return "bg-emerald-100 hover:bg-emerald-200";
  if (row.receivedInWh1Yes) return "bg-sky-100 hover:bg-sky-200";
  return "bg-white hover:bg-slate-50";
}

export default function OrderPendingReportPage() {
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [state, setState] = useState("");
  const [minAgeDays, setMinAgeDays] = useState("5");
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [previewImage, setPreviewImage] = useState("");

  async function loadReport(silent = false) {
    if (!silent) setLoading(true);

    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (supplier) params.set("supplier", supplier);
      if (state) params.set("state", state);
      params.set("minAgeDays", minAgeDays || "5");

      const response = await fetch(`/api/reports/order-pending?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Order pending report load failed");
      }

      setRows(data.rows || []);
      setSuppliers(data.suppliers || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setLastUpdated(new Date());
    } catch (error: any) {
      if (!silent) alert(error?.message || "Order pending report load failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, []);

  function exportExcel() {
    const exportRows = rows.map((row) => ({
      "Order No": row.orderNo,
      "Order Date": row.orderDate,
      "Pending Days": row.pendingDays,
      "Customer Name": row.customerName,
      "Customer Mobile Number": row.customerMobile,
      SKU: row.sku,
      Quantity: row.qty,
      Supplier: row.supplier,
      "Dispatch Bill No": row.billNo,
      "Dispatched From India": row.receivedInWh1,
      "Received in UAE": row.receivedInUae,
      "Received in UAE Date": row.receivedInUaeDate,
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(exportRows);
    sheet["!cols"] = [
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 26 },
      { wch: 22 },
      { wch: 22 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
    ];

    XLSX.utils.book_append_sheet(workbook, sheet, "Order Pending");
    XLSX.writeFile(workbook, "order-pending-report.xlsx");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Order Pending Report</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Orders from the currently selected base with status Order Received and order age of at least {minAgeDays} days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadReport()}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          <Link
            href="/reports"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
          >
            Back to Reports
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="text-xs font-black text-slate-500">Search</label>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order / SKU / Customer / Mobile"
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            />
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">Supplier</label>
            <select
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">Row Status</label>
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              <option value="">All</option>
              <option value="stock-out">Stock Out</option>
              <option value="received-uae">Received in UAE</option>
              <option value="received-wh1">Dispatched From India</option>
              <option value="pending">Still Pending</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">Order Age</label>
            <select
              value={minAgeDays}
              onChange={(event) => setMinAgeDays(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              <option value="5">5+ Days</option>
              <option value="7">7+ Days</option>
              <option value="10">10+ Days</option>
              <option value="15">15+ Days</option>
              <option value="30">30+ Days</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => loadReport()}
              disabled={loading}
              className="h-11 flex-1 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load / Refresh"}
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={loading || rows.length === 0}
              className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black disabled:opacity-50"
            >
              Excel
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-red-800">Red = Stock Out</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Green = Received in UAE</span>
          <span className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-sky-800">Blue = Dispatched From India</span>
        </div>

        <p className="mt-3 text-xs font-bold text-slate-400">
          Manual refresh • Background auto-refresh is off to reduce API usage
          {lastUpdated ? ` • Last updated: ${lastUpdated.toLocaleString("en-GB")}` : ""}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <SummaryCard title="Total Lines" value={summary.totalLines} />
        <SummaryCard title="Total Qty" value={summary.totalQty} />
        <SummaryCard title="Stock Out" value={summary.stockOutLines} type="danger" />
        <SummaryCard title="Received UAE" value={summary.receivedUaeLines} type="success" />
        <SummaryCard title="Dispatched From India" value={summary.receivedWh1Lines} type="info" />
        <SummaryCard title="Still Pending" value={summary.pendingLines} />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Pending Orders</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
            {rows.length} line(s)
          </span>
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[1750px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-200">
              <tr>
                <th className="px-3 py-3 text-center">Item Image</th>
                <th className="px-3 py-3 text-left">Order No.</th>
                <th className="px-3 py-3 text-left">Order Date</th>
                <th className="px-3 py-3 text-center">Pending Days</th>
                <th className="px-3 py-3 text-left">Customer Name</th>
                <th className="px-3 py-3 text-left">Customer Mobile Number</th>
                <th className="px-3 py-3 text-left">SKU</th>
                <th className="px-3 py-3 text-center">Quantity</th>
                <th className="px-3 py-3 text-left">Supplier</th>
                <th className="px-3 py-3 text-left">Dispatch Bill No.</th>
                <th className="px-3 py-3 text-center">Dispatched From India</th>
                <th className="px-3 py-3 text-center">Received in UAE</th>
                <th className="px-3 py-3 text-left">Received in UAE Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-t transition ${rowClass(row)}`}>
                  <td className="px-3 py-3 text-center">
                    {row.imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage(row.imageUrl)}
                        className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm hover:border-blue-400"
                        title="Open full image"
                      >
                        <img
                          src={row.imageUrl}
                          alt={row.sku || "Product"}
                          className="h-14 w-14 rounded-lg object-cover"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <div className="inline-flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-black text-slate-400">
                        No Img
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-black">{row.orderNo || "-"}</td>
                  <td className="px-3 py-3 font-bold">{formatDate(row.orderDate)}</td>
                  <td className="px-3 py-3 text-center font-black">{row.pendingDays}</td>
                  <td className="px-3 py-3 font-bold">{row.customerName || "-"}</td>
                  <td className="px-3 py-3 font-bold">{row.customerMobile || "-"}</td>
                  <td className="px-3 py-3 font-bold">{row.sku || "-"}</td>
                  <td className="px-3 py-3 text-center font-black">{row.qty}</td>
                  <td className="px-3 py-3 font-bold">{row.supplier || "-"}</td>
                  <td className="px-3 py-3 font-bold">{row.billNo || "-"}</td>
                  <td className="px-3 py-3 text-center font-black">{row.receivedInWh1 || "-"}</td>
                  <td className="px-3 py-3 text-center font-black">{row.receivedInUae || "-"}</td>
                  <td className="px-3 py-3 font-bold">{formatDate(row.receivedInUaeDate)}</td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center font-bold text-slate-500">
                    No matching {minAgeDays}+ day Order Received records found.
                  </td>
                </tr>
              )}

              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center font-bold text-blue-600">
                    Loading order pending report...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage("")}
        >
          <button
            type="button"
            onClick={() => setPreviewImage("")}
            className="absolute right-5 top-5 rounded-full bg-white px-4 py-2 text-lg font-black text-slate-900"
          >
            ×
          </button>
          <img
            src={previewImage}
            alt="Product preview"
            className="max-h-[90vh] max-w-[95vw] rounded-2xl bg-white object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  type = "normal",
}: {
  title: string;
  value: number;
  type?: "normal" | "success" | "danger" | "info";
}) {
  const className =
    type === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : type === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : type === "info"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-slate-200 bg-white text-slate-950";

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${className}`}>
      <p className="text-xs font-black uppercase opacity-70">{title}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
