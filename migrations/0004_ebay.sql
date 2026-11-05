-- Direct eBay listing: the eBay offer and live listing for each item.
ALTER TABLE items ADD COLUMN ebay_offer_id TEXT;
ALTER TABLE items ADD COLUMN ebay_listing_id TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES ('ebay_postal_code', '');
