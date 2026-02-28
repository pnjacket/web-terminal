package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"web-terminal/api"
	"web-terminal/preset"
	"web-terminal/session"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	presetFile := os.Getenv("PRESET_FILE")
	if presetFile == "" {
		presetFile = "/data/presets.json"
	}
	pm, err := preset.NewManager(presetFile)
	if err != nil {
		log.Fatalf("failed to load presets: %v", err)
	}

	manager := session.NewManager()
	router := api.RegisterRoutes(manager, pm, staticFiles)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("web-terminal listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
