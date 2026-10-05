package clientcrypto

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type vectors struct {
	Input struct {
		Password        string          `json:"password"`
		Salt            string          `json:"salt"`
		Kdf             KdfParams       `json:"kdf"`
		UserID          string          `json:"userId"`
		AccountKey      string          `json:"accountKey"`
		WrapNonce       string          `json:"wrapNonce"`
		RecoveryEntropy string          `json:"recoveryEntropy"`
		RecordID        string          `json:"recordId"`
		RecordNonce     string          `json:"recordNonce"`
		Record          json.RawMessage `json:"record"`
	} `json:"input"`
	Output struct {
		MasterKey                 string `json:"masterKey"`
		AuthKey                   string `json:"authKey"`
		KEK                       string `json:"kek"`
		WrappedAccountKeyPassword string `json:"wrappedAccountKeyPassword"`
		RecoveryKey               string `json:"recoveryKey"`
		WrappedAccountKeyRecovery string `json:"wrappedAccountKeyRecovery"`
		RecordAAD                 string `json:"recordAad"`
		RecordPlaintextJSON       string `json:"recordPlaintextJson"`
		RecordCiphertext          string `json:"recordCiphertext"`
	} `json:"output"`
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestVectors checks Go reproduces the browser's outputs byte for byte.
func TestVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/crypto-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	in, want := v.Input, v.Output

	eq := func(name string, got []byte, wantHex string) {
		t.Helper()
		if !bytes.Equal(got, mustHex(t, wantHex)) {
			t.Errorf("%s = %x, want %s", name, got, wantHex)
		}
	}

	mk, err := MasterKey(in.Password, mustHex(t, in.Salt), in.Kdf)
	if err != nil {
		t.Fatal(err)
	}
	eq("masterKey", mk, want.MasterKey)

	authKey, _ := HKDF(mk, LabelAuth)
	eq("authKey", authKey, want.AuthKey)
	kek, _ := HKDF(mk, LabelKEK)
	eq("kek", kek, want.KEK)

	ak := mustHex(t, in.AccountKey)
	wrapped, _ := Seal(kek, mustHex(t, in.WrapNonce), ak, WrapAAD(LabelWrapUnderKEK, in.UserID))
	eq("wrappedAccountKeyPassword", wrapped, want.WrappedAccountKeyPassword)

	rk, _ := HKDF(mustHex(t, in.RecoveryEntropy), LabelRecovery)
	eq("recoveryKey", rk, want.RecoveryKey)
	wrappedR, _ := Seal(rk, mustHex(t, in.WrapNonce), ak, WrapAAD(LabelWrapRecovery, in.UserID))
	eq("wrappedAccountKeyRecovery", wrappedR, want.WrappedAccountKeyRecovery)

	if got := string(RecordAAD(in.UserID, in.RecordID, 1, 1)); got != want.RecordAAD {
		t.Errorf("recordAad = %q, want %q", got, want.RecordAAD)
	}

	var rec map[string]any
	if err := OpenRecord(ak, mustHex(t, in.RecordNonce), mustHex(t, want.RecordCiphertext), in.UserID, in.RecordID, 1, 1, &rec); err != nil {
		t.Fatalf("OpenRecord: %v", err)
	}
	if rec["title"] != "Buy milk" {
		t.Errorf("record = %v", rec)
	}

	// Wrong record id must fail authentication.
	if err := OpenRecord(ak, mustHex(t, in.RecordNonce), mustHex(t, want.RecordCiphertext), in.UserID, "other", 1, 1, &rec); err == nil {
		t.Error("OpenRecord accepted the wrong record id")
	}
}
