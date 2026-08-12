"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type BillOption = {
  billNo: string;
  pcs: number;
  lines: number;
};

type PendingRow = {
  id: string;
  source: string;
  supplier: string;
  billNo: string;
  orderNo: string;
  sku: string;
  qty: number;
  receivedInUae: string;
  orderStatus: string;
  orderDate: string;
  createdDate: string;
};

type Summary = {
  totalOrders: number;
  totalLines: number;
  totalPcs: number;
};

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  totalLines: 0,
  totalPcs: 0,
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

export default function SupplierPendingReceiveReportPage() {
  const [supplier, setSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [receiving, setReceiving] = useState(false);

  async function loadReport(nextSupplier = supplier, nextBillNo = billNo) {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (nextSupplier) params.set("supplier", nextSupplier);
      if (nextBillNo) params.set("billNo", nextBillNo);

      const response = await fetch(
        `/api/reports/supplier-bill-dispatch?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Report load failed");
      }

      setSuppliers(data.suppliers || []);
      setBills(data.bills || []);
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
    loadReport("", "");
  }, []);

  async function handleSupplierChange(value: string) {
    setSupplier(value);
    setBillNo("");
    setRows([]);
    setSummary(EMPTY_SUMMARY);
    await loadReport(value, "");
  }

  async function handleBillChange(value: string) {
    setBillNo(value);
    await loadReport(supplier, value);
  }

  async function markBillReceived() {
    if (!supplier || !billNo || rows.length === 0) return;

    const confirmed = window.confirm(
      `Mark all ${summary.totalLines} visible pending item line(s) of bill ${billNo} as Received In UAE = Yes?`,
    );
    if (!confirmed) return;

    setReceiving(true);
    try {
      const response = await fetch("/api/reports/supplier-bill-dispatch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier, billNo }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to mark bill as received");
      }

      alert(`${data.updatedRecords || 0} pending item line(s) marked Received In UAE = Yes.`);
      await loadReport(supplier, "");
      setBillNo("");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to mark bill as received");
    } finally {
      setReceiving(false);
    }
  }

  const selectedBill = useMemo(
    () => bills.find((bill) => bill.billNo === billNo),
    [bills, billNo],
  );

  function exportExcel() {
    if (rows.length === 0) {
      alert("Please select a bill number first.");
      return;
    }

    const exportRows = rows.map((row) => ({
      Supplier: row.supplier,
      "Bill No": row.billNo,
      "Order No": row.orderNo,
      SKU: row.sku,
      Qty: row.qty,
      "Order Status": row.orderStatus || "Blank",
      "Received In UAE": row.receivedInUae || "No",
      "Order Date": formatDate(row.orderDate),
      Source: row.source,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 8 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pending Receive");
    XLSX.writeFile(
      workbook,
      `Supplier_Pending_Receive_${billNo.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          Supplier Pending Receive Report
        </h1>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Shows only Order Received, Processing or Blank status items that are not yet received.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              Supplier
            </label>
            <select
              value={supplier}
              onChange={(event) => handleSupplierChange(event.target.value)}
              disabled={loading || receiving}
              className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">Select Supplier</option>
              {suppliers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              Bill Number
            </label>
            <select
              value={billNo}
              onChange={(event) => handleBillChange(event.target.value)}
              disabled={!supplier || loading || receiving}
              className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:opacity-60"
            >
              <option value="">
                {supplier ? "Select Bill Number" : "Select Supplier First"}
              </option>
              {bills.map((bill) => (
                <option key={bill.billNo} value={bill.billNo}>
                  {bill.billNo} ({bill.pcs} PCS)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => loadReport()}
              disabled={loading || receiving}
              className="h-12 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={markBillReceived}
              disabled={!billNo || rows.length === 0 || receiving}
              className="h-12 rounded-xl bg-violet-600 px-5 font-black text-white disabled:opacity-40"
            >
              {receiving ? "Updating..." : "Received"}
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={rows.length === 0 || receiving}
              className="h-12 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-40"
            >
              Excel
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={rows.length === 0 || receiving}
              className="h-12 rounded-xl bg-slate-900 px-5 font-black text-white disabled:opacity-40"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {billNo && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Supplier" value={supplier || "-"} />
          <SummaryCard
            label="Bill Number"
            value={`${billNo}${selectedBill ? ` (${selectedBill.pcs} PCS)` : ""}`}
          />
          <SummaryCard label="Total Orders" value={summary.totalOrders} />
          <SummaryCard label="Total Lines" value={summary.totalLines} />
          <SummaryCard label="Pending PCS" value={summary.totalPcs} />
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-black text-slate-900">Pending Receive Items</h2>
          <p className="text-xs font-bold text-slate-500">
            {billNo
              ? `${summary.totalLines} pending item line(s) found`
              : "Select supplier and bill number to load pending items"}
          </p>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-slate-200 text-slate-900">
              <tr>
                <th className="px-4 py-3 text-left">Order No</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-left">Order Status</th>
                <th className="px-4 py-3 text-left">Received In UAE</th>
                <th className="px-4 py-3 text-left">Order Date</th>
                <th className="px-4 py-3 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-t ${
                    index % 2 === 0 ? "bg-white" : "bg-slate-50"
                  } hover:bg-blue-50`}
                >
                  <td className="px-4 py-3 font-black text-slate-900">
                    {row.orderNo || "-"}
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-700">
                    {row.sku || "-"}
                  </td>
                  <td className="px-4 py-3 text-center font-black">{row.qty}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                      {row.orderStatus || "Blank"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">
                      {row.receivedInUae || "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-600">
                    {formatDate(row.orderDate)}
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-700">{row.source}</td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    {billNo
                      ? "No pending receive items found for this bill."
                      : "Select a supplier and bill number."}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >
                    Loading pending receive details...
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
      <p className="mt-1 break-words text-xl font-black text-slate-900">{value}</p>
    </div>
  );
}
