"use client";

import { useEffect, useState } from "react";

type OrderGroup = {
  orderNo: string;
  orderNumber: number;

  customer: string;

  createdDate: string;
  date: string;

  store: string;

  orderStatus: string;
  orderMode?: "DQ" | "i5Q";
  customerNumber?: string;
  salesPerson?: string;
  totalValue?: number;
  currency?: string;

  totalQty: number;
  totalItems: number;

  pending: number;
  instock: number;
  dispatchedBySupplier: number;
  stockOut: number;

  items: any[];
};

export default function GroupedOrdersPage() {
  const [orders, setOrders] = useState<OrderGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");
const [orderStatus, setOrderStatus] = useState("");
const [storeName, setStoreName] = useState("");
const [orderNo, setOrderNo] = useState("");
const [sku, setSku] = useState("");
const [customerNumber, setCustomerNumber] = useState("");
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);
  const [imageLoadedOrders, setImageLoadedOrders] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
const [storeOptions, setStoreOptions] = useState<string[]>([]);
const [isI5qDqBase, setIsI5qDqBase] = useState(false);
const [selectedBaseName, setSelectedBaseName] = useState("");
const [orderMode, setOrderMode] = useState("ALL");

  async function loadOrders(overrides?: {
    orderStatus?: string;
    orderMode?: string;
  }) {
    setLoading(true);

    const params = new URLSearchParams();

    const effectiveOrderStatus =
      overrides?.orderStatus !== undefined
        ? overrides.orderStatus
        : orderStatus;

    const effectiveOrderMode =
      overrides?.orderMode !== undefined
        ? overrides.orderMode
        : orderMode;

    if (orderNo.trim()) params.set("orderNo", orderNo.trim());
if (sku.trim()) params.set("sku", sku.trim());
if (customerNumber.trim()) params.set("customerNumber", customerNumber.trim());
if (dateFrom) params.set("dateFrom", dateFrom);
if (dateTo) params.set("dateTo", dateTo);
if (effectiveOrderStatus) params.set("orderStatus", effectiveOrderStatus);
if (storeName) params.set("storeName", storeName);
if (effectiveOrderMode !== "ALL") params.set("orderMode", effectiveOrderMode);

    const res = await fetch(
      `/api/orders/grouped-items?${params.toString()}`
    );

    const data = await res.json();

    if (res.ok && data.success) {
      setOrders(data.orders || []);
      setIsI5qDqBase(Boolean(data.isI5qDqBase));
    } else {
      alert(data.message || "Failed to load orders");
    }

    setLoading(false);
  }
function toggleOrder(orderNo: string) {
  setExpandedOrders((prev) =>
    prev.includes(orderNo)
      ? prev.filter((item) => item !== orderNo)
      : [...prev, orderNo]
  );
}

