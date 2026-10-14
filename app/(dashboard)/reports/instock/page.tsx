"use client";

import { useEffect, useState, useMemo } from "react";
import * as XLSX from "xlsx";

type InstockItem = {
  id: string;
  _baseId: string;
  _tableName: string;
  orderNo: string;
  customerName: string;
  sku: string;
  quantity: number;
  orderStatus: string;
  imageUrl: string;
  supplier: string;
  createdDate: string;
};

export default function InstockReportPage() {
  const [items, setItems] = useState<InstockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sendingId, setSendingId] = useState<string>("");
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});

  // Filters
  const [orderNoFilter, setOrderNoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");

  // Load sent history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("instock_whatsapp_sent_records");
      if (saved) {
        setSentMap(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Local storage error", e);
    }
  }, []);

  function markRecordsAsSent(recordIds: string[]) {
    setSentMap((prev) => {
      const updated = { ...prev };
      recordIds.forEach((id) => {
        updated[id] = true;
      });
      try {
        localStorage.setItem(
          "instock_whatsapp_sent_records",
          JSON.stringify(updated)
        );
      } catch (e) {
        console.error("Local storage save error", e);
      }
      return updated;
    });
  }

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/instock?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setItems(data.records || []);
      } else {
        alert(data.message || "Failed to load in-stock report");
      }
    } catch {
      alert("Error loading in-stock report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Filtered dataset
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchOrder =
        !orderNoFilter ||
        item.orderNo.toLowerCase().includes(orderNoFilter.trim().toLowerCase());
      const matchSku =
        !skuFilter ||
        item.sku.toLowerCase().includes(skuFilter.trim().toLowerCase());
      const matchStatus =
        !statusFilter ||
        item.orderStatus.toLowerCase() === statusFilter.toLowerCase();

      return matchOrder && matchSku && matchStatus;
    });
  }, [items, orderNoFilter, skuFilter, statusFilter]);

  // Unique statuses for dropdown
  const statusOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.orderStatus).filter(Boolean));
    return Array.from(set);
  }, [items]);

  // WhatsApp Sender
  async function sendToWhatsApp(targetItems: InstockItem[], senderKey: string) {
    if (targetItems.length === 0) {
      alert("No items selected to send.");
      return;
    }

    setSendingId(senderKey);

    try {
      const res = await fetch("/api/suppliers/share-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: targetItems.map((item) => ({
            lineId: item.id,
            baseId: item._baseId,
            tableName: item._tableName,
          })),
        }),
      });

      const data = await res.json();

      if (res.ok && data?.success) {
        markRecordsAsSent(targetItems.map((i) => i.id));
        alert(
          `WhatsApp sent successfully! Total: ${data.sent || targetItems.length}`
        );
      } else {
        alert(data?.message || "WhatsApp sending failed.");
      }
    } catch (err) {
      console.error(err);
      alert("Error sending to WhatsApp.");
    } finally {
      setSendingId("");
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map((i) => i.id));
    }
  }

  function exportExcel() {
    const rows = filteredItems.map((item) => ({
      "Order No": item.orderNo,
      "Customer Name": item.customerName || "-",
      SKU: item.sku,
      Quantity: item.quantity,
      "Order Status": item.orderStatus,
      "WhatsApp Sent": sentMap[item.id] ? "Yes" : "No",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "In Stock Items");
    XLSX.writeFile(workbook, `instock-report-${Date.now()}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900">
            In-Stock Items Report
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time verified in-stock items ready for dispatch sharing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={exportExcel}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700 hover:bg-slate-50"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Filter Box */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">
          Search & Filters
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              Filter by Order No
            </label>
            <input
              type="text"
              value={orderNoFilter}
              onChange={(e) => setOrderNoFilter(e.target.value)}
              placeholder="Search Order No..."
              className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              Filter by SKU
            </label>
            <input
              type="text"
              value={skuFilter}
              onChange={(e) => setSkuFilter(e.target.value)}
              placeholder="Search SKU..."
              className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              Filter by Order Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white"
            >
              <option value="">All Statuses</option>
              {statusOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Clear Filters */}
        {(orderNoFilter || skuFilter || statusFilter) && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => {
                setOrderNoFilter("");
                setSkuFilter("");
                setStatusFilter("");
              }}
              className="text-xs font-black text-red-600 hover:underline"
            >
              Clear All Filters
            </button>
          </div>
        )}
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-slate-800">
            Total Items: {filteredItems.length}
          </span>
          {selectedIds.length > 0 && (
            <span className="rounded-lg bg-blue-100 px-2 py-0.5 text-xs font-black text-blue-700">
              {selectedIds.length} Selected
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={
              filteredItems.length === 0 || Boolean(sendingId) || loading
            }
            onClick={() => {
              const target =
                selectedIds.length > 0
                  ? filteredItems.filter((i) => selectedIds.includes(i.id))
                  : filteredItems;
              sendToWhatsApp(target, "bulk");
            }}
            className="rounded-xl border border-emerald-700 bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {sendingId === "bulk"
              ? "Sending to WhatsApp..."
              : selectedIds.length > 0
              ? `WhatsApp Selected (${selectedIds.length})`
              : `WhatsApp All (${filteredItems.length})`}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                <th className="w-12 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={
                      filteredItems.length > 0 &&
                      selectedIds.length === filteredItems.length
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th className="w-20 px-4 py-4 text-left">Image</th>
                <th className="px-4 py-4 text-left">Order No</th>
                <th className="px-4 py-4 text-left">Customer Name</th>
                <th className="px-4 py-4 text-left">SKU</th>
                <th className="px-4 py-4 text-center">Quantity</th>
                <th className="px-4 py-4 text-left">Order Status</th>
                <th className="px-4 py-4 text-center">Sent Status</th>
                <th className="px-4 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => {
                const isSent = Boolean(sentMap[item.id]);

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50 ${
                      isSent ? "bg-emerald-50/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleRow(item.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.sku}
                          className="h-16 w-12 rounded-lg border object-cover shadow-xs"
                        />
                      ) : (
                        <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-400">
                          No Img
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-black text-slate-900">
                      {item.orderNo}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">
                      {item.customerName || "-"}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-800">
                      {item.sku}
                    </td>
                    <td className="px-4 py-3 text-center font-black text-slate-900">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-600">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs">
                        {item.orderStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isSent ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                          ✓ Sent
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">
                          Unsent
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={Boolean(sendingId)}
                        onClick={() => sendToWhatsApp([item], item.id)}
                        className={`h-9 rounded-lg border px-3 text-xs font-black transition-colors ${
                          isSent
                            ? "border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700"
                        } disabled:opacity-50`}
                      >
                        {sendingId === item.id
                          ? "Sending..."
                          : isSent
                          ? "Resend WhatsApp"
                          : "Send WhatsApp"}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="py-12 text-center font-bold text-slate-400"
                  >
                    No in-stock records found matching filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}