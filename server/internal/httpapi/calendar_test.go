package httpapi

import (
	"net/http"
	"testing"
)

func TestFetchIcsRejectsBadURLs(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("cal@example.com")

	cases := []string{
		"",
		"http://example.com/x.ics",
		"https://127.0.0.1/feed.ics",
		"https://localhost/feed.ics",
		"https://private.test/feed.ics",
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
