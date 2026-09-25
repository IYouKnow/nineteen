package services

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRankDockerfiles(t *testing.T) {
	paths := []string{
		"apps/web/Dockerfile",
		"Dockerfile.dev",
		"docker/Dockerfile",
		"README.md",
		"src/main.go",
		"Dockerfile",
		"deploy/Dockerfile.prod",
		"node_modules/pkg/Dockerfile",
	}

	got := RankDockerfiles(paths)
	want := []string{"Dockerfile", "docker/Dockerfile", "apps/web/Dockerfile", "deploy/Dockerfile.prod", "Dockerfile.dev"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("RankDockerfiles = %v, want %v", got, want)
	}
}

func TestRankComposeFiles(t *testing.T) {
	paths := []string{
		"docker-compose.yml",
		"src/app.py",
		"stacks/prod/compose.yaml",
		"compose.yaml",
		"docker-compose.override.yml",
		"compose.prod.yml",
	}

	got := RankComposeFiles(paths)
	want := []string{"docker-compose.yml", "compose.yaml", "compose.prod.yml", "stacks/prod/compose.yaml"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("RankComposeFiles = %v, want %v", got, want)
	}
}

func TestRepoFileExistsRejectsTraversal(t *testing.T) {
	d := t.TempDir()
	deployer := NewDeployer()
	if err := writeFile(d, "Dockerfile", "FROM alpine\n"); err != nil {
		t.Fatal(err)
	}
	if !deployer.RepoFileExists(d, "Dockerfile") {
		t.Error("root Dockerfile should exist")
	}
	if deployer.RepoFileExists(d, "../outside") {
		t.Error("path traversal must be rejected")
	}
	if deployer.RepoFileExists(d, "missing/Dockerfile") {
		t.Error("missing file should not exist")
	}
}

func TestParseExposeSubdir(t *testing.T) {
	d := t.TempDir()
	deployer := NewDeployer()
	if err := writeFile(d, "docker/Dockerfile", "FROM alpine\n"); err != nil {
		t.Fatal(err)
	}
	if got := deployer.ParseExpose(d, "docker/Dockerfile"); got != 0 {
		t.Errorf("ParseExpose without EXPOSE = %d, want 0", got)
	}
	if err := writeFile(d, "docker/Dockerfile", "FROM alpine\nEXPOSE 8080\n"); err != nil {
		t.Fatal(err)
	}
	if got := deployer.ParseExpose(d, "docker/Dockerfile"); got != 8080 {
		t.Errorf("ParseExpose = %d, want 8080", got)
	}
}

func writeFile(dir, rel, content string) error {
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(content), 0o644)
}

func TestParseCopySources(t *testing.T) {
	content := []byte(`# syntax=docker/dockerfile:1
FROM golang:1.23 AS build
COPY --chown=app:app go.mod go.sum ./
ADD https://example.com/x.tgz /tmp/
COPY ["cmd/portal-api", "./cmd/"]
COPY --from=build /portal-api /usr/local/bin/portal-api
`)
	got := ParseCopySources(content)
	want := []string{"go.mod", "go.sum", "cmd/portal-api"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseCopySources = %v, want %v", got, want)
	}
}

func TestSuggestBuildContextMonorepo(t *testing.T) {
	files := []string{"README.md", "backend/go.mod", "backend/go.sum", "backend/cmd/portal-api/main.go"}
	content := []byte("FROM golang:1.23\nCOPY go.mod ./\nCOPY . .\n")
	if got := SuggestBuildContext("backend/Dockerfile", content, files); got != "backend" {
		t.Errorf("SuggestBuildContext = %q, want backend", got)
	}
}

func TestSuggestBuildContextRoot(t *testing.T) {
	files := []string{"go.mod", "go.sum", "docker/Dockerfile"}
	content := []byte("FROM golang:1.23\nCOPY go.mod go.sum ./\nCOPY . .\n")
	if got := SuggestBuildContext("docker/Dockerfile", content, files); got != "." {
		t.Errorf("SuggestBuildContext = %q, want .", got)
	}
}

func TestSuggestBuildContextDefaultsToDockerfileDir(t *testing.T) {
	files := []string{"svc/Dockerfile", "svc/main.go"}
	content := []byte("FROM alpine\nCOPY . .\n")
	if got := SuggestBuildContext("svc/Dockerfile", content, files); got != "svc" {
		t.Errorf("SuggestBuildContext = %q, want svc", got)
	}
}

func TestPrepareBuildContext(t *testing.T) {
	d := t.TempDir()
	if err := writeFile(d, "backend/Dockerfile", "FROM alpine\n"); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(d, "Dockerfile", "FROM alpine\n"); err != nil {
		t.Fatal(err)
	}

	// Auto context: the Dockerfile's own directory.
	ctxAbs, rel, arg, cleanup, err := prepareBuildContext(d, "backend/Dockerfile", "")
	if err != nil {
		t.Fatalf("auto context: %v", err)
	}
	defer cleanup()
	if rel != "backend" || arg != "Dockerfile" {
		t.Errorf("auto context = (%q,%q), want (backend,Dockerfile)", rel, arg)
	}
	if filepath.Base(ctxAbs) != "backend" {
		t.Errorf("context dir = %q, want .../backend", ctxAbs)
	}

	// Explicit root context: the Dockerfile is passed repo-relative.
	_, rel, arg, cleanup2, err := prepareBuildContext(d, "backend/Dockerfile", ".")
	if err != nil {
		t.Fatalf("root context: %v", err)
	}
	defer cleanup2()
	if rel != "." || arg != "backend/Dockerfile" {
		t.Errorf("root context = (%q,%q), want (.,backend/Dockerfile)", rel, arg)
	}

	// Dockerfile outside the context is staged into it, then cleaned up.
	_, rel, arg, cleanup3, err := prepareBuildContext(d, "Dockerfile", "backend")
	if err != nil {
		t.Fatalf("outside context: %v", err)
	}
	if rel != "backend" || arg != ".nineteen.Dockerfile" {
		t.Errorf("outside context = (%q,%q), want (backend,.nineteen.Dockerfile)", rel, arg)
	}
	staged := filepath.Join(d, "backend", ".nineteen.Dockerfile")
	if _, statErr := os.Stat(staged); statErr != nil {
		t.Fatalf("staged Dockerfile missing: %v", statErr)
	}
	cleanup3()
	if _, statErr := os.Stat(staged); !os.IsNotExist(statErr) {
		t.Errorf("staged Dockerfile was not removed after cleanup")
	}

	// Traversal must be rejected.
	if _, _, _, _, err := prepareBuildContext(d, "backend/Dockerfile", "../evil"); err == nil {
		t.Errorf("expected traversal context to be rejected")
	}
}
