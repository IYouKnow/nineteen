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
	"nineteen-server/auth"
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

// viewerGuard blocks mutating requests from read-only (viewer) accounts. The
// role is read from the database so a stale token cannot retain write access.
// Unauthenticated/self-service and webhook endpoints are exempt; handlers still
// enforce their own auth.
func viewerGuard(next http.Handler) http.Handler {
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

		claims, err := handlers.AuthFromRequest(r)
		if err != nil {
			// No token: let the handler return its own 401.
			next.ServeHTTP(w, r)
			return
		}
		if !auth.CanWrite(handlers.CurrentUserRole(claims.UserID)) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"Your account is read-only"}`))
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
	mux.HandleFunc("/api/admin/users", handlers.AdminUsersHandler)
	mux.HandleFunc("/api/admin/users/{id}", handlers.AdminUserHandler)
	mux.HandleFunc("/api/admin/invites", handlers.AdminInvitesHandler)
	mux.HandleFunc("/api/admin/invites/{id}", handlers.AdminInviteHandler)
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
		Handler: corsMiddleware(auditMiddleware(viewerGuard(mux))),
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
