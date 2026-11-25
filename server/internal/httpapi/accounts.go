package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Accounts wires the account endpoints (PLAN.md §11.3).
type Accounts struct {
	Store      store.Accounts
	Keys       auth.Keys
	Email      email.Sender
	InviteOnly bool
	Now        func() time.Time
	Logger     *slog.Logger
	// Passkeys serves passkeys as a second sign-in step; nil turns them off.
	Passkeys *Passkeys
}

const (
	sessionCookie   = "__Host-session"
	sessionLifetime = 30 * 24 * time.Hour
	codeLifetime    = 10 * time.Minute
	tokenLifetime   = 30 * time.Minute
	maxBody         = 16 << 10
)

var defaultKdf = store.KdfParams{V: 1, Ops: 3, Mem: 64 << 20}

func (a *Accounts) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/signup/start", a.signupStart)
	mux.HandleFunc("POST /api/v1/auth/signup/verify", a.signupVerify)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/prelogin", a.prelogin)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("POST /api/v1/auth/recover/start", a.recoverStart)
	mux.HandleFunc("POST /api/v1/auth/recover/complete", a.recoverComplete)
	mux.HandleFunc("GET /api/v1/account", a.withSession(a.account))
	mux.HandleFunc("PUT /api/v1/account/password", a.withSession(a.changePassword))
	mux.HandleFunc("POST /api/v1/account/email/start", a.withSession(a.emailStart))
	mux.HandleFunc("POST /api/v1/account/email/verify", a.withSession(a.emailVerify))
	mux.HandleFunc("GET /api/v1/account/sessions", a.withSession(a.listSessions))
	mux.HandleFunc("DELETE /api/v1/account/sessions/{id}", a.withSession(a.revokeSession))
	mux.HandleFunc("DELETE /api/v1/account", a.withSession(a.deleteAccount))
	a.passkeyRoutes(mux)
	a.twoStepRoutes(mux)
	a.calendarRoutes(mux)
}

// ---------------------------------------------------------------------------
// Helpers

type apiError struct {
	status int
	code   string
	msg    string
}

func (e apiError) Error() string { return e.msg }

func errBadRequest(msg string) apiError { return apiError{http.StatusBadRequest, "bad_request", msg} }

var (
	errUnauthorized = apiError{http.StatusUnauthorized, "unauthorized", "Sign in again."}
	errBadLogin     = apiError{http.StatusUnauthorized, "bad_login", "That email and password don't match."}
	errLocked       = apiError{http.StatusTooManyRequests, "locked", "Too many attempts. Try again in a little while."}
	errBadCode      = apiError{http.StatusBadRequest, "bad_code", "That code isn't right."}
	errExpiredCode  = apiError{http.StatusBadRequest, "expired_code", "That code has expired. Ask for a new one."}
	errBadInvite    = apiError{http.StatusBadRequest, "bad_invite", "That invite code isn't valid."}
	errBadToken     = apiError{http.StatusBadRequest, "bad_token", "Sign-up timed out. Start again."}
)

func writeErr(w http.ResponseWriter, err error) {
	var e apiError
	if errors.As(err, &e) {
		writeJSON(w, e.status, map[string]string{"error": e.msg, "code": e.code})
		return
	}
	// Unexpected errors are logged (never request bodies) and hidden from callers.
	slog.Error("internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Something went wrong.", "code": "internal"})
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest("Invalid request.")
	}
	return nil
}

func b64(s string, n int) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != n {
		return nil, errBadRequest("Invalid key material.")
	}
	return b, nil
}

// decoyCodeHash is an unguessable stand-in for code_hash when the address
// already has an account, so verify failures match a real wrong guess.
func decoyCodeHash() ([]byte, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return b, err
}

func normEmail(s string) (string, error) {
	s = strings.TrimSpace(s)
	addr, err := mail.ParseAddress(s)
	if err != nil || addr.Address != s || len(s) > 254 {
		return "", errBadRequest("Enter a valid email address.")
	}
	return strings.ToLower(s), nil
}

func validKdf(k store.KdfParams) error {
	// Clients may raise the cost but never go below the defaults.
	if k.V != 1 || k.Ops < defaultKdf.Ops || k.Ops > 10 || k.Mem < defaultKdf.Mem || k.Mem > 1<<30 {
		return errBadRequest("Unsupported key derivation parameters.")
	}
	return nil
}

func validWrapped(w store.Wrapped) error {
	if _, err := b64(w.Nonce, 24); err != nil {
		return err
	}
	_, err := b64(w.Ciphertext, 48) // 32-byte key + 16-byte tag
	return err
}

