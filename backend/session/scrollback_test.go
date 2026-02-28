package session

import (
	"sync"
	"testing"
)

func TestScrollbackWrite(t *testing.T) {
	buf := newScrollbackBuf()
	buf.Write([]byte("hello"))
	buf.Write([]byte(" world"))
	snap := buf.Snapshot()
	if string(snap) != "hello world" {
		t.Fatalf("expected 'hello world', got %q", snap)
	}
}

func TestScrollbackTruncation(t *testing.T) {
	buf := &scrollbackBuf{max: 10}
	buf.Write([]byte("hello world")) // 11 bytes, exceeds max of 10
	snap := buf.Snapshot()
	if len(snap) != 10 {
		t.Fatalf("expected length 10, got %d", len(snap))
	}
	if string(snap) != "ello world" {
		t.Fatalf("expected 'ello world', got %q", snap)
	}
}

func TestScrollbackSnapshotCopy(t *testing.T) {
	buf := newScrollbackBuf()
	buf.Write([]byte("data"))
	snap := buf.Snapshot()
	snap[0] = 'X'
	// Original should be unaffected.
	snap2 := buf.Snapshot()
	if snap2[0] == 'X' {
		t.Fatal("Snapshot is not a copy; original data was modified")
	}
}

func TestScrollbackEmpty(t *testing.T) {
	buf := newScrollbackBuf()
	snap := buf.Snapshot()
	if snap != nil {
		t.Fatalf("expected nil snapshot for empty buf, got %v", snap)
	}
}

func TestScrollbackConcurrent(t *testing.T) {
	buf := newScrollbackBuf()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf.Write([]byte("data"))
			buf.Snapshot()
		}()
	}
	wg.Wait()
}
