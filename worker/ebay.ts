// One-click eBay listing through eBay's Sell APIs.
//
// Setup (once): create a keyset at developer.ebay.com, add a "User token (eBay redirect URL)"
// whose "auth accepted URL" is https://home.willgunderson.com/api/ebay/callback, then set the
// EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME secrets. Settings → Connect eBay does the rest.
//
// Posting an item: pick a category from eBay's suggestions for the title, fill the category's
// item specifics with Claude, create/replace the inventory item (SKU = item id), create or update
// its offer with the seller's business policies, and publish it.

import { fillAspects, type AspectSpec } from "./ai";

const MARKETPLACE = "EBAY_US";
const LOCATION_KEY = "home";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
].join(" ");

// Best Offer: auto-accept at 90% of the price or more, auto-decline below 70%.
const AUTO_ACCEPT = 0.9;
const AUTO_DECLINE = 0.7;
// Unsold after this many days → drop the price once by PRICE_DROP.
const PRICE_DROP_DAYS = 14;
const PRICE_DROP = 0.1;

export class EbayError extends Error {}

const sandbox = (env: Env) => env.EBAY_ENV === "sandbox";
const apiBase = (env: Env) => (sandbox(env) ? "https://api.sandbox.ebay.com" : "https://api.ebay.com");
const authBase = (env: Env) => (sandbox(env) ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com");
export const listingUrl = (env: Env, listingId: string) =>
  `${sandbox(env) ? "https://sandbox.ebay.com" : "https://www.ebay.com"}/itm/${listingId}`;

export const ebayConfigured = (env: Env) => !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_RU_NAME);

// ---------- stored state (settings table, never sent to the browser) ----------

async function getKeys(env: Env, keys: string[]): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

async function setKeys(env: Env, values: Record<string, string>) {
  await env.DB.batch(
    Object.entries(values).map(([k, v]) =>
      env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v),
    ),
  );
}

export async function ebayStatus(env: Env) {
  const s = await getKeys(env, ["ebay_refresh_token", "ebay_refresh_expires", "ebay_setup"]);
  const setup = s.ebay_setup ? (JSON.parse(s.ebay_setup) as Setup) : null;
  return {
    configured: ebayConfigured(env),
    connected: !!s.ebay_refresh_token && Number(s.ebay_refresh_expires || 0) > Date.now(),
    sandbox: sandbox(env),
    policies: setup?.names ?? null,
  };
}

export async function disconnect(env: Env) {
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'ebay_%' AND key != 'ebay_postal_code'").run();
}

// ---------- OAuth ----------

export function authorizeUrl(env: Env, state: string) {
  const u = new URL(`${authBase(env)}/oauth2/authorize`);
  u.searchParams.set("client_id", env.EBAY_CLIENT_ID!);
  u.searchParams.set("redirect_uri", env.EBAY_RU_NAME!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(env: Env, body: Record<string, string>) {
  const res = await fetch(`${apiBase(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`),
    },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new EbayError(`eBay sign-in failed: ${data.error_description || data.error || res.status}`);
  }
  return data;
}

export async function exchangeCode(env: Env, code: string) {
  const t = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: env.EBAY_RU_NAME! });
  await setKeys(env, {
    ebay_refresh_token: t.refresh_token ?? "",
    ebay_refresh_expires: String(Date.now() + (t.refresh_token_expires_in ?? 0) * 1000),
    ebay_access_token: t.access_token!,
    ebay_access_expires: String(Date.now() + (t.expires_in ?? 7200) * 1000),
  });
}

async function userToken(env: Env): Promise<string> {
  const s = await getKeys(env, ["ebay_access_token", "ebay_access_expires", "ebay_refresh_token", "ebay_refresh_expires"]);
  if (s.ebay_access_token && Number(s.ebay_access_expires) > Date.now() + 60_000) return s.ebay_access_token;
  if (!s.ebay_refresh_token || Number(s.ebay_refresh_expires || 0) < Date.now()) {
    throw new EbayError("Connect your eBay account in Settings first.");
  }
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: s.ebay_refresh_token, scope: SCOPES });
  await setKeys(env, {
    ebay_access_token: t.access_token!,
    ebay_access_expires: String(Date.now() + (t.expires_in ?? 7200) * 1000),
  });
  return t.access_token!;
}

