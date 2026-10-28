// Тот же пакет — видны помощники из client_test.go
package autotests

// Импорты:
import (
	// bytes — проверка начала файлов
	"bytes"
	// fmt — имена подтестов и адреса
	"fmt"
	// mime/multipart — форма загрузки фото
	"mime/multipart"
	// net/http — методы
	"net/http"
	// reflect — сравнение срезов
	"reflect"
	// regexp — формат id и подсчёт страниц PDF
	"regexp"
	// testing — тесты
	"testing"
)

// TC-API-01: сервер жив
func TestHealth_TC_API_01(t *testing.T) {
	// Запрос
	res, data := do(t, http.MethodGet, "/api/health", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Тело {"status": "ok"}
	if body := decode[map[string]string](t, data); body["status"] != "ok" {
		// Иначе ошибка
		t.Fatalf("status = %q", body["status"])
	}
}

// TC-API-02: настройки
func TestConfig_TC_API_02(t *testing.T) {
	// Нужные поля настроек:
	type cfg struct {
		// секторы
		Sectors []string `json:"sectors"`
		// гвоздей в секторе
		NailsPerSector int `json:"nails_per_sector"`
		// всего гвоздей
		TotalNails int `json:"total_nails"`
		// диаметр:
		Diameter struct {
			// готовые размеры
			Presets []int `json:"presets_cm"`
			// конец блока диаметра и его имя в JSON
		} `json:"diameter"`
		// скорость:
		Speed struct {
			// по умолчанию
			Default float64 `json:"default_sec"`
			// шаг
			Step float64 `json:"step_sec"`
			// минимум
			Min float64 `json:"min_sec"`
			// максимум
			Max float64 `json:"max_sec"`
			// конец блока скорости
		} `json:"speed"`
		// леска:
		Thread struct {
			// запас
			Margin float64 `json:"margin"`
			// конец блока лески
		} `json:"thread"`
	}
	// Запрос
	res, data := do(t, http.MethodGet, "/api/config", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	c := decode[cfg](t, data)
	// Четыре сектора по 60, всего 240
	if !reflect.DeepEqual(c.Sectors, []string{"A", "B", "C", "D"}) || c.NailsPerSector != 60 || c.TotalNails != 240 {
		// Иначе ошибка
		t.Errorf("гвозди: %+v", c)
	}
	// Готовые размеры
	if !reflect.DeepEqual(c.Diameter.Presets, []int{30, 40, 50, 60, 70}) {
		// Иначе ошибка
		t.Errorf("пресеты: %v", c.Diameter.Presets)
	}
	// Скорость 2 / 0,1 / 0,5 / 10
	if c.Speed.Default != 2.0 || c.Speed.Step != 0.1 || c.Speed.Min != 0.5 || c.Speed.Max != 10 {
		// Иначе ошибка
		t.Errorf("скорость: %+v", c.Speed)
	}
	// Запас 15 %
	if c.Thread.Margin != 0.15 {
		// Иначе ошибка
		t.Errorf("запас: %v", c.Thread.Margin)
	}
}

// TC-API-03: создание проекта
func TestCreateProject_TC_API_03(t *testing.T) {
	// Создаём
	p := createProject(t, "Тестовый портрет", "50")
	// id — 12 шестнадцатеричных символов
	if !regexp.MustCompile(`^[0-9a-f]{12}$`).MatchString(p.ID) {
		// Иначе ошибка
		t.Errorf("id = %q", p.ID)
	}
	// Название, число нитей в границах, шаг 1, скорость 2
	if p.Name != "Тестовый портрет" || p.LineCount < 1000 || p.LineCount > 5000 || p.CurrentStep != 1 || p.SpeedSec != 2.0 {
		// Иначе ошибка
		t.Errorf("проект: %+v", p)
	}
	// Схема на 5000 нитей, начало A1
	if len(p.Sequence) != 5001 || p.Sequence[0] != 0 {
		// Иначе ошибка
		t.Errorf("последовательность: len=%d first=%d", len(p.Sequence), p.Sequence[0])
	}
	// Запас 15 %
	if !approx(p.Stats.TotalLengthM, p.Stats.RawLengthM*1.15, 0.1) {
		// Иначе ошибка
		t.Errorf("запас 15%%: %+v", p.Stats)
	}
	// Катушек хватает
	if float64(p.Stats.SpoolM*p.Stats.SpoolCount) < p.Stats.TotalLengthM {
		// Иначе ошибка
		t.Errorf("катушки не хватает: %+v", p.Stats)
	}
}

// TC-API-04: PNG с прозрачностью, без названия
func TestCreateFromPng_TC_API_04(t *testing.T) {
	// Загружаем на 70 см
	res, data := upload(t, "portrait.png", "image/png", fixture(t, "portrait.png"), map[string]string{"diameter_cm": "70"})
	// → 201
	expectStatus(t, res, data, 201)
	// Разбираем
	p := decode[Project](t, data)
	// Удаляем в конце теста
	defer do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "")
	// Название — имя файла, нитей в границах
	if p.Name != "portrait" || p.LineCount < 1000 || p.LineCount > 5000 {
		// Иначе ошибка
		t.Errorf("name=%q lines=%d", p.Name, p.LineCount)
	}
}

// TC-API-05/06: неверные загрузки
func TestUploadValidation_TC_API_05_06(t *testing.T) {
	// Нормальное фото — для проверок диаметра
	jpg := fixture(t, "portrait.jpg")
	// Таблица случаев:
	cases := []struct {
		// имя подтеста
		name string
		// содержимое файла
		content []byte
		// диаметр
		diameter string
		// ожидаемый статус
		want int
		// значения:
	}{
		// пустой файл
		{"пустой файл", []byte{}, "50", 400},
		// текст вместо картинки
		{"не картинка", fixture(t, "not-an-image.txt"), "50", 400},
		// диаметр меньше 20
		{"диаметр 19.9", jpg, "19.9", 422},
		// больше 150
		{"диаметр 150.1", jpg, "150.1", 422},
		// не число
		{"диаметр abc", jpg, "abc", 422},
		// файла нет вовсе
		{"без файла", nil, "50", 422},
	}
	// Каждый случай —
	for _, c := range cases {
		// — отдельный подтест
		t.Run(c.name, func(t *testing.T) {
			// Загружаем
			res, data := upload(t, "x.jpg", "application/octet-stream", c.content, map[string]string{"diameter_cm": c.diameter})
			// Статус совпадает
			expectStatus(t, res, data, c.want)
		})
	}
}

// TC-API-07/08: список и неизвестные проекты
func TestListAndNotFound_TC_API_07_08(t *testing.T) {
	// Создаём
	p := createProject(t, "Список", "50")
	// Список
	res, data := do(t, http.MethodGet, "/api/projects", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Нашли ли наш
	found := false
	// Перебираем список
	for _, item := range decode[[]map[string]any](t, data) {
		// Наш —
		if item["id"] == p.ID {
			// — отмечаем
			found = true
			// Есть схема —
			if _, ok := item["sequence"]; ok {
				// — ошибка: в списке её быть не должно
				t.Error("в списке не должно быть sequence")
			}
		}
	}
	// Не нашли —
	if !found {
		// — ошибка
		t.Fatal("проект не найден в списке")
	}
	// Неизвестные id
	for _, id := range []string{"000000000000", "nope", "ABCDEF123456"} {
		// Запрос
		res, data := do(t, http.MethodGet, "/api/projects/"+id, nil, "")
		// → 404
		expectStatus(t, res, data, 404)
	}
}

// TC-API-09/10: шаг и скорость
func TestProgressAndSpeed_TC_API_09_10(t *testing.T) {
	// Создаём
	p := createProject(t, "Прогресс", "50")
	// Шаг 137
	res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 137})
	// → 200
	expectStatus(t, res, data, 200)
	// Читаем проект заново
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID, nil, "")
	// Шаг сохранился
	if got := decode[Project](t, data).CurrentStep; got != 137 {
		// Иначе ошибка
		t.Errorf("current_step = %d", got)
	}
	// Пары «отправили — сохранилось»
	for _, c := range []struct{ sent, saved float64 }{{2.1, 2.1}, {1.9, 1.9}, {2.04999, 2.0}, {0.5, 0.5}, {10, 10}} {
		// Отправляем
		res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"speed_sec": c.sent})
		// → 200
		expectStatus(t, res, data, 200)
		// Сохранено округлённое значение
		if got := decode[Project](t, data).SpeedSec; got != c.saved {
			// Иначе ошибка
			t.Errorf("speed %v → %v, ожидали %v", c.sent, got, c.saved)
		}
	}
}

