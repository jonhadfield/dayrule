// Package deviceclient is a native-shaped Dayrule client: login with a
// bearer session, pull/push encrypted sync records, and work with decrypted
// to-dos in process memory. The server never sees plaintext.
//
// Used by cmd/dayrule (CLI and MCP). The X-Dayrule-Client header is
// macos/<build> so the API returns a bearer token (same path as the Mac app).
package deviceclient

import (
	"bytes"
	"context"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/clientcrypto"
)

const (
	alg           = 1
	schemaVersion = 1
	keyID         = 1
	// High enough to clear any MinMacOSBuild floor; this is not an App Store build.
	clientHeader = "macos/99999"
	deviceLabel  = "dayrule-cli"
)

// Session is an unlocked vault: bearer token plus the account key in memory.
type Session struct {
	API    string
	Email  string
	UserID string
	Token  string
	AK     []byte
	HTTP   *http.Client

	syncIDKey []byte
}

// Login derives keys, signs in, and unwraps the account key.
func Login(ctx context.Context, api, email, password string) (*Session, error) {
	api = strings.TrimRight(strings.TrimSpace(api), "/")
	if api == "" {
		api = "https://dayrule.app"
	}
	email = strings.TrimSpace(email)
	// Env vars and paste often leave a trailing newline; that would derive
	// a different AuthKey than the web app.
	password = strings.TrimSpace(password)
	if email == "" || password == "" {
		return nil, fmt.Errorf("email and password are required")
	}
	client := &http.Client{Timeout: 120 * time.Second}

	var pre struct {
		Salt string                 `json:"salt"`
		Kdf  clientcrypto.KdfParams `json:"kdf"`
	}
	if err := doJSON(ctx, client, http.MethodPost, api+"/api/v1/auth/prelogin",
		map[string]string{"email": email}, "", &pre); err != nil {
		return nil, fmt.Errorf("prelogin: %w", err)
	}
	if pre.Kdf.Ops == 0 || pre.Kdf.Mem == 0 {
		return nil, fmt.Errorf("prelogin: missing kdf params (ops=%d mem=%d)", pre.Kdf.Ops, pre.Kdf.Mem)
	}
	salt, err := base64.StdEncoding.DecodeString(pre.Salt)
	if err != nil {
		return nil, fmt.Errorf("salt: %w", err)
	}
	mk, err := clientcrypto.MasterKey(password, salt, pre.Kdf)
	if err != nil {
		return nil, err
	}
	defer wipe(mk)
	authKey, err := clientcrypto.HKDF(mk, clientcrypto.LabelAuth)
	if err != nil {
		return nil, err
	}
	kek, err := clientcrypto.HKDF(mk, clientcrypto.LabelKEK)
	if err != nil {
		wipe(authKey)
		return nil, err
	}
	defer wipe(kek)

	var login struct {
		UserID          string          `json:"userId"`
		Token           string          `json:"token"`
		WrappedPassword wrapBlob        `json:"wrappedPassword"`
		SecondStep      json.RawMessage `json:"secondStep"`
	}
	if err := doJSON(ctx, client, http.MethodPost, api+"/api/v1/auth/login", map[string]string{
		"email": email, "authKey": base64.StdEncoding.EncodeToString(authKey), "deviceLabel": deviceLabel,
	}, "", &login); err != nil {
		wipe(authKey)
		if strings.Contains(err.Error(), "bad_login") {
			return nil, fmt.Errorf("login: email/password not accepted by %s (check DAYRULE_EMAIL / DAYRULE_PASSWORD; avoid a trailing newline in the password): %w", api, err)
		}
		return nil, fmt.Errorf("login: %w", err)
	}
	wipe(authKey)
	if len(login.SecondStep) > 0 && string(login.SecondStep) != "null" {
		finished, err := finishSecondStep(ctx, client, api, login.SecondStep)
		if err != nil {
			return nil, err
		}
		login.UserID = finished.UserID
		login.Token = finished.Token
		login.WrappedPassword = finished.WrappedPassword
	}
	if login.Token == "" {
		return nil, fmt.Errorf("no bearer token (API must see a native X-Dayrule-Client)")
	}

	nonce, err := base64.StdEncoding.DecodeString(login.WrappedPassword.Nonce)
	if err != nil {
		return nil, err
	}
	ct, err := base64.StdEncoding.DecodeString(login.WrappedPassword.Ciphertext)
	if err != nil {
		return nil, err
	}
	ak, err := clientcrypto.Open(kek, nonce, ct, clientcrypto.WrapAAD(clientcrypto.LabelWrapUnderKEK, login.UserID))
	if err != nil {
		return nil, fmt.Errorf("unwrap account key: %w", err)
	}
	syncIDKey, err := clientcrypto.HKDF(ak, "dayrule/sync-id/v1")
	if err != nil {
		wipe(ak)
		return nil, err
	}
	return &Session{
		API: api, Email: email, UserID: login.UserID, Token: login.Token,
		AK: ak, HTTP: client, syncIDKey: syncIDKey,
	}, nil
}

