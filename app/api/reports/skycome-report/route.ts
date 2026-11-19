import { NextResponse } from 'next/server';

const SKYCOME_BASE_ID = 'appIJzkEQLOw87bqf';
const SKYCOME_TRACKING_URL = 'https://skycomex.in/tracking/';

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

function getUaeDateTimeIso(): string {
  const now = new Date();
  const uaeDateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' });
  const uaeDate = new Date(uaeDateStr);
  return uaeDate.toISOString();
}

function cleanHtmlText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStatusFromText(text: string, awbNumber: string): string | null {
  const knownStatuses = [
    'Delivered in UAE',
    'Out for Delivery',
    'Custom Clearance',
    'Customs Cleared',
    'Arrived at Hub',
    'In Transit',
    'Dispatched',
    'Picked Up',
    'Booked',
    'Delivered',
    'Delayed',
  ];

  const lower = text.toLowerCase();
  for (const st of knownStatuses) {
    if (lower.includes(st.toLowerCase())) {
      return st;
    }
  }

  // Fallback pattern search near AWB or "Status:"
  const statusMatch = text.match(/status\s*[:\-]\s*([A-Za-z0-9\s/_-]{3,40})/i);
  if (statusMatch?.[1]) {
    const candidate = statusMatch[1].trim();
    if (!candidate.toLowerCase().includes('enter') && !candidate.toLowerCase().includes('tracking number')) {
      return candidate;
    }
  }

  void awbNumber;
  return null;
}

// Fetch live tracking status from https://skycomex.in/tracking/
async function fetchLiveTrackingStatusFromSkycomex(
  awbNumber: string
): Promise<{ status: string | null; sourceNote: string }> {
  const cleanAwb = String(awbNumber || '').trim();
  if (!cleanAwb) return { status: null, sourceNote: 'Empty AWB' };

  const commonHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    // Attempt 1: GET with query params
    const getUrl = new URL(SKYCOME_TRACKING_URL);
    getUrl.searchParams.set('awb', cleanAwb);
    getUrl.searchParams.set('tracking_number', cleanAwb);
    getUrl.searchParams.set('track', cleanAwb);

    const getRes = await fetch(getUrl.toString(), {
      method: 'GET',
      headers: commonHeaders,
      cache: 'no-store',
    });

    if (getRes.ok) {
      const html = await getRes.text();
      const plain = cleanHtmlText(html);
      const parsed = extractStatusFromText(plain, cleanAwb);
      if (parsed) {
        return { status: parsed, sourceNote: 'Fetched via GET' };
      }
    }

    // Attempt 2: POST form submission to tracking page
    const formBody = new URLSearchParams();
    formBody.set('awb', cleanAwb);
    formBody.set('awb_no', cleanAwb);
    formBody.set('tracking_no', cleanAwb);
    formBody.set('tracking_number', cleanAwb);
    formBody.set('track_number', cleanAwb);

    const postRes = await fetch(SKYCOME_TRACKING_URL, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: SKYCOME_TRACKING_URL,
      },
      body: formBody.toString(),
      cache: 'no-store',
    });

    if (postRes.ok) {
      const contentType = postRes.headers.get('content-type') || '';
      const rawText = await postRes.text();

      if (contentType.includes('application/json')) {
        const json = JSON.parse(rawText);
        const rawStatus =
          json?.status ||
          json?.current_status ||
          json?.data?.status ||
          json?.tracking_status ||
          null;
        if (rawStatus) {
          return { status: String(rawStatus).trim(), sourceNote: 'Fetched via JSON POST' };
        }
      } else {
        const plain = cleanHtmlText(rawText);
        const parsed = extractStatusFromText(plain, cleanAwb);
        if (parsed) {
          return { status: parsed, sourceNote: 'Fetched via HTML POST' };
        }
      }
    }

    return {
      status: null,
      sourceNote: 'No status parsed from skycomex.in/tracking/ (may require JS/form field inspection)',
    };
  } catch (err: any) {
    return {
      status: null,
      sourceNote: `Tracking fetch error: ${err?.message || 'network error'}`,
    };
  }
}

