package services

import (
	"path"
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
