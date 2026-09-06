"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Trash2, RefreshCw } from "lucide-react";

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
  dispatchDate?: string;

  totalQty: number;
  totalItems: number;

  pending: number;
  instock: number;
  dispatchedBySupplier: number;
  stockOut: number;
  receivedInUae: number;

  items: any[];
};

export default function GroupedOrdersPage() {
  const [orders, setOrders] = useState<OrderGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRequestRef = useRef(false);

  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");
const [orderStatus, setOrderStatus] = useState("");
const [storeName, setStoreName] = useState("");
const [orderNo, setOrderNo] = useState("");
const [sku, setSku] = useState("");
const [customerNumber, setCustomerNumber] = useState("");
const [customerName, setCustomerName] = useState("");
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);
  const [imageLoadedOrders, setImageLoadedOrders] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [orderImages, setOrderImages] = useState<Record<string, any[]>>({});
const [storeOptions, setStoreOptions] = useState<string[]>([]);
const [isI5qDqBase, setIsI5qDqBase] = useState(false);
const [selectedBaseName, setSelectedBaseName] = useState("");
const [orderMode, setOrderMode] = useState("ALL");
const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
const [userRole, setUserRole] = useState("");

  function isYesValue(value: unknown) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return value === true || ["yes", "true", "1", "checked"].includes(normalized);
  }

  function isStockOutItem(item: any) {
    const billNo = String(item?.fields?.bill_no || "")
      .trim()
      .toLowerCase();
    return ["stock out", "sold out", "sold"].includes(billNo);
  }

  function isInstockItem(item: any) {
    const billNo = String(item?.fields?.bill_no || "").trim();
    return (
      isYesValue(item?.fields?.received_in_wh_1) &&
      !billNo &&
      !isStockOutItem(item)
    );
  }

  function isValidReceivedInUae(item: any) {
    return (
      isYesValue(item?.fields?.received_in_uae_2) &&
      !isStockOutItem(item) &&
      !isInstockItem(item)
    );
  }

  function formatReceivedDate(value: unknown) {
    const text = String(value ?? "").trim();
    if (!text) return "-";

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(parsed);
  }

  function getPendingSuppliers(order: OrderGroup) {
    return Array.from(
      new Set(
        (order.items || [])
          .filter(
            (item: any) =>
              !isStockOutItem(item) &&
              !isValidReceivedInUae(item) &&
              !isYesValue(item?.fields?.received_in_wh_1)
          )
          .map((item: any) => String(item?.fields?.Supplier || "").trim())
          .filter(Boolean)
      )
    );
  }

  async function loadOrders(overrides?: {
    orderStatus?: string;
    orderMode?: string;
  }) {
    if (loadingRequestRef.current) return;
    loadingRequestRef.current = true;
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
if (customerName.trim()) params.set("customerName", customerName.trim());
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
    loadingRequestRef.current = false;
  }
function toggleOrder(orderNo: string) {
  setExpandedOrders((prev) =>
    prev.includes(orderNo)
      ? prev.filter((item) => item !== orderNo)
      : [...prev, orderNo]
  );
}


async function refreshOrder(orderNo: string) {
  const params = new URLSearchParams();
  params.set("orderNo", orderNo);

  const res = await fetch(`/api/orders/grouped-items?${params.toString()}`);
  const data = await res.json();

  if (!res.ok || !data.success) {
    alert(data.message || "Order refresh failed");
    return;
  }

  const freshOrder = data.orders?.[0];
  if (!freshOrder) return;

  setOrders((prev) =>
    prev.map((order) =>
      order.orderNo === orderNo ? freshOrder : order
    )
  );
}

async function refreshItem(orderNo: string, itemId: string) {
  const params = new URLSearchParams();
  params.set("orderNo", orderNo);

  const res = await fetch(`/api/orders/grouped-items?${params.toString()}`);
  const data = await res.json();

  if (!res.ok || !data.success) {
    alert(data.message || "Item refresh failed");
    return;
  }

  const freshOrder = data.orders?.[0];
  const freshItem = freshOrder?.items?.find((item:any) => item.id === itemId);

  if (!freshItem) return;

  setOrders((prev) =>
    prev.map((order) =>
      order.orderNo === orderNo
        ? {
            ...order,
            items: order.items.map((item:any) =>
              item.id === itemId ? freshItem : item
            ),
          }
        : order
    )
  );
}

const isAdmin = userRole === "Admin";

async function updateReceivedUae(item: any, value: boolean) {
  const res = await fetch("/api/order-items/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: item.id, receivedInUae: value ? "Yes" : "" }],
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    alert(data.message || "Update failed");
    return;
  }
  setOrders((prev) =>
    prev.map((order) => ({
      ...order,
      items: order.items.map((i: any) =>
        i.id === item.id
          ? {
              ...i,
              fields: {
                ...i.fields,
                received_in_uae_2: value ? "Yes" : "",
                received_in_uae_datetime: value
                  ? new Date().toISOString()
                  : "",
              },
            }
          : i
      ),
    }))
  );
}

async function deleteItem(item: any) {
  if (!confirm("Delete this item?")) return;

  const res = await fetch("/api/order-items/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [item.id] }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    alert(data.message || "Delete failed");
    return;
  }
  setOrders((prev) =>
    prev.map((order) => ({
      ...order,
      items: order.items.filter((i: any) => i.id !== item.id),
      totalItems: Math.max(0, (order.totalItems || 0) - 1),
    }))
  );
}

