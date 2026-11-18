package httpapi

import (
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestIcsURLAllowed(t *testing.T) {
	ok := []string{
		"https://cal.example.com/feed.ics",
		"https://example.com:8443/cal",
	}
	for _, s := range ok {
		u, err := url.Parse(s)
		if err != nil || !icsURLAllowed(u) {
			t.Fatalf("expected allowed: %s (%v)", s, err)
		}
	}
	bad := []string{
		"http://cal.example.com/feed.ics",
		"https://user:pass@cal.example.com/feed.ics",
		"https://127.0.0.1/feed.ics",
		"https://10.0.0.1/feed.ics",
		"https://localhost/feed.ics",
		"ftp://cal.example.com/feed.ics",
		"https:///feed.ics",
	}
	for _, s := range bad {
		u, err := url.Parse(s)
		if err == nil && icsURLAllowed(u) {
			t.Fatalf("expected refused: %s", s)
		}
	}
}

func TestIsPublicIP(t *testing.T) {
	cases := map[string]bool{
		"8.8.8.8":         true,
		"1.1.1.1":         true,
		"127.0.0.1":       false,
		"10.1.2.3":        false,
		"192.168.0.1":     false,
		"172.16.5.5":      false,
		"169.254.169.254": false,
		"100.64.0.1":      false,
		"::1":             false,
		"fc00::1":         false,
	}
	for s, want := range cases {
		ip := net.ParseIP(s)
		if got := isPublicIP(ip); got != want {
			t.Fatalf("%s: got %v want %v", s, got, want)
		}
	}
}

func TestFetchIcsRejectsBadURLs(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("cal@example.com")

	cases := []string{
		"",
		"http://example.com/x.ics",
		"https://127.0.0.1/feed.ics",
		"https://localhost/feed.ics",
	}
	for _, u := range cases {
		r := a.c.do("POST", "/api/v1/calendar/ics", map[string]string{"url": u})
		if r.code != http.StatusBadRequest {
			t.Fatalf("%q: got %d %v", u, r.code, r.body)
		}
		if r.body["code"] != "bad_request" {
			t.Fatalf("%q: body %#v", u, r.body)
		}
	}
}
