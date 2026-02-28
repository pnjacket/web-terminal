package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"web-terminal/api"
	"web-terminal/preset"
	"web-terminal/session"
)

// newTestPresetManager creates an in-memory preset manager backed by a temp file.
func newTestPresetManager(t *testing.T) *preset.Manager {
	t.Helper()
	dir := t.TempDir()
	pm, err := preset.NewManager(dir + "/presets.json")
	if err != nil {
		t.Fatalf("newTestPresetManager: %v", err)
	}
	return pm
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	mgr := session.NewManagerWithSpawnFn(session.MockSpawnFn)
	pm := newTestPresetManager(t)
	staticFS := fstest.MapFS{
		"index.html":   {Data: []byte("<html></html>")},
		"session.html": {Data: []byte("<html></html>")},
	}
	return httptest.NewServer(api.RegisterRoutes(mgr, pm, staticFS))
}

func TestListSessionsEmpty(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/sessions")
	if err != nil {
		t.Fatalf("GET /api/sessions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content-type, got %q", ct)
	}
	var sessions []interface{}
	json.NewDecoder(resp.Body).Decode(&sessions)
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestCreateSession201(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"my-session"}`))
	if err != nil {
		t.Fatalf("POST /api/sessions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content-type, got %q", ct)
	}
	var s map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&s)
	if s["name"] != "my-session" {
		t.Fatalf("expected name 'my-session', got %v", s["name"])
	}
	if s["id"] == "" {
		t.Fatal("expected non-empty id")
	}
}

func TestCreateSessionBadJSON(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader("not-json"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestCreateSessionEmptyName(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":""}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestCreateSessionConflict(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	resp1, _ := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"dupe"}`))
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("first create: expected 201, got %d", resp1.StatusCode)
	}

	resp2, _ := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"dupe"}`))
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("second create: expected 409, got %d", resp2.StatusCode)
	}
}

func TestKillSession204(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	// Create a session.
	resp, _ := http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"to-kill"}`))
	var s map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&s)
	resp.Body.Close()
	id := s["id"].(string)

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/sessions/"+id, nil)
	delResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	delResp.Body.Close()
	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", delResp.StatusCode)
	}
}

func TestKillSessionNotFound(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/sessions/nonexistent", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestListSessionsAfterCreate(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"s1"}`))
	http.Post(srv.URL+"/api/sessions", "application/json",
		strings.NewReader(`{"name":"s2"}`))

	resp, err := http.Get(srv.URL + "/api/sessions")
	if err != nil {
		t.Fatalf("GET /api/sessions: %v", err)
	}
	defer resp.Body.Close()
	var sessions []interface{}
	json.NewDecoder(resp.Body).Decode(&sessions)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}
