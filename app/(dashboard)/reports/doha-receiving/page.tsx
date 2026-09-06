"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  PackageCheck,
  RotateCcw,
  RefreshCw,
} from "lucide-react";


type DohaItem = {

  id:string;

  orderNo:string;

  sku:string;

  supplier:string;

  qty:number;

  dispatchDate:string;

  dispatchToDoha:string;

  dohaReceived:string;

};



type DohaGroup = {

  date:string;

  items:DohaItem[];

};



export default function DohaReceivingPage(){


  const [
    groups,
    setGroups
  ] = useState<DohaGroup[]>([]);



  const [
    loading,
    setLoading
  ] = useState(false);



  const [
    selectedIds,
    setSelectedIds
  ] = useState<string[]>([]);



  function formatDate(value:string){

    if(!value)
      return "-";


    const date = new Date(value);


    if(isNaN(date.getTime())){

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



  async function loadReport(){

    setLoading(true);


    try{

      const res =
        await fetch(
          "/api/reports/doha-receiving",
          {
            cache:"no-store",
          }
        );


      const data =
        await res.json();



      if(data.success){

        setGroups(
          data.groups || []
        );

      }


    }catch(error){

      console.error(error);

    }
    finally{

      setLoading(false);

    }

  }



  useEffect(()=>{

    loadReport();

  },[]);
  
  async function receiveInDoha(
    item:DohaItem,
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

                  dohaReceived:
                    value
                    ? "Yes"
                    : "",

                }

              ]

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



      setGroups((prev)=>

        prev.map((group)=>({

          ...group,

          items:
            group.items.map((row)=>

              row.id === item.id

              ? {

                  ...row,

                  dohaReceived:
                    value
                    ? "Yes"
                    : "",

                }

              : row

            )

        }))

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

      ? prev.filter(
          item=>item !== id
        )

      : [
          ...prev,
          id
        ]

    );

  }




  async function bulkReceive(value:boolean){


    const items =
      groups
      .flatMap(
        group=>group.items
      )
      .filter(
        item=>
          selectedIds.includes(item.id)
      );



    if(items.length===0){

      alert(
        "Select items first"
      );

      return;

    }



    const response =
      await fetch(
        "/api/order-items/update",
        {

          method:"PATCH",

          headers:{
            "Content-Type":"application/json",
          },


          body:JSON.stringify({

            items:

              items.map(item=>({

                id:item.id,

                dohaReceived:
                  value
                  ? "Yes"
                  : "",

              }))

          })

        }

      );



    const data =
      await response.json();



    if(data.success){

      setSelectedIds([]);

      loadReport();

    }


  }
  
  return (

    <div className="space-y-6">


      <div className="flex items-center justify-between">


        <div>

          <h1 className="text-3xl font-black text-slate-950">
            Doha Receiving
          </h1>


          <p className="mt-1 text-sm font-bold text-slate-500">
            Receive items dispatched from UAE to Doha.
          </p>

        </div>



        <button

          onClick={loadReport}

          className="flex items-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-bold text-white"

        >

          <RefreshCw size={16}/>

          Refresh

        </button>


      </div>





      <div className="flex gap-3">


        <button

          onClick={()=>bulkReceive(true)}

          className="rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white"

        >

          📦 Bulk Receive In Doha

        </button>



        <button

          onClick={()=>bulkReceive(false)}

          className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white"

        >

          ↩ Bulk Undo

        </button>


      </div>






      {
        loading ? (

          <div className="rounded-2xl bg-white p-10 text-center font-bold">

            Loading...

          </div>


        ) : (


          groups.map((group)=>(


            <div

              key={group.date}

              className="space-y-3"

            >


              <h2 className="text-xl font-black">

                {formatDate(group.date)}

              </h2>



              <div className="overflow-hidden rounded-3xl bg-white shadow">


                <table className="min-w-full text-sm">


                  <thead className="bg-slate-100">


                    <tr>


                      <th className="px-4 py-3 text-left">

                        Select

                      </th>


                      <th className="px-4 py-3 text-left">

                        Order No

                      </th>


                      <th className="px-4 py-3 text-left">

                        SKU

                      </th>


                      <th className="px-4 py-3 text-left">

                        Supplier

                      </th>


                      <th className="px-4 py-3 text-left">

                        Qty

                      </th>


                      <th className="px-4 py-3 text-left">

                        Action

                      </th>


                    </tr>


                  </thead>


                  
                  <tbody>

                  {group.items.map((item)=>(


                    <tr

                      key={item.id}

                      className="border-t"

                    >


                      <td className="px-4 py-3">

                        <input

                          type="checkbox"

                          checked={
                            selectedIds.includes(
                              item.id
                            )
                          }

                          onChange={()=>
                            toggleSelect(
                              item.id
                            )
                          }

                        />

                      </td>




                      <td className="px-4 py-3 font-bold">

                        {item.orderNo || "-"}

                      </td>




                      <td className="px-4 py-3">

                        {item.sku || "-"}

                      </td>




                      <td className="px-4 py-3">

                        {item.supplier || "-"}

                      </td>




                      <td className="px-4 py-3">

                        {item.qty}

                      </td>




                      <td className="px-4 py-3">


                        {

                          item.dohaReceived === "Yes"

                          ? (


                            <button

                              onClick={()=>
                                receiveInDoha(
                                  item,
                                  false
                                )
                              }

                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600"

                              title="Undo Receive"

                            >

                              <RotateCcw size={16}/>


                            </button>


                          )


                          : (


                            <button

                              onClick={()=>
                                receiveInDoha(
                                  item,
                                  true
                                )
                              }


                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-600"

                              title="Receive In Doha"

                            >

                              <PackageCheck size={16}/>


                            </button>


                          )


                        }


                      </td>



                    </tr>


                  ))}

                  </tbody>


                </table>


              </div>


            </div>


          ))

        )

      }


    </div>

  );

}