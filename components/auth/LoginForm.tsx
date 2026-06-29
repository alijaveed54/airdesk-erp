"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";

const demoUsers = [
  { email: "admin@mysmar.com", password: "admin123", role: "Admin" },
  { email: "manager@mysmar.com", password: "manager123", role: "Manager" },
  { email: "staff@mysmar.com", password: "staff123", role: "Staff" },
];

export default function LoginForm() {
  const [email, setEmail] = useState("admin@mysmar.com");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const user = demoUsers.find(
      (u) =>
        u.email.toLowerCase() === email.toLowerCase() &&
        u.password === password
    );

    if (!user) {
      setMessage("Invalid Email or Password");
      return;
    }

    localStorage.setItem(
      "mysmar_session",
      JSON.stringify({
        email: user.email,
        role: user.role,
      })
    );

    window.location.href = "/dashboard";
  }

  return (
    <div className="w-full max-w-md rounded-[32px] bg-white p-8 shadow-2xl">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white">
        <ShieldCheck size={30} />
      </div>

      <h1 className="mt-6 text-center text-3xl font-black">
        Welcome Back
      </h1>

      <p className="mt-2 text-center text-slate-500">
        Login to Mysmar ERP
      </p>

      <form onSubmit={handleLogin} className="mt-8 space-y-4">

        <div>
          <label className="mb-2 block text-sm font-bold">
            Email
          </label>

          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />

            <input
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              className="h-12 w-full rounded-2xl border pl-11 pr-4"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold">
            Password
          </label>

          <div className="relative">

            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>

            <input
              type={showPassword?"text":"password"}
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              className="h-12 w-full rounded-2xl border pl-11 pr-12"
            />

            <button
              type="button"
              onClick={()=>setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>

          </div>

        </div>

        {message && (
          <div className="rounded-2xl bg-red-50 p-3 text-red-600">
            {message}
          </div>
        )}

        <button
          className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 font-bold text-white"
        >
          Login
        </button>

      </form>

      <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm">
        <p className="font-bold">Demo Accounts</p>

        <p>Admin : admin@mysmar.com / admin123</p>

        <p>Manager : manager@mysmar.com / manager123</p>

        <p>Staff : staff@mysmar.com / staff123</p>

      </div>

    </div>
  );
}