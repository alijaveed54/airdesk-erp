"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PendingOrderRow = {
  orderNo: string;
  orderStatus?: string;
  customer: string;
  mobile?: string;
  date: string;
  qty: number;
  instock: number;
  supplier: string;
  billNo: string;
  receivedWh: string;
  reason: string;
  line: string;
  copyText?: string;
};

function normalizeDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function matchesMobileSearch(rowMobile: string, searchMobile: string) {
  const query = searchMobile.trim().toLowerCase();
  if (!query) return true;

  const rawMobile = String(rowMobile || "").trim().toLowerCase();
  if (rawMobile.includes(query)) return true;

  const rowDigits = normalizeDigits(rawMobile);
  const queryDigits = normalizeDigits(query);

  if (!queryDigits) return false;
  if (rowDigits.includes(queryDigits)) return true;

  // Match local vs country-code format (e.g., 050xxxxxxx vs +97150xxxxxxx)
  const suffixLen = Math.min(9, rowDigits.length, queryDigits.length);
  return (
    suffixLen >= 7 &&
    rowDigits.slice(-suffixLen) === queryDigits.slice(-suffixLen)
  );
}

export default function OrderReceivedPendingPage() {
  const [rows, setRows] = useState<PendingOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [mobileSearch, setMobileSearch] = useState("");
  const [copied, setCopied] = useState("");
  const [status, setStatus] = useState<string>("Order Received");
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  useEffect(() => {
    async function loadStatusOptionsFromOrderList() {
      try {
        const res = await fetch("/api/orders/list?pageSize=1", {
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.statusOptions)) {
          setStatusOptions(data.statusOptions);
        }
      } catch (err) {
        console.error(
          "Failed to load status options from order list API:",
          err
        );
      }
    }

    loadStatusOptionsFromOrderList();
  }, []);

  async function loadReport(selectedStatus = status) {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (selectedStatus && selectedStatus !== "all") {
        params.set("status", selectedStatus);
      }

      const response = await fetch(
        `/api/reports/order-received-pending?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (data.success) {
        setRows(data.rows || []);
      } else {
        alert(data.message || "Report load failed");
      }
    } catch (error) {
      console.error(error);
      alert("Unable to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport("Order Received");
  }, []);

  async function copyLine(line: string) {
    await navigator.clipboard.writeText(line);

    setCopied(line);

    setTimeout(() => {
      setCopied("");
    }, 1500);
  }

  const filteredRows = rows.filter((row) => {
    const orderQuery = orderSearch.trim().toLowerCase();
    const customerQuery = customerSearch.trim().toLowerCase();

    const matchesOrder =
      !orderQuery ||
      String(row.orderNo || "").toLowerCase().includes(orderQuery) ||
      String(row.reason || "").toLowerCase().includes(orderQuery);

    const matchesCustomer =
      !customerQuery ||
      String(row.customer || "").toLowerCase().includes(customerQuery);

    const matchesMobile = matchesMobileSearch(
      row.mobile || "",
      mobileSearch
    );

    return matchesOrder && matchesCustomer && matchesMobile;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Order Pending Reason Report
          </h1>

          <p className="mt-1 text-sm font-bold text-slate-500">
            Orders pending for processing filtered by order status.
          </p>
        </div>

        <Link
          href="/reports"
          className="rounded-xl border px-4 py-2 font-bold"
        >
          Back
        </Link>
      </div>

      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5 items-center">
          <input
            type="text"
            placeholder="Search Order No / Reason"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            className="h-11 w-full rounded-xl border px-4 font-bold"
          />

          <input
            type="text"
            placeholder="Search Customer Name"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="h-11 w-full rounded-xl border px-4 font-bold"
          />

          <input
            type="text"
            placeholder="Search Mobile Number"
            value={mobileSearch}
            onChange={(e) => setMobileSearch(e.target.value)}
            className="h-11 w-full rounded-xl border px-4 font-bold"
          />

          <div className="flex items-center gap-2">
            <label className="text-xs font-black text-slate-500 shrink-0">
              Status:
            </label>
            <select
              value={status}
              onChange={(e) => {
                const newStatus = e.target.value;
                setStatus(newStatus);
                loadReport(newStatus);
              }}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => loadReport(status)}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-5 h-11 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="space-y-3">
          {filteredRows.length === 0 && !loading && (
            <div className="rounded-xl border p-5 text-center font-bold text-slate-500">
              No matching orders found.
            </div>
          )}

          {filteredRows.map((row) => (
            <div
              key={row.orderNo}
              className="flex items-center gap-3 rounded-xl border bg-slate-50 p-4"
            >
              <div className="flex-1 text-sm font-bold text-slate-800">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-base font-black text-slate-950">
                    {row.orderNo}
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-black text-blue-800">
                    {row.orderStatus || status || "Order Received"}
                  </span>
                  {row.customer && (
                    <span className="text-xs font-bold text-slate-600">
                      • {row.customer}
                    </span>
                  )}
                  {row.mobile && (
                    <span className="text-xs font-bold text-slate-500">
                      ({row.mobile})
                    </span>
                  )}
                </div>

                <div className="whitespace-pre-line">{row.line}</div>
              </div>

              <button
                type="button"
                onClick={() => copyLine(row.copyText || row.line)}
                className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white"
              >
                {copied === (row.copyText || row.line) ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}