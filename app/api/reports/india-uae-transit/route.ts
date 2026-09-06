import { NextResponse } from "next/server";
import { airtableHeaders, airtableUrl, getCurrentAirtableBase, handleApiError } from "@/lib/airtable";

const SOURCES = [
  { baseId: "app2hjpuQoeEL1Rn2", tableName: "BS Order Entry", sourceName: "BS",
    fields: { orderNo:"Order Number", itemCode:"Item Code", quantity:"quantity", supplier:"Supplier", billNo:"bill_no", receivedInUae:"Received In UAE", receivedInWh1:"received_in_wh_1", orderStatus:"Order Status", image:"image" } },
  { baseId: "appiz6tozkQO2TQXt", tableName: "FAB Order Entry", sourceName: "FAB Non-Stock",
    fields: { orderNo:"Order Number", itemCode:"Item Code", quantity:"quantity", supplier:"Supplier", billNo:"bill_no", receivedInUae:"Received In UAE", receivedInWh1:"received_in_wh_1", orderStatus:"Order_status", image:"image" } },
];

const first = (v: unknown) => Array.isArray(v) ? v[0] ?? "" : v ?? "";
const text = (v: unknown) => String(first(v)).trim();
const yes = (v: unknown) =>
  ["yes", "true", "1", "received"].includes(text(v).toLowerCase());

function normalizeStatus(v: unknown): string {
  return text(v).toLowerCase().replace(/\\s+/g, " ");
}

function isAllowedStatus(v: unknown): boolean {
  const status = normalizeStatus(v);

  return (
    status === "" ||
    status === "order received" ||
    status === "processing"
  );
}

function parseBillDate(v: string) {
  const d = v.replace(/\D/g,"");
  if (!/^\d{8}$/.test(d)) return null;
  const day=+d.slice(0,2), month=+d.slice(2,4), year=+d.slice(4);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date : null;
}
function daysSince(date: Date) {
  const now=new Date();
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  return Math.floor((today-date.getTime())/86400000);
}
function image(v: unknown) {
  if (!v) return "";
  if (typeof v==="string") return v.trim();
  const x=Array.isArray(v)?v[0]:v;
  if (x && typeof x==="object") {
    const o=x as Record<string,unknown>;
    return text(o.url)||text(o.src);
  }
  return "";
}

async function fetchRows(token:string, source:typeof SOURCES[number]) {
  const f=source.fields, base=new URLSearchParams();
  base.set("pageSize","100");
  [f.orderNo,f.itemCode,f.quantity,f.supplier,f.billNo,f.receivedInUae,f.receivedInWh1,f.orderStatus,f.image]
    .filter(Boolean).forEach(x=>base.append("fields[]",x));
  const records:any[]=[]; let offset="";
  do {
    const params=new URLSearchParams(base); if(offset) params.set("offset",offset);
    const res=await fetch(airtableUrl(source.baseId,source.tableName,params),{headers:airtableHeaders(token),cache:"no-store"});
    const data=await res.json();
    if(!res.ok) throw new Error(data?.error?.message || `Unable to load ${source.sourceName}`);
    records.push(...(data.records||[])); offset=data.offset||"";
  } while(offset);

  return records.map(r=>{
    const flds=r.fields||{}, billNo=text(flds[f.billNo]), dispatch=parseBillDate(billNo);
    if(!dispatch) return null;
    return {
      id:`${source.baseId}-${r.id}`, source:source.sourceName, supplier:text(flds[f.supplier]),
      orderNo:text(flds[f.orderNo]), sku:text(flds[f.itemCode]), qty:Number(first(flds[f.quantity])||0),
      billNo, dispatchDate:dispatch.toISOString(), daysInTransit:daysSince(dispatch),
      receivedInWh1:text(flds[f.receivedInWh1]), receivedInUae:text(flds[f.receivedInUae]),
      orderStatus:text(flds[f.orderStatus]),
      image:image(flds[f.image]),
    };
  }).filter((r):r is NonNullable<typeof r> =>
    Boolean(r && r.supplier && r.orderNo && isAllowedStatus(r.orderStatus) && r.daysInTransit>=7 && yes(r.receivedInWh1) && !yes(r.receivedInUae))
  );
}

export async function GET(request:Request) {
  try {
    const airtable=await getCurrentAirtableBase();
    if(!airtable.canReports) return NextResponse.json({success:false,message:"You do not have permission to view reports"},{status:403});
    const supplier=new URL(request.url).searchParams.get("supplier")?.trim()||"";
    const rows=(await Promise.all(SOURCES.map(s=>fetchRows(airtable.token,s)))).flat();
    rows.sort((a,b)=>new Date(a.dispatchDate).getTime()-new Date(b.dispatchDate).getTime());
    const suppliers=Array.from(new Set(rows.map(r=>r.supplier))).sort((a,b)=>a.localeCompare(b));
    const filtered=supplier?rows.filter(r=>r.supplier.toLowerCase()===supplier.toLowerCase()):rows;
    return NextResponse.json({success:true,suppliers,rows:filtered,summary:{
      totalOrders:new Set(filtered.map(r=>r.orderNo)).size,totalLines:filtered.length,
      totalPcs:filtered.reduce((s,r)=>s+r.qty,0),totalSuppliers:new Set(filtered.map(r=>r.supplier)).size
    }});
  } catch(e) { return handleApiError(e,"India to UAE transit delay report failed"); }
}
