package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"tilework/internal/store"
)

// adminSession authenticates the caller and requires the admin role. It writes the error response itself.
func (s *Server) adminSession(w http.ResponseWriter, r *http.Request) *store.Session {
	se, err := s.session(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return nil
	}
	if se.Role != "admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin only"})
		return nil
	}
	if !s.adminLim.Allow(strconv.FormatInt(se.UserID, 10)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return nil
	}
	return se
}

// audit records an admin action. A failure to record is logged but never blocks the action itself.
func (s *Server) audit(r *http.Request, se *store.Session, action string, targetID int64, targetName, detail string) {
	if err := s.st.Audit(r.Context(), se.OfficeID, se.UserID, action, targetID, targetName, detail); err != nil {
		s.log.Error("audit", "action", action, "err", err)
	}
}

// evict removes a user from the running world (closing their socket and any call).
func (s *Server) evict(r *http.Request, officeID, userID int64) {
	office, err := s.st.OfficeByID(r.Context(), officeID)
	if err != nil {
		return
	}
	s.mu.Lock()
	wd := s.worlds[office.ID]
	s.mu.Unlock()
	if wd != nil { // no world running means nobody is connected
		wd.Evict(r.Context(), uint32(userID))
	}
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// announce shows an administrator's one-line banner to everybody online. The audit row records that
// an announcement was made, never its text; the text itself is not stored anywhere.
func (s *Server) announce(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var req struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Text) == "" || utf8.RuneCountInString(req.Text) > 280 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "1 to 280 characters"})
		return
	}
	if !s.annLim.Allow(strconv.FormatInt(se.UserID, 10)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return
	}
	s.mu.Lock()
	wd := s.worlds[se.OfficeID]
	s.mu.Unlock()
	if wd != nil {
		wd.Announce(r.Context(), se.Name, req.Text)
	}
	s.audit(r, se, "announce", 0, "", "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listMembers(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	ms, err := s.st.ListMembers(r.Context(), se.OfficeID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": ms, "you": se.UserID})
}

// patchMember changes a member's role. The member is disconnected so the new role applies on reconnect.
func (s *Server) patchMember(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	id, ok := pathID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256)
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	name, old, err := s.st.SetRole(r.Context(), se.OfficeID, id, req.Role)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such member"})
		return
	case errors.Is(err, store.ErrLastAdmin), errors.Is(err, store.ErrInvalidRole):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	case err != nil:
		s.log.Error("set role", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	if old != req.Role {
		s.audit(r, se, "member.role", id, name, old+" -> "+req.Role)
		s.evict(r, se.OfficeID, id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "role": req.Role})
}

// deleteMember removes a member: their sessions stop working and they are disconnected immediately.
func (s *Server) deleteMember(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	id, ok := pathID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	if id == se.UserID {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "you cannot remove yourself"})
		return
	}
	name, err := s.st.RemoveMember(r.Context(), se.OfficeID, id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such member"})
		return
	case errors.Is(err, store.ErrLastAdmin):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	case err != nil:
		s.log.Error("remove member", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	s.audit(r, se, "member.remove", id, name, "")
	s.evict(r, se.OfficeID, id)
	writeJSON(w, http.StatusOK, map[string]any{"removed": id})
}

func (s *Server) listInvites(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	list, err := s.st.ListInvites(r.Context(), se.OfficeID, 100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": list})
}

func (s *Server) revokeInvite(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	id, ok := pathID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	if err := s.st.RevokeInvite(r.Context(), se.OfficeID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such invite"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	s.audit(r, se, "invite.revoke", id, "", "")
	writeJSON(w, http.StatusOK, map[string]any{"revoked": id})
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	es, err := s.st.ListAudit(r.Context(), se.OfficeID, 100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": es})
}

// getFullMap returns the saved map INCLUDING the hidden content of interactive objects. The public wire
// map (hello) leaves that content out; the editor needs it to avoid erasing it on save.
func (s *Server) getFullMap(w http.ResponseWriter, r *http.Request) {
	se := s.adminSession(w, r)
	if se == nil {
		return
	}
	office, err := s.st.OfficeByID(r.Context(), se.OfficeID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(office.MapJSON))
}
