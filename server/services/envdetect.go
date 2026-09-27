package services

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// RequiredEnvVar is one environment variable a repository expects at runtime.
// Default is a sample value found in the repo (e.g. from .env.example or a
// ${VAR:-default} interpolation); Required means the repo gives no usable
// default, so the user must supply a value. Source names where it was found
// (e.g. ".env.example", "Dockerfile", "compose.yaml").
type RequiredEnvVar struct {
	Key      string `json:"key"`
	Default  string `json:"default,omitempty"`
	Required bool   `json:"required"`
	Source   string `json:"source"`
}

// envExampleNames are repo-relative file names probed for declared variables.
// Only the first match is parsed, so a repo with several templates doesn't
// multiply API calls or produce duplicate noise.
var envExampleNames = []string{
	".env.example",
	".env.sample",
	".env.template",
	"example.env",
	".env.example.dist",
}

// maxRequiredEnv caps how many keys detection returns, so a pathological repo
// can't bloat scan responses or deploy logs.
const maxRequiredEnv = 50

// ParseDotEnvExample extracts KEY entries from .env.example-style content.
// A bare `KEY=` (or bare `KEY`) is required; `KEY=value` carries a default and
// is reported as optional. Full-line comments and `export ` prefixes are
// skipped/stripped. Source labels the result (usually the file name).
func ParseDotEnvExample(content []byte, source string) []RequiredEnvVar {
	if source == "" {
		source = ".env.example"
	}
	out := []RequiredEnvVar{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(strings.ToLower(line), "export ") {
			line = strings.TrimSpace(line[len("export "):])
		}
		var key, value string
		if i := strings.Index(line, "="); i >= 0 {
			key = strings.TrimSpace(line[:i])
			value = strings.TrimSpace(line[i+1:])
			// Trailing " # comment" is documentation, not part of the value.
			if j := strings.Index(value, " #"); j >= 0 {
				value = strings.TrimSpace(value[:j])
			}
			value = strings.Trim(value, `"'`)
		} else {
			// Bare KEY with no "=" — definitely required.
			key = strings.TrimSpace(strings.Fields(line)[0])
			value = ""
		}
		// Drop stray trailing comments glued to the key (e.g. "KEY # comment").
		if j := strings.Index(key, "#"); j >= 0 {
			key = strings.TrimSpace(key[:j])
		}
		if !ValidateEnvKey(key) || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, RequiredEnvVar{
			Key:      key,
			Default:  value,
			Required: value == "",
			Source:   source,
		})
	}
	return out
}

var dockerEnvRe = regexp.MustCompile(`(?i)^\s*ENV\s+(.+)$`)
var dockerArgRe = regexp.MustCompile(`(?i)^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.*))?$`)

// ParseDockerfileEnv extracts ENV/ARG declarations from Dockerfile content.
// `ENV KEY value` / `ARG KEY` (no default) are required; anything with a value
// is reported as optional with that default.
func ParseDockerfileEnv(content []byte) []RequiredEnvVar {
	out := []RequiredEnvVar{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if m := dockerArgRe.FindStringSubmatch(line); m != nil {
			key := m[1]
			def := strings.Trim(strings.TrimSpace(m[2]), `"'`)
			if !ValidateEnvKey(key) || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, RequiredEnvVar{Key: key, Default: def, Required: def == "", Source: "Dockerfile"})
			continue
		}
		m := dockerEnvRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		rest := strings.TrimSpace(m[1])
		if rest == "" {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 2 && !strings.Contains(fields[0], "=") && !strings.Contains(fields[1], "=") {
			// Old `ENV KEY value` form.
			key := fields[0]
			def := strings.Trim(fields[1], `"'`)
			if !ValidateEnvKey(key) || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, RequiredEnvVar{Key: key, Default: def, Required: false, Source: "Dockerfile"})
			continue
		}
		// Modern `ENV K=V ...` form (possibly several per line).
		for _, f := range fields {
			key, def := f, ""
			hasDefault := false
			if i := strings.Index(f, "="); i >= 0 {
				key = f[:i]
				def = strings.Trim(f[i+1:], `"'`)
				hasDefault = true
			}
			if !ValidateEnvKey(key) || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, RequiredEnvVar{Key: key, Default: def, Required: !hasDefault, Source: "Dockerfile"})
		}
	}
	return out
}

