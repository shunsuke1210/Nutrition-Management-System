CREATE TABLE recipe_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_slot_id INTEGER NOT NULL UNIQUE REFERENCES meal_slots(id) ON DELETE CASCADE,
  servings INTEGER NOT NULL DEFAULT 1 CHECK (servings > 0),
  cooking_time_minutes INTEGER NOT NULL CHECK (cooking_time_minutes > 0),
  steps_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE supplementary_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_detail_id INTEGER NOT NULL REFERENCES recipe_details(id) ON DELETE CASCADE,
  dish_name TEXT NOT NULL,
  energy_kcal_delta REAL NOT NULL,
  protein_g_delta REAL NOT NULL,
  fat_g_delta REAL NOT NULL,
  carb_g_delta REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_supplementary_suggestions_recipe_detail_id ON supplementary_suggestions(recipe_detail_id);

CREATE TABLE supplementary_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplementary_suggestion_id INTEGER NOT NULL REFERENCES supplementary_suggestions(id) ON DELETE CASCADE,
  food_id TEXT NOT NULL REFERENCES food_items(food_id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_code TEXT NOT NULL,
  quantity_g REAL NOT NULL CHECK (quantity_g > 0)
);

CREATE INDEX idx_supplementary_ingredients_supplementary_suggestion_id ON supplementary_ingredients(supplementary_suggestion_id);
CREATE INDEX idx_supplementary_ingredients_food_id ON supplementary_ingredients(food_id);