async function syncOrderBasesOnAwbEdit({
  apiKey,
  awbNumber,
  awbStatus,
  isReceivedInUae,
  items,
  originUrl,
  updateReceivingFields = true,
}: {
  apiKey: string;
  awbNumber: string;
  awbStatus: string;
  isReceivedInUae: boolean;
  items: { supplierName: string; supplierBillNo: string }[];
  originUrl: string;
  updateReceivingFields?: boolean;
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
    .filter(
      (p) =>
        p.supplierName &&
        p.supplierName !== '-' &&
        p.billNo &&
        p.billNo !== '-'
    );

  const cleanAwb = String(awbNumber || '').trim().replace(/'/g, "\\'");

  const formulaParts: string[] = [];
  if (cleanAwb) {
    formulaParts.push(`TRIM({Skycom AWB}&'')='${cleanAwb}'`);
  }
  for (const p of validPairs) {
    const sup = p.supplierName.replace(/'/g, "\\'");
    const bill = p.billNo.replace(/'/g, "\\'");
    formulaParts.push(
      `AND(TRIM({Supplier}&'')='${sup}', TRIM({bill_no}&'')='${bill}')`
    );
  }

  if (formulaParts.length === 0) {
    return { totalUpdated: 0, details: [] };
  }

  const filterFormula =
    formulaParts.length === 1 ? formulaParts[0] : `OR(${formulaParts.join(',')})`;

  const uaeIso = getUaeDateTimeIso();

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

    if (updateReceivingFields && originUrl && validPairs.length > 0) {
      for (const pair of validPairs) {
        try {
          const dispatchApiUrl = new URL(
            `${originUrl}/api/reports/supplier-bill-dispatch`
          );
          dispatchApiUrl.searchParams.set('supplier', pair.supplierName);
          dispatchApiUrl.searchParams.set('billNo', pair.billNo);

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
    const sampleRecVal =
      sampleFields['Received In UAE'] ?? sampleFields['Received in UAE'];
    const isFieldTypeSelect =
      typeof sampleRecVal === 'object' ||
      sampleRecVal === null ||
      typeof sampleRecVal === 'string';

    let baseUpdatedCount = 0;

    for (let i = 0; i < matchingRecords.length; i += 10) {
      const chunk = matchingRecords.slice(i, i + 10);

      const recordsPayload = chunk.map((r) => {
        const fieldsToUpdate: Record<string, any> = {
          'Skycom AWB': awbNumber,
          'Skycom AWB Status': awbStatus,
        };

        if (updateReceivingFields) {
          if (isFieldTypeSelect) {
            fieldsToUpdate['Received In UAE'] = isReceivedInUae ? 'Yes' : null;
          } else {
            fieldsToUpdate['Received In UAE'] = isReceivedInUae ? true : false;
          }
          fieldsToUpdate['Received In UAE DateTime'] = isReceivedInUae
            ? uaeIso
            : null;
        }

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
            ...(updateReceivingFields
              ? {
                  'Received In UAE': isReceivedInUae ? 'Yes' : null,
                  'Received In UAE DateTime': isReceivedInUae ? uaeIso : null,
                }
              : {}),
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
          console.error(
            `Patch error in ${target.name}:`,
            await fallbackRes.text()
          );
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

async function fetchGroupedSkycomeData(apiKey: string) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const awbRes = await fetch(
    `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20AWBs?sort%5B0%5D%5Bfield%5D=Dispatch%20Date&sort%5B0%5D%5Bdirection%5D=desc`,
    { headers, cache: 'no-store' }
  );
  const awbData = await awbRes.json();
  if (!awbRes.ok)
    throw new Error(awbData.error?.message || 'Failed to fetch AWBs');

  const itemsRes = await fetch(
    `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20Items`,
    { headers, cache: 'no-store' }
  );
  const itemsData = await itemsRes.json();
  if (!itemsRes.ok)
    throw new Error(itemsData.error?.message || 'Failed to fetch Skycome Items');

  const itemsByAwbId: Record<string, any[]> = {};
  for (const item of itemsData.records || []) {
    const fields = item.fields || {};
    const awbLinks = fields['AWB Number'] || fields['AWB'] || [];

    for (const parentId of awbLinks) {
      if (!itemsByAwbId[parentId]) itemsByAwbId[parentId] = [];
      itemsByAwbId[parentId].push({
        supplierName: fields['Supplier Name'] || fields['Supplier'] || '-',
        supplierBillNo: fields['Supplier Bill No.'] || fields['bill_no'] || '-',
        dispatchQuantity: Number(
          fields['Dispatch Quantity'] || fields['Quantity'] || 0
        ),
      });
    }
  }

  const reportRows: any[] = [];

  for (const awbRec of awbData.records || []) {
    const aFields = awbRec.fields || {};
    const awbNo = aFields['AWB Number'] || '-';
    const dispatchDate = aFields['Dispatch Date'] || '-';

    const photos = aFields['AWB Photo'] || aFields['Image'] || [];
    const awbImageUrl =
      Array.isArray(photos) && photos.length > 0 ? photos[0].url : '';

    const rawRecValue = String(aFields['Received In UAE'] || '')
      .trim()
      .toLowerCase();
    const isReceived =
      rawRecValue === 'yes' ||
      rawRecValue === 'true' ||
      aFields['Received In UAE'] === true;
    const receivedInUae = isReceived ? 'Yes' : 'No';
    const awbStatus = String(aFields['AWB Status'] || 'Dispatched').trim();

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

  return reportRows;
}

export async function GET() {
  try {
    const apiKey =
      process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Airtable token missing' },
        { status: 500 }
      );
    }

    const reportRows = await fetchGroupedSkycomeData(apiKey);
    return NextResponse.json({
      success: true,
      records: reportRows,
    });
  } catch (error: any) {
    console.error('Skycome Report GET Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// Fetch live status from skycomex.in/tracking for unreceived AWBs & update Airtable
export async function POST(request: Request) {
  try {
    const apiKey =
      process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Airtable token missing' },
        { status: 500 }
      );
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const flatRows = await fetchGroupedSkycomeData(apiKey);

    const awbGroups: Record<
      string,
      {
        awbRecordId: string;
        awbNumber: string;
        awbStatus: string;
        receivedInUae: string;
        items: { supplierName: string; supplierBillNo: string }[];
      }
    > = {};

    for (const row of flatRows) {
      if (!awbGroups[row.awbNumber]) {
        awbGroups[row.awbNumber] = {
          awbRecordId: row.awbRecordId,
          awbNumber: row.awbNumber,
          awbStatus: row.awbStatus,
          receivedInUae: row.receivedInUae,
          items: [],
        };
      }
      if (row.supplierName && row.supplierName !== '-') {
        awbGroups[row.awbNumber].items.push({
          supplierName: row.supplierName,
          supplierBillNo: row.supplierBillNo,
        });
      }
    }

    const unreceivedAwbs = Object.values(awbGroups).filter(
      (g) => g.receivedInUae !== 'Yes' && g.awbNumber && g.awbNumber !== '-'
    );

    const originUrl = new URL(request.url).origin;
    let updatedAwbCount = 0;
    let syncedOrderRows = 0;
    const notes: string[] = [];

    for (const awb of unreceivedAwbs) {
      const tracked = await fetchLiveTrackingStatusFromSkycomex(awb.awbNumber);

      if (!tracked.status) {
        notes.push(`${awb.awbNumber}: ${tracked.sourceNote}`);
        continue;
      }

      const newStatus = tracked.status;

      // Update Skycome AWBs record status in Airtable
      const patchRes = await fetch(
        `https://api.airtable.com/v0/${SKYCOME_BASE_ID}/Skycome%20AWBs`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            records: [
              {
                id: awb.awbRecordId,
                fields: {
                  'AWB Status': newStatus,
                },
              },
            ],
          }),
        }
      );

      if (patchRes.ok) {
        updatedAwbCount += 1;
      }

      // Sync to BS & FAB Order Entry bases
      const syncRes = await syncOrderBasesOnAwbEdit({
        apiKey,
        awbNumber: awb.awbNumber,
        awbStatus: newStatus,
        isReceivedInUae: false,
        items: awb.items,
        originUrl,
        updateReceivingFields: false,
      });

      syncedOrderRows += syncRes.totalUpdated;
      notes.push(`${awb.awbNumber} -> "${newStatus}" (${tracked.sourceNote})`);
    }

    const refreshedRows = await fetchGroupedSkycomeData(apiKey);

    return NextResponse.json({
      success: true,
      unreceivedAwbCount: unreceivedAwbs.length,
      updatedAwbCount,
      syncedOrderRows,
      notes,
      records: refreshedRows,
      message:
        updatedAwbCount > 0
          ? `Checked ${unreceivedAwbs.length} unreceived AWB(s) on skycomex.in/tracking: updated ${updatedAwbCount} AWB(s) and ${syncedOrderRows} order rows.`
          : `Checked ${unreceivedAwbs.length} unreceived AWB(s) on skycomex.in/tracking, but no parseable live status was returned (${notes.join(' | ')}).`,
    });
  } catch (error: any) {
    console.error('Skycome Report Live Tracking POST Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { awbRecordId, awbNumber, receivedInUae, awbStatus, items } = body;

    if (!awbRecordId || !awbNumber) {
      return NextResponse.json(
        {
          success: false,
          error: 'awbRecordId and awbNumber are required',
        },
        { status: 400 }
      );
    }

    const apiKey =
      process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Airtable token missing' },
        { status: 500 }
      );
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
        skycomePatchData.error?.message ||
          'Failed to update Skycome AWBs record'
      );
    }

    const originUrl = new URL(request.url).origin;
    const syncResult = await syncOrderBasesOnAwbEdit({
      apiKey,
      awbNumber,
      awbStatus: finalStatus,
      isReceivedInUae: isReceived,
      items: items || [],
      originUrl,
      updateReceivingFields: true,
    });

    return NextResponse.json({
      success: true,
      awbStatus: finalStatus,
      receivedInUae: isReceived ? 'Yes' : 'No',
      updatedOrderRows: syncResult.totalUpdated,
      syncDetails: syncResult.details,
      message: `AWB ${awbNumber} updated! Status: "${finalStatus}", Received in UAE: "${
        isReceived ? 'Yes' : 'No'
      }". Synced ${syncResult.totalUpdated} rows.`,
    });
  } catch (error: any) {
    console.error('Skycome Report PATCH Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}