var composeInterpRe = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)`)
var composeBareKeyRe = regexp.MustCompile(`^-\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:#.*)?$`)
var composeEnvHeaderRe = regexp.MustCompile(`^environment\s*:\s*(?:#.*)?$`)
var composeMapKeyRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:#.*)?$`)

// ParseComposeEnv extracts variable references from compose file content:
// `${VAR}` / `$VAR` interpolations anywhere in the file are required unless
// they carry a `${VAR:-default}`-style default. Bare `- KEY` list entries and
// empty `KEY:` mapping entries are only honored inside `environment:` blocks,
// so unrelated lists (depends_on, ports, …) never produce false positives. A
// value baked into compose (`- KEY=value`, `KEY: value`) is not something the
// user must supply, so it is skipped.
func ParseComposeEnv(content []byte, source string) []RequiredEnvVar {
	if source == "" {
		source = "compose"
	}
	out := []RequiredEnvVar{}
	seen := map[string]int{}
	add := func(key, def string, required bool) {
		if !ValidateEnvKey(key) {
			return
		}
		if i, ok := seen[key]; ok {
			// A bare `- KEY` / `KEY:` entry means the value must come from the
			// host environment, so it promotes an interpolated default to required.
			if required && out[i].Default == "" {
				out[i].Required = true
			}
			if out[i].Default == "" && def != "" {
				out[i].Default = def
			}
			return
		}
		seen[key] = len(out)
		out = append(out, RequiredEnvVar{Key: key, Default: def, Required: required, Source: source})
	}
	for _, m := range composeInterpRe.FindAllStringSubmatch(string(content), -1) {
		var key, modifier string
		if m[1] != "" {
			key, modifier = m[1], m[2]
		} else {
			key = m[3]
		}
		def := ""
		required := true
		if modifier != "" {
			// Modifier is one of :-default, -default, :=default, :?msg, ?msg, :+alt, +alt.
			// Only the default-providing forms count as optional.
			mod := strings.TrimSpace(modifier)
			for _, prefix := range []string{":-", "-", ":=", "="} {
				if strings.HasPrefix(mod, prefix) {
					def = strings.Trim(strings.TrimPrefix(mod, prefix), `"'`)
					required = false
					break
				}
			}
		}
		add(key, def, required)
	}
	// Second pass: environment-block entries (indent-aware).
	inEnv, envIndent := false, -1
	for _, raw := range strings.Split(string(content), "\n") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(raw) - len(strings.TrimLeft(raw, " \t"))
		if inEnv && indent <= envIndent && !strings.HasPrefix(trimmed, "-") {
			inEnv, envIndent = false, -1
		}
		if !inEnv {
			if composeEnvHeaderRe.MatchString(trimmed) {
				inEnv, envIndent = true, indent
			}
			continue
		}
		if m := composeBareKeyRe.FindStringSubmatch(trimmed); m != nil {
			add(m[1], "", true)
			continue
		}
		if m := composeMapKeyRe.FindStringSubmatch(trimmed); m != nil {
			add(m[1], "", true)
		}
	}
	return out
}

