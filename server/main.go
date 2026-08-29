package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: could not load .env file:", err)
	}
	log.Println("ADMIN_USERNAME:", os.Getenv("ADMIN_USERNAME"))
	log.Println("ADMIN_PASSWORD set:", os.Getenv("ADMIN_PASSWORD") != "")

	adminUser := os.Getenv("ADMIN_USERNAME")
	adminPass := os.Getenv("ADMIN_PASSWORD")
	adminPassHash := os.Getenv("ADMIN_PASSWORD_HASH")
	if adminUser == "" {
		adminUser = "admin@localhost"
	}
	if adminPass == "" {
		adminPass = "password"
	}
	if adminPassHash == "" {
		adminPassHash = hashPassword(adminPass)
	}

	user := &User{
		Password: adminPassHash,
		ID:       "user-1",
		Email:    adminUser,
		Name:     "Admin",
		Role:     "admin",
	}
	log.Println("Admin user created:", user.Email)

	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonResponse(w, map[string]string{"error": "method not allowed"}, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Println("Decode error:", err)
			jsonResponse(w, map[string]string{"error": "invalid request"}, http.StatusBadRequest)
			return
		}
		log.Printf("Login attempt: email=%q, pass=%q, storedEmail=%q\n", req.Email, req.Password, user.Email)
		log.Printf("Email match: %v\n", req.Email == user.Email)
		if req.Email != user.Email {
			jsonResponse(w, map[string]string{"error": "invalid credentials"}, http.StatusUnauthorized)
			return
		}
		log.Printf("Checking password, hash starts with: %s\n", user.Password[:7])
		if !checkPassword(req.Password, user.Password) {
			log.Println("Password check failed")
			jsonResponse(w, map[string]string{"error": "invalid credentials"}, http.StatusUnauthorized)
			return
		}
		token, err := generateToken(user)
		if err != nil {
			jsonResponse(w, map[string]string{"error": "server error"}, http.StatusInternalServerError)
			return
		}
		jsonResponse(w, AuthResponse{User: user, Token: token}, http.StatusOK)
	})

	mux.HandleFunc("/api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		tokenStr := extractToken(r)
		if tokenStr == "" {
			jsonResponse(w, map[string]string{"error": "unauthorized"}, http.StatusUnauthorized)
			return
		}
		claims, err := validateToken(tokenStr)
		if err != nil {
			jsonResponse(w, map[string]string{"error": "invalid token"}, http.StatusUnauthorized)
			return
		}
		if claims.UserID != user.ID {
			jsonResponse(w, map[string]string{"error": "user not found"}, http.StatusUnauthorized)
			return
		}
		jsonResponse(w, AuthResponse{User: user}, http.StatusOK)
	})

	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)
	})

	mux.HandleFunc("/api/auth/reset-password-request", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)
	})

	mux.HandleFunc("/api/auth/reset-password", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)
	})

	mux.HandleFunc("/api/auth/verify-otp", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]string{"error": "not implemented"}, http.StatusNotImplemented)
	})

	mux.HandleFunc("/api/auth/resend-otp", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]string{"error": "not implemented"}, http.StatusNotImplemented)
	})

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]string{"error": "not found"}, http.StatusNotFound)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, "<h1>NexusCore API</h1><p>Server running</p>")
	})

	server := &http.Server{
		Addr:    ":3001",
		Handler: corsMiddleware(mux),
	}

	log.Printf("NexusCore server running on http://localhost:3001")
	log.Printf("Login: %s / %s", adminUser, adminPass)
	log.Fatal(server.ListenAndServe())
}

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Password string `json:"-"`
}

type AuthResponse struct {
	User  *User  `json:"user"`
	Token string `json:"token"`
}

type Claims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

func generateToken(user *User) (string, error) {
	claims := &Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.Email,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte("nexuscore-dev-secret"))
}

func validateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte("nexuscore-dev-secret"), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func extractToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return ""
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return ""
	}
	return parts[1]
}

func hashPassword(password string) string {
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash)
}

func checkPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(password), []byte(hash)) == nil
}

func jsonResponse(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}
