// Package email sends Dayrule's few transactional emails (PLAN.md §11.6):
// sign-up and email-change codes, and account notices. Emails never contain
// user content.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Message is one email.
type Message struct {
	To      string
	Subject string
	Text    string
}

// Sender delivers messages.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Resend sends through the Resend HTTP API.
type Resend struct {
	APIKey string
	From   string
	Client *http.Client
}

func (r Resend) Send(ctx context.Context, m Message) error {
	body, err := json.Marshal(map[string]any{
		"from":    r.From,
		"to":      []string{m.To},
		"subject": m.Subject,
		"text":    m.Text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("resend: status %d", resp.StatusCode)
	}
	return nil
}

// Log prints emails instead of sending them. Only for local development,
// when RESEND_API_KEY isn't set.
type Log struct{ Logger *slog.Logger }

func (l Log) Send(_ context.Context, m Message) error {
	l.Logger.Warn("email not sent (no RESEND_API_KEY); local development only",
		"to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

// Memory records emails, for tests.
type Memory struct {
	mu   sync.Mutex
	Sent []Message
}

func (m *Memory) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Sent = append(m.Sent, msg)
	return nil
}

// Last returns the most recent message to an address.
func (m *Memory) Last(to string) (Message, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.Sent) - 1; i >= 0; i-- {
		if m.Sent[i].To == to {
			return m.Sent[i], true
		}
	}
	return Message{}, false
}

// Templates. Plain text only; no tracking.

func SignupCode(to, code string) Message {
	return Message{To: to, Subject: "Your Dayrule code: " + code, Text: fmt.Sprintf(
		"Your code to finish signing up to Dayrule is:\n\n    %s\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email.\n", code)}
}

func AlreadyRegistered(to string) Message {
	return Message{To: to, Subject: "You already have a Dayrule account", Text: "Someone (hopefully you) tried to sign up to Dayrule with this email address, but it already has an account.\n\nSign in at https://dayrule.app. If you've forgotten your password, use your 24-word recovery phrase.\n\nIf this wasn't you, you can ignore this email.\n"}
}

func EmailChangeCode(to, code string) Message {
	return Message{To: to, Subject: "Your Dayrule code: " + code, Text: fmt.Sprintf(
		"Your code to change your Dayrule sign-in email to this address is:\n\n    %s\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email.\n", code)}
}

func EmailChanged(to, newEmail string) Message {
	return Message{To: to, Subject: "Your Dayrule email was changed", Text: fmt.Sprintf(
		"The sign-in email for your Dayrule account was changed to %s.\n\nIf you didn't do this, sign in with your recovery phrase straight away and change your password.\n", newEmail)}
}

func PasswordChanged(to string) Message {
	return Message{To: to, Subject: "Your Dayrule password was changed", Text: "Your Dayrule password was changed and your other devices were signed out.\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away.\n"}
}

func PasskeyAdded(to, label string) Message {
	return Message{To: to, Subject: "A passkey was added to your Dayrule account", Text: fmt.Sprintf(
		"A passkey (%q) was added to your Dayrule account. Signing in now needs your password and a passkey.\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away, then remove the passkey under Account.\n", label)}
}

func PasskeyRemoved(to, label string) Message {
	return Message{To: to, Subject: "A passkey was removed from your Dayrule account", Text: fmt.Sprintf(
		"The passkey %q was removed from your Dayrule account.\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away.\n", label)}
}

func TOTPAdded(to string) Message {
	return Message{To: to, Subject: "An authenticator app was added to your Dayrule account", Text: "An authenticator app was set up on your Dayrule account. Signing in now needs your password and a code from the app (or a passkey, if you have one).\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away, then remove the app under Account.\n"}
}

func TOTPRemoved(to string) Message {
	return Message{To: to, Subject: "An authenticator app was removed from your Dayrule account", Text: "The authenticator app was removed from your Dayrule account, so its codes no longer sign in.\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away.\n"}
}

func BackupCodesMade(to string) Message {
	return Message{To: to, Subject: "New Dayrule backup codes", Text: "New backup codes were made for your Dayrule account. Any older ones no longer work.\n\nIf you didn't do this, use your 24-word recovery phrase to set a new password straight away.\n"}
}

func BackupCodeUsed(to string, left int) Message {
	return Message{To: to, Subject: "A Dayrule backup code was used", Text: fmt.Sprintf(
		"A backup code was used to sign in to your Dayrule account. It won't work again; you have %d left. You can make new ones under Account.\n\nIf this wasn't you, use your 24-word recovery phrase to set a new password straight away.\n", left)}
}

// when formats a time for a notice. UTC, since the server doesn't know the
// reader's time zone.
func when(t time.Time) string { return t.UTC().Format("Monday 2 January 2006 at 15:04 UTC") }

func TwoStepResetCode(to, code string) Message {
	return Message{To: to, Subject: "Your Dayrule code: " + code, Text: fmt.Sprintf(
		"Your code to turn off two-step sign-in on your Dayrule account is:\n\n    %s\n\nIt expires in 10 minutes. Entering it starts a 7-day wait; after that, your password alone will sign in.\n\nIf you didn't ask for this, someone knows your password: use your 24-word recovery phrase to set a new one straight away.\n", code)}
}

func TwoStepResetRequested(to string, due time.Time) Message {
	return Message{To: to, Subject: "Two-step sign-in will be turned off in 7 days", Text: fmt.Sprintf(
		"Someone who knew your password asked, by email, to turn off two-step sign-in on your Dayrule account. Unless it's cancelled, it happens on %s, and from then your password alone will sign in.\n\nTo cancel it, sign in with your passkey, authenticator app or a backup code, or cancel it under Account → Two-step sign-in. Changing your password cancels it too.\n\nIf this wasn't you, someone knows your password: use your 24-word recovery phrase to set a new one straight away.\n", when(due))}
}

func TwoStepResetSoon(to string, due time.Time) Message {
	return Message{To: to, Subject: "Two-step sign-in will be turned off tomorrow", Text: fmt.Sprintf(
		"Two-step sign-in on your Dayrule account will be turned off on %s, as asked by email a week ago. From then your password alone will sign in.\n\nTo cancel it, sign in with your passkey, authenticator app or a backup code, or cancel it under Account → Two-step sign-in. If this wasn't you, use your 24-word recovery phrase to set a new password straight away.\n", when(due))}
}

func TwoStepResetDone(to string) Message {
	return Message{To: to, Subject: "Two-step sign-in was turned off", Text: "Two-step sign-in was turned off on your Dayrule account, as asked by email 7 days ago: its passkeys, authenticator app and backup codes were removed. Your password alone now signs in. You can set up a second step again under Account.\n\nIf this wasn't you, use your 24-word recovery phrase to set a new password straight away.\n"}
}

func TwoStepResetCancelled(to string) Message {
	return Message{To: to, Subject: "Two-step sign-in will stay on", Text: "The request to turn off two-step sign-in on your Dayrule account was cancelled, so it stays on.\n"}
}

// Reminder says only that there is one, and when: the server can't know
// what it's for (PLAN.md §10.5).
func Reminder(to, localTime string) Message {
	return Message{To: to, Subject: "Dayrule reminder for " + localTime, Text: fmt.Sprintf(
		"You have a reminder for %s in Dayrule. Open https://dayrule.app to see it.\n\nWe can't tell you what it's for, because we can't see your data.\n\nTurn email reminders off in Dayrule under Account → Reminders.\n", localTime)}
}
