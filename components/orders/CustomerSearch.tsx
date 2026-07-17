"use client";

import { AlertCircle, Loader2, Search, UserRound, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAreasByCity,
  getCities,
  getCitiesByArea,
  locationMaster,
} from "@/data/locationMaster";

type CustomerRecord = {
  id: string;
  fields: {
    "Contact No."?: string;
    "Contact No"?: string;
    Contact?: string;
    "Customer Name"?: string;
    Name?: string;
    Address?: string;
    "Area Name"?: string;
    Area?: string;
    "City Name"?: string;
    City?: string;
  };
  name?: string;
  customerName?: string;
  contact?: string;
  contactNo?: string;
  mobile?: string;
  address?: string;
  area?: string;
  areaName?: string;
  city?: string;
  cityName?: string;
};

type CustomerSearchProps = {
  selectedCustomer: CustomerRecord | null;
  onCustomerChange: (customer: CustomerRecord | null) => void;
};

export default function CustomerSearch({
  selectedCustomer,
  onCustomerChange,
}: CustomerSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerRecord[]>([]);
 
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [selectedBaseName, setSelectedBaseName] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [areaName, setAreaName] = useState("");
  const [cityName, setCityName] = useState("");
  const [address, setAddress] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const customer = selectedCustomer;  


  function getCustomerName(record: CustomerRecord | null): string {
    if (!record) return "";

    return (
      record.fields["Customer Name"] ||
      record.fields.Name ||
      record.customerName ||
      record.name ||
      ""
    );
  }

  function getCustomerContact(record: CustomerRecord | null): string {
    if (!record) return "";

    return (
      record.fields["Contact No."] ||
      record.fields["Contact No"] ||
      record.fields.Contact ||
      record.contactNo ||
      record.contact ||
      record.mobile ||
      ""
    );
  }

  function getCustomerArea(record: CustomerRecord | null): string {
    if (!record) return "";

    return (
      record.fields["Area Name"] ||
      record.fields.Area ||
      record.areaName ||
      record.area ||
      ""
    );
  }

  function getCustomerCity(record: CustomerRecord | null): string {
    if (!record) return "";

    return (
      record.fields["City Name"] ||
      record.fields.City ||
      record.cityName ||
      record.city ||
      ""
    );
  }

  function getCustomerAddress(record: CustomerRecord | null): string {
    if (!record) return "";

    return record.fields.Address || record.address || "";
  }

  const cities = getCities();

  const areaOptions = (
    cityName
      ? getAreasByCity(cityName).map((area) => ({
          city: cityName,
          area,
        }))
      : locationMaster.map((item) => ({
          city: item.city,
          area: item.area,
        }))
  )
    .filter((item) =>
      item.area.toLowerCase().includes(areaSearch.toLowerCase().trim())
    )
    .slice(0, 30);

  const filteredCities =
    areaName && !cityName ? getCitiesByArea(areaName) : cities;

  const isDohaBase =
    selectedBaseName.toLowerCase().includes("doha") ||
    selectedBaseName.toLowerCase().includes("qatar") ||
    selectedBaseName.toLowerCase().includes("fab") ||
    selectedBaseName.toLowerCase().includes("i5q") ||
    selectedBaseName.toLowerCase().includes("dq");

  useEffect(() => {
    async function loadSelectedBase() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        const data = await res.json();

        if (res.ok && data.success) {
          const baseName =
            data.user?.selectedBase?.baseName ||
            data.user?.permissions?.[0]?.baseName ||
            "";

          setSelectedBaseName(String(baseName));
        }
      } catch {
        setSelectedBaseName("");
      }
    }

    loadSelectedBase();
  }, []);

  useEffect(() => {
    if (isDohaBase) {
      setCityName("");
      setAreaName("");
      setAreaSearch("");
    }
  }, [isDohaBase]);

  useEffect(() => {
    const value = query.trim();

    setError("");
    setSearched(false);

    if (value.length < 3 || customer) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(value)}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || "Customer search failed");
        }

        setResults(data.records || []);
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Customer search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, customer]);

  function selectCustomer(record: CustomerRecord) {
    onCustomerChange(record);
    setQuery(getCustomerContact(record));
    setResults([]);
    setSearched(true);
  }

  function clearSelectedCustomer() {
    onCustomerChange(null);
    setQuery("");
    setResults([]);
    setSearched(false);
    setError("");
  }

  async function createNewCustomer() {
    setError("");

    if (!query.trim() || !customerName.trim()) {
      setError("Contact No. and Customer Name are required.");
      return;
    }

    setCreating(true);

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactNo: query.trim(),
          customerName: customerName.trim(),
          address: address.trim(),
          ...(!isDohaBase && {
            areaName: areaName.trim(),
            cityName: cityName.trim(),
          }),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Customer create failed");
      }

      const createdRecord = data.record as CustomerRecord;
      selectCustomer(createdRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Customer create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">1. Customer Search</h2>

      <p className="mt-1 text-sm text-slate-500">
        Mobile number ya customer name type karein, phir list se customer select karein.
      </p>

      <div className="relative mt-5">
        <label className="mb-2 block text-sm font-bold text-slate-700">
          Search Customer
        </label>

        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onCustomerChange(null);
            }}
            placeholder="Search by mobile number or name"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-12 outline-none transition focus:border-emerald-500 focus:bg-white"
          />

          {loading && (
            <Loader2
              size={18}
              className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-600"
            />
          )}
        </div>

        {results.length > 0 && !customer && (
          <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {results.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => selectCustomer(record)}
                className="w-full rounded-xl p-3 text-left transition hover:bg-emerald-50"
              >
                <p className="font-black text-slate-900">
                  {getCustomerName(record) || "Unnamed Customer"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  📞 {getCustomerContact(record) || "-"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {getCustomerArea(record) || "-"}, {getCustomerCity(record) || "-"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {customer && (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-emerald-700">
                <UserRound size={22} />
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-wide text-emerald-700">
                  Selected Customer
                </p>
              <p className="mt-1 text-lg font-black text-slate-950">
                {getCustomerName(customer) || "-"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                📞 {getCustomerContact(customer) || "-"}
              </p>
              {!isDohaBase && (
                <p className="mt-1 text-sm text-slate-600">
                  📍 {getCustomerArea(customer) || "-"}, {getCustomerCity(customer) || "-"}
                </p>
              )}
                <p className="mt-1 text-sm text-slate-600">
                  {getCustomerAddress(customer) || "-"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={clearSelectedCustomer}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-black text-red-600 transition hover:bg-red-50"
              title="Remove selected customer"
            >
              <X size={16} />
              Change
            </button>
          </div>
        </div>
      )}

      {searched && !loading && !customer && results.length === 0 && (
        <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-black text-amber-800">Customer not found</p>
          <p className="mt-1 text-sm text-amber-700">
            Neeche new customer details fill karein.
          </p>
        </div>
      )}

      {!customer && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Input label="Contact No." value={query} readOnly />
          <Input label="Customer Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          {!isDohaBase && (
            <>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">
              City
            </span>

            <select
              value={cityName}
              onChange={(e) => {
                const city = e.target.value;
                setCityName(city);

                if (areaName && city) {
                  const validAreas = getAreasByCity(city);
                  if (!validAreas.includes(areaName)) {
                    setAreaName("");
                    setAreaSearch("");
                  }
                }
              }}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-emerald-500 focus:bg-white"
            >
              <option value="">Select City</option>

              {filteredCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label className="relative block">
            <span className="mb-2 block text-sm font-bold text-slate-700">
              Area
            </span>

            <div className="relative">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={areaSearch}
                onChange={(e) => {
                  setAreaSearch(e.target.value);
                  setAreaName("");
                }}
                placeholder={
                  cityName
                    ? `Search area in ${cityName}`
                    : "Search area first or select city"
                }
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </div>

            {areaSearch.trim().length > 0 && !areaName && areaOptions.length > 0 && (
              <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                {areaOptions.map((item) => (
                  <button
                    key={`${item.city}-${item.area}`}
                    type="button"
                    onClick={() => {
                      setAreaName(item.area);
                      setAreaSearch(item.area);

                      const matchedCities = getCitiesByArea(item.area);

                      if (matchedCities.length === 1) {
                        setCityName(matchedCities[0]);
                      } else if (!cityName) {
                        setCityName(item.city);
                      }
                    }}
                    className="w-full rounded-xl p-3 text-left transition hover:bg-emerald-50"
                  >
                    <p className="font-black text-slate-900">{item.area}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {item.city}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {areaName && (
              <p className="mt-2 text-xs font-bold text-emerald-700">
                Selected: {areaName}
              </p>
            )}
          </label>

            </>
          )}

          <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />

          <button
            type="button"
            onClick={createNewCustomer}
            disabled={creating}
            className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-blue-600 px-6 text-sm font-black text-white shadow-lg disabled:opacity-50"
          >
            {creating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            {creating ? "Creating..." : "Create Customer"}
          </button>
        </div>
      )}
    </div>
  );
}

function Input({
  label,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        {...props}
        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 outline-none transition focus:border-emerald-500 focus:bg-white"
      />
    </label>
  );
}