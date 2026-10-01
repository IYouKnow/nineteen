package services

import "testing"

func TestSuggestStateDirs(t *testing.T) {
	got := SuggestStateDirs("lscr.io/linuxserver/code-server:4.96")
	if len(got) != 1 || got[0].ContainerPath != "/config" || !got[0].Auto {
		t.Fatalf("linuxserver code-server: %+v", got)
	}
	// codercom/code-server keeps state in $HOME, not /config (linuxserver
	// convention). Suggesting /config there migrates an empty directory.
	got = SuggestStateDirs("codercom/code-server:latest")
	if len(got) != 1 || got[0].ContainerPath != "/home/coder" || !got[0].Auto {
		t.Fatalf("codercom code-server: %+v", got)
	}
	got = SuggestStateDirs("ghcr.io/coder/code-server:4.96")
	if len(got) != 1 || got[0].ContainerPath != "/home/coder" {
		t.Fatalf("coder code-server: %+v", got)
	}
	got = SuggestStateDirs("postgres:16")
	if len(got) != 1 || got[0].ContainerPath != "/var/lib/postgresql/data" {
		t.Fatalf("postgres: %+v", got)
	}
	// Redis dumps are a cache by design: warned about, never auto-mounted.
	got = SuggestStateDirs("redis:7")
	if len(got) != 1 || got[0].Auto {
		t.Fatalf("redis should be manual-only: %+v", got)
	}
	if SuggestStateDirs("nginx:latest") != nil {
		t.Fatalf("nginx should have no suggestions")
	}
	if SuggestStateDirs("") != nil {
		t.Fatalf("empty image should have no suggestions")
	}
}

func TestDeclaredSuggestion(t *testing.T) {
	s := declaredSuggestion("/var/lib/postgresql/data")
	if s.HostSubdir != "appdata/var-lib-postgresql-data" || !s.Auto || s.Reason == "" {
		t.Fatalf("declared suggestion: %+v", s)
	}
}

func TestAllStateSuggestionsCuratedFallback(t *testing.T) {
	// Unknown image, nothing declared: curated fallback (or empty) but never
	// an error. linuxserver/code-server resolves without docker.
	got := AllStateSuggestions([]string{"lscr.io/linuxserver/code-server:4.96"})
	found := false
	for _, s := range got {
		if s.ContainerPath == "/config" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected /config suggestion: %+v", got)
	}
	if got := AllStateSuggestions([]string{"no-such-image-xyz:latest"}); len(got) != 0 {
		t.Fatalf("unknown image should yield nothing: %+v", got)
	}
}
