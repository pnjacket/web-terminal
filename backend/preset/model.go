package preset

import "errors"

// Preset is a single reusable text snippet.
type Preset struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// PresetStore is the full persistent state.
type PresetStore struct {
	Presets      []Preset `json:"presets"`
	RecentlyUsed []string `json:"recentlyUsed"` // MRU order, max 10 IDs
}

var ErrNotFound = errors.New("preset not found")
