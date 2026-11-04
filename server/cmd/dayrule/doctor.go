package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/clientcrypto"
	"github.com/jonhadfield/dayrule/server/internal/deviceclient"
)

func runDoctor(ctx context.Context) error {
	api, email, password, err := resolveCreds()
	if err != nil {
		return err
	}
	api = strings.TrimRight(strings.TrimSpace(api), "/")
	if api == "" {
		api = "https://dayrule.app"
	}
	email = strings.TrimSpace(email)
	rawPass := password
	password = strings.TrimSpace(password)

	fmt.Printf("api            %s\n", api)
	fmt.Printf("email          %s\n", email)
	fmt.Printf("password_len   %d", len(password))
	if rawPass != password {
		fmt.Printf(" (trimmed whitespace from env/file)")
	}
	fmt.Println()
	if c := os.Getenv("DAYRULE_CREDS"); c != "" {
		fmt.Printf("creds_file     %s\n", c)
	} else {
		fmt.Println("creds_file     (env DAYRULE_EMAIL / DAYRULE_PASSWORD)")
	}

	client := &http.Client{Timeout: 60 * time.Second}
	var pre struct {
		Salt string                 `json:"salt"`
		Kdf  clientcrypto.KdfParams `json:"kdf"`
	}
	body, _ := json.Marshal(map[string]string{"email": email})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api+"/api/v1/auth/prelogin", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Dayrule-Client", "macos/99999")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("prelogin: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if err := json.NewDecoder(res.Body).Decode(&pre); err != nil {
		return fmt.Errorf("prelogin decode: %w", err)
	}
	salt, err := base64.StdEncoding.DecodeString(pre.Salt)
	if err != nil {
		return err
	}
	fmt.Printf("prelogin       HTTP %d  salt_len=%d  kdf={v:%d ops:%d mem:%d}\n",
		res.StatusCode, len(salt), pre.Kdf.V, pre.Kdf.Ops, pre.Kdf.Mem)

	fmt.Println("login          trying…")
	s, err := deviceclient.Login(ctx, api, email, password)
	if err != nil {
		fmt.Printf("login          FAIL: %v\n", err)
		fmt.Println()
		fmt.Println("Two-step is not involved here — bad_login means the password")
		fmt.Println("did not match this email (or the email is not registered).")
		fmt.Println("Confirm the same email/password unlock dayrule.app in a browser,")
		fmt.Println("then prefer a creds file to avoid shell quoting:")
		fmt.Println()
		fmt.Println("  mkdir -p ~/.config/dayrule")
		fmt.Println("  # line 1 = email, line 2 = password")
		fmt.Println("  nano ~/.config/dayrule/creds && chmod 600 ~/.config/dayrule/creds")
		fmt.Println("  export DAYRULE_CREDS=$HOME/.config/dayrule/creds")
		fmt.Println("  ./dayrule doctor")
		return err
	}
	defer s.Close()
	fmt.Printf("login          ok  userId=%s  token=yes\n", s.UserID)
	head, floor, err := s.Head(ctx)
	if err != nil {
		return fmt.Errorf("sync/head: %w", err)
	}
	fmt.Printf("sync/head      seq=%d floor=%d\n", head, floor)
	return nil
}
