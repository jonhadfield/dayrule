// Package httpapi serves the Dayrule HTTP API under /api.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
)

// Pinger is a database handle. Health only checks whether one is attached;
// it does not Ping, so the uptime probe cannot keep Neon from scaling to zero.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Config holds the API's dependencies. DB is nil when no database is
// configured, for example when running the API locally without Neon.
type Config struct {
	DB      Pinger
	Version string
	Logger  *slog.Logger
	// MinIOSBuild / MinMacOSBuild are the lowest native CFBundleVersion
	// (X-Dayrule-Client ios|macos/<n>) allowed to use the API. 0 means unset
	// — no gate. Below the floor the edge returns 426 upgrade_required.
	MinIOSBuild   int
	MinMacOSBuild int
	// Accounts serves the account endpoints; nil without a database.
	Accounts *Accounts
	// Sync serves the sync endpoints; nil without a database.
	Sync *Sync
	// Reminders serves reminders and push; nil without a database.
	Reminders *Reminders
	// Errors serves client error reports; nil without a database.
	Errors *Errors
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
	if cfg.Errors != nil {
		cfg.Errors.routes(mux)
	}

	return recoverer(cfg.Logger, requestLogger(cfg.Logger, requireClientHeader(requireMinNativeBuild(cfg, mux))))
}

type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Version  string `json:"version"`
}

func healthHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := healthResponse{Status: "ok", Database: "unconfigured", Version: cfg.Version}
		if cfg.DB != nil {
			resp.Database = "configured"
		}

		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, resp)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
