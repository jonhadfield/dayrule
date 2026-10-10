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

// Reminder says only that there is one, and when: the server can't know
// what it's for (PLAN.md §10.5).
func Reminder(to, localTime string) Message {
	return Message{To: to, Subject: "Dayrule reminder for " + localTime, Text: fmt.Sprintf(
		"You have a reminder for %s in Dayrule. Open https://dayrule.app to see it.\n\nWe can't tell you what it's for, because we can't see your data.\n\nTurn email reminders off in Dayrule under Account → Reminders.\n", localTime)}
}
