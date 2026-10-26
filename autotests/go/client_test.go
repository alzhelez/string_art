// API-тесты на Go — только стандартная библиотека, без внешних зависимостей.
// Запуск: STRINGART_API=http://127.0.0.1:8000 go test -v ./...
package autotests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var (
	baseURL  = envOr("STRINGART_API", "http://127.0.0.1:8000")
	fixtures = envOr("STRINGART_FIXTURES", filepath.Join("..", "fixtures"))
	client   = &http.Client{Timeout: 60 * time.Second}
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type Stats struct {
	Steps         int     `json:"steps"`
	RawLengthM    float64 `json:"raw_length_m"`
	TotalLengthM  float64 `json:"total_length_m"`
	SpoolM        int     `json:"spool_m"`
	SpoolCount    int     `json:"spool_count"`
	NailSpacingMm float64 `json:"nail_spacing_mm"`
}

type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	DiameterCm  float64 `json:"diameter_cm"`
	LineCount   int     `json:"line_count"`
	CurrentStep int     `json:"current_step"`
	SpeedSec    float64 `json:"speed_sec"`
	Sequence    []int   `json:"sequence"`
	Stats       Stats   `json:"stats"`
}

func TestMain(m *testing.M) {
	res, err := client.Get(baseURL + "/api/health")
	if err != nil || res.StatusCode != 200 {
		fmt.Fprintf(os.Stderr, "Бэкенд недоступен по %s — запустите uvicorn app.main:app --port 8000\n", baseURL)
		os.Exit(2)
	}
	res.Body.Close()
	os.Exit(m.Run())
}

func do(t *testing.T, method, path string, body io.Reader, contentType string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, baseURL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res, data
}

func doJSON(t *testing.T, method, path string, payload any) (*http.Response, []byte) {
	t.Helper()
	var body io.Reader
	if payload != nil {
		b, _ := json.Marshal(payload)
		body = bytes.NewReader(b)
	}
	return do(t, method, path, body, "application/json")
}

// upload отправляет multipart: file + необязательные name и diameter_cm.
func upload(t *testing.T, fileName, mime string, content []byte, fields map[string]string) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if content != nil {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, fileName))
		h.Set("Content-Type", mime)
		part, _ := w.CreatePart(h)
		part.Write(content)
	}
	for k, v := range fields {
		w.WriteField(k, v)
	}
	w.Close()
	return do(t, http.MethodPost, "/api/projects", &buf, w.FormDataContentType())
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixtures, name))
	if err != nil {
		t.Fatalf("фикстура %s: %v", name, err)
	}
	return data
}

func decode[T any](t *testing.T, data []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("JSON: %v\n%s", err, data)
	}
	return v
}

// createProject создаёт проект и удаляет его по завершении теста.
func createProject(t *testing.T, name, diameter string) Project {
	t.Helper()
	fields := map[string]string{"diameter_cm": diameter}
	if name != "" {
		fields["name"] = name
	}
	res, data := upload(t, "portrait.jpg", "image/jpeg", fixture(t, "portrait.jpg"), fields)
	expectStatus(t, res, data, 201)
	p := decode[Project](t, data)
	t.Cleanup(func() { do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "") })
	return p
}

func expectStatus(t *testing.T, res *http.Response, body []byte, want int) {
	t.Helper()
	if res.StatusCode != want {
		t.Fatalf("%s %s: статус %d, ожидали %d\n%s", res.Request.Method, res.Request.URL.Path, res.StatusCode, want, truncate(body))
	}
}

func truncate(b []byte) string {
	s := string(b)
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}

func approx(a, b, eps float64) bool {
	d := a - b
	return d < eps && d > -eps
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
