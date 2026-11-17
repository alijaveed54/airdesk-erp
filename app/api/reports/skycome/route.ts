import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

// Dono Order Entry Bases ki configuration
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

// Helper: Record ke fields mein Supplier aur `bill_no` match check karein
function isMatchingSupplierAndBill(
  fields: Record<string, any>,
  targetSupplier: string,
  targetBill: string
): boolean {
  const normSup = targetSupplier.trim().toLowerCase();
  const normBill = targetBill.trim().toLowerCase();
  const normBillNoLeadingZero = normBill.replace(/^0+/, '');

  let supplierMatched = false;
  let billMatched = false;

  // Check exact `bill_no` field first
  const rawBillNo = fields['bill_no'] ?? fields['Bill_No'] ?? fields['BILL_NO'];
  if (rawBillNo !== undefined && rawBillNo !== null) {
    const billVals = Array.isArray(rawBillNo) ? rawBillNo : [rawBillNo];
    for (const v of billVals) {
      const strVal = String(v ?? '').trim().toLowerCase();
      const strValNoZero = strVal.replace(/^0+/, '');
      if (
        strVal === normBill ||
        (normBillNoLeadingZero && strValNoZero === normBillNoLeadingZero)
      ) {
        billMatched = true;
      }
    }
  }

  for (const [key, rawVal] of Object.entries(fields)) {
    const keyLower = key.toLowerCase();
    const values = Array.isArray(rawVal) ? rawVal : [rawVal];

    for (const v of values) {
      if (v === null || v === undefined) continue;
      const strVal = String(v).trim().toLowerCase();
      if (!strVal) continue;

      // Check Supplier columns (e.g. Supplier, ALV Supplier Code, Supplier Name, supplier)
      if (keyLower.includes('supplier') && !keyLower.includes('bill')) {
        if (strVal === normSup || strVal.includes(normSup)) {
          supplierMatched = true;
        }
      }

      // Fallback check for any other bill column name
      if (!billMatched && keyLower.includes('bill')) {
        const strValNoZero = strVal.replace(/^0+/, '');
        if (
          strVal === normBill ||
          (normBillNoLeadingZero && strValNoZero === normBillNoLeadingZero)
        ) {
          billMatched = true;
        }
      }
    }
  }

  return supplierMatched && billMatched;
}

