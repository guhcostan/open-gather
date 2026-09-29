CREATE TABLE invites (
  id         INTEGER PRIMARY KEY,
  office_id  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  token_hash BLOB NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('admin','member')),
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
