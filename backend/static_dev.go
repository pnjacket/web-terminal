//go:build dev

package main

import (
	"io/fs"
	"os"
)

var staticFiles fs.FS = os.DirFS("../frontend")
