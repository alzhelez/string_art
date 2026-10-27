package autotests

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"reflect"
	"regexp"
	"testing"
)

func TestHealth_TC_API_01(t *testing.T) {
	res, data := do(t, http.MethodGet, "/api/health", nil, "")
	expectStatus(t, res, data, 200)
	if body := decode[map[string]string](t, data); body["status"] != "ok" {
		t.Fatalf("status = %q", body["status"])
	}
}

func TestConfig_TC_API_02(t *testing.T) {
	type cfg struct {
		Sectors        []string `json:"sectors"`
		NailsPerSector int      `json:"nails_per_sector"`
		TotalNails     int      `json:"total_nails"`
		Diameter       struct {
			Presets []int `json:"presets_cm"`
		} `json:"diameter"`
		Speed struct {
			Default float64 `json:"default_sec"`
			Step    float64 `json:"step_sec"`
			Min     float64 `json:"min_sec"`
			Max     float64 `json:"max_sec"`
		} `json:"speed"`
		Thread struct {
			Margin float64 `json:"margin"`
		} `json:"thread"`
	}
	res, data := do(t, http.MethodGet, "/api/config", nil, "")
	expectStatus(t, res, data, 200)
	c := decode[cfg](t, data)
	if !reflect.DeepEqual(c.Sectors, []string{"A", "B", "C", "D"}) || c.NailsPerSector != 60 || c.TotalNails != 240 {
		t.Errorf("гвозди: %+v", c)
	}
	if !reflect.DeepEqual(c.Diameter.Presets, []int{30, 40, 50, 60, 70}) {
		t.Errorf("пресеты: %v", c.Diameter.Presets)
	}
	if c.Speed.Default != 2.0 || c.Speed.Step != 0.1 || c.Speed.Min != 0.5 || c.Speed.Max != 10 {
		t.Errorf("скорость: %+v", c.Speed)
	}
	if c.Thread.Margin != 0.15 {
		t.Errorf("запас: %v", c.Thread.Margin)
	}
}

func TestCreateProject_TC_API_03(t *testing.T) {
	p := createProject(t, "Тестовый портрет", "50")
	if !regexp.MustCompile(`^[0-9a-f]{12}$`).MatchString(p.ID) {
		t.Errorf("id = %q", p.ID)
	}
	if p.Name != "Тестовый портрет" || p.LineCount < 1000 || p.LineCount > 5000 || p.CurrentStep != 1 || p.SpeedSec != 2.0 {
		t.Errorf("проект: %+v", p)
	}
	if len(p.Sequence) != 5001 || p.Sequence[0] != 0 {
		t.Errorf("последовательность: len=%d first=%d", len(p.Sequence), p.Sequence[0])
	}
	if !approx(p.Stats.TotalLengthM, p.Stats.RawLengthM*1.15, 0.1) {
		t.Errorf("запас 15%%: %+v", p.Stats)
	}
	if float64(p.Stats.SpoolM*p.Stats.SpoolCount) < p.Stats.TotalLengthM {
		t.Errorf("катушки не хватает: %+v", p.Stats)
	}
}

func TestCreateFromPng_TC_API_04(t *testing.T) {
	res, data := upload(t, "portrait.png", "image/png", fixture(t, "portrait.png"), map[string]string{"diameter_cm": "70"})
	expectStatus(t, res, data, 201)
	p := decode[Project](t, data)
	defer do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "")
	if p.Name != "portrait" || p.LineCount < 1000 || p.LineCount > 5000 {
		t.Errorf("name=%q lines=%d", p.Name, p.LineCount)
	}
}

func TestUploadValidation_TC_API_05_06(t *testing.T) {
	jpg := fixture(t, "portrait.jpg")
	cases := []struct {
		name     string
		content  []byte
		diameter string
		want     int
	}{
		{"пустой файл", []byte{}, "50", 400},
		{"не картинка", fixture(t, "not-an-image.txt"), "50", 400},
		{"диаметр 19.9", jpg, "19.9", 422},
		{"диаметр 150.1", jpg, "150.1", 422},
		{"диаметр abc", jpg, "abc", 422},
		{"без файла", nil, "50", 422},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res, data := upload(t, "x.jpg", "application/octet-stream", c.content, map[string]string{"diameter_cm": c.diameter})
			expectStatus(t, res, data, c.want)
		})
	}
}

