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
	Branch        string    `json:"branch"`
	Domain        string    `json:"domain"`
	Description   string    `json:"description"`
	AutoDeploy    bool      `json:"auto_deploy"`
	Region        string    `json:"region"`
	InstanceType  string    `json:"instance_type"`
	BuildStrategy string    `json:"build_strategy"`
	DockerfilePath string   `json:"dockerfile_path"`
	ComposePath   string    `json:"compose_path"`
	LastDeployedAt *string  `json:"last_deployed_at"`
	CreatedDate   string    `json:"created_date"`
	UpdatedDate   string    `json:"updated_date"`
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
