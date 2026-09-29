-- Admin audit trail: who did what, never any message content.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  office_id   INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_id   INTEGER,
  target_name TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX audit_office_id ON audit_log(office_id, id);
