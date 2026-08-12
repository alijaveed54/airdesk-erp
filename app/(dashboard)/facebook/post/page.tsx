"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Cloud,
  Film,
  ImagePlus,
  Images,
  Loader2,
  MonitorUp,
  RefreshCw,
  Search,
  Send,
  Share2,
  Shuffle,
  X,
  XCircle,
} from "lucide-react";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shuffleFacebookImagesForPage } from "@/lib/facebook-image-shuffle";

type FacebookPage = {
  id: string;
  pageName: string;
  pageId: string;
  active: boolean;
  isDefault: boolean;
  tokenPreview: string;
  createdAt: string;
};

type PostResult = {
  recordId: string;
  pageName: string;
  pageId: string;
  success: boolean;
  facebookPostId?: string;
  message?: string;
  scheduled?: boolean;
  scheduledAt?: string;
  shuffleApplied?: boolean;
  imageOrder?: string[];
};

type PagesResponse = {
  success: boolean;
  message?: string;
  pages?: FacebookPage[];
};

type PostResponse = {
  success: boolean;
  message?: string;
  results?: PostResult[];
};

type SelectedImage = {
  id: string;
  url: string;
  name: string;
  source: "PC" | "R2";
  key?: string;
  file?: File;
};

type SelectedVideo = {
  id: string;
  url: string;
  name: string;
  source: "PC" | "URL";
  file?: File;
};

type VideoPosition = "first" | "last";

type DirectUploadResponse = {
  success: boolean;
  message?: string;
  mediaId?: string;
  fileName?: string;
};

type DirectPublishResponse = {
  success: boolean;
  message?: string;
  result?: PostResult;
};

type DirectPublishMediaItem =
  | {
      type: "media";
      mediaId: string;
      label: string;
    }
  | {
      type: "url";
      url: string;
    };

type OrderedPageMediaItem =
  | {
      id: string;
      kind: "PC";
      label: string;
      file: File;
    }
  | {
      id: string;
      kind: "URL";
      label: string;
      url: string;
    };

type R2Image = {
  key: string;
  url: string;
  sku: string;
  currency: string;
  imageNumber: string;
  lastModified: string;
};

type R2Group = {
  sku: string;
  currency: string;
  count: number;
  images: R2Image[];
};

type R2Response = {
  success: boolean;
  message?: string;
  groups?: R2Group[];
  pagination?: {
    hasMore: boolean;
    nextCursor: string;
    pageSize: number;
  };
};

const MAX_IMAGES = 80;
const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const MIN_SCHEDULE_MINUTES = 10;

const SCHEDULE_TIME_ZONES = [
  { value: "Asia/Karachi", label: "Pakistan — Asia/Karachi" },
  { value: "Asia/Qatar", label: "Qatar — Asia/Qatar" },
  { value: "Asia/Dubai", label: "UAE — Asia/Dubai" },
  { value: "Europe/London", label: "United Kingdom — Europe/London" },
  { value: "America/New_York", label: "USA — America/New_York" },
  { value: "Australia/Sydney", label: "Australia — Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function getDefaultScheduleDateTime() {
  const date = new Date(Date.now() + 15 * 60 * 1000);
  date.setSeconds(0, 0);

  return toDateTimeLocalValue(date);
}

function getTimeZoneOffsetMs(
  date: Date,
  timeZone: string
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return representedAsUtc - date.getTime();
}

function zonedDateTimeToUnixSeconds(
  value: string,
  timeZone: string
) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  );

  if (!match) {
    throw new Error("Schedule date aur time valid select karein.");
  }

  const [, year, month, day, hour, minute] = match;

  const baseUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0
  );

  let resolvedUtc = baseUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(
      new Date(resolvedUtc),
      timeZone
    );
    const nextUtc = baseUtc - offset;

    if (nextUtc === resolvedUtc) {
      break;
    }

    resolvedUtc = nextUtc;
  }

  return Math.floor(resolvedUtc / 1000);
}

function resolveScheduledPublishTime(
  mode: "now" | "schedule",
  dateTimeValue: string,
  timeZone: string
) {
  if (mode === "now") {
    return undefined;
  }

  const scheduledPublishTime =
    zonedDateTimeToUnixSeconds(
      dateTimeValue,
      timeZone
    );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const minimumSeconds =
    nowSeconds + MIN_SCHEDULE_MINUTES * 60;

  const maximumDate = new Date();
  maximumDate.setUTCMonth(
    maximumDate.getUTCMonth() + 6
  );
  const maximumSeconds = Math.floor(
    maximumDate.getTime() / 1000
  );

  if (scheduledPublishTime < minimumSeconds) {
    throw new Error(
      `Schedule time kam az kam ${MIN_SCHEDULE_MINUTES} minutes future mein honi chahiye.`
    );
  }

  if (scheduledPublishTime > maximumSeconds) {
    throw new Error(
      "Schedule time maximum 6 months future tak ho sakti hai."
    );
  }

  return scheduledPublishTime;
}

function formatScheduleDate(
  value: string,
  timeZone: string
) {
  try {
    const timestamp = zonedDateTimeToUnixSeconds(
      value,
      timeZone
    );

    return new Intl.DateTimeFormat("en-PK", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(timestamp * 1000));
  } catch {
    return value;
  }
}

