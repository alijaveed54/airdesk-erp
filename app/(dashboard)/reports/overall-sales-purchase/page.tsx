"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw } from "lucide-react";

// Static review only — not runtime-tested.

interface DailyRow {
  date: string;
  soldQty: number;
  soldValue: number;
  purchaseValue: number;
}

interface BaseSummary {
  baseName: string;
  tableName: string;
  recordsFetched: number;
  soldMatched: number;
  purchaseMatched: number;
  error?: string;
}

interface ReportStats {
  totalRecordsFetched: number;
  soldRecordsMatched: number;
  purchaseRecordsMatched: number;
}

export default function OverallSalesPurchaseReportPage() {
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<DailyRow[]>([]);
  const [basesIncluded, setBasesIncluded] = useState<BaseSummary[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reports/overall-sales-purchase?month=${encodeURIComponent(month)}`,
        { cache: "no-store" }
      );
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to load report data");
      }
      setData(result.data || []);
      setBasesIncluded(result.basesIncluded || []);
      setStats(result.stats || null);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReport(selectedMonth);
  }, [selectedMonth, fetchReport]);

  const grandTotals = data.reduce(
    (acc, row) => {
      acc.soldQty += row.soldQty;
      acc.soldValue += row.soldValue;
      acc.purchaseValue += row.purchaseValue;
      return acc;
    },
    { soldQty: 0, soldValue: 0, purchaseValue: 0 }
  );

  // Excel / CSV Export Handler
  const handleExportExcel = () => {
    if (!data || data.length === 0) return;

    const headers = [
      "Date",
      "Total Sold Item Qty",
      "Total Sold Item Value",
      "Total Purchase On That Day",
    ];

    const rows = data.map((row) => [
      row.date,
      row.soldQty.toString(),
      row.soldValue.toFixed(2),
      row.purchaseValue.toFixed(2),
    ]);

    // Add Grand Total row at the bottom
    rows.push([
      "Grand Total",
      grandTotals.soldQty.toString(),
      grandTotals.soldValue.toFixed(2),
      grandTotals.purchaseValue.toFixed(2),
    ]);

    const csvContent = [headers, ...rows]
      .map((r) =>
        r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\r\n");

    // UTF-8 BOM taake Excel mein columns aur formatting bilkul theek khulein
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `Overall_Sales_Purchase_Report_${selectedMonth}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top Header, Month Selector & Export Button */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            Overall Sales & Purchase Report
          </h1>
          
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="month-picker"
              className="text-sm font-semibold text-slate-700"
            >
              Month:
            </label>
            <input
              id="month-picker"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="button"
            onClick={() => fetchReport(selectedMonth)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Loading..." : "Refresh"}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={loading || data.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download size={16} />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Monthly Sold Quantity
          </p>
          <p className="text-2xl font-black text-slate-800 mt-1">
            {grandTotals.soldQty.toLocaleString()}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Monthly Sold Value
          </p>
          <p className="text-2xl font-black text-emerald-600 mt-1">
            {grandTotals.soldValue.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Monthly Purchase (by Bill No)
          </p>
          <p className="text-2xl font-black text-blue-600 mt-1">
            {grandTotals.purchaseValue.toLocaleString(undefined, {
              // minimumFractionDigits: 2,
              // maximumFractionDigits: 2,
            })}
          </p>
        </div>
      </div>

      {/* Included Bases Breakdown */}
      {basesIncluded.length > 0 && !loading && (
        <div className="flex flex-wrap items-center gap-2">
          {basesIncluded.map((b, idx) => (
            <div
              key={idx}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${
                b.error
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-slate-100 border-slate-200 text-slate-700"
              }`}
            >
              <span className="font-bold">{b.baseName}</span> ({b.tableName}):{" "}
              {b.error ? (
                <span>{b.error}</span>
              ) : (
                <span>
                  Sales: <strong className="text-emerald-700">{b.soldMatched}</strong> |{" "}
                  Purchase: <strong className="text-blue-700">{b.purchaseMatched}</strong>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
          Error: {error}
        </div>
      )}

      {/* Overall Status Bar */}
      {stats && !loading && !error && (
        <div className="text-xs text-slate-500 px-1">
          Total Records Scanned for {selectedMonth}:{" "}
          <span className="font-bold text-slate-700">{stats.totalRecordsFetched}</span>{" "}
          (Total Sales Rows:{" "}
          <span className="font-bold text-emerald-600">{stats.soldRecordsMatched}</span>,{" "}
          Total Purchase Bills:{" "}
          <span className="font-bold text-blue-600">{stats.purchaseRecordsMatched}</span>)
        </div>
      )}

      {/* Report Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4 text-right">Total Sold Item Qty</th>
                <th className="py-3.5 px-4 text-right">Total Sold Item Value</th>
                <th className="py-3.5 px-4 text-right">Total Purchase On That Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-400 font-medium">
                    Loading report data across BS & FAB Doha bases...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-400">
                    No records found for this month.
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const hasActivity =
                    row.soldQty > 0 || row.soldValue > 0 || row.purchaseValue > 0;
                  return (
                    <tr
                      key={row.date}
                      className={`transition-colors ${
                        hasActivity
                          ? "bg-white hover:bg-emerald-50/40"
                          : "bg-slate-50/40 text-slate-400 hover:bg-slate-100/50"
                      }`}
                    >
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {row.date}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        {row.soldQty.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        {row.soldValue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        {row.purchaseValue.toLocaleString(undefined, {
                          // minimumFractionDigits: 2,
                          // maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {data.length > 0 && !loading && (
              <tfoot>
                <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                  <td className="py-3.5 px-4">Grand Total</td>
                  <td className="py-3.5 px-4 text-right">
                    {grandTotals.soldQty.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right text-emerald-700">
                    {grandTotals.soldValue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-3.5 px-4 text-right text-blue-700">
                    {grandTotals.purchaseValue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}