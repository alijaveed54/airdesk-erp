"use client";

import { useEffect, useRef, useState } from "react";
import CustomerSearch from "@/components/orders/CustomerSearch";
import InvoiceSection from "@/components/orders/InvoiceSection";
import ProductSearch from "@/components/orders/ProductSearch";
import OrderSummary from "@/components/orders/OrderSummary";
import type { OrderItem } from "@/components/orders/OrderItemsGrid";
type SelectedCustomer = {
  id: string;
  fields: {
    "Contact No."?: string;
    "Customer Name"?: string;
    Address?: string;
    "Area Name"?: string;
    "City Name"?: string;
  };
};

export default function OrdersPage() {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedBaseName, setSelectedBaseName] = useState("");
  const orderMode: "DQ" = "DQ";
  const [selectedCustomer, setSelectedCustomer] =
  useState<SelectedCustomer | null>(null);

  useEffect(() => {
    async function loadSelectedBase() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const data = await res.json();

        if (res.ok && data.success) {
          const baseName =
            data.user?.selectedBase?.baseName ||
            data.user?.permissions?.[0]?.baseName ||
            "";

          setSelectedBaseName(String(baseName));
        }
      } catch {
        setSelectedBaseName("");
      }
    }

    loadSelectedBase();
  }, []);

  const [selectedStore, setSelectedStore] = useState("");
const [packing, setPacking] = useState(false);
const [replacement, setReplacement] = useState(false);
const [returnItems, setReturnItems] = useState(1);
const [returnOrderValue, setReturnOrderValue] = useState(0);
const [orderSummary, setOrderSummary] = useState({
  discount: 0,
  shipping: 0,
  vat: 0,
  advancePayment: 0,
  totalAdjustment: 0,
  orderNote: "",
});
const [savedOrder, setSavedOrder] = useState<any>(null);
const [isSaving, setIsSaving] = useState(false);
const saveInFlightRef = useRef(false);

async function handleSaveOrder() {
  // Prevent rapid double-click / repeated submit before React can re-render.
  if (saveInFlightRef.current) return;

  saveInFlightRef.current = true;
  setIsSaving(true);

  try {
    const res = await fetch("/api/orders/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerId: selectedCustomer?.id,
        packing,
        ...(!isI5qDqBase(selectedBaseName) ? { selectedStore } : {}),

        discount: orderSummary.discount,
        shipping: orderSummary.shipping,
        vat: orderSummary.vat,
        advancePayment: orderSummary.advancePayment,
        totalAdjustment: orderSummary.totalAdjustment,
        orderNote: orderSummary.orderNote,

        replacement,
        returnItems,
        returnOrderValue,

        items: orderItems,
      }),
    });

    const data = await res.json();

    console.log(data);

    if (!res.ok || !data.success) {
      alert(data.message || "Save failed");
      return;
    }

    setSavedOrder(data);

  } catch (err) {
    console.error(err);
    alert("Server Error");
  } finally {
    saveInFlightRef.current = false;
    setIsSaving(false);
  }
}
function firstDisplayValue(value: any): string {
  if (Array.isArray(value)) {
    const first = value[0];

    if (first && typeof first === "object") {
      return String(first.name ?? first.value ?? first.text ?? "");
    }

    return first == null ? "" : String(first);
  }

  return value == null ? "" : String(value);
}

function getCustomerName(customer: any): string {
  return (
    firstDisplayValue(customer?.fields?.["Customer Name"]) ||
    firstDisplayValue(customer?.fields?.Name) ||
    firstDisplayValue(customer?.customerName) ||
    firstDisplayValue(customer?.name) ||
    ""
  );
}

function getCustomerPhone(customer: any): string {
  return (
    firstDisplayValue(customer?.fields?.["Contact No."]) ||
    firstDisplayValue(customer?.fields?.["Contact No"]) ||
    firstDisplayValue(customer?.fields?.Contact) ||
    firstDisplayValue(customer?.contactNo) ||
    firstDisplayValue(customer?.contact) ||
    firstDisplayValue(customer?.mobile) ||
    ""
  );
}

