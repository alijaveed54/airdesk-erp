"use client";

import { ImageIcon, Plus, Search, Trash2 } from "lucide-react";

export default function ProductSearch() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">3. Add Products</h2>

      <p className="mt-1 text-sm text-slate-500">
        SKU search karein, supplier select karein, quantity add karein.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_180px_120px]">
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">
            Search SKU
          </label>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Type SKU..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
        </div>

        <Select label="Supplier">
          <option>Select Supplier</option>
          <option>ALV</option>
          <option>HRT</option>
          <option>FFT</option>
          <option>PMM</option>
        </Select>

        <Input label="Qty" type="number" placeholder="1" />
      </div>

      <label className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <input type="checkbox" className="h-5 w-5 accent-emerald-600" />
        <div>
          <p className="text-sm font-black text-slate-800">Already in Warehouse</p>
          <p className="text-xs text-slate-500">Supplier ko order nahi dena.</p>
        </div>
      </label>

      <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-16 place-items-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200">
            <ImageIcon size={24} />
          </div>
          <div>
            <p className="font-black text-slate-900">Product preview</p>
            <p className="text-sm text-slate-500">Image, SKU, price, stock yahan show hoga.</p>
          </div>
        </div>
      </div>

      <button className="mt-5 inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 px-6 text-sm font-black text-white shadow-lg">
        <Plus size={18} />
        Add Product
      </button>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">SKU</th>
              <th className="px-4 py-3 text-left">Supplier</th>
              <th className="px-4 py-3 text-left">Qty</th>
              <th className="px-4 py-3 text-left">WH</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center font-bold text-slate-400">
                No products added yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input {...props} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-emerald-500 focus:bg-white" />
    </label>
  );
}

function Select({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <select className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-emerald-500 focus:bg-white">
        {children}
      </select>
    </label>
  );
}