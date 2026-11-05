-- Main-floor rooms and entryway closets, plus a walk-through order for the room list.
INSERT OR IGNORE INTO rooms (id, name, icon, sort_order) VALUES
  ('front-entry-closet', 'Front Entryway Closet', 'closet', 1),
  ('living-room', 'Living Room', 'sofa', 2),
  ('dining-room', 'Dining Room', 'dining', 3),
  ('kitchen', 'Kitchen', 'kitchen', 4),
  ('breakfast-nook', 'Breakfast Nook', 'nook', 5),
  ('back-entry-closet', 'Back Entryway Closet', 'closet', 13);

UPDATE rooms SET sort_order = 6 WHERE id = 'office';
UPDATE rooms SET sort_order = 7 WHERE id = 'primary-bedroom';
UPDATE rooms SET sort_order = 8 WHERE id = 'otto';
UPDATE rooms SET sort_order = 9 WHERE id = 'britta';
UPDATE rooms SET sort_order = 10 WHERE id = 'nels';
UPDATE rooms SET sort_order = 11 WHERE id = 'laundry';
UPDATE rooms SET sort_order = 12 WHERE id = 'storage';
UPDATE rooms SET sort_order = 14 WHERE id = 'garage';
