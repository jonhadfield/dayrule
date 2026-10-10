package httpapi

import (
	"log/slog"
	"net/http"
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

// recognisedClient accepts the PWA ("web") and native clients ("ios/<build>").
func recognisedClient(h string) bool {
	if h == "web" {
		return true
	}
	if strings.HasPrefix(h, "ios/") {
		build := h[len("ios/"):]
		return build != "" && !strings.ContainsAny(build, " \t\r\n")
	}
	return false
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
