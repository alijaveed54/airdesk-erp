import LoginForm from "@/components/auth/LoginForm";
import { Database, ShieldCheck, Users } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d1fae5,transparent_35%),radial-gradient(circle_at_bottom_right,#dbeafe,transparent_35%),#f8fafc]">
      <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden flex-col justify-between p-10 lg:flex">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-100">
              <Database size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-950">
                Mysmar ERP
              </h1>
              <p className="text-sm font-medium text-slate-500">
                Airtable-powered operating system
              </p>
            </div>
          </div>

          <div className="max-w-2xl">
            <span className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-700">
              MVP Sprint — 2 Weeks
            </span>

            <h2 className="mt-6 text-5xl font-black tracking-tight text-slate-950">
              One clean portal for products, orders, images and staff access.
            </h2>

            <p className="mt-5 text-lg leading-8 text-slate-600">
              Employees use Mysmar ERP. Airtable stays protected in the
              background. Admin controls users, roles and module access.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <FeatureCard icon={ShieldCheck} title="Secure" text="Role based access" />
              <FeatureCard icon={Users} title="Team Ready" text="Admin, Manager, Staff" />
              <FeatureCard icon={Database} title="Airtable" text="API powered backend" />
            </div>
          </div>

          <p className="text-sm text-slate-400">© 2026 Mysmar ERP</p>
        </section>

        <section className="flex items-center justify-center p-5 sm:p-8">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Icon size={22} />
      </div>
      <p className="mt-4 font-black text-slate-950">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}