package httpapi

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
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
	if err != nil || !icsURLAllowed(u) {
		writeErr(w, errBadRequest("Use an https:// calendar URL."))
		return
	}
	if err := resolvePublic(r.Context(), u.Hostname()); err != nil {
		writeErr(w, err)
		return
	}

	client := &http.Client{
		Timeout: icsFetchWait,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errBadRequest("That calendar redirected too many times.")
			}
			if !icsURLAllowed(req.URL) {
				return errBadRequest("That calendar redirected somewhere we can’t follow.")
			}
			if err := resolvePublic(req.Context(), req.URL.Hostname()); err != nil {
				return err
			}
			return nil
		},
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

func icsURLAllowed(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return false
	}
	// Reject literal IPs here; hostnames are checked via resolvePublic.
	host := u.Hostname()
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPublicIP(ip)
	}
	return true
}

func resolvePublic(ctx context.Context, host string) error {
	if host == "" {
		return errBadRequest("Use an https:// calendar URL.")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return errBadRequest("That calendar address isn’t allowed.")
		}
		return nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addrs) == 0 {
		return errBadRequest("Couldn’t look up that calendar host.")
	}
	for _, a := range addrs {
		if !isPublicIP(a.IP) {
			return errBadRequest("That calendar address isn’t allowed.")
		}
	}
	return nil
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	// Cloud metadata / CGNAT ranges often used in SSRF probes.
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return false
		}
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return false
		}
	}
	return true
}
