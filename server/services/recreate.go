package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ContainerConfig is the live configuration of a running project container
// that a no-rebuild recreate needs: which image to re-run, which env it
// currently has (to detect drift from the saved vars) and which container
// ports it publishes (to keep the port mappings stable).
type ContainerConfig struct {
	Image          string
	Env            map[string]string
	ContainerPorts []int
}

// InspectContainerConfig reads a container's image, environment and published
// container ports via `docker inspect`. It returns nil when the container does
// not exist or Docker cannot describe it.
func InspectContainerConfig(name string) *ContainerConfig {
	out, err := exec.Command("docker", "inspect", name).Output()
	if err != nil {
		return nil
	}
	var docs []struct {
		Config struct {
			Image        string            `json:"Image"`
			Env          []string          `json:"Env"`
			ExposedPorts map[string]struct{} `json:"ExposedPorts"`
		} `json:"Config"`
		NetworkSettings struct {
			Ports map[string][]struct {
				HostPort string `json:"HostPort"`
			} `json:"Ports"`
		} `json:"NetworkSettings"`
	}
	if err := json.Unmarshal(out, &docs); err != nil || len(docs) == 0 {
		return nil
	}
	cfg := &ContainerConfig{Image: docs[0].Config.Image, Env: map[string]string{}}
	for _, kv := range docs[0].Config.Env {
		if i := strings.Index(kv, "="); i > 0 {
			cfg.Env[kv[:i]] = kv[i+1:]
		} else if kv != "" {
			cfg.Env[kv] = ""
		}
	}
	seen := map[int]bool{}
	add := func(portToken string) {
		num := strings.SplitN(portToken, "/", 2)[0]
		if n, err := strconv.Atoi(num); err == nil && n > 0 && !seen[n] {
			seen[n] = true
			cfg.ContainerPorts = append(cfg.ContainerPorts, n)
		}
	}
	for port := range docs[0].NetworkSettings.Ports {
		add(port)
	}
	for port := range docs[0].Config.ExposedPorts {
		add(port)
	}
	sort.Ints(cfg.ContainerPorts)
	return cfg
}

// StateDirSuggestion names a container path that conventionally holds
// irreplaceable state (config, data, keys) for a known image, with the
// project-relative host folder to mount it on. Mirrors the CasaOS AppData
// convention: state lives on the host, so recreating the container is
// lossless in practice. Auto marks suggestions the server mounts on its own
// at deploy/recreate time; the rest are only surfaced as warnings (e.g.
// redis dumps, which are a cache by design).
type StateDirSuggestion struct {
	ContainerPath string `json:"container_path"`
	HostSubdir    string `json:"host_subdir"`
	Reason        string `json:"reason"`
	Auto          bool   `json:"auto"`
}

var imageStateDirs = []struct {
	match         string
	containerPath string
	hostSubdir    string
	reason        string
	auto          bool
}{
	{"codercom/code-server", "/home/coder", "appdata/code-server-home", "config, extensions, SSH keys, workspace state", true},
	{"coder/code-server", "/home/coder", "appdata/code-server-home", "config, extensions, SSH keys, workspace state", true},
	{"linuxserver/code-server", "/config", "appdata/code-server-config", "extensions, settings, SSH keys, open files", true},
	{"code-server", "/config", "appdata/code-server-config", "extensions, settings, SSH keys, open files", true},
	{"jellyfin", "/config", "appdata/jellyfin-config", "libraries, settings, users", true},
	{"gitea", "/data", "appdata/gitea-data", "repositories, users, settings", true},
	{"postgres", "/var/lib/postgresql/data", "appdata/postgres-data", "databases", true},
	{"mariadb", "/var/lib/mysql", "appdata/mariadb-data", "databases", true},
	{"mysql", "/var/lib/mysql", "appdata/mysql-data", "databases", true},
	{"mongo", "/data/db", "appdata/mongo-data", "databases", true},
	{"redis", "/data", "appdata/redis-data", "dataset dumps (cache by design)", false},
	{"grafana", "/var/lib/grafana", "appdata/grafana-data", "dashboards, users, settings", true},
	{"vaultwarden", "/data", "appdata/vaultwarden-data", "vaults, users, settings", true},
	{"navidrome", "/data", "appdata/navidrome-data", "library index, users, settings", true},
	{"immich", "/usr/src/app/upload", "appdata/immich-upload", "photo and video library", true},
	{"paperless", "/usr/src/paperless/data", "appdata/paperless-data", "documents and index", true},
	{"uptime-kuma", "/app/data", "appdata/uptime-kuma-data", "monitors and status history", true},
}

// SuggestStateDirs returns the curated state directories for an image
// reference (matched case-insensitively by substring), or nil when the image
// has no curated suggestions. Curated entries cover images that declare
// nothing themselves (e.g. codercom/code-server); images with declared
// VOLUMEs are handled by AllStateSuggestions below.
func SuggestStateDirs(image string) []StateDirSuggestion {
	lowered := strings.ToLower(strings.TrimSpace(image))
	if lowered == "" {
		return nil
	}
	for _, s := range imageStateDirs {
		if strings.Contains(lowered, s.match) {
			return []StateDirSuggestion{{
				ContainerPath: s.containerPath,
				HostSubdir:    s.hostSubdir,
				Reason:        s.reason,
				Auto:          s.auto,
			}}
		}
	}
	return nil
}

