package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrNoReleases signals that the source repo has no public releases/tags (or
// is not publicly reachable), so there is nothing to update to yet.
var ErrNoReleases = errors.New("no releases found")

// UpdateState is the persisted, machine-readable status of a self-update run.
// It is written to a JSON file in the data directory (mounted on the host) so
// the state survives the container swap and can be served by the new instance.
type UpdateState struct {
	State           string `json:"state"` // idle, building, swapping, success, rolled_back, failed
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
	Repo            string `json:"repo"`
	PreviousImage   string `json:"previous_image,omitempty"`
	Message         string `json:"message"`
	StartedAt       string `json:"started_at,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
	IsOwner         bool   `json:"is_owner,omitempty"`
}

// UpdateService drives the self-update flow. All Docker work is performed by
// calling the host daemon through the mounted docker socket. It only ever
// touches the "nineteen" container/image — never other projects, volumes,
// networks or compose projects.
type UpdateService struct {
	Version       string
	Repo          string
	ContainerName string
	DataDir       string
	StateFile     string
	LogFile       string
	HealthTimeout int
	NewImage      string
	PreviousImage string
	HelperName    string

	mu   sync.Mutex
	busy bool
}

// NewUpdateService builds the service from the runtime environment.
func NewUpdateService(version string) *UpdateService {
	repo := os.Getenv("NINETEEN_REPO")
	dataDir := os.Getenv("NINETEEN_DATA_DIR")
	if dataDir == "" {
		if dbPath := os.Getenv("DB_PATH"); dbPath != "" {
			dataDir = filepath.Dir(dbPath)
		} else {
			dataDir = "./data"
		}
	}
	container := os.Getenv("NINETEEN_CONTAINER")
	if container == "" {
		container = "nineteen"
	}
	timeout := 60
	if v := os.Getenv("NINETEEN_UPDATE_HEALTH_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeout = n
		}
	}
	return &UpdateService{
		Version:       version,
		Repo:          repo,
		ContainerName: container,
		DataDir:       dataDir,
		StateFile:     filepath.Join(dataDir, ".nineteen-update-state.json"),
		LogFile:       filepath.Join(dataDir, ".nineteen-update.log"),
		HealthTimeout: timeout,
		NewImage:      "nineteen:new",
		PreviousImage: "nineteen:previous",
		HelperName:    "nineteen-update-helper",
	}
}

// Log appends a timestamped line to the persisted update log and prints it to
// stdout (which the helper / container also captures).
func (u *UpdateService) Log(msg string) {
	line := fmt.Sprintf("%s %s", time.Now().UTC().Format(time.RFC3339), msg)
	appendLineFile(u.LogFile, line)
	fmt.Println(line)
}

// GetState returns the current persisted update state, overriding the running
// version and repo so they always reflect the binary that is serving now.
func (u *UpdateService) GetState() UpdateState {
	var s UpdateState
	if b, err := os.ReadFile(u.StateFile); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	s.CurrentVersion = u.Version
	s.Repo = u.Repo
	if s.State == "" {
		s.State = "idle"
	}
	return s
}

// SetState persists a full state snapshot.
func (u *UpdateService) SetState(s UpdateState) {
	s.CurrentVersion = u.Version
	s.Repo = u.Repo
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if s.StartedAt == "" && (s.State == "building" || s.State == "swapping") {
		s.StartedAt = time.Now().UTC().Format(time.RFC3339)
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	_ = os.WriteFile(u.StateFile, b, 0o644)
}

func (u *UpdateService) fail(msg string) {
	u.Log("error: " + msg)
	st := u.GetState()
	st.State = "failed"
	st.Message = msg
	u.SetState(st)
}

// CheckForUpdate queries GitHub for the latest release/tag and reports whether
// a newer version is available. It never mutates the update state machine.
func (u *UpdateService) CheckForUpdate() (UpdateState, error) {
	st := u.GetState()
	if u.Repo == "" {
		st.UpdateAvailable = false
		st.Message = "NINETEEN_REPO is not configured — set it in the .env file"
		return st, fmt.Errorf("NINETEEN_REPO not configured")
	}
	latest, err := u.fetchLatestVersion(u.Repo)
	if err != nil {
		if errors.Is(err, ErrNoReleases) {
			st.LatestVersion = ""
			st.UpdateAvailable = false
			st.Message = "No public releases found for " + u.Repo + " — publish a GitHub release or tag on a public repo to enable self-updates"
			return st, nil
		}
		st.Message = "Could not reach GitHub: " + err.Error()
		return st, err
	}
	st.LatestVersion = latest
	st.UpdateAvailable = u.isUpdateAvailable(u.Version, latest)
	return st, nil
}

// StartUpdate begins a self-update to the given target version (empty = latest)
// in a background goroutine and returns immediately.
func (u *UpdateService) StartUpdate(targetVersion string) error {
	u.mu.Lock()
	if u.busy {
		u.mu.Unlock()
		return fmt.Errorf("an update is already in progress")
	}
	u.busy = true
	u.mu.Unlock()

	go u.runUpdate(targetVersion)
	return nil
}

// Rollback starts a manual rollback to the previously running image in a
// background goroutine. It uses a detached helper so the swap survives the
// current container being replaced.
func (u *UpdateService) Rollback() error {
	st := u.GetState()
	if st.PreviousImage == "" {
		return fmt.Errorf("no previous image is available to roll back to")
	}
	u.mu.Lock()
	if u.busy {
		u.mu.Unlock()
		return fmt.Errorf("an update is in progress — wait for it to finish")
	}
	u.busy = true
	u.mu.Unlock()

	go func() {
		defer func() {
			u.mu.Lock()
			u.busy = false
			u.mu.Unlock()
		}()
		u.rollbackTo(st.PreviousImage)
	}()
	return nil
}

// ReadLogs returns every persisted update log line.
func (u *UpdateService) ReadLogs() []string {
	b, err := os.ReadFile(u.LogFile)
	if err != nil {
		return []string{}
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimRight(string(b), "\n"), "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

// ---- update run ----

func (u *UpdateService) runUpdate(targetVersion string) {
	defer func() {
		u.mu.Lock()
		u.busy = false
		u.mu.Unlock()
	}()

	if targetVersion == "" {
		st, _ := u.CheckForUpdate()
		targetVersion = st.LatestVersion
	}
	if targetVersion == "" {
		u.fail("No target version specified and no latest version found")
		return
	}

	u.Log(fmt.Sprintf("Nineteen self-update started (target %s)", targetVersion))
	u.SetState(UpdateState{
		State:          "building",
		CurrentVersion: u.Version,
		Repo:           u.Repo,
		LatestVersion:  targetVersion,
		Message:        "Building new image…",
	})

	d := NewDeployer()
	if err := d.DockerAvailable(); err != nil {
		u.fail("Docker daemon unavailable: " + err.Error())
		return
	}

	insp, err := u.inspectContainer(u.ContainerName)
	if err != nil {
		u.fail("Could not inspect current container: " + err.Error())
		return
	}
	u.Log(fmt.Sprintf("Inspected container %s (image %s)", u.ContainerName, insp.Image))

	dir, err := u.cloneRepo(targetVersion)
	if err != nil {
		u.fail("Clone failed: " + err.Error())
		return
	}
	defer os.RemoveAll(dir)

	u.Log("Building image " + u.NewImage)
	if err := u.buildImage(dir, targetVersion); err != nil {
		u.fail("Build failed: " + err.Error())
		return
	}
	u.Log("Image built successfully")

	// Tag the running image so it is retained for manual rollback.
	if err := runCommand("docker", "tag", insp.Image, u.PreviousImage); err != nil {
		u.Log("warn: failed to tag previous image " + u.PreviousImage + ": " + err.Error())
	}

	runArgs, err := u.buildRunArgs(insp)
	if err != nil {
		u.fail("Failed to build container run arguments: " + err.Error())
		return
	}
	u.Log("Prepared container run arguments")

	st := u.GetState()
	st.State = "swapping"
	st.PreviousImage = insp.Image
	st.Message = "Replacing container…"
	u.SetState(st)
	u.Log("Launching update helper to swap the container")

	if err := u.launchHelper("update", runArgs, u.NewImage, insp.Image, targetVersion); err != nil {
		u.fail("Failed to launch update helper: " + err.Error())
		return
	}
	u.Log("Update helper launched — this instance will restart shortly")
}

func (u *UpdateService) rollbackTo(prevImage string) {
	u.Log("Manual rollback to " + prevImage)
	u.SetState(UpdateState{
		State:         "swapping",
		CurrentVersion: u.Version,
		Repo:          u.Repo,
		PreviousImage: prevImage,
		Message:       "Rolling back…",
	})

	insp, err := u.inspectContainer(u.ContainerName)
	if err != nil {
		u.fail("Could not inspect current container: " + err.Error())
		return
	}
	runArgs, err := u.buildRunArgs(insp)
	if err != nil {
		u.fail("Failed to build container run arguments: " + err.Error())
		return
	}
	u.Log("Launching update helper to roll back")
	if err := u.launchHelper("rollback", runArgs, prevImage, "", ""); err != nil {
		u.fail("Failed to launch rollback helper: " + err.Error())
		return
	}
	u.Log("Rollback helper launched")
}

// ---- container introspection ----

type inspectResult struct {
	Image string `json:"Image"`
	Config struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	HostConfig struct {
		Binds        []string `json:"Binds"`
		PortBindings map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"PortBindings"`
		RestartPolicy struct {
			Name string `json:"Name"`
		} `json:"RestartPolicy"`
		NetworkMode string `json:"NetworkMode"`
	} `json:"HostConfig"`
	Mounts []struct {
		Type   string `json:"Type"`
		Source string `json:"Source"`
		Target string `json:"Target"`
	} `json:"Mounts"`
}

