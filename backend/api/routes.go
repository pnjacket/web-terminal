package api

import (
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"web-terminal/preset"
	"web-terminal/session"
)

func RegisterRoutes(manager *session.Manager, pm *preset.Manager, staticFS fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	h := &handler{manager: manager, presetManager: pm}

	// REST API
	r.Get("/api/sessions", h.listSessions)
	r.Post("/api/sessions", h.createSession)
	r.Delete("/api/sessions/{id}", h.killSession)

	// WebSocket
	r.Get("/api/sessions/{id}/ws", h.handleWS)

	// Presets API
	r.Get("/api/presets", h.getPresets)
	r.Put("/api/presets", h.putPresets)
	r.Post("/api/presets/{id}/use", h.usePreset)

	// Static sub-FS: strip the "static/" prefix present in the embed.FS.
	// In dev mode staticFS is already rooted at frontend/, so Sub returns a
	// wrapper unconditionally (no error) but the sub-FS would look for
	// frontend/static/* which doesn't exist. Probe index.html to detect this.
	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		staticSub = staticFS
	} else if _, statErr := fs.Stat(staticSub, "index.html"); statErr != nil {
		staticSub = staticFS
	}

	// Serve HTML pages by reading from the FS directly.
	// Using http.FileServer with r.URL.Path ending in "index.html" triggers
	// Go's built-in redirect to "./" — avoid that by reading the file manually.
	r.Get("/", serveFile(staticSub, "index.html"))
	r.Get("/session/{id}", serveFile(staticSub, "session.html"))

	// Static assets — use standard file server
	fileServer := http.FileServer(http.FS(staticSub))
	r.Get("/vendor/*", fileServer.ServeHTTP)
	r.Get("/css/*", fileServer.ServeHTTP)
	r.Get("/js/*", fileServer.ServeHTTP)

	return r
}

// serveFile returns a handler that reads a single file from fsys and sends it.
func serveFile(fsys fs.FS, name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		content, err := fs.ReadFile(fsys, name)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(content)
	}
}

type handler struct {
	manager       *session.Manager
	presetManager *preset.Manager
}
