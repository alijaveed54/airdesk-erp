"use client";

import type { OrderRecord } from "@/types/order";

type OrderDetailsModalProps = {
  order: OrderRecord | null;
  open: boolean;
  onClose: () => void;
  onPrint: (order: OrderRecord) => void;
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

function getAddress(order: OrderRecord) {
  return (
    order.fields.address_bak?.[0] ??
    order.fields["Consignee Address 1"]?.[0] ??
    order.fields["Consignee Address 1"] ??
    "-"
  );
}

function getOrderDate(order: OrderRecord) {
  return order.fields.date
    ? new Date(order.fields.date).toLocaleDateString("en-GB")
    : "-";
}

export default function OrderDetailsModal({
  order,
  open,
  onClose,
  onPrint,
}: OrderDetailsModalProps) {
  if (!open || !order) return null;

  const skus = order.fields.sku || [];
  const qtyList = order.fields.Qt || [];
  const priceList = order.fields.price || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900">
              Order Details
            </h2>
            <p className="mt-1 text-sm font-bold text-slate-500">
              Order No: {getOrderNo(order)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-black hover:bg-slate-100"
          >
            ✕ Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="mb-3 text-lg font-black text-slate-900">
              Customer Details
            </h3>

            <div className="space-y-2 text-sm">
              <p>
                <span className="font-black text-slate-600">Name:</span>{" "}
                {getCustomerName(order)}
              </p>
              <p>
                <span className="font-black text-slate-600">Phone:</span>{" "}
                {getPhone(order)}
              </p>
              <p>
                <span className="font-black text-slate-600">Address:</span>{" "}
                {getAddress(order)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="mb-3 text-lg font-black text-slate-900">
              Order Summary
            </h3>

            <div className="space-y-2 text-sm">
              <p>
                <span className="font-black text-slate-600">Date:</span>{" "}
                {getOrderDate(order)}
              </p>
              <p>
                <span className="font-black text-slate-600">Store:</span>{" "}
                {getStore(order)}
              </p>
              <p>
                <span className="font-black text-slate-600">Status:</span>{" "}
                {order.fields.order_status ?? "-"}
              </p>
              <p>
                <span className="font-black text-slate-600">Courier:</span>{" "}
                {order.fields.Courier ?? "-"}
              </p>
              <p className="text-lg">
                <span className="font-black text-slate-600">Total:</span>{" "}
                <span className="font-black text-slate-900">
                  AED {getTotal(order).toFixed(2)}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200">
          <div className="border-b bg-slate-100 px-4 py-3">
            <h3 className="text-lg font-black text-slate-900">Items</h3>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Product / SKU</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Price</th>
                </tr>
              </thead>

              <tbody>
                {skus.length > 0 ? (
                  skus.map((sku: string, index: number) => (
                    <tr key={`${order.id}-${index}`} className="border-t">
                      <td className="px-4 py-3 font-bold">{index + 1}</td>
                      <td className="px-4 py-3 font-bold">
                        {sku || order.fields.SKU?.[index] || "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {qtyList[index] ?? 1}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        AED {Number(priceList[index] ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center font-bold text-slate-500"
                    >
                      No items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onPrint(order)}
            style={{
              background: "#111827",
              color: "#ffffff",
              height: "44px",
              padding: "0 18px",
              borderRadius: "12px",
              fontWeight: 900,
            }}
          >
            🖨 Print
          </button>
        </div>
      </div>
    </div>
  );
}