func (u *UpdateService) inspectContainer(name string) (*inspectResult, error) {
	out, err := exec.Command("docker", "inspect", name).Output()
	if err != nil {
		return nil, err
	}
	var arr []inspectResult
	if err := json.Unmarshal(out, &arr); err != nil {
		return nil, err
	}
	if len(arr) == 0 {
		return nil, fmt.Errorf("no container named %q", name)
	}
	return &arr[0], nil
}

// buildRunArgs reconstructs the docker run flags (excluding --name and the
// image) from the running container so the replacement matches its current
// ports, mounts, env, restart policy, network and labels. No image is appended;
// the helper adds the target image.
func (u *UpdateService) buildRunArgs(insp *inspectResult) ([]string, error) {
	var args []string

	if rp := insp.HostConfig.RestartPolicy.Name; rp != "" && rp != "no" {
		args = append(args, "--restart", rp)
	}

	for cport, bindings := range insp.HostConfig.PortBindings {
		cnum := strings.SplitN(cport, "/", 2)[0]
		for _, b := range bindings {
			if b.HostPort == "" {
				continue
			}
			if b.HostIP == "" || b.HostIP == "0.0.0.0" || b.HostIP == "::" {
				args = append(args, "-p", fmt.Sprintf("%s:%s", b.HostPort, cnum))
			} else {
				args = append(args, "-p", fmt.Sprintf("%s:%s:%s", b.HostIP, b.HostPort, cnum))
			}
		}
	}

	binds := insp.HostConfig.Binds
	if len(binds) == 0 {
		for _, m := range insp.Mounts {
			if m.Type == "bind" {
				binds = append(binds, m.Source+":"+m.Target)
			}
		}
	}
	for _, b := range binds {
		args = append(args, "-v", b)
	}

	if nm := insp.HostConfig.NetworkMode; nm != "" && nm != "default" {
		args = append(args, "--network", nm)
	}

	for _, e := range insp.Config.Env {
		args = append(args, "-e", e)
	}

	for k, v := range insp.Config.Labels {
		args = append(args, "--label", k+"="+v)
	}

	return args, nil
}

