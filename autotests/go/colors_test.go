// Тот же пакет — видны помощники из client_test.go
package autotests

// Импорты
import (
	// net/http — методы запросов
	"net/http"
	// sort — сортировка цветов для сравнения
	"sort"
	// strings — склейка цветов в строку
	"strings"
	// testing — тесты
	"testing"
)

// TC-API-32: портрет «чёрная + белая» — две нити, PATCH нити, шаги и сходство нити.
func TestColorLayers_TC_API_32(t *testing.T) {
	// Загружаем фото с лицом
	img := uploadImage(t)
	// Создаём портрет из двух нитей
	res, data := doJSON(t, http.MethodPost, "/api/projects/from-image", map[string]any{"image_id": img.ID, "mode": "bw"})
	// → 201
	expectStatus(t, res, data, 201)
	// Форма ответа: режим, доска и нити
	type layer struct {
		// Цвет нити
		Color string `json:"color"`
		// Число линий
		LineCount int `json:"line_count"`
		// Гвозди
		Sequence []int `json:"sequence"`
	}
	// Проект с нитями
	type colored struct {
		// Все поля проекта
		Project
		// Режим
		Mode string `json:"mode"`
		// Доска
		Board struct {
			// Ключ доски
			Key string `json:"key"`
			// конец блока доски и его имя в JSON
		} `json:"board"`
		// Нити
		Layers []layer `json:"layers"`
	}
	// Разбираем
	p := decode[colored](t, data)
	// Удаляем в конце теста
	t.Cleanup(func() { do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "") })
	// Цвета нитей по алфавиту
	colors := []string{}
	// Собираем
	for _, l := range p.Layers {
		// Цвет
		colors = append(colors, l.Color)
	}
	// Сортируем
	sort.Strings(colors)
	// Режим bw, серая доска, белая и чёрная нить
	if p.Mode != "bw" || p.Board.Key != "gray" || strings.Join(colors, ",") != "black,white" {
		// Иначе падаем
		t.Fatalf("режим %q, доска %q, нити %v", p.Mode, p.Board.Key, colors)
	}
	// Вторая нить: 300 линий
	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"layer": 1, "line_count": 300})
	// → 200
	expectStatus(t, res, data, 200)
	// Сохранилось
	if got := decode[colored](t, data).Layers[1].LineCount; got != 300 {
		// Иначе ошибка
		t.Errorf("линий второй нити: %d", got)
	}
	// Шаги второй нити
	res, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/steps?layer=1&limit=1", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Страница шагов
	steps := decode[map[string]any](t, data)
	// Всего 300
	if steps["total"] != 300.0 {
		// Иначе ошибка
		t.Errorf("шагов второй нити: %v", steps["total"])
	}
	// Сходство второй нити
	res, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/similarity?layer=1", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Третьей нити нет
	res, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"layer": 2, "line_count": 300})
	// → 422
	expectStatus(t, res, data, 422)
}
