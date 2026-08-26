CREATE TABLE exercise_routine_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scene TEXT NOT NULL CHECK (scene IN ('commute', 'work', 'after_work', 'holiday', 'other')),
  content TEXT NOT NULL,
  frequency_per_week REAL NOT NULL CHECK (frequency_per_week > 0),
  duration_minutes REAL NOT NULL CHECK (duration_minutes > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('light', 'moderate', 'vigorous')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_exercise_routine_entries_profile_id ON exercise_routine_entries(profile_id);
