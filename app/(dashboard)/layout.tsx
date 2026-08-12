import { Suspense } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <main className="min-h-screen flex-1 lg:pl-72">
          <Topbar />
          <div className="p-4 sm:p-6 lg:p-8">
            {children}
            <footer className="mt-10 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm">
                <img src="/ali-javed-sheikh.jpg" alt="Ali Javed Sheikh" className="h-10 w-10 rounded-full border-2 border-emerald-500 object-cover" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Designed &amp; Developed By</p>
                  <p className="text-sm font-black text-slate-900">Ali Javed Sheikh</p>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
