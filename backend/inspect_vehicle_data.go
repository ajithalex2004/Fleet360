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
	dsn := "postgres://postgres:root@localhost:5432/neondb?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, make, model FROM vehicles")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Printf("%-40s %-20s %-20s\n", "ID", "Make", "Model")
	fmt.Println("--------------------------------------------------------------------------------")
	for rows.Next() {
		var id string
		var make, model sql.NullString // Handle nulls
		if err := rows.Scan(&id, &make, &model); err != nil {
			log.Fatal(err)
		}

		makeStr := "NULL"
		if make.Valid {
			makeStr = make.String
		}

		modelStr := "NULL"
		if model.Valid {
			modelStr = model.String
		}

		fmt.Printf("%-40s %-20s %-20s\n", id, makeStr, modelStr)
	}
}
