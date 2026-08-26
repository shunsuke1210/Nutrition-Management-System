CREATE TABLE ng_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE INDEX idx_ng_ingredients_profile_id ON ng_ingredients(profile_id);

CREATE TABLE preferred_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE INDEX idx_preferred_ingredients_profile_id ON preferred_ingredients(profile_id);
