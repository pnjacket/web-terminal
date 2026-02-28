package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"web-terminal/session"
)

func (h *handler) listSessions(w http.ResponseWriter, r *http.Request) {
	sessions := h.manager.List()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sessions)
}

func (h *handler) createSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	s, err := h.manager.Create(req.Name)
	if err != nil {
		if errors.Is(err, session.ErrNameTaken) {
			http.Error(w, "session name already in use", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(s)
}

func (h *handler) killSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.manager.Kill(id); err != nil {
		if errors.Is(err, session.ErrNotFound) {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to kill session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
