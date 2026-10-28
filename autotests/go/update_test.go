// Тот же пакет — видны помощники из client_test.go
package autotests

// Импорты
import (
	// net/http — методы запросов
	"net/http"
	// strings — проверка текста ошибки
	"strings"
	// testing — тесты
	"testing"
)

// TC-API-34: в веб-версии обновление в одну кнопку недоступно — состояние «ждём», старт → 404.
func TestUpdate_TC_API_34(t *testing.T) {
	// Состояние обновления
	res, body := do(t, http.MethodGet, "/api/update", nil, "")
	// 200
	expectStatus(t, res, body, http.StatusOK)
	// Разбираем
	status := decode[map[string]any](t, body)
	// Ждём, не поддерживается
	if status["state"] != "idle" || status["supported"] != false {
		// Ошибка
		t.Fatalf("состояние: %v", status)
	}
	// Пробуем начать
	res, body = do(t, http.MethodPost, "/api/update", nil, "")
	// 404
	expectStatus(t, res, body, http.StatusNotFound)
	// С пояснением
	if !strings.Contains(string(body), "только в программе для Windows") {
		// Ошибка
		t.Fatalf("текст: %s", body)
	}
	// Настройки
	res, body = do(t, http.MethodGet, "/api/config", nil, "")
	// 200
	expectStatus(t, res, body, http.StatusOK)
	// Блок программы
	app, _ := decode[map[string]any](t, body)["app"].(map[string]any)
	// «Не обновляется»
	if app["update"] != false {
		// Ошибка
		t.Fatalf("app.update: %v", app["update"])
	}
}