// TC-API-11: неверные изменения
func TestPatchValidation_TC_API_11(t *testing.T) {
	// Создаём
	p := createProject(t, "Валидация", "50")
	// 2000 нитей — чтобы шаг 2001 был неверным
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	// Тела запросов:
	bad := []map[string]any{
		// скорость и шаг вне границ
		{"speed_sec": 0.4}, {"speed_sec": 10.1}, {"current_step": 0}, {"current_step": 2001},
		// число нитей, диаметр, пустые названия
		{"line_count": 999}, {"line_count": 5001}, {"diameter_cm": 10}, {"name": ""}, {"name": "   "},
		// менять схему нельзя
		{"sequence": []int{1, 2, 3}},
	}
	// Каждое —
	for _, body := range bad {
		// — отдельный подтест
		t.Run(fmt.Sprint(body), func(t *testing.T) {
			// Отправляем
			res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, body)
			// → 422
			expectStatus(t, res, data, 422)
		})
	}
}

// TC-API-12/13: число нитей и диаметр
func TestLinesAndDiameter_TC_API_12_13(t *testing.T) {
	// Создаём
	p := createProject(t, "Линии", "50")
	// 2000 нитей
	_, data0 := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	// Запоминаем проект
	p = decode[Project](t, data0)
	// Шаг 1900
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 1900})
	// Уменьшаем до 1500
	res, data := doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 1500})
	// → 200
	expectStatus(t, res, data, 200)
	// Шаг и расчёт прижаты к 1500
	if got := decode[Project](t, data); got.CurrentStep != 1500 || got.Stats.Steps != 1500 {
		// Иначе ошибка
		t.Errorf("после уменьшения линий: step=%d steps=%d", got.CurrentStep, got.Stats.Steps)
	}
	// 2000 нитей и диаметр 100
	_, data = doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000, "diameter_cm": 100})
	// Разбираем
	big := decode[Project](t, data)
	// Схема та же
	if !reflect.DeepEqual(big.Sequence, p.Sequence) {
		// Иначе ошибка
		t.Error("смена диаметра не должна менять схему")
	}
	// Длина лески вдвое больше
	if !approx(big.Stats.RawLengthM, p.Stats.RawLengthM*2, 0.1) {
		// Иначе ошибка
		t.Errorf("длина ×2: %v vs %v", big.Stats.RawLengthM, p.Stats.RawLengthM)
	}
}

