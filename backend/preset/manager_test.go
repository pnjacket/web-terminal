package preset_test

import (
	"sync"
	"testing"

	"web-terminal/preset"
)

func TestNewManagerMissingFile(t *testing.T) {
	dir := t.TempDir()
	pm, err := preset.NewManager(dir + "/nonexistent.json")
	if err != nil {
		t.Fatalf("expected no error for missing file, got %v", err)
	}
	store := pm.Get()
	if len(store.Presets) != 0 {
		t.Fatalf("expected empty presets, got %d", len(store.Presets))
	}
	if len(store.RecentlyUsed) != 0 {
		t.Fatalf("expected empty recentlyUsed, got %d", len(store.RecentlyUsed))
	}
}

func TestSaveAndReload(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	store := preset.PresetStore{
		Presets: []preset.Preset{
			{ID: "abc", Title: "Test", Content: "hello"},
		},
		RecentlyUsed: []string{"abc"},
	}
	if err := pm.Save(store); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Reload from disk.
	pm2, err := preset.NewManager(path)
	if err != nil {
		t.Fatalf("NewManager reload: %v", err)
	}
	got := pm2.Get()
	if len(got.Presets) != 1 || got.Presets[0].ID != "abc" {
		t.Fatalf("expected preset 'abc', got %+v", got.Presets)
	}
	if len(got.RecentlyUsed) != 1 || got.RecentlyUsed[0] != "abc" {
		t.Fatalf("unexpected recentlyUsed: %v", got.RecentlyUsed)
	}
}

func TestMarkUsedMRUOrder(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	store := preset.PresetStore{
		Presets: []preset.Preset{
			{ID: "a", Title: "A", Content: ""},
			{ID: "b", Title: "B", Content: ""},
			{ID: "c", Title: "C", Content: ""},
		},
	}
	pm.Save(store)

	pm.MarkUsed("a")
	pm.MarkUsed("b")
	pm.MarkUsed("c")

	got := pm.Get()
	// Most-recently-used first: c, b, a
	want := []string{"c", "b", "a"}
	if len(got.RecentlyUsed) != len(want) {
		t.Fatalf("expected %v, got %v", want, got.RecentlyUsed)
	}
	for i, id := range want {
		if got.RecentlyUsed[i] != id {
			t.Fatalf("position %d: expected %q, got %q", i, id, got.RecentlyUsed[i])
		}
	}
}

func TestMarkUsedDeduplication(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	store := preset.PresetStore{
		Presets: []preset.Preset{
			{ID: "x", Title: "X", Content: ""},
			{ID: "y", Title: "Y", Content: ""},
		},
	}
	pm.Save(store)

	pm.MarkUsed("x")
	pm.MarkUsed("y")
	pm.MarkUsed("x") // should move x to front, no duplicate

	got := pm.Get()
	if len(got.RecentlyUsed) != 2 {
		t.Fatalf("expected 2 entries (no dup), got %v", got.RecentlyUsed)
	}
	if got.RecentlyUsed[0] != "x" || got.RecentlyUsed[1] != "y" {
		t.Fatalf("unexpected order: %v", got.RecentlyUsed)
	}
}

func TestMarkUsedCap10(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	presets := make([]preset.Preset, 12)
	for i := range presets {
		presets[i] = preset.Preset{ID: string(rune('a' + i)), Title: "T", Content: ""}
	}
	pm.Save(preset.PresetStore{Presets: presets})

	for _, p := range presets {
		pm.MarkUsed(p.ID)
	}

	got := pm.Get()
	if len(got.RecentlyUsed) != 10 {
		t.Fatalf("expected cap of 10, got %d: %v", len(got.RecentlyUsed), got.RecentlyUsed)
	}
}

func TestMarkUsedNonExistentID(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	// No presets in store — MarkUsed should silently do nothing.
	if err := pm.MarkUsed("doesnotexist"); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	got := pm.Get()
	if len(got.RecentlyUsed) != 0 {
		t.Fatalf("expected empty recentlyUsed, got %v", got.RecentlyUsed)
	}
}

func TestMarkUsedFiltersRemovedIDs(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	store := preset.PresetStore{
		Presets: []preset.Preset{
			{ID: "a", Title: "A", Content: ""},
			{ID: "b", Title: "B", Content: ""},
		},
		RecentlyUsed: []string{"a", "b"},
	}
	pm.Save(store)

	// Remove preset "b" from the store.
	pm.Save(preset.PresetStore{
		Presets:      []preset.Preset{{ID: "a", Title: "A", Content: ""}},
		RecentlyUsed: []string{"a", "b"}, // stale entry
	})

	// MarkUsed "a" should rebuild MRU filtering out "b".
	pm.MarkUsed("a")
	got := pm.Get()
	for _, id := range got.RecentlyUsed {
		if id == "b" {
			t.Fatalf("stale ID 'b' should have been filtered out: %v", got.RecentlyUsed)
		}
	}
}

func TestConcurrentSave(t *testing.T) {
	path := t.TempDir() + "/presets.json"
	pm, _ := preset.NewManager(path)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			store := preset.PresetStore{
				Presets: []preset.Preset{{ID: "p", Title: "T", Content: ""}},
			}
			pm.Save(store)
		}(i)
	}
	wg.Wait()
}
