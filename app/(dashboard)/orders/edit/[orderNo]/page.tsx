"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProductSearch from "@/components/orders/ProductSearch";
import type { OrderItem } from "@/components/orders/OrderItemsGrid";

export default function EditOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderNo = String(params.orderNo || "");
  const normalizedOrderNo = orderNo.trim().toLowerCase();

  const isI5qDqBase =
    normalizedOrderNo.startsWith("dq") ||
    normalizedOrderNo.startsWith("i5q");

  const isFabDohaBase =
    normalizedOrderNo.startsWith("fab") ||
    normalizedOrderNo.startsWith("ffab");

  const isDohaBase = isFabDohaBase || isI5qDqBase;
  const currency = isDohaBase ? "QAR" : "AED";
  const showCityCountry = !isDohaBase;
  const deliveryPersonLabel = isDohaBase ? "Driver" : "Courier";

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updateCompleted, setUpdateCompleted] = useState(false);
  const [orderTotal, setOrderTotal] = useState(0);
  const [customerRecordId, setCustomerRecordId] = useState("");
  const [invoiceRecordId, setInvoiceRecordId] = useState("");
  const [storeOptions, setStoreOptions] = useState<string[]>([]);
  const [orderStatusOptions, setOrderStatusOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);

  const cityOptions = [
    "Abu Dhabi",
    "Ajman",
    "Al Ain",
    "Dubai",
    "Fujairah",
    "Ras Al Khaimah",
    "Sharjah",
    "Umm Al Quwain",
  ];

  function fieldValue(fields: any, names: string[]) {
    for (const name of names) {
      const value = fields[name];

      if (Array.isArray(value)) {
        if (value[0] !== undefined && value[0] !== null) return value[0];
      } else if (value !== undefined && value !== null) {
        return value;
      }
    }

    return "";
  }

  const [customerForm, setCustomerForm] = useState({
    name: "",
    mobile: "",
    city: "",
    country: "",
    address: "",
  });

  const [invoiceForm, setInvoiceForm] = useState({
    store: "",
    status: "",
    shipping: "",
    discount: "",
    vat: "",
    advancePayment: "",
    totalAdjustment: "",
    courier: "",
    orderNote: "",
    invoiceNo: "",
    replacement: false,
    returnItems: "",
    returnItemsValue: "",
  });

  const [itemForms, setItemForms] = useState<any[]>([]);
  const [newItems, setNewItems] = useState<OrderItem[]>([]);
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);

  async function loadStoreOptions() {
    const res = await fetch("/api/options/stores");
    const data = await res.json();

    if (res.ok && data.success) {
      setStoreOptions(data.options || []);
    }
  }

  async function loadOrderStatusOptions() {
    const res = await fetch("/api/options/order-status", {
      cache: "no-store",
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const options = Array.isArray(data.options)
        ? data.options
        : Array.isArray(data.statusOptions)
          ? data.statusOptions
          : [];

      setOrderStatusOptions(
        Array.from(
          new Set(
            options
              .map((value: unknown) => String(value || "").trim())
              .filter(Boolean)
          )
        )
      );
    }
  }

  async function loadSupplierOptions() {
    const res = await fetch("/api/options/suppliers");
    const data = await res.json();

    if (res.ok && data.success) {
      setSupplierOptions(data.options || []);
    }
  }

  async function loadOrder() {
    setLoading(true);

    const res = await fetch(
      `/api/orders/view?orderNo=${encodeURIComponent(orderNo)}`
    );

    const data = await res.json();

    if (res.ok && data.success) {
      const allRecords = data.records || [];
      const firstRecord = allRecords[0]?.fields || {};
      const invoiceFields = data.invoice?.fields || {};

      setRecords(allRecords);
      setOrderTotal(Number(data.order?.totalAmount || 0));

      const resolvedCustomerRecordId = String(
        data.customerRecordId ||
        data.customer?.recordId ||
        ""
      );

      const resolvedInvoiceRecordId = String(
        data.invoiceId ||
        ""
      );

      setCustomerRecordId(resolvedCustomerRecordId);
      setInvoiceRecordId(resolvedInvoiceRecordId);

      setCustomerForm({
        name:
          String(data.customer?.name || "") ||
          String(
            fieldValue(firstRecord, [
              "Customer",
              "Customer Name",
              "Name",
            ])
          ) ||
          "",
        mobile:
          String(data.customer?.phone || "") ||
          String(
            fieldValue(firstRecord, [
              "Customer Mobile",
              "Mobile Number",
              "Contact No.",
              "Contact No",
              "Contact",
              "Phone",
              "Mobile",
            ])
          ) ||
          "",
        city:
          String(data.customer?.city || "") ||
          String(
            fieldValue(firstRecord, [
              "Billing Address City",
              "City Name",
              "City",
            ])
          ) ||
          "",
        country:
          String(data.customer?.country || "") ||
          String(
            fieldValue(firstRecord, [
              "Billing Address Country",
              "Country",
            ])
          ) ||
          "",
        address:
          String(data.customer?.address || "") ||
          String(
            fieldValue(firstRecord, [
              "Billing Address Line 1",
              "Address",
            ])
          ) ||
          "",
      });

      setInvoiceForm({
        store: String(
          fieldValue(invoiceFields, ["Select Store", "Store", "store"]) ||
          fieldValue(firstRecord, ["Store", "Select Store"])
        ),
        status: String(
          fieldValue(invoiceFields, [
            "order_status",
            "Order_status",
            "Order Status",
            "Status",
          ]) ||
          fieldValue(firstRecord, [
            "Order_status",
            "Order Status",
            "order_status",
          ])
        ),
        shipping: String(
          fieldValue(invoiceFields, [
            "shipping",
            "Shipping",
            "Shipping Amount",
            "Shipping Charges",
            "Delivery Charges",
          ]) || 0
        ),
        discount: String(
          fieldValue(invoiceFields, [
            "discount",
            "Discount",
            "Discount Amount",
          ]) || 0
        ),
        vat: String(
          fieldValue(invoiceFields, ["vat", "VAT"]) || 0
        ),
        advancePayment: String(
          fieldValue(invoiceFields, [
            "Advance Payment",
            "advancePayment",
            "Advance",
            "Advance Amount",
          ]) || 0
        ),
        totalAdjustment: String(
          fieldValue(invoiceFields, [
            "Total Adjustment",
            "totalAdjustment",
            "Adjustment",
            "Total Adjustments",
          ]) || 0
        ),
        courier: String(
          fieldValue(
            invoiceFields,
            isDohaBase
              ? ["Driver Name", "Driver", "driver"]
              : ["Courier", "courier"]
          ) || ""
        ),
        orderNote: String(
          fieldValue(invoiceFields, [
            "Order Note",
            "order note",
            "orderNote",
            "Note",
          ]) || ""
        ),
        invoiceNo: String(
          fieldValue(invoiceFields, [
            "Invoice No",
            "Invoice No.",
            "invoiceNo",
            "Order No.",
            "Order No",
          ]) || orderNo
        ),
        replacement: Boolean(
          fieldValue(invoiceFields, ["Replacement", "replacement"])
        ),
        returnItems: "",
        returnItemsValue: String(
          fieldValue(invoiceFields, [
            "Return Items Value",
            "returnItemsValue",
            "Return Order Value",
            "Return_Order_Value_Total",
          ]) || 0
        ),
      });

      setItemForms(
        allRecords.map((record: any) => ({
          id: record.id,
          image: record.fields.image?.[0]?.url || "",
          itemCode: record.fields["Item Code"] || "",
          supplier: record.fields.Supplier || "",
          quantity: String(record.fields.quantity || ""),
          receivedWh: record.fields.received_in_wh_1 || "",
          billNo: record.fields.bill_no || "",
          size: record.fields.Size || "",
          singlePrice: String(record.fields["single price"] || ""),
          packPrice: String(record.fields["Pack Price"] || ""),
          totalPrice: String(record.fields["total price"] || ""),
        }))
      );

      setNewItems([]);
      setDeletedItemIds([]);
    } else {
      alert(data.message || "Order not found");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadStoreOptions();
    loadOrderStatusOptions();
    loadSupplierOptions();
    if (orderNo) loadOrder();
  }, [orderNo]);

  useEffect(() => {
    const currentStatus = String(invoiceForm.status || "").trim();

    if (!currentStatus) return;

    setOrderStatusOptions((current) =>
      current.includes(currentStatus)
        ? current
        : [currentStatus, ...current]
    );
  }, [invoiceForm.status]);

  function getItemsSubtotal() {
    return itemForms.reduce(
      (total, item) => total + Number(item.quantity || 0) * 0,
      0
    );
  }

  function getReturnItemsValue() {
    return invoiceForm.replacement
      ? Number(invoiceForm.returnItemsValue || 0)
      : 0;
  }

  function getDisplayOrderTotal() {
    return Number(orderTotal || 0);
  }

  function getUpdatedOrderText() {
    const itemLines = itemForms
      .map((item) => {
        if (isI5qDqBase) {
          return `${item.itemCode || "-"} | Size ${item.size || "-"} | Qty ${
            item.quantity || 0
          } | Total ${currency} ${Number(item.totalPrice || 0).toFixed(2)}`;
        }

        return `${item.itemCode || "-"} | Qty ${item.quantity || 0}`;
      })
      .join("\n");

    return `Order Updated Successfully

Order No: ${orderNo}

Customer: ${customerForm.name || "-"}
Mobile: ${customerForm.mobile || "-"}
Address: ${customerForm.address || "-"}

${itemLines}

Status: ${invoiceForm.status || "-"}
${isI5qDqBase ? "" : `Store: ${invoiceForm.store || "-"}\n`}
Shipping: ${currency} ${Number(invoiceForm.shipping || 0).toFixed(2)}
Discount: ${currency} ${Number(invoiceForm.discount || 0).toFixed(2)}
${isDohaBase ? "" : `VAT: ${currency} ${Number(invoiceForm.vat || 0).toFixed(2)}\nAdvance Payment: ${currency} ${Number(invoiceForm.advancePayment || 0).toFixed(2)}\nTotal Adjustment: ${currency} ${Number(invoiceForm.totalAdjustment || 0).toFixed(2)}\n`}${invoiceForm.replacement ? `Return Items Value: ${currency} ${Number(invoiceForm.returnItemsValue || 0).toFixed(2)}\n` : ""}Grand Total: ${currency} ${getDisplayOrderTotal().toFixed(2)}`;
  }

  async function copyUpdatedOrder() {
    try {
      await navigator.clipboard.writeText(getUpdatedOrderText());
      alert("Order details copied ✅");
    } catch {
      alert("Copy failed");
    }
  }

  function shareUpdatedOrderOnWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(getUpdatedOrderText())}`,
      "_blank"
    );
  }

  function printUpdatedOrder() {
    const payload = {
      orderNo,
      store: invoiceForm.store,
      customer: {
        name: customerForm.name,
        phone: customerForm.mobile,
        address: customerForm.address,
        city: customerForm.city,
        country: customerForm.country,
      },
      items: itemForms.map((item) => ({
        sku: item.itemCode,
        qty: Number(item.quantity || 0),
        image: item.image || "",
        supplier: item.supplier || "",
      })),
      summary: {
        shipping: Number(invoiceForm.shipping || 0),
        discount: Number(invoiceForm.discount || 0),
        vat: Number(invoiceForm.vat || 0),
        advancePayment: Number(invoiceForm.advancePayment || 0),
        totalAdjustment: Number(invoiceForm.totalAdjustment || 0),
        returnOrderValue: invoiceForm.replacement
          ? Number(invoiceForm.returnItemsValue || 0)
          : 0,
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(payload));
    window.open(`/orders/print?data=${encoded}`, "_blank");
  }

  async function saveOrderAll() {
    if (!customerRecordId) {
      alert(
        "Customer record ID not found. Please refresh the order once and try again."
      );
      return;
    }

    if (!invoiceRecordId) {
      alert("Invoice record ID not found");
      return;
    }

    setSaving(true);

    const customerRes = await fetch("/api/customers/update", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recordId: customerRecordId,
        ...customerForm,
      }),
    });

    const customerData = await customerRes.json();

    if (!customerRes.ok || !customerData.success) {
      alert(customerData.message || "Customer update failed");
      setSaving(false);
      return;
    }

    const invoiceRes = await fetch("/api/invoice/update", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recordId: invoiceRecordId,
        store: invoiceForm.store,
        status: invoiceForm.status,
        shipping: invoiceForm.shipping,
        discount: invoiceForm.discount,
        vat: invoiceForm.vat,
        advancePayment: invoiceForm.advancePayment,
        totalAdjustment: invoiceForm.totalAdjustment,
        courier: isDohaBase ? "" : invoiceForm.courier,
        driver: isDohaBase ? invoiceForm.courier : "",
        orderNote: invoiceForm.orderNote,
        replacement: invoiceForm.replacement,
        returnItemsValue: invoiceForm.returnItemsValue,
      }),
    });

    const invoiceData = await invoiceRes.json();

    if (!invoiceRes.ok || !invoiceData.success) {
      alert(invoiceData.message || "Invoice update failed");
      setSaving(false);
      return;
    }

    if (deletedItemIds.length > 0) {
      const deleteRes = await fetch("/api/order-items/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: deletedItemIds,
        }),
      });

      const deleteData = await deleteRes.json();

      if (!deleteRes.ok || !deleteData.success) {
        alert(deleteData.message || "Order items delete failed");
        setSaving(false);
        return;
      }
    }

    if (itemForms.length > 0) {
      const itemsRes = await fetch("/api/order-items/update", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: itemForms,
        }),
      });

      const itemsData = await itemsRes.json();

      if (!itemsRes.ok || !itemsData.success) {
        alert(itemsData.message || "Order items update failed");
        setSaving(false);
        return;
      }
    }

    if (newItems.length > 0) {
      const createItemsRes = await fetch("/api/order-items/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoiceId: invoiceRecordId,
          orderNo,
          items: newItems,
        }),
      });

      const createItemsData = await createItemsRes.json();

      if (!createItemsRes.ok || !createItemsData.success) {
        alert(createItemsData.message || "Order items create failed");
        setSaving(false);
        return;
      }
    }

    await loadOrder();
    setUpdateCompleted(true);
    setSaving(false);
  }

  function updateItem(index: number, field: string, value: string) {
    setItemForms((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function removeExistingItem(index: number) {
    const item = itemForms[index];

    if (!item?.id) return;

    if (!confirm("Delete this item from order?")) return;

    setDeletedItemIds((ids) => [...ids, item.id]);
    setItemForms((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  if (updateCompleted) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-emerald-700">
          ✅ Order Updated Successfully
        </h1>

        <div className="mt-5 rounded-2xl bg-slate-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-bold text-slate-500">Order No.</p>
            <p className="text-2xl font-black text-slate-950">{orderNo}</p>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-500">Customer</p>
            <p className="text-lg font-bold">{customerForm.name || "-"}</p>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-500">Phone</p>
            <p>{customerForm.mobile || "-"}</p>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-500">Address</p>
            <p>{customerForm.address || "-"}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-sm font-black uppercase text-slate-500">
            Products
          </p>

          <div className="space-y-3">
            {itemForms.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
              >
                <div>
                  <p className="font-black text-slate-950">
                    {item.itemCode || "-"}
                  </p>
                  <p className="text-sm text-slate-500">
                    Qty {item.quantity || 0}
                  </p>
                </div>

                <p className="font-black text-slate-700">
                  {item.supplier || ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="font-bold text-slate-500">Shipping</span>
              <span className="font-black">
                {currency} {Number(invoiceForm.shipping || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="font-bold text-slate-500">Discount</span>
              <span className="font-black">
                {currency} {Number(invoiceForm.discount || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="font-bold text-slate-500">VAT</span>
              <span className="font-black">
                {currency} {Number(invoiceForm.vat || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="font-bold text-slate-500">Advance Payment</span>
              <span className="font-black">
                {currency} {Number(invoiceForm.advancePayment || 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="font-bold text-slate-500">Total Adjustment</span>
              <span className="font-black">
                {currency} {Number(invoiceForm.totalAdjustment || 0).toFixed(2)}
              </span>
            </div>

            {invoiceForm.replacement && (
              <div className="flex justify-between">
                <span className="font-bold text-slate-500">
                  Return Items Value
                </span>
                <span className="font-black text-red-600">
                  {currency} {Number(invoiceForm.returnItemsValue || 0).toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex justify-between border-t border-slate-300 pt-3 text-xl">
              <span className="font-black text-slate-900">Grand Total</span>
              <span className="font-black text-emerald-700">
                {currency} {getDisplayOrderTotal().toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={copyUpdatedOrder}
            className="h-12 flex-1 min-w-[180px] rounded-xl border border-slate-300 bg-white font-bold hover:bg-slate-50"
          >
            📋 Copy Details
          </button>

          <button
            type="button"
            onClick={shareUpdatedOrderOnWhatsApp}
            className="h-12 flex-1 min-w-[180px] rounded-xl bg-green-600 px-5 font-bold text-white hover:bg-green-700"
          >
            💬 WhatsApp
          </button>

          <button
            type="button"
            onClick={printUpdatedOrder}
            className="h-12 flex-1 min-w-[180px] rounded-xl bg-slate-900 px-5 font-bold text-white hover:bg-slate-700"
          >
            🖨 Print
          </button>

          <button
            type="button"
            onClick={() => router.push(`/orders/view/${orderNo}`)}
            className="h-12 flex-1 min-w-[180px] rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white font-bold"
          >
            View Order
          </button>

          <button
            type="button"
            onClick={() => setUpdateCompleted(false)}
            className="h-12 flex-1 min-w-[180px] rounded-xl border border-blue-300 bg-blue-50 font-bold text-blue-700"
          >
            Edit Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">Edit Order</h1>
        <p className="text-slate-500">{orderNo}</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border px-4 py-2 font-black"
        >
          Back
        </button>

        <button
          type="button"
          onClick={loadOrder}
          disabled={loading}
          className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-black text-blue-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="rounded-3xl border bg-white p-8 font-bold">
          Loading order...
        </div>
      ) : (
        <>
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xl font-black">Customer Details</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-500">
                  Customer Name
                </label>
                <input
                  value={customerForm.name}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, name: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500">
                  Mobile
                </label>
                <input
                  value={customerForm.mobile}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, mobile: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              {showCityCountry && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  City
                </label>
                <select
                  value={customerForm.city}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, city: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                >
                  <option value="">Select City</option>
                  {cityOptions.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>
              )}

              {showCityCountry && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  Country
                </label>
                <input
                  value={customerForm.country}
                  onChange={(e) =>
                    setCustomerForm({
                      ...customerForm,
                      country: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>
              )}

              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500">
                  Address
                </label>
                <textarea
                  value={customerForm.address}
                  onChange={(e) =>
                    setCustomerForm({
                      ...customerForm,
                      address: e.target.value,
                    })
                  }
                  rows={3}
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xl font-black">Invoice Details</h2>

            <div className="grid gap-4 md:grid-cols-2">
              {!isI5qDqBase && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  Store
                </label>
                <select
                  value={invoiceForm.store}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, store: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                >
                  <option value="">Select Store</option>
                  {storeOptions.map((store) => (
                    <option key={store} value={store}>
                      {store}
                    </option>
                  ))}
                </select>
              </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500">
                  Order Status
                </label>
                <select
                  value={invoiceForm.status}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, status: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                >
                  <option value="">Select Status</option>
                  {orderStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500">
                  Shipping
                </label>
                <input
                  type="number"
                  value={invoiceForm.shipping}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, shipping: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500">
                  Discount
                </label>
                <input
                  type="number"
                  value={invoiceForm.discount}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, discount: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              {!isDohaBase && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  VAT
                </label>
                <input
                  type="number"
                  value={invoiceForm.vat}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, vat: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>
              )}

              {!isDohaBase && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  Advance Payment
                </label>
                <input
                  type="number"
                  value={invoiceForm.advancePayment}
                  onChange={(e) =>
                    setInvoiceForm({
                      ...invoiceForm,
                      advancePayment: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>
              )}

              {!isDohaBase && (
              <div>
                <label className="text-xs font-bold text-slate-500">
                  Total Adjustment
                </label>
                <input
                  type="number"
                  value={invoiceForm.totalAdjustment}
                  onChange={(e) =>
                    setInvoiceForm({
                      ...invoiceForm,
                      totalAdjustment: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500">
                  {deliveryPersonLabel}
                </label>
                <input
                  value={invoiceForm.courier}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, courier: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500">
                  Order Note
                </label>
                <textarea
                  value={invoiceForm.orderNote}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, orderNote: e.target.value })
                  }
                  rows={3}
                  className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                />
              </div>

              <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <input
                  type="checkbox"
                  checked={invoiceForm.replacement}
                  onChange={(e) =>
                    setInvoiceForm({
                      ...invoiceForm,
                      replacement: e.target.checked,
                      returnItems: e.target.checked
                        ? invoiceForm.returnItems
                        : "",
                      returnItemsValue: e.target.checked
                        ? invoiceForm.returnItemsValue
                        : "",
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="font-black text-slate-700">Replacement</span>
              </div>

              {invoiceForm.replacement && (
                <>
                  <div>
                    <label className="text-xs font-bold text-slate-500">
                      Return Items
                    </label>
                    <input
                      type="number"
                      value={invoiceForm.returnItems}
                      onChange={(e) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          returnItems: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500">
                      Return Items Value
                    </label>
                    <input
                      type="number"
                      value={invoiceForm.returnItemsValue}
                      onChange={(e) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          returnItemsValue: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border px-4 py-2 font-bold"
                    />
                    <p className="mt-1 text-xs font-bold text-red-500">
                      This value will be minus from order total.
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500">
                  Invoice No
                </label>
                <input
                  value={invoiceForm.invoiceNo}
                  readOnly
                  className="mt-1 w-full rounded-xl border bg-slate-100 px-4 py-2 font-bold text-slate-600"
                />
              </div>
            </div>
          </div>

          {invoiceForm.replacement && (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex justify-between">
                <span className="font-black text-red-700">
                  Return Items Value Minus
                </span>
                <span className="font-black text-red-700">
                  {currency} {getReturnItemsValue().toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xl font-black">Order Items</h2>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
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
                    <th className="px-4 py-3 text-right">Delete</th>
                  </tr>
                </thead>

                <tbody>
                  {itemForms.map((item, index) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-4 py-3">
                        {item.image ? (
                          <img
                            src={item.image}
                            className="h-16 w-12 rounded-lg object-cover"
                          />
                        ) : (
                          "-"
                        )}
                      </td>

                      <td className="px-4 py-3 font-bold">
                        {item.itemCode || "-"}
                      </td>

                      {isI5qDqBase ? (
                        <>
                          <td className="px-4 py-3">
                            <input
                              value={item.size}
                              onChange={(e) =>
                                updateItem(index, "size", e.target.value)
                              }
                              className="w-24 rounded-xl border px-3 py-2 font-bold"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(index, "quantity", e.target.value)
                              }
                              className="w-20 rounded-xl border px-3 py-2 text-center font-bold"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.singlePrice}
                              onChange={(e) =>
                                updateItem(index, "singlePrice", e.target.value)
                              }
                              className="w-28 rounded-xl border px-3 py-2 font-bold"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.packPrice}
                              onChange={(e) =>
                                updateItem(index, "packPrice", e.target.value)
                              }
                              className="w-28 rounded-xl border px-3 py-2 font-bold"
                            />
                          </td>

                          <td className="px-4 py-3 font-black">
                            {currency} {Number(item.totalPrice || 0).toFixed(2)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            <select
                              value={item.supplier}
                              onChange={(e) =>
                                updateItem(index, "supplier", e.target.value)
                              }
                              className="w-full rounded-xl border px-3 py-2 font-bold"
                            >
                              <option value="">Select Supplier</option>
                              {supplierOptions.map((supplier) => (
                                <option key={supplier} value={supplier}>
                                  {supplier}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(index, "quantity", e.target.value)
                              }
                              className="w-20 rounded-xl border px-3 py-2 text-center font-bold"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <select
                              value={item.receivedWh}
                              onChange={(e) =>
                                updateItem(index, "receivedWh", e.target.value)
                              }
                              className="w-full rounded-xl border px-3 py-2 font-bold"
                            >
                              <option value=""></option>
                              <option value="Yes">Yes</option>
                            </select>
                          </td>

                          <td className="px-4 py-3">
                            <input
                              value={item.billNo}
                              onChange={(e) =>
                                updateItem(index, "billNo", e.target.value)
                              }
                              className="w-full rounded-xl border px-3 py-2 font-bold"
                            />
                          </td>
                        </>
                      )}

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeExistingItem(index)}
                          className="rounded-xl bg-red-50 px-3 py-2 font-black text-red-600"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <h3 className="mb-4 text-lg font-black text-slate-900">
                Add New Product
              </h3>

              <ProductSearch
                items={newItems}
                onChange={setNewItems}
                isI5qDqBase={isI5qDqBase}
                orderMode={normalizedOrderNo.startsWith("i5q") ? "i5Q" : "DQ"}
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={saveOrderAll}
                disabled={saving}
                className="rounded-xl bg-slate-900 px-5 py-3 font-black text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Order"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
