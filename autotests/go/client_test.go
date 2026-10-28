// API-тесты на Go — только стандартная библиотека, без внешних зависимостей.
// Запуск: STRINGART_API=http://127.0.0.1:8000 go test -v ./...
// Все файлы с тестами — в одном пакете, поэтому помощники отсюда видны везде
package autotests

// Список импортов стандартной библиотеки:
import (
	// bytes — буферы для тел запросов
	"bytes"
	// encoding/json — разбор и сборка JSON
	"encoding/json"
	// fmt — форматирование строк
	"fmt"
	// io — чтение тел ответов
	"io"
	// mime/multipart — формы с файлами
	"mime/multipart"
	// net/http — HTTP-клиент
	"net/http"
	// net/textproto — заголовки части формы
	"net/textproto"
	// os — переменные окружения и файлы
	"os"
	// path/filepath — пути к фикстурам
	"path/filepath"
	// strings — поиск подстроки
	"strings"
	// testing — сами тесты
	"testing"
	// time — таймаут клиента
	"time"
)

// Общие настройки тестов:
var (
	// адрес бэкенда, по умолчанию локальный
	baseURL = envOr("STRINGART_API", "http://127.0.0.1:8000")
	// папка фикстур, по умолчанию соседняя
	fixtures = envOr("STRINGART_FIXTURES", filepath.Join("..", "fixtures"))
	// HTTP-клиент с таймаутом 60 с — расчёт схемы может быть долгим
	client = &http.Client{Timeout: 60 * time.Second}
)

// envOr — значение переменной окружения или запасное
func envOr(key, fallback string) string {
	// Если переменная задана и не пуста —
	if v := os.Getenv(key); v != "" {
		// — берём её
		return v
	}
	// Иначе — запасное значение
	return fallback
}

// Stats — расчёт лески, как его отдаёт API
type Stats struct {
	// шагов
	Steps int `json:"steps"`
	// чистая длина, м
	RawLengthM float64 `json:"raw_length_m"`
	// с запасом, м
	TotalLengthM float64 `json:"total_length_m"`
	// катушка, м
	SpoolM int `json:"spool_m"`
	// сколько катушек
	SpoolCount int `json:"spool_count"`
	// расстояние между гвоздями, мм
	NailSpacingMm float64 `json:"nail_spacing_mm"`
}

// Project — проект, как его отдаёт API
type Project struct {
	// id
	ID string `json:"id"`
	// название
	Name string `json:"name"`
	// диаметр, см
	DiameterCm float64 `json:"diameter_cm"`
	// число нитей
	LineCount int `json:"line_count"`
	// текущий шаг
	CurrentStep int `json:"current_step"`
	// скорость, с
	SpeedSec float64 `json:"speed_sec"`
	// схема
	Sequence []int `json:"sequence"`
	// расчёт лески
	Stats Stats `json:"stats"`
}

// TestMain запускается один раз перед всеми тестами пакета
func TestMain(m *testing.M) {
	// Проверяем, что бэкенд отвечает
	res, err := client.Get(baseURL + "/api/health")
	// Если нет —
	if err != nil || res.StatusCode != 200 {
		// — понятная подсказка, как его запустить
		fmt.Fprintf(os.Stderr, "Бэкенд недоступен по %s — запустите uvicorn app.main:app --port 8000\n", baseURL)
		// — и выход с кодом 2, без сотни одинаковых падений
		os.Exit(2)
	}
	// Закрываем тело ответа
	res.Body.Close()
	// Запускаем тесты и выходим с их кодом
	os.Exit(m.Run())
}

// do — выполнить запрос и прочитать ответ целиком
func do(t *testing.T, method, path string, body io.Reader, contentType string) (*http.Response, []byte) {
	// Ошибки показываются в строке теста, а не здесь
	t.Helper()
	// Собираем запрос
	req, err := http.NewRequest(method, baseURL+path, body)
	// Не собрался —
	if err != nil {
		// — тест падает
		t.Fatal(err)
	}
	// Если задан тип содержимого —
	if contentType != "" {
		// — ставим заголовок
		req.Header.Set("Content-Type", contentType)
	}
	// Отправляем
	res, err := client.Do(req)
	// Нет связи —
	if err != nil {
		// — тест падает с методом и адресом
		t.Fatalf("%s %s: %v", method, path, err)
	}
	// Тело закроется при выходе из функции
	defer res.Body.Close()
	// Читаем тело
	data, _ := io.ReadAll(res.Body)
	// Отдаём ответ и тело
	return res, data
}

