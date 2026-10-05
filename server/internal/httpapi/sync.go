package httpapi

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

// Sync serves the sync endpoints (PLAN.md §11.3) and the daily clean-up.
type Sync struct {
	Accounts   *Accounts
	Store      store.Records
	CronSecret string
}

const (
	maxPushBody    = 1 << 20 // 1 MiB per push
	maxPushRecords = 500
	pullPageSize   = 500
	tombstoneTTL   = 90 * 24 * time.Hour
)

func (s *Sync) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/sync/head", s.Accounts.withSession(s.head))
	mux.HandleFunc("GET /api/v1/sync/pull", s.Accounts.withSession(s.pull))
	mux.HandleFunc("POST /api/v1/sync/push", s.Accounts.withSession(s.push))
	mux.HandleFunc("GET /api/internal/gc", s.gc)
}

type wireRecord struct {
	ID         string `json:"id"`
	Seq        int64  `json:"seq,omitempty"`
	BaseSeq    int64  `json:"baseSeq,omitempty"`
	Alg        int16  `json:"alg"`
	KeyID      int32  `json:"keyId"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
	Tombstone  bool   `json:"tombstone,omitempty"`
}

func (s *Sync) head(w http.ResponseWriter, r *http.Request) {
	head, floor, err := s.Store.Head(r.Context(), sessionFrom(r.Context()).UserID)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]int64{"seq": head, "floor": floor})
}

func (s *Sync) pull(w http.ResponseWriter, r *http.Request) {
	userID := sessionFrom(r.Context()).UserID
	since, err := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if err != nil || since < 0 {
		writeErr(w, errBadRequest("Invalid cursor."))
		return
	}
	_, floor, err := s.Store.Head(r.Context(), userID)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Tombstones newer than the client's cursor may have been purged, so it
	// could miss deletions: it must download everything again. A client
	// paging through a download that started at zero says so with full=1;
	// it drops whatever it doesn't see, so purged tombstones don't matter.
	if since > 0 && since < floor && r.URL.Query().Get("full") != "1" {
		writeErr(w, apiError{http.StatusGone, "resync", "This device has been offline too long and needs a full sync."})
		return
	}
	recs, err := s.Store.Pull(r.Context(), userID, since, pullPageSize+1)
	if err != nil {
		writeErr(w, err)
		return
	}
	more := len(recs) > pullPageSize
	if more {
		recs = recs[:pullPageSize]
	}
	out := make([]wireRecord, len(recs))
	cursor := since
	for i, rec := range recs {
		out[i] = wireRecord{
			ID: rec.ID.String(), Seq: rec.Seq, Alg: rec.Alg, KeyID: rec.KeyID,
			Nonce:      base64.StdEncoding.EncodeToString(rec.Nonce),
			Ciphertext: base64.StdEncoding.EncodeToString(rec.Ciphertext),
			Tombstone:  rec.Tombstone,
		}
		cursor = rec.Seq
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"records": out, "cursor": cursor, "hasMore": more})
}

func (s *Sync) push(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Records []wireRecord `json:"records"`
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxPushBody+1))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, apiError{http.StatusRequestEntityTooLarge, "bad_push", "That change set is invalid or too large."})
		return
	}
	if len(req.Records) == 0 || len(req.Records) > maxPushRecords {
		writeErr(w, errBadRequest("Push between 1 and 500 records."))
		return
	}
	items := make([]store.PushItem, 0, len(req.Records))
	seen := map[uuid.UUID]bool{}
	for _, wr := range req.Records {
		id, err := uuid.Parse(wr.ID)
		if err != nil || seen[id] {
			writeErr(w, errBadRequest("Invalid or duplicate record id."))
			return
		}
		seen[id] = true
		nonce, err := base64.StdEncoding.DecodeString(wr.Nonce)
		if err != nil || len(nonce) != 24 {
			writeErr(w, errBadRequest("Invalid nonce."))
			return
		}
		ct, err := base64.StdEncoding.DecodeString(wr.Ciphertext)
		if err != nil || len(ct) < 16 {
			writeErr(w, errBadRequest("Invalid ciphertext."))
			return
		}
		if wr.Alg != 1 || wr.KeyID < 1 || wr.BaseSeq < 0 {
			writeErr(w, errBadRequest("Unsupported record format."))
			return
		}
		items = append(items, store.PushItem{
			Record:  store.Record{ID: id, Alg: wr.Alg, KeyID: wr.KeyID, Nonce: nonce, Ciphertext: ct, Tombstone: wr.Tombstone},
			BaseSeq: wr.BaseSeq,
		})
	}
	outcomes, head, err := s.Store.Push(r.Context(), sessionFrom(r.Context()).UserID, items, s.Accounts.Now())
	if err != nil {
		writeErr(w, err)
		return
	}
	type result struct {
		ID       string `json:"id"`
		Seq      int64  `json:"seq"`
		Conflict bool   `json:"conflict,omitempty"`
		Error    string `json:"error,omitempty"`
	}
	res := make([]result, len(outcomes))
	for i, o := range outcomes {
		res[i] = result{ID: o.ID.String(), Seq: o.Seq, Conflict: o.Conflict, Error: o.Error}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": res, "head": head})
}

// gc runs daily from a Vercel Cron Job, which sends the CRON_SECRET as a
// bearer token.
func (s *Sync) gc(w http.ResponseWriter, r *http.Request) {
	want := "Bearer " + s.CronSecret
	if s.CronSecret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(want)) != 1 {
		writeErr(w, apiError{http.StatusUnauthorized, "unauthorized", "Not allowed."})
		return
	}
	purged, err := s.Store.GC(r.Context(), s.Accounts.Now(), tombstoneTTL)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"purgedTombstones": purged})
}
