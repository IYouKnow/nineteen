package models

// ProjectTrigger is one deployment rule for a project. A project may have any
// number of them (see the project_triggers table); zero rows means deployments
// are manual only.
type ProjectTrigger struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	Strategy   string `json:"strategy"`
	Branch     string `json:"branch"`
	TagMode    string `json:"tag_mode"`
	TagPattern string `json:"tag_pattern"`
	PreRelease bool   `json:"pre_release"`
	Enabled    bool   `json:"enabled"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// ProjectWebhook is the single GitHub webhook shared by all of a project's
// triggers. It lives at the project level so adding or removing rules does not
// churn repository hooks.
type ProjectWebhook struct {
	ProjectID int64  `json:"project_id"`
	WebhookID *int64 `json:"webhook_id"`
	// WebhookSecret is the HMAC secret shared with GitHub; never marshaled.
	WebhookSecret string `json:"-"`
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
	TriggerID    *int64 `json:"trigger_id"`
	CreatedAt    string `json:"created_at"`
}
