"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type BaseOption = {
  baseId: string;
  baseName: string;
};

type PendingRow = {
  id: string;
  recordId: string;
  baseId: string;
  baseName: string;
  orderNo: string;
  store: string;
  customer: string;
  phone: string;
  courier: string;
  deliveryFieldLabel: "Courier" | "Driver";
  status: string;
  value: number;
  despatchDate: string;
  days: number;
};

type Summary = {
  totalOrders: number;
  totalValue: number;
  olderThan7: number;
};

const EMPTY_SUMMARY: Summary = {
  totalOrders: 0,
  totalValue: 0,
  olderThan7: 0,
};

function amount(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function currentMonth() {
  const now = new Date();

  return `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}`;
}

export default function CourierPendingUpdatePage() {
  const [month, setMonth] = useState(currentMonth());

  const [baseId, setBaseId] = useState("");
  const [bases, setBases] = useState<BaseOption[]>([]);

  const [courier, setCourier] = useState("");
  const [couriers, setCouriers] = useState<string[]>([]);

  const [store, setStore] = useState("");
  const [stores, setStores] = useState<string[]>([]);

  const [rows, setRows] = useState<PendingRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);

  const [warnings, setWarnings] = useState<
    Array<{ baseName: string; message: string }>
  >([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [importing, setImporting] = useState(false);


  async function loadBases() {
    const response = await fetch("/api/auth/bases", {
      cache: "no-store",
    });

    const data = await response.json();

    if (data.success) {
      setBases(data.bases || []);

      if (!baseId && data.bases?.length) {
        setBaseId(data.bases[0].baseId);
      }
    }
  }


  async function loadStores(selectedBase: string) {
    if (!selectedBase) {
      setStores([]);
      return;
    }

    const response = await fetch(
      `/api/options/stores?baseId=${selectedBase}`,
      {
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (data.success) {
      setStores(data.options || []);
    }
  }


  async function loadCouriers(selectedBase: string) {
    if (!selectedBase) {
      setCouriers([]);
      return;
    }

    const response = await fetch(
      `/api/options/courier-drivers?baseId=${selectedBase}`,
      {
        cache: "no-store",
      },
    );

    const data = await response.json();

    if (data.success) {
      setCouriers(data.options || []);
    }
  }
    async function loadReport() {
    setLoading(true);

    try {
      const params = new URLSearchParams();

      if (month) params.set("month", month);
      if (baseId) params.set("baseId", baseId);
      if (courier) params.set("courier", courier);
      if (store) params.set("store", store);


      const response = await fetch(
        `/api/reports/courier-pending-update?${params.toString()}`,
        {
          cache: "no-store",
        },
      );


      const data = await response.json();


      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Courier pending report load failed",
        );
      }

      console.log("REPORT DATA", data.rows);
      setRows(data.rows || []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setWarnings(data.warnings || []);
      setSelected([]);

    } catch (error) {

      setRows([]);
      setSummary(EMPTY_SUMMARY);
      setWarnings([]);
      setSelected([]);

      alert(
        error instanceof Error
          ? error.message
          : "Courier pending report load failed",
      );

    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    loadBases();
  }, []);


  useEffect(() => {

    if (!baseId) return;

    setStore("");
    setCourier("");

    loadStores(baseId);
    loadCouriers(baseId);

  }, [baseId]);


  useEffect(() => {

    if (baseId) {
      loadReport();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId]);



  const allSelected =
    rows.length > 0 && selected.length === rows.length;



  const selectedRows = useMemo(
    () => rows.filter((row) => selected.includes(row.id)),
    [rows, selected],
  );



  function toggleAll() {

    setSelected(
      allSelected
        ? []
        : rows.map((row) => row.id),
    );

  }



  function toggleRow(id: string) {

    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  }



  async function bulkUpdate(
    status: "Delivered" | "Returned",
  ) {

    if (selectedRows.length === 0) {
      alert("Please select at least one order.");
      return;
    }


    const confirmed = window.confirm(
      `Mark ${selectedRows.length} selected order(s) as ${status}?`,
    );


    if (!confirmed) return;


    setUpdating(true);


    try {

      const response = await fetch(
        "/api/reports/courier-pending-update",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            status,

            selections: selectedRows.map((row) => ({
              baseId: row.baseId,
              recordId: row.recordId,
            })),

          }),
        },
      );


      const data = await response.json();


      if (!response.ok || !data.success) {

        throw new Error(
          data.message ||
            "Courier bulk update failed",
        );

      }


      alert(
        `${data.updatedRecords || 0} order(s) marked ${status}.`,
      );


      await loadReport();


    } catch (error) {

      alert(
        error instanceof Error
          ? error.message
          : "Courier bulk update failed",
      );


    } finally {

      setUpdating(false);

    }

  }
  async function importStatusExcel(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!baseId) {
      alert("Please select base first.");
      e.target.value = "";
      return;
    }

    setImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("baseId", baseId);

      const response = await fetch(
        "/api/reports/courier-pending-update/import-status",
        {
          method: "POST",
          body: formData,
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        const detectedHeaders = Array.isArray(data?.detectedHeaders)
          ? `\nDetected columns: ${data.detectedHeaders.join(", ")}`
          : "";

        throw new Error(
          `${data.message || "Import failed"}${detectedHeaders}`,
        );
      }

      const lines = [
        "Courier status import completed.",
        `Updated: ${data.updated || 0}`,
        `Already Same: ${data.unchanged || 0}`,
        `Not Found: ${data.notFound || 0}`,
        `Ambiguous: ${data.ambiguous || 0}`,
        `Skipped: ${data.skipped || 0}`,
        `Duplicate Rows Collapsed: ${data.duplicateCollapsed || 0}`,
        `Failed Updates: ${data.failed || 0}`,
      ];

      if (Array.isArray(data.notFoundReferences) && data.notFoundReferences.length) {
        lines.push(
          `Not Found examples: ${data.notFoundReferences.slice(0, 10).join(", ")}`,
        );
      }

      if (Array.isArray(data.ambiguousReferences) && data.ambiguousReferences.length) {
        lines.push(
          `Ambiguous examples: ${data.ambiguousReferences.slice(0, 10).join(", ")}`,
        );
      }

      if (Array.isArray(data.failures) && data.failures.length) {
        lines.push(
          `Airtable errors: ${data.failures.slice(0, 3).join(" | ")}`,
        );
      }

      alert(lines.join("\n"));
      await loadReport();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Import failed",
      );
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  function exportExcel() {

    if (rows.length === 0) {
      alert("No pending courier orders to export.");
      return;
    }


    const exportRows = rows.map((row) => ({
      Base: row.baseName,
      "Order No": row.orderNo,
      Store: row.store,
      Customer: row.customer,
      Phone: row.phone,
      "Courier / Driver": row.courier,
      Status: row.status,
      "Despatch Date": formatDate(row.despatchDate),
      Days: row.days,
      Value: Number(row.value.toFixed(2)),
    }));


    const worksheet =
      XLSX.utils.json_to_sheet(exportRows);


    const workbook =
      XLSX.utils.book_new();


    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Courier Pending",
    );


    XLSX.writeFile(
      workbook,
      `courier-pending-update-${month || "all-months"}.xlsx`,
    );

  }



  return (

    <div className="space-y-6">


      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">

        <div>

          <h1 className="text-3xl font-black text-slate-950">
            Courier Pending Update
          </h1>

          <p className="mt-1 text-sm font-bold text-slate-500">
            All dispatched courier orders are shown until they are marked Delivered or Returned.
          </p>

        </div>


        <Link
          href="/reports/courier"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
        >
          Courier Summary
        </Link>


      </div>



      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">


        <div className="grid gap-4 md:grid-cols-5">


          <div>

            <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Month
            </label>


            <input
              type="month"
              value={month}
              onChange={(e) =>
                setMonth(e.target.value)
              }
              className="h-11 w-full rounded-xl border px-3 font-bold"
            />

          </div>



          <div>

            <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Base
            </label>


            <select
              value={baseId}
              onChange={(e) =>
                setBaseId(e.target.value)
              }
              className="h-11 w-full rounded-xl border px-3 font-bold"
            >

              <option value="">
                Select Base
              </option>


              {bases.map((base) => (

                <option
                  key={base.baseId}
                  value={base.baseId}
                >
                  {base.baseName}
                </option>

              ))}

            </select>

          </div>




          <div>

            <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Store
            </label>


            <select
              value={store}
              onChange={(e) =>
                setStore(e.target.value)
              }
              className="h-11 w-full rounded-xl border px-3 font-bold"
            >

              <option value="">
                All Stores
              </option>


              {stores.map((item) => (

                <option
                  key={item}
                  value={item}
                >
                  {item}
                </option>

              ))}


            </select>

          </div>




          <div>

            <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Courier / Driver
            </label>


            <select
              value={courier}
              onChange={(e) =>
                setCourier(e.target.value)
              }
              className="h-11 w-full rounded-xl border px-3 font-bold"
            >

              <option value="">
                All Courier / Driver
              </option>


              {couriers.map((item) => (

                <option
                  key={item}
                  value={item}
                >
                  {item}
                </option>

              ))}


            </select>


          </div>




          <button

            type="button"

            onClick={loadReport}

            disabled={loading || updating}

            className="h-11 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"

          >

            {loading ? "Loading..." : "Load"}

          </button>



        </div>


      </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

        <SummaryCard
          label="Pending Orders"
          value={summary.totalOrders}
        />

        <SummaryCard
          label="Pending Value"
          value={amount(summary.totalValue)}
        />

        <SummaryCard
          label="7+ Days"
          value={summary.olderThan7}
        />

        <SummaryCard
          label="Selected"
          value={selected.length}
        />

      </div>



      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

        <div className="flex flex-wrap items-center gap-3">


          <button
            type="button"
            onClick={toggleAll}
            disabled={rows.length === 0 || updating}
            className="h-11 rounded-xl border border-slate-300 bg-white px-4 font-black disabled:opacity-40"
          >
            {allSelected ? "Clear Selection" : "Select All"}
          </button>



          <button
            type="button"
            onClick={() => bulkUpdate("Delivered")}
            disabled={selected.length === 0 || updating}
            className="h-11 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-40"
          >
            {updating ? "Updating..." : "Mark Delivered"}
          </button>



          <button
            type="button"
            onClick={() => bulkUpdate("Returned")}
            disabled={selected.length === 0 || updating}
            className="h-11 rounded-xl bg-rose-600 px-5 font-black text-white disabled:opacity-40"
          >
            {updating ? "Updating..." : "Mark Returned"}
          </button>



          <button
            type="button"
            onClick={exportExcel}
            disabled={rows.length === 0 || updating}
            className="h-11 rounded-xl bg-slate-900 px-5 font-black text-white disabled:opacity-40"
          >
            Export Excel
          </button>

          <label
            className={`flex h-11 items-center rounded-xl bg-purple-600 px-5 font-black text-white ${
              importing || updating
                ? "cursor-wait opacity-50"
                : "cursor-pointer"
            }`}
          >
            {importing ? "Importing..." : "Import Status Excel"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              disabled={importing || updating}
              onChange={importStatusExcel}
            />
          </label>

        </div>

        <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
          Import supports .xlsx, .xls and .csv. Order/reference columns such as
          Reference Number, SHIPPER REF # or Order Number are matched against
          the selected base. Status columns such as backend.Status Name or
          Status are updated into the actual Airtable Order Status field.
        </p>

      </div>



      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">


        <div className="overflow-auto">


          <table className="w-full min-w-[1450px] text-sm">


            <thead className="bg-slate-200 text-slate-900">

              <tr>

                <th className="px-3 py-3 text-center">
                  Select
                </th>

                <th className="px-3 py-3 text-left">
                  Base
                </th>

                <th className="px-3 py-3 text-left">
                  Order No
                </th>

                <th className="px-3 py-3 text-left">
                  Store
                </th>

                <th className="px-3 py-3 text-left">
                  Customer
                </th>

                <th className="px-3 py-3 text-left">
                  Phone
                </th>

                <th className="px-3 py-3 text-left">
                  Courier / Driver
                </th>

                <th className="px-3 py-3 text-left">
                  Status
                </th>

                <th className="px-3 py-3 text-left">
                  Dispatch Date
                </th>

                <th className="px-3 py-3 text-center">
                  Days
                </th>

                <th className="px-3 py-3 text-right">
                  Value
                </th>

              </tr>

            </thead>



            <tbody>


              {rows.map((row) => {

                const isSelected =
                  selected.includes(row.id);


                return (

                  <tr
                    key={row.id}
                    className={`border-t ${
                      row.days > 7
                        ? "bg-red-50"
                        : isSelected
                          ? "bg-emerald-50"
                          : "bg-white"
                    }`}
                  >


                    <td className="px-3 py-3 text-center">

                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          toggleRow(row.id)
                        }
                        disabled={updating}
                        className="h-4 w-4"
                      />

                    </td>



                    <td className="px-3 py-3 font-bold">
                      {row.baseName}
                    </td>


                    <td className="px-3 py-3 font-black">
                      {row.orderNo || "-"}
                    </td>


                    <td className="px-3 py-3">
                      {row.store || "-"}
                    </td>


                    <td className="px-3 py-3">
                      {row.customer || "-"}
                    </td>


                    <td className="px-3 py-3">
                      {row.phone || "-"}
                    </td>


                    <td className="px-3 py-3 font-bold">
                      {row.courier}
                    </td>


                    <td className="px-3 py-3">

                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">

                        {row.status || "Pending"}

                      </span>

                    </td>


                    <td className="px-3 py-3">
                      {formatDate(row.despatchDate)}
                    </td>


                    <td className="px-3 py-3 text-center font-black">
                      {row.days}
                    </td>


                    <td className="px-3 py-3 text-right font-black">
                      {amount(row.value)}
                    </td>


                  </tr>

                );

              })}



              {!loading && rows.length === 0 && (

                <tr>

                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-bold text-slate-500"
                  >

                    No pending courier orders found.

                  </td>

                </tr>

              )}



              {loading && (

                <tr>

                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center font-black text-blue-600"
                  >

                    Loading pending courier orders...

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



function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {

  return (

    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </p>


      <p className="mt-2 text-xl font-black text-slate-950">
        {value}
      </p>


    </div>

  );

}