func (u *UpdateService) findDataMount(insp *inspectResult) string {
	target := u.DataDir
	for _, m := range insp.Mounts {
		if m.Type == "bind" && m.Target == target && m.Source != "" {
			return m.Source
		}
	}
	for _, b := range insp.HostConfig.Binds {
		parts := strings.SplitN(b, ":", 2)
		if len(parts) == 2 && parts[1] == target {
			return parts[0]
		}
	}
	for _, b := range insp.HostConfig.Binds {
		parts := strings.SplitN(b, ":", 2)
		if len(parts) == 2 {
			return parts[0]
		}
	}
	return ""
}

// ---- GitHub version discovery ----

func (u *UpdateService) fetchLatestVersion(repo string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return u.fetchLatestTag(repo)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned status %d", resp.StatusCode)
	}
	var rel struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", err
	}
	return strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v"), nil
}

func (u *UpdateService) fetchLatestTag(repo string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(fmt.Sprintf("https://api.github.com/repos/%s/tags", repo))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", ErrNoReleases
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned status %d", resp.StatusCode)
	}
	var tags []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tags); err != nil {
		return "", err
	}
	best := ""
	for _, t := range tags {
		name := strings.TrimPrefix(strings.TrimSpace(t.Name), "v")
		if best == "" || compareSemver(name, best) > 0 {
			best = name
		}
	}
	if best == "" {
		return "", ErrNoReleases
	}
	return best, nil
}

