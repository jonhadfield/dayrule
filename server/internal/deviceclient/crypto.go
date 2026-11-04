package deviceclient

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/clientcrypto"
)

func syncID(key []byte, entityKey string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(entityKey))
	sum := mac.Sum(nil)[:16]
	sum[6] = (sum[6] & 0x0f) | 0x40
	sum[8] = (sum[8] & 0x3f) | 0x80
	h := hex.EncodeToString(sum)
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
}

func pad(data []byte) []byte {
	n := len(data) + 1
	size := 256
	for _, b := range []int{256, 512, 1024, 2048} {
		if n <= b {
			size = b
			break
		}
	}
	if n > 2048 {
		size = ((n + 4095) / 4096) * 4096
	}
	out := make([]byte, size)
	copy(out, data)
	out[len(data)] = 0x80
	return out
}

func hlcTick(t time.Time, counter int, device string) string {
	wall := padLeft(base36(uint64(t.UnixMilli())), 9)
	ctr := padLeft(base36(uint64(counter)), 4)
	return wall + "-" + ctr + "-" + device
}

func base36(n uint64) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%36]}, b...)
		n /= 36
	}
	return string(b)
}

func padLeft(s string, w int) string {
	for len(s) < w {
		s = "0" + s
	}
	return s
}

func (s *Session) sealPayload(wireID string, payload any) (nonceB64, ctB64 string, err error) {
	plain, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	n := make([]byte, 24)
	if _, err := rand.Read(n); err != nil {
		return "", "", err
	}
	aad := clientcrypto.RecordAAD(s.UserID, "sync/"+wireID, schemaVersion, keyID)
	sealed, err := clientcrypto.Seal(s.AK, n, pad(plain), aad)
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(n), base64.StdEncoding.EncodeToString(sealed), nil
}

func (s *Session) openRecord(wireID, nonceB64, ctB64 string) (key string, value json.RawMessage, err error) {
	nonce, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return "", nil, err
	}
	ct, err := base64.StdEncoding.DecodeString(ctB64)
	if err != nil {
		return "", nil, err
	}
	aad := clientcrypto.RecordAAD(s.UserID, "sync/"+wireID, schemaVersion, keyID)
	plain, err := clientcrypto.Open(s.AK, nonce, ct, aad)
	if err != nil {
		return "", nil, err
	}
	plain, err = clientcrypto.Unpad(plain)
	if err != nil {
		return "", nil, err
	}
	var env struct {
		K string          `json:"k"`
		V json.RawMessage `json:"v"`
		D json.RawMessage `json:"d"` // deletion stamp
	}
	if err := json.Unmarshal(plain, &env); err != nil {
		return "", nil, err
	}
	if len(env.D) > 0 && string(env.D) != "null" {
		return env.K, nil, nil // tombstone payload
	}
	return env.K, env.V, nil
}
