package services

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// DatabaseProvisioner runs the low-level Docker steps needed to provision a
// database container. Like Deployer it never touches the DB directly — callers
// own persistence and status handling.
type DatabaseProvisioner struct{}

func NewDatabaseProvisioner() *DatabaseProvisioner { return &DatabaseProvisioner{} }

// ContainerName returns the docker container name for a database slug.
func ContainerName(slug string) string {
	return "nineteen-db-" + slug
}

// VolumeName returns the named volume used to persist a database's data.
func VolumeName(slug string) string {
	return "nineteen-db-" + slug
}

// Create runs the database container with the given parameters. Only
// PostgreSQL is supported in this pass. The container is published on the
// host loopback at hostPort and persists data in a named volume.
func (p *DatabaseProvisioner) Create(ctx context.Context, slug, version, databaseName, username, password string, hostPort int) error {
	name := ContainerName(slug)
	volume := VolumeName(slug)
	args := []string{
		"run", "-d",
		"--name", name,
		"--restart", "unless-stopped",
		"-e", "POSTGRES_DB=" + databaseName,
		"-e", "POSTGRES_USER=" + username,
		"-e", "POSTGRES_PASSWORD=" + password,
		"-p", fmt.Sprintf("127.0.0.1:%d:5432", hostPort),
		"-v", volume + ":/var/lib/postgresql/data",
		"postgres:" + version,
	}
	cmd := exec.CommandContext(ctx, "docker", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to start database container: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// Start starts an existing (stopped) database container.
func (p *DatabaseProvisioner) Start(slug string) error {
	return exec.Command("docker", "start", ContainerName(slug)).Run()
}

// Stop stops a running database container.
func (p *DatabaseProvisioner) Stop(slug string) error {
	return exec.Command("docker", "stop", ContainerName(slug)).Run()
}

// Restart restarts a running database container.
func (p *DatabaseProvisioner) Restart(slug string) error {
	return exec.Command("docker", "restart", ContainerName(slug)).Run()
}

// State returns the current Docker state (running / exited / …) of the
// database container, or "" if it does not exist.
func (p *DatabaseProvisioner) State(slug string) string {
	out, err := exec.Command("docker", "inspect", "--format", "{{.State.Status}}", ContainerName(slug)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Delete force-removes the database container and its data volume.
func (p *DatabaseProvisioner) Delete(slug string) error {
	_ = exec.Command("docker", "rm", "-f", ContainerName(slug)).Run()
	return exec.Command("docker", "volume", "rm", "-f", VolumeName(slug)).Run()
}

// ReconcileStatus returns the database's status corrected against the live
// container state, and whether that correction should be persisted.
func (p *DatabaseProvisioner) ReconcileStatus(slug, current string) (string, bool) {
	switch current {
	case "running":
		switch p.State(slug) {
		case "running":
			return "running", false
		case "":
			return "stopped", false
		default:
			return "stopped", true
		}
	case "stopped":
		if p.State(slug) == "running" {
			return "running", true
		}
		return "stopped", false
	default:
		return current, false
	}
}