func label(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "Unknown device"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

func (a *Accounts) startSession(ctx context.Context, w http.ResponseWriter, userID uuid.UUID, deviceLabel string) (string, error) {
	token, hash, err := auth.NewToken()
	if err != nil {
		return "", err
	}
	now := a.Now()
	if _, err := a.Store.CreateSession(ctx, userID, hash, label(deviceLabel), now, now.Add(sessionLifetime)); err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", MaxAge: int(sessionLifetime.Seconds()),
		Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
	return token, nil
}

func clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
}

// wantsBearerToken is true for native clients that should receive the session
// token in the JSON body. Browser-shaped requests (Origin / Sec-Fetch-*) never
// get a body token, so XSS in the PWA can't mint a non-HttpOnly credential.
func wantsBearerToken(r *http.Request) bool {
	if r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" || r.Header.Get("Sec-Fetch-Mode") != "" {
		return false
	}
	return nativeClient(r.Header.Get("X-Dayrule-Client"))
}

// sessionCredential reads the Bearer token or the session cookie.
func sessionCredential(r *http.Request) (string, bool) {
	if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
		tok := strings.TrimSpace(strings.TrimPrefix(ah, "Bearer "))
		if tok != "" {
			return tok, true
		}
	}
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		return c.Value, true
	}
	return "", false
}

type sessionKey struct{}

func sessionFrom(ctx context.Context) *store.Session {
	s, _ := ctx.Value(sessionKey{}).(*store.Session)
	return s
}

// withSession requires a live session and slides its expiry forward.
func (a *Accounts) withSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok, ok := sessionCredential(r)
		if !ok {
			writeErr(w, errUnauthorized)
			return
		}
		now := a.Now()
		s, err := a.Store.SessionByToken(r.Context(), auth.TokenHash(tok), now)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				clearSession(w)
				writeErr(w, errUnauthorized)
			} else {
				writeErr(w, err)
			}
			return
		}
		if now.Sub(s.LastSeenAt) > time.Hour {
			_ = a.Store.TouchSession(r.Context(), s.ID, now, now.Add(sessionLifetime))
		}
		next(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	}
}

func (a *Accounts) send(ctx context.Context, m email.Message) {
	// A delivery failure mustn't change the response (that would reveal
	// whether an account exists), so it's only logged, without contents.
	if err := a.Email.Send(ctx, m); err != nil && a.Logger != nil {
		a.Logger.ErrorContext(ctx, "email send failed", "error", err)
	}
}

// ---------------------------------------------------------------------------
// Sign-up

