package services

import "testing"

func TestBuildEnvVarsMasksSecrets(t *testing.T) {
	env := map[string]string{
		"NINETEEN_REPO": "acme/nineteen",
		"JWT_SECRET":    "super-secret-value",
	}
	vars := buildEnvVars(env)

	byKey := map[string]EnvVar{}
	for _, v := range vars {
		byKey[v.Key] = v
	}

	if repo := byKey["NINETEEN_REPO"]; !repo.Set || repo.Value != "acme/nineteen" || repo.Secret {
		t.Fatalf("NINETEEN_REPO = %+v, want set with real value and not secret", repo)
	}

	secret := byKey["JWT_SECRET"]
	if !secret.Set || !secret.Secret {
		t.Fatalf("JWT_SECRET = %+v, want set and secret", secret)
	}
	if secret.Value != secretMask || secret.Value == env["JWT_SECRET"] {
		t.Fatalf("JWT_SECRET value = %q, want mask %q and never the real value", secret.Value, secretMask)
	}

	if addr := byKey["ADDR"]; addr.Set || addr.Value != "" {
		t.Fatalf("ADDR = %+v, want unset with empty value", addr)
	}
}

func TestParseExtServers(t *testing.T) {
	cases := []struct {
		line string
		want []string
	}{
		{"# ExtServers: [192.168.0.1 1.1.1.1]", []string{"192.168.0.1", "1.1.1.1"}},
		{"# ExtServers: []", nil},
		{"nameserver 127.0.0.11", nil},
		{"# no brackets here", nil},
	}
	for _, c := range cases {
		got := parseExtServers(c.line)
		if len(got) != len(c.want) {
			t.Fatalf("parseExtServers(%q) = %v, want %v", c.line, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("parseExtServers(%q) = %v, want %v", c.line, got, c.want)
			}
		}
	}
}

func TestResolveHostRejectsInvalid(t *testing.T) {
	if res := resolveHost("bad host!"); res.OK || res.Error != "invalid hostname" {
		t.Fatalf("resolveHost(invalid) = %+v, want invalid hostname error", res)
	}
}
