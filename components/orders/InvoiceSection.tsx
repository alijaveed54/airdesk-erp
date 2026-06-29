"use client";

export default function InvoiceSection() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">2. Invoice Basics</h2>
      <p className="mt-1 text-sm text-slate-500">
        Invoice number, date, status and contact link system automatically handle karega.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">
            Select Store
          </span>
          <select className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none focus:border-emerald-500 focus:bg-white">
            <option>Sooper Deals</option>
            <option>U5Store.com</option>
            <option>BestShop.ae</option>
            <option>FAB Ethnic UAE</option>
            <option>DesiLuxe</option>
          </select>
        </label>

        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <input type="checkbox" className="h-5 w-5 accent-emerald-600" />
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
    </div>
  );
}