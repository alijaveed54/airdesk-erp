"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PendingOrderRow = {
  orderNo: string;
  customer: string;
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

export default function OrderReceivedPendingPage() {
  const [rows, setRows] = useState<PendingOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState("");
  const [status, setStatus] = useState<string>("Order Received");
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  // 1. Orders List waly endpoint (/api/orders/list) se exact status options pick karein
  useEffect(() => {
    async function loadStatusOptionsFromOrderList() {
      try {
        const res = await fetch("/api/orders/list?pageSize=1", { cache: "no-store" });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.statusOptions)) {
          setStatusOptions(data.statusOptions);
        }
      } catch (err) {
        console.error("Failed to load status options from order list API:", err);
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
        alert(
          data.message ||
            "Report load failed"
        );
      }
    } catch (error) {
      console.error(error);
      alert(
        "Unable to load report"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport("Order Received");
  }, []);

  async function copyLine(
    line: string
  ) {
    await navigator.clipboard.writeText(
      line
    );

    setCopied(line);

    setTimeout(() => {
      setCopied("");
    }, 1500);
  }

  const filteredRows =
    rows.filter((row) => {
      const value =
        `${row.orderNo}
        ${row.customer}
        ${row.reason}`
          .toLowerCase();

      return value.includes(
        search.toLowerCase()
      );
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

        <div className="flex flex-wrap gap-3 mb-5 items-center">

          <input
            type="text"
            placeholder="Search Order / Customer / Reason"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="
              h-11 flex-1 min-w-[220px] rounded-xl
              border px-4 font-bold
            "
          />

          <div className="flex items-center gap-2">
            <label className="text-xs font-black text-slate-500">Status:</label>
            <select
              value={status}
              onChange={(e) => {
                const newStatus = e.target.value;
                setStatus(newStatus);
                loadReport(newStatus);
              }}
              className="
                h-11 rounded-xl
                border border-slate-300 bg-white
                px-3 font-bold text-slate-800
                focus:border-blue-500 focus:outline-none
              "
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
            className="
              rounded-xl bg-blue-600
              px-5 h-11 font-black text-white
              disabled:opacity-50
            "
          >
            {loading
              ? "Loading..."
              : "Refresh"}
          </button>

        </div>


        <div className="space-y-3">

          {filteredRows.length === 0 && !loading && (
            <div className="
              rounded-xl border
              p-5 text-center
              font-bold text-slate-500
            ">
              No matching orders found.
            </div>
          )}


          {filteredRows.map((row) => (

            <div
              key={row.orderNo}
              className="
                flex items-center gap-3
                rounded-xl border
                bg-slate-50
                p-4
              "
            >

              <div
                className="
                  flex-1 text-sm
                  font-bold text-slate-800
                "
              >
                <div className="whitespace-pre-line">
  {row.line}
</div>
              </div>


              <button
                type="button"
                onClick={() =>
                  copyLine(row.copyText || row.line)
                }
                className="
                  shrink-0 rounded-lg
                  bg-slate-900
                  px-4 py-2
                  text-sm font-black
                  text-white
                "
              >
                {copied === (row.copyText || row.line)
                  ? "Copied"
                  : "Copy"}
              </button>

            </div>

          ))}

        </div>

      </div>

    </div>
  );
}