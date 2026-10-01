package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// symlinkFixture creates an isolated data dir holding project 1 with:
//   - data/hello.txt (a legitimate file)
//   - outside/secret.txt (outside the project folder)
//   - data/leak -> outside/secret.txt (absolute escape link, as a deployed
//     container would plant over its read-write bind mount)
//   - data/evil -> outside (a directory escape link)
//
// It skips when the platform refuses symlink creation (Windows without
// Developer Mode) instead of failing.
func symlinkFixture(t *testing.T) (outsideSecret string) {
	t.Helper()
	if os.Getenv("SKIP_SYMLINK_TESTS") != "" {
		t.Skip("SKIP_SYMLINK_TESTS is set")
	}
	dir := t.TempDir()
	t.Setenv("NINETEEN_DATA_DIR", dir)

	root, err := EnsureProjectDataDir(1)
	if err != nil {
		t.Fatalf("EnsureProjectDataDir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data", "hello.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dir, "outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	outsideSecret = filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideSecret, []byte("top-secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideSecret, filepath.Join(root, "data", "leak")); err != nil {
		t.Skipf("cannot create symlinks on this platform: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "data", "evil")); err != nil {
		t.Skipf("cannot create symlinks on this platform: %v", err)
	}
	return outsideSecret
}

func TestOpenProjectFileRejectsSymlinkEscape(t *testing.T) {
	symlinkFixture(t)

	for _, p := range []string{"data/leak", "data/evil/secret.txt"} {
		if f, _, err := OpenProjectFile(1, p); err == nil {
			f.Close()
			t.Fatalf("OpenProjectFile(%q) opened a host file outside the project", p)
		}
	}

	// The legitimate file next to the links still opens with its content.
	f, info, err := OpenProjectFile(1, "data/hello.txt")
	if err != nil {
		t.Fatalf("OpenProjectFile(hello.txt): %v", err)
	}
	defer f.Close()
	if info.Name() != "hello.txt" {
		t.Fatalf("unexpected file: %s", info.Name())
	}
	buf := make([]byte, 5)
	if _, err := f.Read(buf); err != nil || string(buf) != "hello" {
		t.Fatalf("unexpected content: %q, %v", buf, err)
	}
}

func TestSaveProjectUploadRejectsSymlinkedParent(t *testing.T) {
	outsideSecret := symlinkFixture(t)
	outside := filepath.Dir(outsideSecret)

	if err := SaveProjectUpload(1, "data/evil", "pwned.txt", strings.NewReader("x")); err == nil {
		t.Fatal("SaveProjectUpload through a symlinked dir succeeded")
	}
	if _, err := os.Stat(filepath.Join(outside, "pwned.txt")); !os.IsNotExist(err) {
		t.Fatal("upload escaped the project folder")
	}
	// The pre-existing outside file is untouched.
	if b, err := os.ReadFile(outsideSecret); err != nil || string(b) != "top-secret" {
		t.Fatalf("outside file altered: %q, %v", b, err)
	}
}

func TestSaveProjectUploadDedupsAgainstDanglingLink(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NINETEEN_DATA_DIR", dir)
	root, err := EnsureProjectDataDir(1)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A dangling link must count as "taken": O_CREATE would otherwise follow
	// it and create the target.
	if err := os.Symlink(filepath.Join(dir, "nope", "target.txt"), filepath.Join(root, "data", "evil.txt")); err != nil {
		t.Skipf("cannot create symlinks on this platform: %v", err)
	}
	if err := SaveProjectUpload(1, "data", "evil.txt", strings.NewReader("x")); err != nil {
		t.Fatalf("SaveProjectUpload: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "data", "evil-1.txt")); err != nil {
		t.Fatalf("deduped file missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "nope", "target.txt")); !os.IsNotExist(err) {
		t.Fatal("upload followed a dangling symlink")
	}
}

func TestCreateFolderThroughSymlinkRejected(t *testing.T) {
	symlinkFixture(t)
	if err := CreateProjectFolder(1, "data/evil", "sub"); err == nil {
		t.Fatal("CreateProjectFolder through a symlinked dir succeeded")
	}
}

func TestRenameThroughSymlinkRejected(t *testing.T) {
	symlinkFixture(t)
	if err := RenameProjectEntry(1, "data/evil/secret.txt", "renamed.txt"); err == nil {
		t.Fatal("RenameProjectEntry through a symlinked dir succeeded")
	}
}

func TestDeleteSymlinkRemovesLinkOnly(t *testing.T) {
	outsideSecret := symlinkFixture(t)

	if err := DeleteProjectEntry(1, "data/leak"); err != nil {
		t.Fatalf("DeleteProjectEntry(link): %v", err)
	}
	// The host target survives; only the link is gone.
	if b, err := os.ReadFile(outsideSecret); err != nil || string(b) != "top-secret" {
		t.Fatalf("link target harmed: %q, %v", b, err)
	}
}

func TestDeleteThroughSymlinkedDirRejected(t *testing.T) {
	outsideSecret := symlinkFixture(t)

	if err := DeleteProjectEntry(1, "data/evil/secret.txt"); err == nil {
		t.Fatal("DeleteProjectEntry through a symlinked dir succeeded")
	}
	if _, err := os.Stat(outsideSecret); err != nil {
		t.Fatalf("outside file deleted: %v", err)
	}
}

func TestTreeDoesNotFollowSymlinks(t *testing.T) {
	symlinkFixture(t)

	tree, err := ProjectFileTree(1)
	if err != nil {
		t.Fatalf("ProjectFileTree: %v", err)
	}
	var data *FileNode
	for _, c := range tree.Children {
		if c.Name == "data" {
			data = c
		}
	}
	if data == nil {
		t.Fatal("data folder missing from tree")
	}
	seen := map[string]string{}
	for _, c := range data.Children {
		seen[c.Name] = c.Type
		if len(c.Children) > 0 && c.Name != "hello.txt" {
			t.Fatalf("node %q has children it should not have", c.Name)
		}
	}
	if seen["leak"] != "symlink" || seen["evil"] != "symlink" {
		t.Fatalf("links not reported as symlinks: %v", seen)
	}
	if seen["hello.txt"] != "file" {
		t.Fatalf("regular file misreported: %v", seen)
	}
}
