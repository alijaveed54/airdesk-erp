import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Boxes,
  ImageIcon,
  BarChart3,
  Users,
  Settings,
  Sparkles,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/images", label: "Images", icon: ImageIcon },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-72 border-r border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-xl lg:block">
      <div className="mb-6 rounded-3xl bg-gradient-to-br from-emerald-600 to-blue-600 p-5 text-white shadow-lg shadow-emerald-100">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black leading-tight">Mysmar ERP</h1>
            <p className="text-xs font-medium text-white/80">Airtable Operating System</p>
          </div>
        </div>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
