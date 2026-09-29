package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

var ErrInviteInvalid = errors.New("invite invalid, expired or exhausted")

type Invite struct {
	OfficeID int64
	Role     string
}

// CreateInvite returns the opaque invite token; only its hash is stored.
func (s *Store) CreateInvite(ctx context.Context, officeID int64, role string, maxUses int, ttl time.Duration, createdBy int64) (string, error) {
	if role != "admin" && role != "member" {
		return "", errors.New("invalid role")
	}
	if maxUses < 1 || maxUses > 1000 || ttl <= 0 || ttl > 90*24*time.Hour {
		return "", errors.New("invalid invite limits")
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(raw)
	var by any
	if createdBy > 0 {
		by = createdBy
	}
	now := time.Now()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO invites(office_id,token_hash,role,max_uses,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)`,
		officeID, hashToken(tok), role, maxUses, now.Add(ttl).Unix(), by, now.Unix())
	return tok, err
}

// ConsumeInvite atomically spends one use of a valid invite.
func (s *Store) ConsumeInvite(ctx context.Context, tok string) (*Invite, error) {
	if tok == "" || len(tok) > 128 {
		return nil, ErrInviteInvalid
	}
	inv := &Invite{}
	err := s.DB.QueryRowContext(ctx, `UPDATE invites SET uses = uses + 1
WHERE token_hash = ? AND revoked = 0 AND uses < max_uses AND expires_at > ?
RETURNING office_id, role`, hashToken(tok), time.Now().Unix()).Scan(&inv.OfficeID, &inv.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInviteInvalid
	}
	return inv, err
}

func (s *Store) OfficeByID(ctx context.Context, id int64) (*Office, error) {
	o := &Office{}
	err := s.DB.QueryRowContext(ctx, `SELECT id,slug,name,map_json,map_rev FROM offices WHERE id=?`, id).Scan(&o.ID, &o.Slug, &o.Name, &o.MapJSON, &o.MapRev)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (s *Store) AdminCount(ctx context.Context, officeID int64) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM memberships WHERE office_id=? AND role='admin'`, officeID).Scan(&n)
	return n, err
}
