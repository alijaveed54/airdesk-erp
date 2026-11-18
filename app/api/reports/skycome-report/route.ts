import { NextResponse } from 'next/server';

const SKYCOME_BASE_ID = 'appIJzkEQLOw87bqf';

const ORDER_BASES = [
  {
    name: 'BS Order Entry',
    baseId: 'app2hjpuQoeEL1Rn2',
    tableName: 'BS Order Entry',
  },
  {
    name: 'FAB Order Entry (Non Stock Doha)',
    baseId: 'appiz6tozkQO2TQXt',
    tableName: 'FAB Order Entry',
  },
];

// Helper: Get UAE Standard Time (Asia/Dubai) ISO string format
function getUaeDateTimeIso(): string {
  const now = new Date();
  const uaeDateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' });
  const uaeDate = new Date(uaeDateStr);
  return uaeDate.toISOString();
}

async function syncOrderBasesOnAwbEdit({
  apiKey,
  awbNumber,
  awbStatus,
  isReceivedInUae,
  items,
  originUrl,
}: {
  apiKey: string;
  awbNumber: string;
  awbStatus: string;
  isReceivedInUae: boolean;
  items: { supplierName: string; supplierBillNo: string }[];
  originUrl: string;
}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const validPairs = (items || [])
    .map((i) => ({
      supplierName: String(i.supplierName || '').trim(),
      billNo: String(i.supplierBillNo || '').trim(),
    }))
    .filter((p) => p.supplierName && p.supplierName !== '-' && p.billNo && p.billNo !== '-');

  const cleanAwb = String(awbNumber || '').trim().replace(/'/g, "\\'");

  const formulaParts: string[] = [];
  if (cleanAwb) {
    formulaParts.push(`TRIM({Skycom AWB}&'')='${cleanAwb}'`);
  }
  for (const p of validPairs) {
    const sup = p.supplierName.replace(/'/g, "\\'");
    const bill = p.billNo.replace(/'/g, "\\'");
    formulaParts.push(`AND(TRIM({Supplier}&'')='${sup}', TRIM({bill_no}&'')='${bill}')`);
  }

  if (formulaParts.length === 0) {
    return { totalUpdated: 0, details: [] };
  }

  const filterFormula =
    formulaParts.length === 1 ? formulaParts[0] : `OR(${formulaParts.join(',')})`;

  const uaeIso = getUaeDateTimeIso();
  const uaeDateOnly = uaeIso.split('T')[0];

  let totalUpdated = 0;
  const details: string[] = [];

  for (const target of ORDER_BASES) {
    const encodedTable = encodeURIComponent(target.tableName);
    const matchingRecords: { id: string; fields: Record<string, any> }[] = [];

    let offset = '';
    try {
      do {
        const url = new URL(
          `https://api.airtable.com/v0/${target.baseId}/${encodedTable}`
        );
        url.searchParams.set('pageSize', '100');
        url.searchParams.set('filterByFormula', filterFormula);
        if (offset) url.searchParams.set('offset', offset);

        const res = await fetch(url.toString(), { headers });
        if (!res.ok) {
          console.error(`Error fetching ${target.name}:`, await res.text());
          break;
        }

        const data = await res.json();
        for (const rec of data.records || []) {
          matchingRecords.push({ id: rec.id, fields: rec.fields || {} });
        }

        offset = data.offset || '';
      } while (offset);
    } catch (err) {
      console.error(`Failed querying ${target.name}:`, err);
    }

    if (matchingRecords.length === 0) {
      details.push(`${target.name}: 0 rows matched`);
      continue;
    }

    // Call supplier-bill-dispatch API route directly to ensure consistent update logic with date/time
    if (originUrl && validPairs.length > 0) {
      for (const pair of validPairs) {
        try {
          const dispatchApiUrl = new URL(`${originUrl}/api/reports/supplier-bill-dispatch`);
          dispatchApiUrl.searchParams.set('supplier', pair.supplierName);
          dispatchApiUrl.searchParams.set('billNo', pair.billNo);

          // 1. GET items for this supplier and bill to collect their record selections
          const getRes = await fetch(dispatchApiUrl.toString(), {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: 'no-store',
          });
          const getData = await getRes.json();

          if (getRes.ok && Array.isArray(getData.rows) && getData.rows.length > 0) {
            const selections = getData.rows.map((r: any) => ({
              source: r.source,
              recordId: r.recordId,
            }));

            // 2. PATCH supplier-bill-dispatch with action 'receive' or 'undo'
            await fetch(`${originUrl}/api/reports/supplier-bill-dispatch`, {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                supplier: pair.supplierName,
                billNo: pair.billNo,
                action: isReceivedInUae ? 'receive' : 'undo',
                selections,
              }),
            });
          }
        } catch (e) {
          console.error('Failed calling supplier-bill-dispatch sync:', e);
        }
      }
    }

    const sampleFields = matchingRecords[0]?.fields || {};
    const sampleRecVal = sampleFields['Received In UAE'] ?? sampleFields['Received in UAE'];
    const isFieldTypeSelect = typeof sampleRecVal === 'object' || sampleRecVal === null || typeof sampleRecVal === 'string';

    let baseUpdatedCount = 0;

    for (let i = 0; i < matchingRecords.length; i += 10) {
      const chunk = matchingRecords.slice(i, i + 10);

      const recordsPayload = chunk.map((r) => {
        const fieldsToUpdate: Record<string, any> = {
          'Skycom AWB': awbNumber,
          'Skycom AWB Status': awbStatus,
        };

        if (isFieldTypeSelect) {
          fieldsToUpdate['Received In UAE'] = isReceivedInUae ? 'Yes' : null;
        } else {
          fieldsToUpdate['Received In UAE'] = isReceivedInUae ? true : false;
        }

        // UAE Standard Time DateTime & Date
        fieldsToUpdate['Received In UAE DateTime'] = isReceivedInUae ? uaeIso : null;

        return { id: r.id, fields: fieldsToUpdate };
      });

      let patchRes = await fetch(
        `https://api.airtable.com/v0/${target.baseId}/${encodedTable}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ records: recordsPayload }),
        }
      );

      if (!patchRes.ok) {
        const fallbackPayload = chunk.map((r) => ({
          id: r.id,
          fields: {
            'Skycom AWB': awbNumber,
            'Skycom AWB Status': awbStatus,
            'Received In UAE': isReceivedInUae ? 'Yes' : null,
            'Received In UAE DateTime': isReceivedInUae ? uaeIso : null,
          },
        }));

        const fallbackRes = await fetch(
          `https://api.airtable.com/v0/${target.baseId}/${encodedTable}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ records: fallbackPayload }),
          }
        );

        if (fallbackRes.ok) {
          baseUpdatedCount += chunk.length;
          totalUpdated += chunk.length;
        } else {
          console.error(`Patch error in ${target.name}:`, await fallbackRes.text());
        }
      } else {
        baseUpdatedCount += chunk.length;
        totalUpdated += chunk.length;
      }
    }

    details.push(`${target.name}: ${baseUpdatedCount} rows updated`);
  }

  return { totalUpdated, details };
}

