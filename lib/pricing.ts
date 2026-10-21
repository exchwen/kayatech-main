export type PricingSettings = {
  filamentPricePerGram: number;
  machinePricePerHour: number;
  paintLaborFee: number;
};

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  filamentPricePerGram: 4,
  machinePricePerHour: 40,
  paintLaborFee: 50
};

export const PAINT_OPTIONS = [
  { id: "none", label: "Boyasız", hex: null },
  { id: "black", label: "Siyah", hex: "#171717" },
  { id: "white", label: "Beyaz", hex: "#f1f1ed" },
  { id: "gray", label: "Gri", hex: "#8b9299" },
  { id: "red", label: "Kırmızı", hex: "#e5484d" },
  { id: "gold", label: "Altın", hex: "#d6ad43" }
] as const;

export type PaintColorId = (typeof PAINT_OPTIONS)[number]["id"];

export function normalizePricingSettings(input: unknown): PricingSettings {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  function numberOrDefault(key: keyof PricingSettings, fallback: number): number {
    const candidate = value[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 && candidate <= 1_000_000
      ? Math.round(candidate * 100) / 100
      : fallback;
  }

  return {
    filamentPricePerGram: numberOrDefault("filamentPricePerGram", DEFAULT_PRICING_SETTINGS.filamentPricePerGram),
    machinePricePerHour: numberOrDefault("machinePricePerHour", DEFAULT_PRICING_SETTINGS.machinePricePerHour),
    paintLaborFee: numberOrDefault("paintLaborFee", DEFAULT_PRICING_SETTINGS.paintLaborFee)
  };
}

export function validatePricingSettings(input: unknown): PricingSettings | null {
  if (typeof input !== "object" || input === null) return null;
  const value = input as Record<string, unknown>;
  const keys: (keyof PricingSettings)[] = ["filamentPricePerGram", "machinePricePerHour", "paintLaborFee"];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 1_000_000) {
      return null;
    }
  }
  return normalizePricingSettings(input);
}
