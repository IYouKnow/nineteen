package services

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
)

var envKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValidateEnvKey reports whether key is a valid env var name.
func ValidateEnvKey(key string) bool {
	return envKeyRe.MatchString(key)
}

// LoadEnvVars returns the project's env vars with plaintext values (decrypted),
// ordered by key.
func LoadEnvVars(projectID int64) ([]models.EnvVar, error) {
	rows, err := db.DB.Query(
		"SELECT id, project_id, key, value_encrypted, is_secret, created_at, updated_at FROM env_vars WHERE project_id = ? ORDER BY key ASC",
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	vars := []models.EnvVar{}
	for rows.Next() {
		var v models.EnvVar
		var isSecret int
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Encrypted, &isSecret, &v.CreatedAt, &v.UpdatedAt); err != nil {
			continue
		}
		v.IsSecret = isSecret != 0
		if plain, e := auth.DecryptToken(v.Encrypted); e == nil {
			v.Value = plain
			v.HasValue = true
		}
		vars = append(vars, v)
	}
	return vars, rows.Err()
}

// WriteEnvFile writes KEY=VALUE lines to a temp file and returns its path.
// Returns "" when there are no vars. Values are sanitized to a single line.
func WriteEnvFile(vars []models.EnvVar) (string, error) {
	if len(vars) == 0 {
		return "", nil
	}
	f, err := os.CreateTemp("", "nineteen-env-*.env")
	if err != nil {
		return "", err
	}
	clean := func(s string) string {
		s = strings.ReplaceAll(s, "\r", "")
		return strings.ReplaceAll(s, "\n", "")
	}
	for _, v := range vars {
		if _, err := fmt.Fprintf(f, "%s=%s\n", v.Key, clean(v.Value)); err != nil {
			f.Close()
			return "", err
		}
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return f.Name(), nil
}

// WriteComposeEnvOverride generates a compose override that injects the given
// absolute .env file into every service. Returns "" when there are no services.
func WriteComposeEnvOverride(serviceNames []string, envFile string) (string, error) {
	if len(serviceNames) == 0 {
		return "", nil
	}
	f, err := os.CreateTemp("", "nineteen-env-override-*.yml")
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("services:\n")
	for _, s := range serviceNames {
		b.WriteString("  " + s + ":\n")
		b.WriteString("    env_file:\n      - " + envFile + "\n")
	}
	if _, err := f.WriteString(b.String()); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return f.Name(), nil
}

// ComposeServiceNames lists the service names in a compose file.
func ComposeServiceNames(composeFile string) []string {
	out, err := exec.Command("docker", "compose", "-f", composeFile, "config", "--services").Output()
	if err != nil {
		return nil
	}
	names := []string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if n := strings.TrimSpace(line); n != "" {
			names = append(names, n)
		}
	}
	return names
}
