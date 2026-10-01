package services

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ProjectDataMount is the default container path a project's data folder is
// mounted at.
const ProjectDataMount = "/app/data"

var (
	hostDataDirOnce sync.Once
	hostDataDirVal  string
)

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

// HostProjectDataDir returns the host path of a project's folder, for bind
// mounting into project containers.
func HostProjectDataDir(projectID int64) string {
	return filepath.Join(HostDataDir(), "projects", strconv.FormatInt(projectID, 10))
}

// HostDataDir returns the host path that corresponds to DataDir(). The server
// may itself run in a container whose data dir is bind-mounted from the host;
// the Docker daemon (which starts project containers) resolves bind sources on
// the host, so the in-container path must be translated before it is handed to
// Docker. Falls back to the local absolute path when not containerized.
func HostDataDir() string {
	hostDataDirOnce.Do(func() {
		hostDataDirVal = detectHostDataDir()
	})
	return hostDataDirVal
}

func detectHostDataDir() string {
	if dir := os.Getenv("NINETEEN_HOST_DATA_DIR"); dir != "" {
		return dir
	}
	u := NewUpdateService("")
	if insp, err := u.inspectContainer(u.ContainerName); err == nil {
		if host := u.findDataMount(insp); host != "" {
			return host
		}
	}
	if abs, err := filepath.Abs(DataDir()); err == nil {
		return abs
	}
	return DataDir()
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

// ValidHostPath normalizes a project-relative volume folder and rejects
// anything that could escape the project directory.
func ValidHostPath(p string) (string, error) {
	p = strings.TrimSpace(strings.ReplaceAll(p, "\\", "/"))
	p = strings.Trim(p, "/")
	if p == "" {
		return "", fmt.Errorf("folder is required")
	}
	clean := path.Clean(p)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "\x00") {
		return "", fmt.Errorf("invalid folder")
	}
	return clean, nil
}

// ProjectVolumeDir returns the in-container path of a volume's host folder.
func ProjectVolumeDir(projectID int64, hostPath string) string {
	return filepath.Join(ProjectDataDir(projectID), filepath.FromSlash(hostPath))
}

// EnsureProjectVolumeDir creates (if needed) and returns the volume's folder.
//
// The folder is made world-writable because Docker does not adjust the
// ownership of a host bind mount: the server (running as root) creates the
// folder, but the project container may run as a non-root user (e.g. USER app),
// which then cannot create its data files (a SQLite database, uploads, …) and
// crash-loops. On Docker Desktop the bind layer is effectively permissive, so
// this only bites on a Linux host.
func EnsureProjectVolumeDir(projectID int64, hostPath string) (string, error) {
	dir := ProjectVolumeDir(projectID, hostPath)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return "", err
	}
	// MkdirAll applies the process umask and never changes an existing folder,
	// so force the mode explicitly on every call (including redeploys).
	_ = os.Chmod(dir, 0o777)
	return dir, nil
}

// HostProjectVolumeDir returns the host path of a volume's folder, for bind
// mounting into a project container.
func HostProjectVolumeDir(projectID int64, hostPath string) string {
	return filepath.Join(HostProjectDataDir(projectID), filepath.FromSlash(hostPath))
}

// resolveProjectPath maps a client-supplied path (relative to the project
// folder, e.g. "data/uploads/hero.jpg") to an absolute host path, rejecting
// anything that would escape the project folder.
//
// This check is lexical only: it cannot see symlinks. A deployed container
// shares the project folder over a read-write bind mount and can plant
// `ln -s /etc/shadow data/leak`; the cleaned string still starts with the
// root while the kernel would resolve it to the host's /etc/shadow. Every
// operation that touches the filesystem must therefore go through
// resolveExisting (or resolveParentDir) below, which re-validates the
// symlink-resolved location.
func resolveProjectPath(projectID int64, clientPath string) (string, error) {
	root, err := EnsureProjectDataDir(projectID)
	if err != nil {
		return "", err
	}
	rel := strings.TrimPrefix(strings.TrimSpace(clientPath), "/")
	clean := path.Clean("/" + rel)
	full := filepath.Join(root, filepath.FromSlash(clean))
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes the project folder")
	}
	return full, nil
}