// MergeRequiredEnv dedupes entries by key (first wins), promoting a key to
// required when any source reports it without a default. Results are sorted by
// key and capped so responses stay small.
func MergeRequiredEnv(lists ...[]RequiredEnvVar) []RequiredEnvVar {
	merged := map[string]*RequiredEnvVar{}
	order := []string{}
	for _, list := range lists {
		for _, e := range list {
			if !ValidateEnvKey(e.Key) {
				continue
			}
			if cur, ok := merged[e.Key]; ok {
				if e.Required && cur.Default == "" {
					cur.Required = true
				}
				if cur.Default == "" && e.Default != "" {
					cur.Default = e.Default
				}
				continue
			}
			cp := e
			merged[e.Key] = &cp
			order = append(order, e.Key)
		}
	}
	sort.Strings(order)
	out := make([]RequiredEnvVar, 0, len(order))
	for _, k := range order {
		out = append(out, *merged[k])
		if len(out) >= maxRequiredEnv {
			break
		}
	}
	if out == nil {
		out = []RequiredEnvVar{}
	}
	return out
}

// MissingRequiredEnv returns the subset of required whose keys have no
// non-empty value in have (saved project vars keyed by name).
func MissingRequiredEnv(required []RequiredEnvVar, have map[string]string) []RequiredEnvVar {
	missing := []RequiredEnvVar{}
	for _, r := range required {
		if strings.TrimSpace(have[r.Key]) == "" {
			missing = append(missing, r)
		}
	}
	if missing == nil {
		missing = []RequiredEnvVar{}
	}
	return missing
}

// DetectRequiredEnvFromContents merges detections from already-fetched file
// contents: an optional .env.example-style blob, an optional Dockerfile blob
// and any number of compose blobs.
func DetectRequiredEnvFromContents(envExample []byte, envSource string, dockerfile []byte, composeFiles ...[]byte) []RequiredEnvVar {
	lists := [][]RequiredEnvVar{}
	if len(envExample) > 0 {
		lists = append(lists, ParseDotEnvExample(envExample, envSource))
	}
	if len(dockerfile) > 0 {
		lists = append(lists, ParseDockerfileEnv(dockerfile))
	}
	for _, c := range composeFiles {
		if len(c) > 0 {
			lists = append(lists, ParseComposeEnv(c, "compose"))
		}
	}
	return MergeRequiredEnv(lists...)
}

// findEnvExample returns the first env-example file present in the repo file
// list, preferring the root-level .env.example.
func findEnvExample(files []string) string {
	lower := map[string]string{}
	for _, f := range files {
		lower[strings.ToLower(f)] = f
	}
	for _, name := range envExampleNames {
		if orig, ok := lower[strings.ToLower(name)]; ok {
			return orig
		}
	}
	// Nested fallbacks (e.g. app/.env.example) — shallowest first.
	best := ""
	for _, f := range files {
		base := strings.ToLower(filepath.ToSlash(f))
		for _, name := range envExampleNames {
			if strings.HasSuffix(base, "/"+name) {
				if best == "" || len(f) < len(best) {
					best = f
				}
			}
		}
	}
	return best
}

// DetectRequiredEnvFromDir reads a cloned checkout on disk: the env-example
// file (if any), the given Dockerfile and up to two compose files. Missing or
// unreadable files are skipped so detection never fails a deployment.
func DetectRequiredEnvFromDir(dir, dockerfilePath string, composeFiles []string) []RequiredEnvVar {
	read := func(rel string) []byte {
		rel = strings.TrimSpace(filepath.ToSlash(rel))
		if rel == "" {
			return nil
		}
		p := filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(rel, "/")))
		data, err := os.ReadFile(p)
		if err != nil || len(data) == 0 || len(data) > 1<<20 {
			return nil
		}
		return data
	}
	var envBlob []byte
	envSource := ".env.example"
	for _, name := range envExampleNames {
		if b := read(name); len(b) > 0 {
			envBlob, envSource = b, name
			break
		}
	}
	var dockerBlob []byte
	if dockerfilePath != "" {
		dockerBlob = read(dockerfilePath)
	}
	composeBlobs := [][]byte{}
	for i, c := range composeFiles {
		if i >= 2 {
			break
		}
		if b := read(c); len(b) > 0 {
			composeBlobs = append(composeBlobs, b)
		}
	}
	return DetectRequiredEnvFromContents(envBlob, envSource, dockerBlob, composeBlobs...)
}