type loginResult struct {
	UserID          string   `json:"userId"`
	Token           string   `json:"token"`
	WrappedPassword wrapBlob `json:"wrappedPassword"`
}

// finishSecondStep completes login with a TOTP or backup code from the
// environment (DAYRULE_TOTP_CODE, DAYRULE_BACKUP_CODE, or DAYRULE_TOTP_SECRET).
// Passkeys are not supported in the CLI.
func finishSecondStep(ctx context.Context, client *http.Client, api string, raw json.RawMessage) (loginResult, error) {
	var step struct {
		Token   string   `json:"token"`
		Methods []string `json:"methods"`
	}
	if err := json.Unmarshal(raw, &step); err != nil {
		return loginResult{}, fmt.Errorf("second step: %w", err)
	}
	code, err := secondStepCode(step.Methods)
	if err != nil {
		return loginResult{}, err
	}
	var out loginResult
	if err := doJSON(ctx, client, http.MethodPost, api+"/api/v1/auth/login/code", map[string]string{
		"token": step.Token, "code": code,
	}, "", &out); err != nil {
		return loginResult{}, fmt.Errorf("second step: %w", err)
	}
	return out, nil
}

func secondStepCode(methods []string) (string, error) {
	if code := strings.TrimSpace(os.Getenv("DAYRULE_TOTP_CODE")); code != "" {
		return code, nil
	}
	if code := strings.TrimSpace(os.Getenv("DAYRULE_BACKUP_CODE")); code != "" {
		return code, nil
	}
	if secret := strings.TrimSpace(os.Getenv("DAYRULE_TOTP_SECRET")); secret != "" {
		raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
			strings.ToUpper(strings.ReplaceAll(secret, " ", "")))
		if err != nil {
			return "", fmt.Errorf("DAYRULE_TOTP_SECRET: %w", err)
		}
		return auth.TOTPCode(raw, auth.TOTPStep(time.Now())), nil
	}
	hasCode := false
	for _, m := range methods {
		if m == "totp" || m == "backup" {
			hasCode = true
			break
		}
	}
	if !hasCode {
		return "", fmt.Errorf("account has two-step sign-in with passkey only; the CLI cannot assert a passkey — use an authenticator app (DAYRULE_TOTP_SECRET or DAYRULE_TOTP_CODE) or a backup code (DAYRULE_BACKUP_CODE), or turn two-step off for this agent account")
	}
	return "", fmt.Errorf("account has two-step sign-in; set DAYRULE_TOTP_SECRET (base32), DAYRULE_TOTP_CODE, or DAYRULE_BACKUP_CODE")
}

// Close wipes key material.
func (s *Session) Close() {
	if s == nil {
		return
	}
	wipe(s.AK)
	wipe(s.syncIDKey)
	s.Token = ""
}

type wrapBlob struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func doJSON(ctx context.Context, client *http.Client, method, rawURL string, body any, bearer string, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Dayrule-Client", clientHeader)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", res.Status, truncate(string(raw), 240))
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func (s *Session) getJSON(ctx context.Context, path string, out any) error {
	return doJSON(ctx, s.HTTP, http.MethodGet, s.API+path, nil, s.Token, out)
}

func (s *Session) postJSON(ctx context.Context, path string, body any, out any) error {
	return doJSON(ctx, s.HTTP, http.MethodPost, s.API+path, body, s.Token, out)
}

func wipe(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// Head returns the account's sync sequence head.
func (s *Session) Head(ctx context.Context) (seq, floor int64, err error) {
	var out struct {
		Seq   int64 `json:"seq"`
		Floor int64 `json:"floor"`
	}
	if err := s.getJSON(ctx, "/api/v1/sync/head", &out); err != nil {
		return 0, 0, err
	}
	return out.Seq, out.Floor, nil
}

func queryPull(since int64, full bool) string {
	q := url.Values{}
	q.Set("since", strconv.FormatInt(since, 10))
	if full {
		q.Set("full", "1")
	}
	return "/api/v1/sync/pull?" + q.Encode()
}
