package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/services"
)

// Recreate snapshots let a compose project be recreated without rebuilding:
// the exact compose file that was deployed is kept in the project data dir
// (the CasaOS approach — the clone directory is deleted after a deploy, so
// without a snapshot there would be nothing to `up`).
type recreateSnapshot struct {
	ComposeFile string `json:"compose_file"`
	Version     string `json:"version"`
}

// SnapshotComposeForRecreate stores the deployed compose file (after any saved
// build-file override was applied, so user edits are preserved) plus the
// version handed to the build. It never fails a deployment — callers log and
// continue when it errors.
func SnapshotComposeForRecreate(projectID int64, dir, composeFile, version string) error {
	rel := strings.TrimSpace(filepath.ToSlash(composeFile))
	if rel == "" {
		return fmt.Errorf("no compose file")
	}
	raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(rel, "/"))))
	if err != nil || len(raw) == 0 || len(raw) > 1<<20 {
		return fmt.Errorf("cannot read compose file: %v", err)
	}
	dstDir := filepath.Join(services.ProjectDataDir(projectID), "recreate", "compose")
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return err
	}
	base := filepath.Base(filepath.FromSlash(rel))
	if err := os.WriteFile(filepath.Join(dstDir, base), raw, 0o644); err != nil {
		return err
	}
	meta, _ := json.Marshal(recreateSnapshot{ComposeFile: base, Version: version})
	if err := os.WriteFile(filepath.Join(dstDir, "recreate.json"), meta, 0o644); err != nil {
		return err
	}
	return nil
}

// loadRecreateSnapshot returns the snapshot directory and its metadata. An
// error means the project was deployed before snapshots existed (or the data
// dir was wiped) — the caller must ask for a fresh deploy instead.
func loadRecreateSnapshot(projectID int64) (string, recreateSnapshot, error) {
	var snap recreateSnapshot
	dir := filepath.Join(services.ProjectDataDir(projectID), "recreate", "compose")
	raw, err := os.ReadFile(filepath.Join(dir, "recreate.json"))
	if err != nil {
		return "", snap, fmt.Errorf("no compose snapshot for this project — run Deploy once to create it")
	}
	if err := json.Unmarshal(raw, &snap); err != nil || snap.ComposeFile == "" {
		return "", snap, fmt.Errorf("compose snapshot is corrupt — run Deploy once to recreate it")
	}
	if _, err := os.Stat(filepath.Join(dir, snap.ComposeFile)); err != nil {
		return "", snap, fmt.Errorf("compose snapshot is incomplete — run Deploy once to recreate it")
	}
	return dir, snap, nil
}

// latestDeploymentSHA returns the newest deployment's commit SHA so a recreate
// history entry keeps continuity with what is actually running.
func latestDeploymentSHA(projectID int64) string {
	var sha string
	if err := db.DB.QueryRow(
		"SELECT commit_sha FROM deployments WHERE project_id = ? ORDER BY id DESC LIMIT 1",
		projectID,
	).Scan(&sha); err != nil || strings.TrimSpace(sha) == "" {
		return randomHex(40)
	}
	return sha
}

