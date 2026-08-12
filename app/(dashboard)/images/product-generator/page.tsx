"use client";

import Link from "next/link";
import {
  Check,
  CloudUpload,
  Download,
  FolderInput,
  FolderOpen,
  ImageIcon,
  Loader2,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_PRODUCT_IMAGE_DETAILS,
  FreeDeliveryBadgeSize,
  ProductCurrency,
  ProductImageDetails,
  ProductImageOutput,
  ProductImageSource,
  createProductImageSource,
  downloadProductImage,
  generateProductImage,
  releaseProductImageOutput,
  releaseProductImageSource,
} from "@/lib/product-image-generator";

const MAX_SOURCE_IMAGES = 250;
const UPLOAD_CHUNK_BYTES =
  3.25 * 1024 * 1024;
const UPLOAD_CHUNK_FILES = 20;

type DirectoryWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type DirectoryFileHandle = {
  createWritable(): Promise<DirectoryWritable>;
};

type DirectoryHandle = {
  getDirectoryHandle(
    name: string,
    options: { create: boolean },
  ): Promise<DirectoryHandle>;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<DirectoryFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
};

type ProductJob = {
  id: string;
  folderName: string;
  sources: ProductImageSource[];
  details: ProductImageDetails;
  createdAt: number;
};

type GeneratedOutput = ProductImageOutput & {
  jobId: string;
  jobLabel: string;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(
      Math.log(bytes) / Math.log(1024),
    ),
    units.length - 1,
  );

  return `${(
    bytes /
    1024 ** index
  ).toFixed(index === 0 ? 0 : 1)} ${
    units[index]
  }`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

