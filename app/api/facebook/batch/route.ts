import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getSession } from "@/lib/auth";

import {
  shuffleFacebookImagesForPage,
} from "@/lib/facebook-image-shuffle";

import {
  FacebookBatchJob,
  FacebookBatchManifest,
  FacebookPageConfig,
  getBatch,
  getBatchJobs,
  listBatches,
  loadFacebookPage,
  refreshBatchSummary,
  saveBatch,
  saveBatchJob,
} from "@/lib/facebook-batch";

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (
    item: T,
    index: number
  ) => Promise<R>
) {
  if (!items.length) {
    return [] as R[];
  }

  const results =
    new Array<R>(items.length);

  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] =
        await worker(
          items[index],
          index
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          limit,
          items.length
        ),
      },
      () => runWorker()
    )
  );

  return results;
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


const MAX_GROUPS = 30;
const MAX_POSTS = 100;
const MAX_PAGES_PER_GROUP = 20;
const MAX_TOTAL_JOBS = 500;


const MAX_IMAGES_PER_POST = Math.min(
  Math.max(
    Number(
      process.env.FACEBOOK_BATCH_MAX_IMAGES || 40
    ) || 40,
    1
  ),
  80
);


type SessionLike = {
  role?: string;
  superAdmin?: boolean;
  fullName?: string;
  username?: string;
  email?: string;
};


type CreatePostInput = {
  id?: unknown;
  message?: unknown;
  pageMessages?: unknown;
  imageUrls?: unknown;
  imageNames?: unknown;
  videoUrl?: unknown;
  videoName?: unknown;
  videoPosition?: unknown;
};


type CreateGroupInput = {
  id?: unknown;
  pageRecordIds?: unknown;
  intervalMinutes?: unknown;
  autoShuffleImages?: unknown;
  startAt?: unknown;
  posts?: unknown;
};


function jsonError(
  message: string,
  status = 400
) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    {
      status,
    }
  );
}


function cleanString(
  value: unknown,
  maxLength = 10000
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(0, maxLength);
}


function uniqueStrings(
  value: unknown,
  limit: number
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) =>
          cleanString(item,1000)
        )
        .filter(Boolean)
    )
  ).slice(0,limit);
}


function cleanUrls(
  value: unknown
) {
  return uniqueStrings(
    value,
    MAX_IMAGES_PER_POST
  ).filter((url) =>
    /^https:\/\//i.test(url)
  );
}


function cleanFileNames(
  value: unknown
) {
  return uniqueStrings(
    value,
    MAX_IMAGES_PER_POST
  );
}


function publicBatch(
  batch: FacebookBatchManifest
) {
  return {
    ...batch,
    progressPercent:
      batch.totalJobs > 0
        ? Math.round(
            (
              (
                batch.completedJobs +
                batch.failedJobs +
                batch.cancelledJobs
              )
              /
              batch.totalJobs
            )
            *
            100
          )
        : 0,
  };
}


function isAllowedRole(
  session: SessionLike
) {
  const role =
    cleanString(
      session.role,
      50
    ).toLowerCase();

  return (
    role === "admin" ||
    role === "manager" ||
    role === "employee" ||
    role === "staff" ||
    Boolean(session.superAdmin)
  );
}


async function requireFacebookUser() {

  const session =
    await getSession() as
      SessionLike | null;


  if (!session) {
    throw {
      status:401,
      message:"Not authenticated",
    };
  }


  if (!isAllowedRole(session)) {
    throw {
      status:403,
      message:"Facebook Batch access denied",
    };
  }


  return session;
}


