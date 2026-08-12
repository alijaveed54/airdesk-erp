"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type StoreRow = {
  store: string;
  orders: number;
  value: number;
  pending: number;
  pendingValue: number;
  delivered: number;
  deliveredValue: number;
  dispatched: number;
  dispatchedValue: number;
  returned: number;
  returnedValue: number;
  cancelled: number;
  cancelledValue: number;
};

type ReportSummary = {
  totalOrders: number;
  totalValue: number;
  pending: number;
  pendingValue: number;
  delivered: number;
  deliveredValue: number;
  dispatched: number;
  dispatchedValue: number;
  returned: number;
  returnedValue: number;
  cancelled: number;
  cancelledValue: number;
};

type BaseReport = {
  baseName: string;
  baseId: string;
  stores: StoreRow[];
  summary: ReportSummary;
};

const EMPTY_SUMMARY: ReportSummary = {
  totalOrders: 0,
  totalValue: 0,
  pending: 0,
  pendingValue: 0,
  delivered: 0,
  deliveredValue: 0,
  dispatched: 0,
  dispatchedValue: 0,
  returned: 0,
  returnedValue: 0,
  cancelled: 0,
  cancelledValue: 0,
};

function currentMonth() {
  const now = new Date();

  return `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;
}

function formatAmount(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeSheetName(value: string) {
  return (
    value
      .replace(/[\\/?*[\]:]/g, "")
      .trim()
      .slice(0, 31) || "Base Report"
  );
}

function exportSingleReport(report: BaseReport, month: string) {
  const rows = [
    ...report.stores.map((row) => ({
      Store: row.store,
      Orders: row.orders,
      Value: Number(row.value.toFixed(2)),
      Pending: row.pending,
      "Pending Value": Number(row.pendingValue.toFixed(2)),
      Delivered: row.delivered,
      "Delivered Value": Number(row.deliveredValue.toFixed(2)),
      Dispatched: row.dispatched,
      "Dispatched Value": Number(row.dispatchedValue.toFixed(2)),
      Returned: row.returned,
      "Returned Value": Number(row.returnedValue.toFixed(2)),
      Cancelled: row.cancelled,
      "Cancelled Value": Number(row.cancelledValue.toFixed(2)),
    })),
    {
      Store: "TOTAL",
      Orders: report.summary.totalOrders,
      Value: Number(report.summary.totalValue.toFixed(2)),
      Pending: report.summary.pending,
      "Pending Value": Number(report.summary.pendingValue.toFixed(2)),
      Delivered: report.summary.delivered,
      "Delivered Value": Number(report.summary.deliveredValue.toFixed(2)),
      Dispatched: report.summary.dispatched,
      "Dispatched Value": Number(report.summary.dispatchedValue.toFixed(2)),
      Returned: report.summary.returned,
      "Returned Value": Number(report.summary.returnedValue.toFixed(2)),
      Cancelled: report.summary.cancelled,
      "Cancelled Value": Number(report.summary.cancelledValue.toFixed(2)),
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet["!cols"] = [
    { wch: 26 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 15 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 16 },
    { wch: 10 },
    { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    safeSheetName(report.baseName)
  );

  const fileBaseName =
    report.baseName
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "base-report";

  XLSX.writeFile(
    workbook,
    `${fileBaseName}-store-summary-${month}.xlsx`
  );
}

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [store, setStore] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<BaseReport[]>([]);
  const [summary, setSummary] =
    useState<ReportSummary>(EMPTY_SUMMARY);
  const [warnings, setWarnings] = useState<
    Array<{ baseName: string; message: string }>
  >([]);

  async function loadReport() {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("month", month);

      if (store.trim()) {
        params.set("store", store.trim());
      }

      if (status.trim()) {
        params.set("status", status.trim());
      }

      const response = await fetch(
        `/api/reports/store-wise?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Store summary report load failed"
        );
      }

      setReports(data.reports || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setWarnings(data.warnings || []);
    } catch (error) {
      setReports([]);
      setSummary(EMPTY_SUMMARY);
      setWarnings([]);

      alert(
        error instanceof Error
          ? error.message
          : "Store summary report load failed"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportExcel() {
    if (reports.length === 0) return;

    const workbook = XLSX.utils.book_new();

    for (const report of reports) {
      const rows = [
        ...report.stores.map((row) => ({
          Store: row.store,
          Orders: row.orders,
          Value: Number(row.value.toFixed(2)),
          Pending: row.pending,
          "Pending Value": Number(
            row.pendingValue.toFixed(2)
          ),
          Delivered: row.delivered,
          "Delivered Value": Number(
            row.deliveredValue.toFixed(2)
          ),
          Dispatched: row.dispatched,
          "Dispatched Value": Number(
            row.dispatchedValue.toFixed(2)
          ),
          Returned: row.returned,
          "Returned Value": Number(
            row.returnedValue.toFixed(2)
          ),
          Cancelled: row.cancelled,
          "Cancelled Value": Number(
            row.cancelledValue.toFixed(2)
          ),
        })),
        {
          Store: "TOTAL",
          Orders: report.summary.totalOrders,
          Value: Number(
            report.summary.totalValue.toFixed(2)
          ),
          Pending: report.summary.pending,
          "Pending Value": Number(
            report.summary.pendingValue.toFixed(2)
          ),
          Delivered: report.summary.delivered,
          "Delivered Value": Number(
            report.summary.deliveredValue.toFixed(2)
          ),
          Dispatched: report.summary.dispatched,
          "Dispatched Value": Number(
            report.summary.dispatchedValue.toFixed(2)
          ),
          Returned: report.summary.returned,
          "Returned Value": Number(
            report.summary.returnedValue.toFixed(2)
          ),
          Cancelled: report.summary.cancelled,
          "Cancelled Value": Number(
            report.summary.cancelledValue.toFixed(2)
          ),
        },
      ];

      const worksheet = XLSX.utils.json_to_sheet(rows);

      worksheet["!cols"] = [
        { wch: 26 },
        { wch: 10 },
        { wch: 14 },
        { wch: 10 },
        { wch: 15 },
        { wch: 12 },
        { wch: 16 },
        { wch: 12 },
        { wch: 18 },
        { wch: 10 },
        { wch: 16 },
        { wch: 10 },
        { wch: 16 },
      ];

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        safeSheetName(report.baseName)
      );
    }

    const grandTotalSheet = XLSX.utils.json_to_sheet([
      {
        Store: "GRAND TOTAL",
        Orders: summary.totalOrders,
        Value: Number(summary.totalValue.toFixed(2)),
        Pending: summary.pending,
        "Pending Value": Number(
          summary.pendingValue.toFixed(2)
        ),
        Delivered: summary.delivered,
        "Delivered Value": Number(
          summary.deliveredValue.toFixed(2)
        ),
        Dispatched: summary.dispatched,
        "Dispatched Value": Number(
          summary.dispatchedValue.toFixed(2)
        ),
        Returned: summary.returned,
        "Returned Value": Number(
          summary.returnedValue.toFixed(2)
        ),
        Cancelled: summary.cancelled,
        "Cancelled Value": Number(
          summary.cancelledValue.toFixed(2)
        ),
      },
    ]);

    XLSX.utils.book_append_sheet(
      workbook,
      grandTotalSheet,
      "Grand Total"
    );

    XLSX.writeFile(
      workbook,
      `store-wise-summary-${month}.xlsx`
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          Reports
        </h1>

        <p className="mt-1 text-sm font-bold text-slate-500">
          Store-wise summary separated by Airtable base.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black text-slate-950">
          Store Wise Orders Report
        </h2>

        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-xs font-bold text-slate-500">
              Month
            </label>

            <input
              type="month"
              value={month}
              onChange={(event) =>
                setMonth(event.target.value)
              }
              className="mt-1 h-11 w-full rounded-xl border px-3 font-bold"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">
              Store
            </label>

            <input
              value={store}
              onChange={(event) =>
                setStore(event.target.value)
              }
              placeholder="Optional"
              className="mt-1 h-11 w-full rounded-xl border px-3 font-bold"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">
              Status
            </label>

            <input
              value={status}
              onChange={(event) =>
                setStatus(event.target.value)
              }
              placeholder="Optional"
              className="mt-1 h-11 w-full rounded-xl border px-3 font-bold"
            />
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
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-black text-amber-900">
            Some bases could not be loaded:
          </p>

          <div className="mt-2 space-y-1 text-sm font-bold text-amber-800">
            {warnings.map((warning) => (
              <p key={`${warning.baseName}-${warning.message}`}>
                {warning.baseName}: {warning.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-3xl border bg-white p-10 text-center font-black text-blue-600">
          Loading full report...
        </div>
      )}

      {!loading &&
        reports.map((report) => (
          <BaseReportBlock
            key={report.baseId}
            report={report}
            month={month}
          />
        ))}

      {!loading && reports.length === 0 && (
        <div className="rounded-3xl border bg-white p-10 text-center font-bold text-slate-500">
          No records found.
        </div>
      )}

      {!loading && reports.length > 0 && (
        <>
          <GrandTotalBlock summary={summary} />

          <button
            type="button"
            onClick={exportExcel}
            className="h-12 rounded-xl border border-slate-300 bg-white px-6 font-black hover:bg-slate-50"
          >
            Export Store Summary Excel
          </button>
        </>
      )}
    </div>
  );
}

function BaseReportBlock({
  report,
  month,
}: {
  report: BaseReport;
  month: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-950">
            {report.baseName}
          </h2>

          <p className="text-sm font-bold text-slate-500">
            Store Summary
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-4 text-sm font-black">
            <span>
              Orders: {report.summary.totalOrders}
            </span>
            <span>
              Value: {formatAmount(report.summary.totalValue)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => exportSingleReport(report, month)}
            disabled={report.stores.length === 0}
            className="h-10 rounded-xl border border-blue-300 bg-blue-50 px-4 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            Export {report.baseName}
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[1380px] text-sm">
          <thead className="bg-slate-200">
            <tr>
              <th className="px-4 py-3 text-left">
                Store
              </th>
              <th className="px-4 py-3 text-center">
                Orders
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
              <th className="px-4 py-3 text-center">
                Pending
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
              <th className="px-4 py-3 text-center">
                Delivered
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
              <th className="px-4 py-3 text-center">
                Dispatched
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
              <th className="px-4 py-3 text-center">
                Returned
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
              <th className="px-4 py-3 text-center">
                Cancelled
              </th>
              <th className="px-4 py-3 text-right">
                Value
              </th>
            </tr>
          </thead>

          <tbody>
            {report.stores.map((row) => (
              <tr
                key={`${report.baseId}-${row.store}`}
                className="border-t hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-black">
                  {row.store}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.orders}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.value)}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.pending}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.pendingValue)}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.delivered}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.deliveredValue)}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.dispatched}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.dispatchedValue)}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.returned}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.returnedValue)}
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {row.cancelled}
                </td>
                <td className="px-4 py-3 text-right font-black">
                  {formatAmount(row.cancelledValue)}
                </td>
              </tr>
            ))}

            <tr className="border-t-2 bg-slate-900 text-white">
              <td className="px-4 py-4 font-black">
                TOTAL
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.totalOrders}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.totalValue)}
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.pending}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.pendingValue)}
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.delivered}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.deliveredValue)}
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.dispatched}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.dispatchedValue)}
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.returned}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.returnedValue)}
              </td>
              <td className="px-4 py-4 text-center font-black">
                {report.summary.cancelled}
              </td>
              <td className="px-4 py-4 text-right font-black">
                {formatAmount(report.summary.cancelledValue)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrandTotalBlock({
  summary,
}: {
  summary: ReportSummary;
}) {
  return (
    <div className="rounded-3xl border-2 border-emerald-500 bg-emerald-50 p-5 shadow-sm">
      <h2 className="mb-4 text-2xl font-black text-emerald-900">
        Grand Total
      </h2>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          title="Orders"
          value={summary.totalOrders}
        />
        <SummaryCard
          title="Value"
          value={formatAmount(summary.totalValue)}
        />
        <SummaryCard
          title="Pending"
          value={`${summary.pending} / ${formatAmount(
            summary.pendingValue
          )}`}
        />
        <SummaryCard
          title="Delivered"
          value={`${summary.delivered} / ${formatAmount(
            summary.deliveredValue
          )}`}
        />
        <SummaryCard
          title="Dispatched"
          value={`${summary.dispatched} / ${formatAmount(
            summary.dispatchedValue
          )}`}
        />
        <SummaryCard
          title="Returned"
          value={`${summary.returned} / ${formatAmount(
            summary.returnedValue
          )}`}
        />
      </div>

      <div className="mt-3">
        <SummaryCard
          title="Cancelled"
          value={`${summary.cancelled} / ${formatAmount(
            summary.cancelledValue
          )}`}
        />
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-xl font-black text-slate-950">
        {value}
      </p>
    </div>
  );
}
