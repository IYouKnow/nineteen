package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"nineteen-server/db"
)

// TestDisabledTokenRejected is the regression test for the reported issue:
// disabling an account must kill its live tokens immediately, not at the
// 72h JWT expiry.
func TestDisabledTokenRejected(t *testing.T) {
	uid, token := insertUser(t, "member")

	// Sanity: the fresh token works.
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", token, nil); w.Code != http.StatusOK {
		t.Fatalf("fresh token rejected: %d %s", w.Code, w.Body.String())
	}

	// Admin disables the account out from under the live token.
	if _, err := db.DB.Exec(`UPDATE users SET status = 'disabled' WHERE id = ?`, uid); err != nil {
		t.Fatalf("disable: %v", err)
	}

	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", token, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("disabled account token still accepted: %d %s", w.Code, w.Body.String())
	}
}

// TestVersionBumpRevokesTokens covers password/role/status changes: any
// token_version mismatch must fail validation even while the account stays
// active.
func TestVersionBumpRevokesTokens(t *testing.T) {
	uid, _ := insertUser(t, "member")
	var name, email, role string
	if err := db.DB.QueryRow(`SELECT username, email, role FROM users WHERE id = ?`, uid).
		Scan(&name, &email, &role); err != nil {
		t.Fatalf("load user: %v", err)
	}
	access, _, _, err := issueTokenPair(uid, name, email, role)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", access, nil); w.Code != http.StatusOK {
		t.Fatalf("fresh pair rejected: %d %s", w.Code, w.Body.String())
	}

	bumpTokenVersion(uid)

	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", access, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("pre-bump token still accepted: %d %s", w.Code, w.Body.String())
	}
}

// TestRefreshRotation checks single-use rotation: a refresh token works
// once, then its replay is refused.
func TestRefreshRotation(t *testing.T) {
	uid, _ := insertUser(t, "member")
	var name, email, role string
	if err := db.DB.QueryRow(`SELECT username, email, role FROM users WHERE id = ?`, uid).
		Scan(&name, &email, &role); err != nil {
		t.Fatalf("load user: %v", err)
	}
	_, refresh, _, err := issueTokenPair(uid, name, email, role)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	w := do(t, RefreshHandler, http.MethodPost, "/api/auth/refresh", "",
		map[string]string{"refresh_token": refresh})
	if w.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", w.Code, w.Body.String())
	}
	var out AuthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Token == "" || out.RefreshToken == "" {
		t.Fatalf("refresh returned no pair: %v %s", err, w.Body.String())
	}
	// The rotated access token must work.
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", out.Token, nil); w.Code != http.StatusOK {
		t.Fatalf("rotated access rejected: %d %s", w.Code, w.Body.String())
	}
	// Replaying the consumed refresh token must fail.
	if w := do(t, RefreshHandler, http.MethodPost, "/api/auth/refresh", "",
		map[string]string{"refresh_token": refresh}); w.Code != http.StatusUnauthorized {
		t.Fatalf("replayed refresh accepted: %d %s", w.Code, w.Body.String())
	}
}

// TestLogoutRevokesAccess checks per-token logout: the access jti lands in
// the blacklist while other sessions are untouched.
func TestLogoutRevokesAccess(t *testing.T) {
	uid, _ := insertUser(t, "member")
	var name, email, role string
	if err := db.DB.QueryRow(`SELECT username, email, role FROM users WHERE id = ?`, uid).
		Scan(&name, &email, &role); err != nil {
		t.Fatalf("load user: %v", err)
	}
	access, refresh, _, err := issueTokenPair(uid, name, email, role)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	other, _, _, err := issueTokenPair(uid, name, email, role)
	if err != nil {
		t.Fatalf("issue second: %v", err)
	}

	w := do(t, LogoutHandler, http.MethodPost, "/api/auth/logout", access,
		map[string]string{"refresh_token": refresh})
	if w.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", w.Code, w.Body.String())
	}

	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", access, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("logged-out access token still accepted: %d %s", w.Code, w.Body.String())
	}
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", other, nil); w.Code != http.StatusOK {
		t.Fatalf("unrelated session killed by logout: %d %s", w.Code, w.Body.String())
	}
}

// TestRefreshTokenCannotAccessAPI ensures a refresh token presented as a
// bearer is rejected on normal endpoints.
func TestRefreshTokenCannotAccessAPI(t *testing.T) {
	uid, _ := insertUser(t, "member")
	var name, email, role string
	if err := db.DB.QueryRow(`SELECT username, email, role FROM users WHERE id = ?`, uid).
		Scan(&name, &email, &role); err != nil {
		t.Fatalf("load user: %v", err)
	}
	_, refresh, _, err := issueTokenPair(uid, name, email, role)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", refresh, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("refresh token accepted as access: %d %s", w.Code, w.Body.String())
	}
}

// TestLegacyTokenWithoutVersion keeps working until a bump: tokens issued
// before the tv claim existed carry version 0, matching the backfilled
// default.
func TestLegacyTokenWithoutVersion(t *testing.T) {
	uid, token := insertUser(t, "member") // auth.GenerateToken, version 0
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", token, nil); w.Code != http.StatusOK {
		t.Fatalf("legacy token rejected: %d %s", w.Code, w.Body.String())
	}
	bumpTokenVersion(uid)
	if w := do(t, MeHandler, http.MethodGet, "/api/auth/me", token, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy token survived version bump: %d %s", w.Code, w.Body.String())
	}
}
