"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type DelayedRow = {
  id: string;
  source: string;
  supplier: string;
  orderNo: string;
  sku: string;
  qty: number;
  image: string;
  createdDate: string;
  hoursSinceCreated: number;
};

type Summary = {
  totalOrders: number;
  totalLines: number;
  totalPcs: number;
  totalBills: number;
  totalSuppliers: number;
};

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  totalLines: 0,
  totalPcs: 0,
  totalBills: 0,
  totalSuppliers: 0,
};

function formatDate(value: string) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatHours(hours: number): string {
  if (hours === Infinity) return "Unknown";

  const days = Math.floor(hours / 24);
  const remainingHours = Math.floor(hours % 24);

  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }

  return `${remainingHours}h`;
}

export default function SupplierDelayedOrdersPage() {
  const [supplier, setSupplier] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [rows, setRows] = useState<DelayedRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  async function loadReport(nextSupplier = supplier) {
    setLoading(true);

    try {
      const params = new URLSearchParams();

      if (nextSupplier) {
        params.set("supplier", nextSupplier);
      }

      const response = await fetch(
        `/api/reports/supplier-delayed?${params.toString()}`,
        { cache: "no-store" },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Report load failed");
      }

      setSuppliers(data.suppliers || []);
      setRows(data.rows || []);
      setSummary(data.summary || EMPTY_SUMMARY);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Report load failed");
      setRows([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport("");
  }, []);

  async function handleSupplierChange(value: string) {
    setSupplier(value);
    await loadReport(value);
  }

  function exportExcel() {
    if (rows.length === 0) {
      alert("No delayed orders to export");
      return;
    }

    const exportRows = rows.map((row) => ({
      Supplier: row.supplier,
      "Order No": row.orderNo,
      SKU: row.sku,
      Qty: row.qty,
      "Created Date": formatDate(row.createdDate),
      "Hours Delayed": Math.floor(row.hoursSinceCreated),
      "Delayed Time": formatHours(row.hoursSinceCreated),
      Source: row.source,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);

    worksheet["!cols"] = [
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 8 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Delayed Orders",
    );

    XLSX.writeFile(
      workbook,
      `Supplier_Delayed_Orders_${supplier || "all"}.xlsx`,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          Supplier Delayed Orders
        </h1>

        <p className="mt-1 text-sm font-bold text-slate-500">
          Shows supplier orders that are 48+ hours old and not yet dispatched or stocked out.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              Supplier
            </label>

            <select
              value={supplier}
              onChange={(event) =>
                handleSupplierChange(event.target.value)
              }
              disabled={loading}
              className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">All Suppliers</option>

              {suppliers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => loadReport()}
              disabled={loading}
              className="h-12 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              type="button"
              onClick={exportExcel}
              disabled={rows.length === 0 || loading}
              className="h-12 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-40"
            >
              Excel
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              disabled={rows.length === 0 || loading}
              className="h-12 rounded-xl bg-slate-900 px-5 font-black text-white disabled:opacity-40"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Total Orders" value={summary.totalOrders} />
        <SummaryCard label="Total Lines" value={summary.totalLines} />
        <SummaryCard label="Pending PCS" value={summary.totalPcs} />
        <SummaryCard label="Bills Affected" value={summary.totalBills} />
        <SummaryCard label="Suppliers Affected" value={summary.totalSuppliers} />
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-black text-slate-900">
            Delayed Orders (48+ Hours)
          </h2>

          <p className="text-xs font-bold text-slate-500">
            {rows.length > 0
              ? `${rows.length} delayed order line(s) found`
              : "No delayed orders found"}
          </p>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-200 text-slate-900">
              <tr>
                <th className="px-4 py-3 text-left">Image</th>
                <th className="px-4 py-3 text-left">Order No</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-left">Created Date</th>
                <th className="px-4 py-3 text-left">Delayed Time</th>
                <th className="px-4 py-3 text-left">Source</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-t ${
                    index % 2 === 0
                      ? "bg-white"
                      : "bg-slate-50"
                  } hover:bg-blue-50`}
                >
                  <td className="px-4 py-3">
                    {row.image ? (
                      <button
                        type="button"
                        onClick={() => setSelectedImage(row.image)}
                        className="group relative block h-16 w-16 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                        title="Click to enlarge"
                      >
                        <img
                          src={row.image}
                          alt={row.sku || "Product"}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-110"
                        />
                      </button>
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-[10px] font-black text-slate-400">
                        No Image
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 font-black text-slate-900">
                    {row.orderNo || "-"}
                  </td>

                  <td className="px-4 py-3 font-bold text-slate-700">
                    {row.sku || "-"}
                  </td>

                  <td className="px-4 py-3 text-center font-black">
                    {row.qty}
                  </td>

                  <td className="px-4 py-3 font-bold text-slate-700">
                    {row.supplier}
                  </td>

                  <td className="px-4 py-3 font-bold text-slate-600">
                    {formatDate(row.createdDate)}
                  </td>

                  <td className="px-4 py-3">
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">
                      {formatHours(row.hoursSinceCreated)}
                    </span>
                  </td>

                  <td className="px-4 py-3 font-bold text-slate-700">
                    {row.source}
                  </td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    No delayed orders found (48+ hours old, not dispatched/stocked out).
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >
                    Loading delayed orders...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-h-[95vh] max-w-[95vw]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute -right-3 -top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl font-black text-slate-900 shadow-lg hover:bg-slate-100"
              aria-label="Close image"
            >
              ×
            </button>

            <img
              src={selectedImage}
              alt="Product large preview"
              className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-1 break-words text-xl font-black text-slate-900">
        {value}
      </p>
    </div>
  );
}