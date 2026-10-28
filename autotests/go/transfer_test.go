// Тот же пакет — видны помощники из client_test.go
package autotests

// Импорты
import (
	// bytes — буфер формы
	"bytes"
	// mime/multipart — форма с файлом
	"mime/multipart"
	// net/http — методы запросов
	"net/http"
	// reflect — сравнение схем
	"reflect"
	// strings — проверка заголовка
	"strings"
	// testing — тесты
	"testing"
)

// importFile отправляет файл проекта на /api/projects/import
func importFile(t *testing.T, content []byte) (*http.Response, []byte) {
	// Ошибки — в строке теста
	t.Helper()
	// Буфер формы
	var buf bytes.Buffer
	// Писатель формы
	w := multipart.NewWriter(&buf)
	// Поле файла
	part, _ := w.CreateFormFile("file", "p.nitegraf")
	// Содержимое
	part.Write(content)
	// Завершаем форму
	w.Close()
	// Отправляем
	return do(t, http.MethodPost, "/api/projects/import", &buf, w.FormDataContentType())
}

// TC-API-33: экспорт → импорт даёт новый портрет с тем же прогрессом; мусор → 400.
func TestTransfer_TC_API_33(t *testing.T) {
	// Проект
	p := createProject(t, "Перенос", "50")
	// Шаг 99
	res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 99})
	// → 200
	expectStatus(t, res, data, 200)
	// Экспорт
	res, file := do(t, http.MethodGet, "/api/projects/"+p.ID+"/export", nil, "")
	// → 200
	expectStatus(t, res, file, 200)
	// Имя файла с расширением .nitegraf
	if !strings.Contains(res.Header.Get("Content-Disposition"), ".nitegraf") {
		// Иначе ошибка
		t.Errorf("Content-Disposition: %s", res.Header.Get("Content-Disposition"))
	}
	// Импорт
	res, data = importFile(t, file)
	// → 201
	expectStatus(t, res, data, 201)
	// Копия
	copied := decode[Project](t, data)
	// Удаляем копию в конце
	t.Cleanup(func() { do(t, http.MethodDelete, "/api/projects/"+copied.ID, nil, "") })
	// Новый id, тот же шаг и та же схема
	if copied.ID == p.ID || copied.CurrentStep != 99 || !reflect.DeepEqual(copied.Sequence, p.Sequence) {
		// Иначе падаем
		t.Fatalf("копия: id=%s шаг=%d", copied.ID, copied.CurrentStep)
	}
	// Не файл проекта
	res, data = importFile(t, []byte("hello"))
	// → 400
	expectStatus(t, res, data, 400)
}