function uploadChunks(
  outputs: GeneratedOutput[],
) {
  const chunks: GeneratedOutput[][] = [];
  let current: GeneratedOutput[] = [];
  let currentBytes = 0;

  for (const output of outputs) {
    const overflow =
      current.length > 0 &&
      (current.length >= UPLOAD_CHUNK_FILES ||
        currentBytes + output.size >
          UPLOAD_CHUNK_BYTES);

    if (overflow) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(output);
    currentBytes += output.size;
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

function currencyButtonClass(
  selected: boolean,
) {
  return [
    "flex min-h-14 items-center justify-between rounded-2xl border px-4 text-sm font-black transition",
    selected
      ? "border-blue-600 bg-blue-50 text-blue-800"
      : "border-slate-200 bg-white text-slate-500",
  ].join(" ");
}

function createEmptyDetails() {
  return {
    ...DEFAULT_PRODUCT_IMAGE_DETAILS,
    currencies: [
      ...DEFAULT_PRODUCT_IMAGE_DETAILS.currencies,
    ],
  };
}

function cloneDetails(
  details: ProductImageDetails,
): ProductImageDetails {
  return {
    ...details,
    currencies: [...details.currencies],
  };
}

function badgeSizeLabel(
  value: FreeDeliveryBadgeSize,
) {
  if (value === "small") return "Small";
  if (value === "medium") return "Medium";
  if (value === "large") return "Large";
  return "Extra Large";
}

export default function ProductImageGeneratorPage() {
  const folderInputRef =
    useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");
  const ownedSourceIdsRef =
    useRef<Set<string>>(new Set());

  const [currentSources, setCurrentSources] =
    useState<ProductImageSource[]>([]);
  const [currentFolderName, setCurrentFolderName] =
    useState("");
  const [details, setDetails] =
    useState<ProductImageDetails>(
      createEmptyDetails(),
    );
  const [jobs, setJobs] = useState<
    ProductJob[]
  >([]);
  const [editingJobId, setEditingJobId] =
    useState("");
  const [activePreviewJobId, setActivePreviewJobId] =
    useState<"current" | string>("current");
  const [activeSourceId, setActiveSourceId] =
    useState("");
  const [previewCurrency, setPreviewCurrency] =
    useState<ProductCurrency>("AED");
  const [previewUrl, setPreviewUrl] =
    useState("");
  const [previewLoading, setPreviewLoading] =
    useState(false);
  const [processing, setProcessing] =
    useState(false);
  const [uploading, setUploading] =
    useState(false);
  const [progress, setProgress] =
    useState(0);
  const [message, setMessage] =
    useState("");

  const [outputs, setOutputs] = useState<
    GeneratedOutput[]
  >([]);

  useEffect(() => {
    folderInputRef.current?.setAttribute(
      "webkitdirectory",
      "",
    );
    folderInputRef.current?.setAttribute(
      "directory",
      "",
    );
  }, []);

  useEffect(() => {
    return () => {
      const released = new Set<string>();

      for (const source of currentSources) {
        if (!released.has(source.id)) {
          releaseProductImageSource(source);
          released.add(source.id);
        }
      }

      for (const job of jobs) {
        for (const source of job.sources) {
          if (!released.has(source.id)) {
            releaseProductImageSource(source);
            released.add(source.id);
          }
        }
      }

      for (const output of outputs) {
        releaseProductImageOutput(output);
      }

      if (previewUrlRef.current) {
        URL.revokeObjectURL(
          previewUrlRef.current,
        );
      }
    };
  }, [currentSources, jobs, outputs]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const previewTarget = useMemo(() => {
    if (activePreviewJobId === "current") {
      return {
        id: "current",
        folderName:
          currentFolderName ||
          "Current Workspace",
        sources: currentSources,
        details,
      };
    }

    return (
      jobs.find(
        (job) => job.id === activePreviewJobId,
      ) || {
        id: "current",
        folderName:
          currentFolderName ||
          "Current Workspace",
        sources: currentSources,
        details,
      }
    );
  }, [
    activePreviewJobId,
    currentFolderName,
    currentSources,
    details,
    jobs,
  ]);

  const previewTargetSources =
    previewTarget.sources;
  const previewTargetDetails =
    previewTarget.details;
  const previewCurrencies =
    previewTargetDetails.currencies;

  useEffect(() => {
    const selectedSource =
      previewTargetSources.find(
        (source) => source.id === activeSourceId,
      ) ||
      previewTargetSources[0] ||
      null;

    if (!selectedSource) {
      setActiveSourceId("");
    } else if (
      !previewTargetSources.some(
        (source) => source.id === activeSourceId,
      )
    ) {
      setActiveSourceId(selectedSource.id);
    }
  }, [activeSourceId, previewTargetSources]);

  useEffect(() => {
    if (
      !previewCurrencies.includes(
        previewCurrency,
      )
    ) {
      setPreviewCurrency(
        previewCurrencies[0] || "AED",
      );
    }
  }, [previewCurrencies, previewCurrency]);

  const selectedPreviewSource =
    previewTargetSources.find(
      (source) => source.id === activeSourceId,
    ) ||
    previewTargetSources[0] ||
    null;

  const currentWorkspaceValid =
    Boolean(currentFolderName) &&
    Boolean(details.sku.trim()) &&
    Boolean(details.size.trim()) &&
    Boolean(details.fabric.trim()) &&
    Boolean(details.price.trim()) &&
    details.currencies.length > 0 &&
    currentSources.length > 0;

  const totalQueuedImages = useMemo(
    () =>
      jobs.reduce(
        (sum, job) => sum + job.sources.length,
        0,
      ),
    [jobs],
  );

  const totalInputBytes = useMemo(() => {
    const currentBytes = currentSources.reduce(
      (sum, source) => sum + source.file.size,
      0,
    );
    const jobBytes = jobs.reduce(
      (sum, job) =>
        sum +
        job.sources.reduce(
          (jobSum, source) =>
            jobSum + source.file.size,
          0,
        ),
      0,
    );
    return currentBytes + jobBytes;
  }, [currentSources, jobs]);

  const totalOutputBytes = useMemo(
    () =>
      outputs.reduce(
        (sum, output) => sum + output.size,
        0,
      ),
    [outputs],
  );

  const expectedOutputCount =
    jobs.reduce(
      (sum, job) =>
        sum +
        job.sources.length *
          job.details.currencies.length,
      0,
    );

  useEffect(() => {
    if (
      !selectedPreviewSource ||
      previewTargetDetails.currencies.length ===
        0 ||
      !previewTargetDetails.sku.trim() ||
      !previewTargetDetails.size.trim() ||
      !previewTargetDetails.fabric.trim() ||
      !previewTargetDetails.price.trim()
    ) {
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return "";
      });
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(
      async () => {
        setPreviewLoading(true);

        try {
          const previewOutput =
            await generateProductImage({
              source: selectedPreviewSource,
              details: previewTargetDetails,
              currency: previewCurrency,
              index:
                previewTargetSources.findIndex(
                  (source) =>
                    source.id ===
                    selectedPreviewSource.id,
                ) + 1,
              previewMaximumSide: 850,
            });

          if (cancelled) {
            releaseProductImageOutput(
              previewOutput,
            );
            return;
          }

          setPreviewUrl((current) => {
            if (current) {
              URL.revokeObjectURL(current);
            }
            return previewOutput.objectUrl;
          });
        } catch (error) {
          if (!cancelled) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Preview failed.",
            );
          }
        } finally {
          if (!cancelled) {
            setPreviewLoading(false);
          }
        }
      },
      250,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedPreviewSource,
    previewTargetDetails,
    previewCurrency,
    previewTargetSources,
  ]);

  function updateDetails(
    patch: Partial<ProductImageDetails>,
  ) {
    setDetails((current) => ({
      ...current,
      ...patch,
    }));
  }

  function toggleCurrency(
    currency: ProductCurrency,
  ) {
    setDetails((current) => {
      const selected =
        current.currencies.includes(currency);

      return {
        ...current,
        currencies: selected
          ? current.currencies.filter(
              (item) => item !== currency,
            )
          : [...current.currencies, currency],
      };
    });
  }

  async function handleFolder(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(
      event.target.files || [],
    )
      .filter((file) =>
        [
          "image/jpeg",
          "image/png",
          "image/webp",
        ].includes(file.type),
      )
      .sort((first, second) =>
        (
          first.webkitRelativePath ||
          first.name
        ).localeCompare(
          second.webkitRelativePath ||
            second.name,
          "en",
          {
            numeric: true,
            sensitivity: "base",
          },
        ),
      )
      .slice(0, MAX_SOURCE_IMAGES);

    if (!files.length) {
      setMessage(
        "Selected folder has no JPG, PNG or WebP images.",
      );
      return;
    }

    setMessage(
      `Reading ${files.length} image(s)...`,
    );

    if (!editingJobId) {
      currentSources.forEach((source) => {
        if (
          ownedSourceIdsRef.current.has(source.id)
        ) {
          releaseProductImageSource(source);
          ownedSourceIdsRef.current.delete(
            source.id,
          );
        }
      });
    }

    const created: ProductImageSource[] = [];
    let failed = 0;

    for (const file of files) {
      try {
        const source =
          await createProductImageSource(file);
        created.push(source);
        ownedSourceIdsRef.current.add(source.id);
      } catch {
        failed += 1;
      }
    }

    const firstRelative =
      files[0]?.webkitRelativePath || "";

    setCurrentFolderName(
      firstRelative
        ? firstRelative.split("/")[0]
        : "Selected Folder",
    );
    setCurrentSources(created);
    setActiveSourceId(created[0]?.id || "");
    setActivePreviewJobId("current");
    setMessage(
      `${created.length} image(s) loaded in current workspace${
        failed
          ? `; ${failed} failed`
          : ""
      }.`,
    );

    event.target.value = "";
  }

  function resetCurrentWorkspace() {
    setCurrentSources([]);
    setCurrentFolderName("");
    setDetails(createEmptyDetails());
    setEditingJobId("");
    setActivePreviewJobId("current");
    setActiveSourceId("");
  }

  function clearCurrentWorkspace() {
    currentSources.forEach((source) => {
      if (
        ownedSourceIdsRef.current.has(source.id)
      ) {
        releaseProductImageSource(source);
        ownedSourceIdsRef.current.delete(
          source.id,
        );
      }
    });

    resetCurrentWorkspace();
    setMessage("");
  }

  function saveCurrentWorkspaceToQueue() {
    if (!currentWorkspaceValid) {
      setMessage(
        "Load a folder and complete SKU, Size, Fabric, Price and market selection first.",
      );
      return;
    }

    const clonedDetails =
      cloneDetails(details);

    if (editingJobId) {
      setJobs((current) =>
        current.map((job) =>
          job.id === editingJobId
            ? {
                ...job,
                folderName: currentFolderName,
                details: clonedDetails,
                sources: currentSources,
              }
            : job,
        ),
      );

      setMessage(
        `Updated queue item: ${currentFolderName}.`,
      );
    } else {
      const newJob: ProductJob = {
        id: crypto.randomUUID(),
        folderName: currentFolderName,
        details: clonedDetails,
        sources: currentSources,
        createdAt: Date.now(),
      };

      setJobs((current) => [...current, newJob]);
      setMessage(
        `Added to queue: ${currentFolderName}.`,
      );
    }

    setEditingJobId("");
    setCurrentSources([]);
    setCurrentFolderName("");
    setDetails(createEmptyDetails());
    setActivePreviewJobId("current");
    setActiveSourceId("");
  }

  function editJob(jobId: string) {
    const job = jobs.find(
      (item) => item.id === jobId,
    );
    if (!job) return;

    setEditingJobId(job.id);
    setCurrentFolderName(job.folderName);
    setCurrentSources(job.sources);
    setDetails(cloneDetails(job.details));
    setActivePreviewJobId("current");
    setActiveSourceId(
      job.sources[0]?.id || "",
    );
    setMessage(
      `Editing queue item: ${job.folderName}`,
    );
  }

  function removeJob(jobId: string) {
    setJobs((current) => {
      const job = current.find(
        (item) => item.id === jobId,
      );

      if (job) {
        if (activePreviewJobId === jobId) {
          setActivePreviewJobId("current");
        }

        if (editingJobId === jobId) {
          resetCurrentWorkspace();
        } else {
          job.sources.forEach((source) => {
            if (
              ownedSourceIdsRef.current.has(
                source.id,
              )
            ) {
              releaseProductImageSource(
                source,
              );
              ownedSourceIdsRef.current.delete(
                source.id,
              );
            }
          });
        }
      }

      return current.filter(
        (item) => item.id !== jobId,
      );
    });
  }

  function clearOutputs() {
    outputs.forEach(
      releaseProductImageOutput,
    );
    setOutputs([]);
    setProgress(0);
  }

  async function generateAll() {
    if (jobs.length === 0) {
      setMessage(
        "Queue is empty. Add one or more product folders first.",
      );
      return;
    }

    setProcessing(true);
    setProgress(0);
    setMessage("");
    clearOutputs();

    const generated: GeneratedOutput[] =
      [];
    const total = jobs.reduce(
      (sum, job) =>
        sum +
        job.sources.length *
          job.details.currencies.length,
      0,
    );

    let completed = 0;
    let failed = 0;

    try {
      for (const job of jobs) {
        for (
          let index = 0;
          index < job.sources.length;
          index += 1
        ) {
          const source = job.sources[index];

          for (const currency of job.details
            .currencies) {
            try {
              const output =
                await generateProductImage({
                  source,
                  details: job.details,
                  currency,
                  index: index + 1,
                });

              generated.push({
                ...output,
                jobId: job.id,
                jobLabel: job.folderName,
              });
            } catch {
              failed += 1;
            }

            completed += 1;
            setProgress(
              Math.round(
                (completed / total) * 100,
              ),
            );
          }
        }
      }

      setOutputs(generated);
      setMessage(
        `${generated.length} product image(s) generated${
          failed
            ? `; ${failed} failed`
            : ""
        }.`,
      );
    } finally {
      setProcessing(false);
    }
  }

  async function downloadAll() {
    if (!outputs.length) {
      setMessage(
        "Generate product images first.",
      );
      return;
    }

    setMessage(
      "Starting downloads. The browser may request permission for multiple files.",
    );

    for (const output of outputs) {
      downloadProductImage(output);
      await delay(120);
    }
  }

  async function saveToFolder() {
    if (!outputs.length) {
      setMessage(
        "Generate product images first.",
      );
      return;
    }

    const picker = (
      window as DirectoryPickerWindow
    ).showDirectoryPicker;

    if (!picker) {
      await downloadAll();
      return;
    }

    try {
      const rootDirectory = await picker();

      for (const job of jobs) {
        const jobDirectory =
          await rootDirectory.getDirectoryHandle(
            job.folderName,
            {
              create: true,
            },
          );

        for (const currency of job.details
          .currencies) {
          const marketDirectory =
            await jobDirectory.getDirectoryHandle(
              currency,
              {
                create: true,
              },
            );

          for (const output of outputs.filter(
            (item) =>
              item.jobId === job.id &&
              item.currency === currency,
          )) {
            const fileHandle =
              await marketDirectory.getFileHandle(
                output.name,
                {
                  create: true,
                },
              );
            const writable =
              await fileHandle.createWritable();

            await writable.write(output.blob);
            await writable.close();
          }
        }
      }

      setMessage(
        `${outputs.length} image(s) saved in folder-wise AED/QAR subfolders.`,
      );
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setMessage(
        error instanceof Error
          ? error.message
          : "Folder save failed.",
      );
    }
  }

  async function uploadToErp() {
    if (!outputs.length) {
      setMessage(
        "Generate product images first.",
      );
      return;
    }

    setUploading(true);
    setMessage("");
    let uploaded = 0;
    let failed = 0;

    try {
      for (const chunk of uploadChunks(
        outputs,
      )) {
        const formData = new FormData();

        for (const output of chunk) {
          formData.append(
            "files",
            new File(
              [output.blob],
              output.name,
              {
                type: "image/jpeg",
              },
            ),
          );
        }

        const response = await fetch(
          "/api/upload/image",
          {
            method: "POST",
            body: formData,
          },
        );

        const data = await response.json();

        uploaded += Number(
          data.uploadedCount || 0,
        );
        failed += Number(
          data.failedCount || 0,
        );

        if (
          !response.ok &&
          !data.uploadedCount
        ) {
          throw new Error(
            data.message ||
              "ERP image upload failed.",
          );
        }
      }

      setMessage(
        `${uploaded} product image(s) uploaded to ERP Images${
          failed
            ? `; ${failed} failed`
            : ""
        }.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ERP image upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-fuchsia-700">
            <PackageOpen size={18} />
            Multi-Folder Product Template
          </div>

          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Product Image Generator
          </h1>

          <p className="mt-1 max-w-5xl text-sm font-bold leading-6 text-slate-500">
            Ab aap ek se zyada product folders
            queue mein bana sakte ho. Har folder ka
            apna SKU, Size, Fabric, Price, AED/QAR
            selection aur Free Delivery settings
            hongi. Sab queue hone ke baad Generate
            All karo.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/images/batch-editor"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700"
          >
            <ImageIcon size={17} />
            Advanced Editor
          </Link>

          <button
            type="button"
            onClick={clearCurrentWorkspace}
            disabled={
              processing ||
              uploading ||
              currentSources.length === 0
            }
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 disabled:opacity-40"
          >
            <Trash2 size={17} />
            Clear Current
          </button>
        </div>
      </header>

      {message && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-black text-blue-800">
          {message}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FolderInput
                size={18}
                className="text-blue-700"
              />
              <h2 className="font-black text-slate-950">
                1. Load Current Folder
              </h2>
            </div>

            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) =>
                void handleFolder(event)
              }
            />

            <button
              type="button"
              onClick={() =>
                folderInputRef.current?.click()
              }
              disabled={processing || uploading}
              className="mt-4 flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 px-4 text-blue-800 transition hover:bg-blue-100 disabled:opacity-50"
            >
              <FolderOpen size={28} />
              <span className="mt-2 font-black">
                {editingJobId
                  ? "Replace Folder in Current Edit"
                  : "Select Folder"}
              </span>
              <span className="mt-1 text-xs font-bold">
                JPG, PNG and WebP
              </span>
            </button>

            {(currentFolderName ||
              currentSources.length > 0) && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white">
                    <Check size={17} />
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-black text-emerald-900">
                      {currentFolderName ||
                        "Current Workspace"}
                    </p>
                    <p className="mt-1 text-xs font-bold text-emerald-700">
                      {currentSources.length} image(s) ·{" "}
                      {formatBytes(
                        currentSources.reduce(
                          (sum, source) =>
                            sum +
                            source.file.size,
                          0,
                        ),
                      )}
                    </p>
                    {editingJobId && (
                      <p className="mt-1 text-[11px] font-black text-emerald-800">
                        Editing existing queue item
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <p className="mt-3 text-[11px] font-bold leading-5 text-slate-400">
              Ek dafa mein ek folder current
              workspace mein load hota hai. Usko
              details ke saath queue mein save
              karke phir agla folder add karo.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">
              2. Current Folder Details
            </h2>

            <div className="mt-4 space-y-4">
              <Field
                label="SKU"
                value={details.sku}
                placeholder="MAF9494"
                onChange={(sku) =>
                  updateDetails({ sku })
                }
              />

              <Field
                label="Size"
                value={details.size}
                placeholder="M to 2XL"
                onChange={(size) =>
                  updateDetails({ size })
                }
              />

              <Field
                label="Fabric"
                value={details.fabric}
                placeholder="Cotton"
                onChange={(fabric) =>
                  updateDetails({ fabric })
                }
              />

              <Field
                label="Price"
                value={details.price}
                placeholder="119"
                inputMode="decimal"
                onChange={(price) =>
                  updateDetails({ price })
                }
              />

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                Price aik dafa enter hoga. Selected
                AED aur QAR versions mein wahi same
                price use hoga. Free Delivery badge
                optional hai.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">
              3. Required Versions
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  toggleCurrency("AED")
                }
                className={currencyButtonClass(
                  details.currencies.includes(
                    "AED",
                  ),
                )}
              >
                <span>AED</span>
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full ${
                    details.currencies.includes(
                      "AED",
                    )
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {details.currencies.includes(
                    "AED",
                  ) && <Check size={14} />}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  toggleCurrency("QAR")
                }
                className={currencyButtonClass(
                  details.currencies.includes(
                    "QAR",
                  ),
                )}
              >
                <span>QAR</span>
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full ${
                    details.currencies.includes(
                      "QAR",
                    )
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {details.currencies.includes(
                    "QAR",
                  ) && <Check size={14} />}
                </span>
              </button>
            </div>

            {details.currencies.length ===
              0 && (
              <p className="mt-3 text-xs font-black text-red-700">
                Select AED, QAR or both.
              </p>
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                Current Folder Expected Output
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {currentSources.length *
                  details.currencies.length}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {currentSources.length} source
                image(s) ×{" "}
                {details.currencies.length} selected
                market(s)
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">
              4. Optional Badge
            </h2>

            <button
              type="button"
              onClick={() =>
                updateDetails({
                  freeDeliveryEnabled:
                    !details.freeDeliveryEnabled,
                })
              }
              className={`mt-4 flex min-h-16 w-full items-center justify-between rounded-2xl border px-4 text-left text-sm font-black transition ${
                details.freeDeliveryEnabled
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <div>
                <p>Free Delivery</p>
                <p className="mt-1 text-xs font-bold opacity-80">
                  Tick karne par image par Free
                  Delivery logo show hoga.
                </p>
              </div>

              <span
                className={`grid h-7 w-7 place-items-center rounded-full ${
                  details.freeDeliveryEnabled
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {details.freeDeliveryEnabled && (
                  <Check size={15} />
                )}
              </span>
            </button>

            {details.freeDeliveryEnabled && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Badge Size
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["small", "Small"],
                      ["medium", "Medium"],
                      ["large", "Large"],
                      ["xlarge", "Extra Large"],
                    ] as Array<
                      [
                        FreeDeliveryBadgeSize,
                        string,
                      ]
                    >
                  ).map(([value, label]) => {
                    const selected =
                      details.freeDeliveryBadgeSize ===
                      value;

                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateDetails({
                            freeDeliveryBadgeSize:
                              value,
                          })
                        }
                        className={`h-11 rounded-xl border text-xs font-black transition ${
                          selected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-2 text-[11px] font-bold leading-5 text-slate-400">
                  Live Preview mein selected size
                  foran nazar aayega.
                </p>
              </div>
            )}
          </div>

          <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer font-black text-slate-950">
              Template Colors & Quality
            </summary>

            <div className="mt-4 space-y-4">
              <ColorField
                label="Left Box"
                value={
                  details.leftBoxColor
                }
                onChange={(leftBoxColor) =>
                  updateDetails({
                    leftBoxColor,
                  })
                }
              />

              <ColorField
                label="Right Box"
                value={
                  details.rightBoxColor
                }
                onChange={(rightBoxColor) =>
                  updateDetails({
                    rightBoxColor,
                  })
                }
              />

              <ColorField
                label="Text"
                value={details.textColor}
                onChange={(textColor) =>
                  updateDetails({
                    textColor,
                  })
                }
              />

              <label className="block">
                <div className="mb-1 flex justify-between text-xs font-black text-slate-600">
                  <span>JPG Quality</span>
                  <span>
                    {details.quality}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={details.quality}
                  onChange={(event) =>
                    updateDetails({
                      quality: Number(
                        event.target.value,
                      ),
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  setDetails(
                    createEmptyDetails(),
                  )
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-600"
              >
                <RefreshCw size={14} />
                Reset Template
              </button>
            </div>
          </details>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">
              5. Queue This Folder
            </h2>

            <p className="mt-1 text-xs font-bold text-slate-500">
              Current folder ko details ke saath
              save karo, phir next folder add karo.
            </p>

            <button
              type="button"
              onClick={saveCurrentWorkspaceToQueue}
              disabled={
                processing ||
                uploading ||
                !currentWorkspaceValid
              }
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-700 px-5 text-sm font-black text-white disabled:opacity-40"
            >
              {editingJobId ? (
                <>
                  <Pencil size={17} />
                  Update Queue Item
                </>
              ) : (
                <>
                  <Plus size={17} />
                  Add Folder to Queue
                </>
              )}
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-black text-slate-950">
                  Live Preview
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {selectedPreviewSource?.name ||
                    "Select or queue a folder and enter details"}
                </p>
              </div>

              <div className="flex gap-2">
                {previewCurrencies.map(
                  (currency) => (
                    <button
                      key={currency}
                      type="button"
                      onClick={() =>
                        setPreviewCurrency(
                          currency,
                        )
                      }
                      className={`h-9 rounded-xl px-4 text-xs font-black ${
                        previewCurrency ===
                        currency
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {currency}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="grid min-h-[560px] place-items-center bg-slate-100 p-5">
              {previewLoading ? (
                <div className="text-center">
                  <Loader2
                    size={32}
                    className="mx-auto animate-spin text-blue-600"
                  />
                  <p className="mt-2 font-black text-blue-700">
                    Updating preview...
                  </p>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Product template preview"
                  className="max-h-[760px] max-w-full rounded-xl object-contain shadow-xl"
                />
              ) : (
                <div className="max-w-md text-center text-slate-400">
                  <ImageIcon
                    size={45}
                    className="mx-auto"
                  />
                  <p className="mt-3 font-black">
                    Preview will appear here
                  </p>
                  <p className="mt-1 text-sm font-bold leading-6">
                    Current workspace ya queued
                    folder ko preview karne ke liye
                    niche se select karo.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="font-black text-slate-950">
                  Generate Queue
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {jobs.length} queued folder(s) ·{" "}
                  {totalQueuedImages} image(s) ·{" "}
                  {formatBytes(totalInputBytes)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void generateAll()
                  }
                  disabled={
                    jobs.length === 0 ||
                    processing ||
                    uploading
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-fuchsia-700 px-5 text-sm font-black text-white disabled:opacity-40"
                >
                  {processing ? (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  ) : (
                    <PackageOpen size={17} />
                  )}
                  {processing
                    ? `Generating ${progress}%`
                    : `Generate ${expectedOutputCount} Images`}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void saveToFolder()
                  }
                  disabled={
                    !outputs.length ||
                    processing ||
                    uploading
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-40"
                >
                  <FolderOpen size={17} />
                  Save to Folder
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void uploadToErp()
                  }
                  disabled={
                    !outputs.length ||
                    processing ||
                    uploading
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-40"
                >
                  {uploading ? (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  ) : (
                    <CloudUpload size={17} />
                  )}
                  {uploading
                    ? "Uploading..."
                    : "Upload to ERP Images"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void downloadAll()
                  }
                  disabled={
                    !outputs.length ||
                    processing ||
                    uploading
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-40"
                >
                  <Download size={17} />
                  Download All
                </button>
              </div>
            </div>

            {processing && (
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-fuchsia-700 transition-all"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-slate-950">
                  Queued Product Folders
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Har folder ki alag settings save
                  hoti hain.
                </p>
              </div>

              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {jobs.length}
              </span>
            </div>

            {jobs.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
                Abhi queue empty hai. Current folder
                load karo, details bharo aur Add
                Folder to Queue dabao.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {jobs.map((job, index) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActivePreviewJobId(
                                job.id,
                              );
                              setActiveSourceId(
                                job.sources[0]
                                  ?.id || "",
                              );
                            }}
                            className={`rounded-full px-3 py-1 text-[11px] font-black ${
                              activePreviewJobId ===
                              job.id
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            Preview
                          </button>
                          <span className="rounded-full bg-fuchsia-50 px-3 py-1 text-[11px] font-black text-fuchsia-700">
                            Queue #{index + 1}
                          </span>
                        </div>

                        <p className="mt-2 truncate text-sm font-black text-slate-950">
                          {job.folderName}
                        </p>

                        <p className="mt-1 text-xs font-bold text-slate-500">
                          {job.sources.length} image(s) ·{" "}
                          {job.details.sku} ·{" "}
                          {job.details.currencies.join(
                            ", ",
                          )} ·{" "}
                          {job.details.freeDeliveryEnabled
                            ? `Free Delivery / ${badgeSizeLabel(
                                job.details
                                  .freeDeliveryBadgeSize,
                              )}`
                            : "No Free Delivery"}
                        </p>

                        <p className="mt-1 text-xs font-bold text-slate-500">
                          Size - {job.details.size} ·
                          Fabric - {job.details.fabric}
                          · Price -{" "}
                          {job.details.price}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            editJob(job.id)
                          }
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-700"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            removeJob(job.id)
                          }
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-black text-red-700"
                        >
                          <Trash2 size={14} />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {previewTargetSources.length > 0 && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-black text-slate-950">
                    Preview Folder Images
                  </h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Current workspace ya selected
                    queue item ki images.
                  </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  {previewTargetSources.length}
                </span>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {previewTargetSources.map(
                  (source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() =>
                        setActiveSourceId(
                          source.id,
                        )
                      }
                      className={`overflow-hidden rounded-2xl border text-left ${
                        selectedPreviewSource?.id ===
                        source.id
                          ? "border-blue-600 ring-2 ring-blue-100"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="h-44 bg-slate-100">
                        <img
                          src={source.objectUrl}
                          alt={source.name}
                          className="h-full w-full object-contain"
                        />
                      </div>

                      <div className="p-3">
                        <p className="truncate text-xs font-black text-slate-800">
                          {source.name}
                        </p>
                        <p className="mt-1 text-[11px] font-bold text-slate-400">
                          {source.width} ×{" "}
                          {source.height} ·{" "}
                          {formatBytes(
                            source.file.size,
                          )}
                        </p>
                      </div>
                    </button>
                  ),
                )}
              </div>
            </section>
          )}

          {outputs.length > 0 && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-black text-slate-950">
                    Generated Images
                  </h2>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Folder-wise generated results.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={clearOutputs}
                  className="h-9 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700"
                >
                  Clear Results
                </button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {outputs.map((output) => (
                  <div
                    key={output.id}
                    className="overflow-hidden rounded-2xl border border-slate-200"
                  >
                    <div className="relative h-48 bg-slate-100">
                      <img
                        src={output.objectUrl}
                        alt={output.name}
                        className="h-full w-full object-contain"
                      />

                      <span className="absolute right-2 top-2 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-black text-white">
                        {output.currency}
                      </span>
                    </div>

                    <div className="p-3">
                      <p className="truncate text-[11px] font-black text-fuchsia-700">
                        {output.jobLabel}
                      </p>

                      <p className="mt-1 line-clamp-2 text-xs font-black leading-5 text-slate-800">
                        {output.name}
                      </p>

                      <p className="mt-1 text-[11px] font-bold text-slate-400">
                        {formatBytes(output.size)}
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          downloadProductImage(
                            output,
                          )
                        }
                        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-xs font-black text-white"
                      >
                        <Download size={14} />
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Output Summary
                </p>
                <p className="mt-1 text-3xl font-black text-slate-950">
                  {outputs.length}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {formatBytes(totalOutputBytes)} total
                  output size
                </p>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  inputMode,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputMode?:
    | "text"
    | "decimal"
    | "numeric";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-slate-200 px-3 font-bold outline-none focus:border-blue-500"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <span className="text-sm font-black text-slate-700">
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-9 w-14 cursor-pointer rounded-lg border-0"
      />
    </label>
  );
}
