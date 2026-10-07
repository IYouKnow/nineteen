package services

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// InstanceConfig is the configuration a user applied from the UI. It is
// persisted in the mounted data directory and re-applied whenever Nineteen
// recreates its own container. It deliberately holds only values that are safe
// to change from the UI — secrets (JWT_SECRET, INVITE_CODE) and the published
// port (APP_PORT, a self-lockout footgun) are not among them.
type InstanceConfig struct {
	// Env overrides managed environment variables. Keys are always a subset of
	// EditableEnvKeys.
	Env map[string]string `json:"env,omitempty"`
	// DNS is the resolver list to write into the container (docker --dns).
	DNS []string `json:"dns,omitempty"`
}

// EditableEnvKeys are the environment variables the UI may change. They are
// read by Nineteen at runtime, so a change takes effect on the next start.
var EditableEnvKeys = []string{
	"NINETEEN_REPO",
	"NINETEEN_PROJECT_BIND",
	"NINETEEN_UPDATE_HEALTH_TIMEOUT",
}

// MaxDNSServers bounds the resolver list to keep the recreated container sane.
const MaxDNSServers = 3

const instanceConfigFile = "instance-config.json"

var repoSlugRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// DataDirFromEnv resolves the mounted data directory from the environment the
// same way NewUpdateService does, so the two never disagree.
func DataDirFromEnv() string {
	if d := os.Getenv("NINETEEN_DATA_DIR"); d != "" {
		return d
	}
	if p := os.Getenv("DB_PATH"); p != "" {
		return filepath.Dir(p)
	}
	return "./data"
}

// InstanceConfigPath returns the on-disk location of the persisted config.
func InstanceConfigPath(dataDir string) string {
	return filepath.Join(dataDir, instanceConfigFile)
}

// LoadInstanceConfig reads the persisted config. ok is false when nothing has
// been saved (or the file is unreadable), in which case the container's own
// configuration stands.
func LoadInstanceConfig(dataDir string) (InstanceConfig, bool) {
	var cfg InstanceConfig
	b, err := os.ReadFile(InstanceConfigPath(dataDir))
	if err != nil {
		return InstanceConfig{}, false
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return InstanceConfig{}, false
	}
	return cfg, true
}

// SaveInstanceConfig writes the config atomically, so a crash mid-write can
// never leave a half-written file that would be applied on the next recreate.
func SaveInstanceConfig(dataDir string, cfg InstanceConfig) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := InstanceConfigPath(dataDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ValidateInstanceConfig rejects anything that must never reach a recreated
// container: an unmanaged key, a malformed repo slug, a non-IP bind address or
// resolver, or a non-positive timeout.
func ValidateInstanceConfig(cfg InstanceConfig) error {
	env := map[string]string{}
	for k, v := range cfg.Env {
		if !isEditableEnvKey(k) {
			return fmt.Errorf("%s cannot be changed from the UI", k)
		}
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		switch k {
		case "NINETEEN_REPO":
			if !repoSlugRe.MatchString(v) {
				return fmt.Errorf("NINETEEN_REPO must look like owner/name")
			}
		case "NINETEEN_PROJECT_BIND":
			if net.ParseIP(v) == nil {
				return fmt.Errorf("NINETEEN_PROJECT_BIND must be an IP address")
			}
		case "NINETEEN_UPDATE_HEALTH_TIMEOUT":
			if n, err := strconv.Atoi(v); err != nil || n <= 0 {
				return fmt.Errorf("NINETEEN_UPDATE_HEALTH_TIMEOUT must be a positive number of seconds")
			}
		}
		env[k] = v
	}
	cfg.Env = env

	if len(cfg.DNS) > MaxDNSServers {
		return fmt.Errorf("at most %d DNS servers are allowed", MaxDNSServers)
	}
	for _, d := range cfg.DNS {
		if net.ParseIP(strings.TrimSpace(d)) == nil {
			return fmt.Errorf("DNS server %q is not a valid IP address", d)
		}
	}
	return nil
}

// normalized returns a copy with values trimmed and blanks dropped, so a stray
// space never turns into a malformed --dns flag or env entry on the recreated
// container.
func (c InstanceConfig) normalized() InstanceConfig {
	out := InstanceConfig{}
	for k, v := range c.Env {
		if v = strings.TrimSpace(v); v != "" {
			if out.Env == nil {
				out.Env = map[string]string{}
			}
			out.Env[k] = v
		}
	}
	for _, d := range c.DNS {
		if d = strings.TrimSpace(d); d != "" {
			out.DNS = append(out.DNS, d)
		}
	}
	return out
}

func isEditableEnvKey(key string) bool {
	for _, k := range EditableEnvKeys {
		if k == key {
			return true
		}
	}
	return false
}

// overrideEnvValue returns the override for key, if one is set and non-empty.
func overrideEnvValue(ov *InstanceConfig, key string) (string, bool) {
	if ov == nil || ov.Env == nil {
		return "", false
	}
	v, ok := ov.Env[key]
	if !ok || strings.TrimSpace(v) == "" {
		return "", false
	}
	return v, true
}
