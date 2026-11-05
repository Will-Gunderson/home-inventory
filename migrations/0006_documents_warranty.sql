-- Purchase, warranty and identification details (from voice notes, receipts or manual edits).
ALTER TABLE items ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN serial_number TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN purchase_date TEXT NOT NULL DEFAULT '';   -- YYYY-MM-DD or YYYY-MM or YYYY
ALTER TABLE items ADD COLUMN purchase_price REAL NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN purchase_store TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN warranty_expires TEXT NOT NULL DEFAULT ''; -- YYYY-MM-DD
ALTER TABLE items ADD COLUMN warranty_note TEXT NOT NULL DEFAULT '';

-- Receipts, manuals, warranties and other paperwork attached to an item.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other',      -- receipt | manual | warranty | other
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  pages INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX documents_item ON documents(item_id);
