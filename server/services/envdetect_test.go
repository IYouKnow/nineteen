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
	for _, want := range []string{"HOST_KEY", "INTERP", "WITH_DEF"} {
		if _, ok := keys[want]; !ok {
			t.Fatalf("compose missing %q: %+v", want, got3)
		}
	}
	for _, notWant := range []string{"db", "BAKED"} {
		if _, ok := keys[notWant]; ok {
			t.Fatalf("compose false positive %q: %+v", notWant, got3)
		}
	}
	if keys["WITH_DEF"].Required {
		t.Fatalf("WITH_DEF should be optional: %+v", keys["WITH_DEF"])
	}
}
