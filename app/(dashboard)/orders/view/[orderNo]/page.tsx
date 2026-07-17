"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type ViewOrderResponse = {
  success: boolean;
  message?: string;
  orderNo?: string;
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  };
  order?: {
    date?: string;
    store?: string;
    status?: string;
    totalAmount?: number;
  };
  records?: any[];
};

export default function ViewOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderNo = String(params.orderNo || "");

  const [data, setData] = useState<ViewOrderResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const records = data?.records || [];
  const totalQty = useMemo(
    () =>
      records.reduce(
        (total, record) => total + Number(record.fields?.quantity || 0),
        0
      ),
    [records]
  );

  async function loadOrder() {
    setLoading(true);

    try {
      const res = await fetch(
        `/api/orders/view?orderNo=${encodeURIComponent(orderNo)}`,
        { cache: "no-store" }
      );

      const responseText = await res.text();
      let result: ViewOrderResponse | null = null;

      try {
        result = responseText ? JSON.parse(responseText) : null;
      } catch {
        result = null;
      }

      if (!res.ok || !result?.success) {
        alert(result?.message || "Order not found");
        setData(null);
        return;
      }

      setData(result);
    } catch (error) {
      console.error("Order view failed:", error);
      alert("Order view failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderNo) loadOrder();
  }, [orderNo]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900">Order View</h1>
        <p className="text-slate-500">{orderNo}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.history.back()}
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
          {loading ? "Refreshing..." : "Refresh"}
        </button>

        <button
          type="button"
          onClick={() => router.push(`/orders/edit/${orderNo}`)}
          className="rounded-xl bg-slate-900 px-4 py-2 font-black text-white"
        >
          Edit Order
        </button>

        <button
          type="button"
          onClick={() =>
            router.push(
              `/orders/print?orderNo=${encodeURIComponent(orderNo)}`
            )
          }
          className="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white hover:bg-emerald-700"
        >
          Print Order
        </button>
      </div>

      {loading ? (
        <div className="rounded-3xl border bg-white p-8 font-bold">
          Loading order...
        </div>
      ) : !data ? (
        <div className="rounded-3xl border bg-white p-8 font-bold text-red-600">
          Order could not be loaded.
        </div>
      ) : (
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border bg-slate-50 p-5">
              <h2 className="mb-4 text-xl font-black">Order Information</h2>
              <div className="space-y-3 text-sm">
                <p><b>Order No:</b> {data.orderNo || orderNo}</p>
                <p><b>Order Date:</b> {data.order?.date || "-"}</p>
                <p><b>Store:</b> {data.order?.store || "-"}</p>
                <p><b>Status:</b> {data.order?.status || "-"}</p>
                <p><b>Total SKU Lines:</b> {records.length}</p>
                <p><b>Total Qty:</b> {totalQty}</p>
                <p><b>Total Amount:</b> {data.order?.totalAmount ?? "-"}</p>
              </div>
            </div>

            <div className="rounded-3xl border bg-slate-50 p-5">
              <h2 className="mb-4 text-xl font-black">Customer Information</h2>
              <div className="space-y-3 text-sm">
                <p><b>Customer:</b> {data.customer?.name || "-"}</p>
                <p><b>Mobile:</b> {data.customer?.phone || "-"}</p>
                <p><b>City:</b> {data.customer?.city || "-"}</p>
                <p><b>Country:</b> {data.customer?.country || "-"}</p>
                <p><b>Address:</b> {data.customer?.address || "-"}</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left">Image</th>
                  <th className="px-4 py-3 text-left">Item Code</th>
                  <th className="px-4 py-3 text-left">Product Name</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-center">Qty</th>
                  <th className="px-4 py-3 text-left">Received WH</th>
                  <th className="px-4 py-3 text-left">Bill No</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>

              <tbody>
                {records.map((record) => {
                  const fields = record.fields || {};
                  const received =
                    String(fields.received_in_wh_1 || "").toLowerCase() === "yes";
                  const billNo = String(fields.bill_no || "").trim();
                  const billNoLower = billNo.toLowerCase();
                  const isStockOut =
                    billNoLower === "stock out" ||
                    billNoLower === "sold out" ||
                    billNoLower === "sold";

                  let status = "Pending";
                  let badge = "bg-yellow-100 text-yellow-700";

                  if (received && isStockOut) {
                    status = "Stock Out";
                    badge = "bg-red-100 text-red-700";
                  } else if (received && !billNo) {
                    status = "In Stock";
                    badge = "bg-indigo-100 text-indigo-700";
                  } else if (received && billNo) {
                    status = "Dispatched";
                    badge = "bg-green-100 text-green-700";
                  }

                  return (
                    <tr key={record.id} className="border-t">
                      <td className="px-4 py-3">
                        {fields.image?.[0]?.url ? (
                          <img
                            src={fields.image[0].url}
                            alt={fields["Item Code"] || "Product"}
                            className="h-16 w-12 rounded-lg object-cover"
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {fields["Item Code"] || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {fields["Product Name"] || "-"}
                      </td>
                      <td className="px-4 py-3">{fields.Supplier || "-"}</td>
                      <td className="px-4 py-3 text-center font-black">
                        {fields.quantity || 0}
                      </td>
                      <td className="px-4 py-3">
                        {fields.received_in_wh_1 || "-"}
                      </td>
                      <td className="px-4 py-3">{fields.bill_no || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${badge}`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
