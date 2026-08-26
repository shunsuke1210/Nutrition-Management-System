CREATE TABLE daily_logs (
  log_date TEXT PRIMARY KEY,
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
  body_fat_pct REAL CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100)),
  planned_kcal REAL CHECK (planned_kcal IS NULL OR planned_kcal >= 0),
  manual_override_kcal REAL CHECK (manual_override_kcal IS NULL OR manual_override_kcal >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE exercise_log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL REFERENCES daily_logs(log_date) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  duration_minutes REAL NOT NULL CHECK (duration_minutes > 0),
  estimated_calories_burned REAL NOT NULL CHECK (estimated_calories_burned > 0)
);

CREATE INDEX idx_exercise_log_entries_log_date ON exercise_log_entries(log_date);
