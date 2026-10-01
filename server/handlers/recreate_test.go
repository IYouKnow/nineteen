package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestComposeServiceImages(t *testing.T) {
	dir := t.TempDir()
	content := `services:
  app:
    image: ghcr.io/org/app:1.2
    environment:
      - HOST_KEY
  db:
    image: "postgres:16" # comment
    ports:
      - "5432:5432"
`
	if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got := composeServiceImages(dir, "compose.yml")
	if len(got) != 2 || got[0] != "ghcr.io/org/app:1.2" || got[1] != "postgres:16" {
		t.Fatalf("got %+v", got)
	}
	if composeServiceImages(dir, "missing.yml") != nil {
		t.Fatalf("missing file should yield nil")
	}
}
