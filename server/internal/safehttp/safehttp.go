// Package safehttp builds HTTP clients that only dial public IPs, so
// SSRF-sensitive fetches (calendar ICS, Web Push) cannot reach private,
// loopback or link-local addresses even if DNS changes between check and dial.
package safehttp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrNotPublic means the host resolved to (or was) a non-public address.
var ErrNotPublic = errors.New("address is not public")

// Lookup resolves a hostname. Tests may replace it; production uses the
// default resolver.
var Lookup = net.DefaultResolver.LookupIPAddr

// IsPublicIP reports whether ip is safe to dial from Dayrule's servers.
func IsPublicIP(ip net.IP) bool {
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

// HTTPSURLAllowed is the URL-shape gate before DNS: https, no userinfo,
// no localhost, and literal IPs must already be public.
func HTTPSURLAllowed(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return false
	}
	host := u.Hostname()
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return IsPublicIP(ip)
	}
	return true
}

// PublicIPs resolves host and returns only public addresses. Fails if the
// host is empty, lookup fails, or any resolved address is non-public.
func PublicIPs(ctx context.Context, host string) ([]net.IP, error) {
	if host == "" {
		return nil, ErrNotPublic
	}
	if ip := net.ParseIP(host); ip != nil {
		if !IsPublicIP(ip) {
			return nil, ErrNotPublic
		}
		return []net.IP{ip}, nil
	}
	addrs, err := Lookup(ctx, host)
	if err != nil || len(addrs) == 0 {
		return nil, ErrNotPublic
	}
	out := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		if !IsPublicIP(a.IP) {
			return nil, ErrNotPublic
		}
		out = append(out, a.IP)
	}
	return out, nil
}

// DialContext resolves addr's host, requires every address to be public,
// then dials those IPs directly (no second DNS lookup).
func DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := PublicIPs(ctx, host)
	if err != nil {
		return nil, err
	}
	var dialer net.Dialer
	var last error
	for _, ip := range ips {
		c, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return c, nil
		}
		last = err
	}
	if last == nil {
		return nil, ErrNotPublic
	}
	return nil, last
}

// Client returns an HTTP client that dials only public IPs and ignores
// HTTP(S)_PROXY (proxying would bypass the dial pin).
func Client(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy:       nil,
			DialContext: DialContext,
		},
	}
}
