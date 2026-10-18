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

// statOwner returns the numeric "uid:gid" that owns containerPath inside a
// throwaway container from image, optionally mounting volumeName at
// /nineteen-own first. It runs as root so an unreadable (0700 root) directory
// still reports its owner instead of failing, and returns "" when the image has
// no stat or the path does not exist.
func statOwner(image, path, volumeName string) string {
	args := []string{"run", "--rm", "-u", "0", "--entrypoint", "stat"}
	if volumeName != "" {
		args = append(args, "-v", volumeName+":/nineteen-own")
	}
	args = append(args, image, "-c", "%u:%g", path)
	out, err := exec.Command("docker", args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// OwnNamedVolumeToImageUser makes a named volume writable by the user the app
// image runs as, by matching the volume root's ownership to the owner of the
// same path inside the image. Docker creates volumes root-owned and `docker cp`
// (how existing state is migrated into a volume) does not preserve ownership, so
// a volume filled that way stays root-owned even when the app runs as a
// non-root user (e.g. code-server's `coder`) — which then cannot write its own
// state.
//
// It is a no-op when the volume is already owned correctly, when the owner
// cannot be read, or when the image carries no stat/chown (distroless). The
// common already-correct case costs a single cheap stat, so the tree is only
// walked when a repair is actually needed. reported is true only when
// ownership was changed.
func OwnNamedVolumeToImageUser(volumeName, image, containerPath string) (reported bool, err error) {
	if volumeName == "" || image == "" || containerPath == "" {
		return false, nil
	}
	want := statOwner(image, containerPath, "")
	if want == "" {
		return false, nil
	}
	if statOwner(image, "/nineteen-own", volumeName) == want {
		return false, nil
	}
	// chown takes numeric uid:gid, so no /etc/passwd lookup is needed.
	cmd := exec.Command("docker", "run", "--rm", "-u", "0",
		"--entrypoint", "chown",
		"-v", volumeName+":/nineteen-own",
		image, "-R", want, "/nineteen-own")
	if out, cerr := cmd.CombinedOutput(); cerr != nil {
		return false, fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return true, nil
}