function toggleImages(orderNo: string) {
  setImageLoadedOrders((prev) =>
    prev.includes(orderNo)
      ? prev.filter((item) => item !== orderNo)
      : [...prev, orderNo]
  );
}
  useEffect(() => {
    async function initializePage() {
      setLoading(true);

      try {
        const [baseRes, optionsRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/orders/grouped-items/options", {
            cache: "no-store",
          }),
        ]);

        const baseData = await baseRes.json();
        const optionsData = await optionsRes.json();

        if (optionsRes.ok && optionsData.success) {
          setStatusOptions(optionsData.statusOptions || []);
          setStoreOptions(optionsData.storeOptions || []);
        }

        const baseName =
          baseData.user?.selectedBase?.baseName ||
          baseData.user?.permissions?.[0]?.baseName ||
          "";

        setSelectedBaseName(String(baseName));

        const normalized = String(baseName)
          .trim()
          .toLowerCase();

        const isDqBase =
          normalized.includes("i5q") ||
          normalized.includes("dq") ||
          normalized.includes("04-10-2026");

        const isTatBase =
          normalized.includes("tatlumput") ||
          normalized === "tat" ||
          normalized.startsWith("tat ");

        const isBsBase =
          normalized === "bs" ||
          normalized.startsWith("bs ") ||
          normalized.includes("bs base") ||
          normalized.includes("bs order entry");

        const defaultStatus =
          isBsBase || isTatBase ? "Order Received" : "";

        const defaultMode = isDqBase ? "DQ" : "ALL";

        setOrderStatus(defaultStatus);
        setOrderMode(defaultMode);

        await loadOrders({
          orderStatus: defaultStatus,
          orderMode: defaultMode,
        });
      } catch (error) {
        console.error("Grouped orders initialization failed:", error);
        setLoading(false);
      }
    }

    initializePage();
  }, []);

  return (
    <div className="space-y-6">

      <div>
        <h1 className="text-3xl font-black">
          Grouped Orders
        </h1>

        <p className="text-slate-500">
          Browse all orders grouped by Order Number.
        </p>
      </div>

      <div className="rounded-3xl border bg-white p-5 shadow-sm">

        <div className="flex flex-wrap gap-3">

          <input
  value={orderNo}
  onChange={(e) => setOrderNo(e.target.value)}
  placeholder="Order No"
  className="h-11 w-44 rounded-xl border px-4"
/>

<input
  value={sku}
  onChange={(e) => setSku(e.target.value)}
  placeholder="SKU"
  className="h-11 w-44 rounded-xl border px-4"
/>

<input
  value={customerNumber}
  onChange={(e) => setCustomerNumber(e.target.value)}
  placeholder="Customer Number"
  className="h-11 w-52 rounded-xl border px-4"
/>
{isI5qDqBase && (
  <select
    value={orderMode}
    onChange={(e) => setOrderMode(e.target.value)}
    className="h-11 w-44 rounded-xl border px-4"
  >
    <option value="ALL">DQ + i5Q</option>
    <option value="DQ">DQ Orders</option>
    <option value="i5Q">i5Q Orders</option>
  </select>
)}

{!isI5qDqBase && (
<select
  value={orderStatus}
  onChange={(e) => setOrderStatus(e.target.value)}
  className="h-11 w-48 rounded-xl border px-4"
>
  <option value="">All Status</option>

  {statusOptions.map((status) => (
    <option key={status} value={status}>
      {status}
    </option>
  ))}
</select>
)}

{!isI5qDqBase && (
<select
  value={storeName}
  onChange={(e) => setStoreName(e.target.value)}
  className="h-11 w-52 rounded-xl border px-4"
>
  <option value="">All Stores</option>

  {storeOptions.map((store, index) => (
  <option key={`${store}-${index}`} value={store}>
    {store}
  </option>
))}
</select>
)}

          <input
  type="date"
  value={dateFrom}
  onChange={(e) => setDateFrom(e.target.value)}
  className="h-11 rounded-xl border px-4"
/>

<input
  type="date"
  value={dateTo}
  onChange={(e) => setDateTo(e.target.value)}
  className="h-11 rounded-xl border px-4"
/>
<button
  onClick={loadOrders}
  disabled={loading}
  className="rounded-xl bg-blue-600 px-5 font-black text-white hover:bg-blue-700 disabled:opacity-50"
>
  Search
</button>

<button
  onClick={() => {
    setOrderNo("");
    setSku("");
    setCustomerNumber("");
    setDateFrom("");
    setDateTo("");
    setOrderStatus("");
    setStoreName("");
    setOrderMode("ALL");

    setTimeout(async () => {
      setLoading(true);
      const res = await fetch("/api/orders/grouped-items?latest=1");
      const data = await res.json();

      if (res.ok && data.success) {
        setOrders(data.orders || []);
        setImageLoadedOrders([]);
        setImageLoadedOrders([]);
      } else {
        alert(data.message || "Failed to load latest orders");
      }

      setLoading(false);
    }, 0);
  }}
  disabled={loading}
  className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
>
  Latest 100
</button>
          <button
  onClick={loadOrders}
  disabled={loading}
  className="rounded-xl border border-blue-300 bg-blue-50 px-5 font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
>
  {loading ? "Refreshing..." : "Refresh"}
</button>

          <button
            onClick={() => {
  setOrderNo("");
  setSku("");
  setCustomerNumber("");

  setDateFrom("");
  setDateTo("");

  setOrderStatus("");
  setStoreName("");
  setOrderMode("ALL");

  setTimeout(loadOrders, 0);
}}  
            className="rounded-xl border px-5 font-black"
          >
            Reset
          </button>

        </div>

      </div>

      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">
            Showing {orders.length} grouped orders
          </p>
          <p className="text-xs font-bold text-slate-500">
            Tip: Use filters/search for faster results.
          </p>
        </div>

        {loading && (
          <div className="p-8 text-center font-bold">
            Loading...
          </div>
        )}

        {!loading && orders.length === 0 && (
          <div className="p-8 text-center font-bold text-slate-500">
            Use filters/search or click Latest 100.
          </div>
        )}

        {!loading &&
          orders.map((order) => (

            <div
              key={order.orderNo}
              className="border-b p-5"
            >
              <div
  onClick={() => toggleOrder(order.orderNo)}
  className="flex cursor-pointer items-center justify-between"
>

                <div>

                  <h2 className="flex items-center gap-3 text-xl font-black">
                    <span>
  {expandedOrders.includes(order.orderNo) ? "▼" : "▶"}
</span>

<span>{order.orderNo}</span>
{order.orderMode && (
  <span
    className={`rounded-full px-3 py-1 text-xs ${
      order.orderMode === "DQ"
        ? "bg-purple-100 text-purple-700"
        : "bg-cyan-100 text-cyan-700"
    }`}
  >
    {order.orderMode}
  </span>
)}
                  </h2>

                  <div className="mt-2 space-y-1 text-sm">

  <p className="font-semibold text-slate-700">
    👤 {order.customer}
  </p>

  <p className="text-slate-500">
    📅 {order.date || "-"}
  </p>

  <p className="font-semibold text-blue-700">
    📌 {order.orderStatus || "-"}
  </p>

</div>

                </div>

                <div className="text-right">
                  <button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    window.location.href = `/orders/view/${order.orderNo}`;
  }}
  className="mb-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700"
>
  View Order
</button>

<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    window.location.href = `/orders/edit/${order.orderNo}`;
  }}
  className="mb-2 ml-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