func (u *UpdateService) isUpdateAvailable(current, latest string) bool {
	if latest == "" {
		return false
	}
	if current == "" || current == "dev" {
		return true
	}
	return compareSemver(latest, current) > 0
}

// compareSemver returns -1, 0 or 1 for a < b, a == b, a > b. Non-semver inputs
// are treated as 0.0.0.
func compareSemver(a, b string) int {
	av, _ := parseSemver(a)
	bv, _ := parseSemver(b)
	for len(av) < 3 {
		av = append(av, 0)
	}
	for len(bv) < 3 {
		bv = append(bv, 0)
	}
	for i := 0; i < 3; i++ {
		if av[i] < bv[i] {
			return -1
		}
		if av[i] > bv[i] {
			return 1
		}
	}
	return 0
}

func parseSemver(s string) ([]int, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	// Ignore any pre-release/build suffix.
	core := strings.SplitN(s, "-", 2)[0]
	core = strings.SplitN(core, "+", 2)[0]
	var nums []int
	for _, p := range strings.Split(core, ".") {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return nil, false
		}
		nums = append(nums, n)
	}
	return nums, true
}

// ---- clone / build ----

func (u *UpdateService) cloneRepo(tag string) (string, error) {
	candidates := []string{}
	if tag != "" {
		candidates = append(candidates, tag)
		if !strings.HasPrefix(tag, "v") {
			candidates = append(candidates, "v"+tag)
		}
	} else {
		candidates = append(candidates, "")
	}
	var lastErr error
	for _, ref := range candidates {
		dir, err := u.cloneRef(ref)
		if err == nil {
			return dir, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func (u *UpdateService) cloneRef(ref string) (string, error) {
	dir, err := os.MkdirTemp("", "nineteen-update-")
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("https://github.com/%s.git", u.Repo)
	args := []string{"clone", "--depth", "1"}
	if ref != "" {
		args = append(args, "--branch", ref)
	}
	args = append(args, url, dir)
	cmd := exec.Command("git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		os.RemoveAll(dir)
		return "", fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(string(out)))
	}
	return dir, nil
}

func (u *UpdateService) buildImage(dir, version string) error {
	args := []string{"build", "-t", u.NewImage}
	if version != "" {
		args = append(args, "--build-arg", "VERSION="+version)
	}
	args = append(args, ".")
	cmd := exec.Command("docker", args...)
	cmd.Dir = dir
	return streamCommand(cmd, u.Log)
}

// ---- detached helper ----

// launchHelper runs a detached helper container (from the just-built image,
// which already carries the docker CLI) that performs the actual swap. Because
// the helper is a separate container it survives the current one being removed.
func (u *UpdateService) launchHelper(mode string, runArgs []string, image, fallback, version string) error {
	runArgsJSON, _ := json.Marshal(runArgs)
	env := []string{
		"NINETEEN_HELPER_CONTAINER=" + u.ContainerName,
		"NINETEEN_HELPER_RUN_ARGS_JSON=" + string(runArgsJSON),
		"NINETEEN_HELPER_MODE=" + mode,
		"NINETEEN_HELPER_IMAGE=" + image,
		"NINETEEN_HELPER_FALLBACK_IMAGE=" + fallback,
		"NINETEEN_HELPER_HEALTH_TIMEOUT=" + strconv.Itoa(u.HealthTimeout),
		"NINETEEN_HELPER_DATA_DIR=/data",
	}

	args := []string{
		"run", "-d", "--name", u.HelperName, "--rm",
		"-v", "/var/run/docker.sock:/var/run/docker.sock",
	}
	if insp, err := u.inspectContainer(u.ContainerName); err == nil {
		if dataHost := u.findDataMount(insp); dataHost != "" {
			args = append(args, "-v", dataHost+":/data")
		}
	}
	for _, e := range env {
		args = append(args, "-e", e)
	}
	// The freshly built image already contains the docker CLI and the app
	// binary, so we reuse it as the helper and override its entrypoint.
	args = append(args, "--entrypoint", "/app/nineteen-server", u.NewImage, "update-helper")

	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(string(out)))
	}
	_ = version
	return nil
}