func (a *Accounts) signupStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		InviteCode string `json:"inviteCode"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	addr, err := normEmail(req.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	if a.InviteOnly {
		ok, err := a.Store.InviteUsable(r.Context(), auth.InviteHash(req.InviteCode))
		if err != nil {
			writeErr(w, err)
			return
		}
		if !ok {
			writeErr(w, errBadInvite)
			return
		}
	}

	// Same response whether or not the email has an account (§11.3).
	defer writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})

	now := a.Now()
	recent, err := a.Store.RecentCodes(r.Context(), addr, "signup", now.Add(-15*time.Minute))
	if err != nil || recent >= 3 {
		return // rate limited: say nothing different
	}
	if _, err := a.Store.UserByEmail(r.Context(), addr); err == nil {
		// Same lifetime and shape as a real code so verify can't tell accounts
		// apart (wrong guesses → bad_code, not expired_code). Hash is random.
		if decoy, err := decoyCodeHash(); err == nil {
			_ = a.Store.CreateCode(r.Context(), addr, "signup", nil, decoy, now.Add(codeLifetime))
		}
		a.send(r.Context(), email.AlreadyRegistered(addr))
		return
	}
	code, err := auth.NewCode()
	if err != nil {
		return
	}
	if err := a.Store.CreateCode(r.Context(), addr, "signup", nil, a.Keys.CodeHash(addr, "signup", code), now.Add(codeLifetime)); err != nil {
		return
	}
	a.send(r.Context(), email.SignupCode(addr, code))
}

func (a *Accounts) checkCode(r *http.Request, addr, purpose, code string, tokenHash []byte) (*uuid.UUID, error) {
	want := a.Keys.CodeHash(addr, purpose, strings.TrimSpace(code))
	res, userID, err := a.Store.CheckCode(r.Context(), addr, purpose,
		func(stored []byte) bool { return auth.Equal(stored, want) },
		a.Now(), tokenHash, a.Now().Add(tokenLifetime))
	if err != nil {
		return nil, err
	}
	switch res {
	case store.CodeWrong:
		return nil, errBadCode
	case store.CodeExpired:
		return nil, errExpiredCode
	}
	return userID, nil
}

func (a *Accounts) signupVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	addr, err := normEmail(req.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := a.checkCode(r, addr, "signup", req.Code, hash); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"signupToken": token})
}

type credentials struct {
	Salt            string          `json:"salt"`
	Kdf             store.KdfParams `json:"kdf"`
	AuthKey         string          `json:"authKey"`
	WrappedPassword store.Wrapped   `json:"wrappedPassword"`
}

type parsedCreds struct {
	salt, authHash, authSalt []byte
	kdf                      store.KdfParams
	wrapped                  store.Wrapped
}

func parseCreds(c credentials) (parsedCreds, error) {
	salt, err := b64(c.Salt, 16)
	if err != nil {
		return parsedCreds{}, err
	}
	authKey, err := b64(c.AuthKey, 32)
	if err != nil {
		return parsedCreds{}, err
	}
	if err := validKdf(c.Kdf); err != nil {
		return parsedCreds{}, err
	}
	if err := validWrapped(c.WrappedPassword); err != nil {
		return parsedCreds{}, err
	}
	authSalt, authHash, err := auth.HashAuthKey(authKey)
	if err != nil {
		return parsedCreds{}, err
	}
	return parsedCreds{salt: salt, authHash: authHash, authSalt: authSalt, kdf: c.Kdf, wrapped: c.WrappedPassword}, nil
}

func proofHash(proof []byte) []byte {
	h := sha256.Sum256(proof)
	return h[:]
}

func (a *Accounts) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		credentials
		Email           string        `json:"email"`
		SignupToken     string        `json:"signupToken"`
		InviteCode      string        `json:"inviteCode"`
		UserID          string        `json:"userId"`
		WrappedRecovery store.Wrapped `json:"wrappedRecovery"`
		RecoveryProof   string        `json:"recoveryProof"`
		DeviceLabel     string        `json:"deviceLabel"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	addr, err := normEmail(req.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil || userID.Version() != 4 {
		writeErr(w, errBadRequest("Invalid user id."))
		return
	}
	creds, err := parseCreds(req.credentials)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := validWrapped(req.WrappedRecovery); err != nil {
		writeErr(w, err)
		return
	}
	proof, err := b64(req.RecoveryProof, 32)
	if err != nil {
		writeErr(w, err)
		return
	}
	var inviteHash []byte
	if a.InviteOnly {
		inviteHash = auth.InviteHash(req.InviteCode)
	}
	err = a.Store.Register(r.Context(), store.NewUser{
		ID: userID, Email: addr, KdfSalt: creds.salt, Kdf: creds.kdf, AuthHash: creds.authHash,
		AuthSalt: creds.authSalt, WrappedPassword: creds.wrapped, WrappedRecovery: req.WrappedRecovery,
		RecoveryProofHash: proofHash(proof),
	}, auth.TokenHash(req.SignupToken), inviteHash, a.Now())
	switch {
	case errors.Is(err, store.ErrBadToken):
		writeErr(w, errBadToken)
		return
	case errors.Is(err, store.ErrBadInvite):
		writeErr(w, errBadInvite)
		return
	case errors.Is(err, store.ErrConflict):
		writeErr(w, errBadToken) // email or id already taken: start again
		return
	case err != nil:
		writeErr(w, err)
		return
	}
	token, err := a.startSession(r.Context(), w, userID, req.DeviceLabel)
	if err != nil {
		writeErr(w, err)
		return
	}
	resp := map[string]any{"userId": userID.String()}
	if wantsBearerToken(r) {
		resp["token"] = token
	}
	writeJSON(w, http.StatusCreated, resp)
}

// ---------------------------------------------------------------------------
// Sign-in

func (a *Accounts) prelogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	addr, err := normEmail(req.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	salt, kdf := a.Keys.FakeSalt(addr), defaultKdf
	if u, err := a.Store.UserByEmail(r.Context(), addr); err == nil {
		salt, kdf = u.KdfSalt, u.Kdf
	} else if !errors.Is(err, store.ErrNotFound) {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"salt": base64.StdEncoding.EncodeToString(salt), "kdf": kdf})
}

