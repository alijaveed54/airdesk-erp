"use client";

import { useEffect, useState } from "react";


type ReceivingItem = {
  id: string;
  fields: Record<string, any>;
};


type ReceivingGroup = {
  title: string;
  supplier: string;
  billNo: string;
  items: ReceivingItem[];
};



export default function UAEReceivingPage() {


  const [items, setItems] =
    useState<ReceivingItem[]>([]);


  const [selected, setSelected] =
    useState<string[]>([]);


  const [loading, setLoading] =
    useState(false);


  const [message, setMessage] =
    useState("");



  async function loadItems() {

    try {

      setLoading(true);


      const response =
        await fetch(
          "/api/orders/uae-receiving",
          {
            cache: "no-store",
          }
        );


      const data =
        await response.json();



      if(data.success){

        setItems(
          data.items || []
        );

      }


    } catch(error){

      console.error(
        "UAE receiving load failed",
        error
      );


    } finally {

      setLoading(false);

    }

  }




  function groupItems(
  list: ReceivingItem[]
): ReceivingGroup[] {


  const groups:
    Record<string, ReceivingGroup> = {};



  list.forEach((item)=>{


    const supplier =
      item.fields?.Supplier || "-";


    const billNo =
      item.fields?.bill_no || "-";


    const key =
      `${supplier}-${billNo}`;



    if(!groups[key]){


      groups[key] = {

        title:
          `${supplier} - ${billNo}`,

        supplier,

        billNo,

        items: [],

      };

    }



    groups[key].items.push(item);


  });




  return Object.values(groups)
    .map((group)=>{


      group.items.sort(
        (a,b)=>{


          const orderA =
            String(
              a.fields?.["Order No"] ||
              a.fields?.["Order Number"] ||
              ""
            );


          const orderB =
            String(
              b.fields?.["Order No"] ||
              b.fields?.["Order Number"] ||
              ""
            );


          return orderA.localeCompare(
            orderB,
            undefined,
            {
              numeric:true
            }
          );


        }
      );


      return group;


    });


}



  useEffect(()=>{

    loadItems();

  },[]);



  function toggleSelect(id:string){


    setSelected((current)=>{


      if(current.includes(id)){


        return current.filter(
          (item)=>item !== id
        );


      }



      return [
        ...current,
        id
      ];


    });


  }




  function toggleAll(){


    if(selected.length === items.length){


      setSelected([]);


    } else {


      setSelected(
        items.map(
          (item)=>item.id
        )
      );


    }


  }






  async function receiveSelected(){


    try{


      if(!selected.length){


        alert(
          "Please select items first"
        );


        return;


      }



      setLoading(true);



      const response =
        await fetch(
          "/api/orders/uae-receiving",
          {

            method:"POST",

            headers:{
              "Content-Type":
                "application/json",
            },


            body:JSON.stringify({

              action:"receive",

              recordIds:selected,


            })


          }
        );



      const data =
        await response.json();



      if(data.success){


        setMessage(
          data.message
        );


        setSelected([]);


        loadItems();


      }



    }catch(error){


      console.error(
        "Receive update failed",
        error
      );


    }finally{


      setLoading(false);


    }


  }

async function removeSelected(){


  try{


    if(!selected.length){

      alert(
        "Please select items first"
      );

      return;

    }



    setLoading(true);



    const response =
      await fetch(
        "/api/orders/uae-receiving",
        {

          method:"POST",

          headers:{
            "Content-Type":
              "application/json",
          },


          body:JSON.stringify({

            action:"removeQueue",

            recordIds:selected,

          })

        }
      );



    const data =
      await response.json();



    if(data.success){

      setMessage(
        data.message
      );


      setSelected([]);


      loadItems();

    }


  }catch(error){


    console.error(
      "Remove update failed",
      error
    );


  }finally{


    setLoading(false);


  }


}




  async function receiveSingle(
    id:string
  ){


    try{


      const response =
        await fetch(
          "/api/orders/uae-receiving",
          {

            method:"POST",

            headers:{
              "Content-Type":
                "application/json",
            },


            body:JSON.stringify({

              action:"receive",

              recordIds:[
                id
              ]

            })

          }
        );



      const data =
        await response.json();



      if(data.success){

        loadItems();

      }



    }catch(error){


      console.error(
        "Single receive failed",
        error
      );


    }


  }






  const groupedItems =
    groupItems(items);



  return (

    <div className="p-6 space-y-6">


      <div className="flex items-center justify-between">


        <div>

          <h1 className="text-2xl font-bold">
            UAE Receiving
          </h1>


          <p className="text-sm text-slate-500">
            Items available for UAE receiving
          </p>


        </div>





        <div className="flex gap-3">


          <button

            onClick={loadItems}

            disabled={loading}

            className="rounded-xl bg-slate-600 px-5 py-2 font-semibold text-white disabled:opacity-50"

          >

            Refresh

          </button>




          <button

            onClick={receiveSelected}

            disabled={loading}

            className="rounded-xl bg-emerald-600 px-5 py-2 font-semibold text-white disabled:opacity-50"

          >

            Receive Selected

          </button>

<button

  onClick={removeSelected}

  disabled={loading}

  className="rounded-xl bg-red-600 px-5 py-2 font-semibold text-white disabled:opacity-50"

>

  Remove Selected

</button>
        </div>


      </div>



      {message && (

        <div className="rounded-lg bg-green-50 p-3 text-green-700">

          {message}

        </div>

      )}






      <div className="space-y-8">


        {
          groupedItems.map(
            (group)=>(
              

              <div
                key={`${group.supplier}-${group.billNo}`}
                className="rounded-xl border overflow-hidden"
              >


                <div className="bg-slate-100 px-4 py-3 font-bold flex justify-between items-center">


  <span>
    {group.title}
  </span>



  <label className="flex items-center gap-2 text-sm font-normal">

    <input

      type="checkbox"


      checked={
        group.items.every(
          (item)=>
            selected.includes(item.id)
        )
      }


      onChange={(e)=>{


        if(e.target.checked){


          setSelected((prev)=>[

            ...new Set([

              ...prev,

              ...group.items.map(
                (item)=>item.id
              )

            ])

          ]);


        } else {


          setSelected((prev)=>

            prev.filter(
              (id)=>
                !group.items.some(
                  (item)=>
                    item.id === id
                )
            )

          );


        }


      }}


    />


    Select All

  </label>


</div>





                <div className="overflow-x-auto">


                  <table className="w-full text-sm">


                    <thead className="bg-white">


                      <tr>


                        <th className="p-3 text-left">

                          Select

                        </th>


                        <th className="p-3 text-left">

                          Images

                        </th>


                        <th className="p-3 text-left">

                          Action

                        </th>


                        <th className="p-3 text-left">

                          Order No

                        </th>


                        <th className="p-3 text-left">

                          Item Code

                        </th>


                        <th className="p-3 text-left">

                          Supplier

                        </th>


                        <th className="p-3 text-left">

                          Bill No

                        </th>


                        <th className="p-3 text-left">

                          Quantity

                        </th>


                      </tr>


                    </thead>





                    <tbody>



                    {
                      group.items.map(
                        (item)=>(


                          <tr

                            key={item.id}

                            className="border-t hover:bg-slate-50"

                          >




                            <td className="p-3">


                              <input

                                type="checkbox"

                                checked={
                                  selected.includes(item.id)
                                }


                                onChange={()=>{

                                  toggleSelect(item.id);

                                }}

                              />


                            </td>





                            <td className="p-3">


                              {
                                item.fields?.image ? (


                                  <img

                                    src={
                                      Array.isArray(
                                        item.fields.image
                                      )
                                      ?
                                      item.fields.image[0]?.url
                                      :
                                      item.fields.image
                                    }


                                    alt="Product"


                                    className="w-32 h-32 rounded-lg object-cover border"


                                  />


                                ) : (

                                  "-"

                                )

                              }


                            </td>





                            <td className="p-3">


                              <div className="flex gap-2">


<button

  onClick={()=>receiveSingle(item.id)}

  className="rounded-lg bg-emerald-600 px-3 py-1 text-white text-sm"

>

  Received

</button>



<button

  onClick={async()=>{


    const response =
      await fetch(
        "/api/orders/uae-receiving",
        {

          method:"POST",

          headers:{
            "Content-Type":
              "application/json",
          },


          body:JSON.stringify({

            action:"removeQueue",

            recordIds:[
              item.id
            ]

          })


        }
      );



    const data =
      await response.json();



    if(data.success){

      loadItems();

    }


  }}


  className="rounded-lg bg-red-600 px-3 py-1 text-white text-sm"

>

  Remove

</button>


</div>


                            </td>



                            <td className="p-3">

                              {
                                item.fields?.["Order No"] ||
                                item.fields?.["Order Number"] ||
                                "-"
                              }

                            </td>





                            <td className="p-3">

                              {
                                item.fields?.["Item Code"] ||
                                "-"
                              }

                            </td>





                            <td className="p-3">

                              {
                                item.fields?.Supplier ||
                                "-"
                              }

                            </td>





                            <td className="p-3">

                              {
                                item.fields?.bill_no ||
                                "-"
                              }

                            </td>





                            <td className="p-3">

                              {
                                item.fields?.quantity ||
                                item.fields?.["Product/Service Quantity"] ||
                                "-"
                              }

                            </td>



                          </tr>


                        )

                      )

                    }



                    </tbody>


                  </table>


                </div>


              </div>


            )

          )

        }


      </div>





      {
        !items.length && !loading && (


          <div className="rounded-xl border p-8 text-center text-slate-500">

            No items waiting for receiving

          </div>


        )
      }





      {
        loading && (

          <p className="text-sm text-slate-500">

            Loading...

          </p>

        )
      }



    </div>

  );


} 