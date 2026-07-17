"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Permission = {
  baseName: string;
  baseId: string;
  supplierCode?: string;
  canView: boolean;
  canEdit: boolean;
  canReports: boolean;
  canDispatch: boolean;
  canReceive: boolean;
  canInventory: boolean;
  canFinance: boolean;
  canUsers: boolean;
  canDelete: boolean;
};

type UserSession = {
  username: string;
  fullName: string;
  role: string;
  permissions: Permission[];
};

export default function BaseSelectPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [selectedBase, setSelectedBase] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadSession() {
    setLoading(true);

    const res = await fetch("/api/auth/me");
    const data = await res.json();

    if (!res.ok || !data.success) {
      router.push("/login");
      return;
    }

    setUser(data.user);
    setSelectedBase(data.user.permissions?.[0]?.baseName || "");
    setLoading(false);
  }

  async function continueToERP() {
    if (!selectedBase) {
      alert("Please select a company/base.");
      return;
    }

    setSaving(true);

    const res = await fetch("/api/auth/select-base", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseName: selectedBase }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      router.push(data.redirectTo || "/dashboard");
      router.refresh();
    } else {
      alert(data.message || "Base selection failed");
    }

    setSaving(false);
  }

  useEffect(() => {
    loadSession();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-3xl bg-white p-8 text-center font-black shadow-sm">
          Loading companies...
        </div>
      </div>
    );
  }

  const permissions = user?.permissions || [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-3xl font-black text-slate-950">Select Company</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">
            Welcome {user?.fullName || user?.username}. Choose the company/base you want to use.
          </p>
        </div>

        <div className="space-y-3">
          {permissions.map((permission) => (
            <button
              key={permission.baseName}
              type="button"
              onClick={() => setSelectedBase(permission.baseName)}
              className={`w-full rounded-2xl border p-4 text-left ${
                selectedBase === permission.baseName
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-black text-slate-950">{permission.baseName}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {permission.canReports ? "Reports" : ""}
                    {permission.canEdit ? " · Edit" : ""}
                    {permission.canDispatch ? " · Dispatch" : ""}
                    {permission.canReceive ? " · Receive" : ""}
                    {permission.supplierCode ? ` · Supplier: ${permission.supplierCode}` : ""}
                  </p>
                </div>

                <div
                  className={`h-5 w-5 rounded-full border ${
                    selectedBase === permission.baseName
                      ? "border-blue-600 bg-blue-600"
                      : "border-slate-300"
                  }`}
                />
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={continueToERP}
          disabled={saving || permissions.length === 0}
          className="mt-6 h-12 w-full rounded-2xl bg-slate-950 font-black text-white disabled:opacity-50"
        >
          {saving ? "Opening..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
