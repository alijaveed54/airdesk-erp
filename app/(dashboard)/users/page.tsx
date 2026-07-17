"use client";

import { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  username: string;
  password: string;
  email: string;
  fullName: string;
  role: string;
  defaultBase: string;
  superAdmin: boolean;
  lastLogin: string;
  loginCount: number;
  active: boolean;
  access: any[];
};

type BaseRow = {
  id: string;
  baseName: string;
  baseId: string;
  active: boolean;
};

type AccessForm = {
  id?: string;
  username: string;
  baseName: string;
  supplierCode: string;
  canView: boolean;
  canEdit: boolean;
  canReports: boolean;
  canDispatch: boolean;
  canReceive: boolean;
  canInventory: boolean;
  canFinance: boolean;
  canUsers: boolean;
  canDelete: boolean;
  active: boolean;
};

const roles = [
  "Admin",
  "Manager",
  "Employee",
  "Warehouse",
  "Accounts",
  "Supplier",
];

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [bases, setBases] = useState<BaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const emptyAccessForm: AccessForm = {
    username: "",
    baseName: "",
    supplierCode: "",
    canView: true,
    canEdit: false,
    canReports: false,
    canDispatch: false,
    canReceive: false,
    canInventory: false,
    canFinance: false,
    canUsers: false,
    canDelete: false,
    active: true,
  };

  const [accessForm, setAccessForm] = useState<AccessForm>(emptyAccessForm);

  const [form, setForm] = useState({
    username: "",
    password: "",
    email: "",
    fullName: "",
    role: "Employee",
    defaultBase: "",
    superAdmin: false,
    active: true,
  });

  async function loadUsers() {
    setLoading(true);

    const res = await fetch("/api/users");
    const data = await res.json();

    if (res.ok && data.success) {
      setUsers(data.users || []);
      setBases(data.bases || []);
    } else {
      alert(data.message || "Users load failed");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return users;

    return users.filter((user) =>
      [user.username, user.fullName, user.email, user.role].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [users, search]);

  const activeUsers = users.filter((user) => user.active).length;
  const inactiveUsers = users.length - activeUsers;
  const superAdmins = users.filter((user) => user.superAdmin).length;

  async function createUser() {
    if (!form.username || !form.password || !form.fullName) {
      alert("Username, password and full name required");
      return;
    }

    setSaving(true);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(form),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setForm({
        username: "",
        password: "",
        email: "",
        fullName: "",
        role: "Employee",
        defaultBase: "",
        superAdmin: false,
        active: true,
      });
      await loadUsers();
    } else {
      alert(data.message || "User create failed");
    }

    setSaving(false);
  }

  async function updateUser(id: string, patch: Record<string, any>) {
    setSaving(true);

    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
        ...patch,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      await loadUsers();
    } else {
      alert(data.message || "User update failed");
    }

    setSaving(false);
  }

  async function deleteUser(user: UserRow) {
    if (!confirm(`Delete user "${user.username}" and all base access?`)) return;

    setSaving(true);

    const res = await fetch(
      `/api/users?type=user&id=${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    );

    const data = await res.json();

    if (res.ok && data.success) {
      await loadUsers();
    } else {
      alert(data.message || "User delete failed");
    }

    setSaving(false);
  }

  async function editUser(user: UserRow) {
    const fullName = prompt("Full Name", user.fullName);
    if (fullName === null) return;

    const email = prompt("Email", user.email || "");
    if (email === null) return;

    await updateUser(user.id, {
      fullName: fullName.trim(),
      email: email.trim(),
    });
  }

  function startAddBaseAccess(user: UserRow) {
    setAccessForm({
      ...emptyAccessForm,
      username: user.username,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getAvailableBases() {
    if (!accessForm.username) return bases;

    const selectedUser = users.find(
      (user) => user.username === accessForm.username,
    );

    if (!selectedUser) return bases;

    const alreadyAssigned = new Set(
      selectedUser.access
        .filter((item) => !accessForm.id || item.id !== accessForm.id)
        .map((item) =>
          String(item.baseName || "")
            .trim()
            .toLowerCase(),
        ),
    );

    return bases.filter(
      (base) =>
        !alreadyAssigned.has(
          String(base.baseName || "")
            .trim()
            .toLowerCase(),
        ),
    );
  }

  async function saveAccess() {
    if (!accessForm.username || !accessForm.baseName) {
      alert("Select user and base first");
      return;
    }

    const selectedUser = users.find(
      (user) => user.username === accessForm.username,
    );

    const duplicateAccess = selectedUser?.access.some(
      (item) =>
        item.id !== accessForm.id &&
        String(item.baseName || "")
          .trim()
          .toLowerCase() === accessForm.baseName.trim().toLowerCase(),
    );

    if (duplicateAccess) {
      alert("This user already has access to the selected base.");
      return;
    }

    setSaving(true);

    const res = await fetch("/api/users", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(accessForm),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      setAccessForm(emptyAccessForm);
      await loadUsers();
    } else {
      alert(data.message || "Base access save failed");
    }

    setSaving(false);
  }

  async function deleteAccess(id: string) {
    if (!confirm("Remove this base access?")) return;

    setSaving(true);

    const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (res.ok && data.success) {
      await loadUsers();
    } else {
      alert(data.message || "Base access delete failed");
    }

    setSaving(false);
  }

  function editAccess(username: string, access: any) {
    setAccessForm({
      id: access.id,
      username,
      baseName: access.baseName,
      supplierCode: access.supplierCode || "",
      canView: access.canView === true,
      canEdit: access.canEdit === true,
      canReports: access.canReports === true,
      canDispatch: access.canDispatch === true,
      canReceive: access.canReceive === true,
      canInventory: access.canInventory === true,
      canFinance: access.canFinance === true,
      canUsers: access.canUsers === true,
      canDelete: access.canDelete === true,
      active: access.active !== false,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-950">User Management</h1>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Add users, edit roles, disable accounts and manage passwords.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Total Users", users.length],
          ["Active Users", activeUsers],
          ["Inactive Users", inactiveUsers],
          ["Super Admins", superAdmins],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-black uppercase text-slate-500">
              {label}
            </p>
            <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black text-slate-950">Add User</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Username"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Password"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <input
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            placeholder="Full Name"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Email"
            className="h-11 rounded-xl border px-3 font-bold"
          />

          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="h-11 rounded-xl border bg-white px-3 font-bold"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          <select
            value={form.defaultBase}
            onChange={(e) => setForm({ ...form, defaultBase: e.target.value })}
            className="h-11 rounded-xl border bg-white px-3 font-bold"
          >
            <option value="">Default Base optional</option>
            {bases.map((base) => (
              <option key={base.id} value={base.baseName}>
                {base.baseName}
              </option>
            ))}
          </select>

          <label className="flex h-11 items-center gap-2 rounded-xl border px-3 font-bold">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active
          </label>

          <label className="flex h-11 items-center gap-2 rounded-xl border px-3 font-bold">
            <input
              type="checkbox"
              checked={form.superAdmin}
              onChange={(e) =>
                setForm({ ...form, superAdmin: e.target.checked })
              }
            />
            Super Admin
          </label>

          <button
            type="button"
            onClick={createUser}
            disabled={saving}
            className="h-11 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Create User"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">
            Base Access & Permissions
          </h2>

          {accessForm.username && (
            <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-blue-700">
              User: {accessForm.username}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <select
            value={accessForm.username}
            disabled={!!accessForm.username}
            onChange={(e) =>
              setAccessForm({
                ...accessForm,
                username: e.target.value,
                baseName: "",
              })
            }
            className="h-11 rounded-xl border bg-white px-3 font-bold disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="">Select User</option>
            {users.map((user) => (
              <option key={user.id} value={user.username}>
                {user.username} - {user.fullName}
              </option>
            ))}
          </select>

          <select
            value={accessForm.baseName}
            onChange={(e) =>
              setAccessForm({ ...accessForm, baseName: e.target.value })
            }
            className="h-11 rounded-xl border bg-white px-3 font-bold"
          >
            <option value="">Select Base</option>
            {getAvailableBases().map((base) => (
              <option key={base.id} value={base.baseName}>
                {base.baseName}
              </option>
            ))}
          </select>

          <input
            value={accessForm.supplierCode}
            onChange={(e) =>
              setAccessForm({ ...accessForm, supplierCode: e.target.value })
            }
            placeholder="Supplier Code optional"
            className="h-11 rounded-xl border px-3 font-bold"
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {[
            ["canView", "View"],
            ["canEdit", "Edit"],
            ["canReports", "Reports"],
            ["canDispatch", "Dispatch"],
            ["canReceive", "Receive"],
            ["canInventory", "Inventory"],
            ["canFinance", "Finance"],
            ["canUsers", "Users"],
            ["canDelete", "Delete"],
            ["active", "Active"],
          ].map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black"
            >
              <input
                type="checkbox"
                checked={(accessForm as any)[key]}
                onChange={(e) =>
                  setAccessForm({
                    ...accessForm,
                    [key]: e.target.checked,
                  } as AccessForm)
                }
              />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={saveAccess}
            disabled={saving}
            className="h-11 rounded-xl bg-blue-600 px-5 font-black text-white disabled:opacity-50"
          >
            {accessForm.id ? "Update Access" : "Add Access"}
          </button>

          <button
            type="button"
            onClick={() => setAccessForm({ ...emptyAccessForm })}
            disabled={saving}
            className="h-11 rounded-xl border border-slate-300 bg-white px-5 font-black disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Users</h2>

          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search username, name, email or role"
              className="h-10 min-w-[280px] rounded-xl border px-3 font-bold"
            />

            <button
              type="button"
              onClick={loadUsers}
              disabled={loading}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="bg-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Username</th>
                <th className="px-4 py-3 text-left">Full Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-center">Active</th>
                <th className="px-4 py-3 text-center">Super Admin</th>
                <th className="px-4 py-3 text-left">Last Login</th>
                <th className="px-4 py-3 text-center">Login Count</th>
                <th className="px-4 py-3 text-left">Base Access</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3 font-black">{user.username}</td>
                  <td className="px-4 py-3 font-bold">{user.fullName}</td>
                  <td className="px-4 py-3 font-bold">{user.email || "-"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) =>
                        updateUser(user.id, {
                          role: e.target.value,
                        })
                      }
                      className="h-10 rounded-xl border bg-white px-3 font-bold"
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={user.active}
                      onChange={(e) =>
                        updateUser(user.id, {
                          active: e.target.checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={user.superAdmin}
                      onChange={(e) =>
                        updateUser(user.id, {
                          superAdmin: e.target.checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 font-bold">
                    {user.lastLogin
                      ? new Date(user.lastLogin).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-center font-black">
                    {user.loginCount || 0}
                  </td>
                  <td className="px-4 py-3 font-bold">
                    {user.access.length ? (
                      <div className="space-y-2">
                        {user.access.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2"
                          >
                            <span>{item.baseName}</span>
                            {item.supplierCode ? (
                              <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-800">
                                {item.supplierCode}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => editAccess(user.username, item)}
                              className="rounded-lg border bg-white px-2 py-1 text-xs font-black"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAccess(item.id)}
                              className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-black text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      "No Access"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startAddBaseAccess(user)}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                      >
                        + Add Base Access
                      </button>

                      <button
                        type="button"
                        onClick={() => editUser(user)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black"
                      >
                        Edit User
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const password = prompt("Enter new password");
                          if (password) updateUser(user.id, { password });
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black"
                      >
                        Reset Password
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteUser(user)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                      >
                        Delete User
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filteredUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    No users found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center font-bold text-blue-600"
                  >
                    Loading users...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
