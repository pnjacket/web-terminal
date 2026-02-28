XTERM_VERSION          := 5.5.0
XTERM_FIT_VERSION      := 0.10.0
XTERM_WEBLINKS_VERSION := 0.11.0

UNPKG := https://unpkg.com

.PHONY: run build copy-frontend vendor-frontend vendor-codemirror docker-build docker-up docker-down tidy clean test test-backend test-frontend lint lint-backend lint-frontend

test: test-backend test-frontend

test-backend:
	go -C backend test ./...

test-frontend:
	cd frontend && npm test

lint: lint-backend lint-frontend

lint-backend:
	cd backend && $$(command -v golangci-lint || echo "$$(go env GOPATH)/bin/golangci-lint") run --build-tags dev ./...

lint-frontend:
	cd frontend && npm run lint

run:
	PRESET_FILE=./data/presets.json go -C backend run -tags dev .

build: copy-frontend
	go -C backend build -o web-terminal .

copy-frontend:
	rm -rf backend/static
	cp -r frontend backend/static

vendor-frontend:
	mkdir -p frontend/vendor
	curl -fsSL "$(UNPKG)/@xterm/xterm@$(XTERM_VERSION)/lib/xterm.js" \
		-o frontend/vendor/xterm.js
	curl -fsSL "$(UNPKG)/@xterm/xterm@$(XTERM_VERSION)/css/xterm.css" \
		-o frontend/vendor/xterm.css
	curl -fsSL "$(UNPKG)/@xterm/addon-fit@$(XTERM_FIT_VERSION)/lib/addon-fit.js" \
		-o frontend/vendor/xterm-addon-fit.js
	curl -fsSL "$(UNPKG)/@xterm/addon-web-links@$(XTERM_WEBLINKS_VERSION)/lib/addon-web-links.js" \
		-o frontend/vendor/xterm-addon-web-links.js

vendor-codemirror:
	docker run --rm -v $(PWD)/frontend/vendor:/out node:20-alpine sh -c " \
	  mkdir -p /build && cd /build && \
	  npm init -y >/dev/null 2>&1 && \
	  npm install esbuild @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-markdown @codemirror/theme-one-dark @codemirror/search @codemirror/language-data >/dev/null 2>&1 && \
	  printf 'export * from \"@codemirror/state\";\nexport * from \"@codemirror/view\";\nexport * from \"@codemirror/commands\";\nexport * from \"@codemirror/language\";\nexport * from \"@codemirror/lang-markdown\";\nexport * from \"@codemirror/theme-one-dark\";\nexport * from \"@codemirror/search\";\nexport { languages } from \"@codemirror/language-data\";' > /build/cm-entry.js && \
	  ./node_modules/.bin/esbuild /build/cm-entry.js --bundle --format=iife --global-name=CM --minify-whitespace --minify-syntax --legal-comments=inline --outfile=/out/codemirror.bundle.js"

docker-build:
	docker build -t web-terminal .

docker-up:
	docker compose up -d

docker-down:
	docker compose down

tidy:
	go -C backend mod tidy

clean:
	rm -f backend/web-terminal
	rm -rf backend/static
