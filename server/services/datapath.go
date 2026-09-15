package services

import (
	"encoding/json"
	"os/exec"
	"path"
	"sort"
	"strings"
)

// dataEnvKeys are environment variable names that conventionally hold an
// application's persistent data location — either a directory or a file inside
// one. They are used to work out where an app writes its data so the project's
// volume can be mounted at the right path.
var dataEnvKeys = map[string]bool{
	"DB_PATH":       true,
	"DATABASE_PATH": true,
	"DATABASE_FILE": true,
	"DATABASE_URL":  true,
	"SQLITE_PATH":   true,
	"SQLITE_DB":     true,
	"SQLITE_FILE":   true,
	"DATA_DIR":      true,
	"DATA_PATH":     true,
	"DATA_FOLDER":   true,
	"STORAGE_DIR":   true,
	"STORAGE_PATH":  true,
	"UPLOAD_DIR":    true,
	"UPLOAD_PATH":   true,
	"UPLOADS_DIR":   true,
	"UPLOAD_FOLDER": true,
	"MEDIA_DIR":     true,
	"MEDIA_PATH":    true,
	"FILES_DIR":     true,
	"CONTENT_DIR":   true,
}

// dataFileExts are extensions that mark a path as a data *file* (whose parent
// directory is what should be persisted) rather than a directory.
var dataFileExts = map[string]bool{
	".db": true, ".sqlite": true, ".sqlite3": true, ".db3": true,
	".json": true, ".log": true, ".txt": true, ".csv": true, ".xml": true,
	".yaml": true, ".yml": true, ".toml": true, ".dat": true, ".data": true,
	".mdb": true, ".realm": true,
}

// systemRoots are top-level directories that must never be bind-mounted over:
// replacing them would break the container. Deeper paths under them (e.g.
// /var/lib/app) are allowed.
var systemRoots = map[string]bool{
	"bin": true, "sbin": true, "lib": true, "lib64": true, "usr": true,
	"etc": true, "boot": true, "proc": true, "sys": true, "dev": true,
	"run": true, "tmp": true, "var": true, "srv": true, "opt": true,
	"root": true, "mnt": true, "media": true, "home": true,
}

// DetectDataMount inspects a built image and returns the container directory the
// application is most likely to persist data in, or "" when it can't be worked
// out. Declared VOLUMEs are considered first, then common data-location
// environment variables (DB_PATH, DATA_DIR, …).
func DetectDataMount(image string) string {
	if image == "" {
		return ""
	}
	out, err := exec.Command("docker", "inspect", "--format", "{{json .Config}}", image).Output()
	if err != nil {
		return ""
	}
	var cfg struct {
		Env        []string            `json:"Env"`
		Volumes    map[string]struct{} `json:"Volumes"`
		WorkingDir string              `json:"WorkingDir"`
	}
	if json.Unmarshal(out, &cfg) != nil {
		return ""
	}

	// Explicit VOLUME declarations are the strongest signal.
	volumes := make([]string, 0, len(cfg.Volumes))
	for v := range cfg.Volumes {
		volumes = append(volumes, v)
	}
	sort.Strings(volumes)
	for _, v := range volumes {
		if dir := normalizeDataDir(v, cfg.WorkingDir); dir != "" && isSafeDataMount(dir, cfg.WorkingDir) {
			return dir
		}
	}

	// Environment hints, in a stable order so detection is deterministic.
	type kv struct{ key, val string }
	env := make([]kv, 0, len(cfg.Env))
	for _, pair := range cfg.Env {
		k, val, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		env = append(env, kv{strings.ToUpper(strings.TrimSpace(k)), val})
	}
	sort.SliceStable(env, func(i, j int) bool { return env[i].key < env[j].key })
	for _, e := range env {
		if !dataEnvKeys[e.key] {
			continue
		}
		if dir := normalizeDataDir(e.val, cfg.WorkingDir); dir != "" && isSafeDataMount(dir, cfg.WorkingDir) {
			return dir
		}
	}
	return ""
}

// normalizeDataDir turns a data-location value (an absolute path, a relative
// path, or a file/sqlite URL) into an absolute, cleaned container directory.
// It returns "" when the value isn't a usable local path.
func normalizeDataDir(value, workdir string) string {
	v := strings.TrimSpace(value)
	v = strings.Trim(v, `"'`)
	if v == "" {
		return ""
	}

	// Strip a URL scheme. sqlite/file URLs point at local paths; any other
	// scheme (postgres://, mysql://, …) is a network DSN, not a mount.
	if i := strings.Index(v, "://"); i >= 0 {
		switch strings.ToLower(v[:i]) {
		case "sqlite", "sqlite3", "file":
			v = v[i+3:]
		default:
			return ""
		}
	} else if i := strings.Index(v, ":"); i > 0 && !strings.HasPrefix(v, "/") {
		if scheme := strings.ToLower(v[:i]); scheme == "file" || scheme == "sqlite" || scheme == "sqlite3" {
			v = v[i+1:]
		}
	}
	if i := strings.IndexByte(v, '?'); i >= 0 {
		v = v[:i]
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}

	// Resolve relative paths against the container working directory.
	if !strings.HasPrefix(v, "/") {
		base := strings.TrimRight(workdir, "/")
		if base == "" {
			base = "/app"
		}
		v = path.Join(base, v)
	}
	v = path.Clean(v)
	if !strings.HasPrefix(v, "/") {
		return ""
	}

	// A path ending in a known data-file extension points at a file: persist
	// the directory that holds it.
	if dataFileExts[strings.ToLower(path.Ext(v))] {
		v = path.Dir(v)
	}
	return path.Clean(v)
}

// isSafeDataMount reports whether dir is a sensible directory to bind-mount a
// project's persistent folder over. It rejects the root, top-level system
// directories, and anything that would shadow the app's working directory.
func isSafeDataMount(dir, workdir string) bool {
	if dir == "" || dir == "/" || !strings.HasPrefix(dir, "/") {
		return false
	}
	trimmed := strings.Trim(dir, "/")
	if trimmed == "" || !strings.Contains(trimmed, "/") {
		if systemRoots[trimmed] {
			return false
		}
	}
	wd := strings.TrimRight(workdir, "/")
	if wd == "" {
		wd = "/app"
	}
	// Never mount over the working directory itself or an ancestor of it — that
	// would hide the built application code.
	if dir == wd || strings.HasPrefix(wd+"/", dir+"/") {
		return false
	}
	return true
}
