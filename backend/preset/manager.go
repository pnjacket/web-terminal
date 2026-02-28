package preset

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Manager handles loading, saving, and updating the preset store.
type Manager struct {
	mu       sync.RWMutex
	filePath string
	store    PresetStore
}

// NewManager loads the preset store from filePath, or creates an empty store
// if the file does not exist. Returns an error only on unexpected I/O failures.
func NewManager(filePath string) (*Manager, error) {
	m := &Manager{filePath: filePath}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// Start with an empty store — no error.
			return m, nil
		}
		return nil, err
	}

	if err := json.Unmarshal(data, &m.store); err != nil {
		return nil, err
	}
	if m.store.Presets == nil {
		m.store.Presets = []Preset{}
	}
	if m.store.RecentlyUsed == nil {
		m.store.RecentlyUsed = []string{}
	}
	return m, nil
}

// Get returns a snapshot of the current store (safe copy under RLock).
func (m *Manager) Get() PresetStore {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return copyStore(m.store)
}

// Save validates and atomically writes store to disk, then updates in-memory state.
func (m *Manager) Save(store PresetStore) error {
	if store.Presets == nil {
		store.Presets = []Preset{}
	}
	if store.RecentlyUsed == nil {
		store.RecentlyUsed = []string{}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.writeAtomic(store); err != nil {
		return err
	}
	m.store = store
	return nil
}

// MarkUsed prepends id to the recentlyUsed list (deduplicating, capping at 10,
// and filtering out IDs that no longer exist in presets). A non-existent id is
// silently ignored.
func (m *Manager) MarkUsed(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Verify the id exists in presets.
	found := false
	for _, p := range m.store.Presets {
		if p.ID == id {
			found = true
			break
		}
	}
	if !found {
		return nil
	}

	// Build new MRU list: prepend id, deduplicate, cap at 10, drop missing IDs.
	existing := m.store.RecentlyUsed
	seen := map[string]bool{id: true}
	newList := []string{id}
	for _, eid := range existing {
		if seen[eid] {
			continue
		}
		// Filter out IDs that no longer exist in presets.
		stillExists := false
		for _, p := range m.store.Presets {
			if p.ID == eid {
				stillExists = true
				break
			}
		}
		if !stillExists {
			continue
		}
		seen[eid] = true
		newList = append(newList, eid)
		if len(newList) == 10 {
			break
		}
	}

	m.store.RecentlyUsed = newList
	return m.writeAtomic(m.store)
}

// writeAtomic writes to a temp file then renames it over filePath.
// Caller must hold m.mu if the in-memory store is being modified concurrently.
func (m *Manager) writeAtomic(store PresetStore) error {
	dir := filepath.Dir(m.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmp := m.filePath + ".tmp"
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, m.filePath)
}

func copyStore(s PresetStore) PresetStore {
	presets := make([]Preset, len(s.Presets))
	copy(presets, s.Presets)
	ru := make([]string, len(s.RecentlyUsed))
	copy(ru, s.RecentlyUsed)
	return PresetStore{Presets: presets, RecentlyUsed: ru}
}