// TC-API-14: шаги частями
func TestSteps_TC_API_14(t *testing.T) {
	// Шаг в ответе:
	type step struct {
		// номер
		Number int `json:"number"`
		// откуда
		FromNail int `json:"from_nail"`
		// куда
		ToNail int `json:"to_nail"`
		// подпись «откуда»
		FromLabel string `json:"from_label"`
		// расход лески
		Used float64 `json:"thread_used_m"`
	}
	// Страница шагов:
	type page struct {
		// всего
		Total int `json:"total"`
		// шаги
		Items []step `json:"items"`
	}
	// Создаём
	p := createProject(t, "Шаги", "50")
	// 2000 нитей
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 2000})
	// Первые 50
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/steps?offset=0&limit=50", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	pg := decode[page](t, data)
	// Всего 2000, пришло 50, начало A1
	if pg.Total != 2000 || len(pg.Items) != 50 || pg.Items[0].FromLabel != "A1" {
		// Иначе падаем
		t.Fatalf("первая страница: total=%d len=%d first=%q", pg.Total, len(pg.Items), pg.Items[0].FromLabel)
	}
	// Для каждой пары соседних шагов —
	for i := 1; i < len(pg.Items); i++ {
		// нить идёт из конца предыдущего, расход растёт
		if pg.Items[i].FromNail != pg.Items[i-1].ToNail || pg.Items[i].Used <= pg.Items[i-1].Used {
			// иначе падаем
			t.Fatalf("разрыв на шаге %d", pg.Items[i].Number)
		}
	}
	// Запрос за концом
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/steps?offset=1990&limit=50", nil, "")
	// Разбираем
	tail := decode[page](t, data)
	// Пришли последние 10 шагов
	if len(tail.Items) != 10 || tail.Items[9].Number != 2000 {
		// Иначе ошибка
		t.Errorf("хвост: %d шагов", len(tail.Items))
	}
}

