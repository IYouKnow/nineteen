package services

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var volumeNameRe = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`)

// sanitizeVolumeHint lowercases a volume-name hint to Docker's allowed
// charset ([a-zA-Z0-9][a-zA-Z0-9_.-]), falling back to "data".
func sanitizeVolumeHint(hint string) string {
	hint = strings.ToLower(volumeNameRe.ReplaceAllString(strings.TrimSpace(hint), "-"))
	hint = strings.Trim(hint, "-._")
	if hint == "" {
		return "data"
	}
	return hint
}

// UniqueVolumeName returns a Docker-safe volume name for a project
// (nineteen-<id>-<hint>), suffixed when it already exists.
func UniqueVolumeName(projectID int64, hint string) string {
	base := fmt.Sprintf("nineteen-%d-%s", projectID, sanitizeVolumeHint(hint))
	name := base
	for i := 2; ; i++ {
		if exec.Command("docker", "volume", "inspect", name).Run() != nil {
			return name
		}
		name = fmt.Sprintf("%s-%d", base, i)
	}
}

// EnsureNamedVolume creates a Docker named volume (idempotent — an existing
// volume is returned as-is).
func EnsureNamedVolume(name string) error {
	if out, err := exec.Command("docker", "volume", "create", name).CombinedOutput(); err != nil {
		return fmt.Errorf("docker volume create failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// PopulateNamedVolume fills a named volume with the content of a host
// directory, using holderImage only as a mount carrier (docker create + cp +
// rm — no shell or tools needed inside the image, so it works for distroless
// images too). The volume's root receives the directory's contents, so
// mounting the volume at a container path overlays exactly that content.
func PopulateNamedVolume(volumeName, holderImage, hostSrcDir string) error {
	if err := EnsureNamedVolume(volumeName); err != nil {
		return err
	}
	holder := fmt.Sprintf("nineteen-populate-%d-%d", os.Getpid(), time.Now().UnixNano())
	if out, err := exec.Command("docker", "create", "--name", holder,
		"-v", volumeName+":/dstpopulate", holderImage).CombinedOutput(); err != nil {
		return fmt.Errorf("holder create failed: %s", strings.TrimSpace(string(out)))
	}
	defer exec.Command("docker", "rm", "-f", holder).Run()
	src := hostSrcDir + string(os.PathSeparator) + "."
	if out, err := exec.Command("docker", "cp", src, holder+":/dstpopulate/").CombinedOutput(); err != nil {
		return fmt.Errorf("copy into volume failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}
