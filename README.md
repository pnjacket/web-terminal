# Web Terminal

A self-hosted, browser-accessible web terminal that provides persistent bash sessions through a single lightweight Docker container. Sessions survive browser tab closes and remain active until explicitly killed or the container stops.

---

## Features

- **Persistent sessions** — closing the browser tab does not kill the session; reconnect at any time
- **Multiple sessions** — create and manage any number of named bash sessions
- **Scrollback replay** — full output history is replayed when you reconnect
- **Markdown note editor** — right-panel editor with multi-tab support, CodeMirror syntax highlighting, and paste-to-terminal
- **Resizable split layout** — drag the divider to adjust terminal/editor proportions
- **No authentication** — intended for trusted local network / reverse proxy deployments

---

## Prerequisites

- **Go 1.22+** (for local development)
- **Docker + Docker Compose** (for production deployment)
- **make**
- **curl** (for vendoring frontend assets)

---

## First-time Setup

```bash
git clone <repo-url> web-terminal
cd web-terminal
make vendor-frontend   # download xterm.js assets into frontend/vendor/
make vendor-codemirror # build codemirror.bundle.js (requires Docker)
make tidy              # fetch Go dependencies and generate go.sum
```

---

## Local Development

```bash
make run
```

Opens a dev server on [http://localhost:8080](http://localhost:8080).

- Frontend files are served directly from `frontend/` — edit HTML/CSS/JS and reload the browser.
- Edit Go files and re-run `make run` to pick up backend changes.

---

## Production (Docker)

```bash
make docker-up
```

Builds the image and starts the container on port 8080. Access via `http://<host>:8080`.

```bash
make docker-down   # stop the container
```

Static assets are embedded into the binary at build time — no separate `frontend/` directory is needed at runtime.

---

## Running Tests

```bash
make test            # run all tests (backend + frontend)
make test-backend    # Go unit + integration tests
make test-frontend   # Vitest/jsdom frontend tests
```

Backend tests cover session model, scrollback buffer, manager, REST API, and WebSocket handling.
Frontend tests cover utility functions, the terminal adapter, and the note editor.

---

## Configuration

| Variable | Default | Description         |
|----------|---------|---------------------|
| `PORT`   | `8080`  | HTTP listening port |

---

## Usage

### Creating a session

1. Open `http://localhost:8080`.
2. Click **+ New Session**, enter a name, and click **Create**.
3. The session opens in a new browser tab with a full bash terminal.

### Reconnecting to a session

Closing the browser tab does **not** kill the session. Return to the landing page, find your session in the list, and click **Connect**.

Scrollback from previous activity is replayed when you reconnect.

### Killing a session

Click **Kill** next to a session on the landing page, or type `exit` inside the terminal. Either action removes the session immediately.

### Note editor

The right panel is a multi-tab Markdown editor backed by `localStorage`:

- **Send** — pastes the current tab's content into the terminal and marks the tab read-only
- **Copy** — copies the content to the clipboard
- **Export** — downloads all tabs as a single Markdown file
- **Delete** — removes all read-only tabs (with confirmation)

---

## Makefile Targets

| Target               | Description                                              |
|----------------------|----------------------------------------------------------|
| `make run`           | Start dev server (frontend served from disk)             |
| `make build`         | Build production binary with embedded static assets      |
| `make test`          | Run all tests                                            |
| `make test-backend`  | Run Go tests                                             |
| `make test-frontend` | Run Vitest frontend tests                                |
| `make vendor-frontend` | Download xterm.js assets into `frontend/vendor/`       |
| `make vendor-codemirror` | Build `codemirror.bundle.js` via Docker + esbuild   |
| `make docker-build`  | Build Docker image                                       |
| `make docker-up`     | Build image and start container                          |
| `make docker-down`   | Stop and remove container                                |
| `make tidy`          | Run `go mod tidy`                                        |
| `make clean`         | Remove build artifacts and `backend/static/`             |

---

## Project Structure

```
web-terminal/
├── Dockerfile              # multi-stage build (Go builder → Alpine runtime)
├── docker-compose.yml
├── Makefile
├── backend/
│   ├── main.go             # entry point: reads PORT, starts HTTP server
│   ├── static_dev.go       # dev build tag: serve frontend from disk
│   ├── static_prod.go      # prod build tag: embed frontend into binary
│   ├── session/
│   │   ├── manager.go      # session registry: create / list / kill
│   │   ├── model.go        # Session struct, scrollback buffer, client fan-out
│   │   ├── pty.go          # PTY spawn, read loop, scrollback accumulation
│   │   ├── manager_test.go
│   │   ├── model_test.go
│   │   └── scrollback_test.go
│   └── api/
│       ├── routes.go       # HTTP + WebSocket route registration
│       ├── sessions.go     # REST handlers (list, create, kill)
│       ├── ws.go           # WebSocket handler: scrollback replay, I/O bridge
│       ├── sessions_test.go
│       └── ws_test.go
└── frontend/
    ├── index.html          # landing page (session list)
    ├── session.html        # terminal + note editor page
    ├── package.json        # Vitest test tooling
    ├── vitest.config.js
    ├── vendor/             # vendored JS libraries (committed)
    │   ├── xterm.js
    │   ├── xterm.css
    │   ├── xterm-addon-fit.js
    │   ├── xterm-addon-web-links.js
    │   └── codemirror.bundle.js
    ├── css/
    │   └── style.css
    └── js/
        ├── terminal.js     # TerminalAdapter (xterm.js wrapper)
        ├── session.js      # WebSocket ↔ terminal wiring, resizable split
        ├── landing.js      # session list, create, kill UI logic
        ├── notes.js        # NoteEditor: multi-tab CodeMirror editor
        ├── utils.js        # escapeHtml, formatRelative helpers
        └── test/
            ├── utils.test.js
            ├── terminal.test.js
            └── notes.test.js
```

---

## License

This project is licensed under the [MIT License](LICENSE). See the [NOTICE](NOTICE) file for the copyright and license texts of all third-party components.

---

## Architecture

- **Backend**: Go binary using [chi](https://github.com/go-chi/chi) for routing, [gorilla/websocket](https://github.com/gorilla/websocket) for WebSocket, and [creack/pty](https://github.com/creack/pty) for PTY management. One `bash --login` process per session.
- **Frontend**: Vanilla JS ES modules, [xterm.js](https://xtermjs.org/) for terminal rendering, [CodeMirror 6](https://codemirror.net/) for the note editor. No build step required for development.
- **Sessions**: In-memory only — lost on container restart. Each session accumulates up to 1 MB of scrollback even without a connected browser.
- **Static assets**: Embedded into the binary via `go:embed` for production; served from disk in dev mode (`-tags dev`).

### WebSocket Protocol

| Direction        | Message                                    |
|------------------|--------------------------------------------|
| Client → Server  | `{"type":"input","data":"<base64>"}`       |
| Client → Server  | `{"type":"resize","cols":N,"rows":N}`      |
| Server → Client  | `{"type":"output","data":"<base64>"}`      |
| Server → Client  | `{"type":"closed"}`                        |
