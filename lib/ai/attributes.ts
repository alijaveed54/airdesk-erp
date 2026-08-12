export interface ProductAttributes {
  fabric?: string;
}

const FABRICS = [
  "Viscose Georgette",
  "Cotton Blend",
  "Khadi Cotton",
  "Rayon Blend",
  "Roman Silk",
  "Glass Silk",
  "Banarasi Silk",
  "Faux Georgette",
  "Fox Georgette",
  "Soft Organza",
  "Art Silk",
  "Cotton",
  "Linen",
  "Rayon",
  "Viscose",
  "Silk",
  "Chanderi",
  "Chiffon",
  "Georgette",
  "Organza",
  "Muslin",
  "Crepe",
  "Velvet",
  "Denim",
  "Net",
  "Satin",
  "Tissue",
  "Wool",
] as const;

export function extractFabric(text: string): string | undefined {
  const normalized = text.trim().toLowerCase();

  return FABRICS.find((fabric) =>
    normalized.includes(fabric.toLowerCase()),
  );
}

export function extractAttributes(caption: string): ProductAttributes {
  return {
    fabric: extractFabric(caption),
  };
}
