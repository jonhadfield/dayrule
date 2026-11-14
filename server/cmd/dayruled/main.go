// Command dayruled is the Dayrule API server. It runs unchanged locally and as
// a Vercel Function (Go runtime), listening on $PORT.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/httpapi"
	"github.com/jonhadfield/dayrule/server/internal/push"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := httpapi.Config{
		Version:       version(),
		Logger:        logger,
		MinIOSBuild:   envInt("MIN_IOS_BUILD"),
		MinMacOSBuild: envInt("MIN_MACOS_BUILD"),
	}

	if url := os.Getenv("DATABASE_URL"); url != "" {
		pool, err := store.Open(ctx, url)
		if err != nil {
			return err
		}
		defer pool.Close()
		cfg.DB = pool
		accounts, err := newAccounts(pool, logger)
		if err != nil {
			return err
		}
		cfg.Accounts = accounts
		cfg.Sync = &httpapi.Sync{
			Accounts:   accounts,
			Store:      store.Records{Accounts: accounts.Store},
			Errors:     store.ErrorReports{Pool: pool},
			CronSecret: os.Getenv("CRON_SECRET"),
		}
		cfg.Errors = &httpapi.Errors{
			Accounts: accounts,
			Store:    store.ErrorReports{Pool: pool},
		}
		cfg.Reminders = &httpapi.Reminders{
			Accounts:   accounts,
			Store:      store.Reminders{Accounts: accounts.Store},
			CronSecret: os.Getenv("CRON_SECRET"),
		}
		// Push needs VAPID keys; without them only email reminders work.
		if pub, priv := os.Getenv("VAPID_PUBLIC_KEY"), os.Getenv("VAPID_PRIVATE_KEY"); pub != "" && priv != "" {
			cfg.Reminders.Push = push.WebPush{
				PublicKey:  pub,
				PrivateKey: priv,
				Subject:    "mailto:no-reply@dayrule.app",
				Client:     &http.Client{Timeout: 10 * time.Second},
			}
			cfg.Reminders.VAPIDPublicKey = pub
		}
	} else {
		logger.Warn("DATABASE_URL not set; running without a database")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewHandler(cfg),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", srv.Addr, "version", cfg.Version)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return srv.Shutdown(shutdownCtx)
}

// newAccounts builds the account endpoints from the environment.
func newAccounts(pool *pgxpool.Pool, logger *slog.Logger) (*httpapi.Accounts, error) {
	keys, err := auth.NewKeys([]byte(os.Getenv("AUTH_SECRET")))
	if err != nil {
		return nil, err
	}
	var sender email.Sender = email.Log{Logger: logger}
	if key := os.Getenv("RESEND_API_KEY"); key != "" {
		sender = email.Resend{APIKey: key, From: "Dayrule <no-reply@dayrule.app>"}
	}
	accounts := store.Accounts{Pool: pool}
	passkeys, err := httpapi.NewPasskeys(store.Passkeys{Accounts: accounts}, passkeyOrigins())
	if err != nil {
		return nil, err
	}
	return &httpapi.Accounts{
		Store:      accounts,
		Keys:       keys,
		Email:      sender,
		InviteOnly: os.Getenv("INVITE_ONLY") != "false", // decision 2: invite-only until M7
		Now:        time.Now,
		Logger:     logger,
		Passkeys:   passkeys,
	}, nil
}

// passkeyOrigins lists the origins passkeys work on (PLAN.md §14.4): the two
// dayrule.app hosts unless PASSKEY_ORIGINS (comma-separated) says otherwise,
// for example http://localhost:5173 in development.
func passkeyOrigins() []string {
	v := os.Getenv("PASSKEY_ORIGINS")
	if v == "" {
		return []string{"https://dayrule.app", "https://preview.dayrule.app"}
	}
	var out []string
	for _, o := range strings.Split(v, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

// version identifies the running build: the short Git SHA on Vercel, "dev"
// locally.
func version() string {
	if sha := os.Getenv("VERCEL_GIT_COMMIT_SHA"); len(sha) >= 7 {
		return sha[:7]
	}
	return "dev"
}

// envInt reads a positive integer env var; missing or invalid → 0 (unset).
func envInt(name string) int {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0
	}
	return n
}
