"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type SupplierLine = {
  id: string;
  _baseId: string;
  _tableName: string;
  fields: Record<string, any>;
};

function getPendingDays(line: SupplierLine) {
  const createdDate = line.fields["created Date"];
  if (!createdDate) return 0;

  const created = new Date(createdDate);
  const now = new Date();

  return Math.max(
    0,
    Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  );
}

function getPendingReason(line: SupplierLine) {
  const supplier = line.fields.Supplier || "Supplier";
  const billNo = String(line.fields.bill_no || "").toLowerCase();
  const received = String(line.fields.received_in_wh_1 || "").toLowerCase();

  if (billNo.includes("stock out") || billNo.includes("sold out") || billNo === "sold") {
    return "Marked Sold Out";
  }

  if (received !== "yes") {
    return `Pending from ${supplier}`;
  }

  return "Pending Dispatch";
}

function getAgeBucket(line: SupplierLine) {
  const days = getPendingDays(line);

  if (days > 30) return "30+ Days";
  if (days > 15) return "16-30 Days";
  if (days > 7) return "8-15 Days";
  if (days > 3) return "4-7 Days";

  return "0-3 Days";
}


function firstTextValue(value: any): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstTextValue(item);
      if (text) return text;
    }
    return "";
  }

  if (value && typeof value === "object") {
    return String(
      value.name ??
        value.value ??
        value.text ??
        value.label ??
        value.id ??
        ""
    ).trim();
  }

  return String(value ?? "").trim();
}

function getCustomerCity(line: SupplierLine) {
  return firstTextValue(
    line.fields["Customer City"] ??
      line.fields["Billing Address City"] ??
      line.fields["Shipping Address City"] ??
      line.fields["City Name"] ??
      line.fields.City ??
      ""
  );
}

function isIndiaDispatch(line: SupplierLine) {
  return getCustomerCity(line).trim().toLowerCase() === "india";
}

function getSupplierCode(line: SupplierLine) {
  const supplierName = String(line.fields.Supplier || "")
    .trim()
    .toLowerCase();

  if (supplierName !== "alv") return "";

  const rawValue =
    line.fields["Supplier Code"] ??
    line.fields["Supplier SKU"] ??
    line.fields["ALV Supplier Code"] ??
    "";

  if (Array.isArray(rawValue)) {
    return rawValue[0] ?? "";
  }

  return rawValue ?? "";
}

function getAgeRowClass(days: number, index: number) {
  if (days > 30) return "bg-slate-950 text-yellow-300 hover:bg-slate-900 [&>td]:!text-yellow-300";
  if (days > 15) return "bg-red-200 text-red-950 hover:bg-red-300";
  if (days > 7) return "bg-red-50 text-red-900 hover:bg-red-100";

  return index % 2 === 0 ? "bg-white" : "bg-slate-50";
}



export default function SuppliersPage() {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<SupplierLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectedLine, setSelectedLine] = useState<SupplierLine | null>(null);
 const supplierSummary = lines.reduce(
  (summary: Record<string, number>, line) => {
    const supplierName = line.fields.Supplier || "Unknown";
    const qty = Number(line.fields.quantity || 0);

    summary[supplierName] = (summary[supplierName] || 0) + qty;

    return summary;
  },
  {}
);
const olderThan7Qty = lines.reduce(
  (total, line) =>
    total + (getPendingDays(line) > 7 ? Number(line.fields.quantity || 0) : 0),
  0
);

const totalPendingQty = lines.reduce(
  (total, line) => total + Number(line.fields.quantity || 0),
  0
);

const totalOrdersCount = new Set(
  lines.map((line) => line.fields["Order Number"]?.[0]).filter(Boolean)
).size;

