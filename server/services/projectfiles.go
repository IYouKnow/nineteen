package services

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ProjectDataMount is where a project's persistent folder is mounted inside the
// running container.
const ProjectDataMount = "/app/data"

// DataDir returns the server's data directory: NINETEEN_DATA_DIR when set,
// otherwise the directory holding DB_PATH, otherwise ./data.
func DataDir() string {
	if dir := os.Getenv("NINETEEN_DATA_DIR"); dir != "" {
		return dir
	}
	if dbPath := os.Getenv("DB_PATH"); dbPath != "" {
		return filepath.Dir(dbPath)
	}
	return "./data"
}

// ProjectDataDir returns the absolute host path of a project's persistent
// folder. It must be absolute so Docker treats it as a bind mount rather than a
// named volume.
func ProjectDataDir(projectID int64) string {
	dir := filepath.Join(DataDir(), "projects", strconv.FormatInt(projectID, 10))
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return dir
}

// EnsureProjectDataDir creates (if needed) and returns the project's folder.
func EnsureProjectDataDir(projectID int64) (string, error) {
	dir := ProjectDataDir(projectID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// RemoveProjectDataDir deletes a project's persistent folder and its contents.
func RemoveProjectDataDir(projectID int64) error {
	return os.RemoveAll(ProjectDataDir(projectID))
}

// resolveProjectPath maps a client-supplied container path (e.g.
// /app/data/uploads/hero.jpg) to an absolute host path under the project
// folder, rejecting anything that would escape it.
func resolveProjectPath(projectID int64, clientPath string) (string, error) {
	root, err := EnsureProjectDataDir(projectID)
	if err != nil {
		return "", err
	}
	rel := strings.TrimPrefix(clientPath, ProjectDataMount)
	rel = strings.TrimPrefix(rel, "/")
	// Clean against an absolute root so "../" segments can't climb above it.
	clean := filepath.Clean("/" + filepath.ToSlash(rel))
	full := filepath.Join(root, filepath.FromSlash(clean))
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes the project folder")
	}
	return full, nil
}

// FileNode is one entry in a project's file tree.
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	Type     string      `json:"type"`
	Size     int64       `json:"size"`
	Modified string      `json:"modified"`
	Children []*FileNode `json:"children,omitempty"`
}

const (
	maxTreeDepth   = 8
	maxTreeEntries = 2000
)

// ProjectFileTree builds the recursive file tree for a project's folder.
func ProjectFileTree(projectID int64) (*FileNode, error) {
	root, err := EnsureProjectDataDir(projectID)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	return &FileNode{
		Name:     "data",
		Path:     ProjectDataMount,
		Type:     "folder",
		Modified: info.ModTime().UTC().Format(time.RFC3339),
		Children: buildChildren(root, ProjectDataMount, 0),
	}, nil
}

func buildChildren(dir, base string, depth int) []*FileNode {
	if depth >= maxTreeDepth {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	nodes := make([]*FileNode, 0, len(entries))
	for _, entry := range entries {
		if len(nodes) >= maxTreeEntries {
			break
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		name := entry.Name()
		node := &FileNode{
			Name:     name,
			Path:     base + "/" + name,
			Modified: info.ModTime().UTC().Format(time.RFC3339),
		}
		if entry.IsDir() {
			node.Type = "folder"
			node.Children = buildChildren(filepath.Join(dir, name), node.Path, depth+1)
		} else {
			node.Type = "file"
			node.Size = info.Size()
		}
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Type != nodes[j].Type {
			return nodes[i].Type == "folder"
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
	return nodes
}

func validEntryName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	return !strings.ContainsAny(name, "/\\\x00")
}

func uniqueEntryName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if _, err := os.Stat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

// CreateProjectFolder creates a folder under parentPath.
func CreateProjectFolder(projectID int64, parentPath, name string) error {
	name = strings.TrimSpace(name)
	if !validEntryName(name) {
		return fmt.Errorf("invalid folder name")
	}
	parent, err := resolveProjectPath(projectID, parentPath)
	if err != nil {
		return err
	}
	full := filepath.Join(parent, name)
	if _, err := os.Stat(full); err == nil {
		return fmt.Errorf("a file or folder with that name already exists")
	}
	return os.MkdirAll(full, 0o755)
}

// RenameProjectEntry renames a file or folder. The project root can't be renamed.
func RenameProjectEntry(projectID int64, entryPath, newName string) error {
	newName = strings.TrimSpace(newName)
	if !validEntryName(newName) {
		return fmt.Errorf("invalid name")
	}
	full, err := resolveProjectPath(projectID, entryPath)
	if err != nil {
		return err
	}
	root := ProjectDataDir(projectID)
	if full == root {
		return fmt.Errorf("cannot rename the project folder")
	}
	if _, err := os.Stat(full); err != nil {
		return fmt.Errorf("not found")
	}
	target := filepath.Join(filepath.Dir(full), newName)
	if target == full {
		return nil
	}
	if _, err := os.Stat(target); err == nil {
		return fmt.Errorf("a file or folder with that name already exists")
	}
	return os.Rename(full, target)
}

// DeleteProjectEntry removes a file or folder. The project root is protected.
func DeleteProjectEntry(projectID int64, entryPath string) error {
	full, err := resolveProjectPath(projectID, entryPath)
	if err != nil {
		return err
	}
	root := ProjectDataDir(projectID)
	if full == root {
		return fmt.Errorf("cannot delete the project folder")
	}
	if _, err := os.Stat(full); err != nil {
		return fmt.Errorf("not found")
	}
	return os.RemoveAll(full)
}

// SaveProjectUpload streams an uploaded file into parentPath, de-duplicating the
// name when it already exists.
func SaveProjectUpload(projectID int64, parentPath, filename string, r io.Reader) error {
	name := filepath.Base(strings.TrimSpace(filename))
	if !validEntryName(name) {
		return fmt.Errorf("invalid file name")
	}
	parent, err := resolveProjectPath(projectID, parentPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("target folder not found")
	}
	name = uniqueEntryName(parent, name)
	dst, err := os.OpenFile(filepath.Join(parent, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, r)
	return err
}

// OpenProjectFile returns the host path and info of a downloadable file.
func OpenProjectFile(projectID int64, entryPath string) (string, os.FileInfo, error) {
	full, err := resolveProjectPath(projectID, entryPath)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", nil, fmt.Errorf("not found")
	}
	if info.IsDir() {
		return "", nil, fmt.Errorf("is a folder")
	}
	return full, info, nil
}
