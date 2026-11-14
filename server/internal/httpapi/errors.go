package httpapi

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Errors serves POST /api/v1/errors (PLAN.md decision 10).
type Errors struct {
	Accounts *Accounts
	Store    store.ErrorReports
}

const (
	maxErrorRelease = 128
	maxErrorMessage = 2 << 10  // 2 KiB
	maxErrorStack   = 12 << 10 // 12 KiB (fits under accounts decode's 16 KiB body cap)
	maxErrorUA      = 512
	errorReportTTL  = 30 * 24 * time.Hour
)

func (e *Errors) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/errors", e.report)
}

func (e *Errors) report(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Release string `json:"release"`
		Message string `json:"message"`
		Stack   string `json:"stack"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, err)
		return
	}
	msg := clip(strings.TrimSpace(req.Message), maxErrorMessage)
	if msg == "" {
		writeErr(w, errBadRequest("message is required"))
		return
	}
	release := clip(strings.TrimSpace(req.Release), maxErrorRelease)
	stack := clip(req.Stack, maxErrorStack)
	ua := clip(r.Header.Get("User-Agent"), maxErrorUA)
	if err := e.Store.Insert(r.Context(), release, msg, stack, ua); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func clip(s string, max int) string {
	if len(s) <= max {
		return s
	}
	// Avoid cutting mid-rune.
	for max > 0 && !utf8.RuneStart(s[max]) {
		max--
	}
	return s[:max]
}
