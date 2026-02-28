# Web Terminal — Specification Document

## 1. Overview

A self-hosted, browser-accessible web terminal application that provides persistent
terminal sessions through a lightweight single Docker container. Sessions survive
browser disconnections and remain active until explicitly killed or the container
stops. Designed for single-user use on a trusted local network.

---

## 2. Goals

- Access a persistent bash terminal from any browser on the local network.
- Sessions survive browser tab closes and network disconnections.
- Multiple independent named sessions manageable from a central landing page.
- Feature-rich terminal experience (full keyboard input, mouse support, copy/paste).
- Minimal footprint: single Alpine-based container, lightweight backend binary.
- The terminal library on the frontend must be swappable with minimal refactoring.

## 3. Non-Goals

- Authentication or access control (deferred; trusted network only for now).
- Session persistence across container restarts (in-memory only is acceptable).
- Multi-user support.
- Container-per-session isolation.
- Built-in multiplexer (no tmux/screen dependency).

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Docker Container                   │
│                   (Alpine Linux)                    │
│                                                     │
│   ┌─────────────┐        ┌──────────────────────┐  │
│   │  Web Backend│◄──WS──►│  PTY Session Manager │  │
│   │   (Go)      │        │  (in-process)        │  │
│   │             │◄──HTTP─┤  bash process per    │  │
│   │  Static     │        │  session             │  │
│   │  File Serve │        └──────────────────────┘  │
│   └─────────────┘                                   │
│          ▲                                          │
│          │ WebSocket + HTTP                         │
└──────────┼──────────────────────────────────────────┘
           │
     Reverse Proxy (host machine)
           │
      Browser (LAN)
```

### Component Summary

| Component         | Technology       | Rationale                                      |
|-------------------|------------------|------------------------------------------------|
| Container base    | Alpine Linux     | Minimal footprint (~5 MB base)                 |
| Backend language  | Go               | Single static binary, low memory, native PTY   |
| Terminal frontend | xterm.js         | Feature-rich, widely supported, swappable      |
| UI framework      | Vanilla JS       | No build toolchain, keeps frontend lightweight |
| Transport         | WebSocket + HTTP | WebSocket for terminal I/O, HTTP for REST API  |

---

## 5. Container & Infrastructure

### Docker Image

- **Base image:** `alpine:latest`
- **Installed packages:** `bash`, `openssh-client`, `ca-certificates`
- **Backend binary:** compiled Go binary copied in at build time (no Go runtime needed)
- **Static assets:** frontend HTML/CSS/JS bundled into the image
- **Exposed port:** configurable via environment variable (default `8080`)
- **Network:** bridge, accessible on local network; reverse proxy terminates TLS upstream

### Docker Compose (for host deployment)

```yaml
services:
  web-terminal:
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
```

### Container Lifecycle

- Session state is **in-memory only**.
- If the container or backend process restarts, all sessions are lost.
- This is acceptable — the container restart policy handles recovery.

---

## 6. Session Model

### Session Object

| Field          | Type      | Description                                      |
|----------------|-----------|--------------------------------------------------|
| `id`           | UUID      | Unique session identifier                        |
| `name`         | string    | User-provided label (required, unique)           |
| `created_at`   | timestamp | When the session was first created               |
| `last_active`  | timestamp | Last time terminal I/O occurred                  |
| `connected`    | bool      | Whether a browser client is currently attached   |
| `pid`          | int       | PID of the underlying bash process               |

### Session Lifecycle

```
Create (name) → bash process spawned with PTY → session listed on landing page
     │
     ├── Browser connects → WebSocket attaches to PTY → `connected = true`
     │
     ├── Browser disconnects (tab closed, network drop) →
     │       WebSocket closes, PTY process keeps running, `connected = false`
     │
     ├── User types `exit` → bash exits → PTY EOF → session removed from list
     │
     └── Kill button (landing page) → SIGKILL to bash PID → session removed
```

### Constraints

- Session names must be unique among active sessions.
- Closing a browser tab **does not** kill the session.
- Each session is one bash process with one PTY, managed directly by the backend.
- No dependency on tmux, screen, or any external multiplexer.

---

## 7. Backend Specification

### Responsibilities

- Serve static frontend assets.
- Manage session lifecycle (create, list, kill).
- Spawn and own bash PTY processes.
- Bridge WebSocket clients to PTY I/O.
- Track session metadata (connected status, last active timestamp).

### REST API

| Method | Path                  | Description                          |
|--------|-----------------------|--------------------------------------|
| GET    | `/api/sessions`       | List all active sessions             |
| POST   | `/api/sessions`       | Create a new session                 |
| DELETE | `/api/sessions/:id`   | Kill a session                       |

#### `GET /api/sessions` — Response

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "dev-work",
    "created_at": "2026-02-27T10:00:00Z",
    "last_active": "2026-02-27T10:45:00Z",
    "connected": false
  }
]
```

#### `POST /api/sessions` — Request

```json
{ "name": "dev-work" }
```

Response: `201 Created` with the full session object.
Error on duplicate name: `409 Conflict`.

#### `DELETE /api/sessions/:id`

Response: `204 No Content`.
Sends SIGKILL to the bash process and removes the session from state.

### WebSocket Endpoint

```
GET /api/sessions/:id/ws
```

- Upgrades to WebSocket on connection.
- Sets `connected = true` for the session.
- **Backend → Client:** raw terminal output bytes (UTF-8).
- **Client → Backend:** JSON-framed messages (see below).
- On WebSocket close: sets `connected = false`, PTY process continues running.
- If the bash process exits (EOF on PTY): send a close message to client and
  remove the session.

#### Client → Backend message types

