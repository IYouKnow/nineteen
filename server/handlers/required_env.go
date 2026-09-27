package handlers

import (
	"net/http"
	"strings"

	"nineteen-server/services"
)

// requiredEnvResponse tells the deploy dialog which env vars the repository
// expects and which of them have no saved value yet, so the user can fill them
// in before deploying instead of guessing or digging through the repo.
type requiredEnvResponse struct {
	Required []services.RequiredEnvVar `json:"required"`
	Missing  []services.RequiredEnvVar `json:"missing"`
	Ref      string                    `json:"ref"`
}

// ProjectRequiredEnvHandler returns the env vars a project's repository
// expects at a given ref, plus the subset missing from the project's saved
// env vars. Image projects (no repository) return empty lists.
func ProjectRequiredEnvHandler(w http.ResponseWriter, r *http.Request) {
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
	if strings.TrimSpace(project.Repository) == "" || project.BuildStrategy == "image" {
		respondJSON(w, http.StatusOK, requiredEnvResponse{
			Required: []services.RequiredEnvVar{},
			Missing:  []services.RequiredEnvVar{},
		})
		return
	}

	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	if ref == "" {
		ref = project.Branch
		if project.DeployType == "release" && strings.TrimSpace(project.DeployRef) != "" {
			ref = strings.TrimSpace(project.DeployRef)
		}
	}
	if ref == "" {
		ref = "main"
	}

	required := []services.RequiredEnvVar{}
	if client, cerr := projectRepoReadClient(project); cerr == nil {
		if files, _, ferr := client.GetRepoTree(project.Repository, ref); ferr == nil {
			var firstDockerfile []byte
			if dfs := services.RankDockerfiles(files); len(dfs) > 0 {
				firstDockerfile, _ = client.GetRepoFile(project.Repository, ref, dfs[0])
			}
			var composeFiles []string
			if cfs := services.RankComposeFiles(files); len(cfs) > 0 {
				composeFiles = cfs[:1]
			}
			required = scanRequiredEnv(client, project.Repository, ref, files, firstDockerfile, composeFiles)
		}
	}
	if required == nil {
		required = []services.RequiredEnvVar{}
	}

	have := map[string]string{}
	if vars, verr := services.LoadEnvVars(project.ID); verr == nil {
		for _, v := range vars {
			if strings.TrimSpace(v.Value) != "" {
				have[v.Key] = v.Value
			}
		}
	}
	missing := services.MissingRequiredEnv(required, have)

	respondJSON(w, http.StatusOK, requiredEnvResponse{Required: required, Missing: missing, Ref: ref})
}
