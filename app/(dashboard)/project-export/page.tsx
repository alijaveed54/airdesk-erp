"use client";

import {
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  FolderTree,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

type ExportResult = {
  fileName: string;
  treeEntries: string;
  includedFiles: string;
  skippedFiles: string;
  apiRoutes: string;
  pages: string;
};

export default function ProjectExportPage() {
  const [downloading, setDownloading] =
    useState(false);
  const [error, setError] = useState("");
  const [lastExport, setLastExport] =
    useState<ExportResult | null>(null);

  async function downloadProjectExport() {
    setDownloading(true);
    setError("");
    setLastExport(null);

    try {
      const response = await fetch(
        "/api/project-export",
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => null);

        throw new Error(
          data?.message ||
            "Unable to generate project export"
        );
      }

      const blob = await response.blob();

      const disposition =
        response.headers.get(
          "Content-Disposition"
        ) || "";

      const fileNameMatch =
        disposition.match(
          /filename="?([^";]+)"?/i
        );

      const fileName =
        fileNameMatch?.[1] ||
        `Mysmar_ERP_MASTER_Project_Handover_${new Date()
          .toISOString()
          .slice(0, 10)}.md`;

      const result: ExportResult = {
        fileName,
        treeEntries:
          response.headers.get(
            "X-Mysmar-Tree-Entries"
          ) || "—",
        includedFiles:
          response.headers.get(
            "X-Mysmar-Included-Files"
          ) || "—",
        skippedFiles:
          response.headers.get(
            "X-Mysmar-Skipped-Files"
          ) || "—",
        apiRoutes:
          response.headers.get(
            "X-Mysmar-Api-Routes"
          ) || "—",
        pages:
          response.headers.get(
            "X-Mysmar-Pages"
          ) || "—",
      };

      const url = URL.createObjectURL(blob);
      const link =
        document.createElement("a");

      link.href = url;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);

      setLastExport(result);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to generate project export"
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
            MASTER EXPORT v2
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
            Admin Only
          </span>
        </div>

        <h1 className="mt-3 text-3xl font-black text-slate-950">
          Project Export
        </h1>

        <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-500">
          Generate one complete AI handover directly
          from the current Mysmar ERP project. The
          export includes project rules, ChatGPT
          working rules, architecture, live route
          inventory, source tree, source/config files,
          documentation, environment-variable names,
          security notes, business rules, pending
          verification work, and export statistics.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {error}
        </div>
      )}

      {lastExport && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2
              size={22}
              className="mt-0.5 shrink-0 text-emerald-700"
            />

            <div className="min-w-0">
              <p className="font-black text-emerald-900">
                Master project export generated
                successfully.
              </p>

              <p className="mt-1 break-all text-xs font-bold text-emerald-700">
                {lastExport.fileName}
              </p>

              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-emerald-800">
                <StatPill
                  label="Tree"
                  value={lastExport.treeEntries}
                />
                <StatPill
                  label="Embedded"
                  value={lastExport.includedFiles}
                />
                <StatPill
                  label="API Routes"
                  value={lastExport.apiRoutes}
                />
                <StatPill
                  label="Pages"
                  value={lastExport.pages}
                />
                <StatPill
                  label="Skipped"
                  value={lastExport.skippedFiles}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          icon={FileText}
          title="A–Z AI Context"
          description="Project identity, business rules, ChatGPT working rules, security, testing discipline, pending verification and continuation instructions."
        />

        <InfoCard
          icon={FolderTree}
          title="Live Project Tree"
          description="Builds the current project tree at export time instead of depending only on old documentation."
        />

        <InfoCard
          icon={FileCode2}
          title="Current Source"
          description="Embeds readable source and configuration files, plus dynamic page/API inventories and package metadata."
        />

        <InfoCard
          icon={ShieldCheck}
          title="Secrets Protected"
          description="Secret files are excluded, environment values are redacted, and obvious credential literals are filtered."
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              Complete Master AI Project Handover
            </h2>

            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
              This is the export to upload into a new
              ChatGPT/AI conversation when continuing
              Mysmar ERP. Current source is treated as
              stronger implementation evidence than
              stale roadmap notes or backup files.
            </p>
          </div>

          <button
            type="button"
            onClick={downloadProjectExport}
            disabled={downloading}
            className="inline-flex min-w-[280px] items-center justify-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {downloading ? (
              <Loader2
                size={20}
                className="animate-spin"
              />
            ) : (
              <Download size={20} />
            )}

            {downloading
              ? "Building Master Export..."
              : "Download Master Project Export"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
          <h3 className="font-black text-blue-950">
            What the export decides automatically
          </h3>

          <ul className="mt-3 space-y-2 text-sm font-bold leading-6 text-blue-800">
            <li>
              • Current page routes and API routes
            </li>
            <li>
              • Current project/source file counts
            </li>
            <li>
              • Package scripts and dependencies
            </li>
            <li>
              • Environment-variable names only
            </li>
            <li>
              • Backup/historical file classification
            </li>
            <li>
              • Embedded/skipped export statistics
            </li>
          </ul>
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="font-black text-amber-900">
            Important
          </h3>

          <p className="mt-2 text-sm font-bold leading-6 text-amber-800">
            Project Export is Admin-only because it
            contains application structure and source
            code. Secret values are intentionally
            excluded/redacted. Do not publish the
            generated handover publicly.
          </p>

          <p className="mt-3 text-xs font-bold leading-5 text-amber-700">
            Hidden platform/system prompts are not
            exported. Project-specific ChatGPT rules
            and user-defined working rules are included.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-1">
      {label}: {value}
    </span>
  );
}

function InfoCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
        <Icon size={21} />
      </div>

      <h2 className="mt-4 font-black text-slate-900">
        {title}
      </h2>

      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}
