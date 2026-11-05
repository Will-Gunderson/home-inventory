import { api, imgUrl, type EbayStatus, type Item } from "../api";
import { enhance } from "./image";

let statusCache: Promise<EbayStatus | null> | null = null;
export const ebayStatus = () => (statusCache ??= api.ebayStatus().catch(() => null));

/**
 * Post (or update) one item on eBay. If the item has its own cropped photo but no cleaned-up
 * version yet, cut it out onto white first, since clean photos sell better on eBay. A failed
 * clean-up never blocks the post.
 */
export async function postToEbay(item: Item, onItem: (i: Item) => void, onStep?: (msg: string) => void) {
  // Only crops (items/…) are safe to cut out; an uncropped original photo may hold many items.
  if (!item.enhanced_key && item.image_key?.startsWith("items/")) {
    try {
      onStep?.("Cleaning up photo…");
      const blob = await enhance(imgUrl(item.image_key), "white", onStep);
      item = await api.uploadItemImage(item.id, blob, "enhanced");
      onItem(item);
    } catch {
      /* post with the original crop */
    }
  }
  onStep?.("Posting to eBay…");
  const r = await api.postToEbay(item.id);
  onItem(r.item);
  return r;
}

export const EBAY_AUTOMATION_NOTE =
  "Offers of 90%+ are accepted automatically and under 70% declined. If it hasn't sold in 14 days, the price drops 10% once.";
