import type { Item } from "../api";

export type SellPlatform = "facebook" | "ebay" | "depop";

export const PLATFORM_INFO: Record<SellPlatform, { label: string; createUrl: string; note: string }> = {
  facebook: {
    label: "Facebook Marketplace",
    createUrl: "https://www.facebook.com/marketplace/create/item",
    note: "Best for furniture, kids' gear, toys and anything bulky. Local pickup, no fees.",
  },
  ebay: {
    label: "eBay",
    createUrl: "https://www.ebay.com/sl/prelist/suggest",
    note: "Best for electronics, collectibles and brand-name items worth shipping.",
  },
  depop: {
    label: "Depop",
    createUrl: "https://www.depop.com/products/create/",
    note: "Best for trendy, branded or vintage clothing and accessories.",
  },
};

const FB_CONDITION: Record<Item["condition"], string> = {
  new: "New",
  like_new: "Used - Like New",
  good: "Used - Good",
  fair: "Used - Fair",
  poor: "Used - Fair",
};

const EBAY_CONDITION: Record<Item["condition"], string> = {
  new: "New with tags / New",
  like_new: "Pre-owned - Excellent",
  good: "Pre-owned - Good",
  fair: "Pre-owned - Fair",
  poor: "For parts or not working",
};

const DEPOP_CONDITION: Record<Item["condition"], string> = {
  new: "Brand new",
  like_new: "Like new",
  good: "Used - Excellent",
  fair: "Used - Good",
  poor: "Used - Fair",
};

export const CONDITION_LABEL: Record<Item["condition"], string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export const price = (i: Item) => Math.round(i.asking_price || i.resale_high || 0);

export interface ListingField {
  label: string;
  value: string;
  multiline?: boolean;
}

export function listingFields(item: Item, platform: SellPlatform): ListingField[] {
  const title = item.listing_title || item.name;
  const details = [item.brand && `Brand: ${item.brand}`, item.size && `Size: ${item.size}`].filter(Boolean).join("\n");
  const body = [item.listing_description || item.description, details].filter(Boolean).join("\n\n");

  if (platform === "facebook") {
    return [
      { label: "Title", value: title },
      { label: "Price", value: String(price(item)) },
      { label: "Condition", value: FB_CONDITION[item.condition] },
      { label: "Description", value: `${body}\n\nPickup only. Message me if you have questions!`, multiline: true },
    ];
  }
  if (platform === "ebay") {
    return [
      { label: "Title", value: title.slice(0, 80) },
      { label: "Price", value: String(price(item)) },
      { label: "Condition", value: EBAY_CONDITION[item.condition] },
      { label: "Description", value: `${body}\n\nShips quickly from a smoke-free home.`, multiline: true },
    ];
  }
  // Depop: description carries everything; up to 5 hashtags.
  const hashtags = item.tags
    .slice(0, 5)
    .map((t) => "#" + t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 1)
    .join(" ");
  return [
    { label: "Description", value: `${title}\n\n${body}\n\n${hashtags}`.trim(), multiline: true },
    { label: "Price", value: String(price(item)) },
    { label: "Condition", value: DEPOP_CONDITION[item.condition] },
  ];
}

export function listingText(item: Item, platform: SellPlatform) {
  return listingFields(item, platform)
    .map((f) => (f.multiline ? f.value : `${f.label}: ${f.value}`))
    .join("\n\n");
}

export function suggestedPlatform(item: Item): SellPlatform {
  if (item.best_platform === "ebay" || item.best_platform === "depop" || item.best_platform === "facebook") return item.best_platform;
  return "facebook";
}

export const money = (n: number) =>
  "$" + Math.round(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const range = (i: Item) =>
  i.resale_low && i.resale_high && Math.round(i.resale_low) !== Math.round(i.resale_high)
    ? `${money(i.resale_low)}–${money(i.resale_high).slice(1)}`
    : money(i.resale_high || i.resale_low);