func TestListAndNotFound_TC_API_07_08(t *testing.T) {
	p := createProject(t, "Список", "50")
	res, data := do(t, http.MethodGet, "/api/projects", nil, "")
	expectStatus(t, res, data, 200)
	found := false
	for _, item := range decode[[]map[string]any](t, data) {
		if item["id"] == p.ID {
			found = true
			if _, ok := item["sequence"]; ok {
				t.Error("в списке не должно быть sequence")
			}
		}
	}
	if !found {
		t.Fatal("проект не найден в списке")
	}
	for _, id := range []string{"000000000000", "nope", "ABCDEF123456"} {
		res, data := do(t, http.MethodGet, "/api/projects/"+id, nil, "")
		expectStatus(t, res, data, 404)
	}
}

func TestProgressAndSpeed_TC_API_09_10(t *testing.T) {
	p := createProject(t, "Прогресс", "50")
	res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 137})
	expectStatus(t, res, data, 200)
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID, nil, "")
	if got := decode[Project](t, data).CurrentStep; got != 137 {
		t.Errorf("current_step = %d", got)
	}
	for _, c := range []struct{ sent, saved float64 }{{2.1, 2.1}, {1.9, 1.9}, {2.04999, 2.0}, {0.5, 0.5}, {10, 10}} {
		res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"speed_sec": c.sent})
		expectStatus(t, res, data, 200)
		if got := decode[Project](t, data).SpeedSec; got != c.saved {
			t.Errorf("speed %v → %v, ожидали %v", c.sent, got, c.saved)
		}
	}
}

func TestPatchValidation_TC_API_11(t *testing.T) {
	p := createProject(t, "Валидация", "50")
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	bad := []map[string]any{
		{"speed_sec": 0.4}, {"speed_sec": 10.1}, {"current_step": 0}, {"current_step": 2001},
		{"line_count": 999}, {"line_count": 5001}, {"diameter_cm": 10}, {"name": ""}, {"name": "   "},
		{"sequence": []int{1, 2, 3}},
	}
	for _, body := range bad {
		t.Run(fmt.Sprint(body), func(t *testing.T) {
			res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, body)
			expectStatus(t, res, data, 422)
		})
	}
}

func TestLinesAndDiameter_TC_API_12_13(t *testing.T) {
	p := createProject(t, "Линии", "50")
	_, data0 := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	p = decode[Project](t, data0)
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 1900})
	res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 1500})
	expectStatus(t, res, data, 200)
	if got := decode[Project](t, data); got.CurrentStep != 1500 || got.Stats.Steps != 1500 {
		t.Errorf("после уменьшения линий: step=%d steps=%d", got.CurrentStep, got.Stats.Steps)
	}
	_, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000, "diameter_cm": 100})
	big := decode[Project](t, data)
	if !reflect.DeepEqual(big.Sequence, p.Sequence) {
		t.Error("смена диаметра не должна менять схему")
	}
	if !approx(big.Stats.RawLengthM, p.Stats.RawLengthM*2, 0.1) {
		t.Errorf("длина ×2: %v vs %v", big.Stats.RawLengthM, p.Stats.RawLengthM)
	}
}

