import Anthropic from "@anthropic-ai/sdk";

export const CATEGORIES = [
  "clothing",
  "shoes",
  "accessories",
  "furniture",
  "electronics",
  "toys",
  "books",
  "media",
  "sports",
  "outdoor",
  "tools",
  "kitchen",
  "appliances",
  "decor",
  "bedding",
  "baby",
  "collectibles",
  "office",
  "other",
] as const;

export const CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export const DECISIONS = ["keep", "sell", "donate"] as const;
export const PLATFORMS = ["ebay", "facebook", "depop", "garage_sale", "donate"] as const;

export interface DetectedItem {
  name: string;
  category: (typeof CATEGORIES)[number];
  brand: string;
  description: string;
  condition: (typeof CONDITIONS)[number];
  size: string;
  quantity: number;
  resale_low: number;
  resale_high: number;
  asking_price: number;
  replacement_value: number;
  recommendation: (typeof DECISIONS)[number];
  recommendation_reason: string;
  best_platform: (typeof PLATFORMS)[number];
  listing_title: string;
  listing_description: string;
  tags: string[];
  bbox: { x: number; y: number; w: number; h: number };
}

export interface PhotoAnalysis {
  items: DetectedItem[];
  photo_notes: string;
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "photo_notes"],
  properties: {
    photo_notes: { type: "string", description: "One short sentence about the photo, e.g. what was skipped and why." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name", "category", "brand", "description", "condition", "size", "quantity",
          "resale_low", "resale_high", "asking_price", "replacement_value",
          "recommendation", "recommendation_reason", "best_platform",
          "listing_title", "listing_description", "tags", "bbox",
        ],
        properties: {
          name: { type: "string", description: "Short specific name, e.g. 'Patagonia Down Sweater Jacket (kids M)'" },
          category: { type: "string", enum: [...CATEGORIES] },
          brand: { type: "string", description: "Brand if visible or confidently recognizable, else empty string" },
          description: { type: "string", description: "1-2 factual sentences: material, color, notable features, visible wear" },
          condition: { type: "string", enum: [...CONDITIONS] },
          size: { type: "string", description: "Clothing/shoe size or dimensions if knowable, else empty string" },
          quantity: { type: "integer" },
          resale_low: { ...num, description: "Realistic used-market price in USD, low end" },
          resale_high: { ...num, description: "Realistic used-market price in USD, high end" },
          asking_price: { ...num, description: "Suggested list price in USD for a reasonably quick sale" },
          replacement_value: { ...num, description: "Cost to buy a comparable item new today in USD (for insurance)" },
          recommendation: { type: "string", enum: [...DECISIONS] },
          recommendation_reason: { type: "string", description: "One short sentence" },
          best_platform: { type: "string", enum: [...PLATFORMS] },
          listing_title: { type: "string", description: "Marketplace title, max 80 characters, keyword-rich, no emojis" },
          listing_description: { type: "string", description: "3-5 sentence listing body in a friendly, honest voice. Mention condition and size." },
          tags: { type: "array", items: str, description: "3-8 lowercase search keywords" },
          bbox: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "w", "h"],
            description: "Approximate bounding box of the item as fractions (0-1) of image width/height; x,y is the top-left corner",
            properties: { x: num, y: num, w: num, h: num },
          },
        },
      },
    },
  },
} as const;