const ageSummary = lines.reduce(
  (summary: Record<string, number>, line) => {
    const bucket = getAgeBucket(line);
    summary[bucket] = (summary[bucket] || 0) + Number(line.fields.quantity || 0);
    return summary;
  },
  {}
);

  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [isSupplierUser, setIsSupplierUser] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [manualBillNo, setManualBillNo] = useState("");

  const canCustomizeBillNo = ["admin", "manager", "employee", "staff"].includes(
    currentUserRole.trim().toLowerCase()
  );

  async function loadUserSession() {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data.success) {
      const role = String(data.user?.role || "");
      setCurrentUserRole(role);
      const selectedBase = data.user?.selectedBase;
      const supplierCode = selectedBase?.supplierCode || data.user?.permissions?.[0]?.supplierCode || "";

      if (role === "Supplier" && supplierCode) {
        setIsSupplierUser(true);
        setSupplier(supplierCode);
        await loadSupplierOrders(supplierCode);
        return true;
      }
    }

    setIsSupplierUser(false);
    return false;
  }

  async function loadSuppliersOptions() {
    const res = await fetch(`/api/suppliers/options?t=${Date.now()}`, {
      cache: "no-store",
    });
    const data = await res.json();

    if (res.ok && data.success) {
      setSuppliers(data.suppliers || []);
    } else {
      alert(data.message || "Supplier options refresh failed");
    }
  }

  useEffect(() => {
    async function init() {
      const locked = await loadUserSession();

      if (!locked) {
        await loadSuppliersOptions();
      }
    }

    init();
  }, []);

  async function loadSupplierOrders(selectedSupplier: string) {
    setSupplier(selectedSupplier);
    setLoading(true);

    const res = await fetch(
      `/api/suppliers/orders?supplier=${encodeURIComponent(selectedSupplier)}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const data = await res.json();

    if (res.ok && data.success) {
      setLines(data.records || []);
      setSelectedRows([]);
    } else {
      setLines([]);
      alert(data.message || "Supplier orders failed");
    }

    setLoading(false);
  }

  async function updateLine(lineId: string, action: "dispatch" | "stock_out") {
    const line = lines.find((item) => item.id === lineId);

    if (!line?._baseId || !line?._tableName) {
      alert("Record source base/table information is missing.");
      return;
    }

    setUpdatingId(lineId);

    try {
      const res = await fetch("/api/suppliers/update-line", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lineId,
          action,
          baseId: line._baseId,
          tableName: line._tableName,
        }),
      });

      const responseText = await res.text();
      let data: any = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (res.ok && data?.success) {
        setLines((prev) => prev.filter((item) => item.id !== lineId));
        setSelectedRows((prev) => prev.filter((id) => id !== lineId));
      } else {
        alert(data?.message || "Update failed");
      }
    } catch (error) {
      console.error("Supplier line update failed:", error);
      alert("Supplier line update failed");
    } finally {
      setUpdatingId("");
    }
  }
async function bulkUpdate(action: "dispatch" | "stock_out") {
  if (selectedRows.length === 0) {
    alert("Please select at least one row.");
    return;
  }

  const confirmMessage =
    action === "dispatch"
      ? `Dispatch ${selectedRows.length} selected items?`
      : `Mark ${selectedRows.length} selected items as stock out?`;

  if (!confirm(confirmMessage)) return;

  setUpdatingId("bulk");

  const res = await fetch("/api/suppliers/bulk-update", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: lines
        .filter((line) => selectedRows.includes(line.id))
        .map((line) => ({
          lineId: line.id,
          baseId: line._baseId,
          tableName: line._tableName,
        })),
      action,
      manualBillNo:
        action === "dispatch" && canCustomizeBillNo
          ? manualBillNo.trim()
          : "",
    }),
  });

  const responseText = await res.text();
  let data: any = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = null;
  }

  if (res.ok && data?.success) {
    setLines((prev) => prev.filter((line) => !selectedRows.includes(line.id)));
    setSelectedRows([]);
    if (action === "dispatch") {
      setManualBillNo("");
    }
  } else {
    alert(data.message || "Bulk update failed");
  }

  setUpdatingId("");
}

function toggleRow(id: string) {
  setSelectedRows((prev) =>
    prev.includes(id)
      ? prev.filter((item) => item !== id)
      : [...prev, id]
  );
}

function toggleAllRows() {
  if (selectedRows.length === lines.length) {
    setSelectedRows([]);
  } else {
    setSelectedRows(lines.map((line) => line.id));
  }
}

function exportToExcel() {
  const rows = lines.map((line) => {
    const pendingDays = getPendingDays(line);

    return {
      "Order No": line.fields["Order Number"]?.[0] ?? "",
      Supplier: line.fields.Supplier ?? "",
      "Supplier Code": getSupplierCode(line),
      "Item Code": line.fields["Item Code"] ?? "",
      Qty: Number(line.fields.quantity || 0),
      "Customer City": getCustomerCity(line),
      "Dispatch Note": isIndiaDispatch(line) ? "Dispatch to India Address" : "",
      "Pending Days": pendingDays,
      "Age Bucket": getAgeBucket(line),
      "Created Date": line.fields["created Date"]
        ? new Date(line.fields["created Date"]).toLocaleString("en-GB")
        : "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 20 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Supplier Pending");
  XLSX.writeFile(workbook, `supplier-pending-${supplier || "all"}.xlsx`);
}

  return (
  <>
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">
          Supplier Orders
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Dispatch or stock out pending supplier order lines.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="mb-2 block text-sm font-bold text-slate-600">
          Select Supplier
        </label>

        <div className="flex items-center gap-3">
        {!isSupplierUser ? (
        <select
          value={supplier}
          onChange={(event) => loadSupplierOrders(event.target.value)}
          className="h-12 w-full max-w-md rounded-2xl border border-slate-300 bg-white px-4 font-bold outline-none focus:border-blue-500"
        >
          <option value="">Select supplier</option>
<option value="ALL">All Suppliers</option>
          {/* MYS-SUPPLIER-UNKNOWN-OPTION-V2 */}
          {!suppliers.some(
            (item) => item.trim().toLowerCase() === "unknown supplier"
          ) && (
            <option value="Unknown Supplier">Unknown Supplier</option>
          )}

          {suppliers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        ) : (
          <div className="flex h-12 w-full max-w-md items-center rounded-2xl border border-slate-300 bg-slate-100 px-4 font-black">
            {supplier || "Supplier"}
          </div>
        )}

        <button
          type="button"
          onClick={async () => {
            if (!isSupplierUser) {
              await loadSuppliersOptions();
            }

            if (supplier) {
              await loadSupplierOrders(supplier);
            }
          }}
          disabled={loading}
          className="h-12 rounded-2xl border border-blue-300 bg-blue-50 px-5 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        </div>
      </div>

{lines.length > 0 && (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="mb-4 text-sm font-black text-slate-600">
      Supplier Pending Summary
    </p>

    <div className="flex flex-wrap gap-3">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-slate-900">Total Pending</p>
        <p className="text-2xl font-black text-blue-600">Qty: {totalPendingQty}</p>
      </div>

      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-red-800">Older Than 7 Days</p>
        <p className="text-2xl font-black text-red-600">Qty: {olderThan7Qty}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-slate-900">Order Count</p>
        <p className="text-2xl font-black text-slate-700">{totalOrdersCount}</p>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-emerald-800">0-3 Days</p>
        <p className="text-2xl font-black text-emerald-700">Qty: {ageSummary["0-3 Days"] || 0}</p>
      </div>

      <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-yellow-800">4-7 Days</p>
        <p className="text-2xl font-black text-yellow-700">Qty: {ageSummary["4-7 Days"] || 0}</p>
      </div>

      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-left">
        <p className="text-sm font-black text-orange-800">8-15 Days</p>
        <p className="text-2xl font-black text-orange-700">Qty: {ageSummary["8-15 Days"] || 0}</p>
      </div>

      <div className="rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-left">
        <p className="text-sm font-black text-red-900">16-30 Days</p>
        <p className="text-2xl font-black text-red-800">Qty: {ageSummary["16-30 Days"] || 0}</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-left">
        <p className="text-sm font-black text-white">30+ Days</p>
        <p className="text-2xl font-black text-white">Qty: {ageSummary["30+ Days"] || 0}</p>
      </div>

      {supplier === "ALL" && (
  <button
    type="button"
    className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-left"
  >
    <p className="text-sm font-black text-slate-900">ALL</p>
    <p className="text-2xl font-black text-blue-600">
      Qty:{" "}
      {lines.reduce(
        (total, line) => total + Number(line.fields.quantity || 0),
        0
      )}
    </p>
  </button>
)}
      {Object.entries(supplierSummary)
  .sort((a, b) => b[1] - a[1])
  .map(([name, count]) => (
        <button
          key={name}
          type="button"
          onClick={() => loadSupplierOrders(name)}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-blue-50"
        >
          <p className="text-sm font-black text-slate-900">{name}</p>
          <p className="text-2xl font-black text-blue-600">
  Qty: {count}
</p>
        </button>
      ))}
    </div>
  </div>
)}
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">
            {supplier ? `${supplier} Pending Lines: ${lines.length}` : "Select a supplier"}
          </p>

          {loading && (
            <p className="text-sm font-black text-blue-600">Loading...</p>
          )}
        </div>
{lines.length > 0 && (
  <div className="mb-4 flex flex-wrap items-center gap-2">
    <button
  type="button"
  onClick={() => loadSupplierOrders(supplier)}
  disabled={!supplier || loading}
  className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
>
  {loading ? "Refreshing..." : "Refresh"}
</button>
    <button
      type="button"
      onClick={exportToExcel}
      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black hover:bg-slate-50"
    >
      Export Excel
    </button>

    {canCustomizeBillNo && (
      <div className="min-w-[240px]">
        <label className="mb-1 block text-xs font-black text-slate-600">
          Manual Bill Number (Optional)
        </label>
        <input
          type="text"
          value={manualBillNo}
          onChange={(event) => setManualBillNo(event.target.value)}
          placeholder="Blank = automatic bill number"
          disabled={updatingId === "bulk"}
          className="h-10 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-black text-slate-900 outline-none focus:border-amber-500 disabled:opacity-50"
        />
      </div>
    )}

    <button
      type="button"
      onClick={() => bulkUpdate("dispatch")}
      disabled={selectedRows.length === 0 || updatingId === "bulk"}
      className="rounded-xl border border-green-700 bg-green-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
    >
      Dispatch Selected ({selectedRows.length})
    </button>

    <button
    type="button"
      onClick={() => bulkUpdate("stock_out")}
      disabled={selectedRows.length === 0 || updatingId === "bulk"}
      className="rounded-xl border border-red-700 bg-red-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
    >
      Stock Out Selected ({selectedRows.length})
    </button>
  </div>
)}
        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <thead className="bg-slate-200 text-slate-900">
              <tr>
                <th className="px-4 py-4 text-left">
                  <input
  onClick={(e) => e.stopPropagation()}
                    type="checkbox"
                    checked={lines.length > 0 && selectedRows.length === lines.length}
                    onChange={toggleAllRows}
                  />
                </th>
                <th className="px-4 py-4 text-left">Image</th>
                <th className="px-4 py-4 text-left">Order No</th>
                <th className="px-4 py-4 text-left">Created Date</th>
                <th className="px-4 py-4 text-center">Pending Days</th>
                <th className="px-4 py-4 text-left">Age Bucket</th>
                <th className="px-4 py-4 text-left">Item Code</th>
                <th className="px-4 py-4 text-left">Supplier</th>
                <th className="px-4 py-4 text-left">Supplier Code</th>
                <th className="px-4 py-4 text-center">Qty</th>
                <th className="px-4 py-4 text-left">Dispatch Note</th>
                <th className="px-4 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {lines.map((line, index) => {
                const imageValue = line.fields.image?.[0];
const imageUrl = Array.isArray(imageValue)
  ? imageValue[0]?.url
  : imageValue?.url;

const itemCode = line.fields["Item Code"] ?? "-";
const qty = line.fields.quantity ?? "-";
const orderNo = line.fields["Order Number"]?.[0] ?? "-";
const pendingDays = getPendingDays(line);
const ageBucket = getAgeBucket(line);
const supplierCode = getSupplierCode(line);
const customerCity = getCustomerCity(line);
const dispatchToIndia = isIndiaDispatch(line);

                return (
                  <tr
  key={line.id}
  onClick={() => setSelectedLine(line)}
  className={`cursor-pointer border-t ${getAgeRowClass(pendingDays, index)}`}
>
                    <td className="px-4 py-3">
                      <input
  onClick={(e) => e.stopPropagation()}
                        type="checkbox"
                        checked={selectedRows.includes(line.id)}
                        onChange={() => toggleRow(line.id)}
                      />
                    </td>

                    <td className="px-4 py-3">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={itemCode}
                          className="h-16 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-400">
                          No Img
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 font-black text-slate-900">
                      {orderNo}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-600">
  {line.fields["created Date"]
    ? new Date(line.fields["created Date"]).toLocaleString("en-GB")
    : "-"}
</td>

                    <td className={`px-4 py-3 text-center font-black ${
                      pendingDays > 7 ? "text-red-700" : "text-slate-800"
                    }`}>
                      {pendingDays}
                    </td>

                    <td className="px-4 py-3 font-black">
                      {ageBucket}
                    </td>

                    <td className="px-4 py-3 font-bold text-slate-800">
                      {itemCode}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">
  {line.fields.Supplier ?? "-"}
</td>

                    <td className="px-4 py-3 font-bold text-slate-800">
                      {supplierCode || "-"}
                    </td>

                    <td className="px-4 py-3 text-center font-black">
                      {qty}
                    </td>

                    <td className="px-4 py-3">
                      {dispatchToIndia ? (
                        <div className="inline-flex flex-col rounded-xl border-2 border-red-600 bg-red-50 px-3 py-2 text-left shadow-sm">
                          <span className="text-sm font-black uppercase text-red-700">
                            Dispatch to India Address
                          </span>
                          <span className="mt-0.5 text-xs font-bold text-red-600">
                            City: {customerCity || "India"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={updatingId === line.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateLine(line.id, "dispatch");
                          }}
                          style={{
                            background: "#16a34a",
                            color: "#ffffff",
                            height: "40px",
                            padding: "0 14px",
                            borderRadius: "10px",
                            fontWeight: 900,
                            opacity: updatingId === line.id ? 0.6 : 1,
                          }}
                        >
                          Dispatch
                        </button>

                        <button
                          type="button"
                          disabled={updatingId === line.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateLine(line.id, "stock_out");
                          }}
                          style={{
                            background: "#dc2626",
                            color: "#ffffff",
                            height: "40px",
                            padding: "0 14px",
                            borderRadius: "10px",
                            fontWeight: 900,
                            opacity: updatingId === line.id ? 0.6 : 1,
                          }}
                        >
                          Stock Out
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && lines.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    {supplier
                      ? "No pending lines found."
                      : "Select a supplier to load orders."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    {selectedLine && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    onClick={() => setSelectedLine(null)}
  >
    <div
      className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl bg-white p-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-black">
          {selectedLine.fields["Item Code"]}
        </h2>

        <button
          onClick={() => setSelectedLine(null)}
          className="rounded-xl bg-red-500 px-4 py-2 font-bold text-white"
        >
          ✕
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <img
            src={selectedLine.fields.image?.[0]?.url}
            alt=""
            className="w-full rounded-2xl border"
          />
        </div>

        <div className="space-y-4">

          <div>
            <p className="text-xs font-bold text-slate-500">Order No</p>
            <p className="text-xl font-black">
              {selectedLine.fields["Order Number"]?.[0]}
            </p>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500">Supplier</p>
            <p className="text-xl font-black">
              {selectedLine.fields.Supplier}
            </p>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500">Supplier Code</p>
            <p className="text-xl font-black">
              {getSupplierCode(selectedLine) || "-"}
            </p>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500">Quantity</p>
            <p className="text-xl font-black">
              {selectedLine.fields.quantity}
            </p>
          </div>

          {isIndiaDispatch(selectedLine) && (
            <div className="rounded-2xl border-2 border-red-600 bg-red-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-red-600">
                Dispatch Instruction
              </p>
              <p className="mt-1 text-xl font-black uppercase text-red-700">
                Dispatch to India Address
              </p>
              <p className="mt-1 text-sm font-bold text-red-600">
                City: {getCustomerCity(selectedLine) || "India"}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-slate-500">Created Date</p>
            <p className="text-xl font-black">
              {selectedLine.fields["created Date"]
                ? new Date(
                    selectedLine.fields["created Date"]
                  ).toLocaleString("en-GB")
                : "-"}
            </p>
          </div>

        </div>
      </div>
    </div>
  </div>
  
)}
  </>
  );
}