// TC-API-15: превью и исходник
func TestImages_TC_API_15(t *testing.T) {
	// Создаём
	p := createProject(t, "PNG", "50")
	// Оба адреса
	for _, path := range []string{"/preview.png?size=300", "/source.png"} {
		// Запрос
		res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+path, nil, "")
		// → 200
		expectStatus(t, res, data, 200)
		// Сигнатура и тип PNG
		if !bytes.HasPrefix(data, []byte("\x89PNG")) || res.Header.Get("Content-Type") != "image/png" {
			// Иначе ошибка
			t.Errorf("%s: не PNG", path)
		}
	}
	// Слишком маленькое превью
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/preview.png?size=50", nil, "")
	// → 422
	expectStatus(t, res, data, 422)
}

// TC-API-16: PDF
func TestPdf_TC_API_16(t *testing.T) {
	// Создаём
	p := createProject(t, "PDF", "50")
	// 1000 нитей
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"line_count": 1000})
	// Скачиваем
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/instructions.pdf", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Тип и сигнатура PDF
	if res.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(data, []byte("%PDF")) {
		// Иначе падаем
		t.Fatal("ответ не PDF")
	}
	// Заголовок с именем файла
	cd := res.Header.Get("Content-Disposition")
	// Вложение и имя в UTF-8
	if !contains(cd, "attachment") || !contains(cd, "filename*=UTF-8''") {
		// Иначе ошибка
		t.Errorf("Content-Disposition: %s", cd)
	}
	// Считаем страницы
	pages := len(regexp.MustCompile(`/Type\s*/Page[^s]`).FindAll(data, -1))
	// Должно быть 7
	if pages != 7 {
		// Иначе ошибка
		t.Errorf("страниц %d, ожидали 7", pages)
	}
}

// TC-API-17: удаление
func TestDelete_TC_API_17(t *testing.T) {
	// Загружаем
	res, data := upload(t, "portrait.jpg", "image/jpeg", fixture(t, "portrait.jpg"), nil)
	// → 201
	expectStatus(t, res, data, 201)
	// id
	id := decode[Project](t, data).ID
	// Удаляем
	res, data = do(t, http.MethodDelete, "/api/projects/"+id, nil, "")
	// → 204
	expectStatus(t, res, data, 204)
	// Читаем
	res, data = do(t, http.MethodGet, "/api/projects/"+id, nil, "")
	// → 404
	expectStatus(t, res, data, 404)
	// Удаляем снова
	res, data = do(t, http.MethodDelete, "/api/projects/"+id, nil, "")
	// → 404
	expectStatus(t, res, data, 404)
}