function client(env: Env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function model(env: Env) {
  return env.CLAUDE_MODEL || "claude-opus-5-5";
}

export class AiError extends Error {}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  if (msg.stop_reason === "refusal") {
    throw new AiError("The AI declined to process this request.");
  }
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export interface AnalyzeContext {
  roomName: string;
  location: string;
  householdNotes: string;
  sellThreshold: number;
  hint?: string;
}

const ANALYZE_SYSTEM = `You catalog a family's belongings from photos for a home inventory app. The owner is a minimalist who wants three things from each photo: a record of what they own (for insurance), a realistic value for each item, and a suggestion of whether to keep, sell or donate it.

How to catalog a photo:
- List each distinct, ownable item that is clearly visible. Group identical or near-identical small things into one entry with a quantity (e.g. "Kids' graphic t-shirts, size 6", quantity 5) instead of listing each one.
- Skip fixtures that come with the house (walls, built-in shelves, light switches, outlets, windows, flooring) and trash.
- If the photo is blurry or ambiguous, still give your best identification and say so in the description.
- Prices are for the US used market (Facebook Marketplace, eBay, Depop sold listings), not retail. Kids' clothing and generic furniture resell for much less than people expect; be realistic. Recognized brands, vintage items, electronics and tools hold value better.
- Replacement value is what it would cost to buy a comparable item new today.

Keep / sell / donate:
- "keep" for things that look actively used or essential (the bed someone sleeps in, a desk in use, everyday appliances) and anything that looks sentimental or irreplaceable (artwork by kids, heirlooms, photos).
- Otherwise "sell" when the realistic resale high is at or above the owner's sell threshold, and "donate" when it is below (selling isn't worth the hassle).
- best_platform: "depop" for trendy, branded or vintage clothing and accessories aimed at younger buyers; "ebay" for electronics, collectibles, brand-name items, and anything small and shippable that is worth over about $40; "facebook" for furniture, large or bulky items, kids' gear, toys and everyday household goods; "garage_sale" for low-value items worth selling only in a bundle; "donate" when recommending donation.

Listing copy should be honest, specific and ready to paste.`;

export async function analyzePhoto(
  env: Env,
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  ctx: AnalyzeContext,
): Promise<PhotoAnalysis> {
  if (env.MOCK_AI === "1") return mockAnalysis(ctx);
  const details = [
    `Room: ${ctx.roomName}`,
    ctx.location ? `Owner's location (for local pricing): ${ctx.location}` : "",
    ctx.householdNotes ? `Household notes: ${ctx.householdNotes}` : "",
    `Owner's sell threshold: $${ctx.sellThreshold}`,
    ctx.hint ? `Owner's note about this photo: ${ctx.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client(env).beta.messages.create({
    model: model(env),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown> },
    },
    system: ANALYZE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: `${details}\n\nCatalog the items in this photo.` },
        ],
      },
    ],
  });

  const text = textOf(msg);
  let parsed: PhotoAnalysis;
  try {
    parsed = JSON.parse(text) as PhotoAnalysis;
  } catch {
    throw new AiError(
      msg.stop_reason === "max_tokens" ? "Too many items in one photo; try a closer shot." : "Couldn't read the AI's response.",
    );
  }
  for (const item of parsed.items) {
    item.quantity = Math.max(1, Math.round(item.quantity || 1));
    item.bbox = clampBox(item.bbox);
    item.listing_title = item.listing_title.slice(0, 80);
  }
  return parsed;
}

function clampBox(b: { x: number; y: number; w: number; h: number }) {
  const c = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = c(b?.x);
  const y = c(b?.y);
  return { x, y, w: Math.max(0.02, Math.min(1 - x, c(b?.w))), h: Math.max(0.02, Math.min(1 - y, c(b?.h))) };
}

export interface PriceResearch {
  resale_low: number;
  resale_high: number;
  asking_price: number;
  replacement_value: number;
  summary: string;
  comparables: { title: string; price: number; url: string; sold: boolean }[];
  checked_at: string;
}

/** Look up real comparable listings with web search and return a refined price. */
export async function researchPrice(
  env: Env,
  item: { name: string; brand: string; condition: string; size: string; description: string; category: string },
  location: string,
): Promise<PriceResearch> {
  if (env.MOCK_AI === "1") {
    return {
      resale_low: 30, resale_high: 45, asking_price: 40, replacement_value: 130,
      summary: "Mock: similar chairs sold for $30-45.",
      comparables: [{ title: "Wood desk chair (mock)", price: 38, url: "https://example.com", sold: true }],
      checked_at: new Date().toISOString(),
    };
  }
  const prompt = `Find the realistic used resale price for this item by searching for comparable listings, preferring recently SOLD listings (eBay sold, Facebook Marketplace, Depop, Poshmark, Mercari).

Item: ${item.name}
Brand: ${item.brand || "unknown"}
Category: ${item.category}
Condition: ${item.condition}
Size: ${item.size || "n/a"}
Details: ${item.description}
${location ? `Seller location: ${location}` : ""}

Do at most a few searches. Then reply with only a JSON object (no prose before or after) of this shape:
{"resale_low": number, "resale_high": number, "asking_price": number, "replacement_value": number, "summary": "1-2 sentences on what you found", "comparables": [{"title": string, "price": number, "url": string, "sold": boolean}]}
Include up to 5 comparables you actually found. Prices in USD.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let msg: Anthropic.Beta.BetaMessage | undefined;
  // Server tools can pause a long turn; send it back so the server continues.
  for (let i = 0; i < 4; i++) {
    msg = await client(env).beta.messages.create({
      model: model(env),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  const text = textOf(msg!);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const r = JSON.parse(json) as Omit<PriceResearch, "checked_at">;
    return {
      resale_low: Number(r.resale_low) || 0,
      resale_high: Number(r.resale_high) || 0,
      asking_price: Number(r.asking_price) || 0,
      replacement_value: Number(r.replacement_value) || 0,
      summary: String(r.summary ?? ""),
      comparables: Array.isArray(r.comparables) ? r.comparables.slice(0, 5) : [],
      checked_at: new Date().toISOString(),
    };
  } catch {
    throw new AiError("Couldn't read the price research result.");
  }
}

export interface BundleItem {
  name: string;
  condition: string;
  size: string;
  asking_price: number;
  quantity: number;
}

/** Write one combined post (garage sale or Marketplace bundle) for many items. */
export async function writeBundlePost(
  env: Env,
  items: BundleItem[],
  opts: { kind: "garage_sale" | "marketplace_bundle"; location: string; details: string },
): Promise<{ title: string; body: string; total: number }> {
  if (env.MOCK_AI === "1") {
    return {
      title: "Mock bundle post",
      body: items.map((i) => `- ${i.name} $${i.asking_price}`).join("\n"),
      total: items.reduce((s, i) => s + i.asking_price * i.quantity, 0),
    };
  }
  const list = items
    .map((i) => `- ${i.name}${i.size ? ` (size ${i.size})` : ""}, ${i.condition.replace("_", " ")}, qty ${i.quantity}, $${i.asking_price}`)
    .join("\n");
  const kindText =
    opts.kind === "garage_sale"
      ? "a garage sale announcement for Facebook Marketplace / local groups / Nextdoor. Group items by type and list highlights with prices; mention that everything else is priced to go."
      : "a single Facebook Marketplace post selling these items, individually priced, with a discount if someone buys several. Group items by type.";

  const msg = await client(env).beta.messages.create({
    model: model(env),
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "body"],
          properties: {
            title: { type: "string", description: "Post title, max 80 characters" },
            body: { type: "string", description: "Post body, plain text with line breaks; short bullet lines are fine" },
          },
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `Write ${kindText}\n\n${opts.location ? `Location: ${opts.location}\n` : ""}${opts.details ? `Seller's details (date, time, address, pickup notes): ${opts.details}\n` : ""}\nItems:\n${list}\n\nKeep it friendly and scannable. Don't invent details that aren't given; leave a [date/time] placeholder if the seller didn't give one.`,
      },
    ],
  });
  const r = JSON.parse(textOf(msg)) as { title: string; body: string };
  const total = items.reduce((s, i) => s + i.asking_price * i.quantity, 0);
  return { title: r.title.slice(0, 80), body: r.body, total };
}

/** Local-dev stand-in so the UI can be exercised without an API key (set MOCK_AI=1 in .dev.vars). */
function mockAnalysis(ctx: AnalyzeContext): PhotoAnalysis {
  const base = {
    brand: "", size: "", quantity: 1, tags: ["sample"], best_platform: "facebook" as const,
    listing_description: "Sample listing description generated in mock mode.",
  };
  return {
    photo_notes: `Mock analysis for ${ctx.roomName}.`,
    items: [
      { ...base, name: "Wooden desk chair", category: "furniture", description: "Mock item.", condition: "good",
        resale_low: 25, resale_high: 40, asking_price: 35, replacement_value: 120, recommendation: "sell",
        recommendation_reason: "Solid furniture resells well locally.", listing_title: "Solid wood desk chair",
        bbox: { x: 0.05, y: 0.1, w: 0.4, h: 0.6 } },
      { ...base, name: "Kids' graphic t-shirts, size 6", category: "clothing", description: "Mock item.", condition: "fair",
        quantity: 4, resale_low: 2, resale_high: 4, asking_price: 3, replacement_value: 12, recommendation: "donate",
        recommendation_reason: "Low resale value.", best_platform: "donate", listing_title: "Kids graphic tees size 6",
        bbox: { x: 0.55, y: 0.2, w: 0.35, h: 0.5 } },
    ],
  };
}
