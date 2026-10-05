package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/push"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Reminders serves reminder settings, push subscriptions and the
// per-minute sender (PLAN.md §10.5). The server stores when reminders
// fire, never what they are for.
type Reminders struct {
	Accounts *Accounts
	Store    store.Reminders
	// Push is nil when VAPID keys aren't configured; push is then offered
	// to no one, and email still works.
	Push           push.Pusher
	VAPIDPublicKey string
	CronSecret     string
}

const maxRemindersBody = 512 << 10

var localTimeRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func (s *Reminders) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/reminders/settings", s.Accounts.withSession(s.getSettings))
	mux.HandleFunc("PUT /api/v1/reminders/settings", s.Accounts.withSession(s.putSettings))
	mux.HandleFunc("PUT /api/v1/reminders", s.Accounts.withSession(s.putReminders))
	mux.HandleFunc("POST /api/v1/push/subscriptions", s.Accounts.withSession(s.subscribe))
	mux.HandleFunc("DELETE /api/v1/push/subscriptions", s.Accounts.withSession(s.unsubscribe))
	mux.HandleFunc("GET /api/internal/reminders", s.send)
}

func (s *Reminders) getSettings(w http.ResponseWriter, r *http.Request) {
	ch, err := s.Store.Channel(r.Context(), sessionFrom(r.Context()).UserID)
	if err != nil {
		writeErr(w, err)
		return
	}
	pub := ""
	if s.Push != nil {
		pub = s.VAPIDPublicKey
	}
	writeJSON(w, http.StatusOK, map[string]string{"channel": ch, "vapidPublicKey": pub})
}

func (s *Reminders) putSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Channel string `json:"channel"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	switch req.Channel {
	case "off", "email", "push", "both":
	default:
		writeErr(w, errBadRequest("Choose off, push, email or both."))
		return
	}
	if (req.Channel == "push" || req.Channel == "both") && s.Push == nil {
		writeErr(w, errBadRequest("Push reminders aren't available."))
		return
	}
	if err := s.Store.SetChannel(r.Context(), sessionFrom(r.Context()).UserID, req.Channel); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Reminders) putReminders(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reminders []struct {
			ID        string    `json:"id"`
			FireAt    time.Time `json:"fireAt"`
			LocalTime string    `json:"localTime"`
		} `json:"reminders"`
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxRemindersBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, errBadRequest("Invalid reminders."))
		return
	}
	if len(req.Reminders) > store.MaxReminders {
		writeErr(w, errBadRequest("Too many reminders."))
		return
	}
	now := s.Accounts.Now()
	rs := make([]store.Reminder, 0, len(req.Reminders))
	seen := map[uuid.UUID]bool{}
	for _, x := range req.Reminders {
		id, err := uuid.Parse(x.ID)
		if err != nil || seen[id] || !localTimeRe.MatchString(x.LocalTime) || x.FireAt.After(now.AddDate(2, 0, 0)) {
			writeErr(w, errBadRequest("Invalid reminder."))
			return
		}
		seen[id] = true
		rs = append(rs, store.Reminder{ID: id, FireAt: x.FireAt.UTC(), LocalTime: x.LocalTime})
	}
	if err := s.Store.Replace(r.Context(), sessionFrom(r.Context()).UserID, rs); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type subscriptionReq struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func validEndpoint(e string) bool {
	u, err := url.Parse(e)
	return err == nil && u.Scheme == "https" && u.Host != "" && len(e) <= 2048
}

func (s *Reminders) subscribe(w http.ResponseWriter, r *http.Request) {
	var req subscriptionReq
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if !validEndpoint(req.Endpoint) || req.Keys.P256dh == "" || req.Keys.Auth == "" ||
		len(req.Keys.P256dh) > 256 || len(req.Keys.Auth) > 256 {
		writeErr(w, errBadRequest("Invalid push subscription."))
		return
	}
	err := s.Store.Subscribe(r.Context(), sessionFrom(r.Context()).UserID,
		store.PushSubscription{Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth})
	if err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Reminders) unsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	if err := s.Store.Unsubscribe(r.Context(), sessionFrom(r.Context()).UserID, req.Endpoint); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// send runs every minute from a Vercel Cron Job (Bearer CRON_SECRET).
func (s *Reminders) send(w http.ResponseWriter, r *http.Request) {
	want := "Bearer " + s.CronSecret
	if s.CronSecret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(want)) != 1 {
		writeErr(w, apiError{http.StatusUnauthorized, "unauthorized", "Not allowed."})
		return
	}
	ctx := r.Context()
	now := s.Accounts.Now()
	due, err := s.Store.ClaimDue(ctx, now, 500)
	if err != nil {
		writeErr(w, err)
		return
	}
	pushed, emailed, failed := 0, 0, 0
	for _, d := range due {
		if (d.Channel == "push" || d.Channel == "both") && s.Push != nil {
			n, err := s.pushTo(ctx, d)
			pushed += n
			if err != nil {
				failed++
				s.log().Warn("reminder push failed", "error", err)
			}
		}
		if d.Channel == "email" || d.Channel == "both" {
			if err := s.Accounts.Email.Send(ctx, email.Reminder(d.Email, d.LocalTime)); err != nil {
				failed++
				s.log().Warn("reminder email failed", "error", err)
			} else {
				emailed++
			}
		}
	}
	if now.Minute() == 0 {
		if err := s.Store.GCReminders(ctx, now); err != nil {
			s.log().Warn("reminder gc failed", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"due": len(due), "pushed": pushed, "emailed": emailed, "failed": failed})
}

func (s *Reminders) log() *slog.Logger {
	if s.Accounts.Logger != nil {
		return s.Accounts.Logger
	}
	return slog.Default()
}

// pushTo sends one reminder to each of the user's devices, dropping
// subscriptions the push service says are gone.
func (s *Reminders) pushTo(ctx context.Context, d store.Due) (int, error) {
	subs, err := s.Store.Subscriptions(ctx, d.UserID)
	if err != nil {
		return 0, err
	}
	payload, _ := json.Marshal(map[string]string{"id": d.ID.String(), "time": d.LocalTime})
	sent := 0
	var last error
	for _, sub := range subs {
		gone, err := s.Push.Send(ctx, sub, payload)
		switch {
		case gone:
			_ = s.Store.Unsubscribe(ctx, d.UserID, sub.Endpoint)
		case err != nil:
			last = err
		default:
			sent++
		}
	}
	return sent, last
}
