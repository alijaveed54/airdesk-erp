import { Bell, Search } from "lucide-react";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="relative hidden w-full max-w-md md:block">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            placeholder="Search anything..."
            className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-50"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50">
            <Bell size={18} />
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700">
              A
            </div>
            <div className="hidden text-sm sm:block">
              <p className="font-bold text-slate-900">Ali Javed</p>
              <p className="text-xs text-slate-500">Admin</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