// Taxonomy and Metadata calls use an application token (client credentials).
async function appToken(env: Env): Promise<string> {
  const s = await getKeys(env, ["ebay_app_token", "ebay_app_expires"]);
  if (s.ebay_app_token && Number(s.ebay_app_expires) > Date.now() + 60_000) return s.ebay_app_token;
  const t = await tokenRequest(env, { grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
  await setKeys(env, { ebay_app_token: t.access_token!, ebay_app_expires: String(Date.now() + (t.expires_in ?? 7200) * 1000) });
  return t.access_token!;
}

// ---------- API helper ----------

type EbayErr = { errorId?: number; message?: string; longMessage?: string; parameters?: { name: string; value: string }[] };

class EbayApiError extends EbayError {
  constructor(
    public status: number,
    public errors: EbayErr[],
  ) {
    const e = errors[0];
    super(`eBay: ${e?.longMessage || e?.message || `request failed (${status})`}`);
  }
}

async function call<T>(env: Env, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiBase(env) + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new EbayApiError(res.status, data.errors ?? []);
  return data as T;
}

// ---------- one-time seller setup: business policies + ship-from location ----------

interface Setup {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  names: { shipping: string; payment: string; returns: string };
}

type Policy = {
  name: string;
  categoryTypes?: { name: string; default?: boolean }[];
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
};

function pick<P extends Policy>(list: P[] | undefined): P | undefined {
  const usable = (list ?? []).filter((p) => !p.categoryTypes || p.categoryTypes.some((c) => c.name === "ALL_EXCLUDING_MOTORS_VEHICLES"));
  return usable.find((p) => p.categoryTypes?.some((c) => c.default)) ?? usable[0];
}

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

async function ensureSetup(env: Env, token: string, postalCode: string): Promise<Setup> {
  const cached = await getKeys(env, ["ebay_setup"]);
  if (cached.ebay_setup) return JSON.parse(cached.ebay_setup) as Setup;

  const q = `?marketplace_id=${MARKETPLACE}`;
  const load = () =>
    Promise.all([
      call<{ fulfillmentPolicies?: Policy[] }>(env, token, "GET", `/sell/account/v1/fulfillment_policy${q}`),
      call<{ paymentPolicies?: Policy[] }>(env, token, "GET", `/sell/account/v1/payment_policy${q}`),
      call<{ returnPolicies?: Policy[] }>(env, token, "GET", `/sell/account/v1/return_policy${q}`),
    ]);

  let lists;
  try {
    lists = await load();
  } catch (e) {
    // Accounts not yet on business policies: opt in, then the policies can be read/created.
    if (!(e instanceof EbayApiError) || e.errors[0]?.errorId !== 20403) throw e;
    await call(env, token, "POST", "/sell/account/v1/program/opt_in", { programType: "SELLING_POLICY_MANAGEMENT" }).catch(() => {});
    throw new EbayError("Turned on eBay business policies for your account. eBay takes a few minutes to process that; try again shortly.");
  }
  const [f, p, r] = lists;
  let ship: Policy | undefined = pick(f.fulfillmentPolicies);
  let pay: Policy | undefined = pick(p.paymentPolicies);
  let ret: Policy | undefined = pick(r.returnPolicies);

  // Create simple defaults for anything missing. They can be edited on eBay afterwards.
  if (!ship) {
    ship = await call<Policy>(env, token, "POST", "/sell/account/v1/fulfillment_policy", {
      name: "Home Inventory: USPS Ground $8.95",
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      handlingTime: { value: 3, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            { sortOrder: 1, shippingCarrierCode: "USPS", shippingServiceCode: "USPSGroundAdvantage", shippingCost: { value: "8.95", currency: "USD" } },
          ],
        },
      ],
    });
  }
  if (!pay) {
    pay = await call<Policy>(env, token, "POST", "/sell/account/v1/payment_policy", {
      name: "Home Inventory: immediate payment",
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      immediatePay: true,
    });
  }
  if (!ret) {
    ret = await call<Policy>(env, token, "POST", "/sell/account/v1/return_policy", {
      name: "Home Inventory: no returns",
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: false,
    });
  }

  // Ship-from location.
  const locs = await call<{ locations?: { merchantLocationKey: string; merchantLocationStatus?: string }[] }>(
    env, token, "GET", "/sell/inventory/v1/location?limit=100",
  );
  if (!locs.locations?.some((l) => l.merchantLocationKey === LOCATION_KEY)) {
    if (!/^\d{5}(-\d{4})?$/.test(postalCode)) {
      throw new EbayError("Add your ZIP code in Settings → eBay so eBay knows where items ship from.");
    }
    await call(env, token, "POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
      location: { address: { postalCode, country: "US" } },
      locationTypes: ["WAREHOUSE"],
      name: "Home",
      merchantLocationStatus: "ENABLED",
    });
  }

  const setup: Setup = {
    fulfillmentPolicyId: ship.fulfillmentPolicyId!,
    paymentPolicyId: pay.paymentPolicyId!,
    returnPolicyId: ret.returnPolicyId!,
    names: { shipping: ship.name, payment: pay.name, returns: ret.name },
  };
  await setKeys(env, { ebay_setup: JSON.stringify(setup) });
  return setup;
}

