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
	mux.HandleFunc("/api/projects/{id}/buildfile", handlers.ProjectBuildFileHandler)
	mux.HandleFunc("/api/projects/{id}/env-vars/{varId}", handlers.ProjectEnvVarHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs", handlers.ProjectRuntimeLogsHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs/stream", handlers.ProjectRuntimeLogsStreamHandler)
	mux.HandleFunc("/api/deployments", handlers.DeploymentsHandler)
	mux.HandleFunc("/api/deployments/{id}", handlers.DeploymentHandler)
	mux.HandleFunc("/api/deployments/{id}/logs", handlers.DeploymentLogsHandler)
	mux.HandleFunc("/api/deployments/{id}/cancel", handlers.CancelDeploymentHandler)
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
		Handler: corsMiddleware(mux),
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
