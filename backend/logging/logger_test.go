package logging

import (
	"sync"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// resetForTest replaces the sync.Once and clears the package logger so each
// test can re-init from scratch. This is the only sane way to unit-test
// Init given its once.Do semantics.
func resetForTest() {
	once = sync.Once{}
	logger = nil
}

func TestL_BeforeInit_ReturnsNopLogger(t *testing.T) {
	resetForTest()
	l := L()
	if l == nil {
		t.Fatal("L() must never return nil")
	}
	// A nop logger silently discards — calling .Info should not panic and
	// should not write anywhere observable. Best we can verify here is the
	// no-panic property.
	l.Info("this should be silently discarded")
}

func TestInit_ReturnsTheSameLoggerLDoes(t *testing.T) {
	resetForTest()
	got := Init()
	if got == nil {
		t.Fatal("Init must return a non-nil logger")
	}
	if L() != got {
		t.Error("Init's returned logger and L() differ; expected the same instance")
	}
}

func TestInit_IsIdempotent(t *testing.T) {
	resetForTest()
	first := Init()
	second := Init()
	if first != second {
		t.Error("Init must be idempotent; second call returned a different *zap.Logger")
	}
}

func TestParseLevel(t *testing.T) {
	t.Setenv("GO_ENV", "production")
	cases := map[string]zapcore.Level{
		"debug":   zapcore.DebugLevel,
		"DEBUG":   zapcore.DebugLevel,
		"info":    zapcore.InfoLevel,
		"warn":    zapcore.WarnLevel,
		"warning": zapcore.WarnLevel,
		"error":   zapcore.ErrorLevel,
		"fatal":   zapcore.FatalLevel,
		"":        zapcore.InfoLevel, // production default
		"garbage": zapcore.InfoLevel, // safe fallback
	}
	for input, want := range cases {
		if got := parseLevel(input); got != want {
			t.Errorf("parseLevel(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestParseLevel_DevDefaultIsDebug(t *testing.T) {
	t.Setenv("GO_ENV", "development")
	if got := parseLevel(""); got != zapcore.DebugLevel {
		t.Errorf("dev default = %v, want DebugLevel", got)
	}
}

func TestInit_JsonFormatChosenInProduction(t *testing.T) {
	// We can't easily inspect the encoder type from outside zap, but we
	// can at least verify Init builds without panicking under prod env.
	resetForTest()
	t.Setenv("GO_ENV", "production")
	t.Setenv("LOG_FORMAT", "")
	l := Init()
	if l == nil {
		t.Fatal("prod Init returned nil")
	}
	// Smoke: a log call goes through without panic.
	l.Info("prod-mode smoke", zap.String("tenant_id", "t1"))
}
