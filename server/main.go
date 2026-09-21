package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/joho/godotenv"
	"nineteen-server/db"
	"nineteen-server/handlers"
	"nineteen-server/services"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// isReadMethod reports whether an HTTP method is a safe read.
func isReadMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead
}

// requiredPermission maps a request to the permission it needs. ok=false means
// no specific permission is required (public endpoints or handlers that enforce
// their own rules).
func requiredPermission(method, path string) (string, bool) {
	if !strings.HasPrefix(path, "/api/") {
		return "", false
	}
	seg := strings.Split(strings.Trim(path, "/"), "/")
	if len(seg) < 2 {
		return "", false
	}
	switch seg[1] {
	case "auth", "webhooks", "health", "permissions":
		return "", false
	case "admin":
		return adminRoutePermission(method, seg[2:])
	case "settings":
		return settingsRoutePermission(method, seg[2:])
	case "projects":
		return projectRoutePermission(method, seg[2:])
	case "deployments":
		if len(seg) >= 4 && seg[3] == "cancel" {
			return "projects.deploy", true
		}
		return "projects.read", true
	case "databases":
		return databaseRoutePermission(method, seg[2:])
	case "database-connections":
		return "databases.connections.read", true
	case "update":
		if len(seg) >= 3 && seg[2] == "rollback" {
			return "updates.run", true
		}
		if isReadMethod(method) {
			return "updates.read", true
		}
		return "updates.run", true
	}
	return "", false
}

func adminRoutePermission(method string, seg []string) (string, bool) {
	if len(seg) == 0 {
		return "", false
	}
	read := isReadMethod(method)
	switch seg[0] {
	case "users":
		if read {
			return "admin.users.read", true
		}
		return "admin.users.manage", true
	case "invites":
		if read {
			return "admin.invites.read", true
		}
		return "admin.invites.manage", true
	case "roles":
		if read {
			return "admin.roles.read", true
		}
		return "admin.roles.manage", true
	case "audit":
		return "admin.audit.read", true
	case "system":
		return "admin.system.read", true
	case "resources":
		if read {
			return "admin.resources.read", true
		}
		return "admin.resources.manage", true
	case "projects", "databases":
		return "admin.resources.manage", true
	}
	return "", false
}

func settingsRoutePermission(method string, seg []string) (string, bool) {
	read := isReadMethod(method)
	if len(seg) == 0 {
		if read {
			return "settings.read", true
		}
		return "settings.update", true
	}
	switch seg[0] {
	case "api-keys":
		if read {
			return "settings.apikeys.read", true
		}
		return "settings.apikeys.manage", true
	case "integrations":
		if read {
			return "settings.integrations.read", true
		}
		return "settings.integrations.manage", true
	}
	if read {
		return "settings.read", true
	}
	return "settings.update", true
}

func projectRoutePermission(method string, seg []string) (string, bool) {
	read := isReadMethod(method)
	if len(seg) == 0 {
		if read {
			return "projects.read", true
		}
		return "projects.create", true
	}
	if len(seg) == 1 {
		switch method {
		case http.MethodPut:
			return "projects.update", true
		case http.MethodDelete:
			return "projects.delete", true
		default:
			return "projects.read", true
		}
	}

	switch seg[1] {
	case "resources":
		return "projects.read", true
	case "deployments":
		if read {
			return "projects.read", true
		}
		return "projects.deploy", true
	case "actions":
		return "projects.deploy", true
	case "env-vars":
		if read {
			return "projects.env.read", true
		}
		return "projects.env.manage", true
	case "files", "container-files":
		if read {
			return "projects.files.read", true
		}
		return "projects.files.manage", true
	case "volumes":
		if read {
			return "projects.volumes.read", true
		}
		return "projects.volumes.manage", true
	case "buildfile":
		if read {
			return "projects.buildfile.read", true
		}
		return "projects.buildfile.manage", true
	case "triggers", "events":
		if read {
			return "projects.triggers.read", true
		}
		return "projects.triggers.manage", true
	case "runtime-logs":
		return "projects.runtime.read", true
	}
	return "projects.read", true
}

func databaseRoutePermission(method string, seg []string) (string, bool) {
	read := isReadMethod(method)
	if len(seg) == 0 {
		if read {
			return "databases.read", true
		}
		return "databases.create", true
	}
	if len(seg) >= 2 {
		switch seg[1] {
		case "actions":
			return "databases.update", true
		case "connections":
			if read {
				return "databases.connections.read", true
			}
			return "databases.connections.manage", true
		}
	}
	switch method {
	case http.MethodPut:
		return "databases.update", true
	case http.MethodDelete:
		return "databases.delete", true
	default:
		return "databases.read", true
	}
}

