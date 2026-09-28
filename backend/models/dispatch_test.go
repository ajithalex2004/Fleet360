package models

import (
	"sync"
	"testing"

	"gorm.io/gorm/schema"
)

// The incident and ambulance tables have no deleted_at column: a model that
// embeds Model there makes every query add "deleted_at IS NULL" and fail.
func TestDispatchModelsMatchTheirTables(t *testing.T) {
	cases := []struct {
		model   any
		table   string
		columns []string
	}{
		{&TripIncident{}, "operations.incidents", []string{"module_source", "incident_date", "incident_type", "tenant_id"}},
		{&AmbulanceCall{}, "ambulance_calls", []string{"call_no", "priority", "pickup_location", "call_received_at", "tenant_id"}},
	}
	for _, tc := range cases {
		s, err := schema.Parse(tc.model, &sync.Map{}, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		if got := tc.model.(interface{ TableName() string }).TableName(); got != tc.table {
			t.Errorf("%T table %q, want %q", tc.model, got, tc.table)
		}
		if f := s.LookUpField("deleted_at"); f != nil {
			t.Errorf("%T maps deleted_at, which %s does not have", tc.model, tc.table)
		}
		for _, col := range tc.columns {
			if s.LookUpField(col) == nil {
				t.Errorf("%T has no field for %s.%s", tc.model, tc.table, col)
			}
		}
	}
}
