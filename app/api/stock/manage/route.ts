// Updated manage API - image level id support
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;
const INDEX_KEY = "Stock/stock-index.json";

async function readIndex() {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
  const text = await result.Body?.transformToString();
  return text ? JSON.parse(text) : [];
}

async function saveIndex(items:any[]) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: INDEX_KEY,
    Body: JSON.stringify(items, null, 2),
    ContentType: "application/json",
  }));
}

export async function GET(){
  const products = await readIndex();

  const items = products.flatMap((item:any)=>(item.images || []).map((url:string)=>(
    {
      id: `${item.id}__${url}`,
      key: url.split(".com/")[1] || "",
      url,
      sku:item.sku,
      price:item.price || "",
      size:item.size || "",
      fabric:item.fabric || ""
    }
  )));

  return NextResponse.json({items});
}

export async function PATCH(req:Request){
  const {id, price, size, fabric}=await req.json();
  const items=await readIndex();

  const productId=id.split("__")[0];
  const item=items.find((x:any)=>x.id===productId);

  if(!item) return NextResponse.json({success:false},{status:404});

  if(price!==undefined) item.price=Number(price);
  if(size!==undefined) item.size=size;
  if(fabric!==undefined) item.fabric=fabric;

  await saveIndex(items);
  return NextResponse.json({success:true});
}
