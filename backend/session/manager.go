package session

import (
	"errors"
	"io"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

var ErrNameTaken = errors.New("session name already in use")
var ErrNotFound = errors.New("session not found")

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	spawnFn  func(s *Session, onExit func(string)) error // nil → use spawnPTY
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// NewManagerWithSpawnFn creates a Manager with a custom spawn function.
// Pass MockSpawnFn for a pipe-based in-process mock (no real PTY).
func NewManagerWithSpawnFn(fn func(s *Session, onExit func(string)) error) *Manager {
	return &Manager{sessions: make(map[string]*Session), spawnFn: fn}
}

// MockSpawnFn is an os.Pipe-based spawn function for testing.
// It wires a pipe so data written via WriteToPTY is echoed back as PTY output.
func MockSpawnFn(s *Session, onExit func(string)) error {
	r, w, err := os.Pipe()
	if err != nil {
		return err
	}
	s.ptmx = w
	go func() {
		defer r.Close()
		buf := make([]byte, 4096)
		for {
			n, readErr := r.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				s.scrollback.Write(data)
				s.LastActive = time.Now()
				s.outMu.Lock()
				if s.outChan != nil {
					select {
					case s.outChan <- data:
					default:
					}
				}
				s.outMu.Unlock()
			}
			if readErr != nil {
				if readErr != io.EOF {
					_ = readErr // pipe errors are expected on close
				}
				close(s.done)
				onExit(s.ID)
				return
			}
		}
	}()
	return nil
}

func (m *Manager) Create(name string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, s := range m.sessions {
		if s.Name == name {
			return nil, ErrNameTaken
		}
	}

	s := &Session{
		ID:         uuid.New().String(),
		Name:       name,
		CreatedAt:  time.Now(),
		LastActive: time.Now(),
		scrollback: newScrollbackBuf(),
		done:       make(chan struct{}),
	}

	spawn := m.spawnFn
	if spawn == nil {
		spawn = spawnPTY
	}
	if err := spawn(s, m.remove); err != nil {
		return nil, err
	}

	m.sessions[s.ID] = s
	return s, nil
}

func (m *Manager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	return list
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

func (m *Manager) Kill(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[id]
	if !ok {
		return ErrNotFound
	}

	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
	if s.ptmx != nil {
		s.ptmx.Close()
	}
	delete(m.sessions, id)
	return nil
}

func (m *Manager) remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
}
