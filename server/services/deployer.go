package services

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Deployer runs the low-level steps needed to clone, build and run a project
// container. It never touches the DB directly — callers provide a log callback
// so build output can be persisted.
type Deployer struct{}

func NewDeployer() *Deployer { return &Deployer{} }

// DockerAvailable verifies the Docker daemon is reachable.
func (d *Deployer) DockerAvailable() error {
	out, err := exec.Command("docker", "info", "--format", "{{.ServerVersion}}").CombinedOutput()
	if err != nil {
		return fmt.Errorf("Docker daemon is not available: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// CloneRepo clones repository into a fresh temp dir using token auth.
// Returns the clone directory.
func (d *Deployer) CloneRepo(token, repository string, log func(string)) (string, error) {
	dir, err := os.MkdirTemp("", "nineteen-build-")
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("https://oauth2:%s@github.com/%s.git", token, repository)
	cmd := exec.Command("git", "clone", "--depth", "1", url, dir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if err := streamCommand(cmd, log); err != nil {
		return dir, err
	}
	return dir, nil
}

// GitHead returns the commit SHA the clone is at, or "" if it can't be read.
func (d *Deployer) GitHead(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

var scanSkipDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "dist": true,
	".next": true, ".cache": true, "build": true, "target": true,
	"__pycache__": true, ".venv": true, "venv": true, ".idea": true, ".vscode": true,
}

// RepoFiles walks a cloned repository and returns every file path
// (repo-relative, slash-separated), skipping heavy/irrelevant directories.
func (d *Deployer) RepoFiles(dir string) []string {
	var files []string
	filepath.WalkDir(dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if e.IsDir() {
			if p != dir && scanSkipDirs[e.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if e.Type().IsRegular() {
			if rel, err := filepath.Rel(dir, p); err == nil {
				files = append(files, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	return files
}

// FindDockerfiles returns Dockerfile candidates in a cloned repo, best first.
func (d *Deployer) FindDockerfiles(dir string) []string {
	return RankDockerfiles(d.RepoFiles(dir))
}

// FindComposeFiles returns Docker Compose candidates in a cloned repo, best first.
func (d *Deployer) FindComposeFiles(dir string) []string {
	return RankComposeFiles(d.RepoFiles(dir))
}

// RepoFileExists reports whether a repo-relative path exists inside dir,
// rejecting absolute paths and anything that escapes the repository.
func (d *Deployer) RepoFileExists(dir, rel string) bool {
	if rel == "" {
		return false
	}
	cleaned := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, cleaned))
	return err == nil
}

// ParseExpose reads the first EXPOSE port from the given Dockerfile
// (repo-relative path). Returns 0 when no EXPOSE is found.
func (d *Deployer) ParseExpose(dir, dockerfile string) int {
	if dockerfile == "" {
		dockerfile = "Dockerfile"
	}
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(dockerfile)))
	if err != nil {
		return 0
	}
	re := regexp.MustCompile(`(?i)^\s*EXPOSE\s+(\d+)`)
	for _, line := range strings.Split(string(data), "\n") {
		if m := re.FindStringSubmatch(line); m != nil {
			if p, err := strconv.Atoi(m[1]); err == nil && p > 0 {
				return p
			}
		}
	}
	return 0
}

// ImagePort returns the lowest port the built image EXPOSEs (inherited from a
// base image counts too), or 0 if none.
func (d *Deployer) ImagePort(image string) int {
	out, err := exec.Command("docker", "inspect", "--format", "{{json .Config.ExposedPorts}}", image).Output()
	if err != nil {
		return 0
	}
	var ports map[string]struct{}
	if json.Unmarshal(out, &ports) != nil {
		return 0
	}
	best := 0
	for k := range ports {
		p := strings.SplitN(k, "/", 2)[0]
		if n, err := strconv.Atoi(p); err == nil && (best == 0 || n < best) {
			best = n
		}
	}
	return best
}

// Build runs `docker build` for the image using the given Dockerfile
// (repo-relative) with the repository root as build context.
func (d *Deployer) Build(image, dir, dockerfile string, log func(string)) error {
	args := []string{"build", "-t", image}
	if dockerfile != "" && dockerfile != "Dockerfile" {
		args = append(args, "-f", dockerfile)
	}
	args = append(args, ".")
	cmd := exec.Command("docker", args...)
	cmd.Dir = dir
	return streamCommand(cmd, log)
}

// CleanupContainer force-removes a container by name (best-effort).
func (d *Deployer) CleanupContainer(name string) {
	_ = exec.Command("docker", "rm", "-f", name).Run()
}

// ContainerState returns the current Docker state (running / exited / …) of a
// container, or "" if it does not exist.
func (d *Deployer) ContainerState(name string) string {
	out, err := exec.Command("docker", "inspect", "--format", "{{.State.Status}}", name).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// StartContainer starts an existing (stopped) container.
func (d *Deployer) StartContainer(name string) error {
	return exec.Command("docker", "start", name).Run()
}

// StopContainer stops a running container.
func (d *Deployer) StopContainer(name string) error {
	return exec.Command("docker", "stop", name).Run()
}

// RestartContainer restarts a running container.
func (d *Deployer) RestartContainer(name string) error {
	return exec.Command("docker", "restart", name).Run()
}

// Run starts a published container and returns its id.
func (d *Deployer) Run(image, name string, hostPort, containerPort int, log func(string)) (string, error) {
	cmd := exec.Command("docker", "run", "-d",
		"--name", name,
		"--restart", "unless-stopped",
		"-p", fmt.Sprintf("127.0.0.1:%d:%d", hostPort, containerPort),
		image,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log(string(out))
		return "", fmt.Errorf("failed to start container: %s", strings.TrimSpace(string(out)))
	}
	containerID := strings.TrimSpace(string(out))
	log("container started: " + containerID[:min(12, len(containerID))])
	return containerID, nil
}

// ComposeUp builds and starts the stack defined by composeFile
// (repo-relative) under the given compose project name.
func (d *Deployer) ComposeUp(dir, composeFile, projectName string, log func(string)) error {
	cmd := exec.Command("docker", "compose", "-f", composeFile, "-p", projectName, "up", "-d", "--build")
	cmd.Dir = dir
	return streamCommand(cmd, log)
}

// ComposePort describes one published port of a compose stack.
type ComposePort struct {
	Service string `json:"service"`
	Image   string `json:"image"`
	Port    int    `json:"port"`
}

// dbImageHints are images that are almost certainly backing services rather
// than the app a user wants to reach.
var dbImageHints = []string{
	"postgres", "mysql", "mariadb", "mongo", "redis", "memcached",
	"rabbitmq", "adminer", "pgadmin", "clickhouse", "couchdb", "influxdb",
}

// ComposePorts returns the published host ports of every container in a
// compose project (found via compose labels, so stacks from previous
// deployments with different files are still discovered).
func (d *Deployer) ComposePorts(projectName string) []ComposePort {
	out, err := exec.Command("docker", "ps", "--filter",
		"label=com.docker.compose.project="+projectName, "--format", "{{.ID}}").Output()
	if err != nil {
		return nil
	}

	ports := []ComposePort{}
	for _, id := range strings.Fields(string(out)) {
		info := inspectContainer(id)
		if info == nil {
			continue
		}
		for _, p := range info.Ports {
			if p > 0 {
				ports = append(ports, ComposePort{Service: info.Service, Image: info.Image, Port: p})
			}
		}
	}
	sort.Slice(ports, func(i, j int) bool { return ports[i].Port < ports[j].Port })
	return ports
}

// PickAppPort prefers the port of a container that isn't a known database or
// admin image; falls back to the lowest port.
func PickAppPort(ports []ComposePort) (ComposePort, bool) {
	if len(ports) == 0 {
		return ComposePort{}, false
	}
	for _, p := range ports {
		img := strings.ToLower(p.Image)
		isDB := false
		for _, hint := range dbImageHints {
			if strings.Contains(img, hint) {
				isDB = true
				break
			}
		}
		if !isDB {
			return p, true
		}
	}
	return ports[0], true
}

// CleanupCompose force-removes every container belonging to a compose project
// (best-effort). Volumes are preserved so data survives redeploys.
func (d *Deployer) CleanupCompose(projectName string, log func(string)) {
	out, err := exec.Command("docker", "ps", "-a", "--filter",
		"label=com.docker.compose.project="+projectName, "--format", "{{.ID}}").Output()
	if err != nil {
		return
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return
	}
	log(fmt.Sprintf("Removing %d container(s) from the previous deployment", len(ids)))
	args := append([]string{"rm", "-f"}, ids...)
	if err := streamCommand(exec.Command("docker", args...), log); err != nil {
		log("warn: failed to remove previous containers: " + err.Error())
	}
}

type containerInfo struct {
	Image   string
	Service string
	Ports   []int
}

func inspectContainer(id string) *containerInfo {
	out, err := exec.Command("docker", "inspect",
		"--format", "{{json .Config.Image}} {{json .Config.Labels}} {{json .NetworkSettings.Ports}}", id).Output()
	if err != nil {
		return nil
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return nil
	}

	// The combined format renders three space-separated JSON tokens, but the
	// ports object may itself contain spaces — split conservatively.
	image, rest := splitJSONToken(line)
	labels, portsJSON := splitJSONToken(rest)

	info := &containerInfo{Image: image}
	if labels != "" {
		var l map[string]string
		if json.Unmarshal([]byte(labels), &l) == nil {
			info.Service = l["com.docker.compose.service"]
		}
	}
	if portsJSON != "" {
		var bindings map[string][]struct {
			HostPort string `json:"HostPort"`
		}
		if json.Unmarshal([]byte(portsJSON), &bindings) == nil {
			for _, list := range bindings {
				for _, b := range list {
					if n, err := strconv.Atoi(b.HostPort); err == nil && n > 0 {
						info.Ports = append(info.Ports, n)
					}
				}
			}
		}
	}
	sort.Ints(info.Ports)
	return info
}

// splitJSONToken splits "token rest" where token is a JSON value without
// spaces (string, number, …) — ports objects keep the remainder.
func splitJSONToken(s string) (string, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", ""
	}
	if s[0] == '"' {
		if i := strings.IndexByte(s[1:], '"'); i >= 0 {
			return s[1 : 1+i], strings.TrimSpace(s[2+i:])
		}
	}
	if i := strings.IndexByte(s, ' '); i >= 0 {
		return s[:i], strings.TrimSpace(s[i+1:])
	}
	return s, ""
}

// FreePort reserves a free TCP port on localhost.
func (d *Deployer) FreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func streamCommand(cmd *exec.Cmd, log func(string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	consume := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		for sc.Scan() {
			log(sc.Text())
		}
	}
	wg.Add(2)
	go consume(stdout)
	go consume(stderr)
	wg.Wait()
	return cmd.Wait()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
