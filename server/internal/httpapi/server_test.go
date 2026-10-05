package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func TestHealth(t *testing.T) {
	tests := []struct {
		name     string
		db       Pinger
		wantCode int
		want     healthResponse
	}{
		{
			name:     "no database configured",
			db:       nil,
			wantCode: http.StatusOK,
			want:     healthResponse{Status: "ok", Database: "unconfigured", Version: "test"},
		},
		{
			name:     "database reachable",
			db:       fakePinger{},
			wantCode: http.StatusOK,
			want:     healthResponse{Status: "ok", Database: "ok", Version: "test"},
		},
		{
			name:     "database down",
			db:       fakePinger{err: errors.New("connection refused")},
			wantCode: http.StatusServiceUnavailable,
			want:     healthResponse{Status: "degraded", Database: "unavailable", Version: "test"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(Config{
				DB:      tt.db,
				Version: "test",
				Logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
			})

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantCode)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", got)
			}

			var got healthResponse
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got != tt.want {
				t.Errorf("body = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	h := NewHandler(Config{Version: "test", Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPanicIsRecovered(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := recoverer(logger, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
