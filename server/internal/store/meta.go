package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
)

// InstanceID is a random identifier created once per database. It namespaces SFU room names so two
// installations (or a test run and a dev stack) can share one LiveKit server without their
// reconcilers ever touching each other's rooms.
func (s *Store) InstanceID(ctx context.Context) (string, error) {
	var v string
	err := s.DB.QueryRowContext(ctx, `SELECT value FROM meta WHERE key='instance_id'`).Scan(&v)
	if err == nil {
		return v, nil
	}
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO meta(key,value) VALUES ('instance_id', ?)`, hex.EncodeToString(b)); err != nil {
		return "", err
	}
	err = s.DB.QueryRowContext(ctx, `SELECT value FROM meta WHERE key='instance_id'`).Scan(&v)
	return v, err
}
