CREATE TABLE satisfaction_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  dish_name TEXT NOT NULL,
  primary_food_ids TEXT NOT NULL,
  liked INTEGER NOT NULL CHECK (liked IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(week_start_date, day_index, meal_type)
);
