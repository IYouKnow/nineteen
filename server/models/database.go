package models

// Database is a provisioned database resource. It is a first-class
// infrastructure resource, independent of projects, and can be connected to
// one or more projects via DatabaseConnection.
type Database struct {
	ID          int64  `json:"id"`
	UserID      int64  `json:"user_id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Type        string `json:"type"`
	Version     string `json:"version"`
	Status      string `json:"status"`
	Region      string `json:"region"`
	InstanceSize string `json:"instance_size"`
	Host        string `json:"host"`
	Port        *int   `json:"port"`
	HostPort    *int   `json:"host_port,omitempty"`
	DatabaseName string `json:"database_name"`
	Username    string `json:"username"`
	Description string `json:"description"`
	CreatedDate string `json:"created_date"`
	UpdatedDate string `json:"updated_date"`
	// Password holds the plaintext value; never marshaled to JSON.
	Password string `json:"-"`
	// PasswordEncrypted holds the ciphertext at rest; never marshaled to JSON.
	PasswordEncrypted string `json:"-"`
}

// DatabaseConnection links a database to a project.
type DatabaseConnection struct {
	ID           int64  `json:"id"`
	UserID       int64  `json:"user_id"`
	DatabaseID   int64  `json:"database_id"`
	ProjectID    int64  `json:"project_id"`
	DatabaseName string `json:"database_name"`
	DatabaseType string `json:"database_type"`
	ProjectName  string `json:"project_name"`
	Scope        string `json:"scope"`
	SelectedTables string `json:"selected_tables"`
	Role         string `json:"role"`
	CreatedDate  string `json:"created_date"`
}