>
  Edit
</button>

<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    toggleImages(order.orderNo);
  }}
  className="mb-2 ml-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-700 hover:bg-amber-100"
>
  {imageLoadedOrders.includes(order.orderNo) ? "Hide Images" : "Load Images"}
</button>

                  <div className="space-y-1 text-right">

  <p className="font-black">
    Total Items : {order.totalItems}
  </p>

  {isI5qDqBase && (
    <p className="font-black text-emerald-700">
      Total : QAR {Number(order.totalValue || 0).toFixed(2)}
    </p>
  )}

  <p className="text-green-600 font-black">
    Dispatched : {order.dispatchedBySupplier}
  </p>
  <p className="font-black text-orange-600">
  Stock Out : {order.stockOut}
</p>

  <p className="font-black text-indigo-600">
    Instock : {order.instock}
  </p>

  <p className="font-black text-red-600">
    Pending : {order.pending}
  </p>

</div>

                </div>

              </div>

              {expandedOrders.includes(order.orderNo) && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left">Image</th>
                        <th className="px-4 py-3 text-left">Item Code</th>
                        {isI5qDqBase ? (
                          <>
                            <th className="px-4 py-3 text-left">Size</th>
                            <th className="px-4 py-3 text-center">Qty</th>
                            <th className="px-4 py-3 text-left">Single Price</th>
                            <th className="px-4 py-3 text-left">Pack Price</th>
                            <th className="px-4 py-3 text-left">Total</th>
                          </>
                        ) : (
                          <>
                            <th className="px-4 py-3 text-left">Supplier</th>
                            <th className="px-4 py-3 text-center">Qty</th>
                            <th className="px-4 py-3 text-left">Received WH</th>
                            <th className="px-4 py-3 text-left">Bill No</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item:any)=>(
                        <tr key={item.id} className="border-t hover:bg-blue-50">
                          <td className="px-4 py-3">
                            {imageLoadedOrders.includes(order.orderNo) ? (
                              item.fields.image?.[0]?.url ? (
                                <img
                                  src={item.fields.image[0].url}
                                  className="h-16 w-12 rounded-lg object-cover"
                                />
                              ) : (
                                "-"
                              )
                            ) : (
                              <span className="text-xs font-bold text-slate-400">
                                Not loaded
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-bold">{item.fields["Item Code"]}</td>
                          {isI5qDqBase ? (
                            <>
                              <td className="px-4 py-3">
                                {item.fields.Size || "-"}
                              </td>
                              <td className="px-4 py-3 text-center font-black">
                                {item.fields.quantity}
                              </td>
                              <td className="px-4 py-3">
                                QAR {Number(item.fields["single price"] || 0).toFixed(2)}
                              </td>
                              <td className="px-4 py-3">
                                {Number(item.fields["Pack Price"] || 0) > 0
                                  ? `QAR ${Number(item.fields["Pack Price"]).toFixed(2)}`
                                  : "-"}
                              </td>
                              <td className="px-4 py-3 font-black">
                                QAR {Number(item.fields["total price"] || 0).toFixed(2)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3">
                                {item.fields.Supplier}
                              </td>
                              <td className="px-4 py-3 text-center font-black">
                                {item.fields.quantity}
                              </td>
                              <td className="px-4 py-3">
                                {item.fields.received_in_wh_1 || "-"}
                              </td>
                              <td className="px-4 py-3">
                                {item.fields.bill_no || "-"}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>

          ))}

      </div>

    </div>
  );
}