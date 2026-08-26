CREATE TABLE profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  height_cm REAL NOT NULL CHECK (height_cm > 0),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  age INTEGER NOT NULL CHECK (age > 0),
  gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'undisclosed')),
  body_fat_pct REAL CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100)),
  medical_notes TEXT,
  pregnancy_status TEXT NOT NULL DEFAULT 'none'
    CHECK (pregnancy_status IN ('none', 'pregnant', 'lactating')),
  sleep_hours REAL CHECK (sleep_hours IS NULL OR sleep_hours >= 0),
  alcohol_habit TEXT CHECK (alcohol_habit IS NULL OR alcohol_habit IN ('none', 'occasional', 'frequent')),
  smoking_habit TEXT CHECK (smoking_habit IS NULL OR smoking_habit IN ('non_smoker', 'smoker')),
  cooking_skill TEXT,
  cooking_time_preference TEXT,
  budget_preference TEXT,
  job_activity_level TEXT NOT NULL
    CHECK (job_activity_level IN ('mostly_sedentary', 'mixed', 'mostly_active')),
  commute_method TEXT NOT NULL CHECK (commute_method IN ('walk_or_bike', 'transit', 'car')),
  average_daily_steps INTEGER CHECK (average_daily_steps IS NULL OR average_daily_steps >= 0),
  restriction_type TEXT NOT NULL DEFAULT 'none'
    CHECK (restriction_type IN ('none', 'low_carb', 'low_fat', 'high_protein', 'calorie_only')),
  restriction_intensity TEXT
    CHECK (restriction_intensity IS NULL OR restriction_intensity IN ('light', 'standard', 'strict')),
  restriction_notes TEXT,
  diet_mode_enabled INTEGER NOT NULL DEFAULT 0 CHECK (diet_mode_enabled IN (0, 1)),
  goal_weight_kg REAL CHECK (goal_weight_kg IS NULL OR goal_weight_kg > 0),
  goal_period_weeks INTEGER CHECK (goal_period_weeks IS NULL OR goal_period_weeks > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
