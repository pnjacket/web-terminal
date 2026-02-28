//go:build !dev

package main

import "embed"

//go:embed static
var staticFiles embed.FS
