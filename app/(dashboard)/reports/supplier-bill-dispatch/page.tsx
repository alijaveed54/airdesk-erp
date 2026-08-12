"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type BillOption = {
  billNo: string;
  pcs: number;
  lines: number;
};

type DispatchRow = {
  id: string;
  recordId: string;
  source: string;
  supplier: string;
  billNo: string;
  orderNo: string;
  sku: string;
  qty: number;
  dispatchDateTime: string;
  receivedInUaeDateTime: string;
  orderDate: string;
  status: string;
  receivedInUae: string;
};

type Summary = {
  totalOrders: number;
  totalLines: number;
  totalPcs: number;
  receivedLines: number;
};

type ReceiveAction = "receive" | "undo" | "arq";

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  totalLines: 0,
  totalPcs: 0,
  receivedLines: 0,
};

function formatDateTime(value: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function compareDispatchRows(first: DispatchRow, second: DispatchRow) {
  const firstOrderNo = String(first.orderNo || "").trim();
  const secondOrderNo = String(second.orderNo || "").trim();

  if (!firstOrderNo && secondOrderNo) return 1;
  if (firstOrderNo && !secondOrderNo) return -1;

  const orderComparison = firstOrderNo.localeCompare(
    secondOrderNo,
    "en",
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (orderComparison !== 0) {
    return orderComparison;
  }

  const skuComparison = String(first.sku || "").localeCompare(
    String(second.sku || ""),
    "en",
    {
      numeric: true,
      sensitivity: "base",
    },
  );

  if (skuComparison !== 0) {
    return skuComparison;
  }

  return first.id.localeCompare(second.id);
}

function isReceived(value: string) {
  return value.trim().toLowerCase() === "yes";
}

function pcs(rows: DispatchRow[]) {
  return rows.reduce(
    (sum, row) => sum + Number(row.qty || 0),
    0,
  );
}

export default function SupplierBillDispatchReportPage() {
  const [supplier, setSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [summary, setSummary] =
    useState<Summary>(EMPTY_SUMMARY);
  const [selectedRowIds, setSelectedRowIds] =
    useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingAction, setUpdatingAction] =
    useState<ReceiveAction | "">("");

  const updating = updatingAction !== "";

  async function loadReport(
    nextSupplier = supplier,
    nextBillNo = billNo,
    preserveSelection = true,
  ) {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (nextSupplier) {
        params.set("supplier", nextSupplier);
      }
      if (nextBillNo) {
        params.set("billNo", nextBillNo);
      }

      const response = await fetch(
        `/api/reports/supplier-bill-dispatch?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Report load failed",
        );
      }

      const nextRows = [
        ...((data.rows || []) as DispatchRow[]),
      ].sort(compareDispatchRows);

      setSuppliers(data.suppliers || []);
      setBills(data.bills || []);
      setRows(nextRows);
      setSummary(data.summary || EMPTY_SUMMARY);

      setSelectedRowIds((current) => {
        if (!preserveSelection) return [];

        const validIds = new Set(
          nextRows.map((row) => row.id),
        );

        return current.filter((id) =>
          validIds.has(id),
        );
      });
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Report load failed",
      );
      setRows([]);
      setSelectedRowIds([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport("", "", false);
  }, []);

  async function handleSupplierChange(value: string) {
    setSupplier(value);
    setBillNo("");
    setRows([]);
    setSelectedRowIds([]);
    setSummary(EMPTY_SUMMARY);
    await loadReport(value, "", false);
  }

  async function handleBillChange(value: string) {
    setBillNo(value);
    setSelectedRowIds([]);
    await loadReport(supplier, value, false);
  }

  const selectedRows = useMemo(() => {
    const selected = new Set(selectedRowIds);

    return rows.filter((row) =>
      selected.has(row.id),
    );
  }, [rows, selectedRowIds]);

  const selectedPendingRows = useMemo(
    () =>
      selectedRows.filter(
        (row) => !isReceived(row.receivedInUae),
      ),
    [selectedRows],
  );

  const selectedReceivedRows = useMemo(
    () =>
      selectedRows.filter((row) =>
        isReceived(row.receivedInUae),
      ),
    [selectedRows],
  );

  const selectedPcs = pcs(selectedRows);
  const selectedPendingPcs = pcs(selectedPendingRows);
  const selectedReceivedPcs = pcs(selectedReceivedRows);

  const allRowsSelected =
    rows.length > 0 &&
    rows.every((row) =>
      selectedRowIds.includes(row.id),
    );

  function toggleRow(rowId: string) {
    setSelectedRowIds((current) =>
      current.includes(rowId)
        ? current.filter((id) => id !== rowId)
        : [...current, rowId],
    );
  }

  function toggleAllRows() {
    setSelectedRowIds(
      allRowsSelected
        ? []
        : rows.map((row) => row.id),
    );
  }

  function selectPendingRows() {
    setSelectedRowIds(
      rows
        .filter(
          (row) =>
            !isReceived(row.receivedInUae),
        )
        .map((row) => row.id),
    );
  }

  function selectReceivedRows() {
    setSelectedRowIds(
      rows
        .filter((row) =>
          isReceived(row.receivedInUae),
        )
        .map((row) => row.id),
    );
  }

  async function updateSelectedReceipt(
    action: ReceiveAction,
  ) {
    if (!supplier || !billNo) return;

    const targetRows =
      action === "receive"
        ? selectedPendingRows
        : selectedReceivedRows;

    if (targetRows.length === 0) {
      alert(
        action === "receive"
          ? "Select at least one pending item line."
          : "Select at least one received item line.",
      );
      return;
    }

    const targetPcs = pcs(targetRows);
    const confirmed = window.confirm(
      action === "receive"
        ? `Mark ${targetRows.length} selected item line(s), totaling ${targetPcs} PCS, as received? Only the selected records will be updated.`
        : `Undo receipt for ${targetRows.length} selected item line(s), totaling ${targetPcs} PCS? Only the selected records will be cleared.`,
    );

    if (!confirmed) return;

    setUpdatingAction(action);

    try {
      const response = await fetch(
        "/api/reports/supplier-bill-dispatch",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supplier,
            billNo,
            action,
            selections: targetRows.map((row) => ({
              source: row.source,
              recordId: row.recordId,
            })),
          }),
        },
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            (action === "receive"
              ? "Unable to receive selected items"
              : "Unable to undo selected items"),
        );
      }

      if (data.updatedRecords > 0) {
        alert(
          action === "receive"
            ? `${data.updatedRecords} selected item line(s) marked Received In UAE = Yes with the current date and time.`
            : `${data.updatedRecords} selected item line(s) cleared. Received In UAE and Received In UAE DateTime are now blank.`,
        );
      } else {
        alert(
          data.message ||
            "No selected item lines required an update.",
        );
      }

      setSelectedRowIds([]);
      await loadReport(
        supplier,
        billNo,
        false,
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : action === "receive"
            ? "Unable to receive selected items"
            : "Unable to undo selected items",
      );
    } finally {
      setUpdatingAction("");
    }
  }
async function updateARQ() {

  if (!supplier || !billNo) return;


  if (selectedRows.length === 0) {

    alert("Select at least one item line.");

    return;

  }


  const confirmed = window.confirm(
    `Add ${selectedRows.length} selected item line(s) to ARQ?`
  );


  if (!confirmed) return;


  setUpdatingAction("arq");


  try {

    const response = await fetch(
      "/api/reports/supplier-bill-dispatch",
      {
        method: "PATCH",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({

          supplier,

          billNo,

          action: "arq",

          selections: selectedRows.map((row) => ({

            source: row.source,

            recordId: row.recordId,

          })),

        }),

      }
    );


    const data = await response.json();



    if (!response.ok || !data.success) {

      throw new Error(
        data.message || "Unable to add ARQ"
      );

    }



    alert(
      `${data.updatedRecords} selected item line(s) added to ARQ`
    );


    setSelectedRowIds([]);


    await loadReport(
      supplier,
      billNo,
      false
    );


  } catch (error) {


    alert(
      error instanceof Error
        ? error.message
        : "ARQ failed"
    );


  } finally {


    setUpdatingAction("");

  }

}
  const selectedBill = useMemo(
    () =>
      bills.find(
        (bill) => bill.billNo === billNo,
      ),
    [bills, billNo],
  );

  function exportExcel() {
    if (rows.length === 0) {
      alert(
        "Please select a bill number first.",
      );
      return;
    }

    const exportRows = rows.map((row) => ({
      Selected: selectedRowIds.includes(row.id)
        ? "Yes"
        : "No",
      Supplier: row.supplier,
      "Bill No": row.billNo,
      "Order No": row.orderNo,
      SKU: row.sku,
      Qty: row.qty,
      "Received In UAE":
        row.receivedInUae || "-",
      "Received In UAE Date & Time":
        formatDateTime(
          row.receivedInUaeDateTime,
        ),
      "Dispatch Date & Time":
        formatDateTime(row.dispatchDateTime),
      "Order Date": row.orderDate || "-",
      Source: row.source,
    }));

    const worksheet =
      XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 8 },
      { wch: 18 },
      { wch: 26 },
      { wch: 24 },
      { wch: 14 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Bill Dispatch",
    );
    XLSX.writeFile(
      workbook,
      `Supplier_Bill_${billNo.replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      )}.xlsx`,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">
          Supplier Bill Dispatch Report
        </h1>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Select only the item lines actually received. Receive and Undo actions apply only to selected rows.
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
              onChange={(event) =>
                void handleSupplierChange(
                  event.target.value,
                )
              }
              disabled={loading || updating}
              className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">
                Select Supplier
              </option>
              {suppliers.map((name) => (
                <option
                  key={name}
                  value={name}
                >
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
              onChange={(event) =>
                void handleBillChange(
                  event.target.value,
                )
              }
              disabled={
                !supplier ||
                loading ||
                updating
              }
              className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:opacity-60"
            >
              <option value="">
                {supplier
                  ? "Select Bill Number"
                  : "Select Supplier First"}
              </option>
              {bills.map((bill) => (
                <option
                  key={bill.billNo}
                  value={bill.billNo}
                >
                  {bill.billNo} ({bill.pcs} PCS)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() =>
                void loadReport()
              }
              disabled={loading || updating}
              className="h-12 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
            >
              {loading
                ? "Loading..."
                : "Refresh"}
            </button>

            <button
              type="button"
              onClick={() =>
                void updateSelectedReceipt(
                  "receive",
                )
              }
              disabled={
                !billNo ||
                updating ||
                selectedPendingRows.length === 0
              }
              className="h-12 rounded-xl bg-violet-600 px-5 font-black text-white disabled:opacity-40"
            >
              {updatingAction === "receive"
                ? "Receiving..."
                : `Receive Selected (${selectedPendingPcs} PCS)`}
            </button>

            <button
              type="button"
              onClick={() =>
                void updateSelectedReceipt("undo")
              }
              disabled={
                !billNo ||
                updating ||
                selectedReceivedRows.length === 0
              }
              className="h-12 rounded-xl bg-red-600 px-5 font-black text-white disabled:opacity-40"
            >
              {updatingAction === "undo"
                ? "Undoing..."
                : `Undo Selected (${selectedReceivedPcs} PCS)`}
            </button>
<button
  type="button"
  onClick={() =>
    void updateARQ()
  }
  disabled={
    !billNo ||
    updating ||
    selectedRows.length === 0
  }
  className="h-12 rounded-xl bg-blue-700 px-5 font-black text-white disabled:opacity-40"
>
  {updatingAction === "arq"
    ? "Adding ARQ..."
    : `ARQ (${selectedRows.length})`}
</button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={
                rows.length === 0 || updating
              }
              className="h-12 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-40"
            >
              Excel
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              disabled={
                rows.length === 0 || updating
              }
              className="h-12 rounded-xl bg-slate-900 px-5 font-black text-white disabled:opacity-40"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {billNo && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <SummaryCard
              label="Supplier"
              value={supplier || "-"}
            />
            <SummaryCard
              label="Bill Number"
              value={`${billNo}${
                selectedBill
                  ? ` (${selectedBill.pcs} PCS)`
                  : ""
              }`}
            />
            <SummaryCard
              label="Total Orders"
              value={summary.totalOrders}
            />
            <SummaryCard
              label="Total PCS"
              value={summary.totalPcs}
            />
            <SummaryCard
              label="Received Lines"
              value={`${summary.receivedLines}/${summary.totalLines}`}
            />
            <SummaryCard
              label="Selected"
              value={`${selectedRows.length} lines / ${selectedPcs} PCS`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3">
            <span className="text-xs font-black uppercase text-blue-700">
              Quick Selection
            </span>

            <button
              type="button"
              onClick={selectPendingRows}
              disabled={
                updating ||
                rows.every((row) =>
                  isReceived(
                    row.receivedInUae,
                  ),
                )
              }
              className="h-9 rounded-xl border border-violet-200 bg-white px-3 text-xs font-black text-violet-700 disabled:opacity-40"
            >
              Select Pending
            </button>

            <button
              type="button"
              onClick={selectReceivedRows}
              disabled={
                updating ||
                !rows.some((row) =>
                  isReceived(
                    row.receivedInUae,
                  ),
                )
              }
              className="h-9 rounded-xl border border-red-200 bg-white px-3 text-xs font-black text-red-700 disabled:opacity-40"
            >
              Select Received
            </button>

            <button
              type="button"
              onClick={() =>
                setSelectedRowIds([])
              }
              disabled={
                updating ||
                selectedRowIds.length === 0
              }
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 disabled:opacity-40"
            >
              Clear Selection
            </button>

            <p className="ml-auto text-xs font-bold text-blue-700">
              Receive: {selectedPendingRows.length} lines /{" "}
              {selectedPendingPcs} PCS · Undo:{" "}
              {selectedReceivedRows.length} lines /{" "}
              {selectedReceivedPcs} PCS
            </p>
          </div>
        </>
      )}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-black text-slate-900">
            Dispatched Orders
          </h2>
          <p className="text-xs font-bold text-slate-500">
            {billNo
              ? `${summary.totalLines} item line(s) found — tick only the items physically received`
              : "Select supplier and bill number to load orders"}
          </p>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead className="bg-slate-200 text-slate-900">
              <tr>
                <th className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allRowsSelected}
                    onChange={toggleAllRows}
                    disabled={
                      rows.length === 0 ||
                      updating
                    }
                    title="Select all rows"
                    className="h-4 w-4 rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left">
                  Order No ↑
                </th>
                <th className="px-4 py-3 text-left">
                  SKU
                </th>
                <th className="px-4 py-3 text-center">
                  Qty
                </th>
                <th className="px-4 py-3 text-left">
                  Received In UAE
                </th>
                <th className="px-4 py-3 text-left">
                  Received Date & Time
                </th>
                <th className="px-4 py-3 text-left">
                  Dispatch Date & Time
                </th>
                <th className="px-4 py-3 text-left">
                  Order Date
                </th>
                <th className="px-4 py-3 text-left">
                  Source
                </th>
                <th className="px-4 py-3 text-left">
                  Status
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => {
                const selected =
                  selectedRowIds.includes(row.id);

                return (
                  <tr
                    key={row.id}
                    className={[
                      "border-t hover:bg-blue-50",
                      selected
                        ? "bg-blue-50"
                        : index % 2 === 0
                          ? "bg-white"
                          : "bg-slate-50",
                    ].join(" ")}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          toggleRow(row.id)
                        }
                        disabled={updating}
                        aria-label={`Select ${row.orderNo || row.sku}`}
                        className="h-4 w-4 rounded"
                      />
                    </td>

                    <td className="px-4 py-3 font-black text-slate-900">
                      {row.orderNo || "-"}
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-700">
                      {row.sku || "-"}
                    </td>

                    <td className="px-4 py-3 text-center font-black">
                      {row.qty}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          isReceived(
                            row.receivedInUae,
                          )
                            ? "bg-violet-100 text-violet-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.receivedInUae || "No"}
                      </span>
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-700">
                      {formatDateTime(
                        row.receivedInUaeDateTime,
                      )}
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-700">
                      {formatDateTime(
                        row.dispatchDateTime,
                      )}
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-600">
                      {row.orderDate || "-"}
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-700">
                      {row.source}
                    </td>

                    <td className="px-4 py-3">
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                        {row.status ||
                          "Dispatched"}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >
                    {billNo
                      ? "No dispatched orders found for this bill."
                      : "Select a supplier and bill number."}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >
                    Loading supplier bill details...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-800">
        Selection works per Airtable item line. If one single row has Qty 10,
        its Received In UAE status applies to the whole row; receiving only 9
        from that one row requires a separate received-quantity workflow.
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
      <p className="mt-1 break-words text-xl font-black text-slate-900">
        {value}
      </p>
    </div>
  );
}