// TC-API-18: геометрия
func TestGeometry_TC_API_18(t *testing.T) {
	// Таблица:
	for _, c := range []struct {
		// диаметр
		d int
		// расстояние между гвоздями
		spacing float64
		// рекомендуемые нити
		lines int
		// значения для 30, 50 и 70 см
	}{{30, 3.93, 1200}, {50, 6.54, 2000}, {70, 9.16, 2800}} {
		// Запрос
		res, data := do(t, http.MethodGet, fmt.Sprintf("/api/geometry?diameter_cm=%d", c.d), nil, "")
		// → 200
		expectStatus(t, res, data, 200)
		// Разбираем
		g := decode[map[string]float64](t, data)
		// Совпадает с таблицей
		if g["nail_spacing_mm"] != c.spacing || int(g["recommended_lines"]) != c.lines {
			// Иначе ошибка
			t.Errorf("%d см: %v", c.d, g)
		}
	}
}

// Описание фото из API:
type imageInfo struct {
	// id
	ID string `json:"id"`
	// ширина
	Width int `json:"width"`
	// высота
	Height int `json:"height"`
	// найденные лица
	Faces []map[string]any `json:"faces"`
	// готовый кадр «Выделить лицо»
	FacePrep map[string]any `json:"face_prep"`
}

// uploadImage — загрузить фото с лицом в редактор
func uploadImage(t *testing.T) imageInfo {
	// Ошибки — в строке теста
	t.Helper()
	// Буфер
	var buf bytes.Buffer
	// Писатель формы
	w := multipart.NewWriter(&buf)
	// Поле файла
	part, _ := w.CreateFormFile("file", "face.jpg")
	// Содержимое фикстуры
	part.Write(fixture(t, "face.jpg"))
	// Завершаем форму
	w.Close()
	// Отправляем
	res, data := do(t, http.MethodPost, "/api/images", &buf, w.FormDataContentType())
	// → 201
	expectStatus(t, res, data, 201)
	// Разбираем
	return decode[imageInfo](t, data)
}

// TC-API-19: фото в редакторе
func TestImageUpload_TC_API_19(t *testing.T) {
	// Загружаем
	img := uploadImage(t)
	// 512×512, лицо найдено, готовый кадр
	if img.Width != 512 || img.Height != 512 || len(img.Faces) == 0 || img.FacePrep["face_focus"] != true {
		// Иначе падаем
		t.Fatalf("фото: %+v", img)
	}
	// Исходник
	res, data := do(t, http.MethodGet, "/api/images/"+img.ID+"/original.jpg", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Тип JPEG
	if res.Header.Get("Content-Type") != "image/jpeg" {
		// Иначе ошибка
		t.Error("оригинал не JPEG")
	}
}

// TC-API-21/23: портрет из фото и правка фото
func TestCreateFromImageAndEditPhoto_TC_API_21_23(t *testing.T) {
	// Загружаем
	img := uploadImage(t)
	// Параметры кадра
	prep := map[string]any{"zoom": 2, "center_x": 0.45, "center_y": 0.3, "contrast": 0.2}
	// Создаём проект
	res, data := doJSON(t, http.MethodPost, "/api/projects/from-image", map[string]any{"image_id": img.ID, "name": "Go", "prep": prep})
	// → 201
	expectStatus(t, res, data, 201)
	// Проект с параметрами кадра:
	type withPrep struct {
		// все поля проекта
		Project
		// и prep
		Prep map[string]any `json:"prep"`
	}
	// Разбираем
	p := decode[withPrep](t, data)
	// Удаляем в конце
	defer do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "")
	// Параметры сохранились
	if p.Prep["zoom"] != 2.0 || p.Prep["face_focus"] != false {
		// Иначе ошибка
		t.Errorf("prep: %v", p.Prep)
	}
	// Шаг 99
	doJSON(t, http.MethodPatch, "/api/projects/"+p.ID, map[string]any{"current_step": 99})
	// Меняем кадр на «Выделить лицо»
	res, data = doJSON(t, http.MethodPut, "/api/projects/"+p.ID+"/photo", img.FacePrep)
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	upd := decode[withPrep](t, data)
	// Шаг сброшен, флажок стоит, схема новая
	if upd.CurrentStep != 1 || upd.Prep["face_focus"] != true || reflect.DeepEqual(upd.Sequence, p.Sequence) {
		// Иначе ошибка
		t.Errorf("после правки фото: step=%d prep=%v", upd.CurrentStep, upd.Prep)
	}
	// Зум 10
	res, data = doJSON(t, http.MethodPut, "/api/projects/"+p.ID+"/photo", map[string]any{"zoom": 10})
	// → 422
	expectStatus(t, res, data, 422)
}

