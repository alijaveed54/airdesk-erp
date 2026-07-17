"use client";

import OrderDetailsModal from "@/components/orders/OrderDetailsModal";
import type { OrderRecord } from "@/types/order";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type UpdateField = "status" | "courier";

type Filters = {
  customer: string;
  phone: string;
  store: string;
  status: string;
  courier: string;
  dateFrom: string;
  dateTo: string;
};

function getCustomerName(order: OrderRecord) {
  return order.fields.Consignee?.[0] ?? "-";
}

function getPhone(order: OrderRecord) {
  return order.fields.Telephone1 ?? "-";
}

function getOrderNo(order: OrderRecord) {
  return order.fields["order_no."] ?? "-";
}

function getStore(order: OrderRecord) {
  return order.fields["Select Store"] ?? "-";
}

function getTotal(order: OrderRecord) {
  return Number(order.fields.total_order_value ?? 0);
}

function getCurrency(order: OrderRecord) {
  return String(order.fields.__currency || "AED");
}

function getSource(order: OrderRecord) {
  return String(order.fields.__source || "");
}

function getOrderDate(order: OrderRecord) {
  return order.fields.date
    ? new Date(order.fields.date).toLocaleDateString("en-GB")
    : "-";
}

const emptyFilters: Filters = {
  customer: "",
  phone: "",
  store: "",
  status: "",
  courier: "",
  dateFrom: "",
  dateTo: "",
};

