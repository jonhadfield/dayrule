package safehttp

import (
	"context"
	"net"
	"net/url"
	"testing"
)

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
		if got := IsPublicIP(ip); got != want {
			t.Fatalf("%s: got %v want %v", s, got, want)
		}
	}
}

func TestHTTPSURLAllowed(t *testing.T) {
	ok := []string{
		"https://cal.example.com/feed.ics",
		"https://example.com:8443/cal",
	}
	for _, s := range ok {
		u, err := url.Parse(s)
		if err != nil || !HTTPSURLAllowed(u) {
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
		if err == nil && HTTPSURLAllowed(u) {
			t.Fatalf("expected refused: %s", s)
		}
	}
}

func TestPublicIPsRejectsNonPublic(t *testing.T) {
	ctx := context.Background()
	if _, err := PublicIPs(ctx, "127.0.0.1"); err != ErrNotPublic {
		t.Fatalf("loopback: %v", err)
	}
	old := Lookup
	t.Cleanup(func() { Lookup = old })
	Lookup = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.1")}}, nil
	}
	if _, err := PublicIPs(ctx, "evil.example"); err != ErrNotPublic {
		t.Fatalf("private resolve: %v", err)
	}
	Lookup = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	}
	ips, err := PublicIPs(ctx, "ok.example")
	if err != nil || len(ips) != 1 || !ips[0].Equal(net.ParseIP("8.8.8.8")) {
		t.Fatalf("public resolve: %v %v", ips, err)
	}
}

func TestDialContextRefusesPrivateLiteral(t *testing.T) {
	_, err := DialContext(context.Background(), "tcp", "127.0.0.1:443")
	if err != ErrNotPublic {
		t.Fatalf("got %v", err)
	}
}
