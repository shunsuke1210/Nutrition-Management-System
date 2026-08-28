CREATE TABLE week_menu_plans (
  week_start_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  generation_source TEXT NOT NULL CHECK (generation_source IN ('initial', 'week_regenerate'))
);

CREATE TABLE day_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL REFERENCES week_menu_plans(week_start_date) ON DELETE CASCADE,
  day_date TEXT NOT NULL UNIQUE,
  day_index INTEGER NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  planned_kcal REAL CHECK (planned_kcal IS NULL OR planned_kcal >= 0),
  target_kcal REAL CHECK (target_kcal IS NULL OR target_kcal >= 0),
  variance_kcal REAL,
  UNIQUE(week_start_date, day_index)
);

CREATE INDEX idx_day_menus_week_start_date ON day_menus(week_start_date);

CREATE TABLE meal_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_menu_id INTEGER NOT NULL REFERENCES day_menus(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  dish_name TEXT NOT NULL,
  energy_kcal REAL NOT NULL CHECK (energy_kcal >= 0),
  protein_g REAL NOT NULL CHECK (protein_g >= 0),
  fat_g REAL NOT NULL CHECK (fat_g >= 0),
  carb_g REAL NOT NULL CHECK (carb_g >= 0),
  fiber_g REAL NOT NULL CHECK (fiber_g >= 0),
  calcium_mg REAL NOT NULL CHECK (calcium_mg >= 0),
  iron_mg REAL NOT NULL CHECK (iron_mg >= 0),
  vitamin_a_ug REAL NOT NULL CHECK (vitamin_a_ug >= 0),
  vitamin_d_ug REAL NOT NULL CHECK (vitamin_d_ug >= 0),
  vitamin_b1_mg REAL NOT NULL CHECK (vitamin_b1_mg >= 0),
  vitamin_b2_mg REAL NOT NULL CHECK (vitamin_b2_mg >= 0),
  vitamin_c_mg REAL NOT NULL CHECK (vitamin_c_mg >= 0),
  salt_equivalent_g REAL NOT NULL CHECK (salt_equivalent_g >= 0),
  generated_at TEXT NOT NULL,
  UNIQUE(day_menu_id, meal_type)
);

CREATE INDEX idx_meal_slots_day_menu_id ON meal_slots(day_menu_id);

CREATE TABLE meal_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_slot_id INTEGER NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE,
  food_id TEXT NOT NULL REFERENCES food_items(food_id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_code TEXT NOT NULL,
  quantity_g REAL NOT NULL CHECK (quantity_g > 0)
);

CREATE INDEX idx_meal_ingredients_meal_slot_id ON meal_ingredients(meal_slot_id);
CREATE INDEX idx_meal_ingredients_food_id ON meal_ingredients(food_id);