```json
{ "type": "input",  "data": "<base64-encoded keystrokes>" }
{ "type": "resize", "cols": 220, "rows": 50 }
```

#### Backend → Client message types

```json
{ "type": "output", "data": "<base64-encoded terminal output>" }
{ "type": "closed" }
```

### PTY Management

- Each session spawns: `bash --login` in a PTY.
- Working directory: `$HOME` of the backend process user.
- Environment inherits from backend process, with `TERM=xterm-256color`.
- PTY size is set on connect and updated on terminal resize events.
- The backend process owns all bash PIDs; they are cleaned up on session kill
  or on bash exit (EOF).

---

## 8. Frontend Specification

### Pages

#### Landing Page (`/`)

- Lists all active sessions fetched from `GET /api/sessions`.
- Auto-refreshes the list periodically (e.g., every 5 seconds) without full page reload.
- Per session row displays:
  - Session name
  - Created time (human-readable, e.g., "2 hours ago")
  - Last active time
  - Connected indicator (green dot = someone connected, grey = disconnected)
  - **Connect** button → opens session in a new browser tab
  - **Kill** button → calls `DELETE /api/sessions/:id`, removes row
- **New Session** button → opens a modal/prompt asking for a session name →
  calls `POST /api/sessions` → opens the new session in a new browser tab.
- If no sessions exist, shows an empty state with a prompt to create one.

#### Session Page (`/session/:id`)

- Browser tab title is set to the session name.
- Layout: two-column, 50/50 split.
  - **Left half:** terminal (xterm.js), fills the full height of the viewport.
  - **Right half:** empty placeholder panel, reserved for future features.
- On load: connects via WebSocket to `/api/sessions/:id/ws`.
- On WebSocket `closed` message (bash exited): displays an overlay message
  ("Session ended") and disables input.
- Navigation away from the page closes the WebSocket but does not kill the session.

### Terminal Component (xterm.js)

- **Library:** [xterm.js](https://xtermjs.org/) loaded via CDN or bundled.
- **Addons enabled:**
  - `FitAddon` — resizes terminal to fit its container; sends resize messages to backend.
  - `WebLinksAddon` — makes URLs in terminal output clickable.
  - `ClipboardAddon` or native selection — copy on select, paste on right-click or Ctrl+Shift+V.
- **Swap contract:** the terminal component must be isolated behind a thin adapter
  interface with the following methods, so it can be replaced without touching
  session or WebSocket logic:
  ```
  TerminalAdapter.attach(domElement)
  TerminalAdapter.write(data: string)
  TerminalAdapter.onData(callback: (data: string) => void)
  TerminalAdapter.onResize(callback: (cols, rows) => void)
  TerminalAdapter.resize(cols, rows)
  TerminalAdapter.dispose()
  ```

### Copy/Paste Behaviour

- **Copy:** text selected with the mouse is automatically copied to clipboard.
- **Paste:** Ctrl+Shift+V or right-click pastes from clipboard into terminal input.
- Middle-click paste is supported where browser allows.

---

## 9. UI/UX Details

### Visual Style

- Dark theme by default (terminal aesthetic).
- Minimal chrome: no heavy framework styling.
- Responsive enough to work at typical desktop browser widths.

### Session Page Layout (wireframe)

```
┌──────────────────────────────────────────────────────────┐
│  Tab title: "dev-work"                                   │
├─────────────────────────┬────────────────────────────────┤
│                         │                                │
│    xterm.js terminal    │    [Reserved — future panel]   │
│    (50% width)          │    (50% width)                 │
│    (100% height)        │                                │
│                         │                                │
│                         │                                │
└─────────────────────────┴────────────────────────────────┘
```

### Landing Page Layout (wireframe)

```
┌──────────────────────────────────────────────────────────┐
│  Web Terminal                          [+ New Session]   │
├──────────────────────────────────────────────────────────┤
│  NAME        CREATED        LAST ACTIVE    STATUS        │
│  ─────────────────────────────────────────────────────   │
│  dev-work    2 hours ago    5 min ago      ● connected   │
│                              [Connect]  [Kill]           │
│  build-run   1 day ago      3 hours ago   ○ idle         │
│                              [Connect]  [Kill]           │
└──────────────────────────────────────────────────────────┘
```

---

## 10. File & Directory Structure

```
web-terminal/
├── Dockerfile
├── docker-compose.yml
├── backend/
│   ├── main.go
│   ├── session/
│   │   ├── manager.go       # session registry, create/kill/list
│   │   └── pty.go           # PTY spawn and I/O management
│   ├── api/
│   │   ├── routes.go        # HTTP + WS route registration
│   │   ├── sessions.go      # REST handlers
│   │   └── ws.go            # WebSocket handler
│   └── static/              # embedded frontend assets
└── frontend/
    ├── index.html           # landing page
    ├── session.html         # session page
    ├── css/
    │   └── style.css
    └── js/
        ├── landing.js       # session list, create, kill logic
        ├── session.js       # WebSocket + terminal adapter wiring
        └── terminal.js      # TerminalAdapter implementation (xterm.js)
```

---

## 11. Technology Versions (at time of writing)

| Technology    | Version  |
|---------------|----------|
| Go            | 1.22+    |
| Alpine Linux  | 3.19+    |
| xterm.js      | 5.x      |
| xterm-addon-fit | latest |

---

## 12. Future Considerations (out of scope for v1)

- Authentication (password, token, or mTLS).
- Right panel features (file browser, monitoring, notes).
- Session sharing (read-only observer URL).
- Persistent sessions across container restarts (serialize PTY scrollback to disk).
- Multiple windows/panes within a single session.
- Mobile browser support.
- Configurable shell (zsh, fish) per session.