// doJSON — запрос с телом в JSON
func doJSON(t *testing.T, method, path string, payload any) (*http.Response, []byte) {
	// Ошибки — в строке теста
	t.Helper()
	// Тело по умолчанию пустое
	var body io.Reader
	// Если есть что отправить —
	if payload != nil {
		// — превращаем в JSON
		b, _ := json.Marshal(payload)
		// — и в поток для запроса
		body = bytes.NewReader(b)
	}
	// Отправляем как application/json
	return do(t, method, path, body, "application/json")
}

// upload отправляет multipart: file + необязательные name и diameter_cm.
func upload(t *testing.T, fileName, mime string, content []byte, fields map[string]string) (*http.Response, []byte) {
	// Ошибки — в строке теста
	t.Helper()
	// Буфер для формы
	var buf bytes.Buffer
	// Писатель формы
	w := multipart.NewWriter(&buf)
	// Если есть файл —
	if content != nil {
		// заголовки части формы
		h := make(textproto.MIMEHeader)
		// имя поля и имя файла
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, fileName))
		// MIME-тип файла
		h.Set("Content-Type", mime)
		// создаём часть
		part, _ := w.CreatePart(h)
		// пишем содержимое
		part.Write(content)
	}
	// Дополнительные поля формы —
	for k, v := range fields {
		// — по одному
		w.WriteField(k, v)
	}
	// Завершаем форму
	w.Close()
	// Отправляем на /api/projects с правильным заголовком
	return do(t, http.MethodPost, "/api/projects", &buf, w.FormDataContentType())
}

// fixture — прочитать файл из папки фикстур
func fixture(t *testing.T, name string) []byte {
	// Ошибки — в строке теста
	t.Helper()
	// Читаем файл
	data, err := os.ReadFile(filepath.Join(fixtures, name))
	// Нет файла —
	if err != nil {
		// — понятная ошибка
		t.Fatalf("фикстура %s: %v", name, err)
	}
	// Отдаём байты
	return data
}

// decode — разобрать JSON в нужный тип (обобщённая функция)
func decode[T any](t *testing.T, data []byte) T {
	// Ошибки — в строке теста
	t.Helper()
	// Переменная нужного типа
	var v T
	// Разбираем
	if err := json.Unmarshal(data, &v); err != nil {
		// Не JSON — показываем ошибку и сам ответ
		t.Fatalf("JSON: %v\n%s", err, data)
	}
	// Отдаём
	return v
}

// createProject создаёт проект и удаляет его по завершении теста.
func createProject(t *testing.T, name, diameter string) Project {
	// Ошибки — в строке теста
	t.Helper()
	// Поле диаметра
	fields := map[string]string{"diameter_cm": diameter}
	// Если название задано —
	if name != "" {
		// — добавляем
		fields["name"] = name
	}
	// Загружаем портрет
	res, data := upload(t, "portrait.jpg", "image/jpeg", fixture(t, "portrait.jpg"), fields)
	// Ждём 201
	expectStatus(t, res, data, 201)
	// Разбираем
	p := decode[Project](t, data)
	// После теста проект удаляется автоматически
	t.Cleanup(func() { do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "") })
	// Отдаём
	return p
}

// expectStatus — проверить статус и показать ответ, если он не тот
func expectStatus(t *testing.T, res *http.Response, body []byte, want int) {
	// Ошибки — в строке теста
	t.Helper()
	// Статус не совпал —
	if res.StatusCode != want {
		// — падаем с методом, адресом, статусами и началом тела
		t.Fatalf("%s %s: статус %d, ожидали %d\n%s", res.Request.Method, res.Request.URL.Path, res.StatusCode, want, truncate(body))
	}
}

// truncate — обрезать длинный ответ до 300 символов для отчёта
func truncate(b []byte) string {
	// В строку
	s := string(b)
	// Длиннее 300 —
	if len(s) > 300 {
		// — обрезаем с многоточием
		return s[:300] + "…"
	}
	// Иначе как есть
	return s
}

// approx — равны ли числа с точностью eps
func approx(a, b, eps float64) bool {
	// Разница
	d := a - b
	// Меньше eps по модулю
	return d < eps && d > -eps
}

// contains — есть ли подстрока (короткое имя для тестов)
func contains(s, sub string) bool { return strings.Contains(s, sub) }
