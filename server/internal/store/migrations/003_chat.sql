-- Office-wide chat history only. Direct messages and conversation chat are never stored.
CREATE TABLE chat_messages (
  id         INTEGER PRIMARY KEY,
  office_id  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_office_id ON chat_messages(office_id, id);
