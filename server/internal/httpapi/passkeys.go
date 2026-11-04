package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Passkeys serves passkeys as a second sign-in step (PLAN.md §10.2,
// decision 30). The server verifies each WebAuthn assertion; the passkey
// never unlocks anything, so the password still decrypts the data.
type Passkeys struct {
	Store store.Passkeys
	// One relying party per origin the app is served on. The RP ID is the
	// exact host, so a passkey made on preview never works on production.
	rps map[string]*webauthn.WebAuthn
}

const (
	ceremonyLifetime = 5 * time.Minute
	// maxChallenges caps the options requests per ceremony: a cancelled or
	// failed prompt can be retried a few times before the password is
	// needed again.
	maxChallenges = 5
)

// NewPasskeys sets up a relying party for each origin, such as
// "https://dayrule.app".
func NewPasskeys(st store.Passkeys, origins []string) (*Passkeys, error) {
	p := &Passkeys{Store: st, rps: map[string]*webauthn.WebAuthn{}}
	for _, o := range origins {
		u, err := url.Parse(o)
		if err != nil || u.Host == "" || u.Path != "" || (u.Scheme != "https" && u.Hostname() != "localhost") {
			return nil, fmt.Errorf("passkey origin %q: want scheme://host[:port]", o)
		}
		wa, err := webauthn.New(&webauthn.Config{RPID: u.Hostname(), RPDisplayName: "Dayrule", RPOrigins: []string{o}})
		if err != nil {
			return nil, fmt.Errorf("passkey origin %q: %w", o, err)
		}
		p.rps[o] = wa
	}
	return p, nil
}

func (a *Accounts) passkeyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login/passkey/options", a.loginPasskeyOptions)
	mux.HandleFunc("POST /api/v1/auth/login/passkey", a.loginPasskey)
	mux.HandleFunc("GET /api/v1/account/passkeys", a.withSession(a.listPasskeys))
	mux.HandleFunc("POST /api/v1/account/passkeys/options", a.withSession(a.passkeyOptions))
	mux.HandleFunc("POST /api/v1/account/passkeys", a.withSession(a.addPasskey))
	mux.HandleFunc("DELETE /api/v1/account/passkeys/{id}", a.withSession(a.deletePasskey))
}

var (
	errPasskeyOrigin  = apiError{http.StatusBadRequest, "passkey_origin", "Passkeys work only on dayrule.app."}
	errBadCeremony    = apiError{http.StatusBadRequest, "bad_ceremony", "That took too long. Start again."}
	errBadPasskey     = apiError{http.StatusUnauthorized, "bad_passkey", "That passkey didn't work. Try again."}
	errNoSitePasskeys = apiError{http.StatusBadRequest, "no_passkey", "You have no passkey for this site. Use your recovery phrase."}
)

// rp picks the relying party for the page that sent the request.
// Browsers send Origin. Native URLSession clients do not (native PLAN §9.3);
// those use the production RP when configured, otherwise the sole configured
// origin (local/dev).
func (p *Passkeys) rp(r *http.Request) (*webauthn.WebAuthn, error) {
	if origin := r.Header.Get("Origin"); origin != "" {
		if wa, ok := p.rps[origin]; ok {
			return wa, nil
		}
		return nil, errPasskeyOrigin
	}
	if nativeClient(r.Header.Get("X-Dayrule-Client")) {
		if wa, ok := p.rps["https://dayrule.app"]; ok {
			return wa, nil
		}
		if len(p.rps) == 1 {
			for _, wa := range p.rps {
				return wa, nil
			}
		}
	}
	return nil, errPasskeyOrigin
}

