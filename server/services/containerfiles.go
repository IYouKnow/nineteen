package services

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ContainerEntry is one item when browsing a live container's filesystem.
type ContainerEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"` // "folder" | "file" | "other"
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

// NormalizeContainerPath cleans a client-supplied container path into an
// absolute POSIX path.
func NormalizeContainerPath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	if p == "." {
		return "/"
	}
	return p
}

// ListContainerDir lists the immediate children of a directory inside a running
// container. It shells out to `docker exec` with a find/stat invocation that
// works with both GNU coreutils and BusyBox, so it doesn't require the image to
// ship bash or GNU tooling.
func ListContainerDir(container, dir string) ([]ContainerEntry, error) {
	if container == "" {
		return nil, fmt.Errorf("this project has no running container")
	}
	dir = NormalizeContainerPath(dir)
	// %F type, %s size, %Y mtime (epoch), %n name — supported by GNU and BusyBox.
	script := fmt.Sprintf(
		"find %s -mindepth 1 -maxdepth 1 -exec stat -c '%%F|%%s|%%Y|%%n' {} +",
		shellQuote(dir),
	)

	var stdout, stderr bytes.Buffer
	cmd := exec.Command("docker", "exec", container, "sh", "-c", script)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = "could not read the container filesystem (is the container running, and does its image have a shell?)"
		}
		return nil, fmt.Errorf("%s", msg)
	}

	entries := []ContainerEntry{}
	sc := bufio.NewScanner(&stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		parts := strings.SplitN(sc.Text(), "|", 4)
		if len(parts) != 4 {
			continue
		}
		size, _ := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		sec, _ := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
		name := path.Base(parts[3])
		if name == "" || name == "." || name == ".." {
			continue
		}
		kind := "other"
		switch strings.TrimSpace(parts[0]) {
		case "directory":
			kind = "folder"
		case "regular file", "symbolic link":
			kind = "file"
		}
		entries = append(entries, ContainerEntry{
			Name:     name,
			Path:     path.Join(dir, name),
			Type:     kind,
			Size:     size,
			Modified: time.Unix(sec, 0).UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type != entries[j].Type {
			return entries[i].Type == "folder"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// CopyContainerFile copies a file out of a container to a temp file on the host
// and returns its path. `docker cp` needs no shell inside the image, so it works
// for distroless containers too. The caller is responsible for removing the file.
func CopyContainerFile(container, filePath string) (string, error) {
	if container == "" {
		return "", fmt.Errorf("this project has no running container")
	}
	filePath = NormalizeContainerPath(filePath)
	if filePath == "/" {
		return "", fmt.Errorf("not a file")
	}

	tmp, err := os.CreateTemp("", "nineteen-cp-*")
	if err != nil {
		return "", err
	}
	dest := tmp.Name()
	tmp.Close()
	// Let docker create the destination fresh, so a directory source can't be
	// copied *into* a pre-existing file (and vice versa).
	os.Remove(dest)

	var stderr bytes.Buffer
	cmd := exec.Command("docker", "cp", container+":"+filePath, dest)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.RemoveAll(dest)
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = "could not copy the file out of the container"
		}
		return "", fmt.Errorf("%s", msg)
	}
	return dest, nil
}

// shellQuote wraps s in single quotes for safe interpolation into an `sh -c`
// script, escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
