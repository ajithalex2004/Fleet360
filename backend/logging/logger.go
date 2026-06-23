// Package logging is the Fleet360 backend's structured-logging surface.
//
// One initialised *zap.Logger per process — built once at boot via Init,
// then accessed via L() from anywhere. Output mode is env-driven:
//
//   LOG_FORMAT=json      newline-delimited JSON, suitable for shipping into
//                        Datadog / CloudWatch / ELK / Azure Monitor. Default
//                        when GO_ENV=production (no explicit override needed).
//   LOG_FORMAT=console   human-readable, coloured, suitable for `go run`
//                        sessions and CI logs. Default when GO_ENV is anything
//                        other than "production".
//
//   LOG_LEVEL=debug|info|warn|error|fatal
//                        Default "info" in production, "debug" elsewhere.
//
// Why zap (vs zerolog or logrus): zap's typed-field API (`zap.String`,
// `zap.Int`, etc.) is zero-allocation on the hot path, which matters once
// request rates climb. The advisor's example JSON shape — timestamp,
// tenant_id, user_id, action, status — maps directly to zap fields.
package logging

import (
	"os"
	"strings"
	"sync"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	once   sync.Once
	logger *zap.Logger
)

// Init builds the package-level *zap.Logger from env. Safe to call multiple
// times — only the first call has effect. Returns the same logger L()
// returns so callers can also pass it explicitly if they prefer DI.
//
// Init never panics on bad config — it falls back to a sensible default and
// logs a startup warning. A misconfigured LOG_LEVEL shouldn't take the
// binary down.
func Init() *zap.Logger {
	once.Do(func() {
		level := parseLevel(os.Getenv("LOG_LEVEL"))
		format := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
		if format == "" {
			if os.Getenv("GO_ENV") == "production" {
				format = "json"
			} else {
				format = "console"
			}
		}

		var encoderCfg zapcore.EncoderConfig
		var encoder zapcore.Encoder
		switch format {
		case "json":
			encoderCfg = zap.NewProductionEncoderConfig()
			encoderCfg.TimeKey = "timestamp"
			encoderCfg.EncodeTime = zapcore.ISO8601TimeEncoder
			encoderCfg.MessageKey = "msg"
			encoderCfg.LevelKey = "level"
			encoderCfg.EncodeLevel = zapcore.LowercaseLevelEncoder
			encoder = zapcore.NewJSONEncoder(encoderCfg)
		default:
			encoderCfg = zap.NewDevelopmentEncoderConfig()
			encoderCfg.EncodeTime = zapcore.ISO8601TimeEncoder
			encoderCfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
			encoder = zapcore.NewConsoleEncoder(encoderCfg)
		}

		core := zapcore.NewCore(encoder, zapcore.Lock(os.Stdout), level)
		logger = zap.New(core, zap.AddCaller(), zap.AddCallerSkip(0))
	})
	return logger
}

// L returns the configured logger. Safe before Init — falls through to
// zap.NewNop so library code that imports this package doesn't crash if
// somebody forgets the Init call (tests, in particular). Production
// callers should ensure Init runs at boot.
func L() *zap.Logger {
	if logger == nil {
		return zap.NewNop()
	}
	return logger
}

// Sync flushes any buffered log entries. Call this in a deferred function
// at the top of main(). zap.Logger.Sync returning an error on stdout under
// Linux is a known quirk — callers can ignore it.
func Sync() error {
	if logger == nil {
		return nil
	}
	return logger.Sync()
}

func parseLevel(s string) zapcore.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return zapcore.DebugLevel
	case "warn", "warning":
		return zapcore.WarnLevel
	case "error":
		return zapcore.ErrorLevel
	case "fatal":
		return zapcore.FatalLevel
	case "info", "":
		// Default to info when unset; in production this is the sweet spot.
		if os.Getenv("GO_ENV") == "production" {
			return zapcore.InfoLevel
		}
		// In dev, default to debug so `go run .` is chatty enough to be useful.
		if s == "" {
			return zapcore.DebugLevel
		}
		return zapcore.InfoLevel
	}
	return zapcore.InfoLevel
}
