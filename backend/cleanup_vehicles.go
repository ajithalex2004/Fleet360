//go:build ignore
// +build ignore

package scripts

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	dsn := "postgres://postgres:root@localhost:5433/tripxl?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// 1. Delete the specific bad record
	badID := "38675a6a-c7da-4817-9aa4-1e460e754b68"
	fmt.Printf("Attempting to delete vehicle with ID: %s... ", badID)
	res, err := db.Exec("DELETE FROM vehicles WHERE id = $1", badID)
	if err != nil {
		log.Fatal(err)
	}
	rowsAffected, _ := res.RowsAffected()
	fmt.Printf("Deleted %d row(s).\n", rowsAffected)

	// 2. List remaining vehicles
	fmt.Println("\n--- Remaining Vehicles ---")
	rows, err := db.Query("SELECT id, make, model FROM vehicles")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Printf("%-40s %-20s %-20s\n", "ID", "Make", "Model")
	for rows.Next() {
		var id string
		var make, model sql.NullString
		if err := rows.Scan(&id, &make, &model); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("%-40s %-20s %-20s\n", id, make.String, model.String)
	}
}