function parseManualUrls(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls));
}

function displayName(image: R2Image) {
  const number = image.imageNumber
    ? ` #${image.imageNumber}`
    : "";

  return `${image.sku || "R2 Image"}${number}`;
}


async function readApiResponse<
  T extends {
    success: boolean;
    message?: string;
  }
>(
  response: Response
): Promise<T> {
  const rawResponse =
    await response.text();

  if (!rawResponse.trim()) {
    return {
      success: false,
      message:
        `Server returned an empty response ` +
        `(HTTP ${response.status}).`,
    } as T;
  }

  try {
    return JSON.parse(
      rawResponse
    ) as T;
  } catch {
    const cleanMessage = rawResponse
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);

    return {
      success: false,
      message:
        cleanMessage ||
        `Server returned a non-JSON response ` +
        `(HTTP ${response.status}).`,
    } as T;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (
    item: T,
    index: number
  ) => Promise<R>
) {
  if (items.length === 0) {
    return [] as R[];
  }

  const results =
    new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(
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

  return results;
}

export default function FacebookPostPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [publishMode, setPublishMode] =
    useState<"now" | "schedule">("now");
  const [scheduleDateTime, setScheduleDateTime] =
    useState(getDefaultScheduleDateTime);
  const [scheduleTimeZone, setScheduleTimeZone] =
    useState("Asia/Karachi");
  const [autoShuffleImages, setAutoShuffleImages] =
    useState(true);
  const [manualUrlsText, setManualUrlsText] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [selectedVideo, setSelectedVideo] =
    useState<SelectedVideo | null>(null);
  const [videoUrlText, setVideoUrlText] = useState("");
  const [videoPosition, setVideoPosition] =
    useState<VideoPosition>("last");
  const [loadingPages, setLoadingPages] = useState(true);
  const [posting, setPosting] = useState(false);
  const [postingProgress, setPostingProgress] =
    useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<PostResult[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");

  const [r2Open, setR2Open] = useState(false);
  const [r2Loading, setR2Loading] = useState(false);
  const [r2LoadingMore, setR2LoadingMore] = useState(false);
  const [r2Images, setR2Images] = useState<R2Image[]>([]);
  const [r2Search, setR2Search] = useState("");
  const [r2Cursor, setR2Cursor] = useState("");
  const [r2HasMore, setR2HasMore] = useState(false);
  const [r2Draft, setR2Draft] = useState<SelectedImage[]>([]);

  useEffect(() => {
    async function loadPages() {
      setLoadingPages(true);
      setError("");

      try {
        const response = await fetch("/api/facebook/pages", {
          cache: "no-store",
        });
        const data: PagesResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Facebook Pages load nahi ho sake."
          );
        }

        const activePages = (data.pages || []).filter(
          (page) => page.active
        );

        setPages(activePages);
        setSelectedPageIds(
          activePages
            .filter((page) => page.isDefault)
            .map((page) => page.id)
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Facebook Pages load nahi ho sake."
        );
      } finally {
        setLoadingPages(false);
      }
    }

    void loadPages();
  }, []);

  const manualUrls = useMemo(
    () => uniqueUrls(parseManualUrls(manualUrlsText)),
    [manualUrlsText]
  );

  const pcImages = useMemo(
    () =>
      selectedImages.filter(
        (image) =>
          image.source === "PC" &&
          Boolean(image.file)
      ),
    [selectedImages]
  );

  const selectedUrlImages = useMemo(
    () =>
      selectedImages
        .filter((image) => image.source === "R2")
        .map((image) => image.url),
    [selectedImages]
  );

  const extraManualUrls = useMemo(() => {
    const selectedUrls = new Set(selectedUrlImages);

    return manualUrls.filter(
      (url) => !selectedUrls.has(url)
    );
  }, [manualUrls, selectedUrlImages]);

  const allImageUrls = useMemo(
    () =>
      uniqueUrls([
        ...selectedUrlImages,
        ...extraManualUrls,
      ]),
    [extraManualUrls, selectedUrlImages]
  );

  const totalImageCount =
    pcImages.length + allImageUrls.length;

  const cleanVideoUrl = videoUrlText.trim();
  const publicVideo = useMemo<SelectedVideo | null>(() => {
    if (!cleanVideoUrl) return null;

    return {
      id: `video-url-${cleanVideoUrl}`,
      url: cleanVideoUrl,
      name: cleanVideoUrl.split("/").pop() || "Public video URL",
      source: "URL",
    };
  }, [cleanVideoUrl]);

  const activeVideo = selectedVideo || publicVideo;
  const hasVideo = Boolean(activeVideo);

  const allSelected =
    pages.length > 0 && selectedPageIds.length === pages.length;

  const filteredR2Images = useMemo(() => {
    const query = r2Search.trim().toLowerCase();

    if (!query) return r2Images;

    return r2Images.filter((image) =>
      [
        image.sku,
        image.currency,
        image.imageNumber,
        image.key,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [r2Images, r2Search]);

  function togglePage(recordId: string) {
    setSelectedPageIds((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId]
    );
  }

  function toggleAll() {
    setSelectedPageIds(
      allSelected ? [] : pages.map((page) => page.id)
    );
  }

  function removeImage(id: string) {
    setSelectedImages((current) => {
      const removed = current.find(
        (image) => image.id === id
      );

      if (
        removed?.source === "PC" &&
        removed.url.startsWith("blob:")
      ) {
        URL.revokeObjectURL(removed.url);
      }

      return current.filter(
        (image) => image.id !== id
      );
    });
  }

  function moveImage(index: number, direction: -1 | 1) {
    setSelectedImages((current) => {
      const target = index + direction;

      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handlePcFiles(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(
      event.target.files || []
    );
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    setNotice("");
    setError("");

    const available =
      MAX_IMAGES - totalImageCount;

    if (available <= 0) {
      setError(
        `Maximum ${MAX_IMAGES} images allowed hain.`
      );
      return;
    }

    if (files.length > available) {
      setError(
        `Sirf ${available} aur image(s) add ho sakti hain. ` +
          `Maximum ${MAX_IMAGES} images allowed hain.`
      );
      return;
    }

    const invalid = files.find(
      (file) =>
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
        ].includes(file.type) ||
        file.size > 20 * 1024 * 1024
    );

    if (invalid) {
      setError(
        `${invalid.name}: only JPG, PNG or WebP ` +
          `up to 20 MB allowed hai.`
      );
      return;
    }

    const additions: SelectedImage[] =
      files.map((file) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        name: file.name,
        source: "PC",
        file,
      }));

    setSelectedImages((current) => [
      ...current,
      ...additions,
    ]);

    setNotice(
      `${additions.length} PC image(s) selected. ` +
        `Ye R2 par upload nahi hongi; Post button par ` +
        `direct Facebook ko bheji jayengi.`
    );
  }

  function removeVideo() {
    setSelectedVideo((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }

      return null;
    });
    setVideoUrlText("");
  }

  function handleVideoFile(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setNotice("");
    setError("");

    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      setError(
        `${file.name}: only MP4, MOV or WebM video allowed hai.`
      );
      return;
    }

    if (file.size > MAX_VIDEO_FILE_SIZE) {
      setError(
        `${file.name}: maximum video size 100 MB hai.`
      );
      return;
    }

    if (selectedVideo?.url.startsWith("blob:")) {
      URL.revokeObjectURL(selectedVideo.url);
    }

    setVideoUrlText("");
    setSelectedVideo({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      name: file.name,
      source: "PC",
      file,
    });
    setNotice(
      `${file.name} video selected. Facebook API image aur video ko ` +
        `ek mixed carousel mein reliably publish nahi karti; ERP selected ` +
        `position ke mutabiq video aur image carousel ko consecutive posts banayega.`
    );
  }

  function handleVideoUrlChange(value: string) {
    setError("");

    if (selectedVideo?.url.startsWith("blob:")) {
      URL.revokeObjectURL(selectedVideo.url);
    }

    setSelectedVideo(null);
    setVideoUrlText(value);
  }

  const loadR2Images = useCallback(
    async (append = false) => {
      append ? setR2LoadingMore(true) : setR2Loading(true);
      setError("");

      try {
        const params = new URLSearchParams({ limit: "300" });

        if (append && r2Cursor) {
          params.set("cursor", r2Cursor);
        }

        const response = await fetch(
          `/api/r2/images?${params.toString()}`,
          { cache: "no-store" }
        );
        const data: R2Response = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Cloud R2 images load nahi ho saken."
          );
        }

        const incoming = (data.groups || []).flatMap(
          (group) => group.images || []
        );

        setR2Images((current) => {
          const combined = append
            ? [...current, ...incoming]
            : incoming;
          const map = new Map(
            combined.map((image) => [image.key, image])
          );

          return Array.from(map.values());
        });
        setR2Cursor(data.pagination?.nextCursor || "");
        setR2HasMore(Boolean(data.pagination?.hasMore));
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Cloud R2 images load nahi ho saken."
        );
      } finally {
        setR2Loading(false);
        setR2LoadingMore(false);
      }
    },
    [r2Cursor]
  );

  function openR2Picker() {
    setR2Draft(
      selectedImages.filter((image) => image.source === "R2")
    );
    setR2Open(true);

    if (r2Images.length === 0) {
      void loadR2Images(false);
    }
  }

  function toggleR2Image(image: R2Image) {
    setR2Draft((current) => {
      const exists = current.some(
        (item) => item.url === image.url
      );

      if (exists) {
        return current.filter(
          (item) => item.url !== image.url
        );
      }

      const nonR2Count = selectedImages.filter(
        (item) => item.source !== "R2"
      ).length;
      const remainingManual = manualUrls.filter(
        (url) =>
          !selectedImages.some((item) => item.url === url)
      ).length;

      if (
        nonR2Count + remainingManual + current.length >=
        MAX_IMAGES
      ) {
        setError(`Maximum ${MAX_IMAGES} images allowed hain.`);
        return current;
      }

      return [
        ...current,
        {
          id: image.key,
          key: image.key,
          url: image.url,
          name: displayName(image),
          source: "R2",
        },
      ];
    });
  }

  function applyR2Selection() {
    setSelectedImages((current) => [
      ...current.filter((image) => image.source !== "R2"),
      ...r2Draft,
    ]);
    setR2Open(false);
    setNotice(
      `${r2Draft.length} Cloud R2 image(s) selected.`
    );
  }

  async function handlePost() {
    setNotice("");
    setError("");
    setResults([]);
    setPostingProgress("");

    if (selectedPageIds.length === 0) {
      setError("Kam az kam ek Facebook Page select karein.");
      return;
    }

    if (totalImageCount > MAX_IMAGES) {
      setError(`Maximum ${MAX_IMAGES} images allowed hain.`);
      return;
    }

    if (
      activeVideo?.source === "URL" &&
      !/^https:\/\//i.test(activeVideo.url)
    ) {
      setError("Public video URL valid HTTPS URL honi chahiye.");
      return;
    }

    if (!message.trim() && totalImageCount === 0 && !hasVideo) {
      setError(
        "Caption, image ya video mein se kam az kam ek required hai."
      );
      return;
    }

    let scheduledPublishTime: number | undefined;

    try {
      scheduledPublishTime = resolveScheduledPublishTime(
        publishMode,
        scheduleDateTime,
        scheduleTimeZone
      );
    } catch (scheduleError) {
      setError(
        scheduleError instanceof Error
          ? scheduleError.message
          : "Schedule date aur time invalid hai."
      );
      return;
    }

    const shuffleKey = crypto.randomUUID();
    setPosting(true);

    try {
      // Keep the existing fast URL-only image flow when no video is selected.
      if (!hasVideo && pcImages.length === 0) {
        setPostingProgress(
          scheduledPublishTime
            ? "Scheduling selected R2/URL images..."
            : "Publishing selected R2/URL images..."
        );

        const response = await fetch("/api/facebook/post", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageRecordIds: selectedPageIds,
            message: message.trim(),
            imageUrls: allImageUrls,
            scheduledPublishTime,
            autoShuffleImages,
            shuffleKey,
          }),
        });

        const data = await readApiResponse<PostResponse>(response);

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Facebook post failed.");
        }

        const nextResults = data.results || [];
        setResults(nextResults);
        setNotice(data.message || "Facebook posting complete.");

        if (
          nextResults.length > 0 &&
          nextResults.every((result) => result.success)
        ) {
          setMessage("");
          setManualUrlsText("");
          setSelectedImages([]);
          setPublishMode("now");
          setScheduleDateTime(getDefaultScheduleDateTime());
        }

        return;
      }

      const nextResults: PostResult[] = [];

      const originalPageMedia: OrderedPageMediaItem[] = [
        ...selectedImages.map((image): OrderedPageMediaItem => {
          if (image.source === "PC") {
            if (!image.file) {
              throw new Error(`${image.name}: PC file missing hai.`);
            }

            return {
              id: image.id,
              kind: "PC",
              label: image.name,
              file: image.file,
            };
          }

          return {
            id: image.id,
            kind: "URL",
            label: image.name,
            url: image.url,
          };
        }),
        ...extraManualUrls.map(
          (url, index): OrderedPageMediaItem => ({
            id: `manual-url-${index}-${url}`,
            kind: "URL",
            label: url,
            url,
          })
        ),
      ];

      for (
        let pageIndex = 0;
        pageIndex < selectedPageIds.length;
        pageIndex += 1
      ) {
        const pageRecordId = selectedPageIds[pageIndex];
        const selectedPage = pages.find(
          (page) => page.id === pageRecordId
        );

        const orderedPageMedia = shuffleFacebookImagesForPage(
          originalPageMedia,
          {
            enabled: autoShuffleImages,
            seed: shuffleKey,
            pageIndex,
          }
        );

        try {
          async function publishImages(
            publishTime?: number
          ): Promise<PostResult | null> {
            if (orderedPageMedia.length === 0) return null;

            const publishMedia: DirectPublishMediaItem[] = [];

            for (
              let mediaIndex = 0;
              mediaIndex < orderedPageMedia.length;
              mediaIndex += 1
            ) {
              const item = orderedPageMedia[mediaIndex];

              setPostingProgress(
                `Page ${pageIndex + 1}/${selectedPageIds.length}: ` +
                  `uploading image ${mediaIndex + 1}/${orderedPageMedia.length}...`
              );

              let uploadResponse: Response;

              if (item.kind === "PC") {
                uploadResponse = await fetch(
                  "/api/facebook/post/direct",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/octet-stream",
                      "X-Facebook-Action": "upload",
                      "X-Facebook-Page-Record-Id": pageRecordId,
                      "X-Facebook-File-Name": encodeURIComponent(
                        item.label
                      ),
                      "X-Facebook-File-Type": item.file.type,
                      "X-Facebook-File-Size": String(item.file.size),
                    },
                    body: item.file,
                  }
                );
              } else {
                uploadResponse = await fetch(
                  "/api/facebook/post/direct",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Facebook-Action": "upload-url",
                    },
                    body: JSON.stringify({
                      pageRecordId,
                      url: item.url,
                      label: item.label,
                    }),
                  }
                );
              }

              const uploadData =
                await readApiResponse<DirectUploadResponse>(uploadResponse);

              if (
                !uploadResponse.ok ||
                !uploadData.success ||
                !uploadData.mediaId
              ) {
                throw new Error(
                  uploadData.message ||
                    `${item.label}: Facebook image upload failed.`
                );
              }

              publishMedia.push({
                type: "media",
                mediaId: uploadData.mediaId,
                label: item.label,
              });
            }

            setPostingProgress(
              `Page ${pageIndex + 1}/${selectedPageIds.length}: ` +
                (publishTime
                  ? "scheduling image post..."
                  : "publishing image post...")
            );

            const response = await fetch(
              "/api/facebook/post/direct",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Facebook-Action": "publish",
                },
                body: JSON.stringify({
                  pageRecordId,
                  message: message.trim(),
                  media: publishMedia,
                  scheduledPublishTime: publishTime,
                  autoShuffleImages: false,
                  shuffleKey,
                  shufflePageIndex: pageIndex,
                }),
              }
            );

            const data =
              await readApiResponse<DirectPublishResponse>(response);

            if (!response.ok || !data.success || !data.result) {
              throw new Error(
                data.message || "Final Facebook image publish failed."
              );
            }

            if (!data.result.success) {
              throw new Error(
                data.result.message || "Facebook image post failed."
              );
            }

            return data.result;
          }

          async function publishVideo(
            publishTime?: number
          ): Promise<PostResult | null> {
            if (!activeVideo) return null;

            setPostingProgress(
              `Page ${pageIndex + 1}/${selectedPageIds.length}: ` +
                (publishTime
                  ? "uploading and scheduling video..."
                  : "uploading and publishing video...")
            );

            let response: Response;

            if (activeVideo.source === "PC") {
              if (!activeVideo.file) {
                throw new Error(`${activeVideo.name}: video file missing hai.`);
              }

              response = await fetch(
                "/api/facebook/post/direct",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/octet-stream",
                    "X-Facebook-Action": "video-publish",
                    "X-Facebook-Page-Record-Id": pageRecordId,
                    "X-Facebook-File-Name": encodeURIComponent(
                      activeVideo.name
                    ),
                    "X-Facebook-File-Type": activeVideo.file.type,
                    "X-Facebook-File-Size": String(
                      activeVideo.file.size
                    ),
                    "X-Facebook-Message": encodeURIComponent(
                      message.trim()
                    ),
                    "X-Facebook-Scheduled-Publish-Time": publishTime
                      ? String(publishTime)
                      : "",
                  },
                  body: activeVideo.file,
                }
              );
            } else {
              response = await fetch(
                "/api/facebook/post/direct",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Facebook-Action": "video-publish-url",
                  },
                  body: JSON.stringify({
                    pageRecordId,
                    url: activeVideo.url,
                    label: activeVideo.name,
                    message: message.trim(),
                    scheduledPublishTime: publishTime,
                  }),
                }
              );
            }

            const data =
              await readApiResponse<DirectPublishResponse>(response);

            if (!response.ok || !data.success || !data.result) {
              throw new Error(
                data.message || "Facebook video publish failed."
              );
            }

            if (!data.result.success) {
              throw new Error(
                data.result.message || "Facebook video post failed."
              );
            }

            return data.result;
          }

          const mixedPosts =
            Boolean(activeVideo) && orderedPageMedia.length > 0;
          const secondPublishTime = scheduledPublishTime
            ? scheduledPublishTime + 60
            : undefined;

          let imageResult: PostResult | null = null;
          let videoResult: PostResult | null = null;

          if (mixedPosts && videoPosition === "first") {
            videoResult = await publishVideo(scheduledPublishTime);
            imageResult = await publishImages(secondPublishTime);
          } else if (mixedPosts) {
            imageResult = await publishImages(scheduledPublishTime);
            videoResult = await publishVideo(secondPublishTime);
          } else if (activeVideo) {
            videoResult = await publishVideo(scheduledPublishTime);
          } else {
            imageResult = await publishImages(scheduledPublishTime);
          }

          const completed = [imageResult, videoResult].filter(
            (result): result is PostResult => Boolean(result)
          );

          const orderLabels = [
            ...(videoPosition === "first" && activeVideo
              ? [`[Video] ${activeVideo.name}`]
              : []),
            ...orderedPageMedia.map((item) => item.label),
            ...(videoPosition === "last" && activeVideo
              ? [`[Video] ${activeVideo.name}`]
              : []),
          ];

          nextResults.push({
            recordId: pageRecordId,
            pageName:
              completed[0]?.pageName ||
              selectedPage?.pageName ||
              "Unknown Page",
            pageId:
              completed[0]?.pageId || selectedPage?.pageId || "",
            success: completed.length > 0,
            facebookPostId: completed
              .map((result) => result.facebookPostId)
              .filter(Boolean)
              .join(" | "),
            scheduled: completed.some((result) => result.scheduled),
            scheduledAt: completed
              .map((result) => result.scheduledAt)
              .filter((value): value is string => Boolean(value))
              .sort()[0],
            shuffleApplied:
              autoShuffleImages && orderedPageMedia.length > 1,
            imageOrder: orderLabels,
          });
        } catch (pageError) {
          nextResults.push({
            recordId: pageRecordId,
            pageName: selectedPage?.pageName || "Unknown Page",
            pageId: selectedPage?.pageId || "",
            success: false,
            message:
              pageError instanceof Error
                ? pageError.message
                : "Direct Facebook post failed.",
          });
        }

        setResults([...nextResults]);
      }

      const successful = nextResults.filter(
        (result) => result.success
      ).length;
      const failed = nextResults.length - successful;

      setNotice(
        `${successful} Page(s) par post ho gaya` +
          `${failed ? `, ${failed} failed` : ""}.` +
          (hasVideo && totalImageCount > 0
            ? " Mixed media Facebook par two consecutive posts ke taur par publish hui."
            : "")
      );

      if (
        nextResults.length > 0 &&
        nextResults.every((result) => result.success)
      ) {
        pcImages.forEach((image) => {
          if (image.url.startsWith("blob:")) {
            URL.revokeObjectURL(image.url);
          }
        });

        if (selectedVideo?.url.startsWith("blob:")) {
          URL.revokeObjectURL(selectedVideo.url);
        }

        setMessage("");
        setManualUrlsText("");
        setSelectedImages([]);
        setSelectedVideo(null);
        setVideoUrlText("");
        setVideoPosition("last");
        setPublishMode("now");
        setScheduleDateTime(getDefaultScheduleDateTime());
      }
    } catch (postError) {
      setError(
        postError instanceof Error
          ? postError.message
          : "Facebook post failed."
      );
    } finally {
      setPosting(false);
      setPostingProgress("");
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-700">
            <Share2 size={22} />
          </div>

          <div>
            <h1 className="text-2xl font-black text-slate-900">
              Create Facebook Post
            </h1>
            <p className="text-sm text-slate-500">
              Images ke saath ek PC/public-URL video bhi add karein. Images aur video selected First/Last order mein consecutive Page posts banenge.
            </p>
          </div>
        </div>
      </section>

      {(notice || error) && (
        <section
          className={[
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold",
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          ].join(" ")}
        >
          {error ? (
            <XCircle size={19} className="shrink-0" />
          ) : (
            <CheckCircle2 size={19} className="shrink-0" />
          )}
          <span>{error || notice}</span>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">
                Select Pages
              </h2>
              <p className="text-xs text-slate-500">
                {selectedPageIds.length} of {pages.length} selected
              </p>
            </div>

            <button
              type="button"
              onClick={toggleAll}
              disabled={loadingPages || pages.length === 0}
              className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
            >
              {allSelected ? "Clear All" : "Select All"}
            </button>
          </div>

          {loadingPages ? (
            <div className="grid min-h-40 place-items-center">
              <Loader2
                size={25}
                className="animate-spin text-blue-600"
              />
            </div>
          ) : pages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm font-semibold text-slate-500">
              Koi active Facebook Page nahi mila.
            </div>
          ) : (
            <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
              {pages.map((page) => {
                const checked = selectedPageIds.includes(page.id);

                return (
                  <label
                    key={page.id}
                    className={[
                      "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition",
                      checked
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePage(page.id)}
                      className="h-4 w-4 accent-blue-600"
                    />

                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">
                        {page.pageName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {page.pageId}
                      </p>
                    </div>

                    {page.isDefault && (
                      <span className="ml-auto rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700">
                        Default
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <label className="block space-y-2">
            <span className="text-sm font-black text-slate-700">
              Caption
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Facebook post caption likhein..."
              rows={8}
              className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            />
            <span className="block text-right text-xs font-semibold text-slate-400">
              {message.length} characters
            </span>
          </label>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                <CalendarClock size={19} />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-black text-slate-800">
                  Publishing Time
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Abhi publish karein ya Facebook par native schedule banayein.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPublishMode("now")}
                className={[
                  "rounded-xl border px-4 py-3 text-left transition",
                  publishMode === "now"
                    ? "border-blue-400 bg-blue-50 ring-4 ring-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="block text-sm font-black text-slate-900">
                  Post Now
                </span>
                <span className="mt-1 block text-xs font-semibold text-slate-500">
                  Facebook par foran publish hoga.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setPublishMode("schedule")}
                className={[
                  "rounded-xl border px-4 py-3 text-left transition",
                  publishMode === "schedule"
                    ? "border-violet-400 bg-violet-50 ring-4 ring-violet-50"
                    : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="block text-sm font-black text-slate-900">
                  Schedule Post
                </span>
                <span className="mt-1 block text-xs font-semibold text-slate-500">
                  Selected date aur time par publish hoga.
                </span>
              </button>
            </div>

            {publishMode === "schedule" && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="block text-xs font-black text-slate-600">
                    Schedule Date & Time
                  </span>
                  <input
                    type="datetime-local"
                    value={scheduleDateTime}
                    onChange={(event) =>
                      setScheduleDateTime(event.target.value)
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-xs font-black text-slate-600">
                    Time Zone
                  </span>
                  <select
                    value={scheduleTimeZone}
                    onChange={(event) =>
                      setScheduleTimeZone(event.target.value)
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
                  >
                    {SCHEDULE_TIME_ZONES.map((zone) => (
                      <option
                        key={zone.value}
                        value={zone.value}
                      >
                        {zone.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="md:col-span-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-semibold leading-5 text-violet-800">
                  Scheduled for:{" "}
                  <strong>
                    {formatScheduleDate(
                      scheduleDateTime,
                      scheduleTimeZone
                    )}
                  </strong>
                  . Minimum 10 minutes aur maximum 6 months future.
                </div>
              </div>
            )}
          </section>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-black text-slate-700">
                  <ImagePlus size={17} />
                  Post Images
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {totalImageCount} of {MAX_IMAGES} images ready
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handlePcFiles}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={totalImageCount >= MAX_IMAGES}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                >
                  <MonitorUp size={17} />
                  Select from PC — Direct
                </button>

                <button
                  type="button"
                  onClick={openR2Picker}
                  disabled={totalImageCount >= MAX_IMAGES}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  <Cloud size={17} />
                  Select from Cloud R2
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <input
                type="checkbox"
                checked={autoShuffleImages}
                onChange={(event) =>
                  setAutoShuffleImages(event.target.checked)
                }
                className="mt-1 h-4 w-4 rounded border-violet-300 text-violet-600"
              />
              <Shuffle size={18} className="mt-0.5 shrink-0 text-violet-700" />
              <span>
                <span className="block text-sm font-black text-violet-900">
                  Auto-shuffle images for each Page
                </span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-violet-700">
                  Single Page select ho tab bhi 2+ images ka original order kabhi use nahi hoga. Multiple Pages ko alag order milega jab enough unique combinations available hon.
                </span>
              </span>
            </label>

            {selectedImages.length === 0 ? (
              <div className="grid min-h-36 place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 text-center">
                <div>
                  <Images
                    size={30}
                    className="mx-auto text-slate-300"
                  />
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    PC/R2 images select karein. Video neeche separate optional section se add ho sakti hai.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {selectedImages.map((image, index) => (
                  <article
                    key={image.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewUrl(image.url)}
                      className="block aspect-square w-full bg-slate-100"
                      title="Open preview"
                    >
                      <img
                        src={image.url}
                        alt={image.name}
                        className="h-full w-full object-cover"
                      />
                    </button>

                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={[
                            "rounded-full px-2 py-1 text-[10px] font-black",
                            image.source === "PC"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-700",
                          ].join(" ")}
                        >
                          {image.source === "PC"
                            ? "PC DIRECT"
                            : "R2"}
                        </span>
                        <span className="text-xs font-black text-slate-400">
                          #{index + 1}
                        </span>
                      </div>

                      <p
                        className="truncate text-xs font-bold text-slate-700"
                        title={image.name}
                      >
                        {image.name}
                      </p>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveImage(index, -1)}
                          disabled={index === 0}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30"
                          title="Move left"
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(index, 1)}
                          disabled={index === selectedImages.length - 1}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30"
                          title="Move right"
                        >
                          <ArrowRight size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage(image.id)}
                          className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          title="Remove image"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-black text-sky-900">
                  <Film size={17} />
                  Post Video — Optional
                </h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-sky-700">
                  Maximum one MP4, MOV or WebM video. Images aur video ek mixed carousel nahi; consecutive Facebook posts honge.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={handleVideoFile}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={posting}
                  className="inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-sm font-black text-sky-700 disabled:opacity-50"
                >
                  <MonitorUp size={17} />
                  Select Video from PC
                </button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label>
                <span className="mb-1 block text-xs font-black uppercase text-sky-800">
                  Public video URL — optional alternative
                </span>
                <input
                  value={videoUrlText}
                  onChange={(event) =>
                    handleVideoUrlChange(event.target.value)
                  }
                  disabled={Boolean(selectedVideo) || posting}
                  placeholder="https://.../video.mp4"
                  className="h-11 w-full rounded-xl border border-sky-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-500 disabled:bg-slate-100"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-black uppercase text-sky-800">
                  Video Position
                </span>
                <select
                  value={videoPosition}
                  onChange={(event) =>
                    setVideoPosition(event.target.value as VideoPosition)
                  }
                  disabled={!hasVideo || posting}
                  className="h-11 w-full rounded-xl border border-sky-200 bg-white px-3 text-sm font-black outline-none focus:border-sky-500 disabled:bg-slate-100"
                >
                  <option value="first">Video First</option>
                  <option value="last">Video Last</option>
                </select>
              </label>
            </div>

            {activeVideo && (
              <article className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
                <div className="grid gap-4 p-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
                  <video
                    src={activeVideo.url}
                    controls
                    preload="metadata"
                    className="aspect-video w-full rounded-xl bg-black object-contain"
                  />

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black text-sky-700">
                        {activeVideo.source === "PC" ? "PC VIDEO" : "VIDEO URL"}
                      </span>
                      <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700">
                        {videoPosition === "first" ? "FIRST POST" : "LAST POST"}
                      </span>
                    </div>

                    <p className="mt-2 truncate text-sm font-black text-slate-800" title={activeVideo.name}>
                      {activeVideo.name}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      Same caption video aur image post dono par use hogi. Scheduled mixed posts ke darmiyan 60 seconds ka gap hoga.
                    </p>

                    <button
                      type="button"
                      onClick={removeVideo}
                      disabled={posting}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <X size={14} />
                      Remove Video
                    </button>
                  </div>
                </div>
              </article>
            )}
          </section>

          <details className="rounded-2xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
              Manual public image URLs — optional
            </summary>
            <div className="border-t border-slate-200 p-4">
              <textarea
                value={manualUrlsText}
                onChange={(event) =>
                  setManualUrlsText(event.target.value)
                }
                placeholder={
                  "Har line par ek public image URL paste karein.\nhttps://.../image-1.jpg"
                }
                rows={4}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
              />
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Manual URLs bhi total {MAX_IMAGES} image limit mein count hongi.
              </p>
            </div>
          </details>

          {postingProgress && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
              {postingProgress}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handlePost()}
            disabled={
              posting ||
              loadingPages ||
              pages.length === 0
            }
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {posting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
            {posting
              ? publishMode === "schedule"
                ? `Scheduling on ${selectedPageIds.length} Pages...`
                : `Posting on ${selectedPageIds.length} Pages...`
              : publishMode === "schedule"
                ? `Schedule on ${selectedPageIds.length} Pages`
                : `Post on ${selectedPageIds.length} Pages`}
          </button>
        </section>
      </div>

      {results.length > 0 && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-7">
            <h2 className="text-lg font-black text-slate-900">
              Post Results
            </h2>
          </div>

          <div className="divide-y divide-slate-100">
            {results.map((result) => (
              <article
                key={result.recordId}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"
              >
                <div>
                  <p className="font-black text-slate-900">
                    {result.pageName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {result.pageId}
                  </p>
                </div>

                <div
                  className={[
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black",
                    result.scheduled
                      ? "bg-violet-50 text-violet-700"
                      : result.success
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700",
                  ].join(" ")}
                >
                  {result.scheduled ? (
                    <CalendarClock size={17} />
                  ) : result.success ? (
                    <CheckCircle2 size={17} />
                  ) : (
                    <XCircle size={17} />
                  )}
                  {result.scheduled
                    ? `Scheduled${
                        result.scheduledAt
                          ? ` · ${new Date(
                              result.scheduledAt
                            ).toLocaleString("en-PK")}`
                          : ""
                      }`
                    : result.success
                      ? `Posted${
                          result.facebookPostId
                            ? ` · ${result.facebookPostId}`
                            : ""
                        }`
                      : result.message || "Failed"}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {r2Open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Select Images from Cloud R2
                </h2>
                <p className="text-xs font-semibold text-slate-500">
                  {r2Draft.length} image(s) selected
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadR2Images(false)}
                  disabled={r2Loading}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-700"
                  title="Refresh R2 images"
                >
                  <RefreshCw
                    size={17}
                    className={r2Loading ? "animate-spin" : ""}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setR2Open(false)}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700"
                  aria-label="Close R2 image picker"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="border-b border-slate-200 p-4 sm:p-5">
              <label className="relative block">
                <Search
                  size={17}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={r2Search}
                  onChange={(event) => setR2Search(event.target.value)}
                  placeholder="Search SKU, currency or image number..."
                  className="h-11 w-full rounded-xl border border-slate-200 pl-11 pr-4 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {r2Loading ? (
                <div className="grid min-h-64 place-items-center">
                  <Loader2
                    size={30}
                    className="animate-spin text-emerald-600"
                  />
                </div>
              ) : filteredR2Images.length === 0 ? (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <Cloud
                      size={38}
                      className="mx-auto text-slate-300"
                    />
                    <p className="mt-3 font-bold text-slate-500">
                      Koi matching R2 image nahi mili.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {filteredR2Images.map((image) => {
                    const checked = r2Draft.some(
                      (item) => item.url === image.url
                    );

                    return (
                      <button
                        type="button"
                        key={image.key}
                        onClick={() => toggleR2Image(image)}
                        className={[
                          "group relative overflow-hidden rounded-2xl border-2 bg-slate-100 text-left transition",
                          checked
                            ? "border-emerald-500 ring-4 ring-emerald-100"
                            : "border-transparent hover:border-slate-300",
                        ].join(" ")}
                      >
                        <div className="aspect-square">
                          <img
                            src={image.url}
                            alt={displayName(image)}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>

                        <div className="bg-white p-2">
                          <p className="truncate text-xs font-black text-slate-800">
                            {image.sku || "R2 Image"}
                          </p>
                          <p className="truncate text-[10px] font-bold text-slate-500">
                            {image.currency || "-"}
                            {image.imageNumber
                              ? ` · #${image.imageNumber}`
                              : ""}
                          </p>
                        </div>

                        {checked && (
                          <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white shadow-lg">
                            <Check size={16} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {r2HasMore && !r2Search && (
                <div className="mt-5 text-center">
                  <button
                    type="button"
                    onClick={() => void loadR2Images(true)}
                    disabled={r2LoadingMore}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-black text-emerald-700 disabled:opacity-50"
                  >
                    {r2LoadingMore && (
                      <Loader2 size={16} className="animate-spin" />
                    )}
                    Load More Images
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <p className="text-sm font-bold text-slate-500">
                Maximum {MAX_IMAGES} images per Facebook post.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setR2Open(false)}
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-black text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyR2Selection}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white"
                >
                  Use {r2Draft.length} Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/90 p-4"
          onClick={() => setPreviewUrl("")}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl("")}
            className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white text-slate-900"
            aria-label="Close image preview"
          >
            <X size={20} />
          </button>
          <img
            src={previewUrl}
            alt="Selected image preview"
            className="max-h-[92vh] max-w-[94vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}
