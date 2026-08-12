"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Building2,
  Loader2,
  LogOut,
  Search,
} from "lucide-react";

type BasePermission = {
  baseName: string;
  baseId: string;
};

type SessionUser = {
  username: string;
  fullName: string;
  role: string;
  permissions?: BasePermission[];
  availableBases?: BasePermission[];
  selectedBase?: BasePermission;
};

export default function Topbar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [switchingBase, setSwitchingBase] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setUser(data.user);
        }
      } finally {
        setLoadingUser(false);
      }
    }

    loadSession();
  }, []);

  const bases = useMemo(() => {
    if (!user) return [];

    const sourceBases = user.availableBases?.length
      ? user.availableBases
      : user.permissions || [];

    return Array.from(
      new Map(
        sourceBases
          .filter((base) => base?.baseId)
          .map((base) => [base.baseId, base])
      ).values()
    );
  }, [user]);

  const initials = useMemo(() => {
    const name = user?.fullName || user?.username || "User";

    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }, [user]);

  async function handleBaseChange(baseId: string) {
    if (!baseId || baseId === user?.selectedBase?.baseId) return;

    setSwitchingBase(true);

    try {
      const response = await fetch("/api/auth/select-base", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ baseId }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(data.message || "Base switch failed");
        return;
      }

      window.location.reload();
    } finally {
      setSwitchingBase(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      window.location.href = "/auth/login";
    }
  }

  const isSupplier = user?.role === "Supplier";

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 pl-16 pr-4 py-4 backdrop-blur-xl sm:pl-20 sm:pr-6 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="relative hidden w-full max-w-md md:block">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            size={18}
          />

          <input
            placeholder="Search anything..."
            className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-50"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {!loadingUser && user && !isSupplier && bases.length > 0 && (
            <div className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:flex">
              <Building2 size={17} className="text-blue-600" />

              <select
                value={user.selectedBase?.baseId || bases[0]?.baseId || ""}
                onChange={(event) => handleBaseChange(event.target.value)}
                disabled={switchingBase}
                className="max-w-[240px] bg-transparent text-sm font-black text-slate-800 outline-none disabled:opacity-60"
              >
                {bases.map((base) => (
                  <option key={base.baseId} value={base.baseId}>
                    {base.baseName}
                  </option>
                ))}
              </select>

              {switchingBase && (
                <Loader2 size={16} className="animate-spin text-blue-600" />
              )}
            </div>
          )}


          {!isSupplier && (
            <a
              href="/orders"
              className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              + Add Order
            </a>
          )}

          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <Bell size={18} />
          </button>

          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-100 text-sm font-black text-emerald-700">
              {initials || "U"}
            </div>

            <div className="hidden text-sm sm:block">
              <p className="font-bold text-slate-900">
                {loadingUser
                  ? "Loading..."
                  : user?.fullName || user?.username || "User"}
              </p>

              <p className="text-xs text-slate-500">
                {user?.role || ""}
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="ml-2 flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {loggingOut ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <LogOut size={16} />
              )}

              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
