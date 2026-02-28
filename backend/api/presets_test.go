package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"web-terminal/preset"
)

func TestGetPresetsEmpty(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/presets")
	if err != nil {
		t.Fatalf("GET /api/presets: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var store preset.PresetStore
	json.NewDecoder(resp.Body).Decode(&store)
	if len(store.Presets) != 0 {
		t.Fatalf("expected 0 presets, got %d", len(store.Presets))
	}
}

func TestPutPresetsAndGet(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	body := `{"presets":[{"id":"p1","title":"Hello","content":"world"}],"recentlyUsed":[]}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/presets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	putResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /api/presets: %v", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", putResp.StatusCode)
	}

	// Subsequent GET should return the new data.
	getResp, err := http.Get(srv.URL + "/api/presets")
	if err != nil {
		t.Fatalf("GET /api/presets: %v", err)
	}
	defer getResp.Body.Close()
	var store preset.PresetStore
	json.NewDecoder(getResp.Body).Decode(&store)
	if len(store.Presets) != 1 || store.Presets[0].ID != "p1" {
		t.Fatalf("expected preset p1, got %+v", store.Presets)
	}
}

func TestPutPresetsBadJSON(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/presets", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestPutPresetsFiltersRecentlyUsed(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	// PUT with a recentlyUsed that references an ID not in presets — should be filtered.
	body := `{"presets":[{"id":"p1","title":"A","content":""}],"recentlyUsed":["p1","ghost"]}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/presets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	putResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /api/presets: %v", err)
	}
	defer putResp.Body.Close()

	var store preset.PresetStore
	json.NewDecoder(putResp.Body).Decode(&store)
	for _, id := range store.RecentlyUsed {
		if id == "ghost" {
			t.Fatalf("ghost ID should have been filtered from recentlyUsed")
		}
	}
}

func TestUsePreset(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	// Create a preset first.
	body := `{"presets":[{"id":"p1","title":"A","content":""}],"recentlyUsed":[]}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/presets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)

	// Mark it as used.
	useResp, err := http.Post(srv.URL+"/api/presets/p1/use", "application/json", nil)
	if err != nil {
		t.Fatalf("POST .../use: %v", err)
	}
	defer useResp.Body.Close()
	if useResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", useResp.StatusCode)
	}
	var result map[string][]string
	json.NewDecoder(useResp.Body).Decode(&result)
	ru := result["recentlyUsed"]
	if len(ru) == 0 || ru[0] != "p1" {
		t.Fatalf("expected p1 in recentlyUsed, got %v", ru)
	}
}

func TestUsePresetNonExistent(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	// No-op for an ID that doesn't exist — should still return 200.
	resp, err := http.Post(srv.URL+"/api/presets/nonexistent/use", "application/json", nil)
	if err != nil {
		t.Fatalf("POST .../use: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}
