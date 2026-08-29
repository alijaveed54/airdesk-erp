"use client";

import ProductBatchProductionClean from "./components/ProductBatchProductionClean";
import ProductBatchController from "./components/ProductBatchController";

import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Film,
  ImagePlus,
  Layers3,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Shuffle,
  Square,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type FacebookPage = {
  id: string;
  pageName: string;
  pageId: string;
  active: boolean;
  isDefault: boolean;
  tokenPreview: string;
  defaultCaption: string;
  createdAt: string;
};

type PagesResponse = {
  success: boolean;
  message?: string;
  pages?: FacebookPage[];
};

type BatchStatus =
  | "creating"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed";

type BatchSummary = {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  groupCount: number;
  postCount: number;
  totalJobs: number;
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  totalImages: number;
  progressPercent: number;
  lastError?: string;
};

type BatchesResponse = {
  success: boolean;
  message?: string;
  batches?: BatchSummary[];
  batch?: BatchSummary;
  workerConfigured?: boolean;
};

type BatchScheduleJob = {
  id: string;
  groupId: string;
  postId: string;
  groupNumber: number;
  postNumber: number;
  status: string;
  notBefore: string;
};

type BatchDetailsResponse =
  BatchesResponse & {
    jobs?: BatchScheduleJob[];
  };

type ScheduleEditorState = {
  batchId: string;
  batchName: string;
  startAt: string;
  pendingJobs: number;
  originalStartAt: string;
};

type DraftImage = {
  id: string;
  file: File;
  preview: string;
};

type DraftVideo = {
  id: string;
  file: File;
  preview: string;
};

type DraftPost = {
  id: string;
  message: string;
  pageMessages: Record<string, string>;
  images: DraftImage[];
  video: DraftVideo | null;
  videoPosition: "first" | "last";
  collapsed: boolean;
};

type DraftGroup = {
  id: string;
  pageRecordIds: string[];
  startAt: string;
  intervalMinutes: number;
  autoShuffleImages: boolean;
  posts: DraftPost[];
  collapsed: boolean;
};

type UploadResponse = {
  success: boolean;
  message?: string;
  url?: string;
  fileName?: string;
};

const MAX_IMAGES_PER_POST = 80;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function createId() {
  return crypto.randomUUID();
}

function createPost(): DraftPost {
  return {
    id: createId(),
    message: "",
    pageMessages: {},
    images: [],
    video: null,
    videoPosition: "last",
    collapsed: false,
  };
}

function createGroup(): DraftGroup {
  return {
    id: createId(),
    pageRecordIds: [],
    startAt: "",
    intervalMinutes: 10,
    autoShuffleImages: true,
    posts: [createPost()],
    collapsed: false,
  };
}

async function readJson<T>(
  response: Response
): Promise<T> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(
      text
    ) as T;
  } catch {
    throw new Error(
      text.slice(0, 500) ||
      "Server response valid JSON nahi hai."
    );
  }
}

async function mapWithConcurrency<
  T,
  R
>(
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

  const output =
    new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (
        index >=
        items.length
      ) {
        return;
      }

      output[index] =
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
          Math.max(1, limit),
          items.length
        ),
      },
      () => runWorker()
    )
  );

  return output;
}

function formatDate(
  value: string
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    "en-PK"
  );
}

function toDateTimeLocalValue(
  value: Date
) {
  const offset =
    value.getTimezoneOffset() *
    60 *
    1000;

  return new Date(
    value.getTime() - offset
  )
    .toISOString()
    .slice(0, 16);
}

function statusClass(
  status: BatchStatus
) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "processing":
      return "bg-blue-100 text-blue-700";
    case "queued":
      return "bg-amber-100 text-amber-700";
    case "paused":
      return "bg-violet-100 text-violet-700";
    case "partial":
      return "bg-orange-100 text-orange-700";
    case "cancelled":
      return "bg-slate-200 text-slate-700";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function revokeVideo(
  video: DraftVideo | null
) {
  if (video) {
    URL.revokeObjectURL(video.preview);
  }
}

function revokeImages(
  images: DraftImage[]
) {
  for (
    const image of images
  ) {
    URL.revokeObjectURL(
      image.preview
    );
  }
}

