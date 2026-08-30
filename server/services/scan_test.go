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