func TestSteps_TC_API_14(t *testing.T) {
	type step struct {
		Number    int     `json:"number"`
		FromNail  int     `json:"from_nail"`
		ToNail    int     `json:"to_nail"`
		FromLabel string  `json:"from_label"`
		Used      float64 `json:"thread_used_m"`
	}
	type page struct {
		Total int    `json:"total"`
		Items []step `json:"items"`
	}
	p := createProject(t, "Шаги", "50")
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/steps?offset=0&limit=50", nil, "")
	expectStatus(t, res, data, 200)
	pg := decode[page](t, data)
	if pg.Total != 2000 || len(pg.Items) != 50 || pg.Items[0].FromLabel != "A1" {
		t.Fatalf("первая страница: total=%d len=%d first=%q", pg.Total, len(pg.Items), pg.Items[0].FromLabel)
	}
	for i := 1; i < len(pg.Items); i++ {
		if pg.Items[i].FromNail != pg.Items[i-1].ToNail || pg.Items[i].Used <= pg.Items[i-1].Used {
			t.Fatalf("разрыв на шаге %d", pg.Items[i].Number)
		}
	}
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/steps?offset=1990&limit=50", nil, "")
	tail := decode[page](t, data)
	if len(tail.Items) != 10 || tail.Items[9].Number != 2000 {
		t.Errorf("хвост: %d шагов", len(tail.Items))
	}
}

func TestImages_TC_API_15(t *testing.T) {
	p := createProject(t, "PNG", "50")
	for _, path := range []string{"/preview.png?size=300", "/source.png"} {
		res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+path, nil, "")
		expectStatus(t, res, data, 200)
		if !bytes.HasPrefix(data, []byte("\x89PNG")) || res.Header.Get("Content-Type") != "image/png" {
			t.Errorf("%s: не PNG", path)
		}
	}
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/preview.png?size=50", nil, "")
	expectStatus(t, res, data, 422)
}

func TestPdf_TC_API_16(t *testing.T) {
	p := createProject(t, "PDF", "50")
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 1000})
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/instructions.pdf", nil, "")
	expectStatus(t, res, data, 200)
	if res.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatal("ответ не PDF")
	}
	cd := res.Header.Get("Content-Disposition")
	if !contains(cd, "attachment") || !contains(cd, "filename*=UTF-8''") {
		t.Errorf("Content-Disposition: %s", cd)
	}
	pages := len(regexp.MustCompile(`/Type\s*/Page[^s]`).FindAll(data, -1))
	if pages != 7 {
		t.Errorf("страниц %d, ожидали 7", pages)
	}
}

func TestDelete_TC_API_17(t *testing.T) {
	res, data := upload(t, "portrait.jpg", "image/jpeg", fixture(t, "portrait.jpg"), nil)
	expectStatus(t, res, data, 201)
	id := decode[Project](t, data).ID
	res, data = do(t, http.MethodDelete, "/api/projects/"+id, nil, "")
	expectStatus(t, res, data, 204)
	res, data = do(t, http.MethodGet, "/api/projects/"+id, nil, "")
	expectStatus(t, res, data, 404)
	res, data = do(t, http.MethodDelete, "/api/projects/"+id, nil, "")
	expectStatus(t, res, data, 404)
}

func TestGeometry_TC_API_18(t *testing.T) {
	for _, c := range []struct {
		d       int
		spacing float64
		lines   int
	}{{30, 3.93, 1200}, {50, 6.54, 2000}, {70, 9.16, 2800}} {
		res, data := do(t, http.MethodGet, fmt.Sprintf("/api/geometry?diameter_cm=%d", c.d), nil, "")
		expectStatus(t, res, data, 200)
		g := decode[map[string]float64](t, data)
		if g["nail_spacing_mm"] != c.spacing || int(g["recommended_lines"]) != c.lines {
			t.Errorf("%d см: %v", c.d, g)
		}
	}
}

type imageInfo struct {
	ID       string           `json:"id"`
	Width    int              `json:"width"`
	Height   int              `json:"height"`
	Faces    []map[string]any `json:"faces"`
	FacePrep map[string]any   `json:"face_prep"`
}

func uploadImage(t *testing.T) imageInfo {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", "face.jpg")
	part.Write(fixture(t, "face.jpg"))
	w.Close()
	res, data := do(t, http.MethodPost, "/api/images", &buf, w.FormDataContentType())
	expectStatus(t, res, data, 201)
	return decode[imageInfo](t, data)
}

