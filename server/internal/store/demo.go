package store

import "context"

// ResetDemoContent restores a public demo office: the given map, no office chat, no whiteboards.
// Members, sessions and the audit log are kept.
func (s *Store) ResetDemoContent(ctx context.Context, officeID int64, mapJSON string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{`DELETE FROM chat_messages WHERE office_id=?`, `DELETE FROM whiteboards WHERE office_id=?`} {
		if _, err := tx.ExecContext(ctx, q, officeID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE offices SET map_json=?, map_rev=map_rev+1 WHERE id=?`, mapJSON, officeID); err != nil {
		return err
	}
	return tx.Commit()
}