// RunUpdateHelper is the entrypoint used by the detached helper container. It
// performs the container swap and (optionally) a rollback, then writes the
// terminal state to the shared data directory.
func RunUpdateHelper() {
	container := envOr("NINETEEN_HELPER_CONTAINER", "nineteen")
	mode := envOr("NINETEEN_HELPER_MODE", "update")
	image := envOr("NINETEEN_HELPER_IMAGE", "nineteen:new")
	fallback := envOr("NINETEEN_HELPER_FALLBACK_IMAGE", "")
	timeout := envInt("NINETEEN_HELPER_HEALTH_TIMEOUT", 60)
	dataDir := envOr("NINETEEN_HELPER_DATA_DIR", "/data")
	stateFile := filepath.Join(dataDir, ".nineteen-update-state.json")
	logFile := filepath.Join(dataDir, ".nineteen-update.log")

	var runArgs []string
	if j := os.Getenv("NINETEEN_HELPER_RUN_ARGS_JSON"); j != "" {
		_ = json.Unmarshal([]byte(j), &runArgs)
	}

	log := func(msg string) {
		appendLineFile(logFile, msg)
		fmt.Println(msg)
	}

	log("Update helper started (mode=" + mode + ")")
	runCommandQuiet("docker", "rm", "-f", container)

	if err := runContainer(container, runArgs, image); err != nil {
		log("Failed to start " + image + ": " + err.Error())
		if fallback != "" {
			log("Attempting rollback to " + fallback)
			if err2 := runContainer(container, runArgs, fallback); err2 != nil {
				log("Rollback failed: " + err2.Error())
				writeHelperState(stateFile, "failed", "Update failed and rollback failed: "+err2.Error())
				return
			}
			writeHelperState(stateFile, "rolled_back", "New container failed to start — rolled back to previous version")
			return
		}
		writeHelperState(stateFile, "failed", "Failed to start container: "+err.Error())
		return
	}
	log("Started container " + container)

	if waitHealthy(container, timeout, log) {
		log("Container is healthy")
		if mode == "rollback" {
			writeHelperState(stateFile, "rolled_back", "Rollback complete — previous version is healthy")
		} else {
			writeHelperState(stateFile, "success", "Update complete — new version is healthy")
		}
		return
	}

	log("Container did not become healthy within timeout")
	if fallback != "" {
		log("Rolling back to " + fallback)
		runCommandQuiet("docker", "rm", "-f", container)
		if err := runContainer(container, runArgs, fallback); err != nil {
			log("Rollback failed: " + err.Error())
			writeHelperState(stateFile, "failed", "Update failed and rollback failed: "+err.Error())
			return
		}
		writeHelperState(stateFile, "rolled_back", "New version failed health check — rolled back to previous version")
		return
	}
	writeHelperState(stateFile, "failed", "Container did not become healthy within timeout")
}

func runContainer(container string, runArgs []string, image string) error {
	args := append([]string{"run", "-d", "--name", container}, runArgs...)
	args = append(args, image)
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(string(out)))
	}
	return nil
}

func waitHealthy(container string, timeout int, log func(string)) bool {
	for i := 0; i < timeout; i++ {
		status := containerHealth(container)
		if status == "healthy" {
			return true
		}
		if status == "" && i > 3 {
			log("Container " + container + " is missing during health wait")
			return false
		}
		time.Sleep(time.Second)
	}
	return false
}

func containerHealth(container string) string {
	out, err := exec.Command("docker", "inspect", "--format", "{{.State.Health.Status}}", container).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func writeHelperState(stateFile, state, message string) {
	var s UpdateState
	if b, err := os.ReadFile(stateFile); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	s.State = state
	s.Message = message
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	b, _ := json.MarshalIndent(s, "", "  ")
	_ = os.WriteFile(stateFile, b, 0o644)
}

// ---- small helpers ----

func appendLineFile(path, line string) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = io.WriteString(f, line+"\n")
}

func runCommand(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

func runCommandQuiet(name string, args ...string) {
	_ = exec.Command(name, args...).Run()
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
