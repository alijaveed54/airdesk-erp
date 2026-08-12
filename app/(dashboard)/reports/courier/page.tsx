"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type CourierRow = {
  courier: string;
  parcels: number;
  value: number;
  delivered: number;
  deliveredValue: number;
  dispatched: number;
  dispatchedValue: number;
  returned: number;
  returnedValue: number;
  inTransit: number;
  inTransitValue: number;
  olderThan7: number;
  olderThan7Value: number;
};

type Summary = Omit<CourierRow, "courier" | "parcels"> & {
  totalParcels: number;
  totalValue: number;
};

type OldOrderRow = {
  id: string;
  orderNo: string;
  store: string;
  customer: string;
  phone: string;
  courier: string;
  status: string;
  value: number;
  despatchDate: string;
  days: number;
};

type BaseReport = {
  baseName: string;
  baseId: string;
  deliveryFieldLabel: "Courier" | "Driver";
  couriers: CourierRow[];
  oldOrders: OldOrderRow[];
  summary: Summary;
};

const EMPTY_SUMMARY: Summary = {
  totalParcels: 0,
  totalValue: 0,
  value: 0,
  delivered: 0,
  deliveredValue: 0,
  dispatched: 0,
  dispatchedValue: 0,
  returned: 0,
  returnedValue: 0,
  inTransit: 0,
  inTransitValue: 0,
  olderThan7: 0,
  olderThan7Value: 0,
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function amount(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeName(value: string) {
  return (
    value
      .replace(/[\\/?*[\]:]/g, "")
      .slice(0, 31) || "Courier Report"
  );
}

function exportBase(report: BaseReport, month: string) {
  const rows = [
    ...report.couriers.map((row) => ({
      [report.deliveryFieldLabel]: row.courier,
      Parcels: row.parcels,
      Value: Number(row.value.toFixed(2)),
      Delivered: row.delivered,
      "Delivered Value": Number(row.deliveredValue.toFixed(2)),
      Dispatched: row.dispatched,
      "Dispatched Value": Number(row.dispatchedValue.toFixed(2)),
      Returned: row.returned,
      "Returned Value": Number(row.returnedValue.toFixed(2)),
      "In Transit": row.inTransit,
      "In Transit Value": Number(row.inTransitValue.toFixed(2)),
      "7+ Days": row.olderThan7,
      "7+ Days Value": Number(row.olderThan7Value.toFixed(2)),
    })),
    {
      [report.deliveryFieldLabel]: "TOTAL",
      Parcels: report.summary.totalParcels,
      Value: Number(report.summary.totalValue.toFixed(2)),
      Delivered: report.summary.delivered,
      "Delivered Value": Number(report.summary.deliveredValue.toFixed(2)),
      Dispatched: report.summary.dispatched,
      "Dispatched Value": Number(report.summary.dispatchedValue.toFixed(2)),
      Returned: report.summary.returned,
      "Returned Value": Number(report.summary.returnedValue.toFixed(2)),
      "In Transit": report.summary.inTransit,
      "In Transit Value": Number(report.summary.inTransitValue.toFixed(2)),
      "7+ Days": report.summary.olderThan7,
      "7+ Days Value": Number(report.summary.olderThan7Value.toFixed(2)),
    },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    safeName(report.baseName)
  );

  XLSX.writeFile(
    workbook,
    `${report.baseName.replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase()}-courier-${month}.xlsx`
  );
}


function exportOldOrders(report: BaseReport, month: string) {
  const rows = report.oldOrders.map((order) => ({
    "Order No": order.orderNo,
    Date: order.despatchDate,
    Days: order.days,
    [report.deliveryFieldLabel]: order.courier,
    Store: order.store,
    Customer: order.customer,
    Phone: order.phone,
    Value: Number(order.value.toFixed(2)),
    Status: order.status,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "7+ Days Orders");
  XLSX.writeFile(
    workbook,
    `${report.baseName.replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase()}-7plus-days-${month}.xlsx`
  );
}

export default function CourierReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [courier, setCourier] = useState("");
  const [store, setStore] = useState("");
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<BaseReport[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [warnings, setWarnings] = useState<
    Array<{ baseName: string; message: string }>
  >([]);

  async function loadReport() {
    setLoading(true);

    try {
      const params = new URLSearchParams({ month });

      if (courier.trim()) params.set("courier", courier.trim());
      if (store.trim()) params.set("store", store.trim());

      const response = await fetch(
        `/api/reports/courier?${params.toString()}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Courier report load failed");
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
          : "Courier report load failed"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportAll() {
    const workbook = XLSX.utils.book_new();

    for (const report of reports) {
      const rows = report.couriers.map((row) => ({
        [report.deliveryFieldLabel]: row.courier,
        Parcels: row.parcels,
        Value: Number(row.value.toFixed(2)),
        Delivered: row.delivered,
        "Delivered Value": Number(row.deliveredValue.toFixed(2)),
        Dispatched: row.dispatched,
        "Dispatched Value": Number(row.dispatchedValue.toFixed(2)),
        Returned: row.returned,
        "Returned Value": Number(row.returnedValue.toFixed(2)),
        "In Transit": row.inTransit,
        "In Transit Value": Number(row.inTransitValue.toFixed(2)),
        "7+ Days": row.olderThan7,
        "7+ Days Value": Number(row.olderThan7Value.toFixed(2)),
      }));

      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        safeName(report.baseName)
      );
    }

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          Name: "GRAND TOTAL",
          Parcels: summary.totalParcels,
          Value: Number(summary.totalValue.toFixed(2)),
          Delivered: summary.delivered,
          "Delivered Value": Number(summary.deliveredValue.toFixed(2)),
          Dispatched: summary.dispatched,
          "Dispatched Value": Number(summary.dispatchedValue.toFixed(2)),
          Returned: summary.returned,
          "Returned Value": Number(summary.returnedValue.toFixed(2)),
          "In Transit": summary.inTransit,
          "In Transit Value": Number(summary.inTransitValue.toFixed(2)),
          "7+ Days": summary.olderThan7,
          "7+ Days Value": Number(summary.olderThan7Value.toFixed(2)),
        },
      ]),
      "Grand Total"
    );

    XLSX.writeFile(workbook, `courier-summary-${month}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Courier / Driver Report
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Admin and Manager see only their permitted bases. Employees see the selected base.
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
        <div className="grid gap-4 md:grid-cols-4">
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <input
            value={courier}
            onChange={(event) => setCourier(event.target.value)}
            placeholder="Courier / Driver"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <input
            value={store}
            onChange={(event) => setStore(event.target.value)}
            placeholder="Store"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <button
            type="button"
            onClick={loadReport}
            disabled={loading}
            className="h-11 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          {warnings.map((warning) => (
            <p
              key={`${warning.baseName}-${warning.message}`}
              className="text-sm font-bold text-amber-800"
            >
              {warning.baseName}: {warning.message}
            </p>
          ))}
        </div>
      )}

      {loading && (
        <div className="rounded-3xl border bg-white p-10 text-center font-black text-blue-600">
          Loading...
        </div>
      )}

      {!loading &&
        reports.map((report) => (
          <BaseCourierBlock
            key={report.baseId}
            report={report}
            month={month}
          />
        ))}

      {!loading && reports.length > 0 && (
        <>
          <GrandTotal summary={summary} />

          <button
            type="button"
            onClick={exportAll}
            className="h-12 rounded-xl border border-slate-300 bg-white px-6 font-black"
          >
            Export All Bases
          </button>
        </>
      )}

      {!loading && reports.length === 0 && (
        <div className="rounded-3xl border bg-white p-10 text-center font-bold text-slate-500">
          No records found.
        </div>
      )}
    </div>
  );
}

function BaseCourierBlock({
  report,
  month,
}: {
  report: BaseReport;
  month: string;
}) {
  return (
    <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-950">
            {report.baseName}
          </h2>
          <p className="text-sm font-bold text-slate-500">
            {report.deliveryFieldLabel} Summary
          </p>
        </div>

        <button
          type="button"
          onClick={() => exportBase(report, month)}
          disabled={report.couriers.length === 0}
          className="h-10 rounded-xl border border-blue-300 bg-blue-50 px-4 text-sm font-black text-blue-700 disabled:opacity-50"
        >
          Export {report.baseName}
        </button>
      </div>

      <div className="overflow-auto rounded-2xl border">
        <table className="w-full min-w-[1350px] text-sm">
          <thead className="bg-slate-200">
            <tr>
              <th className="px-4 py-3 text-left">
                {report.deliveryFieldLabel}
              </th>
              <th className="px-4 py-3 text-center">Parcels</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-center">Delivered</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-center">Dispatched</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-center">Returned</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-center">In Transit</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-center">7+ Days</th>
              <th className="px-4 py-3 text-right">Value</th>
            </tr>
          </thead>

          <tbody>
            {report.couriers.map((row) => (
              <tr
                key={row.courier}
                className={`border-t ${
                  row.olderThan7 > 0 ? "bg-red-50" : ""
                }`}
              >
                <td className="px-4 py-3 font-black">{row.courier}</td>
                <td className="px-4 py-3 text-center font-bold">{row.parcels}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.value)}</td>
                <td className="px-4 py-3 text-center font-bold">{row.delivered}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.deliveredValue)}</td>
                <td className="px-4 py-3 text-center font-bold">{row.dispatched}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.dispatchedValue)}</td>
                <td className="px-4 py-3 text-center font-bold">{row.returned}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.returnedValue)}</td>
                <td className="px-4 py-3 text-center font-bold">{row.inTransit}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.inTransitValue)}</td>
                <td className="px-4 py-3 text-center font-black">{row.olderThan7}</td>
                <td className="px-4 py-3 text-right font-black">{amount(row.olderThan7Value)}</td>
              </tr>
            ))}

            <tr className="border-t-2 bg-slate-900 text-white">
              <td className="px-4 py-4 font-black">TOTAL</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.totalParcels}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.totalValue)}</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.delivered}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.deliveredValue)}</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.dispatched}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.dispatchedValue)}</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.returned}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.returnedValue)}</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.inTransit}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.inTransitValue)}</td>
              <td className="px-4 py-4 text-center font-black">{report.summary.olderThan7}</td>
              <td className="px-4 py-4 text-right font-black">{amount(report.summary.olderThan7Value)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <OldOrdersBlock report={report} month={month} />
    </div>
  );
}

