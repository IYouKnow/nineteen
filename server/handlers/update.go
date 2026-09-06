package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"nineteen-server/db"
	"nineteen-server/services"
)

// UpdateSvc is set from main() once the runtime version is known.
var UpdateSvc *services.UpdateService

// UpdateHandler routes the self-update control plane. Any authenticated user may
// read the status ("check for updates"); only the instance owner may trigger an
// update.
func UpdateHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	switch r.Method {
	case http.MethodGet:
		getUpdateHandler(w, claims)
	case http.MethodPost:
		if !isOwner(claims.UserID) {
			respondError(w, http.StatusForbidden, "Only the instance owner can update Nineteen")
			return
		}
		postUpdateHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func getUpdateHandler(w http.ResponseWriter, claims *Claims) {
	if UpdateSvc == nil {
		respondError(w, http.StatusInternalServerError, "Update service not initialized")
		return
	}
	st, err := UpdateSvc.CheckForUpdate()
	st.IsOwner = isOwner(claims.UserID)
	if err != nil {
		// Report the status anyway so the UI can show the error message.
		respondJSON(w, http.StatusOK, st)
		return
	}
	respondJSON(w, http.StatusOK, st)
}

func postUpdateHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Version string `json:"version"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.Version = strings.TrimSpace(req.Version)

	if err := UpdateSvc.StartUpdate(req.Version); err != nil {
		respondError(w, http.StatusConflict, err.Error())
		return
	}
	respondJSON(w, http.StatusAccepted, UpdateSvc.GetState())
}

// UpdateStatusHandler polls the persisted update state.
func UpdateStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	st := UpdateSvc.GetState()
	st.IsOwner = isOwner(claims.UserID)
	respondJSON(w, http.StatusOK, st)
}

// UpdateRollbackHandler manually rolls back to the previous image.
func UpdateRollbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if !isOwner(claims.UserID) {
		respondError(w, http.StatusForbidden, "Only the instance owner can roll back")
		return
	}
	if err := UpdateSvc.Rollback(); err != nil {
		respondError(w, http.StatusConflict, err.Error())
		return
	}
	respondJSON(w, http.StatusAccepted, map[string]string{"message": "Rollback started"})
}

// UpdateLogsHandler returns the persisted update log lines.
func UpdateLogsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := extractUser(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	respondJSON(w, http.StatusOK, UpdateSvc.ReadLogs())
}

// UpdateLogsStreamHandler streams the update log over SSE (live tail of the
// persisted log file). Auth is accepted via the Authorization header or a
// `token` query param, since EventSource cannot set headers.
func UpdateLogsStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if _, err := authFromRequest(r); err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	fl, ok := w.(http.Flusher)
	if !ok {
		respondError(w, http.StatusInternalServerError, "Streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	writeSSE(w, fl, map[string]interface{}{"connected": true})

	path := UpdateSvc.LogFile
	var offset int64
	var pending string
	ctx := r.Context()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fi, err := os.Stat(path)
			if err != nil {
				continue
			}
			size := fi.Size()
			if size <= offset {
				continue
			}
			f, err := os.Open(path)
			if err != nil {
				continue
			}
			buf := make([]byte, size-offset)
			n, _ := io.ReadFull(f, buf)
			f.Close()
			offset += int64(n)
			pending += string(buf[:n])
			for {
				idx := strings.IndexByte(pending, '\n')
				if idx < 0 {
					break
				}
				line := pending[:idx]
				pending = pending[idx+1:]
				if strings.TrimSpace(line) != "" {
					writeSSE(w, fl, map[string]string{"line": line})
				}
			}
		}
	}
}

// isOwner reports whether the given user is the first registered user (the
// instance owner / admin).
func isOwner(userID int64) bool {
	var first int64
	err := db.DB.QueryRow("SELECT id FROM users ORDER BY id ASC LIMIT 1").Scan(&first)
	return err == nil && first == userID
}
