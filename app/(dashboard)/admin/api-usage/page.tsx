"use client";

import { useEffect, useMemo, useState } from "react";

type RangeKey = "1" | "7" | "30" | "all";

type UsageUser = {
  username: string;
  fullName: string;
  role: string;
  totalCalls: number;
  endpointCount: number;
  lastCallAt: string;
};

type UsageEndpoint = {
  username: string;
  companyName: string;
  provider: string;
  route: string;
  method: string;
  callCount: number;
  firstCalledAt: string;
  lastCalledAt: string;
};

type UsageResponse = {
  success: boolean;
  message?: string;
  trackingScope?: string;
  deploymentEnvironment?: string;
  trackingActiveHere?: boolean;
  range?: RangeKey;
  startDate?: string | null;
  totalCalls?: number;
  users?: UsageUser[];
  endpoints?: UsageEndpoint[];
};

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
  { value: "all", label: "All Time" },
];

function formatDate(value: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

export default function ApiUsagePage() {
  const [range, setRange] = useState<RangeKey>("30");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UsageResponse>({ success: true });

  async function loadUsage(nextRange: RangeKey = range) {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/admin/api-usage?range=${encodeURIComponent(nextRange)}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as UsageResponse;

      if (!response.ok || !json.success) {
        throw new Error(json.message || "API usage load failed");
      }

      setData(json);
    } catch (error) {
      alert(error instanceof Error ? error.message : "API usage load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsage(range);
  }, [range]);

  const users = data.users || [];
  const endpoints = data.endpoints || [];

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;

    return users.filter((user) =>
      [user.username, user.fullName, user.role].some((value) =>
        String(value || "").toLowerCase().includes(query),
      ),
    );
  }, [users, search]);

  const activeSelectedUser =
    selectedUser && users.some((user) => user.username === selectedUser)
      ? selectedUser
      : filteredUsers[0]?.username || "";

  const selectedEndpoints = useMemo(
    () =>
      endpoints
        .filter((item) => item.username === activeSelectedUser)
        .sort((a, b) => b.callCount - a.callCount),
    [endpoints, activeSelectedUser],
  );

  const topUser = users[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-950">API Usage Tracker</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            Real outbound provider API calls per logged-in user. Vercel counts; localhost is ignored.
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">
          Tracking: Vercel only
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Outbound Calls", Number(data.totalCalls || 0).toLocaleString()],
          ["Users Using API", users.length.toLocaleString()],
          ["Top User", topUser?.username || "-"],
          ["Environment", data.deploymentEnvironment || "local"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-black uppercase text-slate-500">{label}</p>
            <p className="mt-2 break-words text-3xl font-black text-slate-950">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-black transition",
                  range === option.value
                    ? "bg-slate-950 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search user or role"
              className="h-10 min-w-[240px] rounded-xl border px-3 font-bold"
            />

            <button
              type="button"
              onClick={() => void loadUsage(range)}
              disabled={loading}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Full Name</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-right">API Calls</th>
                <th className="px-4 py-3 text-right">Endpoints</th>
                <th className="px-4 py-3 text-left">Last Call</th>
                <th className="px-4 py-3 text-center">Details</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.username} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3 font-black">{user.username}</td>
                  <td className="px-4 py-3 font-bold">{user.fullName || "-"}</td>
                  <td className="px-4 py-3 font-bold">{user.role || "-"}</td>
                  <td className="px-4 py-3 text-right text-lg font-black">
                    {user.totalCalls.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-black">
                    {user.endpointCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-bold">
                    {formatDate(user.lastCallAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setSelectedUser(user.username)}
                      className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && filteredUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    No tracked API usage found for this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">External API Breakdown</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">
              {activeSelectedUser
                ? `User: ${activeSelectedUser}`
                : "Select a tracked user to see provider-level usage."}
            </p>
          </div>

          {users.length > 0 && (
            <select
              value={activeSelectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              className="h-10 rounded-xl border bg-white px-3 font-bold"
            >
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[950px] text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left">Provider</th>
                <th className="px-4 py-3 text-left">Method</th>
                <th className="px-4 py-3 text-left">External Endpoint</th>
                <th className="px-4 py-3 text-left">Base</th>
                <th className="px-4 py-3 text-right">Calls</th>
                <th className="px-4 py-3 text-left">Last Call</th>
              </tr>
            </thead>

            <tbody>
              {selectedEndpoints.map((item) => (
                <tr
                  key={`${item.username}-${item.companyName}-${item.method}-${item.route}`}
                  className="border-t hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-black">{item.provider || "-"}</td>
                  <td className="px-4 py-3 font-black">{item.method}</td>
                  <td className="px-4 py-3 font-mono text-xs font-bold">
                    {item.route}
                  </td>
                  <td className="px-4 py-3 font-bold">
                    {item.companyName || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-lg font-black">
                    {item.callCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-bold">
                    {formatDate(item.lastCalledAt)}
                  </td>
                </tr>
              ))}

              {activeSelectedUser && selectedEndpoints.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center font-bold text-slate-500"
                  >
                    No external API usage found for this user in the selected range.
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