function OldOrdersBlock({ report, month }: { report: BaseReport; month: string }) {
  return (
    <div className="rounded-2xl border border-red-200 p-4">
      <div className="flex items-center justify-between gap-3">
      <h3 className="font-black text-red-800">
        7+ Days Old {report.deliveryFieldLabel} Orders: {report.oldOrders.length}
      </h3>
      <button
        type="button"
        onClick={() => exportOldOrders(report, month)}
        disabled={report.oldOrders.length === 0}
        className="h-10 rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-black text-red-700 disabled:opacity-50"
      >
        Export Excel
      </button>
    </div>

      <div className="mt-3 overflow-auto rounded-xl border">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-red-100">
            <tr>
              <th className="px-3 py-3 text-left">Order No</th>
              <th className="px-3 py-3 text-left">Date</th>
              <th className="px-3 py-3 text-center">Days</th>
              <th className="px-3 py-3 text-left">{report.deliveryFieldLabel}</th>
              <th className="px-3 py-3 text-left">Store</th>
              <th className="px-3 py-3 text-left">Customer</th>
              <th className="px-3 py-3 text-left">Phone</th>
              <th className="px-3 py-3 text-right">Value</th>
              <th className="px-3 py-3 text-left">Status</th>
            </tr>
          </thead>

          <tbody>
            {report.oldOrders.map((order) => (
              <tr key={order.id} className="border-t bg-red-50">
                <td className="px-3 py-3 font-black">{order.orderNo}</td>
                <td className="px-3 py-3">{order.despatchDate || "-"}</td>
                <td className="px-3 py-3 text-center font-black">{order.days}</td>
                <td className="px-3 py-3 font-bold">{order.courier}</td>
                <td className="px-3 py-3">{order.store}</td>
                <td className="px-3 py-3">{order.customer}</td>
                <td className="px-3 py-3">{order.phone}</td>
                <td className="px-3 py-3 text-right font-black">{amount(order.value)}</td>
                <td className="px-3 py-3">{order.status}</td>
              </tr>
            ))}

            {report.oldOrders.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center font-bold text-slate-500"
                >
                  No 7+ days old orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrandTotal({ summary }: { summary: Summary }) {
  return (
    <div className="rounded-3xl border-2 border-emerald-500 bg-emerald-50 p-5">
      <h2 className="text-2xl font-black text-emerald-900">
        Grand Total
      </h2>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card title="Parcels" value={summary.totalParcels} />
        <Card title="Value" value={amount(summary.totalValue)} />
        <Card title="Delivered" value={`${summary.delivered} / ${amount(summary.deliveredValue)}`} />
        <Card title="Dispatched" value={`${summary.dispatched} / ${amount(summary.dispatchedValue)}`} />
        <Card title="Returned" value={`${summary.returned} / ${amount(summary.returnedValue)}`} />
        <Card title="7+ Days" value={`${summary.olderThan7} / ${amount(summary.olderThan7Value)}`} />
      </div>
    </div>
  );
}

function Card({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-xs font-black uppercase text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}
