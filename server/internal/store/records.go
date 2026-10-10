package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Quotas (decision 13).
const (
	MaxRecordBytes = 64 << 10
	MaxStoredBytes = 50 << 20
	MaxRecords     = 100_000
)

// Record is one encrypted record version as stored.
type Record struct {
	ID         uuid.UUID
	Seq        int64
	Alg        int16
	KeyID      int32
	Nonce      []byte
	Ciphertext []byte
	Tombstone  bool
}

// PushItem is a client write, valid only if the record is still at BaseSeq
// (0 for a record the client believes is new).
type PushItem struct {
	Record
	BaseSeq int64
}

// PushOutcome is the result for one pushed record.
type PushOutcome struct {
	ID       uuid.UUID
	Seq      int64  // the new seq if accepted, the current seq on conflict
	Conflict bool   // someone else wrote it first: pull, merge, push again
	Error    string // "too_large" or "quota"
}

// Records stores encrypted sync records.
type Records struct{ Accounts }

// Head is the user's latest sequence and the purge floor.
func (r Records) Head(ctx context.Context, userID uuid.UUID) (head, floor int64, err error) {
	err = r.Pool.QueryRow(ctx, `SELECT next_seq - 1, tombstone_floor FROM users WHERE id = $1`, userID).Scan(&head, &floor)
	return head, floor, err
}

// Pull returns up to limit records with seq > since, in seq order.
func (r Records) Pull(ctx context.Context, userID uuid.UUID, since int64, limit int) ([]Record, error) {
	rows, err := r.Pool.Query(ctx, `SELECT record_id, seq, alg, key_id, nonce, ciphertext, tombstone
		FROM records WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, userID, since, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Record, error) {
		var rec Record
		err := row.Scan(&rec.ID, &rec.Seq, &rec.Alg, &rec.KeyID, &rec.Nonce, &rec.Ciphertext, &rec.Tombstone)
		return rec, err
	})
}

// Push applies writes atomically per request: each record is accepted,
// refused as a conflict, or refused for size/quota. Sequence numbers are
// assigned under a lock on the user row, so they never interleave.
func (r Records) Push(ctx context.Context, userID uuid.UUID, items []PushItem, now time.Time) ([]PushOutcome, int64, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var next, bytes int64
	var count int
	if err := tx.QueryRow(ctx, `SELECT next_seq, stored_bytes, record_count FROM users WHERE id = $1 FOR UPDATE`,
		userID).Scan(&next, &bytes, &count); err != nil {
		return nil, 0, err
	}

	// Passed as text and cast: with QueryExecModeExec pgx can't infer
	// array parameter types.
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID.String()
	}
	type current struct {
		seq       int64
		size      int64
		tombstone bool
	}
	existing := map[uuid.UUID]current{}
	rows, err := tx.Query(ctx, `SELECT record_id, seq, octet_length(ciphertext), tombstone FROM records
		WHERE user_id = $1 AND record_id = ANY($2::uuid[])`, userID, ids)
	if err != nil {
		return nil, 0, err
	}
	for rows.Next() {
		var id uuid.UUID
		var c current
		if err := rows.Scan(&id, &c.seq, &c.size, &c.tombstone); err != nil {
			rows.Close()
			return nil, 0, err
		}
		existing[id] = c
	}
	rows.Close()

	out := make([]PushOutcome, 0, len(items))
	batch := &pgx.Batch{}
	for _, it := range items {
		cur, found := existing[it.ID]
		curSeq := int64(0)
		if found {
			curSeq = cur.seq
		}
		if curSeq != it.BaseSeq {
			out = append(out, PushOutcome{ID: it.ID, Seq: curSeq, Conflict: true})
			continue
		}
		size := int64(len(it.Ciphertext))
		if size > MaxRecordBytes {
			out = append(out, PushOutcome{ID: it.ID, Seq: curSeq, Error: "too_large"})
			continue
		}
		// Live (non-tombstone) records count against the quota.
		newBytes, newCount := bytes, count
		if found && !cur.tombstone {
			newBytes -= cur.size
			newCount--
		}
		if !it.Tombstone {
			newBytes += size
			newCount++
		}
		if !it.Tombstone && (newBytes > MaxStoredBytes || newCount > MaxRecords) {
			out = append(out, PushOutcome{ID: it.ID, Seq: curSeq, Error: "quota"})
			continue
		}
		bytes, count = newBytes, newCount
		seq := next
		next++
		batch.Queue(`INSERT INTO records (user_id, record_id, seq, alg, key_id, nonce, ciphertext, tombstone, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (user_id, record_id) DO UPDATE SET seq = EXCLUDED.seq, alg = EXCLUDED.alg,
				key_id = EXCLUDED.key_id, nonce = EXCLUDED.nonce, ciphertext = EXCLUDED.ciphertext,
				tombstone = EXCLUDED.tombstone, updated_at = EXCLUDED.updated_at`,
			userID, it.ID, seq, it.Alg, it.KeyID, it.Nonce, it.Ciphertext, it.Tombstone, now)
		existing[it.ID] = current{seq: seq, size: size, tombstone: it.Tombstone}
		out = append(out, PushOutcome{ID: it.ID, Seq: seq})
	}
	batch.Queue(`UPDATE users SET next_seq = $2, stored_bytes = $3, record_count = $4 WHERE id = $1`,
		userID, next, bytes, count)
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return out, next - 1, nil
}

// GC purges tombstones older than the retention window (raising each
// user's floor), expired sessions, old email codes and expired passkey
// ceremonies.
func (r Records) GC(ctx context.Context, now time.Time, retention time.Duration) (purged int64, err error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	err = tx.QueryRow(ctx, `WITH gone AS (
			DELETE FROM records WHERE tombstone AND updated_at < $1 RETURNING user_id, seq
		), floors AS (
			SELECT user_id, max(seq) AS mx, count(*) AS n FROM gone GROUP BY user_id
		), bumped AS (
			UPDATE users u SET tombstone_floor = GREATEST(u.tombstone_floor, f.mx)
			FROM floors f WHERE u.id = f.user_id RETURNING f.n
		)
		SELECT COALESCE(sum(n), 0) FROM bumped`, now.Add(-retention)).Scan(&purged)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE expires_at < $1`, now); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM email_codes WHERE created_at < $1`, now.Add(-24*time.Hour)); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM webauthn_ceremonies WHERE expires_at < $1`, now); err != nil {
		return 0, err
	}
	return purged, tx.Commit(ctx)
}
