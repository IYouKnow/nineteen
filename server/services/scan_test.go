package services

import "testing"

func TestSuggestBuildContextMonorepoRoot(t *testing.T) {
	content := []byte(`FROM golang:1.25-alpine AS server-builder
COPY packages/shared ./packages/shared
COPY package.json pnpm-lock.yaml ./
COPY packages/server/ ./
`)
	files := []string{
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"packages/shared/package.json",
		"packages/web/package.json",
		"packages/server/Dockerfile",
		"packages/server/go.mod",
		"packages/server/go.sum",
	}
	if got := SuggestBuildContext("packages/server/Dockerfile", content, files); got != "." {
		t.Errorf("SuggestBuildContext() = %q, want %q", got, ".")
	}
}

func TestSuggestBuildContextNextToDockerfile(t *testing.T) {
	content := []byte("COPY app ./app\nCOPY go.mod ./\n")
	files := []string{"docker/Dockerfile", "docker/app/main.go", "docker/go.mod"}
	if got := SuggestBuildContext("docker/Dockerfile", content, files); got != "docker" {
		t.Errorf("SuggestBuildContext() = %q, want %q", got, "docker")
	}
}

func TestSuggestBuildContextNoSignal(t *testing.T) {
	files := []string{"Dockerfile", "main.go"}
	if got := SuggestBuildContext("Dockerfile", []byte("COPY . .\n"), files); got != "." {
		t.Errorf("SuggestBuildContext() = %q, want %q", got, ".")
	}
}