export default function FacebookBatchPage() {
  const [pages, setPages] =
    useState<FacebookPage[]>([]);
  const [batches, setBatches] =
    useState<BatchSummary[]>([]);
  const [workerConfigured, setWorkerConfigured] =
    useState(false);
  const [batchName, setBatchName] =
    useState("");
  const [groups, setGroups] =
    useState<DraftGroup[]>([
      createGroup(),
    ]);
  const [loading, setLoading] =
    useState(true);
  const [submitting, setSubmitting] =
    useState(false);
  const [processing, setProcessing] =
    useState(false);
  const [busyBatchId, setBusyBatchId] =
    useState("");
  const [progress, setProgress] =
    useState("");
  const [error, setError] =
    useState("");
  const [success, setSuccess] =
    useState("");
  const [scheduleEditor, setScheduleEditor] =
    useState<ScheduleEditorState | null>(null);
  const [savingSchedule, setSavingSchedule] =
    useState(false);
  const [cleaningR2Media, setCleaningR2Media] =
    useState(false);
  // MYSMAR_FB_COMPACT_GLOBAL_R2_V1

  const loadPages =
    useCallback(async () => {
      const response =
        await fetch(
          "/api/facebook/pages",
          {
            cache: "no-store",
          }
        );

      const data =
        await readJson<
          PagesResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Facebook Pages load nahi ho sake."
        );
      }

      setPages(
        (data.pages || []).filter(
          (page) =>
            page.active
        )
      );
    }, []);

  const loadBatches =
    useCallback(async () => {
      const response =
        await fetch(
          "/api/facebook/batch",
          {
            cache: "no-store",
          }
        );

      const data =
        await readJson<
          BatchesResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Facebook batches load nahi ho sake."
        );
      }

      setBatches(
        data.batches || []
      );
      setWorkerConfigured(
        Boolean(
          data.workerConfigured
        )
      );
    }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        await Promise.all([
          loadPages(),
          loadBatches(),
        ]);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Batch page load nahi ho saka."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    const timer =
      window.setInterval(
        () => {
          void loadBatches().catch(
            () => undefined
          );
        },
        15000
      );

    return () => {
      cancelled = true;
      window.clearInterval(
        timer
      );
    };
  }, [
    loadPages,
    loadBatches,
  ]);

  useEffect(
    () => () => {
      groups.forEach((group) => {
        group.posts.forEach((post) => {
          revokeImages(post.images);
          revokeVideo(post.video);
        });
      });
    },
    []
  );

  const summary =
    useMemo(() => {
      const sourcePosts =
        groups.reduce(
          (
            sum,
            group
          ) =>
            sum +
            group.posts.length,
          0
        );

      const jobs =
        groups.reduce(
          (
            sum,
            group
          ) =>
            sum +
            group.posts.length *
              group.pageRecordIds
                .length,
          0
        );

      const images =
        groups.reduce(
          (
            groupSum,
            group
          ) =>
            groupSum +
            group.posts.reduce(
              (
                postSum,
                post
              ) =>
                postSum +
                post.images.length,
              0
            ),
          0
        );

      const videos =
        groups.reduce(
          (sum, group) =>
            sum +
            group.posts.filter(
              (post) => Boolean(post.video)
            ).length,
          0
        );

      return {
        groups:
          groups.length,
        sourcePosts,
        jobs,
        images,
        videos,
      };
    }, [groups]);

  function updateGroup(
    groupId: string,
    updater: (
      group: DraftGroup
    ) => DraftGroup
  ) {
    setGroups(
      (current) =>
        current.map(
          (group) =>
            group.id === groupId
              ? updater(group)
              : group
        )
    );
  }

  function resolvedPageCaption(
    post: DraftPost,
    pageRecordId: string
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        post.pageMessages,
        pageRecordId
      )
    ) {
      return post.pageMessages[pageRecordId] || "";
    }

    const page =
      pages.find((item) => item.id === pageRecordId);

    return page?.defaultCaption || post.message || "";
  }

  function updatePost(
    groupId: string,
    postId: string,
    updater: (
      post: DraftPost
    ) => DraftPost
  ) {
    updateGroup(
      groupId,
      (group) => ({
        ...group,
        posts:
          group.posts.map(
            (post) =>
              post.id === postId
                ? updater(post)
                : post
          ),
      })
    );
  }

  function addGroup() {
    setGroups(
      (current) => [
        ...current,
        createGroup(),
      ]
    );
  }

  function removeGroup(
    groupId: string
  ) {
    setGroups(
      (current) => {
        const group =
          current.find(
            (item) =>
              item.id === groupId
          );

        group?.posts.forEach((post) => {
          revokeImages(post.images);
          revokeVideo(post.video);
        });

        const remaining =
          current.filter(
            (item) =>
              item.id !==
              groupId
          );

        return remaining.length
          ? remaining
          : [createGroup()];
      }
    );
  }

  function addPost(
    groupId: string
  ) {
    updateGroup(
      groupId,
      (group) => ({
        ...group,
        posts: [
          ...group.posts,
          createPost(),
        ],
      })
    );
  }

  function duplicatePost(
    groupId: string,
    sourcePost: DraftPost
  ) {
    const duplicated:
      DraftPost = {
        id: createId(),
        message:
          sourcePost.message,
        pageMessages: {
          ...sourcePost.pageMessages,
        },
        images:
          sourcePost.images.map(
            (image) => ({
              id: createId(),
              file:
                image.file,
              preview:
                URL.createObjectURL(
                  image.file
                ),
            })
          ),
        video: sourcePost.video
          ? {
              id: createId(),
              file: sourcePost.video.file,
              preview: URL.createObjectURL(
                sourcePost.video.file
              ),
            }
          : null,
        videoPosition:
          sourcePost.videoPosition,
        collapsed: false,
      };

    updateGroup(
      groupId,
      (group) => ({
        ...group,
        posts: [
          ...group.posts,
          duplicated,
        ],
      })
    );
  }

  function removePost(
    groupId: string,
    postId: string
  ) {
    updateGroup(
      groupId,
      (group) => {
        const post =
          group.posts.find(
            (item) =>
              item.id === postId
          );

        if (post) {
          revokeImages(post.images);
          revokeVideo(post.video);
        }

        const remaining =
          group.posts.filter(
            (item) =>
              item.id !== postId
          );

        return {
          ...group,
          posts:
            remaining.length
              ? remaining
              : [createPost()],
        };
      }
    );
  }

  function togglePage(
    groupId: string,
    pageRecordId: string
  ) {
    updateGroup(
      groupId,
      (group) => {
        const selected =
          group.pageRecordIds
            .includes(
              pageRecordId
            );

        return {
          ...group,
          pageRecordIds:
            selected
              ? group
                  .pageRecordIds
                  .filter(
                    (id) =>
                      id !==
                      pageRecordId
                  )
              : [
                  ...group.pageRecordIds,
                  pageRecordId,
                ],
        };
      }
    );
  }

  function selectAllPages(
    groupId: string
  ) {
    updateGroup(
      groupId,
      (group) => ({
        ...group,
        pageRecordIds:
          group.pageRecordIds
            .length ===
          pages.length
            ? []
            : pages.map(
                (page) =>
                  page.id
              ),
      })
    );
  }

  function addImages(
    groupId: string,
    postId: string,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files =
      Array.from(
        event.target.files ||
          []
      );

    event.target.value = "";

    if (!files.length) {
      return;
    }

    updatePost(
      groupId,
      postId,
      (post) => {
        const available =
          MAX_IMAGES_PER_POST -
          post.images.length;

        const accepted:
          DraftImage[] = [];

        for (
          const file of
            files.slice(
              0,
              available
            )
        ) {
          if (
            !ALLOWED_TYPES.has(
              file.type
            )
          ) {
            setError(
              `${file.name}: sirf JPG, PNG aur WebP allowed hain.`
            );
            continue;
          }

          if (
            file.size >
            MAX_FILE_SIZE
          ) {
            setError(
              `${file.name}: maximum size 20 MB hai.`
            );
            continue;
          }

          accepted.push({
            id: createId(),
            file,
            preview:
              URL.createObjectURL(
                file
              ),
          });
        }

        return {
          ...post,
          images: [
            ...post.images,
            ...accepted,
          ],
        };
      }
    );
  }

  function addVideo(
    groupId: string,
    postId: string,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      setError(
        `${file.name}: sirf MP4, MOV aur WebM allowed hain.`
      );
      return;
    }

    if (file.size > MAX_VIDEO_FILE_SIZE) {
      setError(
        `${file.name}: maximum video size 100 MB hai.`
      );
      return;
    }

    updatePost(
      groupId,
      postId,
      (post) => {
        revokeVideo(post.video);

        return {
          ...post,
          video: {
            id: createId(),
            file,
            preview: URL.createObjectURL(file),
          },
        };
      }
    );
  }

  function removeVideo(
    groupId: string,
    postId: string
  ) {
    updatePost(
      groupId,
      postId,
      (post) => {
        revokeVideo(post.video);

        return {
          ...post,
          video: null,
        };
      }
    );
  }

  function removeImage(
    groupId: string,
    postId: string,
    imageId: string
  ) {
    updatePost(
      groupId,
      postId,
      (post) => {
        const image =
          post.images.find(
            (item) =>
              item.id === imageId
          );

        if (image) {
          URL.revokeObjectURL(
            image.preview
          );
        }

        return {
          ...post,
          images:
            post.images.filter(
              (item) =>
                item.id !==
                imageId
            ),
        };
      }
    );
  }

  async function uploadMedia(
    batchId: string,
    postId: string,
    media: DraftImage | DraftVideo
  ) {
    let lastMessage =
      `${media.file.name}: upload failed.`;

    for (
      let attempt = 1;
      attempt <= 3;
      attempt += 1
    ) {
      try {
        const response =
          await fetch(
            "/api/facebook/batch/upload",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/octet-stream",
                "X-Facebook-Batch-Id":
                  batchId,
                "X-Facebook-Post-Id":
                  postId,
                "X-Facebook-File-Name":
                  encodeURIComponent(
                    media.file.name
                  ),
                "X-Facebook-File-Type":
                  media.file.type,
                "X-Facebook-File-Size":
                  String(
                    media.file.size
                  ),
              },
              body: media.file,
            }
          );

        const data =
          await readJson<
            UploadResponse
          >(response);

        if (
          !response.ok ||
          !data.success ||
          !data.url
        ) {
          lastMessage =
            data.message ||
            lastMessage;

          throw new Error(
            lastMessage
          );
        }

        return {
          url: data.url,
          name:
            data.fileName ||
            media.file.name,
        };
      } catch (uploadError) {
        lastMessage =
          uploadError instanceof Error
            ? uploadError.message
            : lastMessage;

        if (attempt < 3) {
          await new Promise(
            (resolve) =>
              window.setTimeout(
                resolve,
                attempt * 1500
              )
          );
        }
      }
    }

    throw new Error(
      lastMessage
    );
  }

  function validateBatch() {
    if (!groups.length) {
      throw new Error(
        "Kam az kam ek group required hai."
      );
    }

    groups.forEach(
      (
        group,
        groupIndex
      ) => {
        if (
          !group
            .pageRecordIds
            .length
        ) {
          throw new Error(
            `Group ${groupIndex + 1}: Facebook Page select karein.`
          );
        }

        if (!group.posts.length) {
          throw new Error(
            `Group ${groupIndex + 1}: post required hai.`
          );
        }

        group.posts.forEach(
          (
            post,
            postIndex
          ) => {
            const hasMedia =
              post.images.length > 0 ||
              Boolean(post.video);

            if (!hasMedia) {
              const missingPage =
                group.pageRecordIds.find(
                  (pageRecordId) =>
                    !resolvedPageCaption(
                      post,
                      pageRecordId
                    ).trim()
                );

              if (missingPage) {
                const page = pages.find(
                  (item) => item.id === missingPage
                );

                throw new Error(
                  `Group ${groupIndex + 1}, Post ${postIndex + 1}: ${page?.pageName || "selected Page"} ka caption missing hai.`
                );
              }
            }

            if (
              post.images.length >
              MAX_IMAGES_PER_POST
            ) {
              throw new Error(
                `Post ${postIndex + 1}: maximum ${MAX_IMAGES_PER_POST} images allowed hain.`
              );
            }
          }
        );
      }
    );
  }

  async function handleCreateBatch() {
    setError("");
    setSuccess("");

    try {
      validateBatch();
      setSubmitting(true);

      const batchId =
        createId();

      const uploadTasks =
        groups.flatMap(
          (group, groupIndex) =>
            group.posts.flatMap(
              (post, postIndex) => [
                ...post.images.map((image) => ({
                  groupId: group.id,
                  postId: post.id,
                  groupIndex,
                  postIndex,
                  mediaType: "image" as const,
                  media: image,
                })),
                ...(post.video
                  ? [{
                      groupId: group.id,
                      postId: post.id,
                      groupIndex,
                      postIndex,
                      mediaType: "video" as const,
                      media: post.video,
                    }]
                  : []),
              ]
            )
        );

      let uploadedCount = 0;

      const uploaded =
        await mapWithConcurrency(
          uploadTasks,
          4,
          async (task) => {
            const result =
              await uploadMedia(
                batchId,
                task.postId,
                task.media
              );

            uploadedCount += 1;
            setProgress(
              uploadTasks.length
                ? `Uploading media ${uploadedCount}/${uploadTasks.length}`
                : "Preparing queue..."
            );

            return {
              ...task,
              ...result,
            };
          }
        );

      const mediaMap =
        new Map<
          string,
          Array<{
            url: string;
            name: string;
            mediaType: "image" | "video";
          }>
        >();

      for (
        const item of uploaded
      ) {
        const current =
          mediaMap.get(
            item.postId
          ) || [];

        current.push({
          url: item.url,
          name: item.name,
          mediaType: item.mediaType,
        });

        mediaMap.set(
          item.postId,
          current
        );
      }

      setProgress(
        "Saving Facebook queue..."
      );

      const payload = {
        batchId,
        batchName:
          batchName.trim() ||
          `Facebook Batch ${new Date().toLocaleString(
            "en-PK"
          )}`,
        groups:
          groups.map(
            (group) => ({
              id: group.id,
              pageRecordIds:
                group.pageRecordIds,
              intervalMinutes:
                Number(
                  group.intervalMinutes
                ) || 0,
              autoShuffleImages:
                group.autoShuffleImages,
              startAt:
                group.startAt
                  ? new Date(
                      group.startAt
                    ).toISOString()
                  : "",
              posts:
                group.posts.map(
                  (post) => {
                    const media =
                      mediaMap.get(
                        post.id
                      ) || [];

                    return {
                      id: post.id,
                      message:
                        post.message.trim(),
                      pageMessages:
                        post.pageMessages,
                      imageUrls:
                        media
                          .filter((item) =>
                            item.mediaType === "image"
                          )
                          .map((item) => item.url),
                      imageNames:
                        media
                          .filter((item) =>
                            item.mediaType === "image"
                          )
                          .map((item) => item.name),
                      videoUrl:
                        media.find((item) =>
                          item.mediaType === "video"
                        )?.url || "",
                      videoName:
                        media.find((item) =>
                          item.mediaType === "video"
                        )?.name || "",
                      videoPosition:
                        post.videoPosition,
                    };
                  }
                ),
            })
          ),
      };

      const response =
        await fetch(
          "/api/facebook/batch",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                payload
              ),
          }
        );

      const data =
        await readJson<
          BatchesResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Facebook batch create nahi ho saka."
        );
      }

      setSuccess(
        data.message ||
        "Batch upload aur queue ho gaya."
      );
      setBatchName("");

      groups.forEach((group) => {
        group.posts.forEach((post) => {
          revokeImages(post.images);
          revokeVideo(post.video);
        });
      });

      setGroups([
        createGroup(),
      ]);
      setProgress("");

      await loadBatches();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Facebook batch create nahi ho saka."
      );
      setProgress("");
    } finally {
      setSubmitting(false);
    }
  }

  async function runProcessor() {
    try {
      setProcessing(true);
      setError("");
      setSuccess("");

      const response =
        await fetch(
          "/api/facebook/batch/process",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                limit: 1,
              }),
          }
        );

      const data =
        await readJson<{
          success: boolean;
          message?: string;
        }>(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Processor run nahi hua."
        );
      }

      setSuccess(
        data.message ||
        "Processor run ho gaya."
      );

      await loadBatches();
    } catch (processorError) {
      setError(
        processorError instanceof Error
          ? processorError.message
          : "Processor run nahi hua."
      );
    } finally {
      setProcessing(false);
    }
  }

  async function openScheduleEditor(
    batch: BatchSummary
  ) {
    try {
      setBusyBatchId(
        batch.id
      );
      setError("");
      setSuccess("");

      const response =
        await fetch(
          `/api/facebook/batch?batchId=${encodeURIComponent(
            batch.id
          )}`,
          {
            cache: "no-store",
          }
        );

      const data =
        await readJson<
          BatchDetailsResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Scheduled jobs load nahi ho sake."
        );
      }

      const pendingJobs =
        (data.jobs || []).filter(
          (job) =>
            job.status ===
              "queued" ||
            job.status ===
              "retrying"
        );

      if (
        pendingJobs.length === 0
      ) {
        throw new Error(
          "Is batch mein koi scheduled queued ya retrying job nahi hai."
        );
      }

      const validTimes =
        pendingJobs
          .map((job) =>
            new Date(
              job.notBefore
            ).getTime()
          )
          .filter((time) =>
            Number.isFinite(
              time
            )
          )
          .sort(
            (left, right) =>
              left - right
          );

      const firstSchedule =
        new Date(
          validTimes[0] ||
            Date.now() +
              5 * 60 * 1000
        );

      setScheduleEditor({
        batchId: batch.id,
        batchName:
          batch.name,
        startAt:
          toDateTimeLocalValue(
            firstSchedule
          ),
        pendingJobs:
          pendingJobs.length,
        originalStartAt:
          firstSchedule.toISOString(),
      });
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? scheduleError.message
          : "Scheduled jobs load nahi ho sake."
      );
    } finally {
      setBusyBatchId("");
    }
  }

  async function saveScheduleChange() {
    if (!scheduleEditor) {
      return;
    }

    const selectedDate =
      new Date(
        scheduleEditor.startAt
      );

    if (
      Number.isNaN(
        selectedDate.getTime()
      )
    ) {
      setError(
        "Valid date aur time select karein."
      );
      return;
    }

    try {
      setSavingSchedule(true);
      setBusyBatchId(
        scheduleEditor.batchId
      );
      setError("");
      setSuccess("");

      const response =
        await fetch(
          "/api/facebook/batch",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                batchId:
                  scheduleEditor.batchId,
                action:
                  "reschedule",
                startAt:
                  selectedDate.toISOString(),
              }),
          }
        );

      const data =
        await readJson<
          BatchesResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Schedule update nahi hua."
        );
      }

      setSuccess(
        data.message ||
        "Remaining scheduled jobs ka date aur time update ho gaya."
      );
      setScheduleEditor(
        null
      );

      await loadBatches();
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? scheduleError.message
          : "Schedule update nahi hua."
      );
    } finally {
      setSavingSchedule(false);
      setBusyBatchId("");
    }
  }

  async function cleanupR2Media() {
    setCleaningR2Media(true);
    setError("");
    setSuccess("");

    try {
      const response =
        await fetch(
          "/api/facebook/batch/media-cleanup",
          {
            method: "POST",
          }
        );

      const data =
        await readJson<{
          success: boolean;
          message?: string;
          scannedBatches?: number;
          eligiblePosts?: number;
          cleanedPosts?: number;
          deletedObjects?: number;
          failures?: Array<{
            batchId: string;
            postId: string;
            message: string;
          }>;
        }>(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "R2 media cleanup failed."
        );
      }

      const failedCount =
        data.failures?.length || 0;

      setSuccess(
        data.message ||
        `R2 cleanup complete: ${data.deletedObjects || 0} file(s) deleted from ${data.cleanedPosts || 0} completed post(s)${failedCount ? `, ${failedCount} cleanup failure(s)` : ""}.`
      );

      await loadBatches();
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "R2 media cleanup failed."
      );
    } finally {
      setCleaningR2Media(false);
    }
  }

  async function batchAction(
    batchId: string,
    action:
  | "pause"
  | "resume"
  | "process_now"
  | "retry_failed"
  | "reset_stuck"
  | "cancel"
  ) {
    try {
      setBusyBatchId(
        batchId
      );
      setError("");
      setSuccess("");

      const response =
        await fetch(
          "/api/facebook/batch",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                batchId,
                action,
              }),
          }
        );

      const data =
        await readJson<
          BatchesResponse
        >(response);

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
          "Batch action failed."
        );
      }

      setSuccess(
        data.message ||
        "Batch status update ho gaya."
      );

      await loadBatches();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Batch action failed."
      );
    } finally {
      setBusyBatchId("");
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-[70vh] place-items-center p-6">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 font-bold text-slate-600 shadow-sm">
          <Loader2
            className="animate-spin"
            size={20}
          />
          Loading Facebook Batch Posts...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <style jsx global>{`
        /* MYSMAR_FB_ICON_ONLY_V2 */
        .mysmar-batch-queue-compact .mysmar-icon-action {
          width: 32px !important;
          min-width: 32px !important;
          height: 32px !important;
          min-height: 32px !important;
          padding: 0 !important;
          border-radius: 9px !important;
          font-size: 0 !important;
          line-height: 1 !important;
          gap: 0 !important;
          justify-content: center !important;
        }
        .mysmar-batch-queue-compact .mysmar-icon-action svg {
          width: 15px !important;
          height: 15px !important;
        }
      `}</style>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-700 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
                  <Layers3 size={24} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">
                    Facebook Automation
                  </p>
                  <h1 className="text-3xl font-black">
                    Batch Posts
                  </h1>
                </div>
              </div>

              <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-white/80">
                Multiple post groups banayein, har group ko different Pages assign karein, images ek dafa R2 par upload karein aur server worker ko posting complete karne dein.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Groups", summary.groups],
                ["Posts", summary.sourcePosts],
                ["Page Jobs", summary.jobs],
                ["Images", summary.images],
                ["Videos", summary.videos],
              ].map(
                ([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-2xl bg-white/10 px-4 py-3 text-center backdrop-blur"
                  >
                    <div className="text-2xl font-black">
                      {value}
                    </div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-white/70">
                      {label}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </header>

        <ProductBatchProductionClean />

        <ProductBatchController />

        {!workerConfigured && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <AlertCircle
              size={20}
              className="mt-0.5 shrink-0"
            />
            <div>
              <p className="font-black">
                Background worker abhi configured nahi hai
              </p>
              <p className="mt-1 text-sm font-semibold leading-6">
                Batch queue save ho sakti hai, lekin browser band karne ke baad automatic posting ke liye <code>FACEBOOK_BATCH_WORKER_SECRET</code> aur worker process run karna zaroori hai.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            <XCircle
              size={20}
              className="mt-0.5 shrink-0"
            />
            <p className="font-bold">
              {error}
            </p>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
            <CheckCircle2
              size={20}
              className="mt-0.5 shrink-0"
            />
            <p className="font-bold">
              {success}
            </p>
          </div>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <label className="block flex-1">
              <span className="mb-2 block text-sm font-black text-slate-700">
                Batch Name
              </span>
              <input
                value={batchName}
                onChange={(event) =>
                  setBatchName(
                    event.target.value
                  )
                }
                placeholder="Example: July New Arrivals — UAE Pages"
                className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
              />
            </label>

            <button
              type="button"
              onClick={addGroup}
              disabled={submitting}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={18} />
              Add Page Group
            </button>
          </div>
        </section>

        <div className="space-y-5">
          {groups.map(
            (
              group,
              groupIndex
            ) => (
              <section
                key={group.id}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <button
                    type="button"
                    onClick={() =>
                      updateGroup(
                        group.id,
                        (current) => ({
                          ...current,
                          collapsed:
                            !current.collapsed,
                        })
                      )
                    }
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-100 font-black text-blue-700">
                      {groupIndex + 1}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-black text-slate-900">
                        Page Group {groupIndex + 1}
                      </h2>
                      <p className="text-xs font-bold text-slate-500">
                        {group.posts.length} post(s) × {group.pageRecordIds.length} Page(s) = {group.posts.length * group.pageRecordIds.length} jobs
                      </p>
                    </div>
                    {group.collapsed ? (
                      <ChevronDown size={18} />
                    ) : (
                      <ChevronUp size={18} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      removeGroup(
                        group.id
                      )
                    }
                    disabled={submitting}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                    Remove Group
                  </button>
                </div>

                {!group.collapsed && (
                  <div className="space-y-5 p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black text-slate-800">
                              Facebook Pages
                            </h3>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              Is group ke tamam posts selected Pages par jayenge.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              selectAllPages(
                                group.id
                              )
                            }
                            className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"
                          >
                            {group.pageRecordIds.length === pages.length
                              ? "Clear All"
                              : "Select All"}
                          </button>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {pages.map(
                            (pageItem) => {
                              const selected =
                                group.pageRecordIds.includes(
                                  pageItem.id
                                );

                              return (
                                <button
                                  key={pageItem.id}
                                  type="button"
                                  onClick={() =>
                                    togglePage(
                                      group.id,
                                      pageItem.id
                                    )
                                  }
                                  className={[
                                    "flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                                    selected
                                      ? "border-blue-400 bg-blue-50 ring-4 ring-blue-50"
                                      : "border-slate-200 bg-white hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  <span
                                    className={[
                                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-black",
                                      selected
                                        ? "border-blue-600 bg-blue-600 text-white"
                                        : "border-slate-300 text-transparent",
                                    ].join(" ")}
                                  >
                                    ✓
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-black text-slate-800">
                                      {pageItem.pageName}
                                    </span>
                                    <span className="block truncate text-[11px] font-semibold text-slate-500">
                                      {pageItem.pageId}
                                    </span>
                                  </span>
                                </button>
                              );
                            }
                          )}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                          <Clock3 size={17} />
                          Queue Timing
                        </div>

                        <label className="block">
                          <span className="mb-1.5 block text-xs font-black text-slate-600">
                            Start At
                          </span>
                          <input
                            type="datetime-local"
                            value={group.startAt}
                            onChange={(event) =>
                              updateGroup(
                                group.id,
                                (current) => ({
                                  ...current,
                                  startAt:
                                    event.target.value,
                                })
                              )
                            }
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-xs font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          />
                          <span className="mt-1 block text-[10px] font-semibold text-slate-400">
                            Blank = immediately queued
                          </span>
                        </label>

                        <label className="block">
                          <span className="mb-1.5 block text-xs font-black text-slate-600">
                            Minutes Between Posts
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={group.intervalMinutes}
                            onChange={(event) =>
                              updateGroup(
                                group.id,
                                (current) => ({
                                  ...current,
                                  intervalMinutes:
                                    Number(
                                      event.target.value
                                    ) || 0,
                                })
                              )
                            }
                            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                          />
                        </label>

                        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                          <input
                            type="checkbox"
                            checked={group.autoShuffleImages}
                            onChange={(event) =>
                              updateGroup(
                                group.id,
                                (current) => ({
                                  ...current,
                                  autoShuffleImages:
                                    event.target.checked,
                                })
                              )
                            }
                            className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600"
                          />
                          <Shuffle size={16} className="mt-0.5 shrink-0 text-violet-700" />
                          <span>
                            <span className="block text-xs font-black text-violet-900">
                              Auto-shuffle each Page
                            </span>
                            <span className="mt-1 block text-[10px] font-semibold leading-4 text-violet-700">
                              Single Page par bhi 2+ images original order mein nahi jayengi.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {group.posts.map(
                        (
                          post,
                          postIndex
                        ) => (
                          <article
                            key={post.id}
                            className="overflow-hidden rounded-2xl border border-slate-200"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                              <button
                                type="button"
                                onClick={() =>
                                  updatePost(
                                    group.id,
                                    post.id,
                                    (current) => ({
                                      ...current,
                                      collapsed:
                                        !current.collapsed,
                                    })
                                  )
                                }
                                className="flex items-center gap-2 text-left"
                              >
                                <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-xs font-black text-violet-700">
                                  {postIndex + 1}
                                </span>
                                <span>
                                  <span className="block text-sm font-black text-slate-800">
                                    Post {postIndex + 1}
                                  </span>
                                  <span className="block text-[11px] font-semibold text-slate-500">
                                    {post.images.length} image(s)
                                    {post.video ? " · 1 video" : ""}
                                  </span>
                                </span>
                                {post.collapsed ? (
                                  <ChevronDown size={16} />
                                ) : (
                                  <ChevronUp size={16} />
                                )}
                              </button>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    duplicatePost(
                                      group.id,
                                      post
                                    )
                                  }
                                  disabled={submitting}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  <Copy size={14} />
                                  Duplicate
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    removePost(
                                      group.id,
                                      post.id
                                    )
                                  }
                                  disabled={submitting}
                                  className="grid h-8 w-8 place-items-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  aria-label="Remove post"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            {!post.collapsed && (
                              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                                <div className="space-y-4">
                                  <label className="block">
                                    <span className="mb-2 block text-xs font-black text-slate-600">
                                      Fallback Caption
                                    </span>
                                    <textarea
                                      value={post.message}
                                      onChange={(event) =>
                                        updatePost(
                                          group.id,
                                          post.id,
                                          (current) => ({
                                            ...current,
                                            message: event.target.value,
                                          })
                                        )
                                      }
                                      rows={4}
                                      placeholder="Sirf un Pages ke liye use hoga jinka default caption empty hai..."
                                      className="w-full resize-y rounded-2xl border border-slate-200 p-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                                    />
                                  </label>

                                  <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                                    <div>
                                      <p className="text-sm font-black text-blue-950">
                                        Caption for Each Facebook Page
                                      </p>
                                      <p className="mt-1 text-xs font-semibold text-blue-700">
                                        Har selected Page ka saved default caption automatically use hoga. Sirf zarurat par custom edit karein.
                                      </p>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                      {group.pageRecordIds.length === 0 ? (
                                        <p className="rounded-xl bg-white p-3 text-xs font-bold text-slate-500">
                                          Pehle Facebook Page select karein.
                                        </p>
                                      ) : (
                                        group.pageRecordIds.map((pageRecordId) => {
                                          const pageItem = pages.find(
                                            (page) => page.id === pageRecordId
                                          );
                                          const hasOverride =
                                            Object.prototype.hasOwnProperty.call(
                                              post.pageMessages,
                                              pageRecordId
                                            );
                                          const value = hasOverride
                                            ? post.pageMessages[pageRecordId]
                                            : pageItem?.defaultCaption || post.message;

                                          return (
                                            <div
                                              key={pageRecordId}
                                              className="rounded-xl border border-blue-100 bg-white p-3"
                                            >
                                              <div className="mb-2 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                  <p className="truncate text-xs font-black text-slate-800">
                                                    {pageItem?.pageName || "Facebook Page"}
                                                  </p>
                                                  <p className="text-[11px] font-semibold text-slate-500">
                                                    {hasOverride
                                                      ? "Custom caption for this post"
                                                      : pageItem?.defaultCaption
                                                        ? "Using saved Page default"
                                                        : "Using fallback caption"}
                                                  </p>
                                                </div>

                                                {hasOverride && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      updatePost(
                                                        group.id,
                                                        post.id,
                                                        (current) => {
                                                          const nextMessages = {
                                                            ...current.pageMessages,
                                                          };
                                                          delete nextMessages[pageRecordId];

                                                          return {
                                                            ...current,
                                                            pageMessages: nextMessages,
                                                          };
                                                        }
                                                      )
                                                    }
                                                    className="shrink-0 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[10px] font-black text-blue-700"
                                                  >
                                                    Use Page Default
                                                  </button>
                                                )}
                                              </div>

                                              <textarea
                                                value={value || ""}
                                                onChange={(event) =>
                                                  updatePost(
                                                    group.id,
                                                    post.id,
                                                    (current) => ({
                                                      ...current,
                                                      pageMessages: {
                                                        ...current.pageMessages,
                                                        [pageRecordId]: event.target.value,
                                                      },
                                                    })
                                                  )
                                                }
                                                rows={5}
                                                placeholder="Is Page ka caption..."
                                                className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                                              />
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                      <span className="text-xs font-black text-slate-600">
                                        Images ({post.images.length}/{MAX_IMAGES_PER_POST})
                                      </span>

                                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white transition hover:bg-violet-700">
                                        <ImagePlus size={15} />
                                        Add Images
                                        <input
                                          type="file"
                                          multiple
                                          accept="image/jpeg,image/png,image/webp"
                                          className="hidden"
                                          onChange={(event) =>
                                            addImages(
                                              group.id,
                                              post.id,
                                              event
                                            )
                                          }
                                        />
                                      </label>
                                    </div>

                                    {post.images.length === 0 ? (
                                      <label className="grid h-[120px] cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-center transition hover:border-violet-300 hover:bg-violet-50">
                                        <div>
                                          <ImagePlus
                                            size={24}
                                            className="mx-auto text-slate-400"
                                          />
                                          <p className="mt-2 text-xs font-black text-slate-600">
                                            Select up to {MAX_IMAGES_PER_POST} images
                                          </p>
                                          <p className="mt-1 text-[11px] font-semibold text-slate-400">
                                            JPG, PNG or WebP · 20 MB each
                                          </p>
                                        </div>
                                        <input
                                          type="file"
                                          multiple
                                          accept="image/jpeg,image/png,image/webp"
                                          className="hidden"
                                          onChange={(event) =>
                                            addImages(
                                              group.id,
                                              post.id,
                                              event
                                            )
                                          }
                                        />
                                      </label>
                                    ) : (
                                      <div className="grid max-h-[160px] grid-cols-3 gap-2 overflow-y-auto rounded-2xl border border-slate-200 p-2 sm:grid-cols-4">
                                        {post.images.map((image) => (
                                          <div
                                            key={image.id}
                                            className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100"
                                          >
                                            <img
                                              src={image.preview}
                                              alt={image.file.name}
                                              className="h-full w-full object-cover"
                                            />
                                            <button
                                              type="button"
                                              onClick={() =>
                                                removeImage(
                                                  group.id,
                                                  post.id,
                                                  image.id
                                                )
                                              }
                                              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-slate-950/75 text-white opacity-100 transition hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                              aria-label="Remove image"
                                            >
                                              <X size={14} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs font-black text-blue-900">
                                          Video (maximum 1)
                                        </p>
                                        <p className="mt-0.5 text-[10px] font-bold text-blue-700">
                                          MP4, MOV or WebM · 100 MB
                                        </p>
                                      </div>

                                      {!post.video && (
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">
                                          <Film size={15} />
                                          Add Video
                                          <input
                                            type="file"
                                            accept="video/mp4,video/quicktime,video/webm"
                                            className="hidden"
                                            onChange={(event) =>
                                              addVideo(
                                                group.id,
                                                post.id,
                                                event
                                              )
                                            }
                                          />
                                        </label>
                                      )}
                                    </div>

                                    {post.video ? (
                                      <div className="space-y-3">
                                        <div className="relative overflow-hidden rounded-xl bg-slate-950">
                                          <video
                                            src={post.video.preview}
                                            controls
                                            preload="metadata"
                                            className="h-36 w-full object-contain"
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeVideo(
                                                group.id,
                                                post.id
                                              )
                                            }
                                            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-red-600 text-white"
                                            aria-label="Remove video"
                                          >
                                            <X size={15} />
                                          </button>
                                        </div>

                                        <p className="truncate text-[11px] font-black text-blue-900">
                                          {post.video.file.name}
                                        </p>

                                        {post.images.length > 0 && (
                                          <label className="block">
                                            <span className="mb-1 block text-[10px] font-black uppercase text-blue-800">
                                              Video Position
                                            </span>
                                            <select
                                              value={post.videoPosition}
                                              onChange={(event) =>
                                                updatePost(
                                                  group.id,
                                                  post.id,
                                                  (current) => ({
                                                    ...current,
                                                    videoPosition:
                                                      event.target.value === "first"
                                                        ? "first"
                                                        : "last",
                                                  })
                                                )
                                              }
                                              className="h-10 w-full rounded-xl border border-blue-200 bg-white px-3 text-xs font-black text-blue-900"
                                            >
                                              <option value="first">Video First</option>
                                              <option value="last">Video Last</option>
                                            </select>
                                          </label>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="rounded-xl border border-dashed border-blue-200 bg-white/70 p-3 text-center text-[11px] font-bold text-blue-700">
                                        Is post ke liye optional video select karein.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </article>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        addPost(
                          group.id
                        )
                      }
                      disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                    >
                      <Plus size={17} />
                      Add Post to Group
                    </button>
                  </div>
                )}
              </section>
            )
          )}
        </div>

        <section className="sticky bottom-4 z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black text-slate-800">
                {summary.sourcePosts} source posts will create {summary.jobs} Page-post jobs
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Browser tab initial image upload aur queue confirmation tak open rakhein. Queue save hone ke baad worker independent chalega.
              </p>
              {progress && (
                <p className="mt-2 text-xs font-black text-blue-700">
                  {progress}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                void handleCreateBatch()
              }
              disabled={
                submitting ||
                summary.jobs === 0
              }
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3 text-sm font-black text-white shadow-lg transition hover:from-blue-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2
                  size={19}
                  className="animate-spin"
                />
              ) : (
                <Send size={19} />
              )}
              {submitting
                ? "Uploading & Queuing..."
                : "Upload and Start Batch"}
            </button>
          </div>
        </section>

        <section className="mysmar-batch-queue-compact rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">
                Batch Queue
              </h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Status automatically refreshes every 15 seconds.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href="/facebook/batch/manage-all"
                title="Manage All Posts"
                aria-label="Manage All Posts"
                className="mysmar-icon-action inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
              >
                <ListChecks size={15} />
                <span className="sr-only">Manage All Posts</span>
              </a>

              <button
                type="button"
                onClick={() =>
                  void cleanupR2Media()
                }
                disabled={cleaningR2Media}
                title="Cleanup R2 Media"
                aria-label="Cleanup R2 Media"
                className="mysmar-icon-action inline-flex items-center rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {cleaningR2Media ? (
                  <Loader2
                    size={15}
                    className="animate-spin"
                  />
                ) : (
                  <Trash2 size={15} />
                )}
                <span className="sr-only">Cleanup R2 Media</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void loadBatches()
                }
                title="Refresh Batch Queue"
                aria-label="Refresh Batch Queue"
                className="mysmar-icon-action inline-flex items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw size={15} />
                <span className="sr-only">Refresh Batch Queue</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void runProcessor()
                }
                disabled={processing}
                title="Process Next Job"
                aria-label="Process Next Job"
                className="mysmar-icon-action inline-flex items-center rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {processing ? (
                  <Loader2
                    size={15}
                    className="animate-spin"
                  />
                ) : (
                  <Play size={15} />
                )}
                <span className="sr-only">Process Next Job</span>
              </button>
            </div>
          </div>

          {batches.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">
              No Facebook batch created yet.
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map(
                (batch) => {
                  const busy =
                    busyBatchId ===
                    batch.id;

                  return (
                    <article
                      key={batch.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-black text-slate-900">
                              {batch.name}
                            </h3>
                            <span
                              className={[
                                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                                statusClass(
                                  batch.status
                                ),
                              ].join(" ")}
                            >
                              {batch.status}
                            </span>
                          </div>

                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            Created by {batch.createdBy} · {formatDate(batch.createdAt)}
                          </p>

                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                              style={{
                                width: `${Math.min(
                                  Math.max(
                                    batch.progressPercent || 0,
                                    0
                                  ),
                                  100
                                )}%`,
                              }}
                            />
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                            <span>{batch.postCount} posts</span>
                            <span>{batch.totalJobs} jobs</span>
                            <span>{batch.totalImages} images</span>
                            <span className="text-emerald-600">{batch.completedJobs} completed</span>
                            <span className="text-blue-600">{batch.processingJobs} processing</span>
                            <span className="text-amber-600">{batch.queuedJobs} queued</span>
                            <span className="text-red-600">{batch.failedJobs} failed</span>
                          </div>

                          {batch.lastError && (
                            <p className="mt-2 line-clamp-2 text-xs font-bold text-red-600">
                              {batch.lastError}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {(batch.status === "queued" ||
                            batch.status === "processing") && (
                            <button
                              type="button"
                              onClick={() =>
                                void batchAction(
                                  batch.id,
                                  "pause"
                                )
                              }
                              disabled={busy}
                              title="Pause Batch"
                              aria-label="Pause Batch"
                              className="mysmar-icon-action inline-flex items-center rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                            >
                              <Pause size={15} />
                              <span className="sr-only">Pause Batch</span>
                            </button>
                          )}

                          {batch.status === "paused" && (
                            <button
                              type="button"
                              onClick={() =>
                                void batchAction(
                                  batch.id,
                                  "resume"
                                )
                              }
                              disabled={busy}
                              title="Resume Batch"
                              aria-label="Resume Batch"
                              className="mysmar-icon-action inline-flex items-center rounded-xl border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            >
                              <Play size={15} />
                              <span className="sr-only">Resume Batch</span>
                            </button>
                          )}

                          <a
                            href={`/facebook/batch/${batch.id}`}
                            title="Manage This Batch Posts"
                            aria-label="Manage This Batch Posts"
                            className="mysmar-icon-action inline-flex items-center rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50"
                          >
                            <ListChecks size={15} />
                            <span className="sr-only">Manage This Batch Posts</span>
                          </a>

                          {batch.queuedJobs > 0 &&
                            !["completed", "cancelled"].includes(
                              batch.status
                            ) && (
                              <button
                                type="button"
                                onClick={() =>
                                  void openScheduleEditor(
                                    batch
                                  )
                                }
                                disabled={busy}
                                title="Change Schedule"
                                aria-label="Change Schedule"
                                className="mysmar-icon-action inline-flex items-center rounded-xl border border-cyan-200 text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                              >
                                <CalendarClock size={15} />
                                <span className="sr-only">Change Schedule</span>
                              </button>
                            )}

                          {batch.queuedJobs > 0 &&
                            !["completed", "cancelled"].includes(
                              batch.status
                            ) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `"${batch.name}" ki tamam remaining scheduled jobs abhi process karni hain? Original future timeline remove ho jayegi.`
                                    )
                                  ) {
                                    void batchAction(
                                      batch.id,
                                      "process_now"
                                    );
                                  }
                                }}
                                disabled={busy}
                                title="Process Batch Now"
                                aria-label="Process Batch Now"
                                className="mysmar-icon-action inline-flex items-center rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                <Send size={15} />
                                <span className="sr-only">Process Batch Now</span>
                              </button>
                            )}

                          {batch.failedJobs > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `"${batch.name}" ki ${batch.failedJobs} failed Facebook Page job(s) dobara retry karni hain? Sirf failed jobs re-queue hongi; completed posts dobara publish nahi hongi.`
                                  )
                                ) {
                                  void batchAction(
                                    batch.id,
                                    "retry_failed"
                                  );
                                }
                                
                              }}
                              disabled={busy}
                              title="Retry only failed Facebook jobs"
                              aria-label={`Retry ${batch.failedJobs} failed Facebook jobs`}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-black text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                            >
                              <RotateCcw size={14} />
                              Retry Failed ({batch.failedJobs})
                            </button>
                          )}
<button
  type="button"
  onClick={() =>
    batchAction(
      batch.id,
      "reset_stuck"
    )
  }
  disabled={busyBatchId === batch.id}
  className="mysmar-icon-action rounded-lg border border-orange-200 bg-white text-orange-600 hover:bg-orange-50"
  title="Reset stuck jobs"
>
  <RotateCcw size={15} />
</button>
                          {!["completed", "cancelled"].includes(batch.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `"${batch.name}" ke remaining jobs cancel karne hain?`
                                  )
                                ) {
                                  void batchAction(
                                    batch.id,
                                    "cancel"
                                  );
                                }
                              }}
                              disabled={busy}
                              title="Cancel Remaining Jobs"
                              aria-label="Cancel Remaining Jobs"
                              className="mysmar-icon-action inline-flex items-center rounded-xl border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Square size={15} />
                              <span className="sr-only">Cancel Remaining Jobs</span>
                            </button>
                          )}

                          {busy && (
                            <Loader2
                              size={18}
                              className="animate-spin text-slate-400"
                            />
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      </div>

      {scheduleEditor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !savingSchedule
            ) {
              setScheduleEditor(
                null
              );
            }
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-700">
                  <CalendarClock
                    size={20}
                  />
                  <h2 className="text-lg font-black">
                    Change Schedule
                  </h2>
                </div>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {scheduleEditor.batchName}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {scheduleEditor.pendingJobs} remaining queued/retrying jobs
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setScheduleEditor(
                    null
                  )
                }
                disabled={
                  savingSchedule
                }
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Close schedule editor"
              >
                <X size={18} />
              </button>
            </div>

            <label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-600">
              New date and time for first remaining post
            </label>
            <input
              type="datetime-local"
              value={
                scheduleEditor.startAt
              }
              onChange={(event) =>
                setScheduleEditor(
                  (current) =>
                    current
                      ? {
                          ...current,
                          startAt:
                            event.target.value,
                        }
                      : current
                )
              }
              disabled={
                savingSchedule
              }
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
            />

            <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-xs font-semibold leading-5 text-cyan-900">
              Tamam remaining scheduled jobs same time difference se shift hongi. Existing gaps aur Page-wise same-post timing preserve rahegi. Completed aur currently processing jobs change nahi hongi.
            </div>

            <p className="mt-3 text-xs font-semibold text-slate-500">
              Current first remaining time: {formatDate(
                scheduleEditor.originalStartAt
              )}
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  setScheduleEditor(
                    null
                  )
                }
                disabled={
                  savingSchedule
                }
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() =>
                  void saveScheduleChange()
                }
                disabled={
                  savingSchedule ||
                  !scheduleEditor.startAt
                }
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-black text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {savingSchedule ? (
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                ) : (
                  <CalendarClock
                    size={16}
                  />
                )}
                Save New Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

