"use client";

import { AlertCircle, Loader2, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

type CustomerRecord = {
  id: string;
  fields: {
    "Contact No."?: string;
    "Customer Name"?: string;
    Address?: string;
    "Area Name"?: string;
    "City Name"?: string;
  };
};

export default function CustomerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const value = query.trim();

    setError("");
    setSearched(false);

    if (value.length < 3) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const res = await fetch(
          `/api/customers/Search?q=${encodeURIComponent(value)}`
        );
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || "Customer search failed");
        }

        setResults(data.records || []);
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Customer search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  function selectCustomer(record: CustomerRecord) {
    setCustomer(record);
    setQuery(record.fields["Contact No."] || "");
    setResults([]);
    setSearched(true);
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">1. Customer Search</h2>

      <p className="mt-1 text-sm text-slate-500">
        Mobile number ya customer name type karein, phir list se customer select karein.
      </p>

      <div className="relative mt-5">
        <label className="mb-2 block text-sm font-bold text-slate-700">
          Search Customer
        </label>

        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCustomer(null);
            }}
            placeholder="Search by mobile number or name"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-12 outline-none transition focus:border-emerald-500 focus:bg-white"
          />

          {loading && (
            <Loader2
              size={18}
              className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-600"
            />
          )}
        </div>

        {results.length > 0 && !customer && (
          <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {results.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => selectCustomer(record)}
                className="w-full rounded-xl p-3 text-left transition hover:bg-emerald-50"
              >
                <p className="font-black text-slate-900">
                  {record.fields["Customer Name"] || "Unnamed Customer"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  📞 {record.fields["Contact No."] || "-"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {record.fields["Area Name"] || "-"},{" "}
                  {record.fields["City Name"] || "-"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {customer && (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-emerald-700">
              <UserRound size={22} />
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-wide text-emerald-700">
                Selected Customer
              </p>
              <p className="mt-1 text-lg font-black text-slate-950">
                {customer.fields["Customer Name"] || "-"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                📞 {customer.fields["Contact No."] || "-"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                📍 {customer.fields["Area Name"] || "-"},{" "}
                {customer.fields["City Name"] || "-"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {customer.fields.Address || "-"}
              </p>
            </div>
          </div>
        </div>
      )}

      {searched && !loading && !customer && results.length === 0 && (
        <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-black text-amber-800">Customer not found</p>
          <p className="mt-1 text-sm text-amber-700">
            Neeche new customer details fill karein.
          </p>
        </div>
      )}

      {!customer && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Input label="Contact No." value={query} readOnly />
          <Input label="Customer Name" placeholder="Customer name" />
          <Input label="Area Name" placeholder="Area name" />
          <Input label="City Name" placeholder="City name" />
          <Input label="Address" placeholder="Full address" />
        </div>
      )}
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
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-emerald-500 focus:bg-white disabled:bg-slate-100"
      />
    </label>
  );
}