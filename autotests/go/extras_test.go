// Тот же пакет — видны помощники
package autotests

// Импорты:
import (
	// bytes — проверка начала файла
	"bytes"
	// net/http — методы
	"net/http"
	// testing — тесты
	"testing"
)

// TC-API-31: шаблон разметки 1:1 — PDF для проекта и для любого диаметра.
// Тест кейса TC-API-31
func TestTemplatePdf_TC_API_31(t *testing.T) {
	// Проект
	p := createProject(t, "Шаблон", "50")
	// Шаблон проекта на A4
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/template.pdf?paper=A4", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Тип PDF и сигнатура %PDF
	if res.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(data, []byte("%PDF")) {
		// Иначе падаем
		t.Fatalf("не PDF: %s", res.Header.Get("Content-Type"))
	}
	// Шаблон без проекта: 30 см на A3
	res, data = do(t, http.MethodGet, "/api/template.pdf?diameter_cm=30&paper=A3", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Слишком маленький диаметр
	res, data = do(t, http.MethodGet, "/api/template.pdf?diameter_cm=10", nil, "")
	// → 422
	expectStatus(t, res, data, 422)
	// Неизвестный формат бумаги
	res, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/template.pdf?paper=A5", nil, "")
	// → 422
	expectStatus(t, res, data, 422)
}

// TC-API-30: время плетения по дням и своя катушка.
// Тест кейса TC-API-30
func TestActivityAndSpool_TC_API_30(t *testing.T) {
	// Проект
	p := createProject(t, "Время", "50")
	// Форма учёта времени из API:
	type activity struct {
		// всего секунд
		TotalSec float64 `json:"total_sec"`
		// всего шагов
		TotalSteps int `json:"total_steps"`
		// по дням:
		Days []struct {
			// дата
			Date string `json:"date"`
			// секунды
			Sec float64 `json:"sec"`
			// шаги
			Steps int `json:"steps"`
			// конец списка дней и его имя в JSON
		} `json:"days"`
	}
	// Адрес учёта
	path := "/api/projects/" + p.ID + "/activity"
	// Первая запись: 30 с, 12 шагов
	doJSON(t, http.MethodPost, path, map[string]any{"date": "2026-10-27", "seconds": 30, "steps": 12})
	// Вторая за тот же день
	res, data := doJSON(t, http.MethodPost, path, map[string]any{"date": "2026-10-27", "seconds": 15, "steps": 3})
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	a := decode[activity](t, data)
	// Итог: 45 с, 15 шагов, один день
	if a.TotalSec != 45 || a.TotalSteps != 15 || len(a.Days) != 1 || a.Days[0].Steps != 15 {
		// Иначе падаем
		t.Fatalf("учёт времени: %+v", a)
	}
	// Дата не в формате ISO
	res, data = doJSON(t, http.MethodPost, path, map[string]any{"date": "вчера", "seconds": 1, "steps": 1})
	// → 422
	expectStatus(t, res, data, 422)

	// Своя катушка 300 м
	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"own_spool_m": 300})
	// → 200
	expectStatus(t, res, data, 200)
	// Значение сохранилось (JSON-числа в Go — float64)
	if v := decode[map[string]any](t, data)["own_spool_m"]; v != 300.0 {
		// Иначе падаем
		t.Fatalf("own_spool_m = %v", v)
	}
	// Сброс своей катушки
	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"own_spool_m": nil})
	// → 200
	expectStatus(t, res, data, 200)
	// Значение — null
	if v := decode[map[string]any](t, data)["own_spool_m"]; v != nil {
		// Иначе падаем
		t.Fatalf("сброс катушки: %v", v)
	}
}
