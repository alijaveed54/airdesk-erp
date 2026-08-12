"use client";

import {
  ChevronLeft,
  ChevronRight,
  Bot,
  Clipboard,
  Download,
  ExternalLink,
  Images,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AIResponse,
  AIResult,
  GalleryGroup,
  GalleryImage,
  GalleryResponse,
} from "./types";

import { downloadAsJpg, formatBytes, formatDate } from "./helpers";

const CATEGORY_OPTIONS = [
  "Saree",
  "Kurta Set",
  "Co-ord Set",
  "Anarkali Set",
  "Gown",
  "Lehenga",
  "Kaftan",
  "Abaya",
  "Dress Material",
  "Top",
  "Tunic",
  "Kurti",
  "Salwar Suit",
  "Sharara Set",
  "Garara Set",
  "Palazzo Set",
  "Skirt Set",
  "Jumpsuit",
  "Blouse",
  "Dupatta",
  "Kids Wear",
  "Other",
] as const;

const FABRIC_OPTIONS = [
  "Cotton",
  "Cotton Blend",
  "Rayon",
  "Rayon Blend",
  "Silk",
  "Art Silk",
  "Banarasi Silk",
  "Chanderi",
  "Viscose",
  "Viscose Georgette",
  "Georgette",
  "Faux Georgette",
  "Fox Georgette",
  "Chiffon",
  "Organza",
  "Soft Organza",
  "Roman Silk",
  "Glass Silk",
  "Muslin",
  "Khadi Cotton",
  "Linen",
  "Crepe",
  "Velvet",
  "Net",
  "Satin",
  "Tissue",
  "Denim",
  "Wool",
  "Other",
] as const;

const COLOR_OPTIONS = [
  "Black",
  "White",
  "Beige",
  "Brown",
  "Blue",
  "Navy Blue",
  "Royal Blue",
  "Green",
  "Olive",
  "Red",
  "Maroon",
  "Pink",
  "Purple",
  "Yellow",
  "Orange",
  "Grey",
  "Gold",
  "Silver",
  "Multi",
  "Other",
] as const;
const GALLERY_FOLDER_PAGE_SIZE = 1000;

type PaginatedGalleryResponse = GalleryResponse & {
  pagination?: {
    hasMore?: boolean;
    nextCursor?: string;
    pageSize?: number;
  };
};

function mergeGalleryGroups(
  current: GalleryGroup[],
  incoming: GalleryGroup[],
): GalleryGroup[] {
  const map = new Map<string, GalleryGroup>();

  for (const group of [...current, ...incoming]) {
    const key = `${group.sku}:${group.currency}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...group, images: [...group.images] });
      continue;
    }

    const imageMap = new Map(
      [...existing.images, ...group.images].map((image) => [image.key, image]),
    );
    const images = Array.from(imageMap.values()).sort((a, b) => {
      const numberA = Number(a.imageNumber || 999999);
      const numberB = Number(b.imageNumber || 999999);
      return numberA !== numberB
        ? numberA - numberB
        : a.key.localeCompare(b.key);
    });
    const latestIsIncoming = group.latestUpload > existing.latestUpload;

    map.set(key, {
      ...existing,
      count: images.length,
      totalSize: images.reduce((sum, image) => sum + image.size, 0),
      latestUpload: latestIsIncoming
        ? group.latestUpload
        : existing.latestUpload,
      coverUrl: latestIsIncoming ? group.coverUrl : existing.coverUrl,
      images,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      b.latestUpload.localeCompare(a.latestUpload) || a.sku.localeCompare(b.sku),
  );
}


export default function R2GalleryPage() {
  const [groups, setGroups] = useState<GalleryGroup[]>([]);
  const [summary, setSummary] = useState<GalleryResponse["summary"]>();
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [colorFilter, setColorFilter] = useState("ALL");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeGroup, setActiveGroup] = useState<GalleryGroup | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [userRole, setUserRole] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [bulkFolderCategory, setBulkFolderCategory] = useState("");
  const [bulkImageCategory, setBulkImageCategory] = useState("");
  const [aiResults, setAiResults] = useState<Record<string, AIResult>>({});
  const [bulkAiProgress, setBulkAiProgress] = useState("");
  const [imageColors, setImageColors] = useState<Record<string, string>>({});
  const [imageFabrics, setImageFabrics] = useState<Record<string, string>>({});
  const [fabricFilter, setFabricFilter] = useState("ALL");
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingFilterRecords, setLoadingFilterRecords] = useState(false);
  const [filterLoadProgress, setFilterLoadProgress] = useState("");

  const loadGallery = useCallback(async (cursor = "") => {
    const isLoadMore = Boolean(cursor);
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        folderLimit: String(GALLERY_FOLDER_PAGE_SIZE),
      });
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/r2/images?${params.toString()}`);
      const result = (await response.json()) as PaginatedGalleryResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Gallery load failed");
      }

      setGroups((current) => {
        const merged = mergeGalleryGroups(
          isLoadMore ? current : [],
          result.groups || [],
        );

        setSummary({
          totalImages: merged.reduce((sum, group) => sum + group.count, 0),
          totalSkus: new Set(merged.map((group) => group.sku)).size,
          totalGroups: merged.length,
          totalSize: merged.reduce((sum, group) => sum + group.totalSize, 0),
        });

        return merged;
      });

      setNextCursor(result.pagination?.nextCursor || "");
      setHasMore(Boolean(result.pagination?.hasMore));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Gallery load failed",
      );
    } finally {
      if (isLoadMore) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await response.json().catch(() => null);

        if (response.ok && data?.success) {
          setUserRole(String(data.user?.role || data.role || ""));
          setIsSuperAdmin(
            Boolean(data.user?.superAdmin ?? data.superAdmin ?? false),
          );
        } else {
          setUserRole("");
          setIsSuperAdmin(false);
        }
      } catch {
        setUserRole("");
        setIsSuperAdmin(false);
      }
    }

    void loadCurrentUser();
  }, []);

  const isAdmin =
    userRole.trim().toLowerCase() === "admin" || isSuperAdmin;

  async function loadSelectedFilterRecords() {
    const hasActiveFilter =
      search.trim() !== "" ||
      currency !== "ALL" ||
      categoryFilter !== "ALL" ||
      colorFilter !== "ALL" ||
      fabricFilter !== "ALL" ||
      minPrice !== "" ||
      maxPrice !== "";

    if (!hasActiveFilter) {
      setError("Pehle koi filter select karein, phir Load Filter Records dabayen.");
      return;
    }

    if (!hasMore || !nextCursor || loadingFilterRecords) return;

    setLoadingFilterRecords(true);
    setError("");
    setMessage("");

    try {
      let cursor = nextCursor;
      let mergedGroups = groups;
      let loadedBatches = 0;

      while (cursor) {
        loadedBatches += 1;
        setFilterLoadProgress(`Loading batch ${loadedBatches}...`);

        const params = new URLSearchParams({
          folderLimit: String(GALLERY_FOLDER_PAGE_SIZE),
          cursor,
        });
        const response = await fetch(`/api/r2/images?${params.toString()}`);
        const result = (await response.json()) as PaginatedGalleryResponse;

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Filter records load failed");
        }

        mergedGroups = mergeGalleryGroups(mergedGroups, result.groups || []);
        setGroups(mergedGroups);
        setSummary({
          totalImages: mergedGroups.reduce((sum, group) => sum + group.count, 0),
          totalSkus: new Set(mergedGroups.map((group) => group.sku)).size,
          totalGroups: mergedGroups.length,
          totalSize: mergedGroups.reduce((sum, group) => sum + group.totalSize, 0),
        });

        cursor = result.pagination?.nextCursor || "";
        setNextCursor(cursor);
        setHasMore(Boolean(result.pagination?.hasMore));
      }

      setMessage("Selected filter ke tamam matching records load ho gaye.");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Filter records load failed",
      );
    } finally {
      setLoadingFilterRecords(false);
      setFilterLoadProgress("");
    }
  }


  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("r2-gallery-ai-results");

      if (saved) {
        setAiResults(JSON.parse(saved) as Record<string, AIResult>);
      }
    } catch {
      // Ignore invalid browser cache.
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("r2-gallery-image-colors");

      if (saved) {
        setImageColors(JSON.parse(saved) as Record<string, string>);
      }
    } catch {
      // Ignore invalid browser cache.
    }
  }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("r2-gallery-image-fabrics");

      if (saved) {
        setImageFabrics(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, []);

  function readFabricValue(value: unknown): string {
    if (typeof value === "string") return value.trim();

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["fabric", "name", "value", "label"]) {
        const nested = record[key];
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }

    return "";
  }

  function getDetectedImageFabric(
    image: GalleryImage,
    group?: GalleryGroup,
  ): string {
    const ai = aiResults[image.key] as unknown as
      | Record<string, unknown>
      | undefined;
    const imageData = image as unknown as Record<string, unknown>;
    const groupData = group as unknown as Record<string, unknown> | undefined;

    const candidates: unknown[] = [
      ai?.fabric,
      (ai?.attributes as Record<string, unknown> | undefined)?.fabric,
      (ai?.result as Record<string, unknown> | undefined)?.fabric,
      (ai?.analysis as Record<string, unknown> | undefined)?.fabric,
      imageData.fabric,
      imageData.material,
      (imageData.attributes as Record<string, unknown> | undefined)?.fabric,
      (imageData.ai as Record<string, unknown> | undefined)?.fabric,
      (imageData.metadata as Record<string, unknown> | undefined)?.fabric,
      groupData?.fabric,
      groupData?.material,
      (groupData?.attributes as Record<string, unknown> | undefined)?.fabric,
      (groupData?.ai as Record<string, unknown> | undefined)?.fabric,
      (groupData?.metadata as Record<string, unknown> | undefined)?.fabric,
    ];

    for (const candidate of candidates) {
      const fabric = readFabricValue(candidate);
      if (fabric) return fabric;
    }

    return "";
  }

  function getImageFabric(image: GalleryImage, group?: GalleryGroup): string {
    return imageFabrics[image.key] || getDetectedImageFabric(image, group);
  }

  function getGroupFabric(group: GalleryGroup): string {
    for (const image of group.images) {
      const fabric = getImageFabric(image, group);
      if (fabric) return fabric;
    }

    return "";
  }

  useEffect(() => {
    if (groups.length === 0) return;

    setImageFabrics((current) => {
      const next = { ...current };
      let changed = false;

      for (const group of groups) {
        const detectedFabric =
          group.images
            .map(
              (image) =>
                current[image.key] || getDetectedImageFabric(image, group),
            )
            .find(Boolean) || "";

        if (!detectedFabric) continue;

        for (const image of group.images) {
          if (!next[image.key]) {
            next[image.key] = detectedFabric;
            changed = true;
          }
        }
      }

      if (!changed) return current;

      window.localStorage.setItem(
        "r2-gallery-image-fabrics",
        JSON.stringify(next),
      );

      return next;
    });
  }, [aiResults, groups]);

  const currencies = useMemo(
    () => Array.from(new Set(groups.map((group) => group.currency))).sort(),
    [groups],
  );

  function getGroupPrice(group: GalleryGroup): number | null {
    const groupData = group as unknown as Record<string, unknown>;
    const possibleValues = [
      groupData.price,
      groupData.amount,
      groupData.sellingPrice,
      groupData.salePrice,
      groupData.unitPrice,
      ...group.images.flatMap((image) => {
        const imageData = image as unknown as Record<string, unknown>;
        return [
          imageData.price,
          imageData.amount,
          imageData.sellingPrice,
          imageData.salePrice,
          imageData.unitPrice,
        ];
      }),
    ];

    for (const value of possibleValues) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value.replace(/[^0-9.]/g, ""));
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
    }

    return null;
  }

  function matchesSelectedPriceRange(price: number | null) {
    const minimum = minPrice === "" ? null : Number(minPrice);
    const maximum = maxPrice === "" ? null : Number(maxPrice);

    if (minimum === null && maximum === null) return true;
    if (price === null) return false;
    if (minimum !== null && (!Number.isFinite(minimum) || price < minimum)) {
      return false;
    }
    if (maximum !== null && (!Number.isFinite(maximum) || price > maximum)) {
      return false;
    }

    return true;
  }

  const filteredGroups = useMemo(() => {
    const query = search.trim().toUpperCase();

    return groups.filter((group) => {
      const matchesSearch =
        !query ||
        group.sku.toUpperCase().includes(query) ||
        group.currency.toUpperCase().includes(query);

      const matchesCurrency = currency === "ALL" || group.currency === currency;
      const categories = group.images
        .map((image) => aiResults[image.key]?.category)
        .filter(Boolean);
      const matchesCategory =
        categoryFilter === "ALL" ||
        (categoryFilter === "NOT_ANALYZED"
          ? group.images.some((image) => !aiResults[image.key])
          : categories.includes(categoryFilter));

      const colors = group.images
        .map((image) => imageColors[image.key])
        .filter(Boolean);
      const matchesColor =
        colorFilter === "ALL" ||
        (colorFilter === "NO_COLOR"
          ? group.images.some((image) => !imageColors[image.key])
          : colors.includes(colorFilter));

      const fabrics = group.images
        .map((image) => imageFabrics[image.key])
        .filter(Boolean);

      const matchesFabric =
        fabricFilter === "ALL" ||
        (fabricFilter === "NO_FABRIC"
          ? group.images.some((image) => !getImageFabric(image, group))
          : fabrics.includes(fabricFilter));

      const matchesPrice = matchesSelectedPriceRange(getGroupPrice(group));

      return (
        matchesSearch &&
        matchesCurrency &&
        matchesCategory &&
        matchesColor &&
        matchesFabric &&
        matchesPrice
      );
    });
  }, [
    aiResults,
    categoryFilter,
    colorFilter,
    fabricFilter,
    currency,
    groups,
    imageColors,
    imageFabrics,
    maxPrice,
    minPrice,
    search,
  ]);

  const activeImage = activeGroup?.images[activeIndex];

  function getGroupPrefix(group: GalleryGroup) {
    return `products/${group.sku}/${group.currency}/`;
  }

  function saveAiResults(nextResults: Record<string, AIResult>) {
    setAiResults(nextResults);
    window.localStorage.setItem(
      "r2-gallery-ai-results",
      JSON.stringify(nextResults),
    );
  }

  function changeGroupCategory(group: GalleryGroup, category: string) {
    if (!category) return;

    const now = new Date().toISOString();
    const nextResults = { ...aiResults };

    for (const image of group.images) {
      const current = nextResults[image.key];
      nextResults[image.key] = current
        ? { ...current, category }
        : ({
            category,
            confidence: 1,
            model: "manual",
            version: "1.0",
            analyzedAt: now,
            quality: "good",
          } as AIResult);
    }

    saveAiResults(nextResults);
    setMessage(`${group.sku}: category ${category} save ho gayi`);
  }

  function applyCategoryToImageKeys(imageKeys: string[], category: string) {
    if (!category || imageKeys.length === 0) return 0;

    const uniqueKeys = Array.from(new Set(imageKeys));
    const now = new Date().toISOString();
    const nextResults = { ...aiResults };

    for (const imageKey of uniqueKeys) {
      const current = nextResults[imageKey];
      nextResults[imageKey] = current
        ? { ...current, category }
        : ({
            category,
            confidence: 1,
            model: "manual",
            version: "1.0",
            analyzedAt: now,
            quality: "good",
          } as AIResult);
    }

    saveAiResults(nextResults);
    return uniqueKeys.length;
  }

  function updateSelectedFoldersCategory() {
    if (!bulkFolderCategory || selectedFolders.length === 0) return;

    const imageKeys = groups
      .filter((group) => selectedFolders.includes(getGroupPrefix(group)))
      .flatMap((group) => group.images.map((image) => image.key));
    const updatedCount = applyCategoryToImageKeys(
      imageKeys,
      bulkFolderCategory,
    );

    setMessage(
      `${selectedFolders.length} folder(s), ${updatedCount} image(s): category ${bulkFolderCategory} save ho gayi`,
    );
  }

  function updateSelectedImagesCategory() {
    if (!bulkImageCategory || selectedKeys.length === 0) return;

    const updatedCount = applyCategoryToImageKeys(
      selectedKeys,
      bulkImageCategory,
    );

    setMessage(
      `${updatedCount} selected image(s): category ${bulkImageCategory} save ho gayi`,
    );
  }

  function changeImageColor(imageKey: string, color: string) {
    setImageColors((current) => {
      const nextColors = { ...current };

      if (color) nextColors[imageKey] = color;
      else delete nextColors[imageKey];

      window.localStorage.setItem(
        "r2-gallery-image-colors",
        JSON.stringify(nextColors),
      );
      return nextColors;
    });
  }

  function changeImageFabric(imageKey: string, fabric: string) {
    setImageFabrics((current) => {
      const next = { ...current };

      if (fabric) next[imageKey] = fabric;
      else delete next[imageKey];

      window.localStorage.setItem(
        "r2-gallery-image-fabrics",
        JSON.stringify(next),
      );

      return next;
    });
  }

  function toggleFolderSelection(group: GalleryGroup) {
    const prefix = getGroupPrefix(group);

    setSelectedFolders((current) =>
      current.includes(prefix)
        ? current.filter((item) => item !== prefix)
        : [...current, prefix],
    );
  }

  function toggleSelectAllFolders() {
    const visiblePrefixes = filteredGroups.map(getGroupPrefix);
    const allVisibleSelected =
      visiblePrefixes.length > 0 &&
      visiblePrefixes.every((prefix) => selectedFolders.includes(prefix));

    setSelectedFolders((current) => {
      if (allVisibleSelected) {
        return current.filter((prefix) => !visiblePrefixes.includes(prefix));
      }

      return Array.from(new Set([...current, ...visiblePrefixes]));
    });
  }

  async function deleteSelectedFolders() {
    if (selectedFolders.length === 0) return;

    const selectedGroups = groups.filter((group) =>
      selectedFolders.includes(getGroupPrefix(group)),
    );
    const selectedImageCount = selectedGroups.reduce(
      (sum, group) => sum + group.count,
      0,
    );

    const confirmed = window.confirm(
      `${selectedFolders.length} folder(s) aur ${selectedImageCount} image(s) permanently delete karni hain?`,
    );

    if (!confirmed) return;

    setBusyKey("__bulk_folder_delete__");
    setError("");
    setMessage("");

    try {
      let deletedCount = 0;

      for (const prefix of selectedFolders) {
        const response = await fetch("/api/r2/images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix }),
        });

        const result = (await response.json()) as {
          success: boolean;
          message?: string;
          deletedCount?: number;
        };

        if (!response.ok || !result.success) {
          throw new Error(result.message || `Folder delete failed: ${prefix}`);
        }

        deletedCount += result.deletedCount || 0;
      }

      setMessage(
        `${selectedFolders.length} folder(s) deleted — ${deletedCount} image(s) removed`,
      );
      setSelectedFolders([]);
      closePreview();
      await loadGallery();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Selected folders delete failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  function openGroup(group: GalleryGroup, index = 0) {
    setActiveGroup(group);
    setActiveIndex(index);
    setSelectedKeys([]);
    setError("");
    setMessage("");
  }

  function closePreview() {
    setActiveGroup(null);
    setActiveIndex(0);
    setSelectedKeys([]);
  }

  function previousImage() {
    if (!activeGroup) return;

    setActiveIndex((current) =>
      current === 0 ? activeGroup.images.length - 1 : current - 1,
    );
  }

  function nextImage() {
    if (!activeGroup) return;

    setActiveIndex((current) =>
      current === activeGroup.images.length - 1 ? 0 : current + 1,
    );
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Image URL copied");
    } catch {
      setError("URL copy failed");
    }
  }

  async function deleteImage(image: GalleryImage) {
    const confirmed = window.confirm(
      `${image.sku} ki ye image permanently delete karni hai?`,
    );

    if (!confirmed) return;

    setBusyKey(image.key);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/r2/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: image.key }),
      });
      const result = (await response.json()) as {
        success: boolean;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Delete failed");
      }

      setMessage("Image deleted");
      closePreview();
      await loadGallery();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Delete failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  function toggleImageSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function toggleSelectAllInGroup() {
    if (!activeGroup) return;

    const groupKeys = activeGroup.images.map((image) => image.key);
    const allSelected = groupKeys.every((key) => selectedKeys.includes(key));

    setSelectedKeys(allSelected ? [] : groupKeys);
  }

  async function deleteSelectedImages() {
    if (selectedKeys.length === 0) return;

    const confirmed = window.confirm(
      `${selectedKeys.length} selected image(s) permanently delete karni hain?`,
    );

    if (!confirmed) return;

    setBusyKey("__bulk_delete__");
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/r2/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selectedKeys }),
      });

      const result = (await response.json()) as {
        success: boolean;
        message?: string;
        deletedCount?: number;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Bulk delete failed");
      }

      setMessage(
        `${result.deletedCount || selectedKeys.length} image(s) deleted`,
      );
      closePreview();
      await loadGallery();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Bulk delete failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function deleteGroup(group: GalleryGroup) {
    const confirmed = window.confirm(
      `${group.sku} (${group.currency}) ka complete folder aur ${group.count} image(s) permanently delete karni hain?`,
    );

    if (!confirmed) return;

    const groupBusyKey = `__group__:${group.sku}:${group.currency}`;
    setBusyKey(groupBusyKey);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/r2/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: `products/${group.sku}/${group.currency}/`,
        }),
      });

      const result = (await response.json()) as {
        success: boolean;
        message?: string;
        deletedCount?: number;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Folder delete failed");
      }

      setMessage(
        `${group.sku} (${group.currency}) folder deleted — ${
          result.deletedCount || group.count
        } image(s) removed`,
      );

      if (
        activeGroup?.sku === group.sku &&
        activeGroup?.currency === group.currency
      ) {
        closePreview();
      }

      await loadGallery();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Folder delete failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function analyzeImage(image: GalleryImage) {
    setBusyKey(`__ai__:${image.key}`);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: image.url,
          imageKey: image.key,
          sku: image.sku,
        }),
      });

      const result = (await response.json()) as AIResponse;

      if (!response.ok || !result.success || !result.result) {
        throw new Error(result.error || "AI analysis failed");
      }

      const nextResults = {
        ...aiResults,
        [image.key]: result.result,
      };
      if (result.result.fabric) {
        const matchingGroup = groups.find((group) =>
          group.images.some((groupImage) => groupImage.key === image.key),
        );

        if (matchingGroup) {
          matchingGroup.images.forEach((groupImage) =>
            changeImageFabric(groupImage.key, result.result!.fabric || ""),
          );
        } else {
          changeImageFabric(image.key, result.result.fabric);
        }
      }
      saveAiResults(nextResults);

      setMessage(
        `AI result: ${result.result.category} (${Math.round(
          result.result.confidence * 100,
        )}%)`,
      );
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "AI analysis failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function analyzeImagesBulk(
    images: GalleryImage[],
    busyId: string,
    label: string,
  ) {
    const pendingImages = images.filter((image) => !aiResults[image.key]);

    if (pendingImages.length === 0) {
      setMessage(`${label}: sab images pehle se analyzed hain`);
      return;
    }

    setBusyKey(busyId);
    setError("");
    setMessage("");
    setBulkAiProgress(`0 / ${pendingImages.length}`);

    let completed = 0;
    let failed = 0;
    let nextResults: Record<string, AIResult> = { ...aiResults };

    try {
      for (const image of pendingImages) {
        try {
          const response = await fetch("/api/ai/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageUrl: image.url,
              imageKey: image.key,
              sku: image.sku,
            }),
          });

          const result = (await response.json()) as AIResponse;

          if (!response.ok || !result.success || !result.result) {
            throw new Error(result.error || "AI analysis failed");
          }

          nextResults = {
            ...nextResults,
            [image.key]: result.result,
          };
          if (result.result.fabric) {
            changeImageFabric(image.key, result.result.fabric);
          }
          completed += 1;
          saveAiResults(nextResults);
        } catch {
          failed += 1;
        } finally {
          setBulkAiProgress(`${completed + failed} / ${pendingImages.length}`);
        }
      }

      setMessage(
        `${label}: ${completed} analyzed${failed ? `, ${failed} failed` : ""}`,
      );
    } finally {
      setBusyKey("");
      setBulkAiProgress("");
    }
  }

  async function handleJpgDownload(image: GalleryImage) {
    setBusyKey(image.key);
    setError("");
    setMessage("");

    try {
      await downloadAsJpg(image);
      setMessage("JPG downloaded");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Download failed",
      );
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black text-emerald-700">
            Product Media
          </p>
          <h1 className="mt-1 text-3xl font-black text-slate-950">
            Images
          </h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            SKU-wise WebP images dekho, URL copy karo aur JPG download karo.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void analyzeImagesBulk(
                filteredGroups.flatMap((group) => group.images),
                "__bulk_ai_visible__",
                "Visible images AI",
              )
            }
            disabled={
              loading ||
              filteredGroups.length === 0 ||
              busyKey === "__bulk_ai_visible__"
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-violet-700 px-4 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:opacity-60"
          >
            {busyKey === "__bulk_ai_visible__" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bot className="h-4 w-4" />
            )}
            {busyKey === "__bulk_ai_visible__"
              ? `Running ${bulkAiProgress}`
              : "Run AI on Visible"}
          </button>

          <button
            type="button"
            onClick={() => void loadGallery()}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total SKUs", summary?.totalSkus || 0],
          ["Image Groups", summary?.totalGroups || 0],
          ["Total Images", summary?.totalImages || 0],
          ["Storage Used", formatBytes(summary?.totalSize || 0)],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_170px_170px_170px_170px_140px_140px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SKU..."
            className="h-12 w-full rounded-2xl border border-slate-300 pl-12 pr-4 text-sm font-bold outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>

        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
        >
          <option value="ALL">All categories</option>
          <option value="NOT_ANALYZED">Not Analyzed Yet</option>
          {CATEGORY_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
        >
          <option value="ALL">All currencies</option>
          {currencies.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={colorFilter}
          onChange={(event) => setColorFilter(event.target.value)}
          className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
        >
          <option value="ALL">All colors</option>
          <option value="NO_COLOR">Color not selected</option>
          {COLOR_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={fabricFilter}
          onChange={(e) => setFabricFilter(e.target.value)}
          className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        >
          <option value="ALL">All Fabrics</option>
          <option value="NO_FABRIC">Fabric not selected</option>

          {FABRIC_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={minPrice}
          onChange={(event) => setMinPrice(event.target.value)}
          placeholder="Min price"
          aria-label="Minimum price"
          className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
        />

        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={maxPrice}
          onChange={(event) => setMaxPrice(event.target.value)}
          placeholder="Max price"
          aria-label="Maximum price"
          className={`h-12 rounded-2xl border bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:ring-4 ${
            minPrice !== "" &&
            maxPrice !== "" &&
            Number(minPrice) > Number(maxPrice)
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 focus:border-amber-500 focus:ring-amber-100"
          }`}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-blue-950">Load Selected Filter Records</p>
          <p className="mt-1 text-xs font-bold text-blue-700">
            Upar filter select karein, phir button dabayen. Gallery baqi records check karke selected filter ke matching records show karegi.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadSelectedFilterRecords()}
          disabled={
            !hasMore ||
            !nextCursor ||
            loadingFilterRecords ||
            loadingMore ||
            !(
              search.trim() !== "" ||
              currency !== "ALL" ||
              categoryFilter !== "ALL" ||
              colorFilter !== "ALL" ||
              fabricFilter !== "ALL" ||
              minPrice !== "" ||
              maxPrice !== ""
            )
          }
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 text-sm font-black text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingFilterRecords ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {loadingFilterRecords
            ? filterLoadProgress || "Loading filter records..."
            : hasMore
              ? "Load Filter Records"
              : "All Records Loaded"}
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleSelectAllFolders}
            disabled={filteredGroups.length === 0}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {filteredGroups.length > 0 &&
            filteredGroups.every((group) =>
              selectedFolders.includes(getGroupPrefix(group)),
            )
              ? "Clear Visible"
              : "Select All Visible"}
          </button>

          <span className="text-sm font-black text-slate-600">
            {selectedFolders.length} folder(s) selected
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={bulkFolderCategory}
            onChange={(event) => setBulkFolderCategory(event.target.value)}
            className="h-11 min-w-[210px] rounded-2xl border border-violet-300 bg-violet-50 px-4 text-sm font-black text-violet-900 outline-none focus:border-violet-500"
          >
            <option value="">Select bulk category</option>
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={updateSelectedFoldersCategory}
            disabled={selectedFolders.length === 0 || !bulkFolderCategory}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-violet-700 px-5 text-sm font-black text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Update Category
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => void deleteSelectedFolders()}
              disabled={
                selectedFolders.length === 0 ||
                busyKey === "__bulk_folder_delete__"
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyKey === "__bulk_folder_delete__" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete Selected Folders
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {message}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-72 items-center justify-center rounded-3xl border border-slate-200 bg-white">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
            <p className="mt-3 text-sm font-black text-slate-600">
              Loading up to 1,000 folders...
            </p>
          </div>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex min-h-72 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white">
          <div className="text-center">
            <Images className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-3 text-lg font-black text-slate-700">
              Koi image nahi mili
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
          {filteredGroups.map((group) => (
            <article
              key={`${group.sku}-${group.currency}`}
              className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                selectedFolders.includes(getGroupPrefix(group))
                  ? "border-red-500 ring-4 ring-red-100"
                  : "border-slate-200"
              }`}
            >
              <label
                className="absolute left-2 top-2 z-20 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-white/95 shadow"
                onClick={(event) => event.stopPropagation()}
                title="Select folder"
              >
                <input
                  type="checkbox"
                  checked={selectedFolders.includes(getGroupPrefix(group))}
                  onChange={() => toggleFolderSelection(group)}
                  className="h-4 w-4 accent-red-600"
                  aria-label={`Select ${group.sku} ${group.currency} folder`}
                />
              </label>
              <button
                type="button"
                onClick={() => openGroup(group)}
                className="group relative block aspect-square w-full overflow-hidden bg-slate-100 text-left"
              >
                <img
                  src={group.coverUrl}
                  alt={group.sku}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
                <span className="absolute right-2 top-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[9px] font-black text-white">
                  {group.count} images
                </span>
              </button>

              <div className="space-y-1.5 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="truncate text-xs font-black text-slate-950">
                      {group.sku}
                    </h2>
                    <p className="mt-0.5 truncate text-[9px] font-bold text-slate-500">
                      {formatDate(group.latestUpload)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">
                    {group.currency}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[9px] font-bold text-slate-600">
                  <span>{formatBytes(group.totalSize)}</span>
                  <span>WebP</span>
                </div>

                <select
                  value={
                    group.images
                      .map((image) => aiResults[image.key]?.category)
                      .find(Boolean) || ""
                  }
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    changeGroupCategory(group, event.target.value)
                  }
                  className="h-7 w-full rounded-lg border border-violet-200 bg-violet-50 px-1.5 text-[10px] font-black text-violet-900 outline-none focus:border-violet-500"
                >
                  <option value="">Select category</option>
                  {CATEGORY_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  value={getGroupFabric(group)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    group.images.forEach((image) =>
                      changeImageFabric(image.key, event.target.value),
                    );
                  }}
                  className="h-7 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-1.5 text-[10px] font-black text-indigo-900 outline-none focus:border-indigo-500"
                >
                  <option value="">Select Fabric</option>

                  {FABRIC_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-[1fr_auto] gap-1.5">
                  <button
                    type="button"
                    onClick={() => openGroup(group)}
                    className="h-7 rounded-lg bg-slate-950 px-2 text-[10px] font-black text-white transition hover:bg-emerald-700"
                  >
                    View
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteGroup(group)}
                      disabled={
                        busyKey === `__group__:${group.sku}:${group.currency}`
                      }
                      className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 text-[10px] font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                      title={`Delete complete ${group.sku} folder`}
                      aria-label={`Delete complete ${group.sku} folder`}
                    >
                      {busyKey === `__group__:${group.sku}:${group.currency}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && filteredGroups.length > 0 && hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadGallery(nextCursor)}
            disabled={loadingMore || !nextCursor}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-6 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? "Loading more..." : "Load More Products"}
          </button>
        </div>
      )}

      {activeGroup && activeImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div>
                <h2 className="text-xl font-black text-slate-950">
                  {activeGroup.sku}
                </h2>
                <p className="text-xs font-bold text-slate-500">
                  {activeGroup.currency} · {activeIndex + 1} of{" "}
                  {activeGroup.images.length}
                </p>
              </div>

              <button
                type="button"
                onClick={closePreview}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                aria-label="Close preview"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_300px]">
              <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl bg-slate-100">
                <img
                  src={activeImage.url}
                  alt={`${activeImage.sku} ${activeIndex + 1}`}
                  className="max-h-[72vh] w-auto max-w-full object-contain"
                />

                {activeGroup.images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={previousImage}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-950 shadow-lg transition hover:bg-white"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={nextImage}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-950 shadow-lg transition hover:bg-white"
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}
              </div>

              <aside className="space-y-4">
                <div className="rounded-3xl border border-slate-200 p-4">
                  <dl className="space-y-3 text-sm">
                    {[
                      ["SKU", activeImage.sku],
                      ["Currency", activeImage.currency],
                      ["Image No.", activeImage.imageNumber || "-"],
                      ["Format", "WebP"],
                      ["Size", formatBytes(activeImage.size)],
                      ["Uploaded", formatDate(activeImage.lastModified)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-3"
                      >
                        <dt className="font-bold text-slate-500">{label}</dt>
                        <dd className="text-right font-black text-slate-900">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4">
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-violet-700" />
                    <p className="text-sm font-black text-violet-950">
                      AI Category
                    </p>
                  </div>

                  {aiResults[activeImage.key] ? (
                    <div className="mt-3">
                      <p className="text-xl font-black text-violet-950">
                        {aiResults[activeImage.key].category}
                      </p>
                      <p className="mt-1 text-xs font-bold text-violet-700">
                        Confidence:{" "}
                        {Math.round(
                          aiResults[activeImage.key].confidence * 100,
                        )}
                        %
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-bold text-violet-700">
                      Is image ka AI analysis abhi nahi hua.
                    </p>
                  )}

                  <div className="mt-4 border-t border-violet-200 pt-4">
                    <label className="mb-1 block text-xs font-black uppercase tracking-wide text-violet-800">
                      Image Color
                    </label>
                    <select
                      value={imageColors[activeImage.key] || ""}
                      onChange={(event) =>
                        changeImageColor(activeImage.key, event.target.value)
                      }
                      className="h-10 w-full rounded-xl border border-violet-300 bg-white px-3 text-sm font-black text-slate-900 outline-none focus:border-violet-600"
                    >
                      <option value="">Select color</option>
                      {COLOR_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-black uppercase tracking-wide text-violet-800">
                        Fabric
                      </label>

                      <select
                        value={getImageFabric(activeImage, activeGroup)}
                        onChange={(event) =>
                          changeImageFabric(activeImage.key, event.target.value)
                        }
                        className="h-10 w-full rounded-xl border border-violet-300 bg-white px-3 text-sm font-black text-slate-900 outline-none focus:border-violet-600"
                      >
                        <option value="">Select Fabric</option>

                        {FABRIC_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void analyzeImagesBulk(
                        activeGroup.images,
                        `__bulk_ai_group__:${activeGroup.sku}:${activeGroup.currency}`,
                        `${activeGroup.sku} folder AI`,
                      )
                    }
                    disabled={
                      busyKey ===
                      `__bulk_ai_group__:${activeGroup.sku}:${activeGroup.currency}`
                    }
                    className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-violet-300 bg-white px-4 text-sm font-black text-violet-800 transition hover:bg-violet-100 disabled:opacity-60"
                  >
                    {busyKey ===
                    `__bulk_ai_group__:${activeGroup.sku}:${activeGroup.currency}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    {busyKey ===
                    `__bulk_ai_group__:${activeGroup.sku}:${activeGroup.currency}`
                      ? `Running ${bulkAiProgress}`
                      : `Run Folder AI (${activeGroup.images.length})`}
                  </button>

                  <button
                    type="button"
                    onClick={() => void analyzeImage(activeImage)}
                    disabled={busyKey === `__ai__:${activeImage.key}`}
                    className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-700 px-4 text-sm font-black text-white transition hover:bg-violet-800 disabled:opacity-60"
                  >
                    {busyKey === `__ai__:${activeImage.key}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    {aiResults[activeImage.key]
                      ? "Analyze Again"
                      : "Analyze AI"}
                  </button>
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void deleteGroup(activeGroup)}
                    disabled={
                      busyKey ===
                      `__group__:${activeGroup.sku}:${activeGroup.currency}`
                    }
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 text-sm font-black text-white transition hover:bg-red-800 disabled:opacity-60"
                  >
                    {busyKey ===
                    `__group__:${activeGroup.sku}:${activeGroup.currency}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete Complete Folder ({activeGroup.count})
                  </button>
                )}

                <div className="rounded-3xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">
                        Bulk Selection
                      </p>
                      <p className="text-xs font-bold text-slate-500">
                        {selectedKeys.length} image(s) selected
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={toggleSelectAllInGroup}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      {activeGroup.images.every((image) =>
                        selectedKeys.includes(image.key),
                      )
                        ? "Clear All"
                        : "Select All"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select
                      value={bulkImageCategory}
                      onChange={(event) =>
                        setBulkImageCategory(event.target.value)
                      }
                      className="h-11 rounded-2xl border border-violet-300 bg-violet-50 px-3 text-sm font-black text-violet-900 outline-none focus:border-violet-500"
                    >
                      <option value="">Select bulk category</option>
                      {CATEGORY_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={updateSelectedImagesCategory}
                      disabled={selectedKeys.length === 0 || !bulkImageCategory}
                      className="h-11 rounded-2xl bg-violet-700 px-4 text-sm font-black text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Update Category
                    </button>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteSelectedImages()}
                      disabled={
                        selectedKeys.length === 0 || busyKey === "__bulk_delete__"
                      }
                      className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyKey === "__bulk_delete__" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete Selected
                    </button>
                  )}
                </div>

                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => void handleJpgDownload(activeImage)}
                    disabled={busyKey === activeImage.key}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busyKey === activeImage.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download JPG
                  </button>

                  <button
                    type="button"
                    onClick={() => void copyUrl(activeImage.url)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  >
                    <Clipboard className="h-4 w-4" />
                    Copy URL
                  </button>

                  <a
                    href={activeImage.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open WebP
                  </a>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteImage(activeImage)}
                      disabled={busyKey === activeImage.key}
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Image
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {activeGroup.images.map((image, index) => (
                    <div
                      key={image.key}
                      className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-slate-100 ${
                        index === activeIndex
                          ? "border-emerald-500"
                          : selectedKeys.includes(image.key)
                            ? "border-red-500"
                            : "border-transparent"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        className="h-full w-full"
                        aria-label={`Open image ${index + 1}`}
                      >
                        <img
                          src={image.url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />

                        {aiResults[image.key] && (
                          <span className="absolute bottom-1.5 right-1.5 rounded-lg bg-violet-700 px-1.5 py-1 text-[10px] font-black text-white shadow">
                            {aiResults[image.key].category}
                          </span>
                        )}
                      </button>

                      <select
                        value={imageColors[image.key] || ""}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          changeImageColor(image.key, event.target.value)
                        }
                        className="absolute bottom-1 left-1 right-1 h-6 rounded-md border border-white/70 bg-slate-950/80 px-1 text-[9px] font-black text-white outline-none"
                        aria-label={`Select color for image ${index + 1}`}
                      >
                        <option value="">Color</option>
                        {COLOR_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      <select
                        value={getImageFabric(image, activeGroup)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          changeImageFabric(image.key, event.target.value)
                        }
                        className="absolute top-8 left-1 right-1 h-6 rounded-md border border-white/70 bg-slate-950/80 px-1 text-[9px] font-black text-white outline-none"
                      >
                        <option value="">Fabric</option>

                        {FABRIC_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      <label
                        className="absolute left-1.5 top-1.5 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-white/95 shadow"
                        onClick={(event) => event.stopPropagation()}
                        title="Select image"
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(image.key)}
                          onChange={() => toggleImageSelection(image.key)}
                          className="h-4 w-4 accent-red-600"
                          aria-label={`Select image ${index + 1}`}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
