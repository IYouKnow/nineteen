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
	"nineteen-server/authz"
	"nineteen-server/db"
	"nineteen-server/models"
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
	RefreshToken string      `json:"refresh_token,omitempty"`
	ExpiresIn   int          `json:"expires_in,omitempty"`
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
	return validateTokenString(tokenString)
}

// validateTokenString is the single choke point for bearer-token validation.
// Signature and expiry are checked first, then the live session: account
// still exists and is active, token version matches (bumped on disable,
// password or role change), jti is not revoked, and refresh tokens are
// rejected on access paths. Every authenticated handler and the SSE
// query-param fallback funnel through here, so a disable/delete takes
// effect on the very next request instead of at the 15-minute expiry.
func validateTokenString(tokenString string) (*Claims, error) {
	claims, err := auth.ValidateToken(tokenString)
	if err != nil {
		return nil, err
	}
	if err := checkSession(claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// checkSession verifies a parsed token against live database state.
func checkSession(claims *Claims) error {
	// Refresh tokens must only ever be presented to /api/auth/refresh.
	// Pre-version tokens carry Type "" and are treated as access tokens so
	// the upgrade does not mass-logout existing sessions; they still die
	// at their own expiry and on the next version bump.
	if claims.Type == auth.TokenTypeRefresh {
		return sql.ErrNoRows
	}
	if claims.UserID == 0 {
		return sql.ErrNoRows
	}
	if claims.ID != "" && isJTIRevoked(claims.ID) {
		return sql.ErrNoRows
	}
	var status sql.NullString
	var version sql.NullInt64
	err := db.DB.QueryRow(
		`SELECT status, token_version FROM users WHERE id = ?`, claims.UserID,
	).Scan(&status, &version)
	if err != nil {
		return err
	}
	if !status.Valid || status.String != "active" {
		return sql.ErrNoRows
	}
	want := 0
	if version.Valid {
		want = int(version.Int64)
	}
	if claims.TokenVersion != want {
		return sql.ErrNoRows
	}
	return nil
}

// currentTokenVersion reads the live session version for issuance.
func currentTokenVersion(userID int64) int {
	var v sql.NullInt64
	if err := db.DB.QueryRow(
		`SELECT token_version FROM users WHERE id = ?`, userID,
	).Scan(&v); err != nil || !v.Valid {
		return 0
	}
	return int(v.Int64)
}

// bumpTokenVersion invalidates every outstanding access and refresh token
// for the user and drops their stored refresh rows. Callers must already
// hold whatever authorization the bump requires.
func bumpTokenVersion(userID int64) {
	_, _ = db.DB.Exec(
		`UPDATE users SET token_version = COALESCE(token_version, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		userID,
	)
	_, _ = db.DB.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID)
}

// isJTIRevoked reports whether a token id was explicitly revoked (logout).
// Errors fail closed on missing tables (pre-migration) by reporting false;
// the version and status checks above still apply.
func isJTIRevoked(jti string) bool {
	var one int
	err := db.DB.QueryRow(`SELECT 1 FROM revoked_tokens WHERE jti = ?`, jti).Scan(&one)
	return err == nil && one == 1
}

// revokeJTI records a single access/refresh id until its natural expiry so
// logout is per-token rather than per-account. Failures are ignored — the
// version bump path remains the hard guarantee.
func revokeJTI(jti string, userID int64, expiresAt time.Time) {
	if jti == "" {
		return
	}
	if expiresAt.IsZero() || expiresAt.Before(time.Now()) {
		expiresAt = time.Now().Add(auth.AccessTTL)
	}
	_, _ = db.DB.Exec(
		`INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)`,
		jti, userID, sessionTime(expiresAt),
	)
}

// sessionTime formats timestamps the way the rest of the schema does.
func sessionTime(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05")
}

// parseSessionTime accepts both the canonical layout and RFC3339, since
// older rows may predate the UTC format.
func parseSessionTime(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// issueTokenPair mints a fresh access + refresh pair for an active user and
// persists the refresh row for rotation checks. The returned refreshExpiry
// is also stored so logout can revoke precisely.
func issueTokenPair(userID int64, username, email, role string) (access, refresh string, refreshExpiry time.Time, err error) {
	version := currentTokenVersion(userID)
	accessJTI := auth.NewJTI()
	refreshJTI := auth.NewJTI()
	access, err = auth.GenerateAccessToken(userID, username, email, role, version, accessJTI)
	if err != nil {
		return "", "", time.Time{}, err
	}
	refresh, err = auth.GenerateRefreshToken(userID, version, refreshJTI)
	if err != nil {
		return "", "", time.Time{}, err
	}
	refreshExpiry = time.Now().Add(auth.RefreshTTL)
	_, err = db.DB.Exec(
		`INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)`,
		refreshJTI, userID, sessionTime(refreshExpiry),
	)
	if err != nil {
		return "", "", time.Time{}, err
	}
	return access, refresh, refreshExpiry, nil
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
// Resolution lives in authz so the role_id foreign key and its legacy name
// fallback are honoured in exactly one place.
func isSuperuser(userID int64) bool {
	return authz.IsSuperuser(userID)
}

// hasPermission reports whether a user is granted a permission (directly, via a
// wildcard, or as a superuser).
func hasPermission(userID int64, perm string) bool {
	return authz.Can(userID, perm)
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
	return authz.ActiveSuperuserCount()
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
	roleID  sql.NullInt64
	MaxUses int
	Uses    int
}

// roleForNewAccount decides the role a registration receives. The first account
// on an instance is always the superuser; everyone else takes the invite's role,
// falling back to the default. Resolution is delegated to authz so the
// role_id/name fallback is honoured in one place.
func roleForNewAccount(isFirstAccount bool, inviteRole string, inviteRoleID sql.NullInt64) authz.Role {
	if isFirstAccount {
		if su, ok := authz.SuperuserRole(); ok {
			return su
		}
	}
	role, _, err := authz.RoleForRegistration(inviteRoleID, inviteRole)
	if err == nil && role.Name != "" {
		return role
	}
	// Belt and braces: if somehow nothing resolved, fall back to the
	// superuser role so a fresh instance is never left without an admin.
	if su, ok := authz.SuperuserRole(); ok {
		return su
	}
	return authz.Role{}
}

// validateInvite resolves a usable invite code, returning a human-readable
// reason when the code is missing, revoked, exhausted or expired.
func validateInvite(code string) (inviteInfo, string) {
	var info inviteInfo
	var used, revoked bool
	var expiresAt sql.NullString
	var roleID sql.NullInt64
	var roleName sql.NullString
	err := db.DB.QueryRow(
		`SELECT id, used, revoked, expires_at, max_uses, uses, role_id, role
		 FROM invite_codes WHERE code = ?`,
		code,
	).Scan(&info.ID, &used, &revoked, &expiresAt, &info.MaxUses, &info.Uses, &roleID, &roleName)
	if err == sql.ErrNoRows {
		return info, "Invalid invite code"
	}
	if err != nil {
		return info, "Database error"
	}
	info.roleID = roleID
	info.Role = roleName.String
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
	// the invite's configured role, otherwise the instance would have nobody
	// who can administer it.
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

	var inviteRoleID sql.NullInt64
	assigned := roleForNewAccount(userCount == 0, info.Role, inviteRoleID)

	// Hash password
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}

	// Insert user. role_id and the legacy name column are written together so
	// name-based reads stay correct during the compatibility window.
	result, err := db.DB.Exec(
		"INSERT INTO users (username, email, password_hash, display_name, role, role_id, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
		req.Username, req.Email, hash, req.DisplayName, assigned.Name, assigned.ID,
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

	// Issue a short-lived access token plus a stateful refresh token.
	token, refresh, _, err := issueTokenPair(userID, req.Username, req.Email, assigned.Name)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	user := &models.User{
		ID:          userID,
		Username:    req.Username,
		Email:       req.Email,
		DisplayName: req.DisplayName,
		Role:        assigned.Name,
		Status:      "active",
	}

	logAudit(r, userID, req.Username, "user.register", "user", strconv.FormatInt(userID, 10),
		"role="+assigned.Name)

	respondJSON(w, http.StatusCreated, AuthResponse{
		User:         user,
		Token:        token,
		RefreshToken: refresh,
		ExpiresIn:    int(auth.AccessTTL.Seconds()),
		Permissions:  authz.ExpandedPermissions(userID),
		IsSuperuser:  isSuperuser(userID),
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

	token, refresh, _, err := issueTokenPair(user.ID, user.Username, user.Email, user.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	logAudit(r, user.ID, user.Username, "user.login", "user", strconv.FormatInt(user.ID, 10), "")

	respondJSON(w, http.StatusOK, AuthResponse{
		User:         &user,
		Token:        token,
		RefreshToken: refresh,
		ExpiresIn:    int(auth.AccessTTL.Seconds()),
		Permissions:  authz.ExpandedPermissions(user.ID),
		IsSuperuser:  isSuperuser(user.ID),
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
		Permissions: authz.ExpandedPermissions(claims.UserID),
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

	// A password change implies possible compromise: kill every other
	// session, then re-issue the current device so it stays signed in.
	revokeJTI(claims.ID, claims.UserID, claims.ExpiresAt.Time)
	bumpTokenVersion(claims.UserID)
	var fresh models.User
	_ = db.DB.QueryRow(
		`SELECT id, username, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?`,
		claims.UserID,
	).Scan(&fresh.ID, &fresh.Username, &fresh.Email, &fresh.DisplayName, &fresh.Role, &fresh.Status, &fresh.CreatedAt, &fresh.UpdatedAt)
	access, refresh, _, err := issueTokenPair(claims.UserID, fresh.Username, fresh.Email, fresh.Role)
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]string{"message": "Password updated — please sign in again"})
		return
	}
	logAudit(r, claims.UserID, claims.Username, "user.password_change", "user", strconv.FormatInt(claims.UserID, 10), "sessions rotated")

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":       "Password updated",
		"token":         access,
		"refresh_token": refresh,
		"expires_in":    int(auth.AccessTTL.Seconds()),
	})
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

	// Version bump + refresh purge makes the caller's own token (and any
	// copies) fail the very next checkSession instead of living on.
	revokeJTI(claims.ID, claims.UserID, claims.ExpiresAt.Time)
	bumpTokenVersion(claims.UserID)

	logAudit(r, claims.UserID, claims.Username, "user.self_delete", "user", strconv.FormatInt(claims.UserID, 10), "soft-delete")

	respondJSON(w, http.StatusOK, map[string]string{"message": "Account deleted"})
}

// RefreshHandler exchanges a valid refresh token for a fresh pair
// (rotation). The presented refresh id is consumed single-use: it is
// deleted and blackholed so a replayed (stolen) refresh token fails.
func RefreshHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.RefreshToken) == "" {
		respondError(w, http.StatusBadRequest, "refresh_token is required")
		return
	}
	claims, err := auth.ValidateToken(strings.TrimSpace(req.RefreshToken))
	if err != nil {
		respondError(w, http.StatusUnauthorized, "Invalid or expired refresh token")
		return
	}
	if claims.Type != auth.TokenTypeRefresh {
		respondError(w, http.StatusUnauthorized, "Invalid refresh token")
		return
	}
	if claims.UserID == 0 || claims.ID == "" {
		respondError(w, http.StatusUnauthorized, "Invalid refresh token")
		return
	}
	if isJTIRevoked(claims.ID) {
		respondError(w, http.StatusUnauthorized, "Refresh token revoked")
		return
	}
	var status sql.NullString
	var version sql.NullInt64
	if err := db.DB.QueryRow(
		`SELECT status, token_version FROM users WHERE id = ?`, claims.UserID,
	).Scan(&status, &version); err != nil || !status.Valid || status.String != "active" {
		respondError(w, http.StatusUnauthorized, "Account is no longer active")
		return
	}
	want := 0
	if version.Valid {
		want = int(version.Int64)
	}
	if claims.TokenVersion != want {
		respondError(w, http.StatusUnauthorized, "Session revoked — please sign in again")
		return
	}
	var storedExpiry string
	var revoked bool
	if err := db.DB.QueryRow(
		`SELECT expires_at, revoked FROM refresh_tokens WHERE jti = ? AND user_id = ?`,
		claims.ID, claims.UserID,
	).Scan(&storedExpiry, &revoked); err != nil {
		respondError(w, http.StatusUnauthorized, "Refresh token revoked")
		return
	}
	if revoked {
		respondError(w, http.StatusUnauthorized, "Refresh token revoked")
		return
	}
	if t, ok := parseSessionTime(storedExpiry); ok && time.Now().After(t) {
		_, _ = db.DB.Exec(`DELETE FROM refresh_tokens WHERE jti = ?`, claims.ID)
		respondError(w, http.StatusUnauthorized, "Refresh token expired")
		return
	}
	// Consume the presented id (single-use rotation).
	_, _ = db.DB.Exec(`DELETE FROM refresh_tokens WHERE jti = ?`, claims.ID)
	revokeJTI(claims.ID, claims.UserID, claims.ExpiresAt.Time)
	// Opportunistic janitor duty: expired rows never need to be scanned again.
	_, _ = db.DB.Exec(`DELETE FROM refresh_tokens WHERE expires_at < ?`, sessionTime(time.Now()))
	_, _ = db.DB.Exec(`DELETE FROM revoked_tokens WHERE expires_at < ?`, sessionTime(time.Now()))

	var user models.User
	if err := db.DB.QueryRow(
		`SELECT id, username, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?`,
		claims.UserID,
	).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt); err != nil {
		respondError(w, http.StatusUnauthorized, "Account is no longer active")
		return
	}
	access, refresh, _, err := issueTokenPair(user.ID, user.Username, user.Email, user.Role)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to refresh session")
		return
	}
	respondJSON(w, http.StatusOK, AuthResponse{
		User:         &user,
		Token:        access,
		RefreshToken: refresh,
		ExpiresIn:    int(auth.AccessTTL.Seconds()),
		Permissions:  authz.ExpandedPermissions(user.ID),
		IsSuperuser:  isSuperuser(user.ID),
	})
}

// LogoutHandler revokes the calling access token and, when supplied, one
// refresh token. Always idempotent: unknown ids still return 200 so logout
// can never oracle which tokens exist.
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	revoked := 0
	if claims, err := extractUser(r); err == nil {
		revokeJTI(claims.ID, claims.UserID, claims.ExpiresAt.Time)
		revoked++
	} else if hdr := r.Header.Get("Authorization"); hdr != "" {
		// Even an already-stale access token should have its jti
		// blackholed if we can still parse the signature.
		if tokenString := strings.TrimPrefix(hdr, "Bearer "); tokenString != hdr {
			if claims, err := auth.ValidateToken(strings.TrimSpace(tokenString)); err == nil && claims.ID != "" {
				revokeJTI(claims.ID, claims.UserID, claims.ExpiresAt.Time)
				revoked++
			}
		}
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.RefreshToken) != "" {
		if claims, err := auth.ValidateToken(strings.TrimSpace(req.RefreshToken)); err == nil && claims.ID != "" {
			_, _ = db.DB.Exec(`DELETE FROM refresh_tokens WHERE jti = ?`, claims.ID)
			exp := claims.ExpiresAt.Time
			if exp.IsZero() {
				exp = time.Now().Add(auth.RefreshTTL)
			}
			revokeJTI(claims.ID, claims.UserID, exp)
			revoked++
		}
	}
	_, _ = db.DB.Exec(`DELETE FROM revoked_tokens WHERE expires_at < ?`, sessionTime(time.Now()))
	respondJSON(w, http.StatusOK, map[string]interface{}{"message": "Signed out", "revoked": revoked})
}