// passkeyUser is the account as go-webauthn sees it: the user handle (not
// the user id), the email as the name, and the passkeys for one RP.
type passkeyUser struct {
	handle []byte
	email  string
	creds  []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte                         { return u.handle }
func (u passkeyUser) WebAuthnName() string                       { return u.email }
func (u passkeyUser) WebAuthnDisplayName() string                { return u.email }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (a *Accounts) passkeyUser(r *http.Request, wa *webauthn.WebAuthn, u *store.User) (passkeyUser, error) {
	handle, err := a.Passkeys.Store.Handle(r.Context(), u.ID)
	if err != nil {
		return passkeyUser{}, err
	}
	keys, err := a.Passkeys.Store.List(r.Context(), u.ID)
	if err != nil {
		return passkeyUser{}, err
	}
	pu := passkeyUser{handle: handle, email: u.Email}
	for _, k := range keys {
		if k.RPID == wa.Config.RPID {
			pu.creds = append(pu.creds, toCredential(k))
		}
	}
	return pu, nil
}

func toCredential(k store.Passkey) webauthn.Credential {
	c := webauthn.Credential{
		ID: k.CredentialID, PublicKey: k.PublicKey,
		AttestationType: k.AttestationType, AttestationFormat: k.AttestationFormat,
		Flags: webauthn.NewCredentialFlags(protocol.AuthenticatorFlags(k.Flags)),
		Authenticator: webauthn.Authenticator{
			AAGUID: k.AAGUID, SignCount: uint32(k.SignCount), CloneWarning: k.CloneWarning,
			Attachment: protocol.AuthenticatorAttachment(k.Attachment),
		},
	}
	for _, t := range k.Transports {
		c.Transport = append(c.Transport, protocol.AuthenticatorTransport(t))
	}
	return c
}

func fromCredential(c *webauthn.Credential, rpID, label string) store.Passkey {
	k := store.Passkey{
		CredentialID: c.ID, RPID: rpID, PublicKey: c.PublicKey, SignCount: int64(c.Authenticator.SignCount),
		CloneWarning: c.Authenticator.CloneWarning, Flags: uint8(c.Flags.ProtocolValue()),
		AAGUID: c.Authenticator.AAGUID, Attachment: string(c.Authenticator.Attachment),
		AttestationType: c.AttestationType, AttestationFormat: c.AttestationFormat, Label: label,
	}
	for _, t := range c.Transport {
		k.Transports = append(k.Transports, string(t))
	}
	return k
}

func passkeyLabel(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "Passkey"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

func passkeyID(id []byte) string { return base64.RawURLEncoding.EncodeToString(id) }

// ---------------------------------------------------------------------------
// Sign-in second step

func (a *Accounts) loginPasskeyOptions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if a.Passkeys == nil {
		writeErr(w, errBadCeremony)
		return
	}
	wa, err := a.Passkeys.rp(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	hash := auth.TokenHash(req.Token)
	userID, err := a.Passkeys.Store.CeremonyUser(r.Context(), hash, store.CeremonyLogin, a.Now(), maxChallenges)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	u, err := a.Store.UserByID(r.Context(), userID)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	pu, err := a.passkeyUser(r, wa, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	if len(pu.creds) == 0 {
		writeErr(w, errNoSitePasskeys)
		return
	}
	options, session, err := wa.BeginLogin(pu, webauthn.WithUserVerification(protocol.VerificationPreferred))
	if err != nil {
		writeErr(w, err)
		return
	}
	if !a.issueChallenge(w, r, hash, store.CeremonyLogin, session) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": options})
}

func (a *Accounts) loginPasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token      string          `json:"token"`
		Credential json.RawMessage `json:"credential"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if a.Passkeys == nil {
		writeErr(w, errBadCeremony)
		return
	}
	wa, err := a.Passkeys.rp(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	hash := auth.TokenHash(req.Token)
	c, session, err := a.takeChallenge(r, hash, store.CeremonyLogin)
	if err != nil {
		writeErr(w, err)
		return
	}
	u, err := a.Store.UserByID(r.Context(), c.UserID)
	if err != nil {
		writeErr(w, ceremonyErr(err))
		return
	}
	pu, err := a.passkeyUser(r, wa, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(req.Credential)
	if err != nil {
		writeErr(w, errBadPasskey)
		return
	}
	cred, err := wa.ValidateLogin(pu, *session, parsed)
	if err != nil {
		writeErr(w, errBadPasskey)
		return
	}
	k := fromCredential(cred, wa.Config.RPID, "")
	if err := a.Passkeys.Store.Used(r.Context(), u.ID, k.CredentialID, k.SignCount, k.CloneWarning, k.Flags, a.Now()); err != nil {
		writeErr(w, err)
		return
	}
	if cred.Authenticator.CloneWarning {
		// The signature counter went backwards: two copies of this passkey
		// may exist. Recorded above, and refused.
		writeErr(w, apiError{http.StatusUnauthorized, "passkey_cloned",
			"This passkey may have been copied, so it can't be used. Use another passkey or your recovery phrase."})
		return
	}
	if err := a.cancelPendingReset(r.Context(), u); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.Passkeys.Store.EndCeremony(r.Context(), hash); err != nil {
		writeErr(w, err)
		return
	}
	a.signedIn(w, r, u, c.DeviceLabel)
}

// ---------------------------------------------------------------------------
// Managing passkeys (signed in)

func (a *Accounts) listPasskeys(w http.ResponseWriter, r *http.Request) {
	if a.Passkeys == nil {
		writeJSON(w, http.StatusOK, map[string]any{"passkeys": []any{}})
		return
	}
	keys, err := a.Passkeys.Store.List(r.Context(), sessionFrom(r.Context()).UserID)
	if err != nil {
		writeErr(w, err)
		return
	}
	out := make([]map[string]any, len(keys))
	for i, k := range keys {
		out[i] = map[string]any{"id": passkeyID(k.CredentialID), "label": k.Label, "site": k.RPID,
			"createdAt": k.CreatedAt, "lastUsedAt": k.LastUsedAt}
	}
	writeJSON(w, http.StatusOK, map[string]any{"passkeys": out})
}

func (a *Accounts) passkeyOptions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentAuthKey string `json:"currentAuthKey"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if a.Passkeys == nil {
		writeErr(w, errPasskeyOrigin)
		return
	}
	wa, err := a.Passkeys.rp(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	u, s, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	// Adding a sign-in step needs the password too, not just a session. It
	// is checked here, before the authenticator makes a passkey.
	if err := a.checkPassword(r.Context(), u, req.CurrentAuthKey); err != nil {
		writeErr(w, err)
		return
	}
	pu, err := a.passkeyUser(r, wa, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	exclude := make([]protocol.CredentialDescriptor, len(pu.creds))
	for i, c := range pu.creds {
		exclude[i] = c.Descriptor()
	}
	options, session, err := wa.BeginRegistration(pu,
		webauthn.WithExclusions(exclude),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			// Discoverable where possible, so a later version can sign in
			// with the passkey alone (PLAN.md §10.2, "Later").
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		writeErr(w, err)
		return
	}
	data, err := json.Marshal(session)
	if err != nil {
		writeErr(w, err)
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		writeErr(w, err)
		return
	}
	c := store.Ceremony{UserID: u.ID, Purpose: store.CeremonyRegister, SessionID: &s.ID}
	if err := a.Passkeys.Store.StartCeremony(r.Context(), hash, c, data, a.Now().Add(ceremonyLifetime)); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "options": options})
}

func (a *Accounts) addPasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token      string          `json:"token"`
		Credential json.RawMessage `json:"credential"`
		Label      string          `json:"label"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if a.Passkeys == nil {
		writeErr(w, errPasskeyOrigin)
		return
	}
	wa, err := a.Passkeys.rp(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	// The password was checked when this ceremony started, in this session.
	u, s, ok := a.currentUser(w, r)
	if !ok {
		return
	}
	hash := auth.TokenHash(req.Token)
	c, session, err := a.takeChallenge(r, hash, store.CeremonyRegister)
	if err != nil {
		writeErr(w, err)
		return
	}
	if c.UserID != u.ID || c.SessionID == nil || *c.SessionID != s.ID {
		writeErr(w, errBadCeremony)
		return
	}
	pu, err := a.passkeyUser(r, wa, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(req.Credential)
	if err != nil {
		writeErr(w, errBadPasskey)
		return
	}
	cred, err := wa.CreateCredential(pu, *session, parsed)
	if err != nil {
		writeErr(w, errBadPasskey)
		return
	}
	k := fromCredential(cred, wa.Config.RPID, passkeyLabel(req.Label))
	switch err := a.Passkeys.Store.Add(r.Context(), u.ID, k, a.Now()); {
	case errors.Is(err, store.ErrTooMany):
		writeErr(w, apiError{http.StatusConflict, "too_many_passkeys",
			fmt.Sprintf("You can have up to %d passkeys. Remove one first.", store.MaxPasskeys)})
		return
	case errors.Is(err, store.ErrConflict):
		writeErr(w, apiError{http.StatusConflict, "passkey_exists", "That passkey is already added."})
		return
	case err != nil:
		writeErr(w, err)
		return
	}
	if err := a.Passkeys.Store.EndCeremony(r.Context(), hash); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.PasskeyAdded(u.Email, k.Label))
	writeJSON(w, http.StatusCreated, map[string]any{"id": passkeyID(k.CredentialID), "label": k.Label, "site": k.RPID})
}

func (a *Accounts) deletePasskey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentAuthKey string `json:"currentAuthKey"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	id, err := base64.RawURLEncoding.DecodeString(r.PathValue("id"))
	if err != nil || len(id) == 0 || a.Passkeys == nil {
		writeErr(w, apiError{http.StatusNotFound, "not_found", "That passkey isn't on your account."})
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
	lbl, err := a.Passkeys.Store.Delete(r.Context(), u.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, apiError{http.StatusNotFound, "not_found", "That passkey isn't on your account."})
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := a.twoStep().DropUnneededBackupCodes(r.Context(), u.ID); err != nil {
		writeErr(w, err)
		return
	}
	a.send(r.Context(), email.PasskeyRemoved(u.Email, lbl))
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Ceremony helpers

func ceremonyErr(err error) error {
	if errors.Is(err, store.ErrNotFound) {
		return errBadCeremony
	}
	return err
}

func (a *Accounts) issueChallenge(w http.ResponseWriter, r *http.Request, hash []byte, purpose string,
	session *webauthn.SessionData) bool {
	data, err := json.Marshal(session)
	if err != nil {
		writeErr(w, err)
		return false
	}
	if err := a.Passkeys.Store.IssueChallenge(r.Context(), hash, purpose, data, a.Now(), maxChallenges); err != nil {
		writeErr(w, ceremonyErr(err))
		return false
	}
	return true
}

// takeChallenge claims a ceremony's outstanding challenge, once.
func (a *Accounts) takeChallenge(r *http.Request, hash []byte, purpose string) (*store.Ceremony, *webauthn.SessionData, error) {
	c, err := a.Passkeys.Store.TakeChallenge(r.Context(), hash, purpose, a.Now())
	if err != nil {
		return nil, nil, ceremonyErr(err)
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(c.Data, &session); err != nil {
		return nil, nil, err
	}
	return c, &session, nil
}
