package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"web-terminal/preset"
)

func (h *handler) getPresets(w http.ResponseWriter, r *http.Request) {
	store := h.presetManager.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(store)
}

func (h *handler) putPresets(w http.ResponseWriter, r *http.Request) {
	var store preset.PresetStore
	if err := json.NewDecoder(r.Body).Decode(&store); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Filter recentlyUsed to only include IDs present in the new presets list.
	idSet := make(map[string]bool, len(store.Presets))
	for _, p := range store.Presets {
		idSet[p.ID] = true
	}
	filtered := store.RecentlyUsed[:0]
	for _, id := range store.RecentlyUsed {
		if idSet[id] {
			filtered = append(filtered, id)
		}
	}
	store.RecentlyUsed = filtered

	if err := h.presetManager.Save(store); err != nil {
		http.Error(w, "failed to save presets", http.StatusInternalServerError)
		return
	}

	updated := h.presetManager.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (h *handler) usePreset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// MarkUsed silently ignores non-existent IDs.
	if err := h.presetManager.MarkUsed(id); err != nil {
		http.Error(w, "failed to update recently used", http.StatusInternalServerError)
		return
	}

	store := h.presetManager.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"recentlyUsed": store.RecentlyUsed})
}
