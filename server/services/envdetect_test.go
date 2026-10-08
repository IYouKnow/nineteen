package services

import "testing"

func TestEnvDetectParsers(t *testing.T) {
	dotenv := []byte("# comment\nDATABASE_URL=\nPORT=3000\nexport API_KEY=\nBARE_KEY\n")
	got := ParseDotEnvExample(dotenv, ".env.example")
	if len(got) != 4 {
		t.Fatalf("dotenv: got %d, want 4: %+v", len(got), got)
	}
	if !got[0].Required || got[0].Key != "DATABASE_URL" {
		t.Fatalf("dotenv[0]: %+v", got[0])
	}
	if got[1].Required || got[1].Default != "3000" {
		t.Fatalf("dotenv[1]: %+v", got[1])
	}

	docker := []byte("FROM node:20\nENV NODE_ENV=production\nENV SECRET_KEY\nARG APP_VERSION=1.0\nARG TOKEN\n")
	got2 := ParseDockerfileEnv(docker)
	if len(got2) != 4 {
		t.Fatalf("docker: got %d: %+v", len(got2), got2)
	}

	compose := []byte(`services:
  app:
    image: foo
    depends_on:
      - db
    environment:
      - HOST_KEY
      - BAKED=value
      - ${INTERP}
      - ${WITH_DEF:-fallback}
    ports:
      - "3000:3000"
`)
	got3 := ParseComposeEnv(compose, "compose")
	keys := map[string]RequiredEnvVar{}
	for _, e := range got3 {
		keys[e.Key] = e
	}
	for _, want := range []string{"HOST_KEY", "INTERP", "WITH_DEF", "BAKED"} {
		if _, ok := keys[want]; !ok {
			t.Fatalf("compose missing %q: %+v", want, got3)
		}
	}
	if _, ok := keys["db"]; ok {
		t.Fatalf("compose false positive %q: %+v", "db", got3)
	}
	if keys["WITH_DEF"].Required {
		t.Fatalf("WITH_DEF should be optional: %+v", keys["WITH_DEF"])
	}
	// A baked `- KEY=value` is surfaced as optional with that default.
	if keys["BAKED"].Required || keys["BAKED"].Default != "value" {
		t.Fatalf("BAKED should be optional with default: %+v", keys["BAKED"])
	}
}

func TestParseComposeEnvInterpolation(t *testing.T) {
	compose := []byte(`services:
  app:
    image: foo
    environment:
      - ${REQUIRED}
      - ${EMPTY_DEF:-}
      - ${WITH_DEF:-fallback}
      - ${DASH_DEF-fallback}
      - ${ASSIGN:=x}
      - ${COLON_Q:?must set}
      - ${Q?must set}
      - $BARE
`)
	keys := map[string]RequiredEnvVar{}
	for _, e := range ParseComposeEnv(compose, "compose") {
		keys[e.Key] = e
	}

	cases := []struct {
		key      string
		required bool
		def      string
	}{
		{"REQUIRED", true, ""},
		{"EMPTY_DEF", true, ""}, // ${VAR:-} must stay required — the blind spot
		{"WITH_DEF", false, "fallback"},
		{"DASH_DEF", false, "fallback"},
		{"ASSIGN", false, "x"},
		{"COLON_Q", true, ""},
		{"Q", true, ""},
		{"BARE", true, ""},
	}
	for _, c := range cases {
		got, ok := keys[c.key]
		if !ok {
			t.Fatalf("compose missing %q: %+v", c.key, keys)
		}
		if got.Required != c.required || got.Default != c.def {
			t.Fatalf("%s: got required=%v default=%q, want required=%v default=%q",
				c.key, got.Required, got.Default, c.required, c.def)
		}
	}
}

func TestParseComposeEnvBakedValues(t *testing.T) {
	compose := []byte(`services:
  app:
    environment:
      STATIC_KEY: value
      QUOTED: "quoted value"
      COMMENTED: value # trailing note
      INTERP_KEY: ${OTHER}
    env_file: .env
  db:
    environment:
      - LIST_KEY=listval
`)
	keys := map[string]RequiredEnvVar{}
	for _, e := range ParseComposeEnv(compose, "compose") {
		keys[e.Key] = e
	}

	if k := keys["STATIC_KEY"]; k.Required || k.Default != "value" {
		t.Fatalf("STATIC_KEY: %+v", k)
	}
	if k := keys["QUOTED"]; k.Required || k.Default != "quoted value" {
		t.Fatalf("QUOTED: %+v", k)
	}
	if k := keys["COMMENTED"]; k.Required || k.Default != "value" {
		t.Fatalf("COMMENTED: %+v", k)
	}
	if k := keys["LIST_KEY"]; k.Required || k.Default != "listval" {
		t.Fatalf("LIST_KEY: %+v", k)
	}
	// An interpolated value is owned by the interpolation pass.
	if k, ok := keys["OTHER"]; !ok || !k.Required {
		t.Fatalf("OTHER should be required: %+v", keys)
	}
	if _, ok := keys["INTERP_KEY"]; ok {
		t.Fatalf("INTERP_KEY should not be recorded as a baked value: %+v", keys["INTERP_KEY"])
	}
	// `env_file` sits outside the environment block and must not leak in.
	if _, ok := keys["env_file"]; ok {
		t.Fatalf("env_file false positive")
	}
}

func TestMissingRequiredEnv(t *testing.T) {
	required := []RequiredEnvVar{
		{Key: "MUST", Required: true},
		{Key: "ALSO_MUST", Required: true},
		{Key: "OPTIONAL", Required: false, Default: "3000"},
	}
	have := map[string]string{"ALSO_MUST": "set", "OPTIONAL": ""}

	missing := MissingRequiredEnv(required, have)
	if len(missing) != 1 || missing[0].Key != "MUST" {
		t.Fatalf("missing: %+v", missing)
	}
}
