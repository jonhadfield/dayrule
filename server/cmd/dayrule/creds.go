package main

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"
)

// resolveCreds returns api, email, password.
// Priority: DAYRULE_CREDS file (email\npassword), then env vars.
// If email is set but password is empty and stdin is a TTY, prompt.
func resolveCreds() (api, email, password string, err error) {
	api = strings.TrimSpace(os.Getenv("DAYRULE_API"))
	if path := strings.TrimSpace(os.Getenv("DAYRULE_CREDS")); path != "" {
		email, password, err = readCredsFile(path)
		if err != nil {
			return "", "", "", err
		}
		return api, email, password, nil
	}
	email = os.Getenv("DAYRULE_EMAIL")
	password = os.Getenv("DAYRULE_PASSWORD")
	if strings.TrimSpace(email) == "" {
		return "", "", "", fmt.Errorf("set DAYRULE_EMAIL and DAYRULE_PASSWORD, or DAYRULE_CREDS=/path/to/creds.txt (email on line 1, password on line 2)")
	}
	if strings.TrimSpace(password) == "" {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return "", "", "", fmt.Errorf("set DAYRULE_PASSWORD or DAYRULE_CREDS")
		}
		fmt.Fprint(os.Stderr, "Dayrule password: ")
		pw, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", "", "", err
		}
		password = string(pw)
	}
	return api, email, password, nil
}

func readCredsFile(path string) (email, password string, err error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	var lines []string
	for _, ln := range strings.Split(string(b), "\n") {
		// Keep internal spaces in the password line; only drop a full-line CR.
		ln = strings.TrimSuffix(ln, "\r")
		if ln == "" || strings.HasPrefix(ln, "#") {
			continue
		}
		lines = append(lines, ln)
	}
	if len(lines) < 2 {
		return "", "", fmt.Errorf("%s: need email on line 1 and password on line 2", path)
	}
	return lines[0], lines[1], nil
}
