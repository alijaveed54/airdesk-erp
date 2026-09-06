"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  Truck,
  RotateCcw,
  RefreshCw,
} from "lucide-react";


type DohaRow = {
  id: string;
  orderNo: string;
  sku: string;
  supplier: string;
  qty: number;
  receivedDate: string;
  dispatchToDoha: string;
  createdDate: string;
  baseId?: string;
  tableName?: string;
};


type Summary = {
  totalItems: number;
  totalSuppliers: number;
};


const EMPTY_SUMMARY: Summary = {
  totalItems: 0,
  totalSuppliers: 0,
};


function formatDate(value:string){

  if(!value)
    return "-";


  const date = new Date(value);


  if(
    Number.isNaN(
      date.getTime()
    )
  ){
    return value;
  }


  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day:"2-digit",
      month:"short",
      year:"numeric",
    }
  ).format(date);

}



export default function DispatchFromUaeToDohaPage(){


  const [
    rows,
    setRows
  ] = useState<DohaRow[]>([]);



  const [
    summary,
    setSummary
  ] = useState<Summary>(
    EMPTY_SUMMARY
  );



  const [
    loading,
    setLoading
  ] = useState(false);


  const [
    selectedIds,
    setSelectedIds
  ] = useState<string[]>([]);



  async function loadReport(){

    setLoading(true);


    try{

      const response =
        await fetch(
          "/api/reports/dispatch-from-uae-to-doha",
          {
            cache:"no-store",
          }
        );


      const data =
        await response.json();



      if(
        !response.ok ||
        !data.success
      ){
        throw new Error(
          data.message ||
          "Report failed"
        );
      }



      const sortedRows =
        (data.rows || []).sort(
          (a:any, b:any) =>
            new Date(b.createdDate || 0).getTime() -
            new Date(a.createdDate || 0).getTime()
        );


      setRows(
        sortedRows
      );



      setSummary(
        data.summary ||
        EMPTY_SUMMARY
      );



    }catch(error){

      console.error(error);

      setRows([]);

    }
    finally{

      setLoading(false);

    }

  }



  useEffect(()=>{

    loadReport();

  },[]);
  
  async function dispatchToDoha(
    item: DohaRow,
    value:boolean
  ){

    try{

      const response =
        await fetch(
          "/api/order-items/update",
          {
            method:"PATCH",
            headers:{
              "Content-Type":"application/json",
            },
            body:JSON.stringify({
              items:[
                {
                  id:item.id,
                  dispatchToDoha:
                    value
                    ? "Dispatched"
                    : "",
                }
              ],
            }),
          }
        );


      const data =
        await response.json();



      if(
        !response.ok ||
        !data.success
      ){

        throw new Error(
          data.message ||
          "Update failed"
        );

      }


      setRows((prev)=>
        prev.map((row)=>
          row.id === item.id
          ? {
              ...row,
              dispatchToDoha:
                value
                ? "Dispatched"
                : "",
            }
          : row
        )
      );


    }catch(error){

      alert(
        error instanceof Error
        ? error.message
        : "Update failed"
      );

    }

  }




  function toggleSelect(id:string){

    setSelectedIds((prev)=>
      prev.includes(id)
      ? prev.filter((item)=>item !== id)
      : [...prev,id]
    );

  }


  function toggleSelectAll(){

    if(selectedIds.length === rows.length){

      setSelectedIds([]);

    } else {

      setSelectedIds(
        rows.map((row)=>row.id)
      );

    }

  }


  async function bulkDispatch(value:boolean){

    const selectedRows =
      rows.filter((row)=>
        selectedIds.includes(row.id)
      );


    if(selectedRows.length === 0){

      alert("Select items first");
      return;

    }


    try{

      const response =
        await fetch(
          "/api/order-items/update",
          {
            method:"PATCH",
            headers:{
              "Content-Type":"application/json",
            },
            body:JSON.stringify({
              items:selectedRows.map((item:any)=>({
                id:item.id,
                dispatchToDoha:value ? "Dispatched" : "",
                baseId:item.baseId,
                tableName:item.tableName,
              })),
            }),
          }
        );


      const data = await response.json();


      if(!response.ok || !data.success){

        throw new Error(
          data.message || "Bulk update failed"
        );

      }


      setRows((prev)=>
        prev.map((row)=>
          selectedIds.includes(row.id)
          ? {
              ...row,
              dispatchToDoha:
                value
                ? "Dispatched"
                : "",
            }
          : row
        )
      );


      setSelectedIds([]);


    }catch(error){

      alert(
        error instanceof Error
        ? error.message
        : "Bulk update failed"
      );

    }

  }



  function refreshReport(){

    loadReport();

  }



  function exportExcel(){

    if(rows.length === 0){

      alert(
        "No records available"
      );

      return;

    }


    const data =
      rows.map((row)=>({

        "Order No":
          row.orderNo,

        "Item Code":
          row.sku,

        Supplier:
          row.supplier,

        Qty:
          row.qty,

        "Received Date":
          formatDate(
            row.receivedDate
          ),

        "Dispatch To Doha":
          row.dispatchToDoha,

      }));


    console.log(
      "Export Data",
      data
    );

  }
  
  return (

    <div className="space-y-6">


      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-black text-slate-950">
            Dispatch From UAE To Doha
          </h1>


          <p className="mt-1 text-sm font-bold text-slate-500">
            Items received in UAE and pending dispatch to Doha.
          </p>

        </div>


        <button
          onClick={refreshReport}
          className="flex items-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-bold text-white"
        >

          <RefreshCw size={16}/>

          Refresh

        </button>


      </div>




      <div className="flex gap-3">

        <button
          onClick={()=>bulkDispatch(true)}
          className="rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white"
        >
          🚚 Bulk Dispatch To Doha
        </button>


        <button
          onClick={()=>bulkDispatch(false)}
          className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white"
        >
          ↩ Bulk Undo
        </button>

      </div>


      {/* Summary */}

      <div className="grid gap-4 md:grid-cols-2">


        <div className="rounded-2xl bg-white p-5 shadow">

          <p className="text-xs font-bold text-slate-500">
            Pending Items
          </p>


          <p className="text-3xl font-black">
            {summary.totalItems}
          </p>

        </div>



        <div className="rounded-2xl bg-white p-5 shadow">

          <p className="text-xs font-bold text-slate-500">
            Suppliers
          </p>


          <p className="text-3xl font-black">
            {summary.totalSuppliers}
          </p>

        </div>


      </div>





      {/* Table */}

      <div className="overflow-hidden rounded-3xl bg-white shadow">


        {loading ? (

          <div className="p-10 text-center font-bold text-slate-500">

            Loading...

          </div>


        ) : rows.length === 0 ? (

          <div className="p-10 text-center font-bold text-slate-500">

            No items pending for Doha dispatch.

          </div>


        ) : (

          <div className="overflow-x-auto">


            <table className="min-w-full text-sm">


              <thead className="bg-slate-100">

                <tr>

                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedIds.length === rows.length}
                      onChange={toggleSelectAll}
                    />
                  </th>

                  <th className="px-4 py-3 text-left">
                    Order No
                  </th>


                  <th className="px-4 py-3 text-left">
                    Item Code
                  </th>


                  <th className="px-4 py-3 text-left">
                    Supplier
                  </th>


                  <th className="px-4 py-3 text-left">
                    Qty
                  </th>


                  <th className="px-4 py-3 text-left">
                    Created Date
                  </th>


                  <th className="px-4 py-3 text-left">
                    Received Date
                  </th>


                  <th className="px-4 py-3 text-left">
                    Action
                  </th>


                </tr>


              </thead>


              
              <tbody>


                {rows.map((row)=>(


                  <tr
                    key={row.id}
                    className="border-t"
                  >

                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={()=>toggleSelect(row.id)}
                      />
                    </td>


                    <td className="px-4 py-3 font-bold">
                      {row.orderNo || "-"}
                    </td>



                    <td className="px-4 py-3">
                      {row.sku || "-"}
                    </td>



                    <td className="px-4 py-3">
                      {row.supplier || "-"}
                    </td>



                    <td className="px-4 py-3">
                      {row.qty}
                    </td>



                    <td className="px-4 py-3">
                      {formatDate(
                        row.createdDate
                      )}
                    </td>


                    <td className="px-4 py-3">
                      {formatDate(
                        row.receivedDate
                      )}
                    </td>



                    <td className="px-4 py-3">

                      {
                        row.dispatchToDoha === "Dispatched"
                        ? (

                          <button
                            onClick={() =>
                              dispatchToDoha(
                                row,
                                false
                              )
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600"
                            title="Undo Dispatch To Doha"
                          >

                            <RotateCcw size={16}/>

                          </button>

                        )
                        : (

                          <button
                            onClick={() =>
                              dispatchToDoha(
                                row,
                                true
                              )
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-600"
                            title="Dispatch To Doha"
                          >

                            <Truck size={16}/>

                          </button>

                        )
                      }


                    </td>



                  </tr>


                ))}


              </tbody>


            </table>


          </div>


        )}


      </div>


    </div>

  );

}