function getCustomerAddress(customer: any): string {
  return (
    firstDisplayValue(customer?.fields?.Address) ||
    firstDisplayValue(customer?.address) ||
    ""
  );
}

function getSavedOrderNo(invoice: any): string {
  const fields = invoice?.fields || {};

  const candidates = [
    "Order No.",
    "Order No",
    "order no.",
    "order no",
    "order_no.",
    "order_no",
    "Invoice No.",
    "Invoice No",
    "Invoice Number",
    "Number",
  ];

  for (const fieldName of candidates) {
    const value = firstDisplayValue(fields[fieldName]);
    if (value) return value;
  }

  return "-";
}

function getOrderEntryTitle(baseName: string) {
  const name = baseName.trim().toLowerCase();

  if (!name) return "Order Entry";

  if (name.includes("tatlumput") || name.includes("tat")) {
    return "TAT Order Entry";
  }

  if (name.includes("i5q") || name.includes("dq")) {
    return "DQ Order Entry";
  }

  if (name.includes("fab")) {
    if (
      name.includes("non stock") ||
      name.includes("non-stock") ||
      name.includes("without stock")
    ) {
      return "FAB Order Entry (Non Stock)";
    }

    if (name.includes("stock")) {
      return "FAB Order Entry (Stock)";
    }

    return "FAB Order Entry";
  }

  if (
    name === "bs" ||
    name.startsWith("bs ") ||
    name.includes("bs base")
  ) {
    return "BS Order Entry";
  }

  return `${baseName.trim()} Order Entry`;
}

function isBsBase(baseName: string) {
  const name = baseName.trim().toLowerCase();

  return (
    name === "bs" ||
    name.startsWith("bs ") ||
    name.includes("bs base")
  );
}

function isI5qDqBase(baseName: string) {
  const name = baseName.trim().toLowerCase();

  return (
    name.includes("i5q") ||
    name.includes("dq") ||
    name.includes("04-10-2026")
  );
}

function getItemTotal(item: OrderItem) {
  const packPrice = Number(item.packPrice) || 0;
  return packPrice > 0 ? packPrice : (Number(item.qty) || 0) * (Number(item.price) || 0);
}

function getSubtotal() {
  return orderItems.reduce((total, item) => total + getItemTotal(item), 0);
}

function getGrandTotal() {
  return (
    getSubtotal() -
    orderSummary.discount +
    orderSummary.shipping +
    orderSummary.vat -
    orderSummary.advancePayment -
    (replacement ? returnOrderValue : 0)
  );
}

