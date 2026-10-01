package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	jwtSecret  []byte
	secretOnce sync.Once
)

// secret lazily resolves the JWT signing key on first use so that callers that
// load .env (e.g. main via godotenv) run before we read the environment. A
// package init() would run too early and miss JWT_SECRET.
func secret() []byte {
	secretOnce.Do(func() {
		s := os.Getenv("JWT_SECRET")
		if s == "" {
			b := make([]byte, 32)
			rand.Read(b)
			s = hex.EncodeToString(b)
			os.Setenv("JWT_SECRET", s)
		}
		jwtSecret = []byte(s)
	})
	return jwtSecret
}

type Claims struct {
	UserID int64 `json:"user_id"`
	// Username/Email/Role are informational only. Authorization decisions
	// always read the live role from the database; never trust these fields.
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	// TokenVersion must match users.token_version. Bumped on disable,
	// delete, password change and role change so every previously issued
	// token (access and refresh) stops validating immediately.
	TokenVersion int `json:"tv,omitempty"`
	// Type is "access" or "refresh". Tokens issued before this field
	// existed carry "" and are treated as access tokens for one rotation
	// window so the upgrade does not log everybody out at once.
	Type string `json:"typ,omitempty"`
	jwt.RegisteredClaims
}

// Token types carried in Claims.Type.
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

// Lifetimes. Access is deliberately short so a stolen token (or a missed
// revocation check) has a small blast radius; refresh is long-lived but
// stateful — it is checked against the database on every use.
const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
)

// Built-in role names. Roles live in their own table and can be renamed or
// extended; these are the names the application seeds on a fresh install and
// falls back to when no superuser/default role is configured.
const (
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleViewer = "viewer"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// NewJTI returns a random token identifier for blacklist tracking.
func NewJTI() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Fall back to timestamp-based uniqueness; still unpredictable
		// enough combined with the HMAC signature.
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(b)
}

// GenerateAccessToken mints a short-lived access token.
func GenerateAccessToken(userID int64, username, email, role string, tokenVersion int, jti string) (string, error) {
	if jti == "" {
		jti = NewJTI()
	}
	now := time.Now()
	claims := Claims{
		UserID:       userID,
		Username:     username,
		Email:        email,
		Role:         role,
		TokenVersion: tokenVersion,
		Type:         TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret())
}

// GenerateRefreshToken mints a long-lived refresh token. It carries no role
// or profile data — it exists only to be exchanged for a fresh pair.
func GenerateRefreshToken(userID int64, tokenVersion int, jti string) (string, error) {
	if jti == "" {
		jti = NewJTI()
	}
	now := time.Now()
	claims := Claims{
		UserID:       userID,
		TokenVersion: tokenVersion,
		Type:         TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(now.Add(RefreshTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret())
}

// GenerateToken is the legacy issuer, kept so existing tests and any old
// callers keep compiling. New code must use GenerateAccessToken /
// GenerateRefreshToken via the session helpers in the handlers package so
// the version claim is populated.
func GenerateToken(userID int64, username, email, role string) (string, error) {
	return GenerateAccessToken(userID, username, email, role, 0, "")
}

func ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return secret(), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}
