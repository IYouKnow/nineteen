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