function copyOrderDetails() {
  const subtotal = getSubtotal();
  const grandTotal = getGrandTotal();

  const orderNo = getSavedOrderNo(savedOrder?.invoice);

  const text = `Order No: ${orderNo}

${getCustomerName(selectedCustomer)}
${getCustomerPhone(selectedCustomer)}
${getCustomerAddress(selectedCustomer)}

${orderItems
  .map(
    (item) =>
      `${item.sku} | Qty ${item.qty} | ${isI5qDqBase(selectedBaseName) ? "QAR" : "AED"} ${getItemTotal(item).toFixed(2)}`
  )
  .join("\n")}

Subtotal: AED ${subtotal.toFixed(2)}
Discount: AED ${orderSummary.discount.toFixed(2)}
Shipping: AED ${orderSummary.shipping.toFixed(2)}
VAT: AED ${orderSummary.vat.toFixed(2)}
Advance Payment: AED ${orderSummary.advancePayment.toFixed(2)}
${replacement ? `Return Order Value: AED ${returnOrderValue.toFixed(2)}\n` : ""}
Grand Total: AED ${grandTotal.toFixed(2)}`;

  navigator.clipboard.writeText(text);
  alert("Order copied to clipboard ✅");
}
function openWhatsApp() {
  const grandTotal = getGrandTotal();

  const orderNo = getSavedOrderNo(savedOrder?.invoice);

  const text = `Order No: ${orderNo}

${getCustomerName(selectedCustomer)}
${getCustomerPhone(selectedCustomer)}
${getCustomerAddress(selectedCustomer)}

${orderItems
  .map(
    (item) =>
      `${item.sku} | Qty ${item.qty} | ${isI5qDqBase(selectedBaseName) ? "QAR" : "AED"} ${getItemTotal(item).toFixed(2)}`
  )
  .join("\n")}

Grand Total: AED ${grandTotal.toFixed(2)}`;

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function printInvoice() {
  console.log("Selected Store:", selectedStore);
  const payload = {
    orderNo: getSavedOrderNo(savedOrder?.invoice),
      store: selectedStore,
    customer: selectedCustomer,
    items: orderItems,
    summary: {
      ...orderSummary,
      returnOrderValue: replacement ? returnOrderValue : 0,
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(payload));
  window.open(`/orders/print?data=${encoded}`, "_blank");
}

  if (savedOrder) {
    const invoice = savedOrder.invoice;
    const orderNo = getSavedOrderNo(invoice);

    return (
      <div className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-emerald-700">
          ✅ Order Saved Successfully
        </h1>

        <div className="mt-5 rounded-2xl bg-slate-50 p-5 space-y-4">
  <div>
    <p className="text-sm font-bold text-slate-500">Order No.</p>
    <p className="text-2xl font-black text-slate-950">{orderNo}</p>
  </div>

  <div>
    <p className="text-sm font-bold text-slate-500">Customer</p>
    <p className="text-lg font-bold">
      {getCustomerName(selectedCustomer) || "-"}
    </p>
  </div>

  <div>
    <p className="text-sm font-bold text-slate-500">Phone</p>
    <p>{getCustomerPhone(selectedCustomer) || "-"}</p>
  </div>

  <div>
    <p className="text-sm font-bold text-slate-500">Address</p>
    <p>{getCustomerAddress(selectedCustomer) || "-"}</p>
  </div>
</div>
<div className="mt-5 rounded-2xl bg-white border border-slate-200 p-5">
  <p className="mb-4 text-sm font-black uppercase text-slate-500">
    Products
  </p>

  <div className="space-y-3">
    {orderItems.map((item) => (
      <div
        key={item.id}
        className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
      >
        <div>
          <p className="font-black text-slate-950">{item.sku}</p>
          <p className="text-sm text-slate-500">
            Qty {item.qty}
            {Number(item.packPrice) > 0
              ? ` • Pack ${isI5qDqBase(selectedBaseName) ? "QAR" : "AED"} ${Number(item.packPrice).toFixed(2)}`
              : ` × ${isI5qDqBase(selectedBaseName) ? "QAR" : "AED"} ${item.price.toFixed(2)}`}
          </p>
        </div>

        <p className="font-black text-slate-950">
          {isI5qDqBase(selectedBaseName) ? "QAR" : "AED"}{" "}
          {getItemTotal(item).toFixed(2)}
        </p>
      </div>
    ))}
  </div>
</div>
<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
  <div className="space-y-3 text-sm">

    <div className="flex justify-between">
      <span className="font-bold text-slate-500">Subtotal</span>
      <span className="font-black">
        {isI5qDqBase(selectedBaseName) ? "QAR" : "AED"}{" "}
        {getSubtotal().toFixed(2)}
      </span>
    </div>

    <div className="flex justify-between">
      <span className="font-bold text-slate-500">Discount</span>
      <span className="font-black">
        AED {orderSummary.discount.toFixed(2)}
      </span>
    </div>

    <div className="flex justify-between">
      <span className="font-bold text-slate-500">Shipping</span>
      <span className="font-black">
        AED {orderSummary.shipping.toFixed(2)}
      </span>
    </div>

    <div className="flex justify-between">
      <span className="font-bold text-slate-500">VAT</span>
      <span className="font-black">
        AED {orderSummary.vat.toFixed(2)}
      </span>
    </div>

    <div className="flex justify-between">
      <span className="font-bold text-slate-500">Advance Payment</span>
      <span className="font-black">
        AED {orderSummary.advancePayment.toFixed(2)}
      </span>
    </div>

    {replacement && (
      <div className="flex justify-between">
        <span className="font-bold text-slate-500">Return Order Value</span>
        <span className="font-black">
          AED {returnOrderValue.toFixed(2)}
        </span>
      </div>
    )}

    <div className="border-t border-slate-300 pt-3 flex justify-between text-xl">
      <span className="font-black text-slate-900">
        Grand Total
      </span>

      <span className="font-black text-emerald-700">
        AED{" "}
        {(
          getGrandTotal()
        ).toFixed(2)}
      </span>
    </div>

  </div>
</div>
        <div className="mt-6 flex flex-wrap gap-3">

  <button
  type="button"
  onClick={copyOrderDetails}
    className="h-12 flex-1 min-w-[180px] rounded-xl border border-slate-300 bg-white font-bold hover:bg-slate-50"
  >
    📋 Copy Details
  </button>

  <button
  type="button"
  onClick={openWhatsApp}
  style={{
    background: "#16a34a",
    color: "#ffffff",
    border: "2px solid #16a34a",
    padding: "12px 20px",
    borderRadius: "12px",
    fontWeight: "bold",
  }}
>
  💬 WhatsApp
  
</button>

<button
  type="button"
  onClick={printInvoice}
  style={{
    background: "#111827",
    color: "#ffffff",
    border: "2px solid #111827",
    padding: "12px 20px",
    borderRadius: "12px",
    fontWeight: "bold",
  }}
>
  🖨 Print
</button>

  <button
    type="button"
    onClick={() => {
      setSavedOrder(null);
      setOrderItems([]);
      setSelectedCustomer(null);
      setReplacement(false);
      setReturnItems(1);
      setReturnOrderValue(0);
      setOrderSummary({
        discount: 0,
        shipping: 0,
        vat: 0,
        advancePayment: 0,
        totalAdjustment: 0,
        orderNote: "",
      });
    }}
    className="h-12 flex-1 min-w-[180px] rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white font-bold"
  >
    🆕 New Order
  </button>

</div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">
          {getOrderEntryTitle(selectedBaseName)}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Create customer orders quickly using mobile search and SKU entry.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <CustomerSearch
  selectedCustomer={selectedCustomer}
  onCustomerChange={setSelectedCustomer}
/>
          {!isI5qDqBase(selectedBaseName) && (
            <InvoiceSection
              selectedStore={selectedStore}
              onStoreChange={setSelectedStore}
              replacement={replacement}
              onReplacementChange={setReplacement}
              returnItems={returnItems}
              onReturnItemsChange={setReturnItems}
            />
          )}

{replacement && (
  <div className="rounded-3xl border bg-white p-5 shadow-sm">
    <label className="text-xs font-bold uppercase text-slate-500">
      Return Order Value
    </label>
    <input
      type="number"
      value={returnOrderValue}
      onChange={(e) => setReturnOrderValue(Number(e.target.value) || 0)}
      className="mt-2 w-full rounded-xl border px-4 py-3 font-bold"
      placeholder="0"
    />
    <p className="mt-2 text-xs font-bold text-slate-500">
      This value will be minus from order total.
    </p>
  </div>
)}
          {isBsBase(selectedBaseName) && (
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <label className="flex items-center gap-3 font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={packing}
                  onChange={(e) => setPacking(e.target.checked)}
                  className="h-5 w-5"
                />
                Packing
              </label>
            </div>
          )}

          <ProductSearch
            items={orderItems}
            onChange={setOrderItems}
            isI5qDqBase={isI5qDqBase(selectedBaseName)}
            isFabStockBase={
              getOrderEntryTitle(selectedBaseName) === "FAB Order Entry (Stock)"
            }
          />
        </div>

        <OrderSummary
  items={orderItems}
  summary={orderSummary}
  onSummaryChange={setOrderSummary}
  onSaveOrder={handleSaveOrder}
  isSaving={isSaving}
  isI5qDqBase={isI5qDqBase(selectedBaseName)}
/>
      </div>
    </div>
  );
}