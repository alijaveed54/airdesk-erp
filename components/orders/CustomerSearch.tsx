"use client";

import { Search, UserRound } from "lucide-react";

export default function CustomerSearch() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">
        1. Customer Search
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        Mobile number type karein. System automatically customer search karega.
      </p>

      <div className="mt-5">
        <label className="mb-2 block text-sm font-bold text-slate-700">
          Contact No.
        </label>

        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            placeholder="Enter customer mobile number"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            <UserRound size={22} />
          </div>

          <div>
            <p className="font-black text-slate-900">
              Customer details will appear here
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Agar customer na mile to neeche new customer details fill karein.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Input label="Customer Name" placeholder="Customer name" />
        <Input label="Area Name" placeholder="Area name" />
        <Input label="City Name" placeholder="City name" />
        <Input label="Address" placeholder="Full address" />
      </div>
    </div>
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