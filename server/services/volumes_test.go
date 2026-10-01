package services

import (
	"os"
	"strings"
	"testing"
)

func TestSanitizeVolumeHint(t *testing.T) {
	cases := map[string]string{
		"Code Server Config": "code-server-config",
		"appdata/x":          "appdata-x",
		"":                   "data",
		"---":                "data",
		"a/b\\c":             "a-b-c",
	}
	for in, want := range cases {
		if got := sanitizeVolumeHint(in); got != want {
			t.Fatalf("sanitize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWriteComposeOverrideNamedVolumes(t *testing.T) {
	override, err := WriteComposeOverride(
		[]string{"app"},
		"",
		[]BindMount{
			{Source: "myvol", Target: "/config", Named: true},
			{Source: "/host/data", Target: "/data"},
		},
		"unless-stopped",
	)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(override)
	raw, err := os.ReadFile(override)
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	if !strings.Contains(content, "- type: volume") {
		t.Fatalf("missing named volume entry:\n%s", content)
	}
	if !strings.Contains(content, "volumes:\n  myvol:") {
		t.Fatalf("missing top-level volumes block:\n%s", content)
	}
}
