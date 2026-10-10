package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Two-step sign-in (PLAN.md §10.2, decision 30): after a correct password,
// an account with a passkey or an authenticator app (TOTP) gets a token for
// a second step instead of a session. Passkeys are in passkeys.go; this file
// has the step itself, TOTP and backup codes.

const (
	// maxCodeAttempts caps the codes tried in one sign-in's second step;
	// wrong codes also count towards a lockout across sign-ins.
	maxCodeAttempts = 5
	// totpSetupAttempts caps the wrong codes while setting TOTP up.
	totpSetupAttempts = 5
	// resetWait is how long a reset by email waits before it takes effect,
	// with notices to the account address, so the owner can stop it.
	resetWait = 7 * 24 * time.Hour
	// resetPurpose is the email code purpose for asking for a reset.
	resetPurpose = "two_step_reset"
)

var (
	errSetupExpired = apiError{http.StatusBadRequest, "bad_ceremony", "That took too long. Start again."}
	errNoSecondStep = apiError{http.StatusConflict, "no_second_step",
		"Add a passkey or an authenticator app first. Backup codes are for when you can't use them."}
)

func (a *Accounts) twoStepRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login/code", a.loginCode)
	mux.HandleFunc("POST /api/v1/auth/login/reset/start", a.resetStart)
	mux.HandleFunc("POST /api/v1/auth/login/reset/confirm", a.resetConfirm)
	mux.HandleFunc("DELETE /api/v1/account/two-step/reset", a.withSession(a.resetCancel))
	mux.HandleFunc("GET /api/v1/account/two-step", a.withSession(a.twoStepStatus))
	mux.HandleFunc("POST /api/v1/account/totp/start", a.withSession(a.totpStart))
	mux.HandleFunc("POST /api/v1/account/totp", a.withSession(a.totpConfirm))
	mux.HandleFunc("DELETE /api/v1/account/totp", a.withSession(a.totpDelete))
	mux.HandleFunc("POST /api/v1/account/backup-codes", a.withSession(a.backupCodes))
}

func (a *Accounts) twoStep() store.TwoStep { return store.TwoStep{Accounts: a.Store} }

// ceremonies holds sign-in second steps, whichever method answers them.
func (a *Accounts) ceremonies() store.Passkeys { return store.Passkeys{Accounts: a.Store} }

// ---------------------------------------------------------------------------
// The second step at sign-in

// secondStepMethods lists the ways an account can finish signing in after
// its password: none means the password is enough. Every passkey counts,
// whatever its site, so asking from an origin without one can't skip the
// step. Backup codes are offered only alongside another method.
func (a *Accounts) secondStepMethods(r *http.Request, userID uuid.UUID) ([]string, error) {
	m, err := a.twoStep().Methods(r.Context(), userID)
	if err != nil {
		return nil, err
	}
	var out []string
	if m.Passkeys > 0 && a.Passkeys != nil {
		out = append(out, "passkey")
	}
	if m.TOTP {
		out = append(out, "totp")
	}
	if len(out) > 0 && m.BackupCodes > 0 {
		out = append(out, "backup")
	}
	return out, nil
}

// startSecondStep answers a correct password on an account with a second
// step: no session and no wrapped key yet, only a token for the step.
func (a *Accounts) startSecondStep(w http.ResponseWriter, r *http.Request, userID uuid.UUID, deviceLabel string,
	methods []string) {
	token, hash, err := auth.NewToken()
	if err != nil {
		writeErr(w, err)
		return
	}
	c := store.Ceremony{UserID: userID, Purpose: store.CeremonyLogin, DeviceLabel: label(deviceLabel)}
	if err := a.ceremonies().StartCeremony(r.Context(), hash, c, nil, a.Now().Add(ceremonyLifetime)); err != nil {
		writeErr(w, err)
		return
	}
	reset, err := a.twoStep().PendingReset(r.Context(), userID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"secondStep": map[string]any{
		"token": token, "methods": methods, "resetDueAt": reset,
	}})
}

// cancelPendingReset cancels a reset by email, with a notice. It runs when
// a passkey or code finishes a sign-in (the owner has a second step after
// all) and when the password changes (the reset was asked for with the old
// one).
func (a *Accounts) cancelPendingReset(ctx context.Context, u *store.User) error {
	cancelled, err := a.twoStep().CancelReset(ctx, u.ID)
	if cancelled {
		a.send(ctx, email.TwoStepResetCancelled(u.Email))
	}
	return err
}

// completeDueReset turns two-step sign-in off if a reset by email is due,
// at a sign-in whose password was just checked.
func (a *Accounts) completeDueReset(ctx context.Context, u *store.User) (bool, error) {
	done, err := a.twoStep().CompleteReset(ctx, u.ID, a.Now())
	if done {
		a.send(ctx, email.TwoStepResetDone(u.Email))
	}
	return done, err
}

// ---------------------------------------------------------------------------
// Turning two-step sign-in off by email (PLAN.md §10.2): for someone who
// has their password but none of their second steps or backup codes. Email
// access alone never decrypts anything, and the wait gives the owner a week
// of notices to stop it.

