package services

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestIsDNSFailure(t *testing.T) {
	dns := []string{
		"fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com",
		"fatal: unable to access 'https://gitea.local/a/b.git/': Temporary failure in name resolution",
		"getaddrinfo: Name or service not known",
	}
	for _, s := range dns {
		if !IsDNSFailure(s) {
			t.Fatalf("expected DNS failure for %q", s)
		}
	}

	other := []string{
		"fatal: repository 'https://github.com/a/b.git/' not found",
		"fatal: Authentication failed for 'https://github.com/a/b.git/'",
		"exit status 128",
	}
	for _, s := range other {
		if IsDNSFailure(s) {
			t.Fatalf("did not expect DNS failure for %q", s)
		}
	}
}

func TestCloneHost(t *testing.T) {
	cases := map[string]string{
		"https://oauth2:tok@github.com/acme/repo.git": "github.com",
		"https://gitea.example.com:3000/a/b.git":      "gitea.example.com",
		"not a url":                                   "",
	}
	for in, want := range cases {
		if got := cloneHost(in); got != want {
			t.Fatalf("cloneHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCloneErrorDNSHint(t *testing.T) {
	output := "fatal: unable to access 'https://github.com/acme/repo.git/': Could not resolve host: github.com\n"
	err := cloneError("https://github.com/acme/repo.git", output, errors.New("exit status 128"))
	msg := err.Error()
	if !strings.Contains(msg, "could not resolve") {
		t.Fatalf("want DNS hint, got %q", msg)
	}
	if !strings.Contains(msg, "github.com") {
		t.Fatalf("hint should name the host, got %q", msg)
	}
	if !strings.Contains(msg, "NINETEEN_DNS") {
		t.Fatalf("hint should point at the fix, got %q", msg)
	}
}

func TestCloneErrorIncludesGitTextForOtherFailures(t *testing.T) {
	output := "remote: Repository not found.\nfatal: repository 'https://github.com/acme/repo.git/' not found\n"
	err := cloneError("https://github.com/acme/repo.git", output, errors.New("exit status 128"))
	msg := err.Error()
	if strings.Contains(msg, "could not resolve") {
		t.Fatalf("should not add a DNS hint for a non-DNS failure, got %q", msg)
	}
	if !strings.Contains(msg, "not found") {
		t.Fatalf("should carry git's own last line, got %q", msg)
	}
}

func TestPreflightCloneHostSkipsResolvableCases(t *testing.T) {
	// A literal IP needs no resolution.
	if err := PreflightCloneHost(context.Background(), "https://10.0.0.5/acme/repo.git"); err != nil {
		t.Fatalf("IP host should skip preflight, got %v", err)
	}
	// A configured proxy means resolution happens at the proxy, not locally.
	t.Setenv("HTTPS_PROXY", "http://proxy.internal:3128")
	if err := PreflightCloneHost(context.Background(), "https://github.com/acme/repo.git"); err != nil {
		t.Fatalf("proxy should skip preflight, got %v", err)
	}
}