export async function GET() {
  try {
    const apiKey = process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Airtable token missing' }, { status: 500 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const awbRes = await fetch(
      `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20AWBs?sort%5B0%5D%5Bfield%5D=Dispatch%20Date&sort%5B0%5D%5Bdirection%5D=desc`,
      { headers, cache: 'no-store' }
    );
    const awbData = await awbRes.json();
    if (!awbRes.ok) throw new Error(awbData.error?.message || 'Failed to fetch AWBs');

    const itemsRes = await fetch(
      `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20Items`,
      { headers, cache: 'no-store' }
    );
    const itemsData = await itemsRes.json();
    if (!itemsRes.ok) throw new Error(itemsData.error?.message || 'Failed to fetch Skycome Items');

    const itemsByAwbId: Record<string, any[]> = {};
    for (const item of itemsData.records || []) {
      const fields = item.fields || {};
      const awbLinks = fields['AWB Number'] || fields['AWB'] || [];

      for (const parentId of awbLinks) {
        if (!itemsByAwbId[parentId]) itemsByAwbId[parentId] = [];
        itemsByAwbId[parentId].push({
          supplierName: fields['Supplier Name'] || fields['Supplier'] || '-',
          supplierBillNo: fields['Supplier Bill No.'] || fields['bill_no'] || '-',
          dispatchQuantity: Number(fields['Dispatch Quantity'] || fields['Quantity'] || 0),
        });
      }
    }

    const reportRows: any[] = [];

    for (const awbRec of awbData.records || []) {
      const aFields = awbRec.fields || {};
      const awbNo = aFields['AWB Number'] || '-';
      const dispatchDate = aFields['Dispatch Date'] || '-';

      const photos = aFields['AWB Photo'] || aFields['Image'] || [];
      const awbImageUrl = Array.isArray(photos) && photos.length > 0 ? photos[0].url : '';

      const rawRecValue = String(aFields['Received In UAE'] || '').trim().toLowerCase();
      const isReceived = rawRecValue === 'yes' || rawRecValue === 'true' || aFields['Received In UAE'] === true;
      const receivedInUae = isReceived ? 'Yes' : 'No';
      const awbStatus = aFields['AWB Status'] || 'Dispatched';

      const childItems = itemsByAwbId[awbRec.id] || [];

      if (childItems.length > 0) {
        for (const item of childItems) {
          reportRows.push({
            id: `${awbRec.id}-${item.supplierName}-${item.supplierBillNo}`,
            awbRecordId: awbRec.id,
            dispatchDate,
            awbNumber: awbNo,
            awbImageUrl,
            supplierName: item.supplierName,
            supplierBillNo: item.supplierBillNo,
            totalQuantity: item.dispatchQuantity,
            receivedInUae,
            awbStatus,
          });
        }
      } else {
        reportRows.push({
          id: awbRec.id,
          awbRecordId: awbRec.id,
          dispatchDate,
          awbNumber: awbNo,
          awbImageUrl,
          supplierName: '-',
          supplierBillNo: '-',
          totalQuantity: 0,
          receivedInUae,
          awbStatus,
        });
      }
    }

    return NextResponse.json({
      success: true,
      records: reportRows,
    });
  } catch (error: any) {
    console.error('Skycome Report GET Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { awbRecordId, awbNumber, receivedInUae, awbStatus, items } = body;

    if (!awbRecordId || !awbNumber) {
      return NextResponse.json(
        { success: false, error: 'awbRecordId and awbNumber are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Airtable token missing' }, { status: 500 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const isReceived = receivedInUae === 'Yes' || receivedInUae === true;
    const finalStatus = isReceived
      ? 'Delivered in UAE'
      : String(awbStatus || 'Dispatched').trim();

    const selectReceivedInUae = isReceived ? 'Yes' : null;
    const uaeIso = getUaeDateTimeIso();
    const uaeDateOnly = uaeIso.split('T')[0];

    // 1. Update Skycome AWBs table (using UAE time for Received Date)
    const skycomePatchRes = await fetch(
      `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20AWBs`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          records: [
            {
              id: awbRecordId,
              fields: {
                'AWB Status': finalStatus,
                'Received In UAE': selectReceivedInUae,
                'Received Date': isReceived ? uaeDateOnly : null,
              },
            },
          ],
        }),
      }
    );

    const skycomePatchData = await skycomePatchRes.json();
    if (!skycomePatchRes.ok) {
      throw new Error(
        skycomePatchData.error?.message || 'Failed to update Skycome AWBs record'
      );
    }

    // 2. Sync across BS Order Entry & FAB Order Entry using exact supplier bill dispatcher route logic + UAE time
    const originUrl = new URL(request.url).origin;
    const syncResult = await syncOrderBasesOnAwbEdit({
      apiKey,
      awbNumber,
      awbStatus: finalStatus,
      isReceivedInUae: isReceived,
      items: items || [],
      originUrl,
    });

    return NextResponse.json({
      success: true,
      awbStatus: finalStatus,
      receivedInUae: isReceived ? 'Yes' : 'No',
      updatedOrderRows: syncResult.totalUpdated,
      syncDetails: syncResult.details,
      message: `AWB ${awbNumber} updated! Status: "${finalStatus}", Received in UAE: "${isReceived ? 'Yes' : 'No'}". Synced ${syncResult.totalUpdated} rows.`,
    });
  } catch (error: any) {
    console.error('Skycome Report PATCH Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}