// containedIn reports whether p is root or lives under it. Both arguments
// must already be canonical (symlink-free); use canonRoot and
// filepath.EvalSymlinks at the call site.
func containedIn(root, p string) bool {
	if p == root {
		return true
	}
	return strings.HasPrefix(p, root+string(os.PathSeparator))
}

// canonRoot returns the symlink-resolved project folder, creating it first.
// The root itself is resolved because the data directory may live under a
// symlinked prefix (e.g. /var -> /private/var on macOS, /data mounts), and
// comparing an unresolved root against resolved targets would false-positive.
func canonRoot(projectID int64) (lexRoot, canon string, err error) {
	lexRoot, err = EnsureProjectDataDir(projectID)
	if err != nil {
		return "", "", err
	}
	canon, err = filepath.EvalSymlinks(lexRoot)
	if err != nil {
		return "", "", err
	}
	return lexRoot, canon, nil
}

// resolveExisting maps a client path to its canonical on-disk location and
// rejects anything that resolves outside the project folder — including via
// symlinks planted by a deployed container. The target must exist.
func resolveExisting(projectID int64, clientPath string) (lexFull, canon string, err error) {
	lexFull, err = resolveProjectPath(projectID, clientPath)
	if err != nil {
		return "", "", err
	}
	_, root, err := canonRoot(projectID)
	if err != nil {
		return "", "", err
	}
	canon, err = filepath.EvalSymlinks(lexFull)
	if err != nil {
		return "", "", fmt.Errorf("not found")
	}
	if !containedIn(root, canon) {
		return "", "", fmt.Errorf("path escapes the project folder")
	}
	return lexFull, canon, nil
}

// resolveParentDir resolves a client-supplied parent folder to its canonical
// location for writes (mkdir, upload). The folder must already exist as a
// real directory inside the project — traversal through a symlink is
// rejected rather than followed, so MkdirAll/OpenFile can never be steered
// at host paths.
func resolveParentDir(projectID int64, parentPath string) (string, error) {
	_, canon, err := resolveExisting(projectID, parentPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canon)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("target folder not found")
	}
	return canon, nil
}

// FileNode is one entry in a project's file tree.
type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	Label    string      `json:"label,omitempty"`
	Type     string      `json:"type"`
	Size     int64       `json:"size"`
	Modified string      `json:"modified"`
	Children []*FileNode `json:"children,omitempty"`
}

const (
	maxTreeDepth   = 8
	maxTreeEntries = 2000
)

// ProjectFileTree builds the recursive file tree for a project's folder. Node
// paths are relative to the folder root.
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
		Name:     filepath.Base(root),
		Path:     "",
		Label:    HostProjectDataDir(projectID),
		Type:     "folder",
		Modified: info.ModTime().UTC().Format(time.RFC3339),
		Children: buildChildren(root, "", 0),
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
		// Lstat, not Stat: a symlink must be reported as itself — never
		// followed (which would leak the target's size/mtime) and never
		// descended into (which would expose host directories in the tree).
		info, err := os.Lstat(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		name := entry.Name()
		node := &FileNode{
			Name:     name,
			Path:     path.Join(base, name),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
		}
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			node.Type = "symlink"
		case info.IsDir():
			node.Type = "folder"
			node.Children = buildChildren(filepath.Join(dir, name), node.Path, depth+1)
		default:
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
	// Lstat, not Stat: a dangling symlink must count as "taken". Otherwise
	// O_CREATE|O_EXCL would follow it and create the link's target.
	if _, err := os.Lstat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if _, err := os.Lstat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

// CreateProjectFolder creates a folder under parentPath (project-relative).
func CreateProjectFolder(projectID int64, parentPath, name string) error {
	name = strings.TrimSpace(name)
	if !validEntryName(name) {
		return fmt.Errorf("invalid folder name")
	}
	parent, err := resolveParentDir(projectID, parentPath)
	if err != nil {
		return err
	}
	full := filepath.Join(parent, name)
	// Lstat: never mkdir through (or over) a planted link.
	if _, err := os.Lstat(full); err == nil {
		return fmt.Errorf("a file or folder with that name already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Mkdir(full, 0o755)
}

// RenameProjectEntry renames a file or folder. The project root can't be renamed.
func RenameProjectEntry(projectID int64, entryPath, newName string) error {
	newName = strings.TrimSpace(newName)
	if !validEntryName(newName) {
		return fmt.Errorf("invalid name")
	}
	full, canon, err := resolveExisting(projectID, entryPath)
	if err != nil {
		return fmt.Errorf("not found")
	}
	_, root, err := canonRoot(projectID)
	if err != nil {
		return err
	}
	if canon == root {
		return fmt.Errorf("cannot rename the project folder")
	}
	target := filepath.Join(filepath.Dir(full), newName)
	if target == full {
		return nil
	}
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("a file or folder with that name already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Rename(full, target)
}

// DeleteProjectEntry removes a file or folder. The project root is protected.
func DeleteProjectEntry(projectID int64, entryPath string) error {
	full, err := resolveProjectPath(projectID, entryPath)
	if err != nil {
		return err
	}
	lexRoot, root, err := canonRoot(projectID)
	if err != nil {
		return err
	}
	if full == lexRoot {
		return fmt.Errorf("cannot delete the project folder")
	}
	link, err := os.Lstat(full)
	if err != nil {
		return fmt.Errorf("not found")
	}
	if link.Mode()&os.ModeSymlink != 0 {
		// A link is removed as a link: os.Remove never follows it, so a
		// planted symlink is cleaned up without touching its target. This
		// also keeps escape-links deletable after resolveExisting below
		// started rejecting them.
		return os.Remove(full)
	}
	canon, err := filepath.EvalSymlinks(full)
	if err != nil || !containedIn(root, canon) {
		return fmt.Errorf("path escapes the project folder")
	}
	return os.RemoveAll(full)
}

// SaveProjectUpload streams an uploaded file into parentPath, de-duplicating the
// name when it already exists. relName may contain subdirectories (e.g.
// "sub/dir/file.txt") to support folder uploads; each segment is validated and
// the intermediate folders are created as needed.
func SaveProjectUpload(projectID int64, parentPath, relName string, r io.Reader) error {
	relName = strings.TrimSpace(strings.ReplaceAll(relName, "\\", "/"))
	clean := strings.TrimPrefix(path.Clean("/"+relName), "/")
	if clean == "" || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "\x00") {
		return fmt.Errorf("invalid file name")
	}
	segments := strings.Split(clean, "/")
	for _, seg := range segments {
		if !validEntryName(seg) {
			return fmt.Errorf("invalid file name")
		}
	}
	// The parent is symlink-resolved before anything is created under it,
	// and every intermediate folder is walked one level at a time with
	// Lstat: MkdirAll would happily mkdir *through* a planted symlink and
	// O_CREATE would follow a dangling one, both as root.
	parent, err := resolveParentDir(projectID, parentPath)
	if err != nil {
		return err
	}
	dir := parent
	for _, seg := range segments[:len(segments)-1] {
		next := filepath.Join(dir, seg)
		fi, err := os.Lstat(next)
		if err == nil {
			if fi.Mode()&os.ModeSymlink != 0 || !fi.IsDir() {
				return fmt.Errorf("invalid file name")
			}
		} else if os.IsNotExist(err) {
			if err := os.Mkdir(next, 0o755); err != nil {
				return err
			}
		} else {
			return err
		}
		dir = next
	}
	name := uniqueEntryName(dir, segments[len(segments)-1])
	final := filepath.Join(dir, name)
	dst, err := os.OpenFile(final, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(dst, r)
	closeErr := dst.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	// Close the plant-and-swap race deterministically: if the destination
	// is (now) a symlink, O_CREATE followed it and the bytes landed in the
	// link target. Remove what we just created through it and refuse.
	if li, err := os.Lstat(final); err == nil && li.Mode()&os.ModeSymlink != 0 {
		if target, err := filepath.EvalSymlinks(final); err == nil {
			os.Remove(target)
		}
		os.Remove(final)
		return fmt.Errorf("invalid file name")
	}
	return nil
}

// SaveProjectUploadStream consumes an upload multipart stream and writes every
// file part to the project folder, preserving relative paths. It streams parts
// instead of using ParseMultipartForm because Go's form parser caps requests at
// 1000 parts; a folder upload sends two parts per file (the file plus its
// relative path), so large folders would otherwise be rejected with
// "multipart: message too large".
//
// Expected fields, in this order: "path" (target folder), "paths" (a JSON array
// of relative paths, one per file, in the same order as the file parts), then
// the "files" parts. When "paths" is missing or malformed each file falls back
// to its own (base) name.
func SaveProjectUploadStream(projectID int64, mr *multipart.Reader) (int, error) {
	parent := ""
	var relPaths []string
	saved := 0
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return saved, err
		}
		name := part.FormName()
		isFile := part.FileName() != ""
		switch {
		case !isFile && name == "path":
			b, err := io.ReadAll(io.LimitReader(part, 64<<10))
			part.Close()
			if err != nil {
				return saved, err
			}
			parent = string(b)
		case !isFile && name == "paths":
			b, err := io.ReadAll(io.LimitReader(part, 16<<20))
			part.Close()
			if err != nil {
				return saved, err
			}
			var list []string
			if json.Unmarshal(b, &list) == nil {
				relPaths = list
			}
		case isFile && name == "files":
			rel := part.FileName()
			if saved < len(relPaths) && strings.TrimSpace(relPaths[saved]) != "" {
				rel = relPaths[saved]
			}
			err := SaveProjectUpload(projectID, parent, rel, part)
			part.Close()
			if err != nil {
				return saved, fmt.Errorf("%s: %w", rel, err)
			}
			saved++
		default:
			part.Close()
		}
	}
	return saved, nil
}

// OpenProjectFile opens a downloadable file and returns the handle with its
// info. The path is symlink-resolved and re-validated against the project
// folder first, so a `data/leak -> /etc/shadow` link planted by a deployed
// container resolves outside the root and is refused instead of served.
//
// The caller owns the returned file. It is opened from the already-resolved
// canonical path (never the raw client string), and a SameFile re-stat plus
// a re-resolution guard the narrow plant-and-swap race between EvalSymlinks
// and Open: if the tree moved under us, the open is discarded.
func OpenProjectFile(projectID int64, entryPath string) (*os.File, os.FileInfo, error) {
	_, canon, err := resolveExisting(projectID, entryPath)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(canon)
	if err != nil {
		return nil, nil, fmt.Errorf("not found")
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, fmt.Errorf("not found")
	}
	if info.IsDir() {
		f.Close()
		return nil, nil, fmt.Errorf("is a folder")
	}
	live, err := os.Stat(canon)
	if err != nil || !os.SameFile(info, live) {
		f.Close()
		return nil, nil, fmt.Errorf("not found")
	}
	_, root, err := canonRoot(projectID)
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	recanon, err := filepath.EvalSymlinks(canon)
	if err != nil || recanon != canon || !containedIn(root, recanon) {
		f.Close()
		return nil, nil, fmt.Errorf("not found")
	}
	return f, info, nil
}
