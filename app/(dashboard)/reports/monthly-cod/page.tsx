"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Store,
  Truck,
} from "lucide-react";
import * as XLSX from "xlsx";

type CodRow = {
  id: string;
  baseName: string;
  store: string;
  courier: string;
  orderNo: string;
  receiveDate: string;
  amount: number;
};

type ApiResponse = {
  success: boolean;
  message?: string;
  rows?: CodRow[];
  bases?: string[];
  courierOptions?: string[];
  warnings?: Array<{ baseName: string; message: string }>;
};

type SummaryRow = {
  name: string;
  orders: number;
  amount: number;
};

type BaseStoreGroup = {
  baseName: string;
  orders: number;
  amount: number;
  stores: SummaryRow[];
};

function currentMonth() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export default function MonthlyCodReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [base, setBase] = useState("");
  const [courier, setCourier] = useState("");

  const [rows, setRows] = useState<CodRow[]>([]);
  const [bases, setBases] = useState<string[]>([]);
  const [courierOptions, setCourierOptions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<
    Array<{ baseName: string; message: string }>
  >([]);

  const [expandedBases, setExpandedBases] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadReport() {
    setLoading(true);
    setMessage("");

    try {
      const params = new URLSearchParams({ month });

      if (base) params.set("base", base);
      if (courier) params.set("courier", courier);

      const response = await fetch(
        `/api/reports/monthly-cod?${params.toString()}`,
        { cache: "no-store" },
      );

      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Monthly COD report load failed");
      }

      setRows(data.rows || []);
      setBases(data.bases || []);
      setCourierOptions(data.courierOptions || []);
      setWarnings(data.warnings || []);
    } catch (error) {
      setRows([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Monthly COD report load failed",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalOrders = rows.length;

  const totalAmount = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );

  const uniqueStoreCount = useMemo(() => {
    const stores = new Set(
      rows.map((row) => `${row.baseName}|||${row.store || "Unknown Store"}`),
    );

    return stores.size;
  }, [rows]);

  const baseStoreSummary = useMemo<BaseStoreGroup[]>(() => {
    const baseMap = new Map<
      string,
      {
        baseName: string;
        orders: number;
        amount: number;
        storeMap: Map<string, SummaryRow>;
      }
    >();

    for (const row of rows) {
      const baseName = row.baseName || "Unknown Base";
      const storeName = row.store || "Unknown Store";

      if (!baseMap.has(baseName)) {
        baseMap.set(baseName, {
          baseName,
          orders: 0,
          amount: 0,
          storeMap: new Map(),
        });
      }

      const baseItem = baseMap.get(baseName)!;
      baseItem.orders += 1;
      baseItem.amount += row.amount;

      if (!baseItem.storeMap.has(storeName)) {
        baseItem.storeMap.set(storeName, {
          name: storeName,
          orders: 0,
          amount: 0,
        });
      }

      const storeItem = baseItem.storeMap.get(storeName)!;
      storeItem.orders += 1;
      storeItem.amount += row.amount;
    }

    return Array.from(baseMap.values())
      .map(({ storeMap, ...baseItem }) => ({
        ...baseItem,
        stores: Array.from(storeMap.values()).sort(
          (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
        ),
      }))
      .sort(
        (a, b) =>
          b.amount - a.amount || a.baseName.localeCompare(b.baseName),
      );
  }, [rows]);

  const courierSummary = useMemo<SummaryRow[]>(() => {
    const map = new Map<string, SummaryRow>();

    for (const row of rows) {
      const name = row.courier || "Not Assigned";

      if (!map.has(name)) {
        map.set(name, { name, orders: 0, amount: 0 });
      }

      const item = map.get(name)!;
      item.orders += 1;
      item.amount += row.amount;
    }

    return Array.from(map.values()).sort(
      (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
    );
  }, [rows]);

  useEffect(() => {
    setExpandedBases(new Set(baseStoreSummary.map((item) => item.baseName)));
  }, [baseStoreSummary]);

  function toggleBase(baseName: string) {
    setExpandedBases((current) => {
      const next = new Set(current);

      if (next.has(baseName)) {
        next.delete(baseName);
      } else {
        next.add(baseName);
      }

      return next;
    });
  }

  function exportExcel() {
    const workbook = XLSX.utils.book_new();

    const overallRows = [
      {
        Month: month,
        "Total COD Orders": totalOrders,
        "Total COD Amount": Number(totalAmount.toFixed(2)),
        "Total Bases": baseStoreSummary.length,
        "Total Stores": uniqueStoreCount,
        "Total Couriers": courierSummary.length,
      },
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(overallRows),
      "Overall Summary",
    );

    const storeRows = baseStoreSummary.flatMap((baseItem) =>
      baseItem.stores.map((storeItem) => ({
        Base: baseItem.baseName,
        Store: storeItem.name,
        "COD Orders": storeItem.orders,
        "COD Amount": Number(storeItem.amount.toFixed(2)),
      })),
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(storeRows),
      "Base Store Summary",
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        courierSummary.map((item) => ({
          Courier: item.name,
          "COD Orders": item.orders,
          "COD Amount": Number(item.amount.toFixed(2)),
        })),
      ),
      "Courier Summary",
    );

    XLSX.writeFile(workbook, `monthly-cod-summary-${month}.xlsx`);
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Monthly COD Summary
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Base-wise sections with store-wise COD breakdown.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={exportExcel}
            disabled={loading || rows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Export Excel
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Month
          </span>

          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Base
          </span>

          <select
            value={base}
            onChange={(event) => setBase(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
          >
            <option value="">All Bases</option>
            {bases.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Courier
          </span>

          <select
            value={courier}
            onChange={(event) => setCourier(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
          >
            <option value="">All Couriers</option>
            {courierOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void loadReport()}
          disabled={loading || !month}
          className="rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60 md:col-span-3"
        >
          {loading ? "Loading Summary..." : "Apply Filters"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              Total COD Orders
            </p>
            <CalendarDays className="h-5 w-5 text-slate-400" />
          </div>

          <p className="mt-3 text-2xl font-bold text-slate-900">
            {totalOrders}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              Total COD Amount
            </p>
            <Banknote className="h-5 w-5 text-slate-400" />
          </div>

          <p className="mt-3 text-2xl font-bold text-emerald-700">
            {money(totalAmount)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Total Bases</p>
            <Building2 className="h-5 w-5 text-slate-400" />
          </div>

          <p className="mt-3 text-2xl font-bold text-slate-900">
            {baseStoreSummary.length}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Total Stores</p>
            <Store className="h-5 w-5 text-slate-400" />
          </div>

          <p className="mt-3 text-2xl font-bold text-slate-900">
            {uniqueStoreCount}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              Total Couriers
            </p>
            <Truck className="h-5 w-5 text-slate-400" />
          </div>

          <p className="mt-3 text-2xl font-bold text-slate-900">
            {courierSummary.length}
          </p>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {message}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {warnings.map((warning) => (
            <div key={`${warning.baseName}-${warning.message}`}>
              <strong>{warning.baseName}:</strong> {warning.message}
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No COD summary found for this month.
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Base-wise Store Summary
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Click a base to expand or collapse its stores.
              </p>
            </div>

            {baseStoreSummary.map((baseItem) => {
              const isExpanded = expandedBases.has(baseItem.baseName);

              return (
                <div
                  key={baseItem.baseName}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleBase(baseItem.baseName)}
                    className="flex w-full items-center justify-between gap-4 bg-slate-900 px-5 py-4 text-left text-white hover:bg-slate-800"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 shrink-0" />
                      )}

                      <div className="min-w-0">
                        <p className="truncate text-base font-bold">
                          {baseItem.baseName}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-300">
                          {baseItem.stores.length} stores
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-5 text-right">
                      <div>
                        <p className="text-xs text-slate-300">Orders</p>
                        <p className="font-bold">{baseItem.orders}</p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-300">COD Amount</p>
                        <p className="font-bold">{money(baseItem.amount)}</p>
                      </div>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-5 py-3">Store</th>
                            <th className="px-5 py-3 text-right">COD Orders</th>
                            <th className="px-5 py-3 text-right">COD Amount</th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100">
                          {baseItem.stores.map((storeItem) => (
                            <tr
                              key={`${baseItem.baseName}-${storeItem.name}`}
                              className="hover:bg-slate-50"
                            >
                              <td className="px-5 py-3 font-semibold text-slate-800">
                                {storeItem.name}
                              </td>
                              <td className="px-5 py-3 text-right text-slate-700">
                                {storeItem.orders}
                              </td>
                              <td className="px-5 py-3 text-right font-bold text-slate-900">
                                {money(storeItem.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>

                        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                          <tr>
                            <td className="px-5 py-3 font-bold text-slate-900">
                              Base Total
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-slate-900">
                              {baseItem.orders}
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-emerald-700">
                              {money(baseItem.amount)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="font-bold text-slate-900">
                Courier-wise Summary
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Courier</th>
                    <th className="px-4 py-3 text-right">COD Orders</th>
                    <th className="px-4 py-3 text-right">COD Amount</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {courierSummary.map((item) => (
                    <tr key={item.name} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {item.name}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {item.orders}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {money(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
