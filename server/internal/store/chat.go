package store

import "context"

// ChatRow is one persisted office-chat message.
type ChatRow struct {
	UserID int64
	Name   string
	Text   string
	TS     int64 // unix milliseconds
}

const chatKeep = 500 // messages kept per office

// AppendChat stores an office-chat message and prunes old ones.
func (s *Store) AppendChat(ctx context.Context, officeID, userID int64, text string, tsMillis int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO chat_messages(office_id,user_id,text,created_at) VALUES (?,?,?,?)`, officeID, userID, text, tsMillis); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_messages WHERE office_id=? AND id <= (SELECT id FROM chat_messages WHERE office_id=? ORDER BY id DESC LIMIT 1 OFFSET ?)`, officeID, officeID, chatKeep); err != nil {
		return err
	}
	return tx.Commit()
}

// RecentChat returns the last n messages, oldest first.
func (s *Store) RecentChat(ctx context.Context, officeID int64, n int) ([]ChatRow, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT c.user_id, u.name, c.text, c.created_at
FROM chat_messages c JOIN users u ON u.id = c.user_id
WHERE c.office_id = ? ORDER BY c.id DESC LIMIT ?`, officeID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatRow
	for rows.Next() {
		var r ChatRow
		if err := rows.Scan(&r.UserID, &r.Name, &r.Text, &r.TS); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}
