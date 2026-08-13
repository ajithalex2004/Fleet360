// One-off tool: query Neon DB schema and verify migrations.
//
// Usage: go run scripts/dbcheck/main.go <command> [args]
//
// Commands:
//   tables           — list all tables in the public schema
//   has-table <name> — print 1 if table exists, 0 otherwise
//   query <sql>      — run a query and print result rows
//
// Reads DATABASE_URL from .env or the environment.
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"fleet360-backend/database"

	"github.com/joho/godotenv"
)

func main() {
	loadEnv()

	database.Connect()
	defer func() {
		sqlDB, _ := database.DB.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	}()

	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dbcheck <tables|has-table|query> [args]")
		os.Exit(2)
	}

	cmd := os.Args[1]
	switch cmd {
	case "tables":
		runTables()
	case "has-table":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: dbcheck has-table <table_name>")
			os.Exit(2)
		}
		runHasTable(os.Args[2])
	case "query":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: dbcheck query <sql>")
			os.Exit(2)
		}
		runQuery(os.Args[2])
	case "exec":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: dbcheck exec <sql>")
			os.Exit(2)
		}
		runExec(os.Args[2])
	case "apply":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: dbcheck apply <sql_file>")
			os.Exit(2)
		}
		runApply(os.Args[2])
	case "null-counts":
		runNullCounts()
	default:
		fmt.Fprintln(os.Stderr, "unknown command:", cmd)
		os.Exit(2)
	}
}

func loadEnv() {
	for _, p := range []string{".env", "../.env", "../../.env"} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			return
		}
	}
}

func runTables() {
	ctx := context.Background()
	var names []string
	err := database.DB.WithContext(ctx).
		Raw(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).
		Scan(&names).Error
	if err != nil {
		fmt.Fprintln(os.Stderr, "query failed:", err)
		os.Exit(1)
	}
	for _, n := range names {
		fmt.Println(n)
	}
}

func runHasTable(name string) {
	ctx := context.Background()
	var n int64
	err := database.DB.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = ?`, name).
		Scan(&n).Error
	if err != nil {
		fmt.Fprintln(os.Stderr, "query failed:", err)
		os.Exit(1)
	}
	if n > 0 {
		fmt.Println("1")
	} else {
		fmt.Println("0")
	}
}

func runQuery(sqlText string) {
	ctx := context.Background()
	rows, err := database.DB.WithContext(ctx).Raw(sqlText).Rows()
	if err != nil {
		fmt.Fprintln(os.Stderr, "query failed:", err)
		os.Exit(1)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	fmt.Println(strings.Join(cols, "\t"))
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			fmt.Fprintln(os.Stderr, "scan failed:", err)
			os.Exit(1)
		}
		parts := make([]string, len(cols))
		for i, v := range vals {
			parts[i] = fmtString(v)
		}
		fmt.Println(strings.Join(parts, "\t"))
	}
}

func fmtString(v any) string {
	if v == nil {
		return "NULL"
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprintf("%v", v)
}

// runExec runs a SQL statement that returns no rows (DDL, UPDATE,
// DELETE). Errors are printed and the process exits non-zero — useful
// for `apply` validation in CI.
func runExec(sqlText string) {
	err := database.DB.WithContext(context.Background()).Exec(sqlText).Error
	if err != nil {
		fmt.Fprintln(os.Stderr, "exec failed:", err)
		os.Exit(1)
	}
	fmt.Println("ok")
}

// runApply reads a .sql file and runs its entire content as a single
// Exec call. The migration scripts are designed to be idempotent
// (every statement wraps a `to_regclass` check or uses IF NOT EXISTS)
// so re-running is safe.
func runApply(path string) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read failed:", err)
		os.Exit(1)
	}
	fmt.Printf("applying %s (%d bytes)...\n", path, len(bytes))
	err = database.DB.WithContext(context.Background()).Exec(string(bytes)).Error
	if err != nil {
		fmt.Fprintln(os.Stderr, "apply failed:", err)
		os.Exit(1)
	}
	fmt.Println("apply: ok")
}

// runNullCounts prints, for the Phase 0 critical tables, how many
// rows have tenant_id IS NULL. After the backfill migrations, all
// should be 0 except bus_routes / staff_members which are intentionally
// NOT auto-backfilled.
func runNullCounts() {
	tables := []string{
		"trip_schedules", "trip_passengers", "trip_logs", "trip_incidents",
		"boarding_events", "bus_pretrip_checks", "ble_gateway_presence",
		"staff_transport_requests", "route_stops", "ambulance_calls",
		"vehicles", "drivers", "garages", "maintenance_requests",
		"finance_invoices", "rental_agreements", "damage_claims",
	}
	fmt.Printf("%-30s %s\n", "table", "null_tenant_id")
	fmt.Println("------------------------------ -----------")
	for _, t := range tables {
		var n *int64
		err := database.DB.WithContext(context.Background()).Raw(
			`SELECT COUNT(*) FROM ` + t + ` WHERE tenant_id IS NULL`,
		).Scan(&n).Error
		if err != nil {
			fmt.Printf("%-30s ERROR: %v\n", t, err)
			continue
		}
		v := int64(0)
		if n != nil {
			v = *n
		}
		fmt.Printf("%-30s %d\n", t, v)
	}
}

// applyPhase0Migrations runs all Phase 0 migrations in order. Reads
// each .sql file from the repo's prisma/migrations directory and
// executes it. Idempotent — every statement uses IF NOT EXISTS or
// wraps a to_regclass check. Safe to re-run.
//
// Called from TestApplyPhase0Migrations_Integration; also exposed as
// `dbcheck apply-all` for operator use.
func applyPhase0Migrations() error {
	files := []string{
		"../../prisma/migrations/tenant_isolation.sql",
		"../../prisma/migrations/20260625_dispatch_tenant_isolation.sql",
		"../../prisma/migrations/20260625_phase0_backfill_safety.sql",
	}
	for _, rel := range files {
		bytes, err := os.ReadFile(rel)
		if err != nil {
			return fmt.Errorf("read %s: %w", rel, err)
		}
		fmt.Printf("applying %s (%d bytes)...\n", rel, len(bytes))
		if err := database.DB.WithContext(context.Background()).Exec(string(bytes)).Error; err != nil {
			return fmt.Errorf("apply %s: %w", rel, err)
		}
		fmt.Println("  ok")
	}
	return nil
}

// _ keeps exec in imports if future commands need to shell out
var _ = exec.Command
