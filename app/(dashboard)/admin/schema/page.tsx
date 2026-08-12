"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileJson,
  Layers3,
  List,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Table2,
  Trash2,
} from "lucide-react";

type BasePermission = {
  baseName: string;
  baseId: string;
};

type SchemaChoice = {
  id?: string;
  name: string;
  color?: string;
};

type SchemaField = {
  id: string;
  name: string;
  type: string;
  description?: string;
  choices?: SchemaChoice[];
};

type SchemaView = {
  id: string;
  name: string;
  type: string;
};

type SchemaTable = {
  id: string;
  name: string;
  description?: string;
  primaryFieldId?: string;
  fields: SchemaField[];
  views: SchemaView[];
};

type AirtableRecord = {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
};

type ManageResponse = {
  success: boolean;
  partial?: boolean;
  message?: string;
  bases?: BasePermission[];
  selectedBaseId?: string;
  selectedBaseName?: string;
  tables?: SchemaTable[];
  records?: AirtableRecord[];
  offset?: string;
  deleted?: number;
  failed?: number;
  failures?: Array<{ recordId: string; message: string }>;
};

type Tab = "schema" | "records" | "capabilities";

const FIELD_TYPES = [
  ["singleLineText", "Single Line Text"],
  ["multilineText", "Long Text"],
  ["number", "Number"],
  ["checkbox", "Checkbox"],
  ["date", "Date"],
  ["dateTime", "Date & Time"],
  ["singleSelect", "Single Select"],
  ["multipleSelects", "Multiple Select"],
  ["email", "Email"],
  ["phoneNumber", "Phone Number"],
  ["url", "URL"],
  ["multipleAttachments", "Attachments"],
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function compactValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  } catch {
    return String(value);
  }
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseJsonObject(value: string) {
  const parsed = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Record JSON must be an object, for example {\"Status\":\"Pending\"}.");
  }
  return parsed as Record<string, unknown>;
}