// permissionGuard rejects requests whose user lacks the required permission.
// The role's permissions are read live from the database so changes take effect
// immediately. Endpoints without a mapped permission are left to their handler.
func permissionGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		perm, ok := requiredPermission(r.Method, r.URL.Path)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}

		claims, err := handlers.AuthFromRequest(r)
		if err != nil {
			// No token: let the handler return its own 401.
			next.ServeHTTP(w, r)
			return
		}
		if !handlers.HasPermission(claims.UserID, perm) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"You don't have permission to do that"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// auditMiddleware records every mutating API request that isn't already logged
// with richer detail by the auth/admin handlers.
func auditMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}

		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") ||
			strings.HasPrefix(p, "/api/auth/") ||
			strings.HasPrefix(p, "/api/admin/") ||
			strings.HasPrefix(p, "/api/webhooks/") {
			next.ServeHTTP(w, r)
			return
		}

		if claims, err := handlers.AuthFromRequest(r); err == nil {
			handlers.LogAudit(r, claims.UserID, claims.Username, "http."+r.Method, "path", p, "")
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	// The detached self-update helper runs this same binary with an
	// "update-helper" argument; it does the container swap and exits without
	// starting the server or touching the DB.
	if len(os.Args) > 1 && os.Args[1] == "update-helper" {
		services.RunUpdateHelper()
		os.Exit(0)
	}

	godotenv.Load("../.env")

	handlers.UpdateSvc = services.NewUpdateService(version)
	handlers.UpdateSvc.ReconcileOnStartup()

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/nineteen.db"
	}

	os.MkdirAll("./data", 0755)
	db.Init(dbPath)
	defer db.Close()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/has-users", handlers.HasUsersHandler)
	mux.HandleFunc("/api/auth/validate-invite", handlers.ValidateInviteHandler)
	mux.HandleFunc("/api/auth/register", handlers.RegisterHandler)
	mux.HandleFunc("/api/auth/login", handlers.LoginHandler)
	mux.HandleFunc("/api/auth/me", handlers.MeHandler)
	mux.HandleFunc("/api/auth/change-password", handlers.ChangePasswordHandler)
	mux.HandleFunc("/api/permissions", handlers.PermissionCatalogHandler)
	mux.HandleFunc("/api/admin/users", handlers.AdminUsersHandler)
	mux.HandleFunc("/api/admin/users/{id}", handlers.AdminUserHandler)
	mux.HandleFunc("/api/admin/invites", handlers.AdminInvitesHandler)
	mux.HandleFunc("/api/admin/invites/{id}", handlers.AdminInviteHandler)
	mux.HandleFunc("/api/admin/roles", handlers.AdminRolesHandler)
	mux.HandleFunc("/api/admin/roles/{id}", handlers.AdminRoleHandler)
	mux.HandleFunc("/api/admin/audit", handlers.AdminAuditHandler)
	mux.HandleFunc("/api/admin/system", handlers.AdminSystemHandler)
	mux.HandleFunc("/api/admin/resources", handlers.AdminResourcesHandler)
	mux.HandleFunc("/api/admin/projects/{id}", handlers.AdminProjectHandler)
	mux.HandleFunc("/api/admin/databases/{id}", handlers.AdminDatabaseHandler)
	mux.HandleFunc("/api/settings", handlers.SettingsHandler)
	mux.HandleFunc("/api/settings/api-keys", handlers.ApiKeysHandler)
	mux.HandleFunc("/api/settings/api-keys/", handlers.ApiKeyDeleteHandler)
	mux.HandleFunc("/api/settings/integrations", handlers.IntegrationsHandler)
	mux.HandleFunc("/api/settings/integrations/test", handlers.TestIntegrationHandler)
	mux.HandleFunc("/api/settings/integrations/repos", handlers.IntegrationReposHandler)
	mux.HandleFunc("/api/settings/integrations/scan", handlers.IntegrationScanHandler)
	mux.HandleFunc("/api/settings/integrations/port", handlers.IntegrationPortHandler)
	mux.HandleFunc("/api/settings/integrations/", handlers.UpdateIntegrationHandler)
	mux.HandleFunc("/api/projects", handlers.ProjectsHandler)
	mux.HandleFunc("/api/projects/{id}", handlers.ProjectHandler)
	mux.HandleFunc("/api/projects/{id}/resources", handlers.ProjectResourcesHandler)
	mux.HandleFunc("/api/projects/{id}/resources/stream", handlers.ProjectResourcesStreamHandler)
	mux.HandleFunc("/api/projects/{id}/deployments", handlers.ProjectDeploymentsHandler)
	mux.HandleFunc("/api/projects/{id}/actions", handlers.ProjectActionHandler)
	mux.HandleFunc("/api/projects/{id}/env-vars", handlers.ProjectEnvVarsHandler)
	mux.HandleFunc("/api/projects/{id}/files", handlers.ProjectFilesHandler)
	mux.HandleFunc("/api/projects/{id}/files/upload", handlers.ProjectFileUploadHandler)
	mux.HandleFunc("/api/projects/{id}/files/folder", handlers.ProjectFolderHandler)
	mux.HandleFunc("/api/projects/{id}/files/entry", handlers.ProjectFileEntryHandler)
	mux.HandleFunc("/api/projects/{id}/files/download", handlers.ProjectFileDownloadHandler)
	mux.HandleFunc("/api/projects/{id}/container-files", handlers.ProjectContainerFilesHandler)
	mux.HandleFunc("/api/projects/{id}/container-files/download", handlers.ProjectContainerFileDownloadHandler)
	mux.HandleFunc("/api/projects/{id}/volumes", handlers.ProjectVolumesHandler)
	mux.HandleFunc("/api/projects/{id}/volumes/{volumeId}", handlers.ProjectVolumeHandler)
	mux.HandleFunc("/api/projects/{id}/buildfile", handlers.ProjectBuildFileHandler)
	mux.HandleFunc("/api/projects/{id}/triggers", handlers.ProjectTriggersHandler)
	mux.HandleFunc("/api/projects/{id}/triggers/{triggerId}", handlers.ProjectTriggerItemHandler)
	mux.HandleFunc("/api/projects/{id}/events", handlers.ProjectEventsHandler)
	mux.HandleFunc("/api/projects/{id}/env-vars/{varId}", handlers.ProjectEnvVarHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs", handlers.ProjectRuntimeLogsHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs/stream", handlers.ProjectRuntimeLogsStreamHandler)
	mux.HandleFunc("/api/deployments", handlers.DeploymentsHandler)
	mux.HandleFunc("/api/deployments/{id}", handlers.DeploymentHandler)
	mux.HandleFunc("/api/deployments/{id}/logs", handlers.DeploymentLogsHandler)
	mux.HandleFunc("/api/deployments/{id}/cancel", handlers.CancelDeploymentHandler)
	mux.HandleFunc("/api/webhooks/github/{id}", handlers.GitHubWebhookHandler)
	mux.HandleFunc("/api/databases", handlers.DatabasesHandler)
	mux.HandleFunc("/api/databases/{id}", handlers.DatabaseHandler)
	mux.HandleFunc("/api/databases/{id}/actions", handlers.DatabaseActionHandler)
	mux.HandleFunc("/api/databases/{id}/connections", handlers.DatabaseConnectionsForHandler)
	mux.HandleFunc("/api/databases/{id}/connections/{connId}", handlers.DatabaseConnectionHandler)
	mux.HandleFunc("/api/database-connections", handlers.DatabaseConnectionsHandler)
	mux.HandleFunc("/api/update", handlers.UpdateHandler)
	mux.HandleFunc("/api/update/status", handlers.UpdateStatusHandler)
	mux.HandleFunc("/api/update/logs", handlers.UpdateLogsHandler)
	mux.HandleFunc("/api/update/logs/stream", handlers.UpdateLogsStreamHandler)
	mux.HandleFunc("/api/update/rollback", handlers.UpdateRollbackHandler)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./static"
	}
	log.Printf("Serving static assets from %q", staticDir)
	mux.Handle("/", spaStatic(staticDir))

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	server := &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(auditMiddleware(permissionGuard(mux))),
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		server.Close()
	}()

	log.Println("Nineteen server running on " + addr)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

// spaStatic serves the built frontend (static assets) and falls back to
// index.html for any extension-less path so client-side routes (e.g. /projects)
// work on refresh. Paths that look like files (have an extension) but don't
// exist return 404 instead of being rewritten.
func spaStatic(staticDir string) http.Handler {
	root := filepath.Clean(staticDir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(root, filepath.Clean("/"+r.URL.Path))
		if !strings.HasPrefix(full, root) {
			http.NotFound(w, r)
			return
		}
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		if filepath.Ext(r.URL.Path) == "" {
			http.ServeFile(w, r, filepath.Join(root, "index.html"))
			return
		}
		http.NotFound(w, r)
	})
}
