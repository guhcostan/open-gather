-- Shared whiteboards: one row per board, the strokes as a JSON array (bounded by the server).
CREATE TABLE whiteboards (
  office_id  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  board_key  TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (office_id, board_key)
);
