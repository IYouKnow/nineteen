package models

import "time"

type Project struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"user_id"`
	Name          string    `json:"name"`
	Slug          string    `json:"slug"`
	Status        string    `json:"status"`
	Framework     string    `json:"framework"`
	Repository    string    `json:"repository"`
	// Image is the prebuilt container image reference (e.g. "nginx:1.27") for
	// projects whose build strategy is "image". Empty for source-built projects.
	Image         string    `json:"image"`
	Branch        string    `json:"branch"`
	Provider      string    `json:"provider"`
	IntegrationID *int64    `json:"integration_id"`
	Domain        string    `json:"domain"`
	Description   string    `json:"description"`
	AutoDeploy    bool      `json:"auto_deploy"`
	Region        string    `json:"region"`
	InstanceType  string    `json:"instance_type"`
	BuildStrategy string    `json:"build_strategy"`
	DockerfilePath string   `json:"dockerfile_path"`
	ComposePath   string    `json:"compose_path"`
	// BuildContext is the repo-relative directory used as the Docker build
	// context. Empty means "auto": the Dockerfile's own directory.
	BuildContext  string    `json:"build_context"`
	DeployType    string    `json:"deploy_type"`
	DeployRef     string    `json:"deploy_ref"`
	Port          *int      `json:"port"`
	// RestartPolicy is the Docker restart policy applied to the project's
	// container(s): "no", "always", "unless-stopped" or "on-failure".
	// RestartRetries is the optional max-retry count for "on-failure" only.
	RestartPolicy  string `json:"restart_policy"`
	RestartRetries *int   `json:"restart_retries"`
	// WorkingDir is the container working directory passed to `docker run -w`
	// for image- and Dockerfile-based projects. Empty keeps the image's own
	// WORKDIR. Used by apps (e.g. code-server) that must open a specific path.
	WorkingDir string `json:"working_dir"`
	LastDeployedAt *string  `json:"last_deployed_at"`
	CreatedDate   string    `json:"created_date"`
	UpdatedDate   string    `json:"updated_date"`

	// Access is the caller's effective role on this project: "owner",
	// "manager", "editor" or "viewer". IsOwner is true only for the creator.
	// Neither is stored; they are resolved per request.
	Access  string `json:"access,omitempty"`
	IsOwner bool   `json:"is_owner"`
}

// ProjectMember is a user's shared access to a project. The owner is not
// stored here — ownership is implicit via Project.UserID.
type ProjectMember struct {
	UserID      int64  `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	AddedBy     int64  `json:"added_by"`
	CreatedAt   string `json:"created_at"`
}

// ProjectVolume maps a folder inside a project's persistent directory to a path
// inside the running container. The host folder always lives under the
// project's data directory; HostDir is the resolved absolute host path.
// Automatic marks server-side mounts (e.g. the Docker socket for runner
// images) that are applied on every deploy without user input. They are
// computed, never stored, and must be rendered read-only.
type ProjectVolume struct {
	ID            int64  `json:"id"`
	ProjectID     int64  `json:"project_id"`
	Name          string `json:"name"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path"`
	HostDir       string `json:"host_dir,omitempty"`
	Automatic     bool   `json:"automatic,omitempty"`
	CreatedDate   string `json:"created_date"`
	UpdatedDate   string `json:"updated_date"`
}

// ProjectPort is a container port published on the host for a project. HostPort
// is optional: when nil (or 0) a free host port is assigned at deploy time.
// Exactly one mapping is primary — its host port backs the project's URL.
type ProjectPort struct {
	ID            int64  `json:"id"`
	ProjectID     int64  `json:"project_id"`
	ContainerPort int    `json:"container_port"`
	HostPort      *int   `json:"host_port"`
	Protocol      string `json:"protocol"`
	Label         string `json:"label"`
	IsPrimary     bool   `json:"is_primary"`
	CreatedDate   string `json:"created_date"`
	UpdatedDate   string `json:"updated_date"`
}

type Deployment struct {
	ID           int64  `json:"id"`
	UserID       int64  `json:"user_id"`
	ProjectID    int64  `json:"project_id"`
	ProjectName  string `json:"project_name"`
	Status       string `json:"status"`
	CommitSHA    string `json:"commit_sha"`
	CommitMessage string `json:"commit_message"`
	Branch       string `json:"branch"`
	Author       string `json:"author"`
	Trigger      string `json:"trigger"`
	Framework    string `json:"framework"`
	Duration     int64  `json:"duration"`
	Port         *int   `json:"port"`
	URL          string `json:"url"`
	// DeploySource records how the ref was chosen for this deployment:
	// "default" (project target), "branch", "tag" or "commit". DeployRef is the
	// exact ref requested (a branch/tag name or commit SHA); it is empty for
	// "default" deploys.
	DeploySource string `json:"deploy_source"`
	DeployRef    string `json:"deploy_ref"`
	CreatedDate  string `json:"created_date"`
	UpdatedDate  string `json:"updated_date"`
}

type DeploymentLog struct {
	ID           int64     `json:"id"`
	DeploymentID int64     `json:"deployment_id"`
	Timestamp    time.Time `json:"timestamp"`
	Level        string    `json:"level"`
	Message      string    `json:"message"`
}

type RuntimeLog struct {
	ID           int64     `json:"id"`
	ProjectID    int64     `json:"project_id"`
	DeploymentID int64     `json:"deployment_id"`
	Container    string    `json:"container"`
	Level        string    `json:"level"`
	Message      string    `json:"message"`
	Timestamp    time.Time `json:"timestamp"`
}

// EnvVar is a project environment variable. Value holds a plaintext value only
// for non-secret vars; for secrets it is empty and HasValue reports presence so
// the UI can render it as write-only.
type EnvVar struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	HasValue  bool   `json:"has_value"`
	IsSecret  bool   `json:"is_secret"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	// Encrypted holds the ciphertext at rest; never marshaled to JSON.
	Encrypted string `json:"-"`
}
