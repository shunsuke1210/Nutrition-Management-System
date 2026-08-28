CREATE TABLE unit_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id TEXT REFERENCES food_items(food_id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  grams_per_unit REAL NOT NULL CHECK (grams_per_unit > 0),
  UNIQUE(food_id, unit_code)
);

CREATE INDEX idx_unit_conversions_food_id ON unit_conversions(food_id);
