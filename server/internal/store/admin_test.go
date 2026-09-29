package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestRolesRemovalAndTheLastAdminGuard(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	a, _, _ := s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	b, _, _ := s.AddMember(ctx, o.ID, "Bia", json.RawMessage("{}"), "")

	if _, _, err := s.SetRole(ctx, o.ID, a, "member"); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("the last admin must not be demoted, got %v", err)
	}
	if _, err := s.RemoveMember(ctx, o.ID, a); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("the last admin must not be removed, got %v", err)
	}
	if _, _, err := s.SetRole(ctx, o.ID, b, "owner"); !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("unknown roles are rejected, got %v", err)
	}
	name, old, err := s.SetRole(ctx, o.ID, b, "admin")
	if err != nil || name != "Bia" || old != "member" {
		t.Fatalf("promote: %q %q %v", name, old, err)
	}
	// now that there are two admins, the first can step down
	if _, _, err := s.SetRole(ctx, o.ID, a, "member"); err != nil {
		t.Fatalf("demote with another admin present: %v", err)
	}
	if _, _, err := s.SetRole(ctx, o.ID, 999, "member"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user: %v", err)
	}

	tok, _ := s.CreateSession(ctx, a, o.ID, time.Hour)
	if _, err := s.LookupSession(ctx, tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RemoveMember(ctx, o.ID, a); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := s.LookupSession(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatal("a removed member's session must stop working")
	}
	ms, _ := s.ListMembers(ctx, o.ID)
	if len(ms) != 1 || ms[0].Name != "Bia" || ms[0].Role != "admin" {
		t.Fatalf("members: %+v", ms)
	}
}

func TestChatLinesSurviveMemberRemoval(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	b, _, _ := s.AddMember(ctx, o.ID, "Bia", json.RawMessage("{}"), "")
	s.AppendChat(ctx, o.ID, b, "hello", 1)
	if _, err := s.RemoveMember(ctx, o.ID, b); err != nil {
		t.Fatal(err)
	}
	rows, _ := s.RecentChat(ctx, o.ID, 10)
	if len(rows) != 1 || rows[0].Name != "Bia" {
		t.Fatalf("history keeps the author name: %+v", rows)
	}
}

func TestInviteListingAndRevocation(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	a, _, _ := s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	tok, _ := s.CreateInvite(ctx, o.ID, "member", 1, time.Hour, a)
	s.CreateInvite(ctx, o.ID, "admin", 5, time.Hour, a)

	list, err := s.ListInvites(ctx, o.ID, 50)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: %+v %v", list, err)
	}
	if list[0].Role != "admin" || list[0].Status != "active" || list[0].CreatedBy != "Ana" {
		t.Fatalf("newest first, with creator: %+v", list[0])
	}
	first := list[1]
	if err := s.RevokeInvite(ctx, o.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConsumeInvite(ctx, tok); !errors.Is(err, ErrInviteInvalid) {
		t.Fatal("a revoked invite must not be usable")
	}
	list, _ = s.ListInvites(ctx, o.ID, 50)
	if list[1].Status != "revoked" {
		t.Fatalf("status: %+v", list[1])
	}
	if err := s.RevokeInvite(ctx, o.ID+99, first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an invite of another office cannot be revoked: %v", err)
	}
	exhausted, _ := s.CreateInvite(ctx, o.ID, "member", 1, time.Hour, a)
	s.ConsumeInvite(ctx, exhausted)
	list, _ = s.ListInvites(ctx, o.ID, 50)
	if list[0].Status != "exhausted" {
		t.Fatalf("status: %+v", list[0])
	}
}

func TestAuditTrailOrderAndPruning(t *testing.T) {
	s, o := open(t)
	ctx := context.Background()
	a, _, _ := s.AddMember(ctx, o.ID, "Ana", json.RawMessage("{}"), "")
	s.Audit(ctx, o.ID, a, "member.role", 7, "Bia", "member -> admin")
	s.Audit(ctx, o.ID, 0, "invite.create", 0, "", "role=member")
	es, err := s.ListAudit(ctx, o.ID, 10)
	if err != nil || len(es) != 2 {
		t.Fatalf("audit: %+v %v", es, err)
	}
	if es[0].Action != "invite.create" || es[0].Actor != "system" || es[1].Actor != "Ana" || es[1].TargetName != "Bia" {
		t.Fatalf("newest first, system actor for id 0: %+v", es)
	}
	for i := 0; i < auditKeep+20; i++ {
		s.Audit(ctx, o.ID, a, "x", 0, "", "")
	}
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE office_id=?`, o.ID).Scan(&n)
	if n > auditKeep+1 {
		t.Fatalf("audit log must be pruned, has %d", n)
	}
}