// TC-API-26: кривая сходства
func TestSimilarity_TC_API_26(t *testing.T) {
	// Ответ:
	type sim struct {
		// диаметр
		Diameter float64 `json:"diameter_cm"`
		// лучшее число нитей
		BestLines int `json:"best_lines"`
		// лучшее сходство
		BestScore float64 `json:"best_score"`
		// точки:
		Curve []struct {
			// нитей
			Lines int `json:"lines"`
			// сходство
			Score float64 `json:"score"`
			// конец точек и имя в JSON
		} `json:"curve"`
	}
	// Создаём
	p := createProject(t, "Сходство", "50")
	// Кривая
	res, data := do(t, http.MethodGet, "/api/projects/"+p.ID+"/similarity", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	s := decode[sim](t, data)
	// Рекомендация совпадает, 41 точка, сходство разумное
	if s.BestLines != p.LineCount || len(s.Curve) != 41 || s.BestScore <= 0.2 {
		// Иначе падаем
		t.Fatalf("сходство: best=%d line_count=%d points=%d score=%v", s.BestLines, p.LineCount, len(s.Curve), s.BestScore)
	}
	// Каждая точка —
	for _, pt := range s.Curve {
		// не лучше рекомендации
		if pt.Score > s.BestScore {
			// иначе падаем
			t.Fatalf("точка %d лучше рекомендации", pt.Lines)
		}
	}
	// Кривая для 30 см
	_, data = do(t, http.MethodGet, "/api/projects/"+p.ID+"/similarity?diameter_cm=30", nil, "")
	// Рекомендация не больше, чем для 50 см
	if small := decode[sim](t, data); small.BestLines > s.BestLines {
		// Иначе ошибка
		t.Errorf("на 30 см рекомендация %d больше, чем на 50 см %d", small.BestLines, s.BestLines)
	}
}

// TC-API-27: автонастройка
func TestAutoTone_TC_API_27(t *testing.T) {
	// Загружаем
	img := uploadImage(t)
	// Ответ:
	type tone struct {
		// яркость
		Brightness float64 `json:"brightness"`
		// контраст
		Contrast float64 `json:"contrast"`
		// сходство до
		ScoreBefore float64 `json:"score_before"`
		// сходство после
		ScoreAfter float64 `json:"score_after"`
		// вариантов
		Candidates int `json:"candidates"`
	}
	// Подбор для кадра «Выделить лицо»
	res, data := doJSON(t, http.MethodPost, "/api/images/"+img.ID+"/auto-tone", map[string]any{"prep": img.FacePrep, "diameter_cm": 50})
	// → 200
	expectStatus(t, res, data, 200)
	// Разбираем
	r := decode[tone](t, data)
	// Не хуже, 6 вариантов, яркость в границах
	if r.ScoreAfter < r.ScoreBefore || r.Candidates != 6 || r.Brightness < -0.5 || r.Brightness > 0.5 {
		// Иначе падаем
		t.Fatalf("автонастройка: %+v", r)
	}
	// Диаметр 5
	res, data = doJSON(t, http.MethodPost, "/api/images/"+img.ID+"/auto-tone", map[string]any{"diameter_cm": 5})
	// → 422
	expectStatus(t, res, data, 422)
}