// ---------- category, condition, item specifics ----------

async function suggestCategory(env: Env, token: string, query: string) {
  const r = await call<{
    categorySuggestions?: { category: { categoryId: string; categoryName: string }; categoryTreeNodeAncestors?: { categoryName: string }[] }[];
  }>(env, token, "GET", `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query.slice(0, 350))}`);
  const s = r.categorySuggestions?.[0];
  if (!s) throw new EbayError(`eBay couldn't suggest a category for “${query}”. Try editing the listing title.`);
  const path = [...(s.categoryTreeNodeAncestors ?? []).map((a) => a.categoryName).reverse(), s.category.categoryName].join(" > ");
  return { id: s.category.categoryId, path };
}

async function categoryAspects(env: Env, token: string, categoryId: string): Promise<AspectSpec[]> {
  const r = await call<{
    aspects?: {
      localizedAspectName: string;
      aspectConstraint: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string; aspectMaxLength?: number; itemToAspectCardinality?: string };
      aspectValues?: { localizedValue: string }[];
    }[];
  }>(env, token, "GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`);
  return (r.aspects ?? [])
    .filter((a) => a.aspectConstraint.aspectRequired || a.aspectConstraint.aspectUsage === "RECOMMENDED")
    .slice(0, 25)
    .map((a) => ({
      name: a.localizedAspectName,
      required: !!a.aspectConstraint.aspectRequired,
      selectionOnly: a.aspectConstraint.aspectMode === "SELECTION_ONLY",
      maxLength: a.aspectConstraint.aspectMaxLength ?? 65,
      values: (a.aspectValues ?? []).slice(0, 80).map((v) => v.localizedValue),
    }));
}

// eBay condition IDs → Inventory API enum.
const CONDITION_ENUM: Record<string, string> = {
  "1000": "NEW", "1500": "NEW_OTHER", "1750": "NEW_WITH_DEFECTS", "2750": "LIKE_NEW", "2990": "PRE_OWNED_EXCELLENT",
  "3000": "USED_EXCELLENT", "3010": "PRE_OWNED_FAIR", "4000": "USED_VERY_GOOD", "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE", "7000": "FOR_PARTS_OR_NOT_WORKING",
};
// Our condition → eBay condition IDs, most fitting first. 3000 means "Used" in most categories
// and "Pre-owned - Good" in clothing.
const CONDITION_PREF: Record<string, string[]> = {
  new: ["1000", "1500"],
  like_new: ["2750", "2990", "4000", "3000"],
  good: ["5000", "3000", "4000"],
  fair: ["6000", "3010", "3000"],
  poor: ["7000", "6000", "3010", "3000"],
};

async function pickCondition(env: Env, token: string, categoryId: string, condition: string): Promise<string> {
  const prefs = CONDITION_PREF[condition] ?? CONDITION_PREF.good;
  try {
    const r = await call<{ itemConditionPolicies?: { itemConditions?: { conditionId: string }[] }[] }>(
      env, token, "GET",
      `/sell/metadata/v1/marketplace/${MARKETPLACE}/get_item_condition_policies?filter=categoryIds:%7B${categoryId}%7D`,
    );
    const allowed = new Set((r.itemConditionPolicies?.[0]?.itemConditions ?? []).map((c) => c.conditionId).filter((id) => id in CONDITION_ENUM));
    if (allowed.size) {
      const id = prefs.find((p) => allowed.has(p)) ?? [...allowed].find((a) => (condition === "new") === (a < "2000")) ?? [...allowed][0];
      return CONDITION_ENUM[id];
    }
  } catch {
    /* fall through to the default mapping */
  }
  return CONDITION_ENUM[prefs[0]];
}

// ---------- publish / end ----------

export interface ListingInput {
  sku: string;
  title: string;
  description: string;
  name: string;
  brand: string;
  size: string;
  condition: string;
  category: string;
  quantity: number;
  price: number;
  imageUrls: string[];
}