// Helper: BS Order Entry aur FAB Order Entry mein `bill_no` filter karke 'Skycom AWB' update karein
async function updateOrderBasesWithAwb(
  apiKey: string,
  awbNumber: string,
  suppliers: any[]
) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const validPairs = suppliers
    .map((s) => ({
      supplierName: String(s.supplierName || '').trim(),
      billNo: String(s.supplierBillNo || '').trim(),
    }))
    .filter((p) => p.supplierName && p.billNo);

  if (validPairs.length === 0) return { totalUpdated: 0, details: [] };

  let totalUpdated = 0;
  const details: string[] = [];

  // Airtable filterByFormula on `{bill_no}` for fast lookup
  const uniqueBills = Array.from(new Set(validPairs.map((p) => p.billNo)));
  const billFormulaParts: string[] = [];
  for (const b of uniqueBills) {
    const cleanB = b.replace(/'/g, "\\'");
    const noZeroB = cleanB.replace(/^0+/, '');
    billFormulaParts.push(`TRIM({bill_no}&'')='${cleanB}'`);
    if (noZeroB && noZeroB !== cleanB) {
      billFormulaParts.push(`TRIM({bill_no}&'')='${noZeroB}'`);
    }
  }
  const filterFormula =
    billFormulaParts.length === 1
      ? billFormulaParts[0]
      : `OR(${billFormulaParts.join(',')})`;

  for (const target of ORDER_BASES) {
    const encodedTable = encodeURIComponent(target.tableName);
    const matchingRecordIds = new Set<string>();

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
        const records = data.records || [];

        for (const rec of records) {
          const fields = rec.fields || {};
          for (const pair of validPairs) {
            if (isMatchingSupplierAndBill(fields, pair.supplierName, pair.billNo)) {
              matchingRecordIds.add(rec.id);
              break;
            }
          }
        }

        offset = data.offset || '';
      } while (offset);
    } catch (err) {
      console.error(`Failed scanning ${target.name}:`, err);
    }

    const idsArray = Array.from(matchingRecordIds);
    if (idsArray.length === 0) {
      details.push(`${target.name}: 0 rows matched`);
      continue;
    }

    // Matching Record IDs par 'Skycom AWB' update karein (max 10 records per batch)
    let baseUpdatedCount = 0;
    const candidateFieldNames = ['Skycom AWB', 'Skycome AWB'];

    for (let i = 0; i < idsArray.length; i += 10) {
      const chunk = idsArray.slice(i, i + 10);

      for (const fieldName of candidateFieldNames) {
        const patchRes = await fetch(
          `https://api.airtable.com/v0/${target.baseId}/${encodedTable}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              records: chunk.map((id) => ({
                id,
                fields: {
                  [fieldName]: awbNumber,
                },
              })),
            }),
          }
        );

        if (patchRes.ok) {
          baseUpdatedCount += chunk.length;
          totalUpdated += chunk.length;
          break;
        } else {
          const errText = await patchRes.text();
          if (!errText.includes('UNKNOWN_FIELD_NAME')) {
            console.error(`Patch error in ${target.name}:`, errText);
            break;
          }
        }
      }
    }

    details.push(`${target.name}: ${baseUpdatedCount} rows updated`);
  }

  return { totalUpdated, details };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { awbNumber, dispatchDate, awbPhotoBase64, awbPhotoName, suppliers } = body;

    if (!awbNumber) {
      return NextResponse.json({ success: false, error: 'AWB Number is required' }, { status: 400 });
    }

    const apiKey = process.env.AUTH_AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
    const skycomeBaseId = 'appIJzkEQLOw87bqf'; // Skycome Base ID

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Airtable token missing in environment variables.' }, { status: 500 });
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    let publicPhotoUrl = '';
    if (awbPhotoBase64 && awbPhotoBase64.startsWith('data:image')) {
      const base64Data = awbPhotoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `skycome-awbs/${Date.now()}-${awbPhotoName || 'awb-slip.jpg'}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME || 'mysmar-erp',
        Key: fileName,
        Body: buffer,
        ContentType: 'image/jpeg',
      }));

      const r2PublicDomain = process.env.R2_PUBLIC_URL || '';
      publicPhotoUrl = `${r2PublicDomain.replace(/\/$/, '')}/${fileName}`;
    } else if (awbPhotoBase64 && awbPhotoBase64.startsWith('http')) {
      publicPhotoUrl = awbPhotoBase64;
    }

    // 1. Create Parent Record in `Skycome AWBs`
    const attachmentField = publicPhotoUrl ? [{ url: publicPhotoUrl, filename: awbPhotoName || 'awb-slip.jpg' }] : undefined;

    const parentRes = await fetch(`https://api.airtable.com/v0/${skycomeBaseId}/Skycome%20AWBs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        records: [
          {
            fields: {
              'AWB Number': awbNumber,
              'Dispatch Date': dispatchDate || new Date().toISOString().split('T')[0],
              ...(attachmentField ? { 'AWB Photo': attachmentField } : {}),
            },
          },
        ],
      }),
    });

    const parentData = await parentRes.json();
    if (!parentRes.ok) {
      throw new Error(parentData.error?.message || 'Failed to create AWB record in Airtable');
    }

    const parentRecordId = parentData.records[0].id;

    // 2. Create Child Records in `Skycome Items` with Supplier Bills (Attachment)
    if (suppliers && suppliers.length > 0) {
      const childRecordsPayload = [];

      for (const sup of suppliers) {
        let supplierBillUrl = '';
        
        if (sup.supplierBillBase64 && sup.supplierBillBase64.startsWith('data:image')) {
          const supBase64 = sup.supplierBillBase64.replace(/^data:image\/\w+;base64,/, '');
          const supBuffer = Buffer.from(supBase64, 'base64');
          const supFileName = `skycome-supplier-bills/${Date.now()}-${sup.supplierBillName || 'supplier-bill.jpg'}`;

          await s3Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME || 'mysmar-erp',
            Key: supFileName,
            Body: supBuffer,
            ContentType: 'image/jpeg',
          }));

          const r2PublicDomain = process.env.R2_PUBLIC_URL || '';
          supplierBillUrl = `${r2PublicDomain.replace(/\/$/, '')}/${supFileName}`;
        } else if (sup.supplierBillBase64 && sup.supplierBillBase64.startsWith('http')) {
          supplierBillUrl = sup.supplierBillBase64;
        }

        const billAttachment = supplierBillUrl ? [{ url: supplierBillUrl, filename: sup.supplierBillName || 'supplier-bill.jpg' }] : undefined;

        childRecordsPayload.push({
          fields: {
            'Supplier Name': sup.supplierName,
            'AWB Number': [parentRecordId],
            'Supplier Bill No.': sup.supplierBillNo,
            'Dispatch Quantity': Number(sup.dispatchQuantity) || 0,
            ...(billAttachment ? { 'Supplier Bill': billAttachment } : {}),
          },
        });
      }

      for (let i = 0; i < childRecordsPayload.length; i += 10) {
        const chunk = childRecordsPayload.slice(i, i + 10);
        const childRes = await fetch(`https://api.airtable.com/v0/${skycomeBaseId}/Skycome%20Items`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ records: chunk }),
        });

        const childData = await childRes.json();
        if (!childRes.ok) {
          throw new Error(childData.error?.message || 'Failed to create supplier items in Airtable');
        }
      }
    }

    // 3. Update BS Order Entry & FAB Order Entry rows where Supplier & `bill_no` match
    const syncResult = await updateOrderBasesWithAwb(apiKey, awbNumber, suppliers || []);

    return NextResponse.json({ 
      success: true, 
      updatedOrderRows: syncResult.totalUpdated,
      syncDetails: syncResult.details,
      message: `Skycome AWB saved! Updated ${syncResult.totalUpdated} rows (${syncResult.details.join(', ')}).` 
    });

  } catch (error: any) {
    console.error('Error saving Skycome AWB:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}