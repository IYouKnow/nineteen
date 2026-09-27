package services

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"testing"
)

// TestSaveProjectUploadStreamManyFiles guards against the multipart form
// parser's 1000-part limit: a folder upload sends one file part plus one path
// entry per file, so a few hundred files must still succeed.
func TestSaveProjectUploadStreamManyFiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NINETEEN_DATA_DIR", dir)

	const n = 1200
	rels := make([]string, n)
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("path", ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		rels[i] = fmt.Sprintf("batch/git/repo%d/objects/%02x/file%d", i%7, i%256, i)
	}
	pathsJSON := "[" + joinQuoted(rels) + "]"
	if err := w.WriteField("paths", pathsJSON); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		fw, err := w.CreateFormFile("files", filepath.Base(rels[i]))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fmt.Fprintf(fw, "content-%d", i); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	saved, err := SaveProjectUploadStream(1, multipart.NewReader(&buf, w.Boundary()))
	if err != nil {
		t.Fatalf("SaveProjectUploadStream: %v", err)
	}
	if saved != n {
		t.Fatalf("saved = %d, want %d", saved, n)
	}
	for _, rel := range rels {
		full := filepath.Join(ProjectDataDir(1), filepath.FromSlash(rel))
		if _, err := os.Stat(full); err != nil {
			t.Fatalf("missing uploaded file %s: %v", rel, err)
		}
	}
}

func joinQuoted(items []string) string {
	out := ""
	for i, s := range items {
		if i > 0 {
			out += ","
		}
		out += fmt.Sprintf("%q", s)
	}
	return out
}
