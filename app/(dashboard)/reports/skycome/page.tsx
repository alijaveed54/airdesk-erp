'use client';

import { useState, useEffect } from 'react';

// Helper function: DDMMYYYY (e.g. 03092026) ko YYYYMMDD (20260903) bana kar compare karega
function parseBillDateValue(billStr: string): number {
  const clean = String(billStr).trim();
  
  const exactMatch = clean.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (exactMatch) {
    const [, dd, mm, yyyy] = exactMatch;
    return Number(`${yyyy}${mm}${dd}`);
  }

  const embeddedMatch = clean.match(/(\d{2})(\d{2})(\d{4})/);
  if (embeddedMatch) {
    const [, dd, mm, yyyy] = embeddedMatch;
    return Number(`${yyyy}${mm}${dd}`);
  }

  return 0;
}

function sortBillsNewestFirst(bills: string[]): string[] {
  return [...bills].sort((a, b) => {
    const dateA = parseBillDateValue(a);
    const dateB = parseBillDateValue(b);

    if (dateA !== dateB) {
      return dateB - dateA; // Newest date first, oldest at the end
    }
    return b.localeCompare(a);
  });
}

export default function SkycomeReportPage() {
  const [awbNumber, setAwbNumber] = useState('');
  const [dispatchDate, setDispatchDate] = useState('');
  const [awbPhotoBase64, setAwbPhotoBase64] = useState('');
  const [awbPhotoName, setAwbPhotoName] = useState('');

  // Dropdown & Record ID mapping states
  const [suppliersList, setSuppliersList] = useState<string[]>([]);
  const [allBillsList, setAllBillsList] = useState<string[]>([]);
  const [supplierBillsMap, setSupplierBillsMap] = useState<Record<string, string[]>>({});
  const [billRecordIdsMap, setBillRecordIdsMap] = useState<Record<string, string[]>>({});
  const [loadingDropdowns, setLoadingDropdowns] = useState(false);

  const [suppliers, setSuppliers] = useState([
    { supplierName: '', supplierBillNo: '', dispatchQuantity: '', supplierBillBase64: '', supplierBillName: '' }
  ]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Fetch Suppliers, Bills, and Record IDs from Supplier Bill Dispatch API
  useEffect(() => {
    async function fetchSupplierDispatchData() {
      setLoadingDropdowns(true);
      try {
        const res = await fetch('/api/reports/supplier-bill-dispatch');
        const data = await res.json();

        const supSet = new Set<string>();
        const billSet = new Set<string>();
        const map: Record<string, Set<string>> = {};
        const recIdMap: Record<string, Set<string>> = {};

        // Case 1: API returns explicit arrays
        if (Array.isArray(data.suppliers)) {
          data.suppliers.forEach((s: any) => {
            const val = typeof s === 'string' ? s : (s?.name || s?.supplier || s?.value || '');
            if (val) supSet.add(String(val).trim());
          });
        }
        if (Array.isArray(data.bills) || Array.isArray(data.billNumbers)) {
          const bArr = data.bills || data.billNumbers;
          bArr.forEach((b: any) => {
            const val = typeof b === 'string' ? b : (b?.billNo || b?.billNumber || b?.value || '');
            if (val) billSet.add(String(val).trim());
          });
        }

        // Case 2: API returns supplier-to-bills mapping object
        if (data.supplierBills && typeof data.supplierBills === 'object') {
          Object.entries(data.supplierBills).forEach(([sup, bills]: [string, any]) => {
            supSet.add(sup);
            if (!map[sup]) map[sup] = new Set();
            if (Array.isArray(bills)) {
              bills.forEach((b) => {
                const bStr = String(b).trim();
                billSet.add(bStr);
                map[sup].add(bStr);
              });
            }
          });
        }

        // Case 3: API returns records/items/orders array from Airtable
        const records = data.records || data.items || data.orders || data.data || (Array.isArray(data) ? data : []);
        if (Array.isArray(records)) {
          records.forEach((rec: any) => {
            const recId = rec.id || rec.recordId;
            const fields = rec.fields || rec;

            const rawSup = fields['Supplier'];

            const rawBill = fields['bill_no'];

            const sName = Array.isArray(rawSup) ? rawSup[0] : rawSup;
            const bNo = Array.isArray(rawBill) ? rawBill[0] : rawBill;

            const cleanSup = sName ? String(sName).trim() : '';
            const cleanBill = bNo ? String(bNo).trim() : '';

            if (cleanSup) {
              supSet.add(cleanSup);
              if (!map[cleanSup]) map[cleanSup] = new Set();
              if (cleanBill) {
                map[cleanSup].add(cleanBill);
              }
            }
            if (cleanBill) {
              billSet.add(cleanBill);
            }

            // Map Record IDs to Supplier + Bill No combination
            if (recId && cleanSup && cleanBill) {
              const key = `${cleanSup}___${cleanBill}`;
              if (!recIdMap[key]) recIdMap[key] = new Set();
              recIdMap[key].add(String(recId));
            }
          });
        }

        const finalMap: Record<string, string[]> = {};
        Object.keys(map).forEach((k) => {
          finalMap[k] = sortBillsNewestFirst(Array.from(map[k]));
        });

        const finalRecIdMap: Record<string, string[]> = {};
        Object.keys(recIdMap).forEach((k) => {
          finalRecIdMap[k] = Array.from(recIdMap[k]);
        });

        setSuppliersList(Array.from(supSet).sort());
        setAllBillsList(sortBillsNewestFirst(Array.from(billSet)));
        setSupplierBillsMap(finalMap);
        setBillRecordIdsMap(finalRecIdMap);
      } catch (err) {
        console.error('Error fetching supplier-bill-dispatch API:', err);
      } finally {
        setLoadingDropdowns(false);
      }
    }

    fetchSupplierDispatchData();
  }, []);

  // Fetch bills dynamically when a supplier is selected
  const fetchBillsForSupplier = async (supplierName: string) => {
    if (!supplierName) return;
    try {
      const res = await fetch(`/api/reports/supplier-bill-dispatch?supplier=${encodeURIComponent(supplierName)}`);
      const data = await res.json();

      const billSet = new Set<string>(supplierBillsMap[supplierName] || []);
      const bArr = data.bills || data.billNumbers || [];
      if (Array.isArray(bArr)) {
        bArr.forEach((b: any) => {
          const val = typeof b === 'string' ? b : (b?.billNo || b?.billNumber || b?.value || '');
          if (val) billSet.add(String(val).trim());
        });
      }

      const newRecIds: Record<string, Set<string>> = {};
      const records = data.records || data.items || data.orders || data.data || [];
      if (Array.isArray(records)) {
        records.forEach((rec: any) => {
          const recId = rec.id || rec.recordId;
          const fields = rec.fields || rec;
          const rawBill =
            fields['Bill Number'] ||
            fields['Supplier Bill No.'] ||
            fields['Supplier Bill No'] ||
            fields['Bill No.'] ||
            fields['Bill No'] ||
            fields.billNumber ||
            fields.billNo;
          const bNo = Array.isArray(rawBill) ? rawBill[0] : rawBill;
          const cleanBill = bNo ? String(bNo).trim() : '';

          if (cleanBill) {
            billSet.add(cleanBill);
            if (recId) {
              const key = `${supplierName}___${cleanBill}`;
              if (!newRecIds[key]) newRecIds[key] = new Set();
              newRecIds[key].add(String(recId));
            }
          }
        });
      }

      if (billSet.size > 0) {
        setSupplierBillsMap((prev) => ({
          ...prev,
          [supplierName]: sortBillsNewestFirst(Array.from(billSet)),
        }));
      }

      if (Object.keys(newRecIds).length > 0) {
        setBillRecordIdsMap((prev) => {
          const updated = { ...prev };
          Object.keys(newRecIds).forEach((k) => {
            const existing = new Set(updated[k] || []);
            newRecIds[k].forEach((id) => existing.add(id));
            updated[k] = Array.from(existing);
          });
          return updated;
        });
      }
    } catch (e) {
      console.error('Failed to fetch bills for selected supplier:', e);
    }
  };

  // Jab Bill Number select ho toh us bill ki tamam rows ke Record IDs fetch kar lein (agar pehle se load na hon)
  const fetchRecordIdsForSupplierBill = async (supplierName: string, billNo: string) => {
    if (!supplierName || !billNo) return;
    const key = `${supplierName}___${billNo}`;
    if (billRecordIdsMap[key]?.length > 0) return;

    try {
      const res = await fetch(
        `/api/reports/supplier-bill-dispatch?supplier=${encodeURIComponent(supplierName)}&billNumber=${encodeURIComponent(billNo)}&billNo=${encodeURIComponent(billNo)}`
      );
      const data = await res.json();
      const records = data.records || data.items || data.orders || data.data || [];
      if (Array.isArray(records) && records.length > 0) {
        const ids = records.map((r: any) => r.id || r.recordId).filter(Boolean);
        if (ids.length > 0) {
          setBillRecordIdsMap((prev) => ({
            ...prev,
            [key]: Array.from(new Set([...(prev[key] || []), ...ids])),
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch record IDs for bill:', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAwbPhotoName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAwbPhotoBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const addSupplierRow = () => {
    setSuppliers([
      ...suppliers,
      { supplierName: '', supplierBillNo: '', dispatchQuantity: '', supplierBillBase64: '', supplierBillName: '' }
    ]);
  };

  const removeSupplierRow = (index: number) => {
    const list = [...suppliers];
    list.splice(index, 1);
    setSuppliers(list);
  };

  const handleSupplierChange = (index: number, field: string, value: string) => {
    const list: any = [...suppliers];
    list[index][field] = value;

    if (field === 'supplierName') {
      list[index].supplierBillNo = '';
      fetchBillsForSupplier(value);
    } else if (field === 'supplierBillNo') {
      const supName = list[index].supplierName;
      if (supName && value) {
        fetchRecordIdsForSupplierBill(supName, value);
      }
    }

    setSuppliers(list);
  };

  const handleSupplierBillChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const list: any = [...suppliers];
      list[index].supplierBillName = file.name;
      const reader = new FileReader();
      reader.onloadend = () => {
        list[index].supplierBillBase64 = reader.result as string;
        setSuppliers(list);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      // Har supplier row ke sath uske matched Record IDs attach karein taake Skycom AWB update ho sake
      const enrichedSuppliers = suppliers.map((sup) => {
        const key = `${sup.supplierName}___${sup.supplierBillNo}`;
        return {
          ...sup,
          matchedRecordIds: billRecordIdsMap[key] || [],
        };
      });

      const res = await fetch('/api/reports/skycome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          awbNumber,
          dispatchDate,
          awbPhotoBase64,
          awbPhotoName,
          suppliers: enrichedSuppliers
        })
      });

      const data = await res.json();
      if (data.success) {
        setMessage(
          `Successfully saved Skycome dispatch record! (${data.updatedOrderRows || 0} product rows updated with Skycom AWB)`
        );
        setAwbNumber('');
        setDispatchDate('');
        setAwbPhotoBase64('');
        setAwbPhotoName('');
        setSuppliers([{ supplierName: '', supplierBillNo: '', dispatchQuantity: '', supplierBillBase64: '', supplierBillName: '' }]);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">Skycome Courier - Dispatch Entry</h1>

      {message && (
        <div className={`p-4 mb-4 rounded ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">AWB Number</label>
            <input 
              type="text" 
              required
              value={awbNumber} 
              onChange={(e) => setAwbNumber(e.target.value)}
              className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Enter AWB Number"
            />
          </div>

          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">Dispatch Date</label>
            <input 
              type="date" 
              value={dispatchDate} 
              onChange={(e) => setDispatchDate(e.target.value)}
              className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block font-medium text-sm text-gray-700 mb-1">AWB Photo (Direct Upload)</label>
            <input 
              type="file" 
              accept="image/*"
              onChange={handleFileChange}
              className="w-full border p-1.5 rounded bg-gray-50 text-sm focus:ring-2 focus:ring-blue-500"
            />
            {awbPhotoName && <p className="text-xs text-green-600 mt-1">Selected: {awbPhotoName}</p>}
          </div>
        </div>

        <hr className="my-4" />

        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold text-gray-800">Supplier Items & Bills (Multiple Suppliers per AWB)</h3>
            <button 
              type="button"
              onClick={addSupplierRow}
              className="bg-gray-100 text-gray-800 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-200">
              + Add Supplier
            </button>
          </div>

          <div className="space-y-3">
            {suppliers.map((item, index) => {
              const billsForSelectedSupplier = item.supplierName && supplierBillsMap[item.supplierName]?.length > 0
                ? supplierBillsMap[item.supplierName]
                : allBillsList;

              return (
                <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-gray-50 p-3 rounded border">
                  
                  {/* Supplier Name Dropdown */}
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Name</label>
                    <select 
                      required
                      value={item.supplierName}
                      onChange={(e) => handleSupplierChange(index, 'supplierName', e.target.value)}
                      className="w-full border p-2 rounded bg-white text-sm"
                    >
                      <option value="">
                        {loadingDropdowns ? 'Loading Suppliers...' : 'Select Supplier'}
                      </option>
                      {suppliersList.map((sup, idx) => (
                        <option key={idx} value={sup}>{sup}</option>
                      ))}
                    </select>
                  </div>

                  {/* Supplier Bill No. Dropdown (Sorted Newest to Oldest) */}
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Bill No.</label>
                    <select 
                      value={item.supplierBillNo}
                      onChange={(e) => handleSupplierChange(index, 'supplierBillNo', e.target.value)}
                      className="w-full border p-2 rounded bg-white text-sm"
                    >
                      <option value="">
                        {loadingDropdowns ? 'Loading Bills...' : 'Select Bill No.'}
                      </option>
                      {billsForSelectedSupplier.map((bill, idx) => (
                        <option key={idx} value={bill}>{bill}</option>
                      ))}
                    </select>
                  </div>

                  {/* Dispatch Quantity */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Dispatch Qty</label>
                    <input 
                      type="number" 
                      required
                      value={item.dispatchQuantity}
                      onChange={(e) => handleSupplierChange(index, 'dispatchQuantity', e.target.value)}
                      className="w-full border p-2 rounded bg-white text-sm"
                      placeholder="Quantity"
                    />
                  </div>

                  {/* Supplier Bill Attachment */}
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Supplier Bill (JPG)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => handleSupplierBillChange(index, e)}
                      className="w-full border p-1 rounded bg-white text-xs"
                    />
                    {item.supplierBillName && (
                      <p className="text-[10px] text-green-600 truncate mt-0.5">{item.supplierBillName}</p>
                    )}
                  </div>

                  {/* Remove Row Button */}
                  <div className="md:col-span-1 flex justify-end pt-4">
                    {suppliers.length > 1 && (
                      <button 
                        type="button"
                        onClick={() => removeSupplierRow(index)}
                        className="text-red-600 hover:text-red-800 text-sm font-bold p-2">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-4">
          <button 
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Saving...' : 'Save Skycome Dispatch'}
          </button>
        </div>
      </form>
    </div>
  );
}