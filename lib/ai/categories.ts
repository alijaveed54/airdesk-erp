export const PRODUCT_CATEGORIES = [
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

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_PROMPTS: Record<ProductCategory, string[]> = {
  Saree: [
    "a women's saree with draped fabric and blouse",
    "an Indian saree outfit",
  ],
  "Kurta Set": [
    "a women's kurta with matching trousers or pants",
    "a kurta pant set",
  ],
  "Co-ord Set": [
    "a matching women's top and trouser co-ord set",
    "a coordinated two-piece outfit",
  ],
  "Anarkali Set": [
    "a long flared Anarkali dress with matching bottom or dupatta",
    "an Anarkali suit",
  ],
  Gown: [
    "a long women's gown or floor-length dress",
    "a formal maxi gown",
  ],
  Lehenga: [
    "a lehenga skirt with blouse and dupatta",
    "an Indian bridal lehenga outfit",
  ],
  Kaftan: [
    "a loose flowing women's kaftan",
    "a long kaftan dress",
  ],
  Abaya: [
    "a long modest women's abaya",
    "a black or colored abaya dress",
  ],
  "Dress Material": [
    "unstitched dress material fabric set",
    "fabric pieces for a women's suit",
  ],
  Top: [
    "a women's standalone top",
    "a women's blouse-style top",
  ],
  Tunic: [
    "a women's long tunic",
    "a tunic top",
  ],
  Kurti: [
    "a women's kurti",
    "a short Indian kurta",
  ],
  "Salwar Suit": [
    "a salwar suit with kameez and salwar",
    "a traditional salwar kameez set",
  ],
  "Sharara Set": [
    "a women's sharara set with wide flared pants",
    "a sharara suit",
  ],
  "Garara Set": [
    "a women's garara set with flared traditional pants",
    "a garara suit",
  ],
  "Palazzo Set": [
    "a women's top with wide-leg palazzo pants",
    "a palazzo suit set",
  ],
  "Skirt Set": [
    "a women's top and long skirt set",
    "a matching skirt outfit",
  ],
  Jumpsuit: [
    "a women's one-piece jumpsuit",
    "a full-length jumpsuit",
  ],
  Blouse: [
    "a standalone saree blouse",
    "an Indian women's blouse",
  ],
  Dupatta: [
    "a standalone dupatta or stole",
    "a decorative Indian scarf",
  ],
  "Kids Wear": [
    "a children's ethnic outfit",
    "kids clothing",
  ],
  Other: [
    "other women's fashion clothing",
    "an uncategorized garment",
  ],
};

export const DEFAULT_CATEGORY_CONFIDENCE_THRESHOLD = 0.35;

export function isProductCategory(value: string): value is ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

export function normalizeCategory(value: string): ProductCategory {
  const normalized = value.trim().toLowerCase();

  const exactMatch = PRODUCT_CATEGORIES.find(
    (category) => category.toLowerCase() === normalized,
  );

  if (exactMatch) return exactMatch;

  const aliases: Record<string, ProductCategory> = {
    sarees: "Saree",
    kurta: "Kurta Set",
    "kurta pant": "Kurta Set",
    coord: "Co-ord Set",
    "co ord": "Co-ord Set",
    "co-ord": "Co-ord Set",
    anarkali: "Anarkali Set",
    lehenga: "Lehenga",
    kaftan: "Kaftan",
    abaya: "Abaya",
    "dress materials": "Dress Material",
    tops: "Top",
    tunics: "Tunic",
    kurtis: "Kurti",
    salwar: "Salwar Suit",
    sharara: "Sharara Set",
    garara: "Garara Set",
    palazzo: "Palazzo Set",
    skirt: "Skirt Set",
    jumpsuits: "Jumpsuit",
    blouses: "Blouse",
    dupattas: "Dupatta",
    kids: "Kids Wear",
    children: "Kids Wear",
  };

  return aliases[normalized] ?? "Other";
}
