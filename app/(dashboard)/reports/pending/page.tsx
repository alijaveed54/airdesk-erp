"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type PendingRow = {
  id: string;
  orderNo: string;
  date: string;
  customer: string;
  phone: string;
  store: string;
  status: string;
  itemCode: string;
  supplier: string;
  qty: number;
  value: number;
  receivedWh: string;
  billNo: string;
  reason: string;
  days: number;
};

type SupplierSummary = {
  supplier: string;
  qty: number;
  orders: number;
  soldOutQty: number;
  olderThan7Qty: number;
};

type ReasonSummary = {
  reason: string;
  qty: number;
  orders: number;
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PendingReportPage() {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState({
    totalOrders: 0,
    totalLines: 0,
    totalQty: 0,
    totalValue: 0,
    supplierPendingQty: 0,
    soldOutQty: 0,
    olderThan7Qty: 0,
  });

  const [supplierSummary, setSupplierSummary] = useState<SupplierSummary[]>([]);
  const [reasonSummary, setReasonSummary] = useState<ReasonSummary[]>([]);
  const [rows, setRows] = useState<PendingRow[]>([]);

  async function loadReport() {
    setLoading(true);

    const params = new URLSearchParams();

    if (reason.trim()) params.set("reason", reason.trim());

    const res = await fetch(`/api/reports/pending?${params.toString()}`);
    const data = await res.json();

    if (res.ok && data.success) {
      setSummary(data.summary);
      setSupplierSummary(data.supplierSummary || []);
      setReasonSummary(data.reasonSummary || []);
      setRows(data.rows || []);
    } else {
      setSummary({
        totalOrders: 0,
        totalLines: 0,
        totalQty: 0,
        totalValue: 0,
        supplierPendingQty: 0,
        soldOutQty: 0,
        olderThan7Qty: 0,
      });
      setSupplierSummary([]);
      setReasonSummary([]);
      setRows([]);
      alert(data.message || "Pending report load failed");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadReport();
  }, []);

  function exportExcel() {
    const workbook = XLSX.utils.book_new();

    const summaryRows = [
      {
        Metric: "Total Pending Orders",
        Value: summary.totalOrders,
      },
      {
        Metric: "Total Pending Lines",
        Value: summary.totalLines,
      },
      {
        Metric: "Total Pending Qty",
        Value: summary.totalQty,
      },
      {
        Metric: "Total Pending Value",
        Value: Number(summary.totalValue.toFixed(2)),
      },
      {
        Metric: "Pending From Supplier Qty",
        Value: summary.supplierPendingQty,
      },
      {
        Metric: "Sold Out Qty",
        Value: summary.soldOutQty,
      },
      {
        Metric: "Older Than 7 Days Qty",
        Value: summary.olderThan7Qty,
      },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const supplierRows = supplierSummary.map((row) => ({
      Supplier: row.supplier,
      Orders: row.orders,
      Qty: row.qty,
      "Sold Out Qty": row.soldOutQty,
      "7+ Days Qty": row.olderThan7Qty,
    }));

    const supplierSheet = XLSX.utils.json_to_sheet(supplierRows);
    supplierSheet["!cols"] = [
      { wch: 18 },
      { wch: 10 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, supplierSheet, "Supplier Summary");

    const detailRows = rows.map((row) => ({
      "Order No": row.orderNo,
      Date: row.date,
      Store: row.store,
      Customer: row.customer,
      Phone: row.phone,
      Supplier: row.supplier,
      SKU: row.itemCode,
      Qty: row.qty,
      Value: Number(Number(row.value || 0).toFixed(2)),
      Status: row.status,
      Reason: row.reason,
      Days: row.days,
      "Bill No": row.billNo,
      "Received WH": row.receivedWh,
    }));

    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet["!cols"] = [
      { wch: 18 },
      { wch: 14 },
      { wch: 20 },
      { wch: 24 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: 8 },
      { wch: 12 },
      { wch: 18 },
      { wch: 24 },
      { wch: 8 },
      { wch: 18 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Details");

    XLSX.writeFile(workbook, `smart-pending-report-overall.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Smart Pending Report
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Overall Order Received / Processing pending data. Reason filter only.
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
        <h2 className="mb-4 text-xl font-black text-slate-950">Filters</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-slate-500">Reason</label>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-bold"
            >
              <option value="">All Reasons</option>
              <option value="Supplier Sold Out">Supplier Sold Out</option>
              {reasonSummary
                .filter((item) => item.reason.startsWith("Pending from"))
                .map((item) => (
                  <option key={item.reason} value={item.reason}>
                    {item.reason}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={loadReport}
              disabled={loading}
              className="h-11 flex-1 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load"}
            </button>

            <button
              type="button"
              onClick={() => {
                setReason("");
                loadReport();
              }}
              disabled={loading}
              className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black text-slate-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        <SummaryCard title="Pending Orders" value={summary.totalOrders} />
        <SummaryCard title="Pending Lines" value={summary.totalLines} />
        <SummaryCard title="Pending Qty" value={summary.totalQty} />
        <SummaryCard
          title="Pending Value"
          value={`AED ${summary.totalValue.toFixed(2)}`}
        />
        <SummaryCard
          title="From Supplier"
          value={summary.supplierPendingQty}
        />
        <SummaryCard title="Sold Out" value={summary.soldOutQty} danger />
        <SummaryCard title="7+ Days" value={summary.olderThan7Qty} danger />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">
            Supplier Summary
          </h2>

          <button
            type="button"
            onClick={exportExcel}
            disabled={rows.length === 0 || loading}
            className="h-11 rounded-xl border border-slate-300 bg-white px-5 font-black disabled:opacity-50"
          >
            Export Excel
          </button>
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-center">Orders</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-center">Sold Out Qty</th>
                <th className="px-4 py-3 text-center">7+ Days Qty</th>
              </tr>
            </thead>

            <tbody>
              {supplierSummary.map((row) => (
                <tr
                  key={row.supplier}
                  className={`border-t ${
                    row.olderThan7Qty > 0 ? "bg-red-50 text-red-900" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-black">{row.supplier}</td>
                  <td className="px-4 py-3 text-center font-bold">
                    {row.orders}
                  </td>
                  <td className="px-4 py-3 text-center font-black">
                    {row.qty}
                  </td>
                  <td className="px-4 py-3 text-center font-bold">
                    {row.soldOutQty}
                  </td>
                  <td className="px-4 py-3 text-center font-black">
                    {row.olderThan7Qty}
                  </td>
                </tr>
              ))}

              {!loading && supplierSummary.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    No pending records found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center font-bold text-blue-600"
                  >
                    Loading smart pending report...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black text-slate-950">
          Pending Details
        </h2>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="bg-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Order No</th>
                <th className="px-4 py-3 text-left">Date</th>
                                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Bill No</th>
                <th className="px-4 py-3 text-center">Days</th>
                                              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t hover:bg-slate-50 ${
                    row.days > 7 || row.reason === "Supplier Sold Out"
                      ? "bg-red-50 text-red-900"
                      : ""
                  }`}
                >
                  <td className="px-4 py-3 font-black">{row.orderNo}</td>
                  <td className="px-4 py-3 font-bold">{row.date}</td>
                                    <td className="px-4 py-3 font-bold">{row.customer}</td>
                  <td className="px-4 py-3 font-bold">{row.supplier}</td>
                  <td className="px-4 py-3 font-bold">{row.itemCode}</td>
                  <td className="px-4 py-3 text-center font-black">
                    {row.qty}
                  </td>
                  <td className="px-4 py-3 font-black">{row.reason}</td>
                  <td className="px-4 py-3 font-bold">{row.billNo}</td>
                  <td className="px-4 py-3 text-center font-black">
                    {row.days}
                  </td>
                                  </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    No pending records found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center font-bold text-blue-600"
                  >
                    Loading details...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  danger,
}: {
  title: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 shadow-sm ${
        danger
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-slate-200 bg-white text-slate-950"
      }`}
    >
      <p className="text-xs font-black uppercase opacity-70">{title}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
