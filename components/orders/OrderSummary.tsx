"use client";

import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { OrderItem } from "./OrderItemsGrid";

type OrderSummaryData = {
  discount: number;
  shipping: number;
  vat: number;
  advancePayment: number;
  totalAdjustment: number;
  orderNote: string;
};

type OrderSummaryProps = {
  items: OrderItem[];
  summary: OrderSummaryData;
  onSummaryChange: (summary: OrderSummaryData) => void;
  onSaveOrder: () => void;
  isI5qDqBase?: boolean;
};

export default function OrderSummary({
  items,
  summary,
  onSummaryChange,
  onSaveOrder,
  isI5qDqBase = false,
}: OrderSummaryProps) {
  const {
  discount,
  shipping,
  vat,
  advancePayment,
  totalAdjustment,
  orderNote,
} = summary;

function updateSummary(updates: Partial<OrderSummaryData>) {
  onSummaryChange({
    ...summary,
    ...updates,
  });
}

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => {
      const packPrice = Number(item.packPrice) || 0;
      return total + (packPrice > 0 ? packPrice : item.qty * item.price);
    }, 0);
  }, [items]);

  const currency = isI5qDqBase ? "QAR" : "AED";

  const grandTotal =
    subtotal - discount + shipping + vat - advancePayment + totalAdjustment;

  return (
    <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
      <h2 className="text-lg font-black text-slate-950">4. Order Summary</h2>

      <p className="mt-1 text-sm text-slate-500">
        Totals, optional adjustments and final save.
      </p>

      <div className="mt-5 rounded-3xl bg-slate-50 p-5">
        {items.length === 0 ? (
          <p className="text-center text-sm font-bold text-slate-400">
            Added products will show here.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-black text-slate-800">{item.sku}</p>
                  <p className="text-xs font-bold text-slate-400">
                    Qty {item.qty}
                    {Number(item.packPrice) > 0
                      ? ` • Pack ${currency} ${Number(item.packPrice).toFixed(2)}`
                      : ` × ${currency} ${item.price.toFixed(2)}`}
                  </p>
                </div>

                <span className="font-black text-slate-950">
                  {currency}{" "}
                  {(Number(item.packPrice) > 0
                    ? Number(item.packPrice)
                    : item.qty * item.price
                  ).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-4">
        <Input
          label="Discount"
          type="number"
          value={discount}
          onChange={(e) =>
  updateSummary({ discount: Number(e.target.value) || 0 })
}





        />

        <Input
          label="Shipping"
          type="number"
          value={shipping}
          onChange={(e) =>
  updateSummary({ shipping: Number(e.target.value) || 0 })
}
        />

        <Input
          label="VAT"
          type="number"
          value={vat}
          onChange={(e) =>
  updateSummary({ vat: Number(e.target.value) || 0 })
}
        />

        <Input
          label="Advance Payment"
          type="number"
          value={advancePayment}
          onChange={(e) =>
  updateSummary({ advancePayment: Number(e.target.value) || 0 })
}
        />

        <Input
          label="Total Adjustment"
          type="number"
          value={totalAdjustment}
          onChange={(e) =>
  updateSummary({ totalAdjustment: Number(e.target.value) || 0 })
}
        />

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">
            Order Note
          </span>
          <textarea
            value={orderNote}
            onChange={(e) => updateSummary({ orderNote: e.target.value })}
            placeholder="Optional note"
            className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </label>
      </div>

      <div className="mt-6 space-y-3 border-t border-slate-200 pt-5">
        <Summary label="Items" value={String(items.length)} />
        <Summary label="Subtotal" value={`${currency} ${subtotal.toFixed(2)}`} />
        <Summary label="Discount" value={`${currency} ${discount.toFixed(2)}`} />
        <Summary label="Shipping" value={`${currency} ${shipping.toFixed(2)}`} />
        <Summary label="VAT" value={`${currency} ${vat.toFixed(2)}`} />
        <Summary
          label="Advance Payment"
          value={`${currency} ${advancePayment.toFixed(2)}`}
        />
        <Summary
          label="Total Adjustment"
          value={`${currency} ${totalAdjustment.toFixed(2)}`}
        />

        <div className="rounded-2xl bg-emerald-50 p-4">
          <Summary label="Grand Total" value={`${currency} ${grandTotal.toFixed(2)}`} />
        </div>
      </div>

      <button
  onClick={onSaveOrder}
  className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 text-sm font-black text-white shadow-lg"
>
        <Save size={18} />
        Save Order
      </button>
    </aside>
  );
}

function Input({
  label,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">
        {label}
      </span>
      <input
        {...props}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-emerald-500 focus:bg-white"
      />
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-bold text-slate-500">{label}</span>
      <span className="font-black text-slate-950">{value}</span>
    </div>
  );
}
