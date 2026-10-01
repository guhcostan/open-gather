package main

import (
	"encoding/json"
	"math"
	"testing"
)

// A run with no latency samples or a tick above the last histogram bucket used to write an empty
// report file: encoding/json refuses NaN and Inf.
func TestReportWithMissingValuesStillSerialises(t *testing.T) {
	r := report{Label: "x", TickP99ms: math.Inf(1), LatStartP50: math.NaN()}
	scrubNaN(&r)
	js, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var back report
	if err := json.Unmarshal(js, &back); err != nil || back.TickP99ms != -1 || back.LatStartP50 != -1 {
		t.Fatalf("missing values must read as -1: %s", js)
	}
}
