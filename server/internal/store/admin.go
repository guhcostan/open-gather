package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var (
	ErrLastAdmin   = errors.New("an office needs at least one admin")
	ErrInvalidRole = errors.New("invalid role")
)

// Member is one row of the admin member list.
type Member struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	JoinedAt int64  `json:"joinedAt"`
}

// ListMembers returns the office members, admins first, then by join time.
func (s *Store) ListMembers(ctx context.Context, officeID int64) ([]Member, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT u.id, u.name, m.role, m.joined_at
FROM memberships m JOIN users u ON u.id = m.user_id
WHERE m.office_id = ?
ORDER BY (m.role = 'admin') DESC, m.joined_at, u.id`, officeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.Name, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SetRole changes a member's role. The last admin cannot be demoted.
func (s *Store) SetRole(ctx context.Context, officeID, userID int64, role string) (name, oldRole string, err error) {
	if role != "admin" && role != "member" {
		return "", "", ErrInvalidRole
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, `SELECT u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.office_id=? AND m.user_id=?`, officeID, userID).Scan(&name, &oldRole)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	if oldRole == role {
		return name, oldRole, tx.Commit()
	}
	if oldRole == "admin" {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memberships WHERE office_id=? AND role='admin'`, officeID).Scan(&n); err != nil {
			return "", "", err
		}
		if n <= 1 {
			return "", "", ErrLastAdmin
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memberships SET role=? WHERE office_id=? AND user_id=?`, role, officeID, userID); err != nil {
		return "", "", err
	}
	return name, oldRole, tx.Commit()
}

// RemoveMember deletes the membership and every session of the user in that
// office. The user row stays so that old chat lines and the audit trail keep a
// name. The last admin cannot be removed.
func (s *Store) RemoveMember(ctx context.Context, officeID, userID int64) (name string, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var role string
	err = tx.QueryRowContext(ctx, `SELECT u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.office_id=? AND m.user_id=?`, officeID, userID).Scan(&name, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if role == "admin" {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memberships WHERE office_id=? AND role='admin'`, officeID).Scan(&n); err != nil {
			return "", err
		}
		if n <= 1 {
			return "", ErrLastAdmin
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=? AND office_id=?`, userID, officeID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memberships WHERE office_id=? AND user_id=?`, officeID, userID); err != nil {
		return "", err
	}
	return name, tx.Commit()
}

// InviteInfo describes an invite without its secret (only a hash is stored).
type InviteInfo struct {
	ID        int64  `json:"id"`
	Role      string `json:"role"`
	MaxUses   int    `json:"maxUses"`
	Uses      int    `json:"uses"`
	ExpiresAt int64  `json:"expiresAt"`
	CreatedAt int64  `json:"createdAt"`
	CreatedBy string `json:"createdBy"`
	Revoked   bool   `json:"revoked"`
	// Status is "active", "expired", "exhausted" or "revoked".
	Status string `json:"status"`
}

// ListInvites returns the most recent invites of an office (newest first).
func (s *Store) ListInvites(ctx context.Context, officeID int64, limit int) ([]InviteInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT i.id, i.role, i.max_uses, i.uses, i.expires_at, i.created_at, COALESCE(u.name,''), i.revoked
FROM invites i LEFT JOIN users u ON u.id = i.created_by
WHERE i.office_id = ? ORDER BY i.id DESC LIMIT ?`, officeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now().Unix()
	out := []InviteInfo{}
	for rows.Next() {
		var i InviteInfo
		var rev int
		if err := rows.Scan(&i.ID, &i.Role, &i.MaxUses, &i.Uses, &i.ExpiresAt, &i.CreatedAt, &i.CreatedBy, &rev); err != nil {
			return nil, err
		}
		i.Revoked = rev != 0
		switch {
		case i.Revoked:
			i.Status = "revoked"
		case i.ExpiresAt <= now:
			i.Status = "expired"
		case i.Uses >= i.MaxUses:
			i.Status = "exhausted"
		default:
			i.Status = "active"
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// RevokeInvite makes an invite unusable. It is idempotent.
func (s *Store) RevokeInvite(ctx context.Context, officeID, inviteID int64) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE invites SET revoked=1 WHERE id=? AND office_id=?`, inviteID, officeID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AuditEntry is one row of the admin activity log. It never holds message content.
type AuditEntry struct {
	ID         int64  `json:"id"`
	Actor      string `json:"actor"`
	Action     string `json:"action"`
	TargetName string `json:"target"`
	Detail     string `json:"detail"`
	At         int64  `json:"at"`
}

const auditKeep = 2000 // entries kept per office

// Audit records an admin action and prunes the oldest entries. actorID 0 means "system / CLI".
func (s *Store) Audit(ctx context.Context, officeID, actorID int64, action string, targetID int64, targetName, detail string) error {
	var actor, target any
	if actorID > 0 {
		actor = actorID
	}
	if targetID > 0 {
		target = targetID
	}
	if len(targetName) > 64 {
		targetName = targetName[:64]
	}
	if len(detail) > 200 {
		detail = detail[:200]
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log(office_id,actor_id,action,target_id,target_name,detail,created_at) VALUES (?,?,?,?,?,?,?)`,
		officeID, actor, action, target, targetName, detail, time.Now().Unix()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audit_log WHERE office_id=? AND id <= (SELECT id FROM audit_log WHERE office_id=? ORDER BY id DESC LIMIT 1 OFFSET ?)`, officeID, officeID, auditKeep); err != nil {
		return err
	}
	return tx.Commit()
}

// ListAudit returns the latest entries, newest first.
func (s *Store) ListAudit(ctx context.Context, officeID int64, limit int) ([]AuditEntry, error) {
	rows, err := s.DB.QueryContext(ctx, `
SELECT a.id, COALESCE(u.name,'system'), a.action, a.target_name, a.detail, a.created_at
FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
WHERE a.office_id = ? ORDER BY a.id DESC LIMIT ?`, officeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.Actor, &e.Action, &e.TargetName, &e.Detail, &e.At); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