// imageVolumesCache memoizes declared image volumes: env-sync polls
// frequently and `docker inspect` would otherwise run on every poll.
var imageVolumesCache = struct {
	sync.Mutex
	entries map[string]cachedImageVolumes
}{entries: map[string]cachedImageVolumes{}}

type cachedImageVolumes struct {
	volumes []string
	expires time.Time
}

const imageVolumesCacheTTL = 5 * time.Minute

// ImageDeclaredVolumes returns the VOLUME paths an image declares in its
// config (e.g. postgres declares /var/lib/postgresql/data) — ground truth
// from the image author, no curation needed. Results are cached for a few
// minutes; uninspectable images (not pulled yet) yield nil.
func ImageDeclaredVolumes(image string) []string {
	image = strings.TrimSpace(image)
	if image == "" {
		return nil
	}
	now := time.Now()
	imageVolumesCache.Lock()
	if e, ok := imageVolumesCache.entries[image]; ok && now.Before(e.expires) {
		vols := e.volumes
		imageVolumesCache.Unlock()
		return vols
	}
	imageVolumesCache.Unlock()

	var vols []string
	if out, err := exec.Command("docker", "inspect", "--format", "{{json .Config.Volumes}}", image).Output(); err == nil {
		var declared map[string]struct{}
		if json.Unmarshal(out, &declared) == nil {
			for p := range declared {
				if strings.HasPrefix(p, "/") {
					vols = append(vols, p)
				}
			}
			sort.Strings(vols)
		}
	}

	imageVolumesCache.Lock()
	imageVolumesCache.entries[image] = cachedImageVolumes{volumes: vols, expires: now.Add(imageVolumesCacheTTL)}
	imageVolumesCache.Unlock()
	return vols
}

// declaredSuggestion turns an image-declared volume path into a suggestion
// with a generated AppData subdir.
func declaredSuggestion(containerPath string) StateDirSuggestion {
	sub := strings.ToLower(volumeNameRe.ReplaceAllString(strings.Trim(containerPath, "/"), "-"))
	sub = strings.Trim(sub, "-._")
	if sub == "" {
		sub = "data"
	}
	return StateDirSuggestion{
		ContainerPath: containerPath,
		HostSubdir:    "appdata/" + sub,
		Reason:        "declared by the image",
		Auto:          true,
	}
}

// AllStateSuggestions merges curated entries (first match per image wins)
// with image-declared VOLUMEs for every image, deduped by container path
// with curated entries taking precedence (better reasons and folder names).
func AllStateSuggestions(images []string) []StateDirSuggestion {
	merged := map[string]StateDirSuggestion{}
	for _, img := range images {
		for _, s := range SuggestStateDirs(img) {
			if _, ok := merged[s.ContainerPath]; !ok {
				merged[s.ContainerPath] = s
			}
		}
		for _, p := range ImageDeclaredVolumes(img) {
			if _, ok := merged[p]; !ok {
				merged[p] = declaredSuggestion(p)
			}
		}
	}
	out := make([]StateDirSuggestion, 0, len(merged))
	for _, s := range merged {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ContainerPath < out[j].ContainerPath })
	return out
}

// EnsureProjectAppDataDir creates (if needed) the project's AppData folder —
// the CasaOS-style home for state-dir mounts (`appdata/<app>-<purpose>`).
// Containers never mount this root itself, only subfolders added as volumes.
func EnsureProjectAppDataDir(projectID int64) (string, error) {
	dir := filepath.Join(ProjectDataDir(projectID), "appdata")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// ServiceContainer names one running container of a compose stack with the
// image it runs, so per-service state can be migrated before a recreate.
type ServiceContainer struct {
	Service   string
	Container string
	Image     string
}

// ComposeServiceContainers lists the running containers of a compose project
// (found via compose labels), with each container's service name and image.
func ComposeServiceContainers(projectName string) []ServiceContainer {
	out, err := exec.Command("docker", "ps", "--filter",
		"label=com.docker.compose.project="+projectName, "--format", "{{.Names}}").Output()
	if err != nil {
		return nil
	}
	var result []ServiceContainer
	for _, name := range strings.Fields(string(out)) {
		info := inspectContainer(name)
		if info == nil {
			continue
		}
		result = append(result, ServiceContainer{Service: info.Service, Container: name, Image: info.Image})
	}
	return result
}

// CopyFromContainer copies a path out of a (possibly running) container into
// an existing host directory: `docker cp <container>:<path>/. <hostDir>/`.
// A missing path inside the container is reported as an error so callers can
// tell "nothing to migrate" apart from a real failure.
func CopyFromContainer(container, containerPath, hostDir string) error {
	src := strings.TrimSuffix(containerPath, "/") + "/."
	cmd := exec.Command("docker", "cp", container+":"+filepath.ToSlash(src), hostDir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("docker cp failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}
