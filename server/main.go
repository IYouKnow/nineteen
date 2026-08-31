package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"nineteen-server/db"
	"nineteen-server/handlers"
)

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
	godotenv.Load("../.env")

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
	mux.HandleFunc("/api/settings/integrations/", handlers.UpdateIntegrationHandler)
	mux.HandleFunc("/api/projects", handlers.ProjectsHandler)
	mux.HandleFunc("/api/projects/{id}", handlers.ProjectHandler)
	mux.HandleFunc("/api/projects/{id}/deployments", handlers.ProjectDeploymentsHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs", handlers.ProjectRuntimeLogsHandler)
	mux.HandleFunc("/api/projects/{id}/runtime-logs/stream", handlers.ProjectRuntimeLogsStreamHandler)
	mux.HandleFunc("/api/deployments", handlers.DeploymentsHandler)
	mux.HandleFunc("/api/deployments/{id}", handlers.DeploymentHandler)
	mux.HandleFunc("/api/deployments/{id}/logs", handlers.DeploymentLogsHandler)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

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
