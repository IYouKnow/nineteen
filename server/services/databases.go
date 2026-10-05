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

// dbEngine describes how to provision and administer one database engine.
type dbEngine struct {
	image   string
	port    int
	dataDir string
	// env returns the container environment for a fresh instance.
	env func(databaseName, username, password, rootPassword string) []string
}

// dbEngines maps a database type to its container spec. Only engines listed
// here can be provisioned; the HTTP layer validates against the same set.
var dbEngines = map[string]dbEngine{
	"postgresql": {
		image:   "postgres",
		port:    5432,
		dataDir: "/var/lib/postgresql/data",
		env: func(databaseName, username, password, _ string) []string {
			return []string{
				"POSTGRES_DB=" + databaseName,
				"POSTGRES_USER=" + username,
				"POSTGRES_PASSWORD=" + password,
			}
		},
	},
	"mysql": {
		image:   "mysql",
		port:    3306,
		dataDir: "/var/lib/mysql",
		env:     mysqlEnv,
	},
	"mariadb": {
		image:   "mariadb",
		port:    3306,
		dataDir: "/var/lib/mysql",
		env:     mysqlEnv,
	},
}

// mysqlEnv is the shared init environment for MySQL and MariaDB. The root
// password is separate from the application user's so the exposed credential
// can't escalate to the superuser.
func mysqlEnv(databaseName, username, password, rootPassword string) []string {
	return []string{
		"MYSQL_DATABASE=" + databaseName,
		"MYSQL_USER=" + username,
		"MYSQL_PASSWORD=" + password,
		"MYSQL_ROOT_PASSWORD=" + rootPassword,
	}
}

// IsEngineSupported reports whether a database type can be provisioned.
func IsEngineSupported(dbType string) bool {
	_, ok := dbEngines[dbType]
	return ok
}

// EnginePort returns the in-container port for a database type, or 0 if the
// type is unknown.
func EnginePort(dbType string) int {
	if e, ok := dbEngines[dbType]; ok {
		return e.port
	}
	return 0
}

// CreateOptions captures everything needed to provision one database container.
type CreateOptions struct {
	Type         string
	Slug         string
	Version      string
	DatabaseName string
	Username     string
	Password     string
	// RootPassword is only used by engines (MySQL/MariaDB) that require a
	// separate superuser credential at init time.
	RootPassword string
	HostPort     int
}

// Create runs the database container. It is published on the host loopback at
// HostPort and persists data in a named volume.
func (p *DatabaseProvisioner) Create(ctx context.Context, opts CreateOptions) error {
	engine, ok := dbEngines[opts.Type]
	if !ok {
		return fmt.Errorf("unsupported database type: %s", opts.Type)
	}
	args := []string{
		"run", "-d",
		"--name", ContainerName(opts.Slug),
		"--restart", "unless-stopped",
	}
	for _, kv := range engine.env(opts.DatabaseName, opts.Username, opts.Password, opts.RootPassword) {
		args = append(args, "-e", kv)
	}
	args = append(args,
		"-p", fmt.Sprintf("127.0.0.1:%d:%d", opts.HostPort, engine.port),
		"-v", VolumeName(opts.Slug)+":"+engine.dataDir,
		engine.image+":"+opts.Version,
	)
	cmd := exec.CommandContext(ctx, "docker", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to start database container: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// AlterPassword changes the password of the database's role on a running
// container. Secrets never reach the host process list: for Postgres the new
// password goes over stdin (socket auth is trust-based); for MySQL/MariaDB the
// superuser password is expanded from the container's own environment and the
// new password is fed over stdin.
func (p *DatabaseProvisioner) AlterPassword(dbType, slug, username, databaseName, newPassword string) error {
	switch dbType {
	case "mysql", "mariadb":
		sql := fmt.Sprintf("ALTER USER %s@'%%' IDENTIFIED BY %s; FLUSH PRIVILEGES;",
			quoteLiteral(username), quoteLiteral(newPassword))
		cmd := exec.Command("docker", "exec", "-i", ContainerName(slug),
			"sh", "-c", `mysql -uroot -p"$MYSQL_ROOT_PASSWORD"`)
		cmd.Stdin = strings.NewReader(sql)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s", strings.TrimSpace(string(out)))
		}
		return nil
	default:
		sql := fmt.Sprintf("ALTER USER %s WITH PASSWORD %s;",
			quoteIdent(username), quoteLiteral(newPassword))
		cmd := exec.Command("docker", "exec", "-i", ContainerName(slug),
			"psql", "-v", "ON_ERROR_STOP=1", "-U", username, "-d", databaseName, "-f", "-")
		cmd.Stdin = strings.NewReader(sql)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s", strings.TrimSpace(string(out)))
		}
		return nil
	}
}

// quoteIdent wraps a SQL identifier in double quotes, doubling any embedded
// double quotes.
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// quoteLiteral wraps a SQL string literal in single quotes, doubling any
// embedded single quotes.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
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
