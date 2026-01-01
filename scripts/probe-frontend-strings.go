package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "http://localhost:3000/api/vehicles"
	// Sending "year" and "currentOdometer" as STRINGS to check backend behavior
	jsonData := []byte(`{
		"make": "StringProbe",
		"model": "StringModel",
		"year": "2026",
		"licensePlate": "STR-999",
		"status": "Active",
		"currentOdometer": "500"
	}`)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Error creating request: %v\n", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error sending request: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %s\n", resp.Status)
	fmt.Printf("Body: %s\n", string(body))
}
