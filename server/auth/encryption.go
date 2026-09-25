package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ciphertextPrefix marks a value produced by EncryptToken. Values without it are
// treated as legacy plaintext so data written before encryption was enabled
// keeps working (and is re-encrypted the next time it is written).
const ciphertextPrefix = "enc:v1:"

var (
	encKey     []byte
	encKeyOnce sync.Once
	encKeyErr  error
)

// encryptionKey resolves the 32-byte AES key used for secret encryption. It is
// read from ENCRYPTION_KEY (hex, base64 or 32 raw chars) when set; otherwise a
// random key is generated once and persisted next to the database so it
// survives restarts. The key file lives in the data directory, which is mounted
// on the host, so the same key is reused across container swaps.
func encryptionKey() ([]byte, error) {
	encKeyOnce.Do(func() {
		if v := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY")); v != "" {
			encKey, encKeyErr = decodeKey(v)
			return
		}
		path := encryptionKeyFile()
		if b, err := os.ReadFile(path); err == nil {
			if k, derr := decodeKey(strings.TrimSpace(string(b))); derr == nil {
				encKey = k
				return
			}
		}
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			encKeyErr = err
			return
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			encKeyErr = err
			return
		}
		if err := os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600); err != nil {
			encKeyErr = err
			return
		}
		encKey = key
	})
	if encKeyErr != nil {
		return nil, encKeyErr
	}
	if len(encKey) != 32 {
		return nil, errors.New("encryption key must be 32 bytes")
	}
	return encKey, nil
}

// decodeKey accepts a 32-byte key as hex, base64 or raw text.
func decodeKey(v string) ([]byte, error) {
	if b, err := hex.DecodeString(v); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(v); err == nil && len(b) == 32 {
		return b, nil
	}
	if len(v) == 32 {
		return []byte(v), nil
	}
	return nil, errors.New("encryption key must be 32 bytes (hex, base64 or raw)")
}

// encryptionKeyFile returns the path of the persisted key file, alongside the
// database.
func encryptionKeyFile() string {
	dir := os.Getenv("NINETEEN_DATA_DIR")
	if dir == "" {
		if dbPath := os.Getenv("DB_PATH"); dbPath != "" {
			dir = filepath.Dir(dbPath)
		} else {
			dir = "./data"
		}
	}
	return filepath.Join(dir, ".nineteen-encryption-key")
}

// IsEncrypted reports whether a stored value was produced by EncryptToken.
func IsEncrypted(value string) bool {
	return strings.HasPrefix(value, ciphertextPrefix)
}

// EncryptToken seals plaintext with AES-256-GCM and returns a prefixed,
// base64-encoded ciphertext.
func EncryptToken(plaintext string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertextPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptToken reverses EncryptToken. Legacy plaintext (no prefix) is returned
// unchanged so existing rows remain readable and get re-encrypted on next write.
func DecryptToken(ciphertext string) (string, error) {
	if !IsEncrypted(ciphertext) {
		return ciphertext, nil
	}
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, ciphertextPrefix))
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext is too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
