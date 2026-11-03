package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// requestLogger logs method, path, status and duration. It never logs
// request or response bodies (PLAN.md §11.6).
func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		logger.InfoContext(r.Context(), "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func recoverer(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				logger.ErrorContext(r.Context(), "panic", "value", v, "path", r.URL.Path)
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// nativeClients are the X-Dayrule-Client prefixes of the native apps, each
// followed by a build ("ios/<build>", "macos/<build>").
var nativeClients = []string{"ios/", "macos/"}

// nativeClient reports whether a client header names a native app build.
func nativeClient(h string) bool {
	for _, p := range nativeClients {
		if build, ok := strings.CutPrefix(h, p); ok {
			return build != "" && !strings.ContainsAny(build, " \t\r\n")
		}
	}
	return false
}

// recognisedClient accepts the PWA ("web") and the native apps.
func recognisedClient(h string) bool {
	return h == "web" || nativeClient(h)
}

// requireClientHeader rejects state-changing API requests that lack a
// recognised X-Dayrule-Client header. Browsers can't send custom headers
// cross-site without a CORS preflight we never allow, so with SameSite=Strict
// cookies this blocks cross-site request forgery (PLAN.md §11.6).
func requireClientHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !recognisedClient(r.Header.Get("X-Dayrule-Client")) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Missing client header.", "code": "forbidden"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireMinNativeBuild returns 426 upgrade_required when a native client's
// build is below Config.MinIOSBuild / MinMacOSBuild (PLAN §10.4 / native §10.4).
// Unset floors (0) disable the gate. Web ("web") and requests without a native
// header are untouched. /api/health is always allowed so probes stay green.
// A native header with a non-numeric build is refused when that platform's
// floor is set, so spoofed labels cannot skip the gate.
func requireMinNativeBuild(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		platform, rest, ok := nativePlatform(r.Header.Get("X-Dayrule-Client"))
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		min := 0
		switch platform {
		case "ios":
			min = cfg.MinIOSBuild
		case "macos":
			min = cfg.MinMacOSBuild
		}
		if min <= 0 {
			next.ServeHTTP(w, r)
			return
		}
		build, err := strconv.Atoi(rest)
		if err != nil || build < min {
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{
				"error": "Update Dayrule to keep syncing.",
				"code":  "upgrade_required",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// nativePlatform splits "ios/<rest>" or "macos/<rest>" (same rules as nativeClient).
func nativePlatform(h string) (platform, rest string, ok bool) {
	for _, p := range nativeClients {
		r, found := strings.CutPrefix(h, p)
		if found && r != "" && !strings.ContainsAny(r, " \t\r\n") {
			return strings.TrimSuffix(p, "/"), r, true
		}
	}
	return "", "", false
}
