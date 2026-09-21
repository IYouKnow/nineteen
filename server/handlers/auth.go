package handlers

import (
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nineteen-server/auth"
	"nineteen-server/db"
	"nineteen-server/models"
	"nineteen-server/permissions"
)

type RegisterRequest struct {
	InviteCode  string `json:"invite_code"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type AuthResponse struct {
	User        *models.User `json:"user"`
	Token       string       `json:"token"`
	Permissions []string     `json:"permissions"`
	IsSuperuser bool         `json:"is_superuser"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

// meResponse is the current user plus their resolved access, used by /me.
type meResponse struct {
	models.User
	Permissions []string `json:"permissions"`
	IsSuperuser bool     `json:"is_superuser"`
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, ErrorResponse{Error: msg})
}

func extractUser(r *http.Request) (*Claims, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		return nil, sql.ErrNoRows
	}
	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	return auth.ValidateToken(tokenString)
}

type Claims = auth.Claims

// clientIP returns the best-effort originating IP for audit records, honouring
// a reverse proxy's X-Forwarded-For when present.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// logAudit records a single audit entry. Failures are intentionally ignored so
// auditing can never break the request it is describing.
func logAudit(r *http.Request, userID int64, username, action, targetType, targetID, details string) {
	db.DB.Exec(
		`INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, username, action, targetType, targetID, details, clientIP(r),
	)
}

// isSuperuser reports whether the user's role is the all-powerful superuser.
func isSuperuser(userID int64) bool {
	var super bool
	db.DB.QueryRow(
		`SELECT r.is_superuser FROM users u JOIN roles r ON r.name = u.role WHERE u.id = ?`, userID,
	).Scan(&super)
	return super
}

// rolePermissions resolves a user's effective permissions from their role.
// Superusers get the global wildcard.
func rolePermissions(userID int64) []string {
	var roleID int64
	var super bool
	err := db.DB.QueryRow(
		`SELECT r.id, r.is_superuser FROM users u JOIN roles r ON r.name = u.role WHERE u.id = ?`, userID,
	).Scan(&roleID, &super)
	if err != nil {
		return nil
	}
	if super {
		return []string{"*"}
	}

	rows, err := db.DB.Query("SELECT permission FROM role_permissions WHERE role_id = ?", roleID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var perms []string
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	return perms
}

// hasPermission reports whether a user is granted a permission (directly, via a
// wildcard, or as a superuser).
func hasPermission(userID int64, perm string) bool {
	return permissions.Allows(rolePermissions(userID), perm)
}

// requirePermission extracts the caller and confirms they hold perm, writing an
// error response and returning ok=false otherwise.
func requirePermission(w http.ResponseWriter, r *http.Request, perm string) (*Claims, bool) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return nil, false
	}
	if !hasPermission(claims.UserID, perm) {
		respondError(w, http.StatusForbidden, "You don't have permission to do that")
		return nil, false
	}
	return claims, true
}

// activeAdminCount returns how many enabled superusers remain.
func activeAdminCount() int {
	var n int
	db.DB.QueryRow(
		`SELECT COUNT(*) FROM users u JOIN roles r ON r.name = u.role
		 WHERE r.is_superuser = TRUE AND u.status = 'active'`,
	).Scan(&n)
	return n
}

// AuthFromRequest exposes token extraction to the server's middleware.
func AuthFromRequest(r *http.Request) (*Claims, error) { return extractUser(r) }

// HasPermission exposes permission checks to the server's middleware.
func HasPermission(userID int64, perm string) bool { return hasPermission(userID, perm) }

// LogAudit exposes audit logging to the server's middleware.
func LogAudit(r *http.Request, userID int64, username, action, targetType, targetID, details string) {
	logAudit(r, userID, username, action, targetType, targetID, details)
}

func HasUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var count int
	err := db.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]bool{"has_users": count > 0})
}

func ValidateInviteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Code = strings.TrimSpace(req.Code)
	if req.Code == "" {
		respondError(w, http.StatusBadRequest, "Invite code is required")
		return
	}

	info, errMsg := validateInvite(req.Code)
	if errMsg != "" {
		status := http.StatusForbidden
		if errMsg == "Database error" {
			status = http.StatusInternalServerError
		}
		respondError(w, status, errMsg)
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"valid": true, "role": info.Role})
}

// inviteInfo is the subset of an invite code the registration flow needs.
type inviteInfo struct {
	ID      int64
	Role    string
	MaxUses int
	Uses    int
}

// validateInvite resolves a usable invite code, returning a human-readable
// reason when the code is missing, revoked, exhausted or expired.
func validateInvite(code string) (inviteInfo, string) {
	var info inviteInfo
	var used, revoked bool
	var expiresAt sql.NullString
	err := db.DB.QueryRow(
		`SELECT id, used, revoked, expires_at, max_uses, uses, role FROM invite_codes WHERE code = ?`,
		code,
	).Scan(&info.ID, &used, &revoked, &expiresAt, &info.MaxUses, &info.Uses, &info.Role)
	if err == sql.ErrNoRows {
		return info, "Invalid invite code"
	}
	if err != nil {
		return info, "Database error"
	}
	if revoked {
		return info, "Invite code has been revoked"
	}
	if used || (info.MaxUses > 0 && info.Uses >= info.MaxUses) {
		return info, "Invite code has already been used"
	}
	if expiresAt.Valid && expiresAt.String != "" {
		for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
			if t, perr := time.Parse(layout, expiresAt.String); perr == nil {
				if time.Now().After(t) {
					return info, "Invite code has expired"
				}
				break
			}
		}
	}
	if info.Role == "" {
		info.Role = defaultRoleName()
	}
	return info, ""
}

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.InviteCode = strings.TrimSpace(req.InviteCode)
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	if req.InviteCode == "" || req.Username == "" || req.Email == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "invite_code, username, email, and password are required")
		return
	}

	if len(req.Password) < 6 {
		respondError(w, http.StatusBadRequest, "Password must be at least 6 characters")
		return
	}

	// The very first account on the instance becomes the admin regardless of
	// the invite's configured role.
	var userCount int
	if err := db.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount); err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	info, errMsg := validateInvite(req.InviteCode)
	if errMsg != "" {
		status := http.StatusForbidden
		if errMsg == "Database error" {
			status = http.StatusInternalServerError
		}
		respondError(w, status, errMsg)
		return
	}

	role := info.Role
	if userCount == 0 {
		role = superuserRoleName()
	} else if !roleExists(role) {
		role = defaultRoleName()
	}

	// Hash password
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	// Insert user
	result, err := db.DB.Exec(
		"INSERT INTO users (username, email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, 'active')",
		req.Username, req.Email, hash, req.DisplayName, role,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, http.StatusConflict, "Username or email already exists")
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to create user")
		return
	}

	userID, _ := result.LastInsertId()

	// Consume one use of the invite code, marking it fully used once its
	// allowance is exhausted.
	db.DB.Exec(
		`UPDATE invite_codes SET uses = uses + 1,
			used = CASE WHEN max_uses > 0 AND uses + 1 >= max_uses THEN TRUE ELSE used END,
			used_by = ? WHERE id = ?`,
		userID, info.ID,
	)

	// Generate JWT
	token, err := auth.GenerateToken(userID, req.Username, req.Email, role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	user := &models.User{
		ID:          userID,
		Username:    req.Username,
		Email:       req.Email,
		DisplayName: req.DisplayName,
		Role:        role,
		Status:      "active",
	}

	logAudit(r, userID, req.Username, "user.register", "user", strconv.FormatInt(userID, 10),
		"role="+role)

	respondJSON(w, http.StatusCreated, AuthResponse{
		User:        user,
		Token:       token,
		Permissions: rolePermissions(userID),
		IsSuperuser: isSuperuser(userID),
	})
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Username = strings.TrimSpace(req.Username)

	if req.Username == "" || req.Password == "" {
		respondError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	var user models.User
	err := db.DB.QueryRow(
		"SELECT id, username, email, password_hash, display_name, role, status, created_at, updated_at FROM users WHERE username = ?",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash, &user.DisplayName, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		logAudit(r, 0, req.Username, "user.login_failed", "user", "", "invalid credentials")
		respondError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		logAudit(r, user.ID, user.Username, "user.login_failed", "user", strconv.FormatInt(user.ID, 10), "invalid credentials")
		respondError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}

	if user.Status == "disabled" {
		logAudit(r, user.ID, user.Username, "user.login_blocked", "user", strconv.FormatInt(user.ID, 10), "account disabled")
		respondError(w, http.StatusForbidden, "This account has been disabled")
		return
	}

	token, err := auth.GenerateToken(user.ID, user.Username, user.Email, user.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	logAudit(r, user.ID, user.Username, "user.login", "user", strconv.FormatInt(user.ID, 10), "")

	respondJSON(w, http.StatusOK, AuthResponse{
		User:        &user,
		Token:       token,
		Permissions: rolePermissions(user.ID),
		IsSuperuser: isSuperuser(user.ID),
	})
}

func MeHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getMeHandler(w, r)
	case http.MethodPut:
		UpdateProfileHandler(w, r)
	case http.MethodDelete:
		DeleteAccountHandler(w, r)
	default:
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func getMeHandler(w http.ResponseWriter, r *http.Request) {

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var user models.User
	err = db.DB.QueryRow(
		"SELECT id, username, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?",
		claims.UserID,
	).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Database error")
		return
	}

	respondJSON(w, http.StatusOK, meResponse{
		User:        user,
		Permissions: rolePermissions(claims.UserID),
		IsSuperuser: isSuperuser(claims.UserID),
	})
}

type UpdateProfileRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

func UpdateProfileHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	if req.Email == "" {
		respondError(w, http.StatusBadRequest, "email is required")
		return
	}

	result, err := db.DB.Exec(
		"UPDATE users SET email = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		req.Email, req.DisplayName, claims.UserID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			respondError(w, http.StatusConflict, "Email already in use")
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to update profile")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}

	var user models.User
	db.DB.QueryRow(
		"SELECT id, username, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?",
		claims.UserID,
	).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt)

	respondJSON(w, http.StatusOK, user)
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func ChangePasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.CurrentPassword == "" || req.NewPassword == "" {
		respondError(w, http.StatusBadRequest, "current_password and new_password are required")
		return
	}

	if len(req.NewPassword) < 6 {
		respondError(w, http.StatusBadRequest, "New password must be at least 6 characters")
		return
	}

	var passwordHash string
	err = db.DB.QueryRow("SELECT password_hash FROM users WHERE id = ?", claims.UserID).Scan(&passwordHash)
	if err != nil {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}

	if !auth.CheckPassword(req.CurrentPassword, passwordHash) {
		respondError(w, http.StatusUnauthorized, "Current password is incorrect")
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	db.DB.Exec("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", newHash, claims.UserID)

	respondJSON(w, http.StatusOK, map[string]string{"message": "Password updated"})
}

type DeleteAccountRequest struct {
	Password string `json:"password"`
}

func DeleteAccountHandler(w http.ResponseWriter, r *http.Request) {
	claims, err := extractUser(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var req DeleteAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Password == "" {
		respondError(w, http.StatusBadRequest, "password is required")
		return
	}

	var passwordHash string
	err = db.DB.QueryRow("SELECT password_hash FROM users WHERE id = ?", claims.UserID).Scan(&passwordHash)
	if err != nil {
		respondError(w, http.StatusNotFound, "User not found")
		return
	}

	if !auth.CheckPassword(req.Password, passwordHash) {
		respondError(w, http.StatusUnauthorized, "Password is incorrect")
		return
	}

	// Soft-delete: keep the account and its data, but block sign-in. The
	// instance must always retain one active admin.
	if isSuperuser(claims.UserID) && activeAdminCount() <= 1 {
		respondError(w, http.StatusConflict, "You are the only admin — promote another admin before deleting your account")
		return
	}

	if _, err := db.DB.Exec(
		"UPDATE users SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		claims.UserID,
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete account")
		return
	}

	logAudit(r, claims.UserID, claims.Username, "user.self_delete", "user", strconv.FormatInt(claims.UserID, 10), "soft-delete")

	respondJSON(w, http.StatusOK, map[string]string{"message": "Account deleted"})
}