async function loadOrderImages(orderNo: string) {
  const alreadyLoaded = orderImages[orderNo];

  if (alreadyLoaded) {
    setOrderImages((prev) => {
      const copy = { ...prev };
      delete copy[orderNo];
      return copy;
    });
    return;
  }

  const res = await fetch(
    `/api/orders/order-images?orderNo=${encodeURIComponent(orderNo)}`
  );

  const data = await res.json();

  if (data.success) {
    setOrderImages((prev) => ({
      ...prev,
      [orderNo]: data.items || [],
    }));
  }
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
        setUserRole(baseData.user?.role || "");
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

        const defaultMode = isDqBase ? "DQ" : "ALL";

        // Do not auto-select Order Received on page load.
        // User should choose Order Status manually.
        setOrderStatus("");
        setOrderMode(defaultMode);

        await loadOrders({
          orderStatus: "",
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
  value={customerName}
  onChange={(e) => setCustomerName(e.target.value)}
  placeholder="Customer Name"
  className="h-11 w-52 rounded-xl border px-4"
/>

<input
  value={customerNumber}
  onChange={(e) => setCustomerNumber(e.target.value)}
  placeholder="Contact Number"
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
  onClick={() => loadOrders()}
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
    setCustomerName("");
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
  onClick={() => loadOrders()}
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
  setCustomerName("");

  setDateFrom("");
  setDateTo("");

  setOrderStatus("");
  setStoreName("");
  setOrderMode("ALL");

  setTimeout(() => {
  loadOrders();
}, 0);
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
  loadOrderImages(order.orderNo);
}}
  className="mb-2 ml-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-700 hover:bg-amber-100"
>
  {imageLoadedOrders.includes(order.orderNo) ? "Hide Images" : "Load Images"}
</button>

<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    refreshOrder(order.orderNo);
  }}
  className="mb-2 ml-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-100"
>
  <RefreshCw size={16} />
  Refresh
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

  {!isI5qDqBase && (
    <p className="font-black text-teal-700">
      Received in UAE : {order.receivedInUae || 0}
    </p>
  )}

  <p className="font-black text-red-600">
    Pending : {order.pending}
    {getPendingSuppliers(order).length > 0 && (
      <span className="ml-2 text-xs font-bold text-slate-600">
        — Suppliers: {getPendingSuppliers(order).join(", ")}
      </span>
    )}
  </p>

</div>

                </div>

              </div>

              {expandedOrders.includes(order.orderNo) && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full table-fixed text-sm">
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
                            <th className="px-4 py-3 text-left">Dispatch From In</th>
                            <th className="px-4 py-3 text-left">Received Date</th>
                            <th className="px-4 py-3 text-left">Bill No</th>
                            <th className="px-4 py-3 text-left">Item Value</th>
                            {isAdmin && <th className="w-52 px-4 py-3 text-left">Actions</th>}
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item:any)=>(
                        <tr
                          key={item.id}
                          className={`border-t transition ${
                            isInstockItem(item)
                              ? "bg-sky-100 hover:bg-sky-200"
                              : isValidReceivedInUae(item)
                                ? "bg-emerald-100 hover:bg-emerald-200"
                                : "hover:bg-blue-50"
                          }`}
                        >
                          <td className="px-4 py-3">
                            {orderImages[order.orderNo]
                              ?.find((img:any) => img.id === item.id)
                              ?.image?.[0]?.url ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEnlargedImage(
                                      orderImages[order.orderNo]
                                        ?.find((img:any) => img.id === item.id)
                                        ?.image?.[0]?.url || null
                                    )
                                  }
                                  className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  title="Click to enlarge image"
                                >
                                  <img
                                    src={
                                      orderImages[order.orderNo]
                                        ?.find((img:any) => img.id === item.id)
                                        ?.image?.[0]?.url
                                    }
                                    alt={item.fields["Item Code"] || "Product image"}
                                    className="h-16 w-12 cursor-zoom-in rounded-lg object-cover"
                                  />
                                </button>
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
                              <td className="px-4 py-3 font-semibold">
                                {item.fields.received_in_uae_datetime
                                  ? formatReceivedDate(item.fields.received_in_uae_datetime)
                                  : "-"}
                              </td>
                              <td className="px-4 py-3">
                                {item.fields.bill_no || "-"}
                              </td>
                              <td className="px-4 py-3 font-semibold">
                                {item.fields["item value"] || "-"}
                              </td>
                              {isAdmin && (
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {isValidReceivedInUae(item) ? (
                                      <button
                                        type="button"
                                        onClick={() => updateReceivedUae(item, false)}
                                        title="Undo Received in UAE"
                                        aria-label="Undo Received in UAE"
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600 transition hover:bg-orange-100"
                                      >
                                        <RotateCcw size={16} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => updateReceivedUae(item, true)}
                                        title="Mark Received in UAE"
                                        aria-label="Mark Received in UAE"
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
                                      >
                                        <Check size={18} />
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => refreshItem(order.orderNo, item.id)}
                                      title="Refresh Item"
                                      aria-label="Refresh Item"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 transition hover:bg-blue-100"
                                    >
                                      <RefreshCw size={16} />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => deleteItem(item)}
                                      title="Delete Item"
                                      aria-label="Delete Item"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </td>
                              )}
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

      {enlargedImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            type="button"
            onClick={() => setEnlargedImage(null)}
            className="absolute right-5 top-5 rounded-full bg-white px-4 py-2 text-xl font-black text-slate-900 shadow-lg"
            aria-label="Close enlarged image"
          >
            ×
          </button>

          <img
            src={enlargedImage}
            alt="Enlarged product image"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[94vw] rounded-2xl bg-white object-contain shadow-2xl"
          />
        </div>
      )}

    </div>
  );
}