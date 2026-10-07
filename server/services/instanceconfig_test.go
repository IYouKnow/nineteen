package services

import "testing"

func TestValidateInstanceConfig(t *testing.T) {
	cases := []struct {
		name    string
		cfg     InstanceConfig
		wantErr bool
	}{
		{
			name: "valid",
			cfg: InstanceConfig{
				Env: map[string]string{
					"NINETEEN_REPO":                  "acme/nineteen",
					"NINETEEN_PROJECT_BIND":          "0.0.0.0",
					"NINETEEN_UPDATE_HEALTH_TIMEOUT": "90",
				},
				DNS: []string{"1.1.1.1", "8.8.8.8"},
			},
		},
		{name: "empty is allowed", cfg: InstanceConfig{}},
		{name: "unmanaged key rejected", cfg: InstanceConfig{Env: map[string]string{"JWT_SECRET": "x"}}, wantErr: true},
		{name: "bad repo rejected", cfg: InstanceConfig{Env: map[string]string{"NINETEEN_REPO": "no-slash"}}, wantErr: true},
		{name: "bad bind rejected", cfg: InstanceConfig{Env: map[string]string{"NINETEEN_PROJECT_BIND": "not-an-ip"}}, wantErr: true},
		{name: "bad timeout rejected", cfg: InstanceConfig{Env: map[string]string{"NINETEEN_UPDATE_HEALTH_TIMEOUT": "0"}}, wantErr: true},
		{name: "bad dns rejected", cfg: InstanceConfig{DNS: []string{"1.1.1.1", "nope"}}, wantErr: true},
		{name: "too many dns rejected", cfg: InstanceConfig{DNS: []string{"1.1.1.1", "8.8.8.8", "9.9.9.9", "8.8.4.4"}}, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateInstanceConfig(c.cfg)
			if c.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// hasPair reports whether args contains the two consecutive tokens a and b.
func hasPair(args []string, a, b string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == a && args[i+1] == b {
			return true
		}
	}
	return false
}

func TestBuildRunArgsAppliesOverrides(t *testing.T) {
	u := &UpdateService{}
	insp := &inspectResult{}
	insp.Config.Env = []string{"ADDR=:8080", "NINETEEN_REPO=old/repo"}
	insp.HostConfig.Dns = []string{"9.9.9.9"}

	ov := &InstanceConfig{
		Env: map[string]string{"NINETEEN_REPO": "new/repo"},
		DNS: []string{"1.1.1.1", "8.8.8.8"},
	}
	args, err := u.buildRunArgs(insp, ov)
	if err != nil {
		t.Fatalf("buildRunArgs: %v", err)
	}

	if !hasPair(args, "-e", "NINETEEN_REPO=new/repo") {
		t.Fatalf("override env missing: %v", args)
	}
	if hasPair(args, "-e", "NINETEEN_REPO=old/repo") {
		t.Fatalf("old env value was not replaced: %v", args)
	}
	if !hasPair(args, "-e", "ADDR=:8080") {
		t.Fatalf("unmanaged env was dropped: %v", args)
	}
	if !hasPair(args, "--dns", "1.1.1.1") || !hasPair(args, "--dns", "8.8.8.8") {
		t.Fatalf("override dns missing: %v", args)
	}
	if hasPair(args, "--dns", "9.9.9.9") {
		t.Fatalf("inspected dns was not replaced: %v", args)
	}
}

func TestBuildRunArgsWithoutOverridePreservesInspected(t *testing.T) {
	u := &UpdateService{}
	insp := &inspectResult{}
	insp.Config.Env = []string{"NINETEEN_REPO=keep/me"}
	insp.HostConfig.Dns = []string{"9.9.9.9"}

	args, err := u.buildRunArgs(insp, nil)
	if err != nil {
		t.Fatalf("buildRunArgs: %v", err)
	}
	if !hasPair(args, "-e", "NINETEEN_REPO=keep/me") {
		t.Fatalf("inspected env dropped: %v", args)
	}
	if !hasPair(args, "--dns", "9.9.9.9") {
		t.Fatalf("inspected dns dropped: %v", args)
	}
}
