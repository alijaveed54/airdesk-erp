import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentAirtableBase, handleApiError } from "@/lib/airtable";

export async function GET() {
  try {
    const session=await getSession();
    const airtable=await getCurrentAirtableBase();

    if(!airtable.canView){
      return NextResponse.json({success:false,message:"Permission denied"},{status:403});
    }

    if(session?.role==="Supplier"){
      return NextResponse.json({
        success:true,
        supplierLocked:true,
        supplier:airtable.supplierCode||"",
        suppliers: airtable.supplierCode ? [airtable.supplierCode] : [],
      });
    }

    const BS_BASE_ID="app2hjpuQoeEL1Rn2";

    const bsPermission=session?.permissions?.find(
      (p:any)=>p.baseId===BS_BASE_ID
    );

    const metaToken=
      process.env.AIRTABLE_TOKEN||
      process.env.AUTH_AIRTABLE_TOKEN||
      bsPermission?.airtableToken||
      airtable.token;

    const res=await fetch(`https://api.airtable.com/v0/meta/bases/${BS_BASE_ID}/tables`,{
      headers:{Authorization:`Bearer ${metaToken}`},
      cache:"no-store",
    });

    const data=await res.json();
    if(!res.ok){
      return NextResponse.json({success:false,message:"Options fetch failed",error:data},{status:res.status});
    }

    const table=data.tables.find((t:any)=>t.name==="BS Order Entry");
    const field=table?.fields.find((f:any)=>f.name==="Supplier");

    return NextResponse.json({
      success:true,
      supplierLocked:false,
      suppliers:field?.options?.choices?.map((c:any)=>c.name)||[],
    });
  }catch(e){
    return handleApiError(e,"Supplier options failed");
  }
}
