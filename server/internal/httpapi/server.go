// Package httpapi serves the Dayrule HTTP API under /api.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Pinger reports whether the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Config holds the API's dependencies. DB is nil when no database is
// configured, for example when running the API locally without Neon.
type Config struct {
	DB      Pinger
	Version string
	Logger  *slog.Logger
	// Accounts serves the account endpoints; nil without a database.
	Accounts *Accounts
	// Sync serves the sync endpoints; nil without a database.
	Sync *Sync
	// Reminders serves reminders and push; nil without a database.
	Reminders *Reminders
}

// NewHandler returns the API's root handler.
func NewHandler(cfg Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler(cfg))
	if cfg.Accounts != nil {
		cfg.Accounts.routes(mux)
	}
	if cfg.Sync != nil {
		cfg.Sync.routes(mux)
	}
	if cfg.Reminders != nil {
		cfg.Reminders.routes(mux)
	}

	return recoverer(cfg.Logger, requestLogger(cfg.Logger, requireClientHeader(mux)))
}

type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Version  string `json:"version"`
}

func healthHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := healthResponse{Status: "ok", Database: "unconfigured", Version: cfg.Version}
		code := http.StatusOK

		if cfg.DB != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			if err := cfg.DB.Ping(ctx); err != nil {
				cfg.Logger.WarnContext(r.Context(), "database ping failed", "error", err)
				resp.Status = "degraded"
				resp.Database = "unavailable"
				code = http.StatusServiceUnavailable
			} else {
				resp.Database = "ok"
			}
		}

		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, code, resp)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
