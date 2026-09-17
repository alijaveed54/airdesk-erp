"use client";

import {useEffect,useState} from "react";

export default function StockManagePage(){
 const [items,setItems]=useState<any[]>([]);
 const [values,setValues]=useState<any>({});

 async function loadItems(){
  const res=await fetch('/api/stock/manage');
  const data=await res.json();
  setItems(data.items||[]);
  const v:any={};
  (data.items||[]).forEach((i:any)=>{
   v[i.id]={price:i.price,size:i.size,fabric:i.fabric};
  });
  setValues(v);
 }

 useEffect(()=>{loadItems()},[]);

 function change(id:string,key:string,value:string){
  setValues((p:any)=>({...p,[id]:{...p[id],[key]:value}}));
 }

 async function save(item:any,key:string){
  await fetch('/api/stock/manage',{
   method:'PATCH',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:item.id,[key]:values[item.id][key]})
  });
  loadItems();
 }

 return <main className="p-6">
 {items.map(item=><div key={item.id} className="border p-4 mb-3">
  <img src={item.url} className="w-32 h-32 object-cover"/>
  <div>{item.sku}</div>
  {['price','size','fabric'].map(k=><div key={k}>
   <input className="border px-2 w-48" value={values[item.id]?.[k]||''} onChange={e=>change(item.id,k,e.target.value)}/>
   <button onClick={()=>save(item,k)}>Save</button>
  </div>)}
 </div>)}
 </main>
}
