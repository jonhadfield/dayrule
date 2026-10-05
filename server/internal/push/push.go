// Package push sends Web Push messages (RFC 8030/8291, VAPID). Payloads
// carry only an opaque reminder id and a time (PLAN.md §10.5).
package push

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Pusher sends one message to one subscription. gone is true when the
// push service says the subscription no longer exists.
type Pusher interface {
	Send(ctx context.Context, sub store.PushSubscription, payload []byte) (gone bool, err error)
}

// WebPush sends through the browser's push service, signed with VAPID.
type WebPush struct {
	PublicKey  string
	PrivateKey string
	Subject    string // mailto: or https: contact for push services
	Client     *http.Client
}

func (p WebPush) Send(ctx context.Context, sub store.PushSubscription, payload []byte) (bool, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      p.Client,
		Subscriber:      p.Subject,
		VAPIDPublicKey:  p.PublicKey,
		VAPIDPrivateKey: p.PrivateKey,
		TTL:             3600,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return true, nil
	case resp.StatusCode >= 400:
		return false, fmt.Errorf("push service: %s", resp.Status)
	}
	return false, nil
}

// Memory records messages instead of sending them (tests, local runs).
type Memory struct {
	mu   sync.Mutex
	Sent []Sent
	// Gone endpoints answer "gone" (the device unsubscribed).
	Gone map[string]bool
}

type Sent struct {
	Endpoint string
	Payload  string
}

func (m *Memory) Send(_ context.Context, sub store.PushSubscription, payload []byte) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Gone[sub.Endpoint] {
		return true, nil
	}
	m.Sent = append(m.Sent, Sent{Endpoint: sub.Endpoint, Payload: string(payload)})
	return false, nil
}
