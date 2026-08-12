"use client";

import { useEffect, useState } from "react";


type Item = {

  id:string;

  image:any[];

  itemCode:string;

  supplier:string;

  quantity:string;

  billNo:string;

  receivedDate:string;

};


type Orders = {

  [key:string]: Item[];

};




export default function ProcessingPage(){


  const [orders,setOrders] =
    useState<Orders>({});


  const [loading,setLoading] =
    useState(true);




  async function loadOrders(){


    try{


      setLoading(true);


      const res =
        await fetch(
          "/api/orders/processing",
          {
            cache:"no-store"
          }
        );


      const data =
        await res.json();


      if(data.success){

        setOrders(
          data.orders || {}
        );

      }


    }
    catch(error){

      console.error(error);

    }
    finally{

      setLoading(false);

    }


  }





  useEffect(()=>{

    void loadOrders();

  },[]);







  if(loading){

    return (

      <div className="p-6 font-bold">

        Loading Processing Orders...

      </div>

    );

  }






  const orderList =
    Object.entries(orders);






  return (

    <div className="space-y-6 p-6">


      <div className="flex items-center justify-between">

  <h1 className="text-3xl font-black">
    Processing Orders
  </h1>


  <button
    onClick={loadOrders}
    className="rounded-lg border px-4 py-2 font-bold hover:bg-gray-100"
  >
    Refresh
  </button>

</div>





      {
        orderList.length===0 && (

          <div className="rounded-xl border p-6 font-bold">

            No Processing Orders Found

          </div>

        )
      }







      {
        orderList.map(
          ([orderNo,items])=>(


            <section

              key={orderNo}

              className="rounded-2xl border bg-white p-5 shadow-sm"

            >


              <h2 className="mb-4 text-xl font-black">

                {orderNo}

              </h2>





              <div className="overflow-x-auto">


                <table className="w-full text-sm">


                  <thead className="bg-slate-100">


                    <tr>


                      <th className="p-3 text-left">
                        Image
                      </th>


                      <th className="p-3 text-left">
                        Item Code
                      </th>


                      <th className="p-3 text-left">
                        Supplier
                      </th>


                      <th className="p-3 text-left">
                        Quantity
                      </th>


                      <th className="p-3 text-left">
                        Bill No
                      </th>


                      <th className="p-3 text-left">
                        Received In UAE Date
                      </th>


                    </tr>


                  </thead>





                  <tbody>


                  {
                    items.map(
                      (item)=>(


                        <tr

                          key={item.id}

                          className="border-t"

                        >



                          <td className="p-3">


                            {
                              item.image?.[0]?.url ? (

                                <img

                                  src={
                                    item.image[0].url
                                  }

                                  className="h-16 w-16 rounded object-cover"

                                />

                              ) : (

                                "-"

                              )

                            }


                          </td>





                          <td className="p-3 font-bold">

                            {item.itemCode || "-"}

                          </td>





                          <td className="p-3">

                            {item.supplier || "-"}

                          </td>





                          <td className="p-3">

                            {item.quantity || "-"}

                          </td>





                          <td className="p-3">

                            {item.billNo || "-"}

                          </td>





                          <td className="p-3">

                            {
                              item.receivedDate || "-"
                            }

                          </td>





                        </tr>


                      )
                    )
                  }


                  </tbody>



                </table>


              </div>



            </section>


          )

        )
      }





    </div>

  );


}