import Link from "next/link";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Eye,
  FileText,
  Package,
  PlusCircle,
  Printer,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  Users,
} from "lucide-react";
import StatCard from "@/components/ui/StatCard";

const quickActions = [
  {
    title: "Add Order",
    description: "Create new customer order",
    href: "/orders",
    icon: PlusCircle,
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    title: "Orders List",
    description: "Search, view and edit orders",
    href: "/orders/list",
    icon: ClipboardList,
    tone: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    title: "Grouped Orders",
    description: "Order wise grouped item view",
    href: "/orders/grouped",
    icon: Boxes,
    tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  {
    title: "Supplier Pending",
    description: "Pending supplier dispatch work",
    href: "/suppliers",
    icon: Truck,
    tone: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    title: "Products",
    description: "Product search and product view",
    href: "/products",
    icon: Package,
    tone: "bg-purple-50 text-purple-700 border-purple-200",
  },
  {
    title: "Reports",
    description: "Business reports and summaries",
    href: "/reports",
    icon: BarChart3,
    tone: "bg-slate-50 text-slate-700 border-slate-200",
  },
];

const modules = [
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Stores", href: "/stores", icon: Store },
  { title: "Print", href: "/orders/print", icon: Printer },
  { title: "Invoices", href: "/orders/list", icon: FileText },
  { title: "Product View", href: "/products", icon: Eye },
  { title: "Settings", href: "/settings", icon: Settings },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">
            Madni Hotel ERP
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Quick access for orders, products, suppliers and reports.
          </p>
        </div>

        <Link
          href="/orders"
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white"
        >
          + New Order
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Orders" value="ERP" icon={ShoppingBag} tone="blue" />
        <StatCard title="Products" value="Live" icon={Package} tone="emerald" />
        <StatCard title="Suppliers" value="Pending" icon={Truck} tone="amber" />
        <StatCard title="Reports" value="Next" icon={BarChart3} tone="purple" />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-xl font-black text-slate-950">Quick Actions</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Main ERP pages connected in one place.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;

            return (
              <Link
                key={action.href}
                href={action.href}
                className={`rounded-3xl border p-5 transition hover:-translate-y-0.5 hover:shadow-md ${action.tone}`}
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-white/80 p-3">
                    <Icon size={24} />
                  </div>

                  <div>
                    <h3 className="text-lg font-black">{action.title}</h3>
                    <p className="mt-1 text-sm font-bold opacity-80">
                      {action.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-xl font-black text-slate-950">Modules</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Extra shortcuts for daily work.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {modules.map((module) => {
            const Icon = module.icon;

            return (
              <Link
                key={module.title}
                href={module.href}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-black text-slate-800 hover:bg-white hover:shadow-sm"
              >
                <Icon size={18} />
                {module.title}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
