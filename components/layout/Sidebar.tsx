"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Boxes,
  BarChart3,
  Users,
  Settings,
  ClipboardList,
  Truck,
  Sparkles,
  ChevronDown,
} from "lucide-react";

type Session = {
  role: string;
  superAdmin?: boolean;
  permissions: any[];
};

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [session, setSession] = useState<Session | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          setSession(data.user);
        }
      });
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/inventory")) {
      setInventoryOpen(true);
    }
  }, [pathname]);

  const permission = session?.permissions?.[0];

  const isAdmin =
    session?.role === "Admin" || session?.superAdmin;

  const canInventory =
    isAdmin || Boolean(permission?.canInventory);

  const nav = [
    {
      show: true,
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      show:
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canView)),
      href: "/orders/list",
      label: "Orders List",
      icon: ShoppingBag,
    },
    {
      show:
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canView)),
      href: "/orders/grouped",
      label: "Grouped Orders",
      icon: ShoppingBag,
    },
    {
      show:
        isAdmin ||
        Boolean(
          permission?.canReceive ||
            permission?.canDispatch ||
            session?.role === "Supplier"
        ),
      href: "/suppliers",
      label: "Supplier Pending",
      icon: Truck,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports",
      label: "Reports Home",
      icon: BarChart3,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/courier",
      label: "Courier Report",
      icon: BarChart3,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/pending",
      label: "Pending Report",
      icon: BarChart3,
    },
  ].filter((item) => item.show);

  const bottomNav = [
    {
      show: isAdmin || Boolean(permission?.canUsers),
      href: "/users",
      label: "Users",
      icon: Users,
    },
    {
      show: isAdmin,
      href: "/activity",
      label: "Activity Log",
      icon: ClipboardList,
    },
    {
      show: true,
      href: "/change-password",
      label: "Change Password",
      icon: Settings,
    },
    {
      show: isAdmin,
      href: "/settings",
      label: "Settings",
      icon: Settings,
    },
  ].filter((item) => item.show);

  function navLinkClass(href: string) {
    const active =
      pathname === href ||
      (href !== "/dashboard" &&
        pathname.startsWith(`${href}/`));

    return [
      "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition",
      active
        ? "bg-emerald-50 text-emerald-700"
        : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
    ].join(" ");
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-72 overflow-y-auto border-r border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-xl lg:block">
      <div className="mb-6 rounded-3xl bg-gradient-to-br from-emerald-600 to-blue-600 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20">
            <Sparkles size={22} />
          </div>

          <div>
            <h1 className="text-xl font-black">
              Mysmar ERP
            </h1>

            <p className="text-xs text-white/80">
              {session?.role || "Loading..."}
            </p>
          </div>
        </div>
      </div>

      <nav className="space-y-2">
        {nav.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={navLinkClass(item.href)}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}

        {canInventory && (
          <div>
            <button
              type="button"
              onClick={() =>
                setInventoryOpen((current) => !current)
              }
              className={[
                "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition",
                pathname.startsWith("/inventory")
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
              ].join(" ")}
              aria-expanded={inventoryOpen}
            >
              <Boxes size={18} />

              <span className="flex-1 text-left">
                Inventory
              </span>

              <ChevronDown
                size={17}
                className={`transition-transform ${
                  inventoryOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {inventoryOpen && (
              <div className="ml-5 mt-2 space-y-1 border-l-2 border-slate-200 pl-3">

                <Link
                  href="/inventory/stock-received?type=dq"
                  className={[
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                    pathname === "/inventory/stock-received" &&
                    searchParams.get("type") === "dq"
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-blue-50 hover:text-blue-700",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  DQ Stock Receive
                </Link>

                <Link
                  href="/inventory/stock-received?type=fab-stock"
                  className={[
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                    pathname === "/inventory/stock-received" &&
                    searchParams.get("type") === "fab-stock"
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-blue-50 hover:text-blue-700",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  FAB Doha Stock Receive
                </Link>

                <div className="my-2 border-t border-slate-200" />

                <Link
                  href="/inventory/list?type=dq"
                  className={[
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                    pathname === "/inventory/list" &&
                    searchParams.get("type") === "dq"
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-500 hover:bg-emerald-50 hover:text-emerald-700",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  Inventory List DQ
                </Link>

                <Link
                  href="/inventory/list?type=fab-stock"
                  className={[
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                    pathname === "/inventory/list" &&
                    searchParams.get("type") === "fab-stock"
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-500 hover:bg-emerald-50 hover:text-emerald-700",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  Inventory List FAB
                </Link>
              </div>
            )}
          </div>
        )}

        {bottomNav.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={navLinkClass(item.href)}
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
