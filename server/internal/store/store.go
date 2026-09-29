// Package store is the persistent layer (SQLite, WAL). Movement is never
// written here: only durable data (identities, memberships, maps, sessions).
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	DB *sql.DB
}

type Office struct {
	ID      int64
	Slug    string
	Name    string
	MapJSON string
	MapRev  int64
}

type Session struct {
	UserID   int64
	OfficeID int64
	Name     string
	Avatar   json.RawMessage
	Role     string
	LastX    *float64
	LastY    *float64
}

var ErrNotFound = errors.New("not found")

func Open(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) migrate() error {
	if _, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return err
	}
	ents, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(ents))
	for _, e := range ents {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, n := range names {
		var ver int
		if _, err := fmt.Sscanf(n, "%d_", &ver); err != nil {
			return fmt.Errorf("bad migration name %q", n)
		}
		var one int
		err := s.DB.QueryRow(`SELECT 1 FROM schema_migrations WHERE version=?`, ver).Scan(&one)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		body, _ := migrationsFS.ReadFile("migrations/" + n)
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", n, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)`, ver, time.Now().Unix()); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// EnsureOffice returns the office with the slug, creating it with mapJSON if absent.
func (s *Store) EnsureOffice(ctx context.Context, slug, name, mapJSON string) (*Office, error) {
	_, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO offices(slug,name,map_json,created_at) VALUES (?,?,?,?)`, slug, name, mapJSON, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	return s.OfficeBySlug(ctx, slug)
}

func (s *Store) OfficeBySlug(ctx context.Context, slug string) (*Office, error) {
	o := &Office{}
	err := s.DB.QueryRowContext(ctx, `SELECT id,slug,name,map_json,map_rev FROM offices WHERE slug=?`, slug).Scan(&o.ID, &o.Slug, &o.Name, &o.MapJSON, &o.MapRev)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (s *Store) SaveMap(ctx context.Context, officeID int64, mapJSON string) (int64, error) {
	var rev int64
	err := s.DB.QueryRowContext(ctx, `UPDATE offices SET map_json=?, map_rev=map_rev+1 WHERE id=? RETURNING map_rev`, mapJSON, officeID).Scan(&rev)
	return rev, err
}

// AddMember creates a user and a membership. The first member of an office becomes admin.
func (s *Store) AddMember(ctx context.Context, officeID int64, name string, avatar json.RawMessage, forceRole string) (userID int64, role string, err error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	res, err := tx.ExecContext(ctx, `INSERT INTO users(name,avatar_json,created_at) VALUES (?,?,?)`, name, string(avatar), now)
	if err != nil {
		return 0, "", err
	}
	userID, _ = res.LastInsertId()
	role = "member"
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM memberships WHERE office_id=?`, officeID).Scan(&n); err != nil {
		return 0, "", err
	}
	if n == 0 {
		role = "admin"
	}
	if forceRole != "" {
		role = forceRole
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memberships(office_id,user_id,role,joined_at) VALUES (?,?,?,?)`, officeID, userID, role, now); err != nil {
		return 0, "", err
	}
	return userID, role, tx.Commit()
}

func hashToken(t string) []byte { h := sha256.Sum256([]byte(t)); return h[:] }

// CreateSession returns an opaque bearer token; only its SHA-256 is stored.
func (s *Store) CreateSession(ctx context.Context, userID, officeID int64, ttl time.Duration) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,office_id,created_at,expires_at) VALUES (?,?,?,?,?)`, hashToken(tok), userID, officeID, now.Unix(), now.Add(ttl).Unix())
	return tok, err
}

func (s *Store) LookupSession(ctx context.Context, tok string) (*Session, error) {
	if tok == "" || len(tok) > 128 {
		return nil, ErrNotFound
	}
	var (
		se     Session
		avatar string
	)
	err := s.DB.QueryRowContext(ctx, `
SELECT s.user_id, s.office_id, u.name, u.avatar_json, m.role, m.last_x, m.last_y
FROM sessions s
JOIN users u ON u.id = s.user_id
JOIN memberships m ON m.user_id = s.user_id AND m.office_id = s.office_id
WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(tok), time.Now().Unix()).
		Scan(&se.UserID, &se.OfficeID, &se.Name, &avatar, &se.Role, &se.LastX, &se.LastY)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	se.Avatar = json.RawMessage(avatar)
	return &se, err
}

func (s *Store) SaveLastPos(ctx context.Context, officeID, userID int64, x, y float64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE memberships SET last_x=?, last_y=? WHERE office_id=? AND user_id=?`, x, y, officeID, userID)
	return err
}

func (s *Store) UpdateProfile(ctx context.Context, userID int64, name string, avatar json.RawMessage) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE users SET name=?, avatar_json=? WHERE id=?`, name, string(avatar), userID)
	return err
}

func (s *Store) PurgeExpiredSessions(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, time.Now().Unix())
	return err
}

// CleanName trims and bounds a display name.
func CleanName(n string) string {
	n = strings.TrimSpace(n)
	r := []rune(n)
	if len(r) > 24 {
		r = r[:24]
	}
	return strings.Map(func(c rune) rune {
		if c < 32 || c == 127 {
			return -1
		}
		return c
	}, string(r))
}

// BackupTo writes a consistent snapshot using VACUUM INTO (works online, in WAL mode).
func (s *Store) BackupTo(ctx context.Context, dest string) error {
	_, err := s.DB.ExecContext(ctx, "VACUUM INTO ?", dest)
	return err
}
