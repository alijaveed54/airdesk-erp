"use client";

import {
  useEffect,
  useState,
} from "react";

import * as XLSX from "xlsx";


type DelayRow = {

  id: string;

  source: string;

  supplier: string;

  billNo: string;

  billDate: string;

  daysPending: number;

  orderNo: string;

  sku: string;

  qty: number;

  dispatchStatus: string;

  receivedInUae: string;

};



type Summary = {

  totalOrders: number;

  totalLines: number;

  totalPcs: number;

  totalSuppliers: number;

};



const EMPTY_SUMMARY: Summary = {

  totalOrders: 0,

  totalLines: 0,

  totalPcs: 0,

  totalSuppliers: 0,

};



function formatDate(
  value:string
){

  if(!value)
    return "-";


  const date =
    new Date(value);


  if(
    Number.isNaN(
      date.getTime()
    )
  )
    return value;



  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day:"2-digit",
      month:"short",
      year:"numeric",
    }
  ).format(date);

}



export default function ReceivedInUaeDelayPage(){

  const [
    supplier,
    setSupplier
  ] = useState("");



  const [
    suppliers,
    setSuppliers
  ] = useState<string[]>([]);



  const [
    rows,
    setRows
  ] = useState<DelayRow[]>([]);



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



  async function loadReport(
    nextSupplier = supplier
  ){

    setLoading(true);


    try {


      const params =
        new URLSearchParams();


      if(nextSupplier){

        params.set(
          "supplier",
          nextSupplier
        );

      }



      const response =
        await fetch(
          `/api/reports/received-in-uae-delay?${params.toString()}`,
          {
            cache:
              "no-store",
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
          "Report load failed"
        );

      }



      setRows(
        data.rows || []
      );


      setSuppliers(
        data.suppliers || []
      );


      setSummary(
        data.summary ||
        EMPTY_SUMMARY
      );



    }catch(error){


      alert(
        error instanceof Error
        ? error.message
        : "Report failed"
      );


      setRows([]);

      setSummary(
        EMPTY_SUMMARY
      );


    }finally{

      setLoading(false);

    }

  }



  useEffect(()=>{

    loadReport("");

  },[]);



  async function changeSupplier(
    value:string
  ){

    setSupplier(value);

    await loadReport(value);

  }
    function exportExcel(){

    if(rows.length === 0){

      alert(
        "No records available"
      );

      return;

    }


    const exportRows =
      rows.map((row)=>({

        Source:
          row.source,

        Supplier:
          row.supplier,

        "Bill No":
          row.billNo,

        "Bill Date":
          formatDate(
            row.billDate
          ),

        "Delay Days":
          row.daysPending,

        "Order No":
          row.orderNo,

        SKU:
          row.sku,

        Qty:
          row.qty,

        "Dispatch Status":
          row.dispatchStatus,

        "Received In UAE":
          row.receivedInUae,

      }));



    const worksheet =
      XLSX.utils.json_to_sheet(
        exportRows
      );


    const workbook =
      XLSX.utils.book_new();


    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "UAE Delay"
    );


    XLSX.writeFile(
      workbook,
      "Received_In_UAE_Delay.xlsx"
    );

  }



  return (

    <div className="space-y-6">


      <div>

        <h1 className="text-3xl font-black text-slate-950">

          Received In UAE Delay

        </h1>


        <p className="mt-1 text-sm font-bold text-slate-500">

          Dispatched items which are not received in UAE after 7 days.

        </p>

      </div>



      {/* Summary */}

      <div className="grid gap-4 md:grid-cols-4">


        <div className="rounded-2xl bg-white p-5 shadow">

          <p className="text-xs font-bold text-slate-500">
            Orders
          </p>

          <p className="text-3xl font-black">
            {summary.totalOrders}
          </p>

        </div>



        <div className="rounded-2xl bg-white p-5 shadow">

          <p className="text-xs font-bold text-slate-500">
            Lines
          </p>

          <p className="text-3xl font-black">
            {summary.totalLines}
          </p>

        </div>



        <div className="rounded-2xl bg-white p-5 shadow">

          <p className="text-xs font-bold text-slate-500">
            PCS
          </p>

          <p className="text-3xl font-black">
            {summary.totalPcs}
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




      {/* Filter */}

      <div className="rounded-3xl bg-white p-5 shadow">

        <div className="flex flex-col gap-4 md:flex-row">


          <select

            value={supplier}

            onChange={(e)=>
              changeSupplier(
                e.target.value
              )
            }

            className="rounded-xl border p-3"

          >

            <option value="">
              All Suppliers
            </option>


            {suppliers.map((item)=>(

              <option
                key={item}
                value={item}
              >

                {item}

              </option>

            ))}


          </select>



          <button

            onClick={exportExcel}

            className="rounded-xl bg-black px-5 py-3 text-white font-bold"

          >

            Export Excel

          </button>


        </div>


      </div>
            {/* Table */}

      <div className="rounded-3xl bg-white shadow overflow-hidden">


        {loading ? (

          <div className="p-10 text-center font-bold text-slate-500">

            Loading report...

          </div>


        ) : rows.length === 0 ? (

          <div className="p-10 text-center font-bold text-slate-500">

            No delayed received items found.

          </div>


        ) : (


          <div className="overflow-x-auto">


            <table className="min-w-full text-sm">


              <thead className="bg-slate-100">

                <tr>

                  <th className="px-4 py-3 text-left">
                    Source
                  </th>

                  <th className="px-4 py-3 text-left">
                    Supplier
                  </th>

                  <th className="px-4 py-3 text-left">
                    Bill No
                  </th>

                  <th className="px-4 py-3 text-left">
                    Bill Date
                  </th>

                  <th className="px-4 py-3 text-left">
                    Delay Days
                  </th>

                  <th className="px-4 py-3 text-left">
                    Order No
                  </th>

                  <th className="px-4 py-3 text-left">
                    SKU
                  </th>

                  <th className="px-4 py-3 text-left">
                    Qty
                  </th>

                  <th className="px-4 py-3 text-left">
                    Dispatch
                  </th>

                  <th className="px-4 py-3 text-left">
                    UAE Receive
                  </th>


                </tr>

              </thead>



              <tbody>


                {rows.map((row)=>(


                  <tr

                    key={row.id}

                    className={

                      row.daysPending > 30

                      ? "bg-red-200"

                      : row.daysPending > 15

                      ? "bg-orange-100"

                      : "bg-white"

                    }

                  >


                    <td className="px-4 py-3 font-bold">

                      {row.source}

                    </td>


                    <td className="px-4 py-3">

                      {row.supplier || "-"}

                    </td>


                    <td className="px-4 py-3 font-bold">

                      {row.billNo}

                    </td>


                    <td className="px-4 py-3">

                      {formatDate(
                        row.billDate
                      )}

                    </td>


                    <td className="px-4 py-3 font-black text-red-700">

                      {row.daysPending} Days

                    </td>


                    <td className="px-4 py-3">

                      {row.orderNo || "-"}

                    </td>


                    <td className="px-4 py-3">

                      {row.sku || "-"}

                    </td>


                    <td className="px-4 py-3">

                      {row.qty}

                    </td>


                    <td className="px-4 py-3">

                      {row.dispatchStatus || "-"}

                    </td>


                    <td className="px-4 py-3 text-red-700 font-bold">

                      {row.receivedInUae || "No"}

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