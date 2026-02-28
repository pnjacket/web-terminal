package api

import (
	"encoding/base64"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

const (
	// pingInterval is how often the server sends a WebSocket ping frame.
	// Must be less than pongWait and less than any reverse-proxy idle timeout.
	pingInterval = 30 * time.Second
	// pongWait is how long the server waits for a pong response before closing.
	pongWait = 60 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type wsMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

func (h *handler) handleWS(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, ok := h.manager.Get(id)
	if !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Configure ping/pong keepalive so the connection survives reverse-proxy
	// idle timeouts. The client browser responds to pings automatically.
	conn.SetReadDeadline(time.Now().Add(pongWait)) //nolint:errcheck
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	// Serialise all WebSocket writes — gorilla/websocket forbids concurrent writes.
	var writeMu sync.Mutex
	writeMsg := func(msg wsMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(msg)
	}

	outChan := make(chan []byte, 256)
	kick := s.SetClient(outChan)        // also sets s.Connected = true; kicks any prior client
	defer s.ClearClient(outChan)        // closes outChan + clears session state if still owner

	// Replay scrollback
	if snap := s.ScrollbackSnapshot(); len(snap) > 0 {
		msg := wsMessage{
			Type: "output",
			Data: base64.StdEncoding.EncodeToString(snap),
		}
		if err := writeMsg(msg); err != nil {
			log.Printf("WS scrollback replay error: %v", err)
			return
		}
	}

	// Goroutine: pump live PTY output to client.
	// Exits when ClearClient closes outChan.
	go func() {
		for data := range outChan {
			msg := wsMessage{
				Type: "output",
				Data: base64.StdEncoding.EncodeToString(data),
			}
			if err := writeMsg(msg); err != nil {
				return
			}
		}
	}()

	// Goroutine: watch for session end or displacement and close the connection
	// so ReadJSON below unblocks immediately.
	connDone := make(chan struct{})
	go func() {
		select {
		case <-s.Done():
			writeMsg(wsMessage{Type: "closed"}) //nolint:errcheck
			conn.Close()
		case <-kick:
			// Displaced by a newer connection — close without a "closed" message
			// so the client shows the disconnected overlay rather than session-ended.
			conn.Close()
		case <-connDone:
		}
	}()
	defer close(connDone)

	// Goroutine: send periodic pings to keep the connection alive through
	// reverse-proxy idle timeouts.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				writeMu.Lock()
				err := conn.WriteMessage(websocket.PingMessage, nil)
				writeMu.Unlock()
				if err != nil {
					return
				}
			case <-connDone:
				return
			}
		}
	}()

	// Main loop: read client messages.
	for {
		var msg wsMessage
		if err := conn.ReadJSON(&msg); err != nil {
			// Client disconnected, or conn was closed by the done-watcher above.
			// Either way the session keeps running.
			return
		}

		switch msg.Type {
		case "input":
			data, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			if _, err := s.WriteToPTY(data); err != nil {
				log.Printf("PTY write error: %v", err)
				return
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				if err := pty.Setsize(s.PTY(), &pty.Winsize{
					Rows: msg.Rows,
					Cols: msg.Cols,
				}); err != nil {
					log.Printf("PTY resize error: %v", err)
				}
			}
		}
	}
}