// resetStart emails a code to the account address. The token from the
// password step shows the password was right.
func (a *Accounts) resetStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	userID, err := a.ceremonies().LiveCeremony(r.Context(), auth.TokenHash(req.Token), store.CeremonyLogin, a.Now())
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	u, err := a.Store.UserByID(r.Context(), userID)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	if due, err := a.twoStep().PendingReset(r.Context(), u.ID); err != nil || due != nil {
		if err != nil {
			writeErr(w, err)
		} else {
			writeJSON(w, http.StatusOK, map[string]any{"resetDueAt": due})
		}
		return
	}
	now := a.Now()
	recent, err := a.Store.RecentCodes(r.Context(), u.Email, resetPurpose, now.Add(-time.Hour))
	if err != nil {
		writeErr(w, err)
		return
	}
	if recent >= 3 {
		writeErr(w, apiError{http.StatusTooManyRequests, "too_many_codes", "Too many codes sent. Try again in an hour."})
		return
	}
	code, err := auth.NewCode()
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := a.Store.CreateCode(r.Context(), u.Email, resetPurpose, &u.ID,
		a.Keys.CodeHash(u.Email, resetPurpose, code), now.Add(codeLifetime)); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.TwoStepResetCode(u.Email, code))
	writeJSON(w, http.StatusAccepted, map[string]bool{"sent": true})
}

// resetConfirm takes the emailed code and starts the wait. The code was
// only sent after the password, so it stands for both.
func (a *Accounts) resetConfirm(w http.ResponseWriter, r *http.Request) {
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
	userID, err := a.checkCode(r, addr, resetPurpose, req.Code, nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	if userID == nil {
		writeErr(w, errExpiredCode)
		return
	}
	u, err := a.Store.UserByID(r.Context(), *userID)
	if err != nil {
		writeErr(w, errExpiredCode)
		return
	}
	now := a.Now()
	due, created, err := a.twoStep().RequestReset(r.Context(), u.ID, now, now.Add(resetWait))
	if err != nil {
		writeErr(w, err)
		return
	}
	if created {
		a.send(r.Context(), email.TwoStepResetRequested(u.Email, due))
	}
	writeJSON(w, http.StatusOK, map[string]any{"resetDueAt": due})
}

func (a *Accounts) resetCancel(w http.ResponseWriter, r *http.Request) {
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	cancelled, err := a.twoStep().CancelReset(r.Context(), u.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !cancelled {
		writeErr(w, apiError{http.StatusNotFound, "not_found", "Nothing is waiting to be turned off."})
		return
	}
	a.send(r.Context(), email.TwoStepResetCancelled(u.Email))
	w.WriteHeader(http.StatusNoContent)
}

// RemindResets warns the accounts whose reset is due within a day. It runs
// from the daily cron job.
func (a *Accounts) RemindResets(ctx context.Context) (int, error) {
	due, err := a.twoStep().ResetsDueSoon(ctx, a.Now(), 24*time.Hour)
	for _, n := range due {
		a.send(ctx, email.TwoStepResetSoon(n.Email, n.DueAt))
	}
	return len(due), err
}

// loginCode finishes a sign-in with a code from an authenticator app or a
// backup code.
func (a *Accounts) loginCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
		Code  string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	hash := auth.TokenHash(req.Token)
	c, err := a.ceremonies().CodeAttempt(r.Context(), hash, a.Now(), maxCodeAttempts)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	u, err := a.Store.UserByID(r.Context(), c.UserID)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	ts := a.twoStep()
	switch locked, err := ts.SecondStepLocked(r.Context(), u.ID, a.Now()); {
	case err != nil:
		writeErr(w, err)
		return
	case locked:
		writeErr(w, errLocked)
		return
	}
	ok, err := a.checkStepCode(r, u, auth.NormalizeCode(req.Code))
	if err != nil {
		writeErr(w, err)
		return
	}
	if !ok {
		if err := ts.SecondStepFailed(r.Context(), u.ID, a.Now()); err != nil {
			writeErr(w, err)
			return
		}
		writeErr(w, errBadCode)
		return
	}
	if err := ts.SecondStepPassed(r.Context(), u.ID); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.cancelPendingReset(r.Context(), u); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.ceremonies().EndCeremony(r.Context(), hash); err != nil {
		writeErr(w, err)
		return
	}
	a.signedIn(w, r, u, c.DeviceLabel)
}

// checkStepCode checks a second-step code: six digits from the authenticator
// app, or an unused backup code, which it uses up.
func (a *Accounts) checkStepCode(r *http.Request, u *store.User, code string) (bool, error) {
	ts := a.twoStep()
	if auth.IsBackupCode(code) {
		m, err := ts.Methods(r.Context(), u.ID)
		if err != nil || (m.Passkeys == 0 && !m.TOTP) {
			return false, err
		}
		left, err := ts.UseBackupCode(r.Context(), u.ID, a.Keys.BackupCodeHash(u.ID.String(), code))
		if errors.Is(err, store.ErrNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		a.send(r.Context(), email.BackupCodeUsed(u.Email, left))
		return true, nil
	}
	t, err := ts.TOTP(r.Context(), u.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && t.ConfirmedAt == nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	secret, err := a.Keys.OpenTOTP(t.Sealed, u.ID[:])
	if err != nil {
		return false, err
	}
	step, ok := auth.MatchTOTP(secret, code, a.Now(), t.LastStep)
	if !ok {
		return false, nil
	}
	// Recorded atomically, so a code raced through two requests works once.
	if err := ts.UseTOTP(r.Context(), u.ID, step, a.Now()); errors.Is(err, store.ErrConflict) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, nil
}

// ---------------------------------------------------------------------------
// Managing TOTP and backup codes (signed in)

func (a *Accounts) twoStepStatus(w http.ResponseWriter, r *http.Request) {
	userID := sessionFrom(r.Context()).UserID
	ts := a.twoStep()
	m, err := ts.Methods(r.Context(), userID)
	if err != nil {
		writeErr(w, err)
		return
	}
	reset, err := ts.PendingReset(r.Context(), userID)
	if err != nil {
		writeErr(w, err)
		return
	}
	out := map[string]any{"passkeys": m.Passkeys, "totp": nil, "backupCodes": m.BackupCodes, "resetDueAt": reset}
	if m.TOTP {
		t, err := ts.TOTP(r.Context(), userID)
		if err != nil {
			writeErr(w, err)
			return
		}
		out["totp"] = map[string]any{"addedAt": t.ConfirmedAt, "lastUsedAt": t.LastUsedAt}
	}
	writeJSON(w, http.StatusOK, out)
}

// totpStart makes a new secret for the authenticator app. TOTP is on only
// once a code from it is entered (totpConfirm).
func (a *Accounts) totpStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
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
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		writeErr(w, err)
		return
	}
	sealed, err := a.Keys.SealTOTP(secret, u.ID[:])
	if err != nil {
		writeErr(w, err)
		return
	}
	switch err := a.twoStep().StartTOTP(r.Context(), u.ID, sealed, a.Now()); {
	case errors.Is(err, store.ErrConflict):
		writeErr(w, apiError{http.StatusConflict, "totp_exists",
			"An authenticator app is already set up. Remove it first to set up another."})
		return
	case err != nil:
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret": auth.TOTPSecretText(secret), "uri": auth.TOTPURI(secret, "Dayrule", u.Email),
	})
}

