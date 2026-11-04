package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireMinNativeBuild(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := requireMinNativeBuild(Config{MinIOSBuild: 17, MinMacOSBuild: 17}, ok)

	cases := []struct {
		name   string
		path   string
		client string
		want   int
		code   string
	}{
		{name: "health always ok", path: "/api/health", client: "ios/1", want: http.StatusNoContent},
		{name: "web ignored", path: "/api/v1/sync/head", client: "web", want: http.StatusNoContent},
		{name: "no header ignored", path: "/api/v1/sync/head", client: "", want: http.StatusNoContent},
		{name: "ios at floor", path: "/api/v1/sync/head", client: "ios/17", want: http.StatusNoContent},
		{name: "ios above floor", path: "/api/v1/sync/head", client: "ios/18", want: http.StatusNoContent},
		{name: "ios below floor", path: "/api/v1/sync/head", client: "ios/16", want: http.StatusUpgradeRequired, code: "upgrade_required"},
		{name: "macos below floor", path: "/api/v1/sync/push", client: "macos/10", want: http.StatusUpgradeRequired, code: "upgrade_required"},
		{name: "non-numeric native refused", path: "/api/v1/sync/head", client: "ios/seed", want: http.StatusUpgradeRequired, code: "upgrade_required"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.client != "" {
				req.Header.Set("X-Dayrule-Client", tt.client)
			}
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
			if tt.code == "" {
				return
			}
			var body map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["code"] != tt.code {
				t.Fatalf("code = %q, want %q", body["code"], tt.code)
			}
		})
	}
}

func TestRequireMinNativeBuildUnset(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := requireMinNativeBuild(Config{}, ok)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/head", nil)
	req.Header.Set("X-Dayrule-Client", "ios/1")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 when floors unset", rec.Code)
	}
}

func TestNewHandlerEnforcesMinBuild(t *testing.T) {
	h := NewHandler(Config{
		Version:     "test",
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		MinIOSBuild: 17,
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/head", nil)
	req.Header.Set("X-Dayrule-Client", "ios/1")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426", rec.Code)
	}
}
