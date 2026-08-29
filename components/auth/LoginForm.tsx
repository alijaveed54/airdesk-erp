"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });

    const data = await res.json();
    console.log("LOGIN STATUS:", res.status);
console.log("LOGIN RESPONSE:", data);

    if (!res.ok || !data.success) {
      setMessage(data.message || "Login failed");
      setLoading(false);
      return;
    }

    window.location.href = data.redirectTo || "/dashboard";
    return;
  }

  return (
    <div className="w-full max-w-md rounded-[32px] bg-white p-8 shadow-2xl">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white">
        <ShieldCheck size={30} />
      </div>

      <h1 className="mt-6 text-center text-3xl font-black">Welcome Back</h1>
      <p className="mt-2 text-center text-slate-500">Login to Mysmar ERP</p>

      <form onSubmit={handleLogin} className="mt-8 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-bold">Username</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-12 w-full rounded-2xl border pl-11 pr-4"
              placeholder="admin"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold">Password</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-2xl border pl-11 pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-2xl bg-red-50 p-3 text-red-600">{message}</div>
        )}

        <button
          disabled={loading}
          className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 font-bold text-white disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>

      <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm">
        <p className="font-bold">Airtable Admin Base Login</p>
        <p>Users and permissions come from ERP Admin base.</p>
      </div>
    </div>
  );
}