func (a *Accounts) totpConfirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	u, _, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	ts := a.twoStep()
	t, err := ts.TOTP(r.Context(), u.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && (t.ConfirmedAt != nil ||
		a.Now().Sub(t.CreatedAt) > codeLifetime || t.Attempts >= totpSetupAttempts)) {
		writeErr(w, errSetupExpired)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	secret, err := a.Keys.OpenTOTP(t.Sealed, u.ID[:])
	if err != nil {
		writeErr(w, err)
		return
	}
	step, match := auth.MatchTOTP(secret, auth.NormalizeCode(req.Code), a.Now(), 0)
	if !match {
		if err := ts.SetupFailed(r.Context(), u.ID); err != nil {
			writeErr(w, err)
			return
		}
		writeErr(w, errBadCode)
		return
	}
	if err := ts.ConfirmTOTP(r.Context(), u.ID, step, a.Now()); errors.Is(err, store.ErrNotFound) {
		writeErr(w, errSetupExpired)
		return
	} else if err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.TOTPAdded(u.Email))
	w.WriteHeader(http.StatusNoContent)
}

func (a *Accounts) totpDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
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
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	ts := a.twoStep()
	on, err := ts.DeleteTOTP(r.Context(), u.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !on {
		writeErr(w, apiError{http.StatusNotFound, "not_found", "No authenticator app is set up."})
		return
	}
	if _, err := ts.DropUnneededBackupCodes(r.Context(), u.ID); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.TOTPRemoved(u.Email))
	w.WriteHeader(http.StatusNoContent)
}

// backupCodes makes a new set of backup codes, replacing any old ones. They
// are returned once and stored only as keyed hashes.
func (a *Accounts) backupCodes(w http.ResponseWriter, r *http.Request) {
	var req struct {
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
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	ts := a.twoStep()
	m, err := ts.Methods(r.Context(), u.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	if m.Passkeys == 0 && !m.TOTP {
		writeErr(w, errNoSecondStep)
		return
	}
	codes, err := auth.NewBackupCodes()
	if err != nil {
		writeErr(w, err)
		return
	}
	hashes := make([][]byte, len(codes))
	for i, c := range codes {
		hashes[i] = a.Keys.BackupCodeHash(u.ID.String(), c)
	}
	if err := ts.ReplaceBackupCodes(r.Context(), u.ID, hashes); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.BackupCodesMade(u.Email))
	writeJSON(w, http.StatusCreated, map[string]any{"codes": codes})
}
