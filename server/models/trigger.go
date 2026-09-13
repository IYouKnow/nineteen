package models

// ProjectTrigger is the deployment strategy configuration for a project. One
// row exists per project (see the project_triggers table).
type ProjectTrigger struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	Strategy   string `json:"strategy"`
	Branch     string `json:"branch"`
	TagMode    string `json:"tag_mode"`
	TagPattern string `json:"tag_pattern"`
	PreRelease bool   `json:"pre_release"`
	Enabled    bool   `json:"enabled"`
	WebhookID  *int64 `json:"webhook_id"`
	// WebhookSecret is the HMAC secret shared with GitHub; never marshaled.
	WebhookSecret string `json:"-"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

// DeployEvent is an audit record of every trigger event a project received,
// whether or not it started a deployment.
type DeployEvent struct {
	ID           int64  `json:"id"`
	ProjectID    int64  `json:"project_id"`
	EventType    string `json:"event_type"`
	Ref          string `json:"ref"`
	SHA          string `json:"sha"`
	Matched      bool   `json:"matched"`
	Reason       string `json:"reason"`
	Source       string `json:"source"`
	DeploymentID *int64 `json:"deployment_id"`
	CreatedAt    string `json:"created_at"`
}