export default function AirtableControlCenterPage() {
  const [tab, setTab] = useState<Tab>("schema");
  const [bases, setBases] = useState<BasePermission[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState("");

  const [newTableName, setNewTableName] = useState("");
  const [newTableDescription, setNewTableDescription] = useState("");
  const [newTablePrimaryField, setNewTablePrimaryField] = useState("Name");
  const [tableEditName, setTableEditName] = useState("");
  const [tableEditDescription, setTableEditDescription] = useState("");

  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("singleLineText");
  const [fieldDescription, setFieldDescription] = useState("");
  const [fieldChoices, setFieldChoices] = useState("");
  const [editFieldId, setEditFieldId] = useState("");
  const [editFieldName, setEditFieldName] = useState("");
  const [editFieldDescription, setEditFieldDescription] = useState("");

  const [selectFieldId, setSelectFieldId] = useState("");
  const [optionName, setOptionName] = useState("");

  const [records, setRecords] = useState<AirtableRecord[]>([]);
  const [recordOffset, setRecordOffset] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [recordEditorId, setRecordEditorId] = useState("");
  const [recordJson, setRecordJson] = useState("{}");

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId),
    [selectedTableId, tables],
  );

  const editField = useMemo(
    () => selectedTable?.fields.find((field) => field.id === editFieldId),
    [editFieldId, selectedTable],
  );

  const selectFields = useMemo(
    () =>
      (selectedTable?.fields || []).filter((field) =>
        ["singleSelect", "multipleSelects"].includes(field.type),
      ),
    [selectedTable],
  );

  const selectedSelectField = useMemo(
    () => selectFields.find((field) => field.id === selectFieldId),
    [selectFieldId, selectFields],
  );

  const visibleFields = useMemo(
    () => (selectedTable?.fields || []).slice(0, 8),
    [selectedTable],
  );

  const filteredRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    if (!query) return records;

    return records.filter((record) =>
      [record.id, ...Object.values(record.fields).map(compactValue)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [recordSearch, records]);

  async function loadSchema(baseId = "", preferredTableId = "") {
    setLoading(true);
    setError("");

    try {
      const query = baseId ? `?baseId=${encodeURIComponent(baseId)}` : "";
      const response = await fetch(`/api/admin/schema/manage${query}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as ManageResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load Airtable schema");
      }

      const nextBases = data.bases || [];
      const nextTables = data.tables || [];
      const nextBaseId =
        data.selectedBaseId || baseId || nextBases[0]?.baseId || "";

      setBases(nextBases);
      setSelectedBaseId(nextBaseId);
      setTables(nextTables);
      setSelectedTableId((current) => {
        const requested = preferredTableId || current;
        if (requested && nextTables.some((table) => table.id === requested)) {
          return requested;
        }
        return nextTables[0]?.id || "";
      });
    } catch (loadError) {
      setTables([]);
      setSelectedTableId("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load Airtable schema",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSchema();
  }, []);

  useEffect(() => {
    setTableEditName(selectedTable?.name || "");
    setTableEditDescription(selectedTable?.description || "");
    setEditFieldId("");
    setEditFieldName("");
    setEditFieldDescription("");
    setSelectFieldId((current) => {
      if (current && selectFields.some((field) => field.id === current)) {
        return current;
      }
      return (
        selectFields.find((field) => normalize(field.name) === "supplier")?.id ||
        selectFields[0]?.id ||
        ""
      );
    });
    setRecords([]);
    setRecordOffset("");
    setSelectedRecordIds([]);
    setRecordEditorId("");
    setRecordJson("{}");
  }, [selectedTable, selectFields]);

  useEffect(() => {
    if (!editField) return;
    setEditFieldName(editField.name);
    setEditFieldDescription(editField.description || "");
  }, [editField]);

  async function apiAction(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/schema/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as ManageResponse;

    if (!response.ok || (!data.success && !data.partial)) {
      throw new Error(data.message || "Airtable action failed");
    }

    return data;
  }

  async function downloadSchema(base?: BasePermission) {
    const downloadKey = base?.baseId || "all";
    setDownloading(downloadKey);
    setError("");
    setMessage("");

    try {
      const url = base
        ? `/api/admin/schema/export?baseId=${encodeURIComponent(base.baseId)}`
        : "/api/admin/schema/export";
      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Schema download failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^\"]+)"?/i);
      const fallbackName = base
        ? `${base.baseName}-schema.json`
        : "airtable-all-bases-schema.json";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = match?.[1] || fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Schema download failed",
      );
    } finally {
      setDownloading("");
    }
  }

  async function createTable() {
    const name = newTableName.trim();
    if (!selectedBaseId || !name) {
      setError("Base aur Table Name required hain.");
      return;
    }
    if (!window.confirm(`Create new Airtable table "${name}"?`)) return;

    setBusy("create-table");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "create_table",
        baseId: selectedBaseId,
        tableName: name,
        description: newTableDescription.trim(),
        primaryFieldName: newTablePrimaryField.trim() || "Name",
      });
      setMessage(data.message || `Table "${name}" created.`);
      setNewTableName("");
      setNewTableDescription("");
      setNewTablePrimaryField("Name");
      await loadSchema(selectedBaseId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Table creation failed");
    } finally {
      setBusy("");
    }
  }

  async function saveTableSettings() {
    if (!selectedTable) return;
    const name = tableEditName.trim();
    if (!name) {
      setError("Table name required hai.");
      return;
    }
    if (!window.confirm(`Save table settings for "${selectedTable.name}"?`)) return;

    setBusy("save-table");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "update_table",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        tableName: name,
        description: tableEditDescription,
      });
      setMessage(data.message || "Table updated.");
      await loadSchema(selectedBaseId, selectedTable.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Table update failed");
    } finally {
      setBusy("");
    }
  }

  async function createField() {
    if (!selectedTable) return;
    const name = fieldName.trim();
    if (!name) {
      setError("Field name required hai.");
      return;
    }
    if (!window.confirm(`Create field "${name}" in ${selectedTable.name}?`)) return;

    setBusy("create-field");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "create_field",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        fieldName: name,
        fieldType,
        description: fieldDescription.trim(),
        choices: fieldChoices,
      });
      setMessage(data.message || `Field "${name}" created.`);
      setFieldName("");
      setFieldDescription("");
      setFieldChoices("");
      await loadSchema(selectedBaseId, selectedTable.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Field creation failed");
    } finally {
      setBusy("");
    }
  }

  async function saveFieldSettings() {
    if (!selectedTable || !editField) return;
    const name = editFieldName.trim();
    if (!name) {
      setError("Field name required hai.");
      return;
    }
    if (!window.confirm(`Update field "${editField.name}"?`)) return;

    setBusy("save-field");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "update_field",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        fieldId: editField.id,
        fieldName: name,
        description: editFieldDescription,
      });
      setMessage(data.message || "Field updated.");
      await loadSchema(selectedBaseId, selectedTable.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Field update failed");
    } finally {
      setBusy("");
    }
  }

  async function addSelectOption() {
    if (!selectedTable || !selectedSelectField) {
      setError("Single/Multi Select field select karein.");
      return;
    }
    const name = optionName.trim();
    if (!name) {
      setError("Option name required hai.");
      return;
    }
    if (
      (selectedSelectField.choices || []).some(
        (choice) => normalize(choice.name) === normalize(name),
      )
    ) {
      setError(`Option "${name}" already exists.`);
      return;
    }
    if (
      !window.confirm(
        `Add option "${name}" to ${selectedTable.name} → ${selectedSelectField.name}?`,
      )
    ) {
      return;
    }

    setBusy("add-option");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "add_select_option",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        fieldId: selectedSelectField.id,
        optionName: name,
      });
      setMessage(data.message || `Option "${name}" added.`);
      setOptionName("");
      await loadSchema(selectedBaseId, selectedTable.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Option add failed");
    } finally {
      setBusy("");
    }
  }

  async function loadRecords(offset = "") {
    if (!selectedBaseId || !selectedTableId) return;

    setBusy("load-records");
    setError("");
    setMessage("");

    try {
      const params = new URLSearchParams({
        mode: "records",
        baseId: selectedBaseId,
        tableId: selectedTableId,
        pageSize: "50",
      });
      if (offset) params.set("offset", offset);

      const response = await fetch(
        `/api/admin/schema/manage?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as ManageResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Airtable records could not load");
      }

      setRecords(data.records || []);
      setRecordOffset(data.offset || "");
      setSelectedRecordIds([]);
      setRecordEditorId("");
      setRecordJson("{}");
    } catch (loadError) {
      setRecords([]);
      setRecordOffset("");
      setError(loadError instanceof Error ? loadError.message : "Record load failed");
    } finally {
      setBusy("");
    }
  }

  function editRecord(record: AirtableRecord) {
    setRecordEditorId(record.id);
    setRecordJson(JSON.stringify(record.fields || {}, null, 2));
  }

  function newRecord() {
    setRecordEditorId("NEW");
    setRecordJson("{}\n");
  }

  async function saveRecord() {
    if (!selectedTable) return;

    let fields: Record<string, unknown>;
    try {
      fields = parseJsonObject(recordJson);
    } catch (jsonError) {
      setError(jsonError instanceof Error ? jsonError.message : "Invalid JSON");
      return;
    }

    const creating = recordEditorId === "NEW";
    if (!creating && !recordEditorId.startsWith("rec")) {
      setError("Record select karein.");
      return;
    }

    if (
      !window.confirm(
        creating ? "Create this Airtable record?" : `Update ${recordEditorId}?`,
      )
    ) {
      return;
    }

    setBusy("save-record");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: creating ? "create_record" : "update_record",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        recordId: creating ? undefined : recordEditorId,
        fields,
      });
      setMessage(data.message || (creating ? "Record created." : "Record updated."));
      await loadRecords();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Record save failed");
    } finally {
      setBusy("");
    }
  }

  async function deleteRecord(recordId: string) {
    if (!selectedTable || !window.confirm(`DELETE Airtable record ${recordId}?`)) {
      return;
    }

    setBusy(`delete:${recordId}`);
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "delete_record",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        recordId,
      });
      setMessage(data.message || "Record deleted.");
      await loadRecords();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Record delete failed");
    } finally {
      setBusy("");
    }
  }

  async function bulkDeleteRecords() {
    if (!selectedTable || selectedRecordIds.length === 0) return;
    if (
      !window.confirm(
        `DELETE ${selectedRecordIds.length} selected Airtable record(s)? This cannot be undone from ERP.`,
      )
    ) {
      return;
    }

    setBusy("bulk-delete");
    setError("");
    setMessage("");

    try {
      const data = await apiAction({
        action: "bulk_delete_records",
        baseId: selectedBaseId,
        tableId: selectedTable.id,
        recordIds: selectedRecordIds,
      });
      const failureText = data.failures?.length
        ? ` First error: ${data.failures[0].recordId} - ${data.failures[0].message}`
        : "";
      setMessage(`${data.message || "Bulk delete completed."}${failureText}`);
      await loadRecords();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Bulk delete failed");
    } finally {
      setBusy("");
    }
  }

  function toggleRecord(recordId: string) {
    setSelectedRecordIds((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId],
    );
  }

  function toggleVisibleRecords() {
    const ids = filteredRecords.map((record) => record.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedRecordIds.includes(id));
    setSelectedRecordIds((current) =>
      allSelected
        ? current.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current, ...ids])),
    );
  }

  const selectFieldType = ["singleSelect", "multipleSelects"].includes(fieldType);
  const allVisibleRecordsSelected =
    filteredRecords.length > 0 &&
    filteredRecords.every((record) => selectedRecordIds.includes(record.id));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
            <ShieldCheck size={18} />
            Admin Only
          </div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Airtable Control Center
          </h1>
          <p className="mt-1 max-w-4xl text-sm font-bold leading-6 text-slate-500">
            Mysmar ERP se live Airtable schema aur records manage karein. Destructive
            actions confirmation ke baghair run nahi hotay.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadSchema()}
            disabled={loading || downloading !== "" || bases.length === 0}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-50"
          >
            {downloading === "all" ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <Download size={17} />
            )}
            Backup All Schemas
          </button>
          <button
            type="button"
            onClick={() => void loadSchema(selectedBaseId, selectedTableId)}
            disabled={loading || Boolean(busy)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Refresh Schema
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      {message && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">
          <CheckCircle2 size={19} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Base
            </span>
            <select
              value={selectedBaseId}
              onChange={(event) => {
                const nextBaseId = event.target.value;
                setSelectedBaseId(nextBaseId);
                setSelectedTableId("");
                setMessage("");
                void loadSchema(nextBaseId);
              }}
              disabled={loading || Boolean(busy)}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              {bases.map((base) => (
                <option key={base.baseId} value={base.baseId}>
                  {base.baseName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
              Table
            </span>
            <select
              value={selectedTableId}
              onChange={(event) => {
                setSelectedTableId(event.target.value);
                setMessage("");
              }}
              disabled={loading || Boolean(busy) || tables.length === 0}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold"
            >
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </label>

          {selectedBaseId && (
            <button
              type="button"
              onClick={() => {
                const base = bases.find((item) => item.baseId === selectedBaseId);
                if (base) void downloadSchema(base);
              }}
              disabled={downloading !== ""}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-black text-emerald-700 disabled:opacity-50"
            >
              {downloading === selectedBaseId ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Backup Selected Base
            </button>
          )}
        </div>

        {selectedTable && (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black text-slate-600">
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              {selectedTable.fields.length} fields
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              {selectedTable.views.length} views
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Table ID: {selectedTable.id}
            </span>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["schema", "Schema Control", Database],
            ["records", "Record Manager", List],
            ["capabilities", "Available / Limited", Eye],
          ] as Array<[Tab, string, typeof Database]>
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={[
              "inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-black",
              tab === value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600",
            ].join(" ")}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === "schema" && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Plus size={18} className="text-violet-700" />
                <h2 className="font-black text-slate-950">Create Table</h2>
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  value={newTableName}
                  onChange={(event) => setNewTableName(event.target.value)}
                  placeholder="Table name"
                  className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                />
                <input
                  value={newTablePrimaryField}
                  onChange={(event) => setNewTablePrimaryField(event.target.value)}
                  placeholder="Primary field name"
                  className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                />
                <textarea
                  value={newTableDescription}
                  onChange={(event) => setNewTableDescription(event.target.value)}
                  rows={2}
                  placeholder="Description (optional)"
                  className="rounded-xl border border-slate-300 px-3 py-2 font-bold"
                />
                <button
                  type="button"
                  onClick={() => void createTable()}
                  disabled={Boolean(busy) || !selectedBaseId}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white disabled:opacity-50"
                >
                  {busy === "create-table" ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Plus size={17} />
                  )}
                  Create Table
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Pencil size={18} className="text-blue-700" />
                <h2 className="font-black text-slate-950">Table Settings</h2>
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  value={tableEditName}
                  onChange={(event) => setTableEditName(event.target.value)}
                  disabled={!selectedTable}
                  placeholder="Table name"
                  className="h-11 rounded-xl border border-slate-300 px-3 font-bold disabled:bg-slate-100"
                />
                <textarea
                  value={tableEditDescription}
                  onChange={(event) => setTableEditDescription(event.target.value)}
                  disabled={!selectedTable}
                  rows={3}
                  placeholder="Table description"
                  className="rounded-xl border border-slate-300 px-3 py-2 font-bold disabled:bg-slate-100"
                />
                <button
                  type="button"
                  onClick={() => void saveTableSettings()}
                  disabled={Boolean(busy) || !selectedTable}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
                >
                  {busy === "save-table" ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Save size={17} />
                  )}
                  Save Table Name / Description
                </button>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Plus size={18} className="text-blue-700" />
                <h2 className="font-black text-slate-950">Create Field</h2>
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  value={fieldName}
                  onChange={(event) => setFieldName(event.target.value)}
                  placeholder="Field name"
                  className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                />
                <select
                  value={fieldType}
                  onChange={(event) => setFieldType(event.target.value)}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold"
                >
                  {FIELD_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {selectFieldType && (
                  <input
                    value={fieldChoices}
                    onChange={(event) => setFieldChoices(event.target.value)}
                    placeholder="Initial options: Pending, Processing, Delivered"
                    className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                  />
                )}
                <textarea
                  value={fieldDescription}
                  onChange={(event) => setFieldDescription(event.target.value)}
                  rows={2}
                  placeholder="Description (optional)"
                  className="rounded-xl border border-slate-300 px-3 py-2 font-bold"
                />
                <button
                  type="button"
                  onClick={() => void createField()}
                  disabled={Boolean(busy) || !selectedTable}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-50"
                >
                  {busy === "create-field" ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Plus size={17} />
                  )}
                  Create Field
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Layers3 size={18} className="text-emerald-700" />
                <h2 className="font-black text-slate-950">Add Select Option</h2>
              </div>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                Supplier bhi isi se add hoga: Supplier Single Select choose karein aur naya option add karein.
              </p>
              <div className="mt-4 grid gap-3">
                <select
                  value={selectFieldId}
                  onChange={(event) => setSelectFieldId(event.target.value)}
                  disabled={!selectFields.length}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold disabled:bg-slate-100"
                >
                  {selectFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name} · {field.type === "singleSelect" ? "Single Select" : "Multi Select"}
                    </option>
                  ))}
                </select>
                <input
                  value={optionName}
                  onChange={(event) => setOptionName(event.target.value)}
                  placeholder="New option name"
                  className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                />
                {selectedSelectField && (
                  <div className="max-h-40 overflow-auto rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap gap-2">
                      {(selectedSelectField.choices || []).map((choice) => (
                        <span
                          key={choice.id || choice.name}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600"
                        >
                          {choice.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void addSelectOption()}
                  disabled={Boolean(busy) || !selectedSelectField}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-50"
                >
                  {busy === "add-option" ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Plus size={17} />
                  )}
                  Add Option
                </button>
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>Existing Single/Multi Select option delete/rename Airtable public API se safely exposed nahi hai; isliye destructive fake option yahan nahi diya gaya.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>New option add karne ke liye ERP temporary Airtable record create karke foran delete karta hai. Agar is table par “record created” automation lagi ho to pehle us automation ka side-effect check karein.</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex items-center gap-2">
                  <Table2 size={18} className="text-slate-700" />
                  <h2 className="font-black text-slate-950">Fields</h2>
                </div>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Field</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Options</th>
                      <th className="px-4 py-3">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedTable?.fields || []).map((field) => (
                      <tr key={field.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{field.name}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-400">{field.id}</p>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-600">{field.type}</td>
                        <td className="max-w-[260px] px-4 py-3 text-xs font-bold text-slate-500">
                          {field.description || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-500">
                          {field.choices?.length || 0}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setEditFieldId(field.id)}
                            className="inline-flex h-9 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-blue-700"
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-black text-slate-950">Edit Field Settings</h2>
              {editField ? (
                <div className="mt-4 grid gap-3">
                  <div className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-500">
                    Type: <span className="font-black text-slate-900">{editField.type}</span>
                  </div>
                  <input
                    value={editFieldName}
                    onChange={(event) => setEditFieldName(event.target.value)}
                    className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
                  />
                  <textarea
                    value={editFieldDescription}
                    onChange={(event) => setEditFieldDescription(event.target.value)}
                    rows={4}
                    placeholder="Description"
                    className="rounded-xl border border-slate-300 px-3 py-2 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => void saveFieldSettings()}
                    disabled={Boolean(busy)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 font-black text-white disabled:opacity-50"
                  >
                    {busy === "save-field" ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <Save size={17} />
                    )}
                    Save Field Name / Description
                  </button>
                  <p className="text-[11px] font-bold leading-5 text-slate-400">
                    Airtable API field type conversion expose nahi karti; type yahan read-only hai.
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-sm font-bold text-slate-400">
                  Left side se field Edit karein.
                </p>
              )}
            </section>
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Eye size={18} className="text-violet-700" />
              <h2 className="font-black text-slate-950">Views</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(selectedTable?.views || []).map((view) => (
                <div key={view.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-black text-slate-900">{view.name}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{view.type}</p>
                  <p className="mt-2 break-all text-[10px] font-bold text-slate-400">{view.id}</p>
                </div>
              ))}
              {selectedTable && selectedTable.views.length === 0 && (
                <p className="text-sm font-bold text-slate-400">No views returned by schema API.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "records" && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="font-black text-slate-950">Record Manager</h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  50 records per page. Create/Edit supports any writable Airtable field through JSON.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadRecords()}
                  disabled={Boolean(busy) || !selectedTable}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white disabled:opacity-50"
                >
                  {busy === "load-records" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Load First 50
                </button>
                {recordOffset && (
                  <button
                    type="button"
                    onClick={() => void loadRecords(recordOffset)}
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-xs font-black text-blue-700 disabled:opacity-50"
                  >
                    Next 50
                  </button>
                )}
                <button
                  type="button"
                  onClick={newRecord}
                  disabled={!selectedTable}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-50"
                >
                  <Plus size={15} />
                  New Record
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                value={recordSearch}
                onChange={(event) => setRecordSearch(event.target.value)}
                placeholder="Search loaded records..."
                className="h-10 w-full max-w-xl rounded-xl border border-slate-300 px-3 text-sm font-bold"
              />
              {selectedRecordIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void bulkDeleteRecords()}
                  disabled={Boolean(busy)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-black text-red-700 disabled:opacity-50"
                >
                  {busy === "bulk-delete" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  Delete Selected ({selectedRecordIds.length})
                </button>
              )}
            </div>
          </section>

          {recordEditorId && (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-black text-slate-950">
                    {recordEditorId === "NEW" ? "Create Record" : `Edit ${recordEditorId}`}
                  </h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Field names exactly Airtable schema ke mutabiq use karein. `typecast: true` enabled hai.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRecordEditorId("");
                    setRecordJson("{}");
                  }}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600"
                >
                  Close
                </button>
              </div>
              <textarea
                value={recordJson}
                onChange={(event) => setRecordJson(event.target.value)}
                rows={14}
                spellCheck={false}
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-6 text-white outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveRecord()}
                  disabled={Boolean(busy)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-50"
                >
                  {busy === "save-record" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  {recordEditorId === "NEW" ? "Create Record" : "Save Record"}
                </button>
                <span className="text-[11px] font-bold text-slate-500">
                  Example: {`{"Status":"Pending","Quantity":2}`}
                </span>
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-slate-100 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleRecordsSelected}
                        onChange={toggleVisibleRecords}
                        disabled={!filteredRecords.length}
                      />
                    </th>
                    <th className="px-3 py-3">Record ID</th>
                    <th className="px-3 py-3">Created</th>
                    {visibleFields.map((field) => (
                      <th key={field.id} className="px-3 py-3">
                        {field.name}
                      </th>
                    ))}
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedRecordIds.includes(record.id)}
                          onChange={() => toggleRecord(record.id)}
                        />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-black text-blue-700">
                        {record.id}
                      </td>
                      <td className="px-3 py-3 text-xs font-bold text-slate-500">
                        {formatDate(record.createdTime)}
                      </td>
                      {visibleFields.map((field) => (
                        <td key={field.id} className="max-w-[260px] px-3 py-3 text-xs font-bold text-slate-700">
                          <div className="max-h-20 overflow-auto break-words">
                            {compactValue(record.fields?.[field.name])}
                          </div>
                        </td>
                      ))}
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editRecord(record)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-[10px] font-black text-blue-700"
                          >
                            <FileJson size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRecord(record.id)}
                            disabled={Boolean(busy)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 text-[10px] font-black text-red-700 disabled:opacity-50"
                          >
                            {busy === `delete:${record.id}` ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!filteredRecords.length && (
                    <tr>
                      <td
                        colSpan={11}
                        className="px-4 py-12 text-center font-bold text-slate-400"
                      >
                        Records load karne ke liye “Load First 50” press karein.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "capabilities" && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-950">Airtable Control Coverage</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
            Green items ERP mein implemented hain. Amber items Airtable ke current public API limitations ki wajah se intentionally blocked/read-only hain.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              [true, "Base schema browse + backup"],
              [true, "Create table"],
              [true, "Rename table + description"],
              [true, "Create common field types"],
              [true, "Rename field + description"],
              [true, "Add Single/Multi Select option"],
              [true, "List Airtable views"],
              [true, "Browse records"],
              [true, "Create record"],
              [true, "Update record"],
              [true, "Delete record"],
              [true, "Bulk delete records"],
              [false, "Delete/rename existing Select option"],
              [false, "Delete field through supported current schema API"],
              [false, "Delete table through supported current schema API"],
              [false, "Change existing field type"],
              [false, "Turn Airtable automation ON from public API"],
              [false, "Edit existing Interface page from current Airtable MCP/API"],
            ].map(([available, label]) => (
              <div
                key={String(label)}
                className={[
                  "rounded-2xl border p-4 text-sm font-black",
                  available
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  {available ? (
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  )}
                  <span>{label}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
