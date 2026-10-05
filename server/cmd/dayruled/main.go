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

	cfg := httpapi.Config{Version: version(), Logger: logger}

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
			CronSecret: os.Getenv("CRON_SECRET"),
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
	return &httpapi.Accounts{
		Store:      store.Accounts{Pool: pool},
		Keys:       keys,
		Email:      sender,
		InviteOnly: os.Getenv("INVITE_ONLY") != "false", // decision 2: invite-only until M7
		Now:        time.Now,
		Logger:     logger,
	}, nil
}

// version identifies the running build: the short Git SHA on Vercel, "dev"
// locally.
func version() string {
	if sha := os.Getenv("VERCEL_GIT_COMMIT_SHA"); len(sha) >= 7 {
		return sha[:7]
	}
	return "dev"
}
