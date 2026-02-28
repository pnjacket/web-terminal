package session

import (
	"os"
	"os/exec"
	"sync"
	"time"
)

const maxScrollback = 1 << 20 // 1MB

type Session struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"created_at"`
	LastActive time.Time `json:"last_active"`
	Connected  bool      `json:"connected"`

	cmd        *exec.Cmd
	ptmx       *os.File
	scrollback *scrollbackBuf
	outChan    chan []byte
	kickChan   chan struct{}
	outMu      sync.Mutex
	done       chan struct{}
}

type scrollbackBuf struct {
	mu   sync.Mutex
	data []byte
	max  int
}

func newScrollbackBuf() *scrollbackBuf {
	return &scrollbackBuf{max: maxScrollback}
}

func (s *scrollbackBuf) Write(p []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = append(s.data, p...)
	if len(s.data) > s.max {
		excess := len(s.data) - s.max
		s.data = s.data[excess:]
	}
}

func (s *scrollbackBuf) Snapshot() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.data) == 0 {
		return nil
	}
	cp := make([]byte, len(s.data))
	copy(cp, s.data)
	return cp
}

// SetClient registers a channel to receive live PTY output. If a previous
// client is connected it is kicked: its kick channel is closed so ws.go can
// detect the displacement and close that WebSocket connection. Returns a kick
// channel that will be closed if this client is itself later displaced.
func (s *Session) SetClient(ch chan []byte) <-chan struct{} {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	// Displace any existing client.
	if s.kickChan != nil {
		close(s.kickChan)
	}
	kick := make(chan struct{})
	s.kickChan = kick
	s.outChan = ch
	s.Connected = true
	return kick
}

// ClearClient is called when a connection ends. It only updates session state
// if ch is still the current owner (guards against a displaced connection
// clearing a newer one). It always closes ch so the pump goroutine exits.
func (s *Session) ClearClient(ch chan []byte) {
	s.outMu.Lock()
	owned := s.outChan == ch
	if owned {
		s.outChan = nil
		s.Connected = false
		s.kickChan = nil
	}
	s.outMu.Unlock()
	close(ch)
}

// ScrollbackSnapshot returns a copy of the scrollback buffer.
func (s *Session) ScrollbackSnapshot() []byte {
	return s.scrollback.Snapshot()
}

// Done returns a channel that is closed when the bash process exits.
func (s *Session) Done() <-chan struct{} {
	return s.done
}

// WriteToPTY writes input bytes to the PTY master.
func (s *Session) WriteToPTY(p []byte) (int, error) {
	return s.ptmx.Write(p)
}

// PTY returns the PTY master file for pty.Setsize calls.
func (s *Session) PTY() *os.File {
	return s.ptmx
}
