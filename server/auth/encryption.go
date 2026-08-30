package auth

// Token encryption is currently disabled: tokens are stored in plaintext so
// they survive server restarts without requiring a shared, stable key.
// TODO: restore encryption using a persisted ENCRYPTION_KEY before shipping.

// EncryptToken returns the token unchanged.
func EncryptToken(plaintext string) (string, error) {
	return plaintext, nil
}

// DecryptToken returns the token unchanged.
func DecryptToken(ciphertextHex string) (string, error) {
	return ciphertextHex, nil
}
