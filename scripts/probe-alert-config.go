package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "http://localhost:3000/api/alert-configs"
	// Sending "frequencyValue" and "thresholdValue" as STRINGS to check backend behavior
	jsonData := []byte(`{
		"alertFor": "Vehicle",
		"alertType": "Maintenance",
		"frequency": "Monthly",
		"frequencyValue": "30",
		"dueAlertThreshold": "Days",
		"thresholdValue": "7",
		"notificationEnabled": true,
		"alertTitle": "Test Alert",
		"assignedIds": ["test-id"]
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
