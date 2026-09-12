package services

import (
	"net"
	"strings"
	"testing"
)

// Projects that share a slug (or repository) must never resolve to the same
// container/compose name — the project id keeps them distinct.
func TestProjectContainerNameUniquePerID(t *testing.T) {
	a := ProjectContainerName(14, "cf-tunnels")
	b := ProjectContainerName(21, "cf-tunnels")
	if a == b {
		t.Fatalf("same slug produced identical container names: %q", a)
	}
	if !strings.HasPrefix(a, "nineteen-14-cf-tunnels") {
		t.Errorf("ProjectContainerName = %q, want prefix nineteen-14-cf-tunnels", a)
	}
}

func TestProjectComposeNameUniquePerID(t *testing.T) {
	a := ProjectComposeName(14, "cf-tunnels")
	b := ProjectComposeName(21, "cf-tunnels")
	if a == b {
		t.Fatalf("same slug produced identical compose names: %q", a)
	}
}

func TestProjectComposeNameTruncated(t *testing.T) {
	long := strings.Repeat("a", 200)
	got := ProjectComposeName(1, long)
	if len(got) > 60 {
		t.Errorf("compose name length = %d, want <= 60", len(got))
	}
}

// A port that is already bound must be reported unavailable so a deploy can
// reassign a free one instead of failing with "port is already allocated".
func TestHostPortAvailable(t *testing.T) {
	d := NewDeployer()

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	busy := l.Addr().(*net.TCPAddr).Port
	if d.HostPortAvailable(busy) {
		t.Errorf("port %d is bound but reported available", busy)
	}
	l.Close()

	free, err := d.FreePort()
	if err != nil {
		t.Fatal(err)
	}
	if !d.HostPortAvailable(free) {
		t.Errorf("port %d is free but reported unavailable", free)
	}
}