func TestImageUpload_TC_API_19(t *testing.T) {
	img := uploadImage(t)
	if img.Width != 512 || img.Height != 512 || len(img.Faces) == 0 || img.FacePrep["face_focus"] != true {
		t.Fatalf("фото: %+v", img)
	}
	res, data := do(t, http.MethodGet, "/api/images/"+img.ID+"/original.jpg", nil, "")
	expectStatus(t, res, data, 200)
	if res.Header.Get("Content-Type") != "image/jpeg" {
		t.Error("оригинал не JPEG")
	}
}

func TestCreateFromImageAndEditPhoto_TC_API_21_23(t *testing.T) {
	img := uploadImage(t)
	prep := map[string]any{"zoom": 2, "center_x": 0.45, "center_y": 0.3, "contrast": 0.2}
	res, data := doJSON(t, http.MethodPost, "/api/projects/from-image", map[string]any{"image_id": img.ID, "name": "Go", "prep": prep})
	expectStatus(t, res, data, 201)
	type withPrep struct {
		Project
		Prep map[string]any `json:"prep"`
	}
	p := decode[withPrep](t, data)
	defer do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "")
	if p.Prep["zoom"] != 2.0 || p.Prep["face_focus"] != false {
		t.Errorf("prep: %v", p.Prep)
	}
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 99})
	res, data = doJSON(t, http.MethodPut, "/api/projects/"+p.ID+"/photo", img.FacePrep)
	expectStatus(t, res, data, 200)
	upd := decode[withPrep](t, data)
	if upd.CurrentStep != 1 || upd.Prep["face_focus"] != true || reflect.DeepEqual(upd.Sequence, p.Sequence) {
		t.Errorf("после правки фото: step=%d prep=%v", upd.CurrentStep, upd.Prep)
	}
	res, data = doJSON(t, http.MethodPut, "/api/projects/"+p.ID+"/photo", map[string]any{"zoom": 10})
	expectStatus(t, res, data, 422)
}

func TestSimilarity_TC_API_26(t *testing.T) {
	type sim struct {
		Diameter  float64 `json:"diameter_cm"`
		BestLines int     `json:"best_lines"`
		BestScore float64 `json:"best_score"`
		Curve     []struct {
			Lines int     `json:"lines"`
			Score float64 `json:"score"`
		} `json:"curve"`
	}
	p := createProject(t, "Сходство", "50")
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/similarity", nil, "")
	expectStatus(t, res, data, 200)
	s := decode[sim](t, data)
	if s.BestLines != p.LineCount || len(s.Curve) != 41 || s.BestScore <= 0.2 {
		t.Fatalf("сходство: best=%d line_count=%d points=%d score=%v", s.BestLines, p.LineCount, len(s.Curve), s.BestScore)
	}
	for _, pt := range s.Curve {
		if pt.Score > s.BestScore {
			t.Fatalf("точка %d лучше рекомендации", pt.Lines)
		}
	}
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/similarity?diameter_cm=30", nil, "")
	if small := decode[sim](t, data); small.BestLines > s.BestLines {
		t.Errorf("на 30 см рекомендация %d больше, чем на 50 см %d", small.BestLines, s.BestLines)
	}
}

func TestAutoTone_TC_API_27(t *testing.T) {
	img := uploadImage(t)
	type tone struct {
		Brightness  float64 `json:"brightness"`
		Contrast    float64 `json:"contrast"`
		ScoreBefore float64 `json:"score_before"`
		ScoreAfter  float64 `json:"score_after"`
		Candidates  int     `json:"candidates"`
	}
	res, data := doJSON(t, http.MethodPost, "/api/images/"+img.ID+"/auto-tone", map[string]any{"prep": img.FacePrep, "diameter_cm": 50})
	expectStatus(t, res, data, 200)
	r := decode[tone](t, data)
	if r.ScoreAfter < r.ScoreBefore || r.Candidates != 6 || r.Brightness < -0.5 || r.Brightness > 0.5 {
		t.Fatalf("автонастройка: %+v", r)
	}
	res, data = doJSON(t, http.MethodPost, "/api/images/"+img.ID+"/auto-tone", map[string]any{"diameter_cm": 5})
	expectStatus(t, res, data, 422)
}
