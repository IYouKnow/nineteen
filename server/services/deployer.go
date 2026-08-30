package services

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

// ParseExpose reads the first EXPOSE port from the repo's Dockerfile.
func (d *Deployer) ParseExpose(dir string) int {
	data, err := os.ReadFile(filepath.Join(dir, "Dockerfile"))
	if err != nil {
		return 3000
	}
	re := regexp.MustCompile(`(?i)^\s*EXPOSE\s+(\d+)`)
	for _, line := range strings.Split(string(data), "\n") {
		if m := re.FindStringSubmatch(line); m != nil {
			if p, err := strconv.Atoi(m[1]); err == nil && p > 0 {
				return p
			}
		}
	}
	return 3000
}

// Build runs `docker build` for the image, streaming output to log.
func (d *Deployer) Build(image, dir string, log func(string)) error {
	cmd := exec.Command("docker", "build", "-t", image, dir)
	return streamCommand(cmd, log)
}

// CleanupContainer force-removes a container by name (best-effort).
func (d *Deployer) CleanupContainer(name string) {
	_ = exec.Command("docker", "rm", "-f", name).Run()
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
