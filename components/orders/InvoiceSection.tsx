"use client";

import { useEffect, useMemo, useState } from "react";

type InvoiceSectionProps = {
  selectedStore: string;
  onStoreChange: (value: string) => void;
  replacement: boolean;
  onReplacementChange: (value: boolean) => void;
  returnItems: number;
  onReturnItemsChange: (value: number) => void;
};

export default function InvoiceSection({
  selectedStore,
  onStoreChange,
  replacement,
  onReplacementChange,
  returnItems,
  onReturnItemsChange,
}: InvoiceSectionProps) {
  const [stores, setStores] = useState<string[]>([]);
  const [selectedBaseName, setSelectedBaseName] = useState("");

  useEffect(() => {
    async function loadBase() {
      try {
        const res = await fetch("/api/auth/me",{cache:"no-store"});
        const data = await res.json();
        if(res.ok && data.success){
          setSelectedBaseName(
            data.user?.selectedBase?.baseName ||
            data.user?.permissions?.[0]?.baseName ||
            ""
          );
        }
      } catch {}
    }
    loadBase();
  }, []);


  useEffect(() => {
    let mounted = true;

    async function loadStores() {
      try {
        const res = await fetch("/api/options/stores");
        const data = await res.json();

        if (mounted && res.ok && data.success) {
          setStores(data.options || []);
          onStoreChange((data.options || [])[0] || "");
        }
      } catch {
        if (mounted) setStores([]);
      }
    }

    loadStores();

    return () => {
      mounted = false;
    };
  }, []);

  const hideStore = /tat/i.test(selectedBaseName);

  const replacementNote = useMemo(() => {
    if (!replacement) return "";
    return `Customer Will Return ${returnItems || 0} Item(s)`;
  }, [replacement, returnItems]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">2. Invoice Basics</h2>

      <p className="mt-1 text-sm text-slate-500">
        Invoice number, date, status and contact link system automatically handle karega.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {!hideStore && (
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">
            Select Store
          </span>

          <select
            value={selectedStore}
            onChange={(e) => onStoreChange(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-emerald-500 focus:bg-white"
          >
            {stores.length === 0 ? (
              <option value="">Loading stores...</option>
            ) : (
              stores.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))
            )}
          </select>
        </label>
        )}

        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <input
            type="checkbox"
            checked={replacement}
            onChange={(e) => onReplacementChange(e.target.checked)}
            className="h-5 w-5 accent-emerald-600"
          />
          <div>
            <p className="text-sm font-black text-slate-800">
              Replacement Order
            </p>
            <p className="text-xs text-slate-500">
              Customer replacement order ho to lazmi check karein.
            </p>
          </div>
        </label>
      </div>

      {replacement && (
        <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-amber-900">
              Return Items Count
            </span>

            <input
              type="number"
              min={1}
              value={returnItems}
              onChange={(e) => onReturnItemsChange(Math.max(1, Number(e.target.value) || 1))}
              className="h-12 w-full rounded-2xl border border-amber-200 bg-white px-4 outline-none focus:border-amber-500"
            />
          </label>

          <div className="mt-4 rounded-2xl bg-white p-4">
            <p className="text-xs font-black uppercase text-amber-700">
              Auto Order Note
            </p>
            <p className="mt-1 font-black text-slate-900">
              {replacementNote}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
