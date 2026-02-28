package session

import (
	"testing"
)

func TestSetClientConnected(t *testing.T) {
	s := &Session{
		scrollback: newScrollbackBuf(),
		done:       make(chan struct{}),
	}
	ch := make(chan []byte, 1)
	kick := s.SetClient(ch)
	if !s.Connected {
		t.Fatal("expected Connected to be true after SetClient")
	}
	if kick == nil {
		t.Fatal("expected non-nil kick channel")
	}
}

func TestSetClientKicksPrior(t *testing.T) {
	s := &Session{
		scrollback: newScrollbackBuf(),
		done:       make(chan struct{}),
	}
	ch1 := make(chan []byte, 1)
	kick1 := s.SetClient(ch1)

	ch2 := make(chan []byte, 1)
	_ = s.SetClient(ch2)

	select {
	case <-kick1:
		// ok — first client's kick channel was closed
	default:
		t.Fatal("first client's kick channel was not closed on displacement")
	}
}

func TestClearClientOwnershipGuard(t *testing.T) {
	s := &Session{
		scrollback: newScrollbackBuf(),
		done:       make(chan struct{}),
	}
	ch1 := make(chan []byte, 1)
	_ = s.SetClient(ch1)

	ch2 := make(chan []byte, 1)
	_ = s.SetClient(ch2)

	// ClearClient with the displaced channel should NOT clear Connected.
	s.ClearClient(ch1)
	if !s.Connected {
		t.Fatal("ClearClient with displaced channel should not clear Connected")
	}

	// ClearClient with the current channel should clear Connected.
	s.ClearClient(ch2)
	if s.Connected {
		t.Fatal("ClearClient with current channel should clear Connected")
	}
}

func TestScrollbackSnapshotViaSession(t *testing.T) {
	s := &Session{
		scrollback: newScrollbackBuf(),
		done:       make(chan struct{}),
	}
	s.scrollback.Write([]byte("abc"))
	snap := s.ScrollbackSnapshot()
	if string(snap) != "abc" {
		t.Fatalf("expected 'abc', got %q", snap)
	}
}
