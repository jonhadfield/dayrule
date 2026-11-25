package httpapi

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/safehttp"
)

// Calendar serves the same-origin ICS fetch for Account → Calendar.
// The browser stays on connect-src 'self'; Dayrule's API sees the feed URL
// (and briefly the response body) — documented in the privacy notice and PLAN §8.3.
func (a *Accounts) calendarRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/calendar/ics", a.withSession(a.fetchIcs))
}

const (
	maxIcsBytes  = 2 << 20 // 2 MiB
	icsFetchWait = 12 * time.Second
	maxIcsURLLen = 2048
)

func (a *Accounts) fetchIcs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	raw := strings.TrimSpace(req.URL)
	if raw == "" || len(raw) > maxIcsURLLen {
		writeErr(w, errBadRequest("Enter a calendar URL."))
		return
	}
	u, err := url.Parse(raw)
	if err != nil || !safehttp.HTTPSURLAllowed(u) {
		writeErr(w, errBadRequest("Use an https:// calendar URL."))
		return
	}
	if _, err := safehttp.PublicIPs(r.Context(), u.Hostname()); err != nil {
		writeErr(w, errBadRequest("That calendar address isn’t allowed."))
		return
	}

	client := safehttp.Client(icsFetchWait)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errBadRequest("That calendar redirected too many times.")
		}
		if !safehttp.HTTPSURLAllowed(req.URL) {
			return errBadRequest("That calendar redirected somewhere we can’t follow.")
		}
		if _, err := safehttp.PublicIPs(req.Context(), req.URL.Hostname()); err != nil {
			return errBadRequest("That calendar address isn’t allowed.")
		}
		return nil
	}
	out, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		writeErr(w, errBadRequest("Enter a calendar URL."))
		return
	}
	out.Header.Set("Accept", "text/calendar, text/plain, */*")
	out.Header.Set("User-Agent", "DayruleCalendar/1")

	res, err := client.Do(out)
	if err != nil {
		writeErr(w, errBadRequest("Couldn’t fetch that calendar."))
		return
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		writeErr(w, errBadRequest("That calendar didn’t respond."))
		return
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxIcsBytes+1))
	if err != nil {
		writeErr(w, errBadRequest("Couldn’t read that calendar."))
		return
	}
	if len(body) > maxIcsBytes {
		writeErr(w, errBadRequest("That calendar is too large."))
		return
	}
	text := string(body)
	if !strings.Contains(text, "BEGIN:VCALENDAR") {
		writeErr(w, errBadRequest("That URL didn’t look like a calendar."))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}
