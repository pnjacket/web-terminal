package session

import (
	"testing"
	"time"
)

func TestCreateAndGet(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	s, err := m.Create("test")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if s.Name != "test" {
		t.Fatalf("expected name 'test', got %q", s.Name)
	}
	got, ok := m.Get(s.ID)
	if !ok {
		t.Fatal("Get returned ok=false for existing session")
	}
	if got.ID != s.ID {
		t.Fatalf("Get returned wrong session")
	}
}

func TestCreateNameUniqueness(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	_, err := m.Create("dup")
	if err != nil {
		t.Fatalf("first Create failed: %v", err)
	}
	_, err = m.Create("dup")
	if err != ErrNameTaken {
		t.Fatalf("expected ErrNameTaken, got %v", err)
	}
}

func TestList(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	m.Create("a")
	m.Create("b")
	list := m.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(list))
	}
}

func TestKill(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	s, err := m.Create("killme")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if err := m.Kill(s.ID); err != nil {
		t.Fatalf("Kill failed: %v", err)
	}
	_, ok := m.Get(s.ID)
	if ok {
		t.Fatal("session still exists after Kill")
	}
}

func TestKillNotFound(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	if err := m.Kill("nonexistent"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetNotFound(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	_, ok := m.Get("nonexistent")
	if ok {
		t.Fatal("expected ok=false for nonexistent session")
	}
}

func TestAutoRemoveOnPipeClose(t *testing.T) {
	m := NewManagerWithSpawnFn(MockSpawnFn)
	s, err := m.Create("auto-remove")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Close the write end of the pipe (s.ptmx), simulating bash exit.
	// The MockSpawnFn goroutine reads EOF from the read end and calls remove.
	s.ptmx.Close()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := m.Get(s.ID); !ok {
			return // success
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("session was not auto-removed after PTY close")
}