// checkPassword verifies an AuthKey with lockout. Unknown emails and wrong
// AuthKeys fail the same way (bad_login). Lockout is only returned after a
// correct AuthKey, so a locked account can't be spotted without the password.
func (a *Accounts) checkPassword(ctx context.Context, u *store.User, authKeyB64 string) error {
	authKey, err := b64(authKeyB64, 32)
	if err != nil {
		return err
	}
	if u == nil {
		auth.BurnVerify(authKey)
		return errBadLogin
	}
	locked := u.LockedUntil != nil && u.LockedUntil.After(a.Now())
	if !auth.VerifyAuthKey(authKey, u.AuthSalt, u.AuthHash) {
		if !locked {
			if err := a.Store.RecordFailedLogin(ctx, u.ID, a.Now()); err != nil {
				return err
			}
		}
		return errBadLogin
	}
	if locked {
		return errLocked
	}
	if u.FailedLogins > 0 {
		return a.Store.ResetFailedLogins(ctx, u.ID)
	}
	return nil
}

func (a *Accounts) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		AuthKey     string `json:"authKey"`
		DeviceLabel string `json:"deviceLabel"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	addr, err := normEmail(req.Email)
	if err != nil {
		writeErr(w, err)
		return
	}
	u, err := a.Store.UserByEmail(r.Context(), addr)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeErr(w, err)
		return
	}
	if err := a.checkPassword(r.Context(), u, req.AuthKey); err != nil {
		writeErr(w, err)
		return
	}
	methods, err := a.secondStepMethods(r, u.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	if len(methods) > 0 {
		// A reset by email that has waited long enough takes effect now,
		// with the password just checked.
		reset, err := a.completeDueReset(r.Context(), u)
		if err != nil {
			writeErr(w, err)
			return
		}
		if !reset {
			a.startSecondStep(w, r, u.ID, req.DeviceLabel, methods)
			return
		}
	}
	a.signedIn(w, r, u, req.DeviceLabel)
}

// signedIn starts a session and hands over what the device needs to unlock:
// the password-wrapped account key and the key derivation parameters.
func (a *Accounts) signedIn(w http.ResponseWriter, r *http.Request, u *store.User, deviceLabel string) {
	token, err := a.startSession(r.Context(), w, u.ID, deviceLabel)
	if err != nil {
		writeErr(w, err)
		return
	}
	resp := map[string]any{
		"userId": u.ID.String(), "wrappedPassword": u.WrappedPassword,
		"salt": base64.StdEncoding.EncodeToString(u.KdfSalt), "kdf": u.Kdf,
	}
	if wantsBearerToken(r) {
		resp["token"] = token
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *Accounts) logout(w http.ResponseWriter, r *http.Request) {
	if tok, ok := sessionCredential(r); ok {
		if s, err := a.Store.SessionByToken(r.Context(), auth.TokenHash(tok), a.Now()); err == nil {
			_, _ = a.Store.DeleteSession(r.Context(), s.UserID, s.ID)
		}
	}
	clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Recovery: the recovery phrase proves ownership; the client unwraps the
// account key with it and sets a new password.

func (a *Accounts) checkRecovery(ctx context.Context, emailAddr, proofB64 string) (*store.User, error) {
	addr, err := normEmail(emailAddr)
	if err != nil {
		return nil, err
	}
	proof, err := b64(proofB64, 32)
	if err != nil {
		return nil, err
	}
	u, err := a.Store.UserByEmail(ctx, addr)
	if errors.Is(err, store.ErrNotFound) {
		return nil, apiError{http.StatusUnauthorized, "bad_recovery", "That email and recovery phrase don't match."}
	}
	if err != nil {
		return nil, err
	}
	if !auth.Equal(proofHash(proof), u.RecoveryProofHash) {
		return nil, apiError{http.StatusUnauthorized, "bad_recovery", "That email and recovery phrase don't match."}
	}
	return u, nil
}

func (a *Accounts) recoverStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email         string `json:"email"`
		RecoveryProof string `json:"recoveryProof"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, err := a.checkRecovery(r.Context(), req.Email, req.RecoveryProof)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"userId": u.ID.String(), "wrappedRecovery": u.WrappedRecovery})
}