export default function OrdersListPage() {
  const router = useRouter();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [courierOptions, setCourierOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [nextOffset, setNextOffset] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [bulkCourier, setBulkCourier] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [downloadingDriverSheet, setDownloadingDriverSheet] = useState(false);
  const [baseName, setBaseName] = useState("");
  const [capabilities, setCapabilities] = useState({
    hasStore: true,
    hasStatus: true,
    hasCourier: true,
    canUpdateStatus: true,
    canUpdateCourier: true,
  });

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);

      const params = new URLSearchParams();

      if (appliedSearch.trim()) {
        params.set("q", appliedSearch.trim());
      }

      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      });

      const query = params.toString();
      const res = await fetch(`/api/orders/list${query ? `?${query}` : ""}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setOrders(data.records || []);
        setNextOffset(data.nextOffset || "");
        setSelectedRows([]);
        setStatusOptions(data.statusOptions || []);
        setCourierOptions(data.courierOptions || []);
        setBaseName(data.baseName || "");
        setCapabilities(
          data.capabilities || {
            hasStore: true,
            hasStatus: true,
            hasCourier: true,
            canUpdateStatus: true,
            canUpdateCourier: true,
          }
        );
      } else {
        setOrders([]);
        setNextOffset("");
      }

      setLoading(false);
    }

    loadOrders();
  }, [appliedSearch, appliedFilters]);

  async function updateOrder(
    orderId: string,
    field: UpdateField,
    value: string
  ) {
    const savingId = `${orderId}-${field}`;
    setSavingKey(savingId);

    const oldOrders = orders;

    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              fields: {
                ...order.fields,
                [field === "status" ? "order_status" : "Courier"]: value,
              },
            }
          : order
      )
    );

    try {
      const res = await fetch("/api/orders/update", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          field,
          value,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setOrders(oldOrders);
        alert(data.message || "Update failed");
      }
    } catch {
      setOrders(oldOrders);
      alert("Update failed");
    } finally {
      setSavingKey("");
    }
  }

  function applyFilters() {
    setAppliedSearch(search);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setSearch("");
    setAppliedSearch("");
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setNextOffset("");
    setSelectedRows([]);
  }

  async function loadMoreOrders() {
    if (!nextOffset || loadingMore) return;

    setLoadingMore(true);

    const params = new URLSearchParams();
    params.set("offset", nextOffset);

    if (appliedSearch.trim()) {
      params.set("q", appliedSearch.trim());
    }

    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    });

    const res = await fetch(`/api/orders/list?${params.toString()}`);
    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) => [...prev, ...(data.records || [])]);
      setNextOffset(data.nextOffset || "");
    }

    setLoadingMore(false);
  }

  function toggleRow(id: string) {
    setSelectedRows((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleAllRows() {
    if (selectedRows.length === orders.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(orders.map((order) => order.id));
    }
  }

  async function bulkUpdateCourier() {
    if (selectedRows.length === 0) {
      alert("Please select at least one order.");
      return;
    }

    if (!bulkCourier) {
      alert("Please select courier.");
      return;
    }

    setBulkSaving(true);

    const res = await fetch("/api/orders/bulk-update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "courier",
        orderIds: selectedRows,
        courier: bulkCourier,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) =>
        prev.map((order) =>
          selectedRows.includes(order.id)
            ? { ...order, fields: { ...order.fields, Courier: bulkCourier } }
            : order
        )
      );
      alert(`Courier updated: ${data.updated || 0}`);
    } else {
      alert(data.message || "Bulk courier update failed");
    }

    setBulkSaving(false);
  }

  async function dispatchReadyOrders() {
    const dispatchIds = orders
      .filter((order) => {
        const status = String(order.fields.order_status || "").toLowerCase();
        const courier = String(order.fields.Courier || "").trim();

        return status === "order received" && courier;
      })
      .map((order) => order.id);

    if (dispatchIds.length === 0) {
      alert("No ready orders found. Status must be Order Received and Courier must not be empty.");
      return;
    }

    if (!confirm(`Dispatch ${dispatchIds.length} ready orders?`)) return;

    setBulkSaving(true);

    const res = await fetch("/api/orders/bulk-update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dispatch",
        orderIds: dispatchIds,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setOrders((prev) =>
        prev.map((order) =>
          dispatchIds.includes(order.id)
            ? { ...order, fields: { ...order.fields, order_status: "Dispatched" } }
            : order
        )
      );

      alert(`Dispatched: ${data.updated || 0}`);
    } else {
      alert(data.message || "Bulk dispatch failed");
    }

    setBulkSaving(false);
  }

  const supportsDriverSheet =
    baseName.toLowerCase().includes("fab") ||
    baseName.toLowerCase().includes("doha") ||
    baseName.toLowerCase().includes("i5q") ||
    baseName.toLowerCase().includes("dq");

  async function downloadDriverSheet() {
    setDownloadingDriverSheet(true);

    try {
      const response = await fetch(
        "/api/orders/driver-sheet",
        { cache: "no-store" }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        alert(
          data?.message ||
            "Driver sheet download failed"
        );
        return;
      }

      const blob = await response.blob();
      const contentDisposition =
        response.headers.get("Content-Disposition") || "";

      const fileNameMatch = contentDisposition.match(
        /filename="?([^"]+)"?/
      );

      const fileName =
        fileNameMatch?.[1] ||
        `Driver_Sheets_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    } catch {
      alert("Driver sheet download failed");
    } finally {
      setDownloadingDriverSheet(false);
    }
  }

  function handlePrint(order: OrderRecord) {
    const payload = {
      orderNo: getOrderNo(order),
      store: getStore(order),
      customer: {
        fields: {
          "Customer Name": getCustomerName(order),
          "Contact No.": getPhone(order),
          Address:
            order.fields.address_bak?.[0] ??
            order.fields["Consignee Address 1"]?.[0] ??
            "",
        },
      },
      items: (order.fields.sku || []).map((skuId: string, index: number) => ({
        id: `${order.id}-${index}`,
        sku: order.fields["OR NO"] || getOrderNo(order),
        qty: order.fields.Qt?.[index] ?? 1,
        price: order.fields.price?.[index] ?? 0,
        productId: skuId,
      })),
      summary: {
        discount: Number(order.fields.discount ?? 0),
        shipping: Number(order.fields.shipping ?? 0),
        vat: Number(order.fields.vat ?? 0),
        advancePayment: 0,
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(payload));
    window.open(`/orders/print?data=${encoded}`, "_blank");
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900">
              Orders List
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {baseName ? `${baseName} — ` : ""}
              Search by order number and use available filters for this base.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-[560px]">
            <label className="block text-sm font-bold text-slate-600">
              Search Order No.
            </label>

            <div className="flex gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyFilters();
                  }
                }}
                placeholder="BUS26661, 26661, or 1917"
                className="h-12 flex-1 rounded-2xl border border-slate-200 bg-white px-4 font-bold outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={applyFilters}
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  height: "48px",
                  padding: "0 18px",
                  borderRadius: "16px",
                  fontWeight: 900,
                }}
              >
                Search
              </button>

              <button
                type="button"
                onClick={() => setShowFilters((value) => !value)}
                className="h-12 rounded-2xl border border-slate-300 bg-white px-4 font-black hover:bg-slate-50"
              >
                Filters
              </button>
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Customer
                </label>
                <input
                  value={filters.customer}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      customer: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Customer name"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Phone
                </label>
                <input
                  value={filters.phone}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      phone: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Phone number"
                />
              </div>

              {capabilities.hasStore && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Store
                </label>
                <input
                  value={filters.store}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      store: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                  placeholder="Store name"
                />
              </div>
              )}

              {capabilities.hasStatus && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500"
                >
                  <option value="">Any Status</option>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              )}

              {capabilities.hasCourier && (
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Courier
                </label>
                <select
                  value={filters.courier}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      courier: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-blue-500"
                >
                  <option value="">Any Courier</option>
                  {courierOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Date From
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateFrom: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-600">
                  Date To
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateTo: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 font-bold outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={applyFilters}
                  style={{
                    background: "#16a34a",
                    color: "#ffffff",
                    height: "44px",
                    padding: "0 18px",
                    borderRadius: "12px",
                    fontWeight: 900,
                  }}
                >
                  Apply
                </button>

                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-black text-slate-700">
              Showing {orders.length} orders
            </p>

            {savingKey && (
              <p className="text-sm font-black text-blue-600">Saving...</p>
            )}
          </div>

          {orders.length > 0 && capabilities.canUpdateCourier && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-black text-slate-700">
                Selected: {selectedRows.length}
              </p>

              <select
                value={bulkCourier}
                onChange={(event) => setBulkCourier(event.target.value)}
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
              >
                <option value="">Select Courier</option>
                {courierOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={bulkUpdateCourier}
                disabled={selectedRows.length === 0 || !bulkCourier || bulkSaving}
                className="h-10 rounded-xl border border-blue-300 bg-blue-50 px-4 text-sm font-black text-blue-700 disabled:opacity-50"
              >
                Update Courier
              </button>

              <button
                type="button"
                onClick={dispatchReadyOrders}
                disabled={bulkSaving}
                className="h-10 rounded-xl border border-green-700 bg-green-600 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                Dispatch Ready Orders
              </button>

              {supportsDriverSheet && (
                <button
                  type="button"
                  onClick={downloadDriverSheet}
                  disabled={downloadingDriverSheet || bulkSaving}
                  className="h-10 rounded-xl border border-purple-700 bg-purple-600 px-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {downloadingDriverSheet
                    ? "Preparing..."
                    : "Download Driver Sheet"}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAppliedSearch(search);
                  setAppliedFilters({ ...filters });
                }}
                disabled={loading || bulkSaving}
                className="h-10 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-black text-amber-700 disabled:opacity-50"
              >
                Refresh
              </button>

              <button
                type="button"
                onClick={() => setSelectedRows([])}
                disabled={selectedRows.length === 0 || bulkSaving}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          )}

          <div className="max-h-[75vh] overflow-auto rounded-2xl border border-slate-200">
            {loading ? (
              <div className="p-6 font-bold text-slate-500">
                Loading orders...
              </div>
            ) : (
              <>
                <table className="w-full min-w-[1180px] border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-slate-200 text-slate-900 shadow-sm">
                    <tr>
                      <th className="w-[60px] px-4 py-4 text-left">
                        {capabilities.canUpdateCourier && (
                          <input
                            type="checkbox"
                            checked={
                              orders.length > 0 &&
                              selectedRows.length === orders.length
                            }
                            onChange={toggleAllRows}
                          />
                        )}
                      </th>
                      <th className="w-[130px] px-4 py-4 text-left">
                        Order No
                      </th>
                      <th className="w-[210px] px-4 py-4 text-left">
                        Customer
                      </th>
                      <th className="w-[150px] px-4 py-4 text-left">Phone</th>
                      <th className="w-[120px] px-4 py-4 text-left">
                        Order Date
                      </th>
                      <th className="w-[150px] px-4 py-4 text-left">Store</th>
                      <th className="w-[180px] px-4 py-4 text-left">
                        Status
                      </th>
                      <th className="w-[120px] px-4 py-4 text-right">
                        Total
                      </th>
                      <th className="w-[170px] px-4 py-4 text-left">
                        Courier
                      </th>
                      <th className="w-[300px] px-4 py-4 text-right">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map((order, index) => (
                      <tr
                        key={order.id}
                        className={`border-t transition hover:bg-blue-50 ${
                          index % 2 === 0 ? "bg-white" : "bg-slate-50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          {capabilities.canUpdateCourier && (
                            <input
                              type="checkbox"
                              checked={selectedRows.includes(order.id)}
                              onChange={() => toggleRow(order.id)}
                            />
                          )}
                        </td>

                        <td className="px-4 py-3 font-black text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{getOrderNo(order)}</span>
                            {getSource(order) &&
                              !["BS Invoice", "FAB Invoice", "Invoice"].includes(
                                getSource(order)
                              ) && (
                                <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-black text-cyan-700">
                                  {getSource(order)}
                                </span>
                              )}
                          </div>
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-800">
                          {getCustomerName(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-600">
                          {getPhone(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-600">
                          {getOrderDate(order)}
                        </td>

                        <td className="px-4 py-3 font-semibold text-slate-700">
                          {getStore(order)}
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-700">
                          {order.fields.order_status ?? "-"}
                        </td>

                        <td className="px-4 py-3 text-right font-black text-slate-900">
                          {getCurrency(order)} {getTotal(order).toFixed(2)}
                        </td>

                        <td className="px-4 py-3 font-bold text-slate-700">
                          {order.fields.Courier ?? "-"}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-nowrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/orders/view/${encodeURIComponent(
                                    getOrderNo(order)
                                  )}`
                                )
                              }
                              className="h-10 min-w-[86px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100"
                            >
                              👁 View
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                router.push(`/orders/edit/${encodeURIComponent(getOrderNo(order))}`)
                              }
                              style={{
                                background: "#2563eb",
                                color: "#ffffff",
                                height: "40px",
                                minWidth: "86px",
                                padding: "0 12px",
                                borderRadius: "12px",
                                fontWeight: 900,
                              }}
                            >
                              ✏ Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePrint(order)}
                              style={{
                                background: "#111827",
                                color: "#ffffff",
                                height: "40px",
                                minWidth: "86px",
                                padding: "0 12px",
                                borderRadius: "12px",
                                fontWeight: 900,
                              }}
                            >
                              🖨 Print
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {orders.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-10 text-center font-bold text-slate-500"
                        >
                          No orders found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {nextOffset && (
                  <div className="flex justify-center border-t bg-white p-5">
                    <button
                      type="button"
                      onClick={loadMoreOrders}
                      disabled={loadingMore}
                      style={{
                        background: "#2563eb",
                        color: "#ffffff",
                        height: "44px",
                        padding: "0 22px",
                        borderRadius: "12px",
                        fontWeight: 900,
                        opacity: loadingMore ? 0.6 : 1,
                      }}
                    >
                      {loadingMore ? "Loading..." : "Load More Orders"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <OrderDetailsModal
        open={Boolean(selectedOrder)}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onPrint={handlePrint}
      />
    </>
  );
}