"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudUpload, Copy, FolderOpen, ImageIcon, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react";

type GalleryImage = { key:string; url:string; sku:string; market:string; currency:string; size:number; lastModified:string };
type GalleryGroup = { sku:string; market:string; currency:string; count:number; totalSize:number; coverUrl:string; images:GalleryImage[] };

function formatBytes(bytes:number){ if(!bytes) return "0 B"; const units=["B","KB","MB","GB"]; const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1); return `${(bytes/1024**i).toFixed(i===0?0:1)} ${units[i]}`; }

export default function ImagesPage(){
  const inputRef=useRef<HTMLInputElement>(null);
  const [groups,setGroups]=useState<GalleryGroup[]>([]);
  const [search,setSearch]=useState("");
  const [market,setMarket]=useState("ALL");
  const [loading,setLoading]=useState(true);
  const [uploading,setUploading]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [message,setMessage]=useState("");
  const [selectedGroup,setSelectedGroup]=useState<GalleryGroup|null>(null);

  const loadGallery=useCallback(async()=>{ setLoading(true); setMessage(""); try{ const r=await fetch("/api/images",{cache:"no-store"}); const d=await r.json(); if(!r.ok||!d.success) throw new Error(d.message||"Gallery load failed"); setGroups(d.groups||[]);}catch(e){setGroups([]);setMessage(e instanceof Error?e.message:"Gallery load failed");}finally{setLoading(false);}},[]);
  useEffect(()=>{loadGallery();},[loadGallery]);

  async function uploadFiles(files:File[]){ const images=files.filter(f=>f.type.startsWith("image/")); if(!images.length){setMessage("Please select image files.");return;} setUploading(true); setMessage(""); try{ let uploaded=0; let failed=0; for(let i=0;i<images.length;i+=100){ const fd=new FormData(); images.slice(i,i+100).forEach(f=>fd.append("files",f)); const r=await fetch("/api/upload/image",{method:"POST",body:fd}); const d=await r.json(); uploaded+=Number(d.uploadedCount||0); failed+=Number(d.failedCount||0); if(!r.ok && !d.uploadedCount) throw new Error(d.message||"Upload failed"); } setMessage(`${uploaded} image(s) uploaded${failed?`, ${failed} failed`:""}.`); await loadGallery(); }catch(e){setMessage(e instanceof Error?e.message:"Upload failed");}finally{setUploading(false); if(inputRef.current) inputRef.current.value="";}}

  async function deleteRequest(payload:Record<string,string>){ const r=await fetch("/api/images",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const d=await r.json(); if(!r.ok||!d.success) throw new Error(d.message||"Delete failed"); return d; }
  async function deleteImage(image:GalleryImage){ if(!confirm(`Delete this image?\n\n${image.key}`)) return; try{await deleteRequest({key:image.key});setSelectedGroup(null);setMessage("Image deleted successfully.");await loadGallery();}catch(e){setMessage(e instanceof Error?e.message:"Delete failed");}}
  async function deleteGroup(group:GalleryGroup){ if(!confirm(`Delete all ${group.count} image(s) for ${group.sku} / ${group.market}?`)) return; try{const d=await deleteRequest({prefix:`products/${group.sku}/${group.market.replace(/\s+/g,"-")}/`});setSelectedGroup(null);setMessage(`${d.deletedCount||0} image(s) deleted.`);await loadGallery();}catch(e){setMessage(e instanceof Error?e.message:"Delete failed");}}

  const markets=useMemo(()=>Array.from(new Set(groups.map(g=>g.market))).sort(),[groups]);
  const visibleGroups=useMemo(()=>{const q=search.trim().toLowerCase();return groups.filter(g=>(!q||g.sku.toLowerCase().includes(q)||g.market.toLowerCase().includes(q))&&(market==="ALL"||g.market===market));},[groups,market,search]);
  const totals=useMemo(()=>({skus:new Set(groups.map(g=>g.sku)).size,folders:groups.length,images:groups.reduce((s,g)=>s+g.count,0),size:groups.reduce((s,g)=>s+g.totalSize,0)}),[groups]);

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-3xl font-black text-slate-950">Image Management System</h1><p className="mt-1 text-sm font-bold text-slate-500">Upload product images and organize them automatically by SKU and market.</p></div><button onClick={loadGallery} disabled={loading||uploading} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-5 text-sm font-black text-blue-700 disabled:opacity-50"><RefreshCw size={17} className={loading?"animate-spin":""}/>Refresh</button></div>

    <div onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);uploadFiles(Array.from(e.dataTransfer.files))}} className={`rounded-3xl border-2 border-dashed p-8 text-center transition ${dragging?"border-blue-500 bg-blue-50":"border-slate-300 bg-white"}`}>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={e=>uploadFiles(Array.from(e.target.files||[]))}/>
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-100 to-blue-100 text-blue-700">{uploading?<Loader2 size={30} className="animate-spin"/>:<CloudUpload size={30}/>}</div>
      <h2 className="mt-4 text-xl font-black text-slate-950">{uploading?"Uploading images...":"Drop product images here"}</h2><p className="mt-2 text-sm font-bold text-slate-500">Filename example: MAF9439 AED (02).jpg</p>
      <button onClick={()=>inputRef.current?.click()} disabled={uploading} className="mt-5 h-11 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 px-6 font-black text-white disabled:opacity-50">Browse Images</button>
    </div>

    {message&&<div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-black text-blue-800">{message}</div>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["SKU Count",totals.skus],["Market Folders",totals.folders],["Total Images",totals.images],["Storage Used",formatBytes(totals.size)]].map(([t,v])=><div key={String(t)} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{t}</p><p className="mt-2 text-3xl font-black text-slate-950">{v}</p></div>)}</div>

    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-4 lg:grid-cols-[1fr_260px]"><div className="relative"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search SKU or market" className="h-11 w-full rounded-xl border border-slate-200 pl-11 pr-4 font-bold outline-none focus:border-blue-500"/></div><select value={market} onChange={e=>setMarket(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-4 font-bold"><option value="ALL">All Markets</option>{markets.map(m=><option key={m} value={m}>{m}</option>)}</select></div></div>

    {loading?<div className="rounded-3xl border bg-white p-12 text-center font-black text-blue-600">Loading gallery...</div>:visibleGroups.length===0?<div className="rounded-3xl border bg-white p-12 text-center"><ImageIcon size={36} className="mx-auto text-slate-300"/><p className="mt-3 font-black text-slate-500">No product images found.</p></div>:<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visibleGroups.map(g=><div key={`${g.sku}-${g.market}`} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><button onClick={()=>setSelectedGroup(g)} className="block h-64 w-full bg-slate-100">{g.coverUrl?<img src={g.coverUrl} alt={g.sku} className="h-full w-full object-contain" loading="lazy"/>:<ImageIcon size={36} className="mx-auto text-slate-300"/>}</button><div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">{g.sku}</h2><p className="text-sm font-bold text-blue-700">{g.market} · {g.currency}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{g.count} Images</span></div><p className="mt-3 text-xs font-bold text-slate-500">{formatBytes(g.totalSize)}</p><div className="mt-4 flex gap-2"><button onClick={()=>setSelectedGroup(g)} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-black text-white"><FolderOpen size={16}/>Open</button><button onClick={()=>deleteGroup(g)} className="grid h-10 w-10 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-700"><Trash2 size={16}/></button></div></div></div>)}</div>}

    {selectedGroup&&<div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm"><div className="mx-auto max-w-6xl rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b pb-4"><div><h2 className="text-2xl font-black text-slate-950">{selectedGroup.sku}</h2><p className="font-bold text-blue-700">{selectedGroup.market} · {selectedGroup.count} images</p></div><button onClick={()=>setSelectedGroup(null)} className="grid h-10 w-10 place-items-center rounded-xl border"><X size={18}/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{selectedGroup.images.map(img=><div key={img.key} className="overflow-hidden rounded-2xl border border-slate-200"><div className="h-64 bg-slate-100"><img src={img.url} alt={selectedGroup.sku} className="h-full w-full object-contain"/></div><div className="flex items-center gap-2 p-3"><button onClick={async()=>{await navigator.clipboard.writeText(img.url);setMessage("Image URL copied.")}} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border text-xs font-black"><Copy size={14}/>Copy URL</button><button onClick={()=>deleteImage(img)} className="grid h-9 w-9 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-700"><Trash2 size={14}/></button></div></div>)}</div></div></div>}
  </div>;
}