func (a *Accounts) recoverComplete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		credentials
		Email         string `json:"email"`
		RecoveryProof string `json:"recoveryProof"`
		DeviceLabel   string `json:"deviceLabel"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, err := a.checkRecovery(r.Context(), req.Email, req.RecoveryProof)
	if err != nil {
		writeErr(w, err)
		return
	}
	creds, err := parseCreds(req.credentials)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := a.Store.UpdateCredentials(r.Context(), u.ID, creds.salt, creds.kdf, creds.authHash, creds.authSalt, creds.wrapped, nil); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.cancelPendingReset(r.Context(), u); err != nil {
		writeErr(w, err)
		return
	}
	token, err := a.startSession(r.Context(), w, u.ID, req.DeviceLabel)
	if err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.PasswordChanged(u.Email))
	resp := map[string]any{"userId": u.ID.String()}
	if wantsBearerToken(r) {
		resp["token"] = token
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---------------------------------------------------------------------------
// Account

func (a *Accounts) currentUser(w http.ResponseWriter, r *http.Request) (*store.User, *store.Session, bool) {
	s := sessionFrom(r.Context())
	u, err := a.Store.UserByID(r.Context(), s.UserID)
	if err != nil {
		writeErr(w, errUnauthorized)
		return nil, nil, false
	}
	return u, s, true
}

func (a *Accounts) account(w http.ResponseWriter, r *http.Request) {
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"userId": u.ID.String(), "email": u.Email})
}

func (a *Accounts) changePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		credentials
		CurrentAuthKey string `json:"currentAuthKey"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, s, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	creds, err := parseCreds(req.credentials)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := a.Store.UpdateCredentials(r.Context(), u.ID, creds.salt, creds.kdf, creds.authHash, creds.authSalt, creds.wrapped, &s.ID); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.cancelPendingReset(r.Context(), u); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.PasswordChanged(u.Email))
	w.WriteHeader(http.StatusNoContent)
}

func (a *Accounts) emailStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewEmail       string `json:"newEmail"`
		CurrentAuthKey string `json:"currentAuthKey"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	addr, err := normEmail(req.NewEmail)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	defer writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
	now := a.Now()
	if n, err := a.Store.RecentCodes(r.Context(), addr, "email_change", now.Add(-15*time.Minute)); err != nil || n >= 3 {
		return
	}
	if _, err := a.Store.UserByEmail(r.Context(), addr); err == nil {
		if decoy, err := decoyCodeHash(); err == nil {
			_ = a.Store.CreateCode(r.Context(), addr, "email_change", &u.ID, decoy, now.Add(codeLifetime))
		}
		a.send(r.Context(), email.AlreadyRegistered(addr))
		return
	}
	code, err := auth.NewCode()
	if err != nil {
		return
	}
	if err := a.Store.CreateCode(r.Context(), addr, "email_change", &u.ID, a.Keys.CodeHash(addr, "email_change", code), now.Add(codeLifetime)); err != nil {
		return
	}
	a.send(r.Context(), email.EmailChangeCode(addr, code))
}

func (a *Accounts) emailVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewEmail string `json:"newEmail"`
		Code     string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	addr, err := normEmail(req.NewEmail)
	if err != nil {
		writeErr(w, err)
		return
	}
	owner, err := a.checkCode(r, addr, "email_change", req.Code, nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	if owner == nil || *owner != u.ID {
		writeErr(w, errExpiredCode)
		return
	}
	if err := a.Store.UpdateEmail(r.Context(), u.ID, addr); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, errExpiredCode)
			return
		}
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.EmailChanged(u.Email, addr))
	writeJSON(w, http.StatusOK, map[string]string{"email": addr})
}

func (a *Accounts) listSessions(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	list, err := a.Store.ListSessions(r.Context(), s.UserID, a.Now())
	if err != nil {
		writeErr(w, err)
		return
	}
	type out struct {
		ID          string    `json:"id"`
		DeviceLabel string    `json:"deviceLabel"`
		CreatedAt   time.Time `json:"createdAt"`
		LastSeenAt  time.Time `json:"lastSeenAt"`
		Current     bool      `json:"current"`
	}
	res := make([]out, 0, len(list))
	for _, x := range list {
		res = append(res, out{x.ID.String(), x.DeviceLabel, x.CreatedAt, x.LastSeenAt, x.ID == s.ID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": res})
}

func (a *Accounts) revokeSession(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, errBadRequest("Invalid session."))
		return
	}
	found, err := a.Store.DeleteSession(r.Context(), s.UserID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !found {
		writeErr(w, apiError{http.StatusNotFound, "not_found", "That device isn't signed in."})
		return
	}
	if id == s.ID {
		clearSession(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *Accounts) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AuthKey string `json:"authKey"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	if err := a.checkPassword(r.Context(), u, req.AuthKey); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.Store.DeleteUser(r.Context(), u.ID); err != nil {
		writeErr(w, err)
		return
	}
	clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}
