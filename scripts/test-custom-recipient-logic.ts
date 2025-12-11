
// Mock of the logic added to src/utils/notifications.ts
function getRecipients(specificRecipientIds: string[]) {
    const availableRecipients: string[] = [];
    specificRecipientIds.forEach(recipient => {
        try {
            // Try parsing as JSON object {name, email}
            const parsed = JSON.parse(recipient);
            if (parsed.email) {
                availableRecipients.push(parsed.email);
            }
        } catch (e) {
            // If parsing fails, treat as plain email string (backward compatibility)
            availableRecipients.push(recipient);
        }
    });
    return availableRecipients;
}

// Test cases
const testCases = [
    {
        name: "Legacy plain email",
        input: ["old@example.com"],
        expected: ["old@example.com"]
    },
    {
        name: "New JSON format",
        input: ['{"name":"John Doe","email":"john@example.com"}'],
        expected: ["john@example.com"]
    },
    {
        name: "Mixed format",
        input: ["old@example.com", '{"name":"Jane Doe","email":"jane@example.com"}'],
        expected: ["old@example.com", "jane@example.com"]
    },
    {
        name: "Invalid JSON (should fail gracefully to string)",
        input: ['{"name": "Broken JSON'],
        expected: ['{"name": "Broken JSON']
    }
];

console.log("Running Custom Recipient Logic Tests...\n");

let passed = 0;
testCases.forEach(test => {
    const result = getRecipients(test.input);
    const success = JSON.stringify(result) === JSON.stringify(test.expected);
    if (success) passed++;
    console.log(`Test: ${test.name}`);
    console.log(`Input: ${test.input}`);
    console.log(`Output: ${result}`);
    console.log(`Status: ${success ? 'PASSED' : 'FAILED'}`);
    console.log('---');
});

console.log(`\nTotal: ${passed}/${testCases.length} PASSED`);
