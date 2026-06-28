import { Package, ShoppingBag, Users, ImageIcon } from "lucide-react";
import StatCard from "@/components/ui/StatCard";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-950">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Mysmar ERP overview for products, orders and team activity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Products" value="0" icon={Package} tone="emerald" />
        <StatCard title="Orders" value="0" icon={ShoppingBag} tone="blue" />
        <StatCard title="Images" value="0" icon={ImageIcon} tone="amber" />
        <StatCard title="Users" value="3 Roles" icon={Users} tone="purple" />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">Welcome to Mysmar ERP</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          This is the first professional shell. Next step will connect Products
          module with Airtable schema and permissions.
        </p>
      </div>
    </div>
  );
}
