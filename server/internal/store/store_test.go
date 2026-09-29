package store

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func open(t *testing.T) (*Store, *Office) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	o, err := s.EnsureOffice(context.Background(), "default", "T", "{}")
	if err != nil {
		t.Fatal(err)
	}
	return s, o
}

func TestFirstMemberIsAdminAndSessionsRoundTrip(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	a, roleA, err := s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	if err != nil || roleA != "admin" {
		t.Fatalf("first member must be admin: %v %v", roleA, err)
	}
	_, roleB, _ := s.AddMember(ctx, o.ID, "Bia", json.RawMessage("{}"), "")
	if roleB != "member" {
		t.Fatalf("second member must be a member, got %s", roleB)
	}
	tok, err := s.CreateSession(ctx, a, o.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	se, err := s.LookupSession(ctx, tok)
	if err != nil || se.Name != "Ana" || se.Role != "admin" {
		t.Fatalf("session lookup: %+v %v", se, err)
	}
	if _, err := s.LookupSession(ctx, tok+"x"); err != ErrNotFound {
		t.Fatal("a forged token must not resolve")
	}
	expired, _ := s.CreateSession(ctx, a, o.ID, -time.Minute)
	if _, err := s.LookupSession(ctx, expired); err != ErrNotFound {
		t.Fatal("expired sessions must not resolve")
	}
}

func TestInviteUseLimitExpiryAndRole(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	tok, err := s.CreateInvite(ctx, o.ID, "member", 2, time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		inv, err := s.ConsumeInvite(ctx, tok)
		if err != nil || inv.Role != "member" || inv.OfficeID != o.ID {
			t.Fatalf("use %d: %+v %v", i, inv, err)
		}
	}
	if _, err := s.ConsumeInvite(ctx, tok); err != ErrInviteInvalid {
		t.Fatal("third use must fail")
	}
	old, _ := s.CreateInvite(ctx, o.ID, "admin", 1, time.Millisecond, 0)
	time.Sleep(1100 * time.Millisecond)
	if _, err := s.ConsumeInvite(ctx, old); err != ErrInviteInvalid {
		t.Fatal("expired invite must fail")
	}
	if _, err := s.CreateInvite(ctx, o.ID, "root", 1, time.Hour, 0); err == nil {
		t.Fatal("unknown roles must be rejected")
	}
	if _, err := s.CreateInvite(ctx, o.ID, "member", 1, 365*24*time.Hour, 0); err == nil {
		t.Fatal("absurd validity must be rejected")
	}
}

func TestInviteConsumptionIsAtomicUnderConcurrency(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	tok, _ := s.CreateInvite(ctx, o.ID, "member", 5, time.Hour, 0)
	res := make(chan bool, 40)
	for i := 0; i < 40; i++ {
		go func() { _, err := s.ConsumeInvite(ctx, tok); res <- err == nil }()
	}
	ok := 0
	for i := 0; i < 40; i++ {
		if <-res {
			ok++
		}
	}
	if ok != 5 {
		t.Fatalf("exactly 5 uses must succeed, got %d", ok)
	}
}

func TestChatHistoryOrderAndPruning(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	u, _, _ := s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	for i := 0; i < chatKeep+40; i++ {
		if err := s.AppendChat(ctx, o.ID, u, "m"+strconv.Itoa(i), int64(i)); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.RecentChat(ctx, o.ID, 100)
	if err != nil || len(rows) != 100 {
		t.Fatalf("want 100 rows, got %d (%v)", len(rows), err)
	}
	if rows[0].Text != "m"+strconv.Itoa(chatKeep+40-100) || rows[99].Text != "m"+strconv.Itoa(chatKeep+39) || rows[99].Name != "Ana" {
		t.Fatalf("history must be the newest 100, oldest first: %q .. %q", rows[0].Text, rows[99].Text)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM chat_messages").Scan(&n)
	if n > chatKeep+1 {
		t.Fatalf("history must be pruned to ~%d rows, got %d", chatKeep, n)
	}
}

func TestMigrationsAreIdempotentAndBackupWorks(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "a.db")
	s, err := Open(db)
	if err != nil {
		t.Fatal(err)
	}
	s.EnsureOffice(context.Background(), "x", "X", "{}")
	if err := s.BackupTo(context.Background(), filepath.Join(dir, "b.db")); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s2, err := Open(db) // second open re-runs migrate(): must be a no-op
	if err != nil {
		t.Fatal(err)
	}
	s2.Close()
	b, err := Open(filepath.Join(dir, "b.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if _, err := b.OfficeBySlug(context.Background(), "x"); err != nil {
		t.Fatalf("backup must contain the data: %v", err)
	}
}
