"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

type CodOrder = {
  id: string;
  orderNo: string;
  customer: string;
  phone: string;
  courier: string;
  deliveredDate: string;
  amount: number;
  baseName: string;
};

type ApiResponse = {
  success: boolean;
  message?: string;
  excluded?: boolean;
  baseName?: string;
  orders?: CodOrder[];
};

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function displayDate(value: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

export default function CodPendingReportPage() {
  const [orders, setOrders] = useState<CodOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [courier, setCourier] = useState("");
  const [receiveDate, setReceiveDate] = useState(todayInputValue());
  const [baseName, setBaseName] = useState("");
  const [excluded, setExcluded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/reports/cod", {
        cache: "no-store",
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load COD pending report.");
      }

      setOrders(data.orders || []);
      setBaseName(data.baseName || "");
      setExcluded(Boolean(data.excluded));
      setSelected([]);
    } catch (error) {
      setOrders([]);
      setMessage(
        error instanceof Error ? error.message : "Unable to load COD pending report.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const courierOptions = useMemo(
    () =>
      Array.from(
        new Set(orders.map((order) => order.courier).filter(Boolean)),
      ).sort(),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (courier && order.courier !== courier) return false;
      
      if (!query) return true;

      return [
        order.orderNo,
        order.customer,
        order.phone,
        order.courier,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [orders, search, courier]);

  const filteredIds = useMemo(
    () => filteredOrders.map((order) => order.id),
    [filteredOrders],
  );

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected.includes(order.id)),
    [orders, selected],
  );

  const pendingAmount = useMemo(
    () => filteredOrders.reduce((sum, order) => sum + order.amount, 0),
    [filteredOrders],
  );

  const selectedAmount = useMemo(
    () => selectedOrders.reduce((sum, order) => sum + order.amount, 0),
    [selectedOrders],
  );

  const allFilteredSelected =
    filteredIds.length > 0 &&
    filteredIds.every((recordId) => selected.includes(recordId));

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelected((current) =>
        current.filter((recordId) => !filteredIds.includes(recordId)),
      );
      return;
    }

    setSelected((current) =>
      Array.from(new Set([...current, ...filteredIds])),
    );
  }

  function toggleOrder(recordId: string) {
    setSelected((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId],
    );
  }

  async function markReceived() {
    if (selected.length === 0) {
      setMessage("Select at least one COD order.");
      return;
    }

    if (!receiveDate) {
      setMessage("Select the COD Receive Date.");
      return;
    }

    const confirmed = window.confirm(
      `Mark ${selected.length} selected order(s) as COD received on ${displayDate(
        receiveDate,
      )}?`,
    );

    if (!confirmed) return;

    setUpdating(true);
    setMessage("");

    try {
      const response = await fetch("/api/reports/cod", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordIds: selected,
          receiveDate,
        }),
      });

      const data = (await response.json()) as ApiResponse & {
        updated?: number;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "COD update failed.");
      }

      const selectedSet = new Set(selected);
      setOrders((current) =>
        current.filter((order) => !selectedSet.has(order.id)),
      );
      setSelected([]);
      setMessage(`${data.updated || 0} order(s) marked as COD received.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "COD update failed.");
    } finally {
      setUpdating(false);
    }
  }

  function exportCsv() {
    const rows = filteredOrders.map((order) => [
      order.orderNo,
      order.customer,
      order.phone,
      order.courier,
      displayDate(order.deliveredDate),
      order.amount.toFixed(2),
      order.baseName,
    ]);

    const content = [
      [
        "Order No",
        "Customer",
        "Phone",
        "Courier",
        "Delivered Date",
        "COD Amount",
        "Base",
      ],
      ...rows,
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF", content], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `COD-Pending-${todayInputValue()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-slate-900 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-100">
                UAE Finance
              </p>
              <h1 className="mt-2 text-3xl font-black">COD Pending Report</h1>
              <p className="mt-2 max-w-2xl text-sm text-emerald-50/90">
                Delivered UAE orders whose COD has not yet been received.
                Monthly COD accounting will use the COD Receive Date—not the
                order date.
              </p>
              {baseName && (
                <p className="mt-3 text-sm font-bold text-white">
                  Active Base: {baseName}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void loadOrders()}
              disabled={loading || updating}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-emerald-700 shadow-lg transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                size={18}
                className={loading ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-700 shadow-sm">
            {message}
          </div>
        )}

        {excluded ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto text-amber-600" size={42} />
            <h2 className="mt-4 text-xl font-black text-amber-900">
              COD report is not required for this base
            </h2>
            <p className="mt-2 text-sm font-semibold text-amber-800">
              In Doha bases, Delivered already means COD Received. Select a UAE
              BS or TAT base to use this report.
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-bold text-slate-500">
                  Pending COD Orders
                </p>
                <p className="mt-2 text-3xl font-black text-slate-900">
                  {filteredOrders.length}
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-bold text-slate-500">
                  Pending COD Amount
                </p>
                <p className="mt-2 text-3xl font-black text-emerald-700">
                  {money(pendingAmount)}
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-bold text-slate-500">
                  Selected COD Amount
                </p>
                <p className="mt-2 text-3xl font-black text-blue-700">
                  {money(selectedAmount)}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_200px_auto]">
                <label className="relative">
                  <Search
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search order, customer, phone..."
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-emerald-500 focus:bg-white"
                  />
                </label>

                <select
                  value={courier}
                  onChange={(event) => setCourier(event.target.value)}
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-emerald-500"
                >
                  <option value="">All Couriers</option>
                  {courierOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={filteredOrders.length === 0}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={18} />
                  Excel
                </button>
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-end sm:justify-between">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">
                    COD Receive Date
                  </span>
                  <div className="relative">
                    <CalendarDays
                      size={17}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="date"
                      value={receiveDate}
                      onChange={(event) => setReceiveDate(event.target.value)}
                      className="h-11 rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-500"
                    />
                  </div>
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={toggleAllFiltered}
                    disabled={filteredIds.length === 0}
                    className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    {allFilteredSelected ? "Unselect Visible" : "Select All Visible"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void markReceived()}
                    disabled={updating || selected.length === 0}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updating ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Banknote size={18} />
                    )}
                    Mark COD Received ({selected.length})
                  </button>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-4">Select</th>
                      <th className="px-4 py-4">Order No.</th>
                      <th className="px-4 py-4">Customer</th>
                      <th className="px-4 py-4">Phone</th>
                                            <th className="px-4 py-4">Courier</th>
                      <th className="px-4 py-4">Delivered Date</th>
                      <th className="px-4 py-4 text-right">COD Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center">
                          <Loader2
                            size={30}
                            className="mx-auto animate-spin text-emerald-600"
                          />
                          <p className="mt-3 font-bold text-slate-500">
                            Loading COD pending orders...
                          </p>
                        </td>
                      </tr>
                    ) : filteredOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-16 text-center font-bold text-slate-500"
                        >
                          No pending COD orders found.
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((order) => (
                        <tr
                          key={order.id}
                          className={
                            selected.includes(order.id)
                              ? "bg-emerald-50/70"
                              : "hover:bg-slate-50"
                          }
                        >
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selected.includes(order.id)}
                              onChange={() => toggleOrder(order.id)}
                              className="h-4 w-4 accent-emerald-600"
                            />
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 font-black text-slate-900">
                            {order.orderNo || "—"}
                          </td>
                          <td className="px-4 py-4 font-bold text-slate-700">
                            {order.customer || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                            {order.phone || "—"}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {order.courier || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                            {displayDate(order.deliveredDate)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-right font-black text-emerald-700">
                            {money(order.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
