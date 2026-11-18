'use client';

import { useEffect, useState, Fragment } from 'react';

type ItemDetail = {
  supplierName: string;
  supplierBillNo: string;
  totalQuantity: number;
};

type GroupedAwbRow = {
  id: string;
  awbRecordId: string;
  dispatchDate: string;
  awbNumber: string;
  awbImageUrl: string;
  receivedInUae: string;
  awbStatus: string;
  items: ItemDetail[];
};

const STATUS_OPTIONS = [
  'Dispatched',
  'In Transit',
  'Custom Clearance',
  'Out for Delivery',
  'Delivered in UAE',
  'Delayed',
];

export default function SkycomeDispatchReportPage() {
  const [groupedRows, setGroupedRows] = useState<GroupedAwbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [expandedAwb, setExpandedAwb] = useState<string | null>(null);

  // Edit Modal states
  const [editingRow, setEditingRow] = useState<GroupedAwbRow | null>(null);
  const [editReceivedInUae, setEditReceivedInUae] = useState<'Yes' | 'No'>('No');
  const [editAwbStatus, setEditAwbStatus] = useState<string>('Dispatched');
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reports/skycome-report');
      const data = await res.json();
      if (data.success) {
        const map: Record<string, GroupedAwbRow> = {};

        for (const rec of data.records || []) {
          if (!map[rec.awbNumber]) {
            map[rec.awbNumber] = {
              id: rec.id,
              awbRecordId: rec.awbRecordId || rec.id.split('-')[0],
              dispatchDate: rec.dispatchDate,
              awbNumber: rec.awbNumber,
              awbImageUrl: rec.awbImageUrl,
              receivedInUae: rec.receivedInUae,
              awbStatus: rec.awbStatus,
              items: [],
            };
          }
          if (rec.supplierName && rec.supplierName !== '-') {
            map[rec.awbNumber].items.push({
              supplierName: rec.supplierName,
              supplierBillNo: rec.supplierBillNo,
              totalQuantity: rec.totalQuantity,
            });
          }
        }

        setGroupedRows(Object.values(map));
      } else {
        setError(data.error || 'Failed to load report');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  const toggleExpand = (awbNumber: string) => {
    setExpandedAwb(expandedAwb === awbNumber ? null : awbNumber);
  };

  // Open Edit Modal
  const openEditModal = (row: GroupedAwbRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentRec = row.receivedInUae === 'Yes' ? 'Yes' : 'No';
    setEditingRow(row);
    setEditReceivedInUae(currentRec);
    setEditAwbStatus(
      currentRec === 'Yes' ? 'Delivered in UAE' : row.awbStatus || 'Dispatched'
    );
  };

  // Jab Received in UAE ko "Yes" karein toh status automatically "Delivered in UAE" ho jaye
  const handleReceivedChange = (val: 'Yes' | 'No') => {
    setEditReceivedInUae(val);
    if (val === 'Yes') {
      setEditAwbStatus('Delivered in UAE');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;

    setSavingEdit(true);
    setError('');
    setSuccessMsg('');

    try {
      const finalStatus =
        editReceivedInUae === 'Yes' ? 'Delivered in UAE' : editAwbStatus;

      const res = await fetch('/api/reports/skycome-report', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          awbRecordId: editingRow.awbRecordId,
          awbNumber: editingRow.awbNumber,
          receivedInUae: editReceivedInUae,
          awbStatus: finalStatus,
          items: editingRow.items,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg(data.message || 'AWB updated and synced across all bases!');
        setGroupedRows((prev) =>
          prev.map((r) =>
            r.awbNumber === editingRow.awbNumber
              ? {
                  ...r,
                  receivedInUae: data.receivedInUae,
                  awbStatus: data.awbStatus,
                }
              : r
          )
        );
        setEditingRow(null);
      } else {
        setError(data.error || 'Failed to update AWB');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update AWB');
    } finally {
      setSavingEdit(false);
    }
  };

  const filteredRows = groupedRows.filter((r) => {
    const q = search.toLowerCase();
    const matchAwb = r.awbNumber.toLowerCase().includes(q);
    const matchDate = r.dispatchDate.toLowerCase().includes(q);
    const matchSupplier = r.items.some(
      (item) =>
        item.supplierName.toLowerCase().includes(q) ||
        item.supplierBillNo.toLowerCase().includes(q)
    );
    return matchAwb || matchDate || matchSupplier;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Skycome Dispatch Report</h1>
          <p className="text-sm text-slate-500">
            Date-wise sorted (Newest on top) - Click AWB to expand items or Edit to update status
          </p>
        </div>

        <input
          type="text"
          placeholder="Search AWB, Supplier, Bill No..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-slate-300 rounded-xl px-4 py-2 text-sm w-full md:w-80 focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm"
        />
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-50 text-red-700 font-semibold text-sm">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-700 font-semibold text-sm border border-emerald-200">
          {successMsg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                <th className="p-4">Dispatch Date</th>
                <th className="p-4">AWB Number</th>
                <th className="p-4">AWB Image</th>
                <th className="p-4">Suppliers Summary</th>
                <th className="p-4 text-center">Total Qty</th>
                <th className="p-4 text-center">Received in UAE</th>
                <th className="p-4">AWB Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                    Loading report data...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                    No records found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isExpanded = expandedAwb === row.awbNumber;
                  const totalAwbQty = row.items.reduce(
                    (sum, item) => sum + (Number(item.totalQuantity) || 0),
                    0
                  );

                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => toggleExpand(row.awbNumber)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer select-none"
                      >
                        <td className="p-4 font-medium text-slate-900">{row.dispatchDate}</td>
                        <td className="p-4 font-bold text-blue-600 flex items-center gap-2">
                          <span>{row.awbNumber}</span>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                            {row.items.length} Suppliers
                          </span>
                        </td>
                        <td className="p-4" onClick={(e) => e.stopPropagation()}>
                          {row.awbImageUrl ? (
                            <a href={row.awbImageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={row.awbImageUrl}
                                alt="AWB Slip"
                                className="w-10 h-10 object-cover rounded-lg border border-slate-200 hover:scale-105 transition-transform"
                              />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">No Image</span>
                          )}
                        </td>
                        <td className="p-4 font-medium text-slate-800">
                          {row.items.map((i) => i.supplierName).join(', ')}
                        </td>
                        <td className="p-4 text-center font-bold text-slate-900">
                          {totalAwbQty}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              row.receivedInUae === 'Yes'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {row.receivedInUae}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                              row.awbStatus === 'Delivered in UAE'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {row.awbStatus}
                          </span>
                        </td>
                        <td
                          className="p-4 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => openEditModal(row, e)}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleExpand(row.awbNumber)}
                              className="p-1.5 text-slate-400 hover:text-slate-700 font-bold"
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={8} className="p-4 px-8">
                            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                              <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                                Items included in AWB: {row.awbNumber}
                              </h4>
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-slate-100 text-slate-500 font-bold">
                                    <th className="pb-2">Supplier Name</th>
                                    <th className="pb-2">Supplier Bill No.</th>
                                    <th className="pb-2 text-right">Total Quantity</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {row.items.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                      <td className="py-2.5 font-bold text-slate-800">
                                        {item.supplierName}
                                      </td>
                                      <td className="py-2.5 font-medium text-slate-600">
                                        {item.supplierBillNo}
                                      </td>
                                      <td className="py-2.5 text-right font-black text-slate-900">
                                        {item.totalQuantity}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Edit AWB: {editingRow.awbNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Suppliers: {editingRow.items.map((i) => `${i.supplierName} (${i.supplierBillNo})`).join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  Received in UAE
                </label>
                <select
                  value={editReceivedInUae}
                  onChange={(e) => handleReceivedChange(e.target.value as 'Yes' | 'No')}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm font-semibold bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes (Receive All Items in UAE)</option>
                </select>
                {editReceivedInUae === 'Yes' && (
                  <p className="text-xs text-emerald-600 font-medium mt-1">
                    ✓ Status will automatically be set to &quot;Delivered in UAE&quot; and all linked supplier bill items will be marked Received in UAE.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  AWB Status (Syncs to Skycom AWB Status)
                </label>
                <select
                  value={editReceivedInUae === 'Yes' ? 'Delivered in UAE' : editAwbStatus}
                  disabled={editReceivedInUae === 'Yes'}
                  onChange={(e) => setEditAwbStatus(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm font-semibold bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingRow(null)}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingEdit ? 'Updating All Bases...' : 'Save & Sync'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}