"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type ActivityRow = {
  id: string;
  source: string;
  orderNo: string;
  sku: string;
  qty: number;
  supplier: string;
  billNo: string;
  status: "Dispatched" | "Sold Out" | string;
  activityDateTime: string;
  orderDate: string;
  imageUrl: string;
  customerName: string;
  customerMobile: string;
};

type Summary = {
  totalLines: number;
  totalQty: number;
  dispatchedLines: number;
  dispatchedQty: number;
  soldOutLines: number;
  soldOutQty: number;
};

const EMPTY_SUMMARY: Summary = {
  totalLines: 0,
  totalQty: 0,
  dispatchedLines: 0,
  dispatchedQty: 0,
  soldOutLines: 0,
  soldOutQty: 0,
};

function formatDateTime(value: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export default function SupplierActivityReportPage() {
  const [supplier, setSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [status, setStatus] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [activityDate, setActivityDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [previewImage, setPreviewImage] = useState("");
  const [undoingId, setUndoingId] = useState("");
  const [supplierLocked, setSupplierLocked] = useState(false);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);

  async function loadReport(silent = false) {
    if (!silent) setLoading(true);

    try {
      const params = new URLSearchParams();

      if (supplier) params.set("supplier", supplier);
      if (billNo) params.set("billNo", billNo);
      if (status) params.set("status", status);
      if (activityDate) params.set("activityDate", activityDate);
      if (todayOnly) params.set("todayOnly", "1");

      const response = await fetch(
        `/api/reports/supplier-activity?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Supplier activity report load failed");
      }

      setRows(data.rows || []);
      setSuppliers(data.suppliers || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setSupplierLocked(Boolean(data.supplierLocked));
      setShowCustomerDetails(Boolean(data.showCustomerDetails));
      if (data.supplierLocked && data.supplier) {
        setSupplier(String(data.supplier));
      }
      setLastUpdated(new Date());
    } catch (error: any) {
      if (!silent) {
        alert(error?.message || "Supplier activity report load failed");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadReport(true);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [supplier, billNo, status, todayOnly, activityDate]);

  const groupedRows = useMemo(() => {
    return {
      soldOut: rows.filter((row) => row.status === "Sold Out"),
      dispatched: rows.filter((row) => row.status === "Dispatched"),
    };
  }, [rows]);

  async function undoActivity(row: ActivityRow) {
    const confirmed = window.confirm(
      `Undo ${row.status} for ${row.sku || row.orderNo}?\n\nThis will clear:\n• Supplier Activity\n• Activity DateTime\n• Bill No\n• Received in WH 1`,
    );

    if (!confirmed) return;

    setUndoingId(row.id);

    try {
      const response = await fetch("/api/reports/supplier-activity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Undo supplier activity failed");
      }

      await loadReport(true);
    } catch (error: any) {
      alert(error?.message || "Undo supplier activity failed");
    } finally {
      setUndoingId("");
    }
  }

  function exportExcel() {
    const exportRows = rows.map((row) => ({
      "Activity Date & Time": formatDateTime(row.activityDateTime),
      Supplier: row.supplier,
      Status: row.status,
      "Order No": row.orderNo,
      SKU: row.sku,
      Qty: row.qty,
      "Bill No": row.billNo,
      ...(showCustomerDetails
        ? {
            "Customer Name": row.status === "Sold Out" ? row.customerName : "",
            "Mobile Number": row.status === "Sold Out" ? row.customerMobile : "",
          }
        : {}),
      Source: row.source,
      "Order Date": row.orderDate,
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(exportRows);

    sheet["!cols"] = showCustomerDetails
      ? [
          { wch: 24 },
          { wch: 18 },
          { wch: 14 },
          { wch: 18 },
          { wch: 24 },
          { wch: 8 },
          { wch: 18 },
          { wch: 28 },
          { wch: 20 },
          { wch: 16 },
          { wch: 14 },
        ]
      : [
          { wch: 24 },
          { wch: 18 },
          { wch: 14 },
          { wch: 18 },
          { wch: 24 },
          { wch: 8 },
          { wch: 18 },
          { wch: 16 },
          { wch: 14 },
        ];

    XLSX.utils.book_append_sheet(workbook, sheet, "Supplier Activity");
    XLSX.writeFile(workbook, "supplier-activity-report.xlsx");
  }

  const showSoldOut = !status || status === "Sold Out";
  const showDispatched = !status || status === "Dispatched";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Supplier Activity Report
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Latest supplier action always appears first, regardless of order
            date.
          </p>
        </div>

        <Link
          href="/reports"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
        >
          Back to Reports
        </Link>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="text-xs font-black text-slate-500">
              Supplier
            </label>
            <select
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              disabled={supplierLocked}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">
              Bill Number
            </label>
            <input
              type="text"
              value={billNo}
              onChange={(event) => setBillNo(event.target.value)}
              placeholder="Enter Bill Number"
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            />
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">
              Activity Status
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              <option value="">All Activities</option>
              <option value="Sold Out">Sold Out</option>
              <option value="Dispatched">Dispatched</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-500">
              Activity Date
            </label>
            <input
              type="date"
              value={activityDate}
              onChange={(event) => {
                setActivityDate(event.target.value);
                if (event.target.value) setTodayOnly(false);
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            />
          </div>

          <label className="flex h-11 items-center gap-3 self-end rounded-xl border border-slate-300 bg-slate-50 px-4 font-black text-slate-700">
            <input
              type="checkbox"
              checked={todayOnly}
              onChange={(event) => {
                setTodayOnly(event.target.checked);
                if (event.target.checked) setActivityDate("");
              }}
              className="h-4 w-4"
            />
            Today Only
          </label>

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

        <p className="mt-3 text-xs font-bold text-slate-400">
          Auto refresh: every 30 seconds
          {lastUpdated
            ? ` • Last updated: ${formatDateTime(lastUpdated.toISOString())}`
            : ""}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <SummaryCard title="Total Lines" value={summary.totalLines} />
        <SummaryCard title="Total Qty" value={summary.totalQty} />
        <SummaryCard
          title="Dispatched Lines"
          value={summary.dispatchedLines}
          type="success"
        />
        <SummaryCard
          title="Dispatched Qty"
          value={summary.dispatchedQty}
          type="success"
        />
        <SummaryCard
          title="Sold Out Lines"
          value={summary.soldOutLines}
          type="danger"
        />
        <SummaryCard
          title="Sold Out Qty"
          value={summary.soldOutQty}
          type="danger"
        />
      </div>

      {showSoldOut && (
        <ActivityTable
          title="Sold Out"
          rows={groupedRows.soldOut}
          loading={loading}
          type="danger"
          onPreviewImage={setPreviewImage}
          onUndo={undoActivity}
          undoingId={undoingId}
          showCustomerDetails={showCustomerDetails}
        />
      )}

      {showDispatched && (
        <ActivityTable
          title="Dispatched"
          rows={groupedRows.dispatched}
          loading={loading}
          type="success"
          onPreviewImage={setPreviewImage}
          onUndo={undoActivity}
          undoingId={undoingId}
          showCustomerDetails={false}
        />
      )}

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

function ActivityTable({
  title,
  rows,
  loading,
  type,
  onPreviewImage,
  onUndo,
  undoingId,
  showCustomerDetails,
}: {
  title: string;
  rows: ActivityRow[];
  loading: boolean;
  type: "danger" | "success";
  onPreviewImage: (url: string) => void;
  onUndo: (row: ActivityRow) => void;
  undoingId: string;
  showCustomerDetails: boolean;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          className={`text-xl font-black ${
            type === "danger" ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {title}
        </h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
          {rows.length} line(s)
        </span>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table
          className={`w-full text-sm ${
            type === "danger" && showCustomerDetails
              ? "min-w-[1350px]"
              : "min-w-[1000px]"
          }`}
        >
          <thead className="bg-slate-200">
            <tr>
              <th className="px-4 py-3 text-center">Image</th>
              <th className="px-4 py-3 text-left">Activity Date & Time</th>
              <th className="px-4 py-3 text-left">Supplier</th>
              <th className="px-4 py-3 text-left">Order No</th>
              <th className="px-4 py-3 text-left">SKU</th>
              <th className="px-4 py-3 text-center">Qty</th>
              <th className="px-4 py-3 text-left">Bill No</th>
              {type === "danger" && showCustomerDetails && (
                <>
                  <th className="px-4 py-3 text-left">Customer Name</th>
                  <th className="px-4 py-3 text-left">Mobile Number</th>
                </>
              )}
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t ${
                  type === "danger"
                    ? "bg-red-50/60 hover:bg-red-100"
                    : "bg-emerald-50/40 hover:bg-emerald-100"
                }`}
              >
                <td className="px-4 py-3 text-center">
                  {row.imageUrl ? (
                    <button
                      type="button"
                      onClick={() => onPreviewImage(row.imageUrl)}
                      className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm hover:border-blue-400"
                      title="Open full image"
                    >
                      <img
                        src={row.imageUrl}
                        alt={row.sku || "Product"}
                        className="h-16 w-16 rounded-lg object-cover"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <div className="inline-flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-black text-slate-400">
                      No Img
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-black">
                  {formatDateTime(row.activityDateTime)}
                </td>
                <td className="px-4 py-3 font-black">{row.supplier}</td>
                <td className="px-4 py-3 font-bold">{row.orderNo}</td>
                <td className="px-4 py-3 font-bold">{row.sku}</td>
                <td className="px-4 py-3 text-center font-black">{row.qty}</td>
                <td className="px-4 py-3 font-bold">{row.billNo || "-"}</td>
                {type === "danger" && showCustomerDetails && (
                  <>
                    <td className="px-4 py-3 font-bold">
                      {row.customerName || "-"}
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {row.customerMobile || "-"}
                    </td>
                  </>
                )}
                <td className="px-4 py-3 font-bold">{row.source}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => onUndo(row)}
                    disabled={undoingId === row.id}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {undoingId === row.id ? "Undoing..." : "Undo"}
                  </button>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={type === "danger" && showCustomerDetails ? 11 : 9}
                  className="px-4 py-10 text-center font-bold text-slate-500"
                >
                  No {title.toLowerCase()} activity found.
                </td>
              </tr>
            )}

            {loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={type === "danger" && showCustomerDetails ? 11 : 9}
                  className="px-4 py-10 text-center font-bold text-blue-600"
                >
                  Loading supplier activity...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  type?: "normal" | "success" | "danger";
}) {
  const className =
    type === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : type === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-white text-slate-950";

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${className}`}>
      <p className="text-xs font-black uppercase opacity-70">{title}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
