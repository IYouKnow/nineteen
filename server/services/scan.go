package services

import (
	"encoding/json"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// exposeRe matches a Dockerfile EXPOSE directive, e.g. "EXPOSE 8080" or
// "EXPOSE 3000 3001". Only the first (lowest) port is returned.
var exposeRe = regexp.MustCompile(`(?i)^\s*EXPOSE\s+(\d+)`)

// ParseExposeContent returns the first port declared by an EXPOSE directive in
// Dockerfile content. Returns 0 when no EXPOSE is found.
func ParseExposeContent(content []byte) int {
	for _, line := range strings.Split(string(content), "\n") {
		if m := exposeRe.FindStringSubmatch(line); m != nil {
			if p, err := strconv.Atoi(m[1]); err == nil && p > 0 {
				return p
			}
		}
	}
	return 0
}

// Build-file detection shared by the repo scan endpoint and the deploy worker.
// Paths are repository-relative, slash-separated.

// IsDockerfileName reports whether a base file name is a Dockerfile variant
// ("Dockerfile", "Dockerfile.prod", "app.Dockerfile", …).
func IsDockerfileName(base string) bool {
	if strings.EqualFold(base, "Dockerfile") {
		return true
	}
	return strings.HasPrefix(strings.ToLower(base), "dockerfile.") || strings.HasSuffix(strings.ToLower(base), ".dockerfile")
}

// IsComposeName reports whether a base file name is a Docker Compose file.
func IsComposeName(base string) bool {
	switch strings.ToLower(base) {
	case "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml":
		return true
	}
	return strings.HasSuffix(strings.ToLower(base), ".compose.yml") || strings.HasSuffix(strings.ToLower(base), ".compose.yaml")
}

func isDevVariant(base string) bool {
	b := strings.ToLower(base)
	return strings.Contains(b, "dev") || strings.Contains(b, "test") || strings.Contains(b, "debug") || strings.Contains(b, "ci")
}

func dockerfileRank(rel string) (int, string) {
	base := path.Base(rel)
	depth := strings.Count(rel, "/")
	score := depth * 10
	if !strings.EqualFold(base, "Dockerfile") {
		score += 50 // exact-name Dockerfiles beat variants at any depth
	}
	if isDevVariant(base) {
		score += 100
	}
	return score, rel
}

func composeRank(rel string) (int, string) {
	base := path.Base(rel)
	depth := strings.Count(rel, "/")
	score := depth * 10
	if strings.HasSuffix(strings.ToLower(base), ".compose.yml") || strings.HasSuffix(strings.ToLower(base), ".compose.yaml") {
		score += 5 // suffixed variants after standard names
	}
	if isDevVariant(base) {
		score += 100
	}
	return score, rel
}

func collectMatches(paths []string, match func(string) bool, rank func(string) (int, string)) []string {
	found := make([]string, 0, 4)
	for _, p := range paths {
		if match(path.Base(p)) {
			found = append(found, p)
		}
	}
	sort.Slice(found, func(i, j int) bool {
		si, _ := rank(found[i])
		sj, _ := rank(found[j])
		if si != sj {
			return si < sj
		}
		return found[i] < found[j]
	})
	return found
}

// RankDockerfiles filters a list of repo-relative paths down to Dockerfile
// candidates, best first (root Dockerfile, then shallowest exact names, then
// variants; dev/test variants are deprioritized).
func RankDockerfiles(paths []string) []string {
	return collectMatches(paths, IsDockerfileName, dockerfileRank)
}

// RankComposeFiles filters a list of repo-relative paths down to Docker
// Compose candidates, best first (root compose files, then shallowest).
func RankComposeFiles(paths []string) []string {
	return collectMatches(paths, IsComposeName, composeRank)
}

// copyRe matches a COPY or ADD instruction (case-insensitive).
var copyRe = regexp.MustCompile(`(?i)^\s*(?:COPY|ADD)\s+(.*)$`)

// ParseCopySources extracts the source paths of every COPY/ADD instruction in
// Dockerfile content. Flags (--from=, --chown=, …), absolute paths (stage
// copies), URLs and the trailing destination are excluded. Both the shell form
// (`COPY a b dest/`) and the JSON form (`COPY ["a", "b", "dest/"]`) are handled.
func ParseCopySources(content []byte) []string {
	var out []string
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := copyRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		args := strings.TrimSpace(m[1])
		var parts []string
		if strings.HasPrefix(args, "[") {
			var arr []string
			if json.Unmarshal([]byte(args), &arr) == nil {
				parts = arr
			}
		} else {
			parts = strings.Fields(args)
		}
		// Drop leading flags; the last remaining token is the destination.
		var fields []string
		for _, p := range parts {
			if strings.HasPrefix(p, "--") {
				continue
			}
			fields = append(fields, p)
		}
		if len(fields) < 2 {
			continue
		}
		for _, p := range fields[:len(fields)-1] {
			// Absolute paths (stage copies) and URLs carry no context signal.
			if strings.HasPrefix(p, "/") || strings.Contains(p, "://") {
				continue
			}
			out = append(out, p)
		}
	}
	return out
}

// cleanCopySource normalizes a COPY/ADD source into a repo-relative path that
// can be probed against the file tree. It returns "" for sources that carry no
// useful signal (the whole context, stage copies, URLs, parents). A glob is
// reduced to the directory before its first wildcard.
func cleanCopySource(src string) string {
	s := strings.TrimSpace(filepath.ToSlash(src))
	for strings.HasPrefix(s, "./") {
		s = s[2:]
	}
	s = strings.TrimSuffix(s, "/")
	if s == "" || s == "." || s == ".." || strings.HasPrefix(s, "/") || strings.Contains(s, "://") {
		return ""
	}
	if i := strings.IndexAny(s, "*?["); i >= 0 {
		s = strings.TrimSuffix(s[:i], "/")
	}
	if s == "" || s == "." {
		return ""
	}
	return s
}

// treeHasPath reports whether p (a repo-relative file or directory) is present
// in the file list, treating p as a directory prefix too.
func treeHasPath(files []string, p string) bool {
	p = strings.TrimPrefix(path.Clean("/"+p), "/")
	if p == "" || p == "." {
		return len(files) > 0
	}
	prefix := p + "/"
	for _, f := range files {
		if f == p || strings.HasPrefix(f, prefix) {
			return true
		}
	}
	return false
}

// SuggestBuildContext picks a build-context directory for a Dockerfile by
// inspecting the paths it COPYs/ADDs. When those paths resolve next to the
// Dockerfile it suggests the Dockerfile's directory (the monorepo case); when
// they only resolve at the repository root it suggests the root; when nothing
// conclusive is found it defaults to the Dockerfile's directory.
func SuggestBuildContext(dockerfile string, content []byte, files []string) string {
	dockerfileDir := path.Dir(filepath.ToSlash(dockerfile))
	if dockerfileDir == "" {
		dockerfileDir = "."
	}

	nextTo, atRoot := false, false
	for _, src := range ParseCopySources(content) {
		clean := cleanCopySource(src)
		if clean == "" {
			continue
		}
		if treeHasPath(files, path.Join(dockerfileDir, clean)) {
			nextTo = true
		}
		if treeHasPath(files, clean) {
			atRoot = true
		}
	}

	if atRoot && !nextTo {
		return "."
	}
	return dockerfileDir
}