const usd = (n: number) => ({ value: n.toFixed(2), currency: "USD" });

function bestOfferTerms(price: number) {
  return {
    bestOfferEnabled: true,
    autoAcceptPrice: usd(Math.floor(price * AUTO_ACCEPT * 100) / 100),
    autoDeclinePrice: usd(Math.floor(price * AUTO_DECLINE * 100) / 100),
  };
}

// Some categories don't allow Best Offer; retry those without it.
async function withBestOffer<T>(send: (bestOffer: boolean) => Promise<T>): Promise<T> {
  try {
    return await send(true);
  } catch (e) {
    if (e instanceof EbayApiError && /best ?offer/i.test(e.message)) return send(false);
    throw e;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function publishListing(env: Env, item: ListingInput, postalCode: string) {
  if (!ebayConfigured(env)) throw new EbayError("eBay isn't set up yet (missing EBAY_* secrets).");
  if (!item.imageUrls.length) throw new EbayError("eBay needs at least one photo.");
  if (!(item.price > 0)) throw new EbayError("Set an asking price first.");

  const token = await userToken(env);
  const app = await appToken(env);
  const setup = await ensureSetup(env, token, postalCode);

  const category = await suggestCategory(env, app, item.title);
  const [specs, condition] = await Promise.all([
    categoryAspects(env, app, category.id),
    pickCondition(env, app, category.id, item.condition),
  ]);
  const aspects = await fillAspects(env, item, category.path, specs);

  await call(env, token, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(item.sku)}`, {
    availability: { shipToLocationAvailability: { quantity: item.quantity } },
    condition,
    product: {
      title: item.title.slice(0, 80),
      description: item.description,
      aspects,
      imageUrls: item.imageUrls.slice(0, 24),
    },
  });

  const offerBody = {
    sku: item.sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: item.quantity,
    categoryId: category.id,
    listingDescription: escapeHtml(item.description).replace(/\n/g, "<br>"),
    listingPolicies: {
      fulfillmentPolicyId: setup.fulfillmentPolicyId,
      paymentPolicyId: setup.paymentPolicyId,
      returnPolicyId: setup.returnPolicyId,
    },
    pricingSummary: { price: usd(item.price) },
    merchantLocationKey: LOCATION_KEY,
  };
  const body = (bestOffer: boolean) =>
    bestOffer ? { ...offerBody, listingPolicies: { ...offerBody.listingPolicies, bestOfferTerms: bestOfferTerms(item.price) } } : offerBody;

  const existing = await call<{ offers?: { offerId: string; status: string; listing?: { listingId?: string } }[] }>(
    env, token, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}&marketplace_id=${MARKETPLACE}`,
  ).catch(() => ({ offers: [] }));
  const offer = existing.offers?.[0];

  let offerId: string;
  if (offer) {
    offerId = offer.offerId;
    // Updating a live offer revises the eBay listing in place.
    await withBestOffer((bo) => call(env, token, "PUT", `/sell/inventory/v1/offer/${offerId}`, body(bo)));
    if (offer.status === "PUBLISHED" && offer.listing?.listingId) {
      const listingId = offer.listing.listingId;
      return { offerId, listingId, url: listingUrl(env, listingId), category: category.path, revised: true };
    }
  } else {
    offerId = (await withBestOffer((bo) => call<{ offerId: string }>(env, token, "POST", "/sell/inventory/v1/offer", body(bo)))).offerId;
  }

  const { listingId } = await call<{ listingId: string }>(env, token, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  return { offerId, listingId, url: listingUrl(env, listingId), category: category.path, revised: false };
}

export async function endListing(env: Env, offerId: string) {
  const token = await userToken(env);
  await call(env, token, "POST", `/sell/inventory/v1/offer/${offerId}/withdraw`);
}

// ---------- hourly automation (cron) ----------

const sqlNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/** Record eBay sales and mark items sold once every unit is gone. Safe to run repeatedly. */
export async function syncSales(env: Env) {
  const token = await userToken(env);
  const s = await getKeys(env, ["ebay_sales_checked"]);
  // Look back from the last check (with a day of overlap), or 30 days the first time.
  const since = new Date(Math.max(Number(s.ebay_sales_checked || 0) - 86400_000, Date.now() - 30 * 86400_000));
  const started = Date.now();

  type Order = {
    orderId: string;
    creationDate: string;
    orderPaymentStatus: string;
    cancelStatus?: { cancelState?: string };
    lineItems: { lineItemId: string; sku?: string; quantity: number; lineItemCost?: { value: string } }[];
  };
  const touched = new Set<string>();
  let path: string | null = `/sell/fulfillment/v1/order?limit=200&filter=${encodeURIComponent(`creationdate:[${since.toISOString()}..]`)}`;
  while (path) {
    const page: { orders?: Order[]; next?: string } = await call(env, token, "GET", path);
    for (const o of page.orders ?? []) {
      if (o.cancelStatus?.cancelState === "CANCELED") continue;
      if (!["PAID", "PARTIALLY_REFUNDED"].includes(o.orderPaymentStatus)) continue;
      for (const li of o.lineItems) {
        if (!li.sku) continue;
        const exists = await env.DB.prepare("SELECT 1 FROM items WHERE id = ?").bind(li.sku).first();
        if (!exists) continue;
        await env.DB.prepare(
          "INSERT OR IGNORE INTO ebay_sales (line_item_id, order_id, item_id, quantity, amount, sold_at) VALUES (?,?,?,?,?,?)",
        )
          .bind(li.lineItemId, o.orderId, li.sku, li.quantity || 1, Number(li.lineItemCost?.value) || 0, o.creationDate)
          .run();
        touched.add(li.sku);
      }
    }
    path = page.next ? page.next.replace(/^https:\/\/[^/]+/, "") : null;
  }

  for (const id of touched) {
    await env.DB.prepare(
      `UPDATE items SET
         sold_price = (SELECT SUM(amount) FROM ebay_sales WHERE item_id = items.id),
         status = CASE WHEN (SELECT SUM(quantity) FROM ebay_sales WHERE item_id = items.id) >= quantity THEN 'sold' ELSE status END,
         decision = 'sell', decision_confirmed = 1, updated_at = ?
       WHERE id = ?`,
    )
      .bind(sqlNow(), id)
      .run();
  }
  await setKeys(env, { ebay_sales_checked: String(started) });
  return touched.size;
}

/** Drop the price once on eBay listings that haven't sold after PRICE_DROP_DAYS. */
export async function dropStalePrices(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id, asking_price, resale_high, ebay_offer_id FROM items
      WHERE status = 'listed' AND ebay_listing_id IS NOT NULL AND ebay_offer_id IS NOT NULL
        AND ebay_price_dropped = 0 AND ebay_listed_at < datetime('now', ?)`,
  )
    .bind(`-${PRICE_DROP_DAYS} days`)
    .all<{ id: string; asking_price: number; resale_high: number; ebay_offer_id: string }>();
  if (!results.length) return 0;
  const token = await userToken(env);
  let dropped = 0;
  for (const it of results) {
    const price = Math.max(1, Math.round((it.asking_price || it.resale_high) * (1 - PRICE_DROP)));
    try {
      const o = await call<Record<string, any>>(env, token, "GET", `/sell/inventory/v1/offer/${it.ebay_offer_id}`);
      const base = {
        sku: o.sku,
        marketplaceId: o.marketplaceId,
        format: o.format,
        availableQuantity: o.availableQuantity,
        categoryId: o.categoryId,
        listingDescription: o.listingDescription,
        merchantLocationKey: o.merchantLocationKey,
        pricingSummary: { price: usd(price) },
      };
      const { bestOfferTerms: _old, ...policies } = o.listingPolicies ?? {};
      await withBestOffer((bo) =>
        call(env, token, "PUT", `/sell/inventory/v1/offer/${it.ebay_offer_id}`, {
          ...base,
          listingPolicies: bo ? { ...policies, bestOfferTerms: bestOfferTerms(price) } : policies,
        }),
      );
      await env.DB.prepare("UPDATE items SET asking_price = ?, ebay_price_dropped = 1, updated_at = ? WHERE id = ?")
        .bind(price, sqlNow(), it.id)
        .run();
      dropped++;
    } catch (e) {
      console.error("price drop failed", it.id, e);
    }
  }
  return dropped;
}

/** Cron entry point: does nothing until an eBay account is connected. */
export async function ebayCron(env: Env) {
  if (!ebayConfigured(env) || !(await ebayStatus(env)).connected) return;
  try {
    await syncSales(env);
  } catch (e) {
    console.error("eBay sales sync failed", e);
  }
  try {
    await dropStalePrices(env);
  } catch (e) {
    console.error("eBay price drop failed", e);
  }
}
