"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  Share2,
  Layers3,
  CloudUpload,
  Images,
  Menu,
  X,
  Download,
  ListChecks,
  PackageCheck,
  MessageCircle,
  Database,
  Clock,
  Pin,
  PinOff,
  FileSpreadsheet,
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
  const [facebookOpen, setFacebookOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Pin state: Agar true ho to hover par band nahi hoga, permanently open rahega
  const [isPinned, setIsPinned] = useState(false);
  // Hovered state: Mouse andar hai ya bahar
  const [isHovered, setIsHovered] = useState(false);

  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sidebar tabhi collapsed hoga jab pin na ho aur mouse bhi upar na ho
  const isCollapsed = !isPinned && !isHovered;

  useEffect(() => {
    const savedPin = localStorage.getItem("sidebar_pinned");
    if (savedPin !== null) {
      setIsPinned(savedPin === "true");
    }
  }, []);

  // Jab bhi collapse state change ho, page layout ko notify karein
  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar_toggle", { detail: { collapsed: isCollapsed } })
      );
    });
  }, [isCollapsed]);

  // Mouse andar aane par
  function handleMouseEnter() {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    setIsHovered(true);
  }

  // Mouse bahar jaane par (150ms delay smooth UX ke liye)
  function handleMouseLeave() {
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  }

  function togglePin() {
    setIsPinned((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_pinned", String(next));
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const contentType = response.headers.get("content-type") || "";

        if (!response.ok || !contentType.includes("application/json")) {
          if (!cancelled) {
            setSession(null);
          }
          return;
        }

        const data = await response.json();

        if (!cancelled) {
          setSession(data?.success ? data.user : null);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/inventory")) {
      setInventoryOpen(true);
    }

    if (pathname.startsWith("/facebook")) {
      setFacebookOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!mobileOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  const permission = session?.permissions?.[0];

  const isAdmin = session?.role === "Admin" || session?.superAdmin;
  const canInventory = isAdmin || Boolean(permission?.canInventory);
  const isManager = session?.role === "Manager";
  const isEmployee = session?.role === "Employee" || session?.role === "Staff";
  const isEmployeeRole = session?.role === "Employee";
  const isSupplier = session?.role === "Supplier";

  const canR2Upload = Boolean(session) && !isSupplier && !isEmployeeRole;
  const canImages = isAdmin || isManager || isEmployee;
  const canSkuParser = (isAdmin || isManager || isEmployee) && !isSupplier;
  const canWhatsAppImport =
    (isAdmin || isManager || isEmployee) && !isEmployeeRole;
  const canFacebookPages = isAdmin;
  const canFacebookPost = isAdmin || isManager || isEmployee;
  const canFacebook = canFacebookPages || canFacebookPost;

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
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canView)),
      href: "/orders/quick-edit",
      label: "Orders Quick Edit",
      icon: ClipboardList,
    },
    {
      show:
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canView)),
      href: "/orders/uae-dispatch",
      label: "UAE Dispatch",
      icon: Truck,
    },
    {
      show:
        isAdmin ||
        session?.role === "Manager" ||
        Boolean(
          permission?.canReceive ||
            permission?.canDispatch ||
            session?.role === "Supplier",
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
      show:
        !isEmployeeRole &&
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canReports)),
      href: "/reports/ready-to-process",
      label: "Ready to Process",
      icon: ListChecks,
    },
    {
      show:
        session?.role !== "Supplier" &&
        (isAdmin ||
          Boolean(
            session?.permissions?.some(
              (item: any) =>
                Boolean(item?.canReports) &&
                ["app2hjpuQoeEL1Rn2", "app4YLp41AMlWtCxK"].includes(
                  String(item?.baseId || ""),
                ),
            ),
          )),
      href: "/courier/tfm",
      label: "TFM Shipments",
      icon: PackageCheck,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/courier",
      label: "Courier Summary",
      icon: BarChart3,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/courier-pending-update",
      label: "Courier Pending Update",
      icon: Truck,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/cod",
      label: "COD Pending",
      icon: ClipboardList,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/pending",
      label: "Pending Report",
      icon: BarChart3,
    },
    {
      show:
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canReports)),
      href: "/reports/order-pending",
      label: "Order Pending Report",
      icon: ClipboardList,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/order-received-pending",
      label: "Order Received Pending",
      icon: ClipboardList,
    },
    {
      show: isAdmin || Boolean(permission?.canReports),
      href: "/reports/monthly-cod",
      label: "Monthly COD Report",
      icon: BarChart3,
    },
    {
      show:
        isAdmin ||
        session?.role === "Supplier" ||
        Boolean(permission?.canReports),
      href: "/reports/supplier-activity",
      label: "Supplier Activity",
      icon: Truck,
    },
    {
      show: !isEmployeeRole && session?.role !== "Supplier",
      href: "/reports/supplier-bill-dispatch",
      label: "Supplier Bill Dispatch",
      icon: ClipboardList,
    },
    {
      show: !isEmployeeRole && session?.role !== "Supplier",
      href: "/reports/supplier-delayed",
      label: "Supplier Delayed",
      icon: Clock,
    },
    {
      show:
        !isEmployeeRole &&
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canReports)),
      href: "/reports/received-in-uae-delay",
      label: "Received In UAE Delay",
      icon: Clock,
    },
    {
      show:
        !isEmployeeRole &&
        session?.role !== "Supplier" &&
        (isAdmin || Boolean(permission?.canReports)),
      href: "/india-uae-transit",
      label: "India → UAE Transit",
      icon: Truck,
    },
    {
      show: isAdmin || isManager || isEmployee,
      href: "/orders/uae-receiving",
      label: "UAE Receiving",
      icon: PackageCheck,
    },
    {
      show: isAdmin || isManager || isEmployee,
      href: "/reports/doha-receiving",
      label: "Doha Receiving",
      icon: PackageCheck,
    },
    {
      show: isAdmin || isManager || isEmployee,
      href: "/orders/processing",
      label: "Processing Orders",
      icon: PackageCheck,
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
      href: "/admin/api-usage",
      label: "API Usage",
      icon: BarChart3,
    },
    {
      show: isAdmin,
      href: "/admin/schema",
      label: "Airtable Admin",
      icon: Database,
    },
    {
      show: isAdmin,
      href: "/project-export",
      label: "Project Export",
      icon: Download,
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
      (href !== "/dashboard" && pathname.startsWith(`${href}/`));

    return [
      "flex items-center rounded-2xl text-sm font-bold transition group relative",
      isCollapsed
        ? "justify-center p-3 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
        : "gap-3 px-4 py-3",
      active
        ? "bg-emerald-50 text-emerald-700"
        : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
    ].join(" ");
  }

  function childLinkClass(
    active: boolean,
    theme: "blue" | "emerald" = "blue",
  ) {
    return [
      "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition",
      active
        ? theme === "blue"
          ? "bg-blue-50 text-blue-700"
          : "bg-emerald-50 text-emerald-700"
        : theme === "blue"
          ? "text-slate-500 hover:bg-blue-50 hover:text-blue-700"
          : "text-slate-500 hover:bg-emerald-50 hover:text-emerald-700",
    ].join(" ");
  }

  const sortNavItems = (items: typeof nav, order: string[]) =>
    [...items].sort((first, second) => {
      const firstIndex = order.indexOf(first.href);
      const secondIndex = order.indexOf(second.href);
      const safeFirst = firstIndex === -1 ? 999 : firstIndex;
      const safeSecond = secondIndex === -1 ? 999 : secondIndex;

      return safeFirst - safeSecond;
    });

  const dashboardNav = nav.filter((item) => item.href === "/dashboard");

  const orderNav = sortNavItems(
    nav.filter(
      (item) =>
        item.href.startsWith("/orders") ||
        item.href === "/reports/ready-to-process",
    ),
    [
      "/orders/list",
      "/orders/grouped",
      "/orders/quick-edit",
      "/orders/uae-dispatch",
      "/reports/ready-to-process",
      "/exceptions",
    ],
  );

  const supplierNav = sortNavItems(
    nav.filter(
      (item) =>
        item.href === "/suppliers" ||
        item.href.includes("supplier-") ||
        item.href === "/reports/india-uae-transit",
    ),
    [
      "/suppliers",
      "/reports/supplier-activity",
      "/reports/supplier-bill-dispatch",
      "/reports/supplier-delayed",
      "/reports/received-in-uae-delay",
      "/reports/india-uae-transit",
    ],
  );

  const supplierPrimaryNav = supplierNav.filter(
    (item) => item.href === "/suppliers",
  );
  const supplierReportNav = supplierNav.filter(
    (item) => item.href !== "/suppliers",
  );

  const courierNav = sortNavItems(
    nav.filter(
      (item) =>
        item.href.startsWith("/courier") ||
        item.href.includes("/reports/courier"),
    ),
    [
      "/courier/tfm",
      "/reports/courier-pending-update",
      "/reports/courier",
    ],
  );

  const reportNav = sortNavItems(
    nav.filter(
      (item) =>
        item.href.startsWith("/reports") &&
        !orderNav.some((entry) => entry.href === item.href) &&
        !supplierNav.some((entry) => entry.href === item.href) &&
        !courierNav.some((entry) => entry.href === item.href),
    ),
    [
      "/reports",
      "/reports/doha-receiving",
      "/reports/cod",
      "/reports/pending",
      "/reports/order-pending",
      "/reports/order-received-pending",
      "/reports/monthly-cod",
    ],
  );

  const categorizedHrefs = new Set(
    [
      ...dashboardNav,
      ...orderNav,
      ...supplierNav,
      ...courierNav,
      ...reportNav,
    ].map((item) => item.href),
  );

  const otherNav = nav.filter((item) => !categorizedHrefs.has(item.href));

  function renderNavItems(items: typeof nav | typeof bottomNav) {
    return items.map((item) => {
      const Icon = item.icon;

      return (
        <Link
          key={item.href}
          href={item.href}
          title={isCollapsed ? item.label : undefined}
          className={navLinkClass(item.href)}
        >
          <Icon size={18} className="shrink-0" />
          {!isCollapsed && <span className="truncate">{item.label}</span>}
        </Link>
      );
    });
  }

  function renderSectionLabel(label: string) {
    if (isCollapsed) {
      return <div className="my-2 border-t border-slate-100" />;
    }

    return (
      <p className="px-4 pt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-30 grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-lg transition hover:bg-slate-50 lg:hidden"
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={22} />
      </button>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={[
          "fixed left-0 top-0 z-50 h-screen overflow-y-auto border-r border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out lg:z-40 lg:block lg:bg-white/90 lg:shadow-sm",
          isCollapsed ? "lg:w-20" : "lg:w-72",
          mobileOpen ? "w-72 translate-x-0" : "-translate-x-full lg:translate-x-0",
        ].join(" ")}
      >
        {/* Mobile Close Button */}
        <div className="mb-3 flex justify-end lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
            aria-label="Close navigation menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Top Header Card */}
        <div
          className={[
            "relative mb-4 rounded-3xl bg-gradient-to-br from-emerald-600 to-blue-600 text-white transition-all duration-300",
            isCollapsed ? "p-3" : "p-4",
          ].join(" ")}
        >
          <div
            className={[
              "flex items-center",
              isCollapsed ? "justify-center" : "gap-3",
            ].join(" ")}
          >
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20">
              <Sparkles size={22} />
            </div>

            {!isCollapsed && (
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-black leading-tight">
                  Mysmar ERP
                </h1>
                <p className="truncate text-xs text-white/80">
                  {session?.role || "Loading..."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Pin / Unpin Button */}
        <div className="mb-3 hidden px-1 lg:block">
          <button
            type="button"
            onClick={togglePin}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            title={isPinned ? "Unpin (Auto hide/show on hover)" : "Pin (Keep expanded)"}
          >
            {isPinned ? (
              <>
                <PinOff size={14} className="text-emerald-600" />
                {!isCollapsed && <span>Auto Hide: OFF</span>}
              </>
            ) : (
              <>
                <Pin size={14} />
                {!isCollapsed && <span>Auto Hide: ON</span>}
              </>
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5 pb-6">
          {renderNavItems(dashboardNav)}

          {orderNav.length > 0 && (
            <>
              {renderSectionLabel("Orders")}
              {renderNavItems(orderNav)}
            </>
          )}

          {(canInventory || canR2Upload || canImages || canSkuParser || isAdmin) && (
            <>
              {renderSectionLabel("Inventory & Images")}

              {canInventory && (
                <div>
                  <button
                    type="button"
                    onClick={() => setInventoryOpen((current) => !current)}
                    title={isCollapsed ? "Inventory" : undefined}
                    className={[
                      "flex w-full items-center rounded-2xl text-sm font-bold transition",
                      isCollapsed
                        ? "justify-center p-3 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
                        : "gap-3 px-4 py-3",
                      pathname.startsWith("/inventory")
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
                    ].join(" ")}
                    aria-expanded={inventoryOpen}
                  >
                    <Boxes size={18} className="shrink-0" />
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 text-left">Inventory</span>
                        <ChevronDown
                          size={17}
                          className={`transition-transform ${
                            inventoryOpen ? "rotate-180" : ""
                          }`}
                        />
                      </>
                    )}
                  </button>

                  {inventoryOpen && !isCollapsed && (
                    <div className="ml-5 mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                      <Link
                        href="/inventory/stock-received?type=dq"
                        className={childLinkClass(
                          pathname === "/inventory/stock-received" &&
                            searchParams.get("type") === "dq",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        DQ Stock Receive
                      </Link>

                      <Link
                        href="/inventory/stock-received?type=fab-stock"
                        className={childLinkClass(
                          pathname === "/inventory/stock-received" &&
                            searchParams.get("type") === "fab-stock",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        FAB Doha Stock Receive
                      </Link>

                      <div className="my-2 border-t border-slate-200" />

                      <Link
                        href="/inventory/list?type=dq"
                        className={childLinkClass(
                          pathname === "/inventory/list" &&
                            searchParams.get("type") === "dq",
                          "emerald",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        Inventory List DQ
                      </Link>

                      <Link
                        href="/inventory/list?type=fab-stock"
                        className={childLinkClass(
                          pathname === "/inventory/list" &&
                            searchParams.get("type") === "fab-stock",
                          "emerald",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        Inventory List FAB
                      </Link>

                      <div className="my-2 border-t border-slate-200" />

                      <Link
                        href="/stock/doha"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={childLinkClass(
                          pathname === "/stock/doha",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        FAB Doha Public Stock ↗
                      </Link>

                      <Link
                        href="/stock/uae"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={childLinkClass(
                          pathname === "/stock/uae",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        UAE Public Stock ↗
                      </Link>

                      <Link
                        href="/stock/upload"
                        className={childLinkClass(
                          pathname === "/stock/upload",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        Stock Image Upload
                      </Link>

                      <Link
                        href="/stock/manage"
                        className={childLinkClass(
                          pathname === "/stock/manage",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        Stock Manage
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {canR2Upload && (
                <Link
                  href="/r2/upload"
                  title={isCollapsed ? "Upload Center" : undefined}
                  className={navLinkClass("/r2/upload")}
                >
                  <CloudUpload size={18} className="shrink-0" />
                  {!isCollapsed && <span>Upload Center</span>}
                </Link>
              )}

              {canImages && (
                <Link
                  href="/r2/gallery"
                  title={isCollapsed ? "Images" : undefined}
                  className={navLinkClass("/r2/gallery")}
                >
                  <Images size={18} className="shrink-0" />
                  {!isCollapsed && <span>Images</span>}
                </Link>
              )}

              {canImages && (
                <Link
                  href="/images/product-generator"
                  title={isCollapsed ? "Product Image Generator" : undefined}
                  className={navLinkClass("/images/product-generator")}
                >
                  <Sparkles size={18} className="shrink-0" />
                  {!isCollapsed && <span>Product Image Generator</span>}
                </Link>
              )}

              {canSkuParser && (
                <Link
                  href="/tools/whatsapp-sku-parser"
                  title={isCollapsed ? "WhatsApp SKU Parser" : undefined}
                  className={navLinkClass("/tools/whatsapp-sku-parser")}
                >
                  <FileSpreadsheet size={18} className="shrink-0 text-emerald-600" />
                  {!isCollapsed && <span>WhatsApp SKU Parser</span>}
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/admin/r2-usage"
                  title={isCollapsed ? "R2 Usage" : undefined}
                  className={navLinkClass("/admin/r2-usage")}
                >
                  <BarChart3 size={18} className="shrink-0" />
                  {!isCollapsed && <span>R2 Usage</span>}
                </Link>
              )}
            </>
          )}

          {(supplierNav.length > 0 || canWhatsAppImport) && (
            <>
              {renderSectionLabel("Suppliers")}
              {renderNavItems(supplierPrimaryNav)}

              {canWhatsAppImport && (
                <Link
                  href="/whatsapp/supplier-import"
                  title={isCollapsed ? "WhatsApp Supplier Import" : undefined}
                  className={navLinkClass("/whatsapp/supplier-import")}
                >
                  <MessageCircle size={18} className="shrink-0" />
                  {!isCollapsed && <span>WhatsApp Supplier Import</span>}
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/timelines"
                  title={isCollapsed ? "Timelines" : undefined}
                  className={navLinkClass("/timelines")}
                >
                  <MessageCircle size={18} className="shrink-0" />
                  {!isCollapsed && <span>Timelines</span>}
                </Link>
              )}

              {renderNavItems(supplierReportNav)}
            </>
          )}

          {canFacebook && (
            <>
              {renderSectionLabel("Facebook")}
              <div>
                <button
                  type="button"
                  onClick={() => setFacebookOpen((current) => !current)}
                  title={isCollapsed ? "Facebook" : undefined}
                  className={[
                    "flex w-full items-center rounded-2xl text-sm font-bold transition",
                    isCollapsed
                      ? "justify-center p-3 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                      : "gap-3 px-4 py-3",
                    pathname.startsWith("/facebook")
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-blue-50 hover:text-blue-700",
                  ].join(" ")}
                  aria-expanded={facebookOpen}
                >
                  <Share2 size={18} className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left">Facebook</span>
                      <ChevronDown
                        size={17}
                        className={`transition-transform ${
                          facebookOpen ? "rotate-180" : ""
                        }`}
                      />
                    </>
                  )}
                </button>

                {facebookOpen && !isCollapsed && (
                  <div className="ml-5 mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                    {canFacebookPages && (
                      <Link
                        href="/facebook/pages"
                        className={childLinkClass(
                          pathname === "/facebook/pages",
                          "blue",
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        Pages
                      </Link>
                    )}

                    {canFacebookPost && (
                      <>
                        <Link
                          href="/facebook/post"
                          className={childLinkClass(
                            pathname === "/facebook/post",
                            "blue",
                          )}
                        >
                          <span className="h-2 w-2 rounded-full bg-current" />
                            Create Post
                        </Link>

                        <Link
                          href="/facebook/batch"
                          className={childLinkClass(
                            pathname.startsWith("/facebook/batch"),
                            "blue",
                          )}
                        >
                          <Layers3 size={15} />
                          Batch Posts
                        </Link>

                        <Link
                          href="/facebook/history"
                          className={childLinkClass(
                            pathname === "/facebook/history",
                            "blue",
                          )}
                        >
                          <span className="h-2 w-2 rounded-full bg-current" />
                          History
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {courierNav.length > 0 && (
            <>
              {renderSectionLabel("Couriers")}
              {renderNavItems(courierNav)}
            </>
          )}

          {reportNav.length > 0 && (
            <>
              {renderSectionLabel("Reports")}
              {renderNavItems(reportNav)}
            </>
          )}

          {otherNav.length > 0 && (
            <>
              {renderSectionLabel("Other")}
              {renderNavItems(otherNav)}
            </>
          )}

          {bottomNav.length > 0 && (
            <>
              {renderSectionLabel("Administration")}
              {renderNavItems(bottomNav)}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}