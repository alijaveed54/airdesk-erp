"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type DeliveredRow = {
  id: string;
  source: "TS" | "BS";
  month: string;
  orderNo: string;
  orderDate: string;
  customerName: string;
  customerMobile: string;
  city: string;
  courier: string;
  store: string;
  amount: number;
  status: string;
};

type MonthSummary = {
  month: string;
  tsOrders: number;
  bsOrders: number;
  totalOrders: number;
  totalAmount: number;
};

type Summary = {
  totalOrders: number;
  tsOrders: number;
  bsOrders: number;
  totalAmount: number;
  months: MonthSummary[];
};

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  tsOrders: 0,
  bsOrders: 0,
  totalAmount: 0,
  months: [],
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));

  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDate(value: string) {
  if (!value) return "-";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
}

export default function DeliveredOrdersReportPage() {
  const [monthToAdd, setMonthToAdd] = useState(currentMonthKey());
  const [selectedMonths, setSelectedMonths] = useState<string[]>([
    currentMonthKey(),
  ]);
  const [rows, setRows] = useState<DeliveredRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  function addMonth() {
    if (!monthToAdd) return;

    setSelectedMonths((current) =>
      Array.from(new Set([...current, monthToAdd])).sort(),
    );
  }

  function removeMonth(month: string) {
    setSelectedMonths((current) => current.filter((item) => item !== month));
  }

  async function loadReport() {
    if (selectedMonths.length === 0) {
      alert("Please select at least one month.");
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("months", selectedMonths.join(","));

      const response = await fetch(
        `/api/reports/delivered-orders?${params.toString()}`,
        { cache: "no-store" },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Delivered orders report load failed");
      }

      setRows(data.rows || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setWarnings(
        Array.isArray(data.warnings)
          ? data.warnings.map((item: any) =>
              typeof item === "string"
                ? item
                : `${item?.source || "Base"}: ${
                    item?.message || "Report warning"
                  }`,
            )
          : [],
      );
    } catch (error: any) {
      alert(error?.message || "Delivered orders report load failed");
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (sourceFilter && row.source !== sourceFilter) return false;

      if (!query) return true;

      return [
        row.source,
        row.orderNo,
        row.orderDate,
        row.customerName,
        row.customerMobile,
        row.city,
        row.courier,
        row.store,
        row.status,
        row.month,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [rows, search, sourceFilter]);

  function downloadExcel() {
    if (filteredRows.length === 0) {
      alert("No delivered orders available to download.");
      return;
    }

    const workbook = XLSX.utils.book_new();

    const summaryRows = [
      ["Delivered Orders Report"],
      ["Selected Months", selectedMonths.map(monthLabel).join(", ")],
      ["Total Delivered Orders", filteredRows.length],
      ["TS Orders", filteredRows.filter((row) => row.source === "TS").length],
      ["BS Orders", filteredRows.filter((row) => row.source === "BS").length],
      [
        "Total Amount",
        filteredRows.reduce((total, row) => total + Number(row.amount || 0), 0),
      ],
      [],
      ["Month", "TS Orders", "BS Orders", "Total Orders", "Total Amount"],
      ...selectedMonths.map((month) => {
        const monthRows = filteredRows.filter((row) => row.month === month);
        const tsOrders = monthRows.filter((row) => row.source === "TS").length;
        const bsOrders = monthRows.filter((row) => row.source === "BS").length;

        return [
          monthLabel(month),
          tsOrders,
          bsOrders,
          monthRows.length,
          monthRows.reduce(
            (total, row) => total + Number(row.amount || 0),
            0,
          ),
        ];
      }),
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [
      { wch: 24 },
      { wch: 42 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const toExportRow = (row: DeliveredRow) => ({
      Base: row.source,
      Month: monthLabel(row.month),
      "Order No.": row.orderNo,
      "Order Date": row.orderDate,
      "Customer Name": row.customerName,
      "Customer Mobile": row.customerMobile,
      City: row.city,
      Courier: row.courier,
      Store: row.store,
      "Order Amount": row.amount,
      Status: row.status,
    });

    const allSheet = XLSX.utils.json_to_sheet(filteredRows.map(toExportRow));
    allSheet["!cols"] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 18 },
      { wch: 14 },
      { wch: 28 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, allSheet, "All Delivered");

    for (const month of selectedMonths) {
      const monthRows = filteredRows.filter((row) => row.month === month);
      if (monthRows.length === 0) continue;

      const sheet = XLSX.utils.json_to_sheet(monthRows.map(toExportRow));
      sheet["!cols"] = allSheet["!cols"];
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        safeSheetName(monthLabel(month)),
      );
    }

    XLSX.writeFile(
      workbook,
      `delivered-orders-${selectedMonths.join("_")}.xlsx`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Delivered Orders Report
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            TS + BS delivered orders. Global Base Selector does not affect this
            report.
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
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_auto_1fr] lg:items-end">
          <div>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              Select Month
            </label>
            <input
              type="month"
              value={monthToAdd}
              onChange={(event) => setMonthToAdd(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            />
          </div>

          <button
            type="button"
            onClick={addMonth}
            className="h-11 rounded-xl bg-slate-900 px-5 font-black text-white"
          >
            + Add Month
          </button>

          <div className="flex flex-wrap gap-2">
            {selectedMonths.map((month) => (
              <span
                key={month}
                className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-sm font-black text-blue-700"
              >
                {monthLabel(month)}
                <button
                  type="button"
                  onClick={() => removeMonth(month)}
                  className="rounded-full px-1 text-blue-900 hover:bg-blue-100"
                  title="Remove month"
                >
                  ×
                </button>
              </span>
            ))}

            {selectedMonths.length === 0 && (
              <span className="text-sm font-bold text-slate-400">
                No month selected
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadReport}
            disabled={loading || selectedMonths.length === 0}
            className="h-11 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Delivered Orders"}
          </button>

          <button
            type="button"
            onClick={downloadExcel}
            disabled={loading || filteredRows.length === 0}
            className="h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-5 font-black text-emerald-800 disabled:opacity-50"
          >
            Download Excel
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedMonths([currentMonthKey()]);
              setMonthToAdd(currentMonthKey());
            }}
            className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black text-slate-700"
          >
            Current Month
          </button>

          <button
            type="button"
            onClick={() => setSelectedMonths([])}
            className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black text-slate-700"
          >
            Clear Months
          </button>
        </div>

        <p className="mt-4 text-xs font-bold text-slate-500">
          Month is matched against the order/invoice date. Only orders whose
          current order status is Delivered are included.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-black text-amber-900">Report warning</p>
          {warnings.map((warning, index) => (
            <p
              key={`${warning}-${index}`}
              className="mt-1 text-sm font-bold text-amber-800"
            >
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Delivered Orders" value={summary.totalOrders} />
        <SummaryCard title="TS Orders" value={summary.tsOrders} />
        <SummaryCard title="BS Orders" value={summary.bsOrders} />
        <SummaryCard
          title="Total Amount"
          value={formatMoney(summary.totalAmount)}
        />
      </div>

      {summary.months.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Month Summary</h2>

          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
            <table className="min-w-[720px] w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left">Month</th>
                  <th className="px-4 py-3 text-center">TS</th>
                  <th className="px-4 py-3 text-center">BS</th>
                  <th className="px-4 py-3 text-center">Total Orders</th>
                  <th className="px-4 py-3 text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.months.map((item) => (
                  <tr key={item.month} className="border-t">
                    <td className="px-4 py-3 font-black">
                      {monthLabel(item.month)}
                    </td>
                    <td className="px-4 py-3 text-center font-bold">
                      {item.tsOrders}
                    </td>
                    <td className="px-4 py-3 text-center font-bold">
                      {item.bsOrders}
                    </td>
                    <td className="px-4 py-3 text-center font-black">
                      {item.totalOrders}
                    </td>
                    <td className="px-4 py-3 text-right font-black">
                      {formatMoney(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order / customer / mobile / courier / store"
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold"
          />

          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold"
          >
            <option value="">TS + BS</option>
            <option value="TS">TS Only</option>
            <option value="BS">BS Only</option>
          </select>

          <div className="flex h-11 items-center rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700">
            {filteredRows.length} order(s)
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="min-w-[1500px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-200">
              <tr>
                <th className="px-3 py-3 text-left">Base</th>
                <th className="px-3 py-3 text-left">Month</th>
                <th className="px-3 py-3 text-left">Order No.</th>
                <th className="px-3 py-3 text-left">Order Date</th>
                <th className="px-3 py-3 text-left">Customer Name</th>
                <th className="px-3 py-3 text-left">Customer Mobile</th>
                <th className="px-3 py-3 text-left">City</th>
                <th className="px-3 py-3 text-left">Courier</th>
                <th className="px-3 py-3 text-left">Store</th>
                <th className="px-3 py-3 text-right">Order Amount</th>
                <th className="px-3 py-3 text-center">Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t bg-white hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <span
                      className={[
                        "rounded-full px-3 py-1 text-xs font-black",
                        row.source === "TS"
                          ? "bg-violet-100 text-violet-800"
                          : "bg-blue-100 text-blue-800",
                      ].join(" ")}
                    >
                      {row.source}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-bold">
                    {monthLabel(row.month)}
                  </td>
                  <td className="px-3 py-3 font-black">
                    {row.orderNo || "-"}
                  </td>
                  <td className="px-3 py-3 font-bold">
                    {formatDate(row.orderDate)}
                  </td>
                  <td className="px-3 py-3 font-bold">
                    {row.customerName || "-"}
                  </td>
                  <td className="px-3 py-3 font-bold">
                    {row.customerMobile || "-"}
                  </td>
                  <td className="px-3 py-3 font-bold">{row.city || "-"}</td>
                  <td className="px-3 py-3 font-bold">
                    {row.courier || "-"}
                  </td>
                  <td className="px-3 py-3 font-bold">{row.store || "-"}</td>
                  <td className="px-3 py-3 text-right font-black">
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                      Delivered
                    </span>
                  </td>
                </tr>
              ))}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    Select month(s) and load the report.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >
                    Loading delivered orders from TS + BS...
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
}: {
  title: string;
  value: number | string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}
