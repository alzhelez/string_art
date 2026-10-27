package autotests

import (
	"bytes"
	"net/http"
	"testing"
)

// TC-API-31: шаблон разметки 1:1 — PDF для проекта и для любого диаметра.
func TestTemplatePdf_TC_API_31(t *testing.T) {
	p := createProject(t, "Шаблон", "50")
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/template.pdf?paper=A4", nil, "")
	expectStatus(t, res, data, 200)
	if res.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatalf("не PDF: %s", res.Header.Get("Content-Type"))
	}
	res, data = do(t, http.MethodGet, "/api/template.pdf?diameter_cm=30&paper=A3", nil, "")
	expectStatus(t, res, data, 200)
	res, data = do(t, http.MethodGet, "/api/template.pdf?diameter_cm=10", nil, "")
	expectStatus(t, res, data, 422)
	res, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/template.pdf?paper=A5", nil, "")
	expectStatus(t, res, data, 422)
}

// TC-API-30: время плетения по дням и своя катушка.
func TestActivityAndSpool_TC_API_30(t *testing.T) {
	p := createProject(t, "Время", "50")
	type activity struct {
		TotalSec   float64 `json:"total_sec"`
		TotalSteps int     `json:"total_steps"`
		Days       []struct {
			Date  string  `json:"date"`
			Sec   float64 `json:"sec"`
			Steps int     `json:"steps"`
		} `json:"days"`
	}
	path := "/api/projects/" + p.ID + "/activity"
	doJSON(t, http.MethodPost, path, map[string]any{"date": "2026-10-27", "seconds": 30, "steps": 12})
	res, data := doJSON(t, http.MethodPost, path, map[string]any{"date": "2026-10-27", "seconds": 15, "steps": 3})
	expectStatus(t, res, data, 200)
	a := decode[activity](t, data)
	if a.TotalSec != 45 || a.TotalSteps != 15 || len(a.Days) != 1 || a.Days[0].Steps != 15 {
		t.Fatalf("учёт времени: %+v", a)
	}
	res, data = doJSON(t, http.MethodPost, path, map[string]any{"date": "вчера", "seconds": 1, "steps": 1})
	expectStatus(t, res, data, 422)

	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"own_spool_m": 300})
	expectStatus(t, res, data, 200)
	if v := decode[map[string]any](t, data)["own_spool_m"]; v != 300.0 {
		t.Fatalf("own_spool_m = %v", v)
	}
	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"own_spool_m": nil})
	if v := decode[map[string]any](t, data)["own_spool_m"]; v != nil {
		t.Fatalf("сброс катушки: %v", v)
	}
}
