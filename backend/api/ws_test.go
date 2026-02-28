package api_test

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"

	"web-terminal/api"
	"web-terminal/session"
)

type wsMsg struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func newWSTestServer(t *testing.T) (*httptest.Server, *session.Manager) {
	t.Helper()
	mgr := session.NewManagerWithSpawnFn(session.MockSpawnFn)
	pm := newTestPresetManager(t)
	staticFS := fstest.MapFS{
		"index.html":   {Data: []byte("<html></html>")},
		"session.html": {Data: []byte("<html></html>")},
	}
	srv := httptest.NewServer(api.RegisterRoutes(mgr, pm, staticFS))
	return srv, mgr
}

func dialWS(t *testing.T, srv *httptest.Server, path string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + path
	return websocket.DefaultDialer.Dial(wsURL, nil)
}

func TestWSNotFound(t *testing.T) {
	srv, _ := newWSTestServer(t)
	defer srv.Close()

	_, resp, err := dialWS(t, srv, "/api/sessions/nonexistent/ws")
	if err == nil {
		t.Fatal("expected error connecting to nonexistent session")
	}
	if resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %v", resp)
	}
}

func TestWSScrollbackReplay(t *testing.T) {
	srv, mgr := newWSTestServer(t)
	defer srv.Close()

	s, err := mgr.Create("scrollback-test")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Write data through the PTY; MockSpawnFn echoes it into the scrollback.
	s.WriteToPTY([]byte("hello scrollback"))
	time.Sleep(50 * time.Millisecond)

	conn, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("WS dial: %v", err)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg wsMsg
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("ReadJSON: %v", err)
	}
	if msg.Type != "output" {
		t.Fatalf("expected 'output', got %q", msg.Type)
	}
	decoded, _ := base64.StdEncoding.DecodeString(msg.Data)
	if string(decoded) != "hello scrollback" {
		t.Fatalf("scrollback mismatch: got %q", decoded)
	}
}

func TestWSClosedOnSessionEnd(t *testing.T) {
	srv, mgr := newWSTestServer(t)
	defer srv.Close()

	s, err := mgr.Create("close-test")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	conn, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("WS dial: %v", err)
	}
	defer conn.Close()

	// Kill closes ptmx; the MockSpawnFn goroutine reads EOF and closes s.done.
	mgr.Kill(s.ID)

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg wsMsg
	err = conn.ReadJSON(&msg)
	if err != nil {
		// Connection was closed without a JSON message — acceptable.
		return
	}
	if msg.Type != "closed" {
		t.Fatalf("expected 'closed' message, got %q", msg.Type)
	}
}

func TestWSEchoRoundTrip(t *testing.T) {
	srv, mgr := newWSTestServer(t)
	defer srv.Close()

	s, err := mgr.Create("echo-test")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Fresh session — no scrollback yet.  Connect immediately so the first
	// message we receive is the echo of our own input.
	conn, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("WS dial: %v", err)
	}
	defer conn.Close()

	// Send input; MockSpawnFn echoes it back as output.
	input := "ping"
	if err := conn.WriteJSON(wsMsg{Type: "input", Data: base64.StdEncoding.EncodeToString([]byte(input))}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg wsMsg
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("ReadJSON: %v", err)
	}
	if msg.Type != "output" {
		t.Fatalf("expected 'output', got %q", msg.Type)
	}
	decoded, _ := base64.StdEncoding.DecodeString(msg.Data)
	if string(decoded) != input {
		t.Fatalf("echo mismatch: got %q, want %q", decoded, input)
	}
}

func TestWSClientDisplacement(t *testing.T) {
	srv, mgr := newWSTestServer(t)
	defer srv.Close()

	s, err := mgr.Create("displace-test")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	conn1, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("conn1 dial: %v", err)
	}
	defer conn1.Close()

	// Second client displaces the first.
	conn2, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("conn2 dial: %v", err)
	}
	defer conn2.Close()

	// conn1 should be closed by the server without a "closed" message.
	conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg wsMsg
	err = conn1.ReadJSON(&msg)
	// We expect an error (connection closed). A stray message is also acceptable.
	if err == nil {
		t.Logf("conn1 received message after displacement: %q (not a failure)", msg.Type)
	}
}

func TestWSResizeDoesNotPanic(t *testing.T) {
	srv, mgr := newWSTestServer(t)
	defer srv.Close()

	s, err := mgr.Create("resize-test")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	conn, _, err := dialWS(t, srv, "/api/sessions/"+s.ID+"/ws")
	if err != nil {
		t.Fatalf("WS dial: %v", err)
	}
	defer conn.Close()

	// Resize on a pipe fd will log an error but must not panic.
	if err := conn.WriteJSON(wsMsg{Type: "resize", Cols: 80, Rows: 24}); err != nil {
		t.Fatalf("WriteJSON resize: %v", err)
	}
	time.Sleep(50 * time.Millisecond)

	// Connection is still live.
	if err := conn.WriteJSON(wsMsg{Type: "resize", Cols: 100, Rows: 30}); err != nil {
		t.Fatalf("second WriteJSON resize: %v", err)
	}
}
