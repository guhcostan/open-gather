package store

import (
	"context"
	"errors"
	"time"
)

// MaxBoardBytes bounds one saved whiteboard.
const MaxBoardBytes = 2 << 20

// SaveBoard upserts a whiteboard's strokes (JSON).
func (s *Store) SaveBoard(ctx context.Context, officeID int64, key string, data []byte) error {
	if len(data) > MaxBoardBytes || len(key) > 32 {
		return errors.New("whiteboard too large")
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO whiteboards(office_id,board_key,data,updated_at) VALUES (?,?,?,?)
ON CONFLICT(office_id,board_key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`, officeID, key, string(data), time.Now().Unix())
	return err
}

// LoadBoards returns every saved whiteboard of an office, by key.
func (s *Store) LoadBoards(ctx context.Context, officeID int64) (map[string][]byte, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT board_key, data FROM whiteboards WHERE office_id=?`, officeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]byte{}
	for rows.Next() {
		var k, d string
		if err := rows.Scan(&k, &d); err != nil {
			return nil, err
		}
		out[k] = []byte(d)
	}
	return out, rows.Err()
}
