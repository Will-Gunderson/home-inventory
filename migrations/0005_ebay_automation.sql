-- eBay automation: when an item went live (for the 14-day price drop) and the sales eBay reported.
ALTER TABLE items ADD COLUMN ebay_listed_at TEXT;
ALTER TABLE items ADD COLUMN ebay_price_dropped INTEGER NOT NULL DEFAULT 0;

-- One row per sold eBay line item, so the hourly sync can run repeatedly without double counting.
CREATE TABLE ebay_sales (
  line_item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  sold_at TEXT NOT NULL
);
CREATE INDEX ebay_sales_item ON ebay_sales(item_id);
