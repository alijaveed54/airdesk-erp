"use client";

import {
  CheckCircle2,
  KeyRound,
  Link2,
  Share2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type FacebookPage = {
  id: string;
  pageName: string;
  pageId: string;
  active: boolean;
  isDefault: boolean;
  tokenPreview: string;
  defaultCaption: string;
  createdAt: string;
};

type ApiResponse = {
  success: boolean;
  message?: string;
  pages?: FacebookPage[];
  page?: FacebookPage;
};

const EMPTY_FORM = {
  pageName: "",
  pageId: "",
  pageToken: "",
  defaultCaption: "",
  active: true,
  isDefault: false,
};

export default function FacebookPagesPage() {
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [reconnectPage, setReconnectPage] =
    useState<FacebookPage | null>(null);
  const [reconnectToken, setReconnectToken] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/facebook/pages", {
        cache: "no-store",
      });
      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook Pages load nahi ho sake.");
      }

      const loadedPages = data.pages || [];
      setPages(loadedPages);
      setCaptionDrafts(
        Object.fromEntries(
          loadedPages.map((page) => [page.id, page.defaultCaption || ""]),
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Facebook Pages load nahi ho sake."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  function clearNotices() {
    setMessage("");
    setError("");
  }

  async function handleAddPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();

    if (!form.pageName.trim() || !form.pageId.trim() || !form.pageToken.trim()) {
      setError("Page Name, Page ID aur Page Token required hain.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/facebook/pages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook Page save nahi hua.");
      }

      setForm(EMPTY_FORM);
      setMessage(data.message || "Facebook Page save ho gaya.");
      await loadPages();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Facebook Page save nahi hua."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updatePage(
    recordId: string,
    changes: Record<string, boolean | string>
  ) {
    clearNotices();
    setBusyId(recordId);

    try {
      const response = await fetch("/api/facebook/pages", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordId,
          ...changes,
        }),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook Page update nahi hua.");
      }

      setMessage(data.message || "Facebook Page update ho gaya.");
      await loadPages();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Facebook Page update nahi hua."
      );
    } finally {
      setBusyId("");
    }
  }

  async function testPage(recordId: string) {
    clearNotices();
    setBusyId(recordId);

    try {
      const response = await fetch("/api/facebook/pages", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordId,
          action: "test",
        }),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook connection test failed.");
      }

      setMessage(data.message || "Facebook connection successful.");
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "Facebook connection test failed."
      );
    } finally {
      setBusyId("");
    }
  }


  function openReconnect(page: FacebookPage) {
    clearNotices();
    setReconnectPage(page);
    setReconnectToken("");
  }

  function closeReconnect() {
    if (reconnecting) return;

    setReconnectPage(null);
    setReconnectToken("");
  }

  async function reconnectFacebookPage(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    clearNotices();

    if (!reconnectPage) return;

    if (!reconnectToken.trim()) {
      setError(
        "Fresh Facebook User Access Token ya Page Access Token required hai."
      );
      return;
    }

    setReconnecting(true);
    setBusyId(reconnectPage.id);

    try {
      const response = await fetch("/api/facebook/pages", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordId: reconnectPage.id,
          action: "reconnect",
          accessToken: reconnectToken.trim(),
        }),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Facebook Page reconnect nahi hua."
        );
      }

      setMessage(
        data.message || "Facebook Page successfully reconnect ho gaya."
      );
      setReconnectPage(null);
      setReconnectToken("");
      await loadPages();
    } catch (reconnectError) {
      setError(
        reconnectError instanceof Error
          ? reconnectError.message
          : "Facebook Page reconnect nahi hua."
      );
    } finally {
      setReconnecting(false);
      setBusyId("");
    }
  }

  async function deletePage(recordId: string, pageName: string) {
    const confirmed = window.confirm(
      `"${pageName}" ko Facebook Pages list se delete karna hai?`
    );

    if (!confirmed) return;

    clearNotices();
    setBusyId(recordId);

    try {
      const response = await fetch(
        `/api/facebook/pages?recordId=${encodeURIComponent(recordId)}`,
        {
          method: "DELETE",
        }
      );

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Facebook Page delete nahi hua.");
      }

      setMessage(data.message || "Facebook Page delete ho gaya.");
      await loadPages();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Facebook Page delete nahi hua."
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-700">
                <Share2 size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-black text-slate-900">
                  Facebook Pages
                </h1>
                <p className="text-sm text-slate-500">
                  Company Facebook Pages add aur manage karein.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={loadPages}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      {(message || error) && (
        <section
          className={[
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold",
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          ].join(" ")}
        >
          {error ? <XCircle size={19} /> : <CheckCircle2 size={19} />}
          <span>{error || message}</span>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="mb-5 text-lg font-black text-slate-900">
          Add Facebook Page
        </h2>

        <form
          onSubmit={handleAddPage}
          className="grid gap-4 lg:grid-cols-2"
        >
          <label className="space-y-2">
            <span className="text-sm font-bold text-slate-700">Page Name</span>
            <input
              value={form.pageName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  pageName: event.target.value,
                }))
              }
              placeholder="Westofash"
              className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-bold text-slate-700">Page ID</span>
            <input
              value={form.pageId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  pageId: event.target.value.replace(/\D/g, ""),
                }))
              }
              placeholder="104598078233621"
              inputMode="numeric"
              className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm font-bold text-slate-700">
              Page Access Token
            </span>
            <textarea
              value={form.pageToken}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  pageToken: event.target.value,
                }))
              }
              placeholder="Facebook Page Access Token paste karein"
              rows={4}
              className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
          </label>

          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm font-bold text-slate-700">
              Default Caption for this Page
            </span>
            <textarea
              value={form.defaultCaption}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  defaultCaption: event.target.value,
                }))
              }
              placeholder="Is Page ka WhatsApp number, hashtags aur permanent caption yahan likhein..."
              rows={5}
              className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
            <p className="text-xs font-semibold text-slate-500">
              Batch Posts mein ye caption is Page ke liye automatically use hoga.
            </p>
          </label>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
              className="h-4 w-4 accent-blue-600"
            />
            <span className="text-sm font-bold text-slate-700">
              Active Page
            </span>
          </label>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isDefault: event.target.checked,
                }))
              }
              className="h-4 w-4 accent-blue-600"
            />
            <span className="text-sm font-bold text-slate-700">
              Default Selected
            </span>
          </label>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Plus size={18} />
              )}
              Save Facebook Page
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-7">
          <h2 className="text-lg font-black text-slate-900">
            Saved Pages ({pages.length})
          </h2>
        </div>

        {loading ? (
          <div className="grid min-h-52 place-items-center">
            <Loader2 size={28} className="animate-spin text-blue-600" />
          </div>
        ) : pages.length === 0 ? (
          <div className="grid min-h-52 place-items-center px-6 text-center">
            <div>
              <Share2 className="mx-auto mb-3 text-slate-300" size={38} />
              <p className="font-bold text-slate-700">
                Abhi koi Facebook Page save nahi hai.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pages.map((page) => {
              const busy = busyId === page.id;

              return (
                <article
                  key={page.id}
                  className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center sm:p-6"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-black text-slate-900">
                        {page.pageName}
                      </h3>

                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-xs font-black",
                          page.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                      >
                        {page.active ? "Active" : "Inactive"}
                      </span>

                      {page.isDefault && (
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-700">
                          Default
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1 text-sm text-slate-500">
                      <p>
                        <span className="font-bold text-slate-700">Page ID:</span>{" "}
                        {page.pageId}
                      </p>
                      <p>
                        <span className="font-bold text-slate-700">Token:</span>{" "}
                        {page.tokenPreview || "Saved"}
                      </p>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-slate-800">
                            Default Page Caption
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            Har new Batch Post mein is Page ke liye automatically use hoga.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            updatePage(page.id, {
                              defaultCaption: captionDrafts[page.id] || "",
                            })
                          }
                          disabled={busy}
                          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save Caption
                        </button>
                      </div>

                      <textarea
                        value={captionDrafts[page.id] || ""}
                        onChange={(event) =>
                          setCaptionDrafts((current) => ({
                            ...current,
                            [page.id]: event.target.value,
                          }))
                        }
                        rows={5}
                        placeholder="Is Page ka default caption yahan likhein..."
                        className="mt-3 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openReconnect(page)}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Link2 size={16} />
                      )}
                      Reconnect
                    </button>

                    <button
                      type="button"
                      onClick={() => testPage(page.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={16} />
                      )}
                      Test
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updatePage(page.id, {
                          active: !page.active,
                        })
                      }
                      disabled={busy}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {page.active ? "Disable" : "Enable"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updatePage(page.id, {
                          isDefault: !page.isDefault,
                        })
                      }
                      disabled={busy}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {page.isDefault ? "Remove Default" : "Make Default"}
                    </button>

                    <button
                      type="button"
                      onClick={() => deletePage(page.id, page.pageName)}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {reconnectPage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeReconnect();
            }
          }}
        >
          <form
            onSubmit={reconnectFacebookPage}
            className="w-full max-w-xl rounded-3xl border border-white/20 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
                  <KeyRound size={21} />
                </div>

                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    Reconnect Facebook Page
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {reconnectPage.pageName} · {reconnectPage.pageId}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeReconnect}
                disabled={reconnecting}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                aria-label="Close reconnect form"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
              Fresh long-lived <strong>User Access Token</strong> paste
              karein. System isi saved Page ID ka naya Page Access Token
              automatically retrieve karega. Direct Page Access Token bhi
              accept hoga.
            </div>

            <label className="mt-5 block space-y-2">
              <span className="text-sm font-black text-slate-700">
                Fresh User or Page Access Token
              </span>
              <input
                type="password"
                value={reconnectToken}
                onChange={(event) =>
                  setReconnectToken(event.target.value)
                }
                autoComplete="off"
                placeholder="Token yahan paste karein"
                className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-50"
              />
            </label>

            <p className="mt-2 text-xs font-semibold text-slate-500">
              Token sirf backend verification aur Page Token refresh ke liye
              use hoga. User token Airtable mein save nahi hoga.
            </p>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeReconnect}
                disabled={reconnecting}
                className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={reconnecting || !reconnectToken.trim()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-black text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reconnecting ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Link2 size={17} />
                )}
                {reconnecting ? "Reconnecting..." : "Reconnect Page"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
