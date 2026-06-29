"use client";

import { Save } from "lucide-react";

export default function OrderSummary() {
  return (
    <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
      <h2 className="text-lg font-black text-slate-950">
        4. Order Summary
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        Totals, optional adjustments and final save.
      </p>

      <div className="mt-5 rounded-3xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
        Added products will show here.
      </div>

      <div className="mt-5 grid gap-4">
        <Input label="Discount" type="number" placeholder="0" />
        <Input label="Shipping" type="number" placeholder="0" />
        <Input label="VAT" type="number" placeholder="0" />
        <Input label="Advance Payment" type="number" placeholder="0" />
        <Input label="Total Adjustment" type="number" placeholder="0" />

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">
            Order Note
          </span>
          <textarea
            placeholder="Optional note"
            className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </label>
      </div>

      <div className="mt-6 space-y-3 border-t border-slate-200 pt-5">
        <Summary label="Items" value="0" />
        <Summary label="Subtotal" value="AED 0" />
        <Summary label="Discount" value="AED 0" />
        <Summary label="Shipping" value="AED 0" />
        <Summary label="VAT" value="AED 0" />
        <Summary label="Advance Payment" value="AED 0" />
        <Summary label="Total Adjustment" value="AED 0" />

        <div className="rounded-2xl bg-emerald-50 p-4">
          <Summary label="Grand Total" value="AED 0" />
        </div>
      </div>

      <button className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 text-sm font-black text-white shadow-lg">
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