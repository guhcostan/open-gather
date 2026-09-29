CREATE TABLE offices (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  map_json   TEXT NOT NULL,
  map_rev    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  avatar_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE memberships (
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('admin','member')),
  last_x    REAL,
  last_y    REAL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (office_id, user_id)
);

CREATE TABLE sessions (
  token_hash BLOB PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  office_id  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);