export async function GET(
  request: NextRequest
) {

  try {

    await requireFacebookUser();


    const batchId =
      cleanString(
        request.nextUrl
          .searchParams
          .get("batchId"),
        100
      );


    if (batchId) {

      const refreshed =
        await refreshBatchSummary(
          batchId
        );


      return NextResponse.json({
        success:true,
        batch:
          publicBatch(
            refreshed.batch
          ),
        jobs:
          refreshed.jobs,
      });
    }


    const days =
      Number(
        request.nextUrl
          .searchParams
          .get("days")
      ) || 2;


    const batches =
      await listBatches();


    const cutoff =
      Date.now()
      -
      Math.min(days,365)
      *
      24 *
      60 *
      60 *
      1000;


    return NextResponse.json({

      success:true,

      batches:
        batches
          .filter((batch)=>{

            return (
              new Date(
                batch.createdAt
              ).getTime()
              >= cutoff
            );

          })
          .map(publicBatch),

      workerConfigured:
        Boolean(
          process.env
          .FACEBOOK_BATCH_WORKER_SECRET
        ),

    });


  } catch(error) {

    return jsonError(
      error instanceof Error
        ? error.message
        : "Facebook batch load failed"
    );

  }

}
export async function POST(
  request: NextRequest
) {

  let batchId = "";

  try {

    const session =
      await requireFacebookUser();


    const body =
      await request.json();


    batchId =
      cleanString(
        body.batchId,
        100
      )
      ||
      crypto.randomUUID();


    const existing =
      await getBatch(
        batchId
      );


    if (existing) {
      return jsonError(
        "Is Batch ID ka record already mojood hai.",
        409
      );
    }


    const batchName =
      cleanString(
        body.batchName,
        200
      )
      ||
      `Facebook Batch ${new Date().toLocaleString("en-PK")}`;


    const groups =
      Array.isArray(body.groups)
        ? body.groups.slice(
            0,
            MAX_GROUPS
          )
        : [];


    if (
      groups.length === 0
    ) {
      return jsonError(
        "Kam az kam ek post group required hai."
      );
    }


    const now =
      new Date()
        .toISOString();


    const manifest:
      FacebookBatchManifest =
    {
      id: batchId,
      name: batchName,
      status: "creating",
      createdAt: now,
      createdBy:
        cleanString(
          session.fullName ||
          session.username ||
          session.email ||
          "User",
          200
        ),

      updatedAt: now,

      groupCount:
        groups.length,

      postCount:0,

      totalJobs:0,

      queuedJobs:0,

      processingJobs:0,

      completedJobs:0,

      failedJobs:0,

      cancelledJobs:0,

      totalImages:0,

      totalVideos:0,
    };


    await saveBatch(
      manifest
    );


    const jobs:
      FacebookBatchJob[] = [];


    let postCount = 0;
    let totalImages = 0;
    let totalVideos = 0;


    for (
      let groupIndex = 0;
      groupIndex < groups.length;
      groupIndex++
    ) {

      const group =
        groups[groupIndex];


      const pageRecordIds =
        uniqueStrings(
          group.pageRecordIds,
          MAX_PAGES_PER_GROUP
        );


      const posts =
        Array.isArray(group.posts)
          ? group.posts.slice(
              0,
              MAX_POSTS
            )
          : [];


      for (
        let postIndex = 0;
        postIndex < posts.length;
        postIndex++
      ) {

        const post =
          posts[postIndex];


        const imageUrls =
          cleanUrls(
            post.imageUrls
          );


        const imageNames =
          cleanFileNames(
            post.imageNames
          );


        const videoUrl =
          cleanString(
            post.videoUrl,
            2000
          );


        totalImages +=
          imageUrls.length;


        if(videoUrl){
          totalVideos++;
        }


        postCount++;


        for(
          const pageRecordId
          of pageRecordIds
        ){

          const page =
            await loadFacebookPage(
              pageRecordId
            );


          if(!page){
            continue;
          }


          jobs.push({

            id:
              crypto.randomUUID(),

            batchId,

            groupId:
              group.id ||
              crypto.randomUUID(),

            postId:
              post.id ||
              crypto.randomUUID(),

            groupNumber:
              groupIndex + 1,

            postNumber:
              postIndex + 1,

            pageRecordId,

            pageName:
              page.pageName,

            pageId:
              page.pageId,

            message:
              cleanString(
                post.message,
                50000
              ),


            imageUrls,

            imageNames,


            videoUrl:
              videoUrl ||
              undefined,


            status:
              "queued",


            priority:0,

            notBefore:
              now,


            attempts:0,

            maxAttempts:3,


            createdAt:now,

            updatedAt:now,

          });

        }

      }

    }


    await mapWithConcurrency(
      jobs,
      8,
      async(job)=>
        saveBatchJob(job)
    );


    const queuedBatch:
      FacebookBatchManifest =
    {

      ...manifest,

      status:
        "queued",

      postCount,

      totalJobs:
        jobs.length,

      queuedJobs:
        jobs.length,

      totalImages,

      totalVideos,

      updatedAt:now,

    };


    await saveBatch(
      queuedBatch
    );


    return NextResponse.json({

      success:true,

      message:
        `${postCount} posts aur ${jobs.length} jobs queue ho gayin.`,

      batch:
        publicBatch(
          queuedBatch
        ),

    });


  } catch(error){


    if(batchId){

      try{

        const batch =
          await getBatch(
            batchId
          );


        if(batch){

          await saveBatch({

            ...batch,

            status:"failed",

            lastError:
              error instanceof Error
                ? error.message
                : "Batch create failed",

            updatedAt:
              new Date()
              .toISOString(),

          });

        }

      }catch{}

    }


    return jsonError(

      error instanceof Error
        ? error.message
        : "Facebook batch create nahi ho saka."

    );

  }

}
export async function PATCH(
  request: NextRequest
) {

  try {

    await requireFacebookUser();


    const body =
      await request.json();


    const batchId =
      cleanString(
        body.batchId,
        100
      );


    const action =
      cleanString(
        body.action,
        50
      ).toLowerCase();


    if (!batchId) {
      return jsonError(
        "Batch ID required hai."
      );
    }


    const batch =
      await getBatch(
        batchId
      );


    if (!batch) {
      return jsonError(
        "Facebook batch nahi mila.",
        404
      );
    }


    const now =
      new Date()
      .toISOString();


    let actionMessage =
      "Batch update ho gaya.";


    if (
      action === "pause"
    ) {

      await saveBatch({

        ...batch,

        status:
          "paused",

        updatedAt:
          now,

      });


      actionMessage =
        "Batch pause ho gaya.";

    }


    else if (
      action === "resume"
    ) {


      await saveBatch({

        ...batch,

        status:
          "queued",

        completedAt:
          undefined,

        updatedAt:
          now,

      });


      actionMessage =
        "Batch resume ho gaya.";

    }


    else if (
      action === "process_now"
    ) {


      const jobs =
        await getBatchJobs(
          batchId
        );


      const runnableJobs =
        jobs.filter(
          (job)=>
            job.status === "queued" ||
            job.status === "retrying"
        );


      if(
        runnableJobs.length === 0
      ){

        return jsonError(
          "Is batch mein koi queued job nahi hai.",
          409
        );

      }


      await mapWithConcurrency(

        runnableJobs,

        8,

        async(job,index)=>

          saveBatchJob({

            ...job,

            status:
              "queued",

            priority:
              1000,

            notBefore:
              new Date(
                Date.now()+index
              ).toISOString(),

            startedAt:
              undefined,

            completedAt:
              undefined,

            updatedAt:
              now,

          })

      );


      await saveBatch({

        ...batch,

        status:
          "queued",

        completedAt:
          undefined,

        updatedAt:
          now,

      });


      actionMessage =
        `${runnableJobs.length} jobs processing ke liye ready hain.`;

    }


    else if (
      action === "cancel"
    ) {


      const jobs =
        await getBatchJobs(
          batchId
        );


      const pendingJobs =
        jobs.filter(
          (job)=>
            job.status === "queued" ||
            job.status === "retrying"
        );


      await mapWithConcurrency(

        pendingJobs,

        8,

        async(job)=>

          saveBatchJob({

            ...job,

            status:
              "cancelled",

            completedAt:
              now,

            updatedAt:
              now,

          })

      );


      await saveBatch({

        ...batch,

        status:
          "cancelled",

        completedAt:
          now,

        updatedAt:
          now,

      });


      actionMessage =
        `${pendingJobs.length} jobs cancel ho gayi.`;

    }
    
    else if (
      action === "reset_stuck"
    ) {

      const jobs =
        await getBatchJobs(
          batchId
        );


      const stuckJobs =
        jobs.filter(
          (job)=>{

            if(
              job.status !== "processing"
            ){
              return false;
            }


            if(
              !job.startedAt
            ){
              return true;
            }


            return (
              Date.now()
              -
              new Date(
                job.startedAt
              ).getTime()
              >
              30 *
              60 *
              1000
            );

          }
        );


      if(
        stuckJobs.length === 0
      ){

        return jsonError(
          "Koi stuck processing job nahi mili.",
          409
        );

      }


      await mapWithConcurrency(

        stuckJobs,

        8,

        async(job)=>

          saveBatchJob({

            ...job,

            status:
              "queued",

            notBefore:
              now,

            startedAt:
              undefined,

            completedAt:
              undefined,

            lastError:
              "Manually reset after stuck processing timeout.",

            updatedAt:
              now,

          })

      );


      await saveBatch({

        ...batch,

        status:
          "queued",

        completedAt:
          undefined,

        updatedAt:
          now,

      });


      actionMessage =
        `${stuckJobs.length} stuck job(s) queue mein wapas aa gayi.`;

    }


    else if (
      action === "retry_failed"
    ) {


      const jobs =
        await getBatchJobs(
          batchId
        );


      const failedJobs =
        jobs.filter(
          (job)=>
            job.status === "failed"
        );


      if(
        failedJobs.length === 0
      ){

        return jsonError(
          "Koi failed job nahi mili.",
          409
        );

      }


      await mapWithConcurrency(

        failedJobs,

        8,

        async(job)=>

          saveBatchJob({

            ...job,

            status:
              "queued",

            attempts:
              0,

            notBefore:
              now,

            startedAt:
              undefined,

            completedAt:
              undefined,

            lastError:
              "",

            updatedAt:
              now,

          })

      );


      await saveBatch({

        ...batch,

        status:
          "queued",

        completedAt:
          undefined,

        updatedAt:
          now,

      });


      actionMessage =
        `${failedJobs.length} failed jobs retry queue mein aa gayi.`;

    }


    else {

      return jsonError(
        "Invalid action."
      );

    }


    const refreshed =
      await refreshBatchSummary(
        batchId
      );


    return NextResponse.json({

      success:true,

      message:
        actionMessage,

      batch:
        publicBatch(
          refreshed.batch
        ),

    });


  } catch(error) {


    const status =
      Number(
        (
          error as {
            status?: number;
          }
        )?.status || 500
      );


    const message =
      error instanceof Error
        ? error.message
        : "Facebook batch action failed.";


    return jsonError(
      message,
      status
    );

  }

}