// recreateProject recreates a project's container(s) from the already-built
// image with the current env vars, ports, volumes and restart policy — no
// repo clone, no image build. It records a deployments row (trigger
// "recreate") with logs, exactly like a deploy, so the history shows it.
//
// This mirrors CasaOS "apply changes": same image, fresh container config,
// seconds of downtime instead of minutes. The container's ephemeral
// filesystem still resets (Docker gives no alternative when env changes) —
// persistent state must live on volumes, which is what env-sync warns about.
func recreateProject(ctx context.Context, userID int64, project models.Project) (models.Deployment, error) {
	container := services.ResolveContainer(project.ID, project.Slug, project.BuildStrategy)
	if container == "" {
		return models.Deployment{}, fmt.Errorf("no running container found for this project — deploy first")
	}

	// Display ref follows the same rule as a manual deploy.
	displayRef := project.Branch
	if project.DeployType == "release" && strings.TrimSpace(project.DeployRef) != "" {
		displayRef = strings.TrimSpace(project.DeployRef)
	}
	if displayRef == "" {
		displayRef = "main"
	}

	result, err := db.DB.Exec(
		`INSERT INTO deployments (user_id, project_id, project_name, status, commit_sha, commit_message,
			branch, author, trigger, framework, deploy_source, deploy_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, project.ID, project.Name, statusBuilding, latestDeploymentSHA(project.ID),
		"Recreated without rebuild — configuration applied",
		displayRef, "you", "recreate", project.Framework, deploySourceDefault, "",
	)
	if err != nil {
		return models.Deployment{}, fmt.Errorf("failed to record deployment")
	}
	deployID, _ := result.LastInsertId()
	now := time.Now().UTC().Format(time.RFC3339)
	db.DB.Exec("UPDATE projects SET status = ?, last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusBuilding, now, project.ID)

	log := func(level, msg string) {
		db.DB.Exec("INSERT INTO deployment_logs (deployment_id, level, message) VALUES (?, ?, ?)", deployID, level, msg)
	}
	start := time.Now()
	d := services.NewDeployer()

	finish := func() (models.Deployment, error) {
		dep, derr := getDeployment(userID, deployID)
		if derr != nil {
			return models.Deployment{ID: deployID}, derr
		}
		return dep, nil
	}

	if err := d.DockerAvailable(); err != nil {
		log("error", err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		dep, _ := finish()
		return dep, fmt.Errorf("Docker is not available: %s", err.Error())
	}

	// Everything below is validated before the old container is touched; once
	// it is removed a Run failure leaves the project stopped with the error in
	// the deployment log, and the user redeploys to recover.
	if project.BuildStrategy == "compose" {
		if rerr := composeRecreate(ctx, log, d, deployID, project, start); rerr != nil {
			dep, _ := finish()
			return dep, rerr
		}
		dep, derr := finish()
		return dep, derr
	}
	if rerr := containerRecreate(ctx, log, d, deployID, project, container, start); rerr != nil {
		dep, _ := finish()
		return dep, rerr
	}
	dep, derr := finish()
	return dep, derr
}

// containerRecreate re-runs a Dockerfile/image project's container from the
// exact image it is currently running, with fresh env, ports, volumes and
// restart policy from the database.
func containerRecreate(ctx context.Context, log func(string, string), d *services.Deployer, deployID int64, project models.Project, container string, start time.Time) error {
	cfg := services.InspectContainerConfig(container)
	if cfg == nil || strings.TrimSpace(cfg.Image) == "" {
		log("error", "Could not inspect the running container — deploy again to recover")
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return fmt.Errorf("could not inspect the running container")
	}
	image := cfg.Image
	log("info", "Reusing image "+image+" (no rebuild)")

	envVars, envErr := services.LoadEnvVars(project.ID)
	if envErr != nil {
		log("warn", "Failed to load environment variables: "+envErr.Error())
		envVars = nil
	}
	envPath, envErr := services.WriteEnvFile(envVars)
	if envErr != nil {
		log("warn", "Failed to write env file: "+envErr.Error())
		envPath = ""
	}
	if envPath != "" {
		defer os.Remove(envPath)
	}

	appPort := 0
	if len(cfg.ContainerPorts) > 0 {
		appPort = cfg.ContainerPorts[0]
		log("info", fmt.Sprintf("Keeping container port %d", appPort))
	} else if p := d.ImagePort(image); p > 0 {
		appPort = p
		log("info", fmt.Sprintf("Image exposes port %d", appPort))
	} else {
		appPort = 3000
		log("warn", "No published port found on the running container — assuming 3000. Set a port in the project settings if this is wrong.")
	}

	// Migrate any still-uncovered state out of the running container before it
	// is removed (covers old projects that never got auto-volumes).
	ensureStateVolumes(project.ID, []stateMigrateTarget{{Container: container, Image: image}}, func() {
		if d.ContainerState(container) == "running" {
			_ = d.StopContainer(container)
		}
	}, log)

	containerName := services.ProjectContainerName(project.ID, project.Slug)
	d.CleanupContainer(containerName)
	d.CleanupContainer("nineteen-" + project.Slug)
	d.CleanupCompose(services.ProjectComposeName(project.ID, project.Slug), func(line string) { log("info", line) })

	mappings, primary := projectPortMappings(d, project, appPort, log)
	if len(mappings) == 0 {
		log("error", "Failed to reserve a port")
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return fmt.Errorf("failed to reserve a port")
	}
	primaryHost := mappings[primary].HostPort

	if _, err := services.EnsureProjectAppDataDir(project.ID); err != nil {
		log("warn", "Could not prepare AppData folder: "+err.Error())
	}
	mounts := projectBindMounts(project.ID, func(msg string) { log("info", msg) })
	if auto := services.RequiredHostMounts(image, project.Image); len(auto) > 0 {
		before := len(mounts)
		mounts = services.AppendRequiredHostMounts(mounts, auto)
		if len(mounts) > before {
			log("info", "Mounting Docker socket (/var/run/docker.sock) — required by this image")
		}
	}
	if len(mounts) > 0 {
		log("info", fmt.Sprintf("Mounting %d persistent volume(s)", len(mounts)))
	}
	for _, m := range mappings {
		log("info", fmt.Sprintf("Publishing %s:%d → container %d", services.ProjectBindAddr(), m.HostPort, m.ContainerPort))
	}
	if _, err := d.Run(ctx, image, containerName, mappings, envPath, mounts, project.WorkingDir, services.RestartArg(project.RestartPolicy, project.RestartRetries), func(line string) { log("info", line) }); err != nil {
		log("error", "Container failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return fmt.Errorf("container failed: %s", err.Error())
	}

	duration := int64(time.Since(start).Seconds())
	url := fmt.Sprintf("http://localhost:%d", primaryHost)
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusReady, primaryHost, url, duration, deployID)
	db.DB.Exec("UPDATE projects SET status = 'running', port = ?, last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		primaryHost, time.Now().UTC().Format(time.RFC3339), project.ID)
	log("success", "Configuration applied at "+url+" (same image, no rebuild)")
	services.EnsureTailed(project.ID, deployID, containerName)
	return nil
}

// composeRecreate re-runs a compose stack from its deploy-time snapshot
// without building: only containers whose config changed are recreated and
// the images stay exactly as deployed.
func composeRecreate(ctx context.Context, log func(string, string), d *services.Deployer, deployID int64, project models.Project, start time.Time) error {
	snapDir, snap, err := loadRecreateSnapshot(project.ID)
	if err != nil {
		log("error", err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return err
	}
	log("info", "Reusing snapshotted compose file "+snap.ComposeFile+" (no rebuild)")

	envVars, envErr := services.LoadEnvVars(project.ID)
	if envErr != nil {
		log("warn", "Failed to load environment variables: "+envErr.Error())
		envVars = nil
	}
	envPath, envErr := services.WriteEnvFile(envVars)
	if envErr != nil {
		log("warn", "Failed to write env file: "+envErr.Error())
		envPath = ""
	}
	if envPath != "" {
		defer os.Remove(envPath)
	}

	if _, err := services.EnsureProjectAppDataDir(project.ID); err != nil {
		log("warn", "Could not prepare AppData folder: "+err.Error())
	}
	// Migrate any still-uncovered state out of the running stack first.
	recreateTargets := []stateMigrateTarget{}
	for _, sc := range services.ComposeServiceContainers(services.ProjectComposeName(project.ID, project.Slug)) {
		recreateTargets = append(recreateTargets, stateMigrateTarget{Container: sc.Container, Image: sc.Image})
	}
	for _, img := range composeServiceImages(snapDir, snap.ComposeFile) {
		recreateTargets = append(recreateTargets, stateMigrateTarget{Image: img})
	}
	recreateTargets = append(recreateTargets, stateMigrateTarget{Image: project.Image})
	ensureStateVolumes(project.ID, recreateTargets, func() {
		d.ComposeStop(services.ProjectComposeName(project.ID, project.Slug))
	}, log)
	mounts := projectBindMounts(project.ID, func(msg string) { log("info", msg) })
	if auto := services.RequiredHostMounts(project.Image, composeFileHint(snapDir, snap.ComposeFile)); len(auto) > 0 {
		before := len(mounts)
		mounts = services.AppendRequiredHostMounts(mounts, auto)
		if len(mounts) > before {
			log("info", "Mounting Docker socket (/var/run/docker.sock) into compose services — runner image detected")
		}
	}
	restartArg := services.RestartArg(project.RestartPolicy, project.RestartRetries)
	overridePath := ""
	if names := services.ComposeServiceNames(filepath.Join(snapDir, snap.ComposeFile)); len(names) > 0 {
		if p, err := services.WriteComposeOverride(names, envPath, mounts, restartArg); err == nil {
			overridePath = p
			defer os.Remove(overridePath)
		} else {
			log("warn", "Failed to generate compose override: "+err.Error())
		}
	} else {
		log("warn", "Could not list compose services — env vars, volumes and the restart policy were not injected")
	}

	name := services.ProjectComposeName(project.ID, project.Slug)
	if err := d.ComposeUpNoBuild(ctx, snapDir, snap.ComposeFile, overridePath, name, snap.Version, func(line string) { log("info", line) }); err != nil {
		log("error", "docker compose failed: "+err.Error())
		finishDeployment(deployID, project.ID, statusError, 0, "")
		return fmt.Errorf("docker compose failed: %s", err.Error())
	}
	log("info", "Compose stack updated (images unchanged)")

	ports := d.ComposePorts(name)
	if len(ports) == 0 {
		duration := int64(time.Since(start).Seconds())
		db.DB.Exec("UPDATE deployments SET status = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
			statusReady, duration, deployID)
		db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
			time.Now().UTC().Format(time.RFC3339), project.ID)
		log("warn", "The compose stack is running but publishes no ports — there is no URL to open.")
		return nil
	}

	picked, _ := services.PickAppPort(ports)
	for _, p := range ports {
		if p.Port == picked.Port && p.Service == picked.Service {
			log("info", fmt.Sprintf("Published port %d (service %q, image %s)", p.Port, p.Service, p.Image))
		}
	}

	duration := int64(time.Since(start).Seconds())
	url := fmt.Sprintf("http://localhost:%d", picked.Port)
	db.DB.Exec("UPDATE deployments SET status = ?, port = ?, url = ?, duration = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		statusReady, picked.Port, url, duration, deployID)
	db.DB.Exec("UPDATE projects SET status = 'running', last_deployed_at = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?",
		time.Now().UTC().Format(time.RFC3339), project.ID)
	log("success", "Configuration applied at "+url+" (images unchanged)")
	if cname := services.ResolveContainer(project.ID, project.Slug, project.BuildStrategy); cname != "" {
		services.EnsureTailed(project.ID, deployID, cname)
	}
	return nil
}

// stateMigrateTarget is one container (possibly "") whose image is checked
// for known state directories. A fresh deploy has no container yet — volume
// rows are still created so the first start already persists state.
type stateMigrateTarget struct {
	Container string
	Image     string
}

// ensureStateVolumes auto-mounts known state directories (CasaOS AppData
// style) as Docker named volumes: for every auto-suggestion of the given
// images that no volume covers, it creates the volume, migrates existing
// container content into it when a container is present, and inserts the
// volume row so the upcoming Run/Up mounts it in the same operation. Named
// volumes live in the VM with native Linux semantics, unlike Windows bind
// mounts (which reject non-empty directory renames on Docker Desktop).
//
// New projects get persistence before any state exists; old projects get
// their ephemeral state migrated instead of wiped. It is a no-op when
// everything is already covered. stop gracefully stops the old container(s)
// before the copy so live data (e.g. databases) is consistent; it runs at
// most once and only when a migration will actually copy.
func ensureStateVolumes(projectID int64, targets []stateMigrateTarget, stop func(), log func(string, string)) {
	images := []string{}
	seenImg := map[string]bool{}
	for _, t := range targets {
		if t.Image != "" && !seenImg[t.Image] {
			seenImg[t.Image] = true
			images = append(images, t.Image)
		}
	}
	// Curated entries plus the images' own declared VOLUMEs — no per-app
	// mapping needed for images that declare their state (e.g. postgres).
	suggestions := map[string]services.StateDirSuggestion{}
	for _, s := range services.AllStateSuggestions(images) {
		if s.Auto {
			suggestions[s.ContainerPath] = s
		}
	}
	if len(suggestions) == 0 {
		return
	}
	vols, _ := loadProjectVolumes(projectID)
	type item struct {
		suggestion services.StateDirSuggestion
		hostPath   string // bind staging folder (bind rows only)
		needRow    bool   // false when the volume row already exists
	}
	var items []item
	for _, s := range suggestions {
		var covering *models.ProjectVolume
		parentCovered := false
		for i, v := range vols {
			cp := strings.TrimSuffix(v.ContainerPath, "/")
			if cp == s.ContainerPath {
				covering = &vols[i]
				break
			}
			if strings.HasPrefix(s.ContainerPath, cp+"/") {
				parentCovered = true
			}
		}
		switch {
		case covering != nil && covering.Kind == "volume":
			// Named rows are populated at creation time (auto flow below or
			// the volumes endpoint), so a covered path needs nothing.
			continue
		case covering != nil:
			// Exact bind volume exists — but when its host folder is still
			// empty (e.g. the user clicked "Add volume" and hasn't applied
			// yet), the live container content must still be migrated into
			// it. A non-empty folder is never touched: it already holds the
			// truth and copying over it could destroy real data.
			hostDir := services.HostProjectVolumeDir(projectID, covering.HostPath)
			if entries, err := os.ReadDir(hostDir); err != nil || len(entries) > 0 {
				continue
			}
			items = append(items, item{suggestion: s, hostPath: covering.HostPath, needRow: false})
		case parentCovered:
			continue
		default:
			items = append(items, item{suggestion: s, needRow: true})
		}
	}
	if len(items) == 0 {
		return
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].suggestion.ContainerPath < items[j].suggestion.ContainerPath
	})

	stopped := false
	for _, it := range items {
		s := it.suggestion
		if it.needRow {
			ensureNamedStateVolume(projectID, s, targets, stop, &stopped, log)
			continue
		}
		// Bind refresh: migrate into the existing (empty) host folder.
		hostDir, err := services.EnsureProjectVolumeDir(projectID, it.hostPath)
		if err != nil {
			log("warn", fmt.Sprintf("Could not prepare AppData folder %s: %s", it.hostPath, err.Error()))
			continue
		}
		if container, _ := migrationContainerImage(s, targets); container != "" {
			if stop != nil && !stopped {
				stop()
				stopped = true
			}
			if err := services.CopyFromContainer(container, s.ContainerPath, hostDir); err == nil {
				if entries, rerr := os.ReadDir(hostDir); rerr == nil && len(entries) > 0 {
					log("info", fmt.Sprintf("Migrated existing data from %s into %s — it now survives recreates", s.ContainerPath, it.hostPath))
				} else {
					log("info", fmt.Sprintf("No data found in %s — volume %s prepared empty", s.ContainerPath, it.hostPath))
				}
			} else {
				log("info", fmt.Sprintf("Nothing to migrate from %s (%s)", s.ContainerPath, err.Error()))
			}
		}
	}
}

// ensureNamedStateVolume creates a Docker named volume for a suggested state
// dir, migrates live container content into it when present, and stores the
// row so the upcoming Run/Up mounts it in the same operation.
func ensureNamedStateVolume(projectID int64, s services.StateDirSuggestion, targets []stateMigrateTarget, stop func(), stopped *bool, log func(string, string)) {
	name := s.HostSubdir
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	var dup bool
	if err := db.DB.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM project_volumes WHERE project_id = ? AND container_path = ?)",
		projectID, s.ContainerPath,
	).Scan(&dup); err == nil && dup {
		return
	}
	volName := services.UniqueVolumeName(projectID, name)
	if err := services.EnsureNamedVolume(volName); err != nil {
		log("warn", fmt.Sprintf("Could not create Docker volume for %s: %s", s.ContainerPath, err.Error()))
		return
	}
	migrated := false
	if container, image := migrationContainerImage(s, targets); container != "" && image != "" {
		if stop != nil && stopped != nil && !*stopped {
			stop()
			*stopped = true
		}
		if tmp, err := os.MkdirTemp("", "nineteen-migrate-*"); err == nil {
			if cerr := services.CopyFromContainer(container, s.ContainerPath, tmp); cerr == nil {
				if entries, rerr := os.ReadDir(tmp); rerr == nil && len(entries) > 0 {
					migrated = services.PopulateNamedVolume(volName, image, tmp) == nil
				}
			}
			os.RemoveAll(tmp)
		}
	}
	if _, err := db.DB.Exec(
		"INSERT INTO project_volumes (project_id, name, host_path, container_path, kind, volume_name) VALUES (?, ?, '', ?, 'volume', ?)",
		projectID, name, s.ContainerPath, volName,
	); err != nil {
		log("warn", fmt.Sprintf("Could not save AppData volume for %s: %s", s.ContainerPath, err.Error()))
		return
	}
	if migrated {
		log("info", fmt.Sprintf("Migrated existing data from %s into Docker volume %s — it now survives recreates", s.ContainerPath, volName))
	} else {
		log("info", fmt.Sprintf("Added persistent Docker volume %s → %s (%s)", volName, s.ContainerPath, s.Reason))
	}
}

// migrationContainerImage finds a container whose image declares the
// suggestion's path (curated or image-declared VOLUMEs), returning the
// container and image for copy-out and holder use.
func migrationContainerImage(s services.StateDirSuggestion, targets []stateMigrateTarget) (string, string) {
	for _, t := range targets {
		if t.Container == "" || t.Image == "" {
			continue
		}
		for _, cand := range services.AllStateSuggestions([]string{t.Image}) {
			if cand.ContainerPath == s.ContainerPath {
				return t.Container, t.Image
			}
		}
	}
	return "", ""
}

var composeImageRe = regexp.MustCompile(`(?m)^\s*image\s*:\s*["']?(\S+?)["']?\s*(?:#.*)?$`)

// composeServiceImages extracts the `image:` references from a compose file
// on disk, so fresh stacks (no running containers yet) still get state-dir
// suggestions. Best-effort: unparseable files yield nothing.
func composeServiceImages(dir, composeFile string) []string {
	rel := strings.TrimSpace(filepath.ToSlash(composeFile))
	if rel == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(rel, "/"))))
	if err != nil || len(raw) == 0 || len(raw) > 1<<20 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, m := range composeImageRe.FindAllStringSubmatch(string(raw), -1) {
		img := strings.Trim(m[1], `"'`)
		if img == "" || seen[img] {
			continue
		}
		seen[img] = true
		out = append(out, img)
	}
	return out
}

// stateDirStatus is one known state directory for the project's image with
// whether a volume already covers it.
type stateDirStatus struct {
	ContainerPath string `json:"container_path"`
	HostSubdir    string `json:"host_subdir"`
	Reason        string `json:"reason"`
	Covered       bool   `json:"covered"`
}

type envSyncResponse struct {
	Running      bool             `json:"running"`
	InSync       bool             `json:"in_sync"`
	MissingKeys  []string         `json:"missing_keys"`
	StateDirs    []stateDirStatus `json:"state_dirs"`
}

// ProjectEnvSyncHandler reports whether the running container matches the
// saved configuration: env vars whose saved value differs from (or is absent
// in) the container, and known state directories not covered by any volume.
// Only keys and paths are returned, never secret values.
func ProjectEnvSyncHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	id, ok := pathID(r)
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid project ID")
		return
	}
	project, err := getProjectForUser(claims.UserID, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "Project not found")
		return
	}

	container := services.ResolveContainer(project.ID, project.Slug, project.BuildStrategy)
	running := container != "" && services.NewDeployer().ContainerState(container) == "running"

	containerEnv := map[string]string{}
	var containerImage string
	if container != "" {
		if cfg := services.InspectContainerConfig(container); cfg != nil {
			containerEnv = cfg.Env
			containerImage = cfg.Image
		}
	}

	missing := []string{}
	if vars, verr := services.LoadEnvVars(project.ID); verr == nil {
		for _, v := range vars {
			if strings.TrimSpace(v.Value) == "" {
				continue
			}
			if cur, ok := containerEnv[v.Key]; !ok || cur != v.Value {
				missing = append(missing, v.Key)
			}
		}
	}

	// Candidate images for state-dir suggestions: the running container, the
	// project's image reference, and (compose) every service image. Curated
	// entries merge with each image's declared VOLUMEs, so most apps need no
	// per-app mapping at all.
	images := []string{containerImage, project.Image}
	if project.BuildStrategy == "compose" {
		for _, p := range services.NewDeployer().ComposePorts(services.ProjectComposeName(project.ID, project.Slug)) {
			images = append(images, p.Image)
		}
	}
	suggestions := map[string]services.StateDirSuggestion{}
	for _, s := range services.AllStateSuggestions(images) {
		suggestions[s.ContainerPath] = s
	}
	vols, _ := loadProjectVolumes(project.ID)
	stateDirs := []stateDirStatus{}
	for _, s := range suggestions {
		covered := false
		for _, v := range vols {
			cp := strings.TrimSuffix(v.ContainerPath, "/")
			if cp == s.ContainerPath || strings.HasPrefix(s.ContainerPath, cp+"/") {
				covered = true
				break
			}
		}
		stateDirs = append(stateDirs, stateDirStatus{
			ContainerPath: s.ContainerPath,
			HostSubdir:    s.HostSubdir,
			Reason:        s.Reason,
			Covered:       covered,
		})
	}
	if stateDirs == nil {
		stateDirs = []stateDirStatus{}
	}
	if missing == nil {
		missing = []string{}
	}

	respondJSON(w, http.StatusOK, envSyncResponse{
		Running:     running,
		InSync:      running && len(missing) == 0,
		MissingKeys: missing,
		StateDirs:   stateDirs,
	})
}
