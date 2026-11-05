-- Rooms: places in the house (plus the garage) where things live.
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every photo taken during a capture session. One photo can contain many items.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | error
  error TEXT,
  ai_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'good',
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  resale_low REAL NOT NULL DEFAULT 0,
  resale_high REAL NOT NULL DEFAULT 0,
  asking_price REAL NOT NULL DEFAULT 0,
  replacement_value REAL NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT 'keep',      -- keep | sell | donate
  decision_confirmed INTEGER NOT NULL DEFAULT 0,
  ai_reason TEXT NOT NULL DEFAULT '',
  best_platform TEXT NOT NULL DEFAULT '',
  listing_title TEXT NOT NULL DEFAULT '',
  listing_description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',            -- JSON array of strings
  bbox TEXT,                                  -- JSON {x,y,w,h} 0..1 within the photo
  image_key TEXT,                             -- cropped item photo in R2
  enhanced_key TEXT,                          -- cleaned-up (background removed / brightened) photo
  status TEXT NOT NULL DEFAULT 'active',      -- active | listed | sold | donated
  listed_on TEXT NOT NULL DEFAULT '[]',       -- JSON array of platforms
  sold_price REAL,
  price_research TEXT,                        -- JSON from the web-search price check
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX items_room ON items(room_id);
CREATE INDEX items_decision ON items(decision, status);
CREATE INDEX photos_room ON photos(room_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO rooms (id, name, icon, sort_order) VALUES
  ('office', 'Office', 'desk', 1),
  ('primary-bedroom', 'Primary Bedroom', 'bed', 2),
  ('otto', 'Otto''s Room', 'kid', 3),
  ('britta', 'Britta''s Room', 'kid', 4),
  ('nels', 'Nels''s Room', 'kid', 5),
  ('laundry', 'Laundry Room', 'laundry', 6),
  ('storage', 'Storage', 'box', 7),
  ('garage', 'Garage', 'garage', 8);

INSERT INTO settings (key, value) VALUES
  ('location', ''),
  ('sell_threshold', '20'),
  ('household_notes', 'Family home. Otto, Britta and Nels are kids; items in their rooms are mostly kids'' clothing, toys, books and furniture.');
