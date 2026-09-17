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
};

export default function OrderReceivedPendingPage() {
  const [rows, setRows] = useState<PendingOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState("");

  async function loadReport() {
    setLoading(true);

    try {
      const response = await fetch(
        "/api/reports/order-received-pending",
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
    loadReport();
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
            Order Received Pending Reason
          </h1>

          <p className="mt-1 text-sm font-bold text-slate-500">
            Only Order Received orders pending for processing.
          </p>
        </div>

        <Link
          href="/reports"
          className="rounded-xl border px-4 py-2 font-bold"
        >
          Back
        </Link>
      </div>
       id="page-part-2"
      <div className="rounded-3xl border bg-white p-5 shadow-sm">

        <div className="flex gap-3 mb-5">

          <input
            type="text"
            placeholder="Search Order / Customer / Reason"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="
              h-11 flex-1 rounded-xl
              border px-4 font-bold
            "
          />

          <button
            type="button"
            onClick={loadReport}
            disabled={loading}
            className="
              rounded-xl bg-blue-600
              px-5 font-black text-white
              disabled:opacity-50
            "
          >
            {loading
              ? "Loading..."
              : "Refresh"}
          </button>

        </div>


        <div className="space-y-3">

          {filteredRows.length === 0 && (
            <div className="
              rounded-xl border
              p-5 text-center
              font-bold text-slate-500
            ">
              No Order Received pending orders found.
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
                  copyLine(row.line)
                }
                className="
                  shrink-0 rounded-lg
                  bg-slate-900
                  px-4 py-2
                  text-sm font-black
                  text-white
                "
              >
                {copied === row.line
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