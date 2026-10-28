// Тот же пакет — видны помощники
package autotests

// Импорты:
import (
	// bytes — буферы
	"bytes"
	// image — рисуем картинку
	"image"
	// image/color — цвет
	"image/color"
	// image/png — PNG
	"image/png"
	// mime/multipart — форма загрузки
	"mime/multipart"
	// net/http — методы
	"net/http"
	// testing — тесты
	"testing"
)

// uploadBlank загружает однотонную картинку — на ней точно нет лица.
func uploadBlank(t *testing.T) imageInfo {
	// Ошибки — в строке теста
	t.Helper()
	// Картинка 300×300
	pic := image.NewRGBA(image.Rect(0, 0, 300, 300))
	// По строкам —
	for y := 0; y < 300; y++ {
		// — по столбцам —
		for x := 0; x < 300; x++ {
			// — светло-серый пиксель
			pic.Set(x, y, color.RGBA{R: 200, G: 200, B: 200, A: 255})
		}
	}
	// Буфер для PNG
	var img bytes.Buffer
	// Кодируем
	if err := png.Encode(&img, pic); err != nil {
		// Ошибка — падаем
		t.Fatal(err)
	}
	// Буфер формы
	var buf bytes.Buffer
	// Писатель формы
	w := multipart.NewWriter(&buf)
	// Поле файла
	part, _ := w.CreateFormFile("file", "blank.png")
	// Содержимое
	part.Write(img.Bytes())
	// Завершаем форму
	w.Close()
	// Отправляем
	res, data := do(t, http.MethodPost, "/api/images", &buf, w.FormDataContentType())
	// → 201
	expectStatus(t, res, data, 201)
	// Разбираем
	return decode[imageInfo](t, data)
}

// meanBrightness — средняя яркость PNG в оттенках серого.
func meanBrightness(t *testing.T, data []byte) (float64, image.Rectangle) {
	// Ошибки — в строке теста
	t.Helper()
	// Читаем PNG
	pic, err := png.Decode(bytes.NewReader(data))
	// Не PNG —
	if err != nil {
		// — падаем
		t.Fatal(err)
	}
	// Размеры
	b := pic.Bounds()
	// Сумма яркостей
	var sum float64
	// По строкам —
	for y := b.Min.Y; y < b.Max.Y; y++ {
		// — по столбцам —
		for x := b.Min.X; x < b.Max.X; x++ {
			// — красный канал (в сером он равен яркости), 16 бит
			r, _, _, _ := pic.At(x, y).RGBA()
			// — переводим в 8 бит и добавляем
			sum += float64(r >> 8)
		}
	}
	// Средняя яркость и размер
	return sum / float64(b.Dx()*b.Dy()), b
}

// TC-API-20: подготовленный кадр — 400×400; яркость делает его светлее, зум меняет кадр, zoom 5 → 422.
func TestPreparedImage_TC_API_20(t *testing.T) {
	// Загружаем фото
	img := uploadImage(t)
	// Адрес подготовленного кадра
	base := "/api/images/" + img.ID + "/prepared.png"
	// Кадр без правок
	res, plain := do(t, http.MethodGet, base, nil, "")
	// → 200
	expectStatus(t, res, plain, 200)
	// С яркостью +0,3
	_, bright := do(t, http.MethodGet, base+"?brightness=0.3", nil, "")
	// С зумом 3
	_, zoomed := do(t, http.MethodGet, base+"?zoom=3&center_x=0.43", nil, "")
	// Средняя яркость и размер без правок
	m0, size := meanBrightness(t, plain)
	// С яркостью
	m1, _ := meanBrightness(t, bright)
	// С зумом
	m2, _ := meanBrightness(t, zoomed)
	// Размер 400×400
	if size.Dx() != 400 || size.Dy() != 400 {
		// Иначе падаем
		t.Fatalf("размер кадра %v", size)
	}
	// Яркость выросла заметно
	if m1 <= m0+10 {
		// Иначе ошибка
		t.Errorf("яркость +0,3 не осветлила кадр: %.1f → %.1f", m0, m1)
	}
	// Зум изменил кадр
	if bytes.Equal(plain, zoomed) || approx(m0, m2, 0.01) {
		// Иначе ошибка
		t.Error("зум не изменил кадр")
	}
	// Зум 5
	res, data := do(t, http.MethodGet, base+"?zoom=5", nil, "")
	// → 422
	expectStatus(t, res, data, 422)
}

// TC-API-22: «Выделить лицо» — с лицом портрет создаётся, без лица — понятная ошибка 422.
func TestFaceFocus_TC_API_22(t *testing.T) {
	// Загружаем фото с лицом
	img := uploadImage(t)
	// Создаём проект с готовым кадром лица
	res, data := doJSON(t, http.MethodPost, "/api/projects/from-image", map[string]any{
		// id, название, параметры
		"image_id": img.ID, "name": "Go: лицо", "prep": img.FacePrep,
	})
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
	t.Cleanup(func() { do(t, http.MethodDelete, "/api/projects/"+p.ID, nil, "") })
	// Флажок сохранился
	if p.Prep["face_focus"] != true {
		// Иначе ошибка
		t.Errorf("face_focus не сохранился: %v", p.Prep)
	}

	// Однотонная картинка
	blank := uploadBlank(t)
	// Лиц нет
	if len(blank.Faces) != 0 {
		// Иначе падаем
		t.Fatalf("на однотонной картинке нашлось лицо: %+v", blank.Faces)
	}
	// Просим «Выделить лицо» без лица
	res, data = doJSON(t, http.MethodPost, "/api/projects/from-image", map[string]any{
		// id и флажок
		"image_id": blank.ID, "prep": map[string]any{"face_focus": true},
	})
	// → 422
	expectStatus(t, res, data, 422)
	// Текст про лицо
	if !contains(string(data), "лицо") {
		// Иначе ошибка
		t.Errorf("текст ошибки: %s", data)
	}
}

// TC-API-25: корень бэкенда ведёт на приложение (307), favicon не даёт ошибку.
func TestRootRedirect_TC_API_25(t *testing.T) {
	// Клиент, который не идёт по перенаправлениям
	noFollow := &http.Client{Timeout: client.Timeout, CheckRedirect: func(*http.Request, []*http.Request) error {
		// возвращаем сам ответ 307
		return http.ErrUseLastResponse
	}}
	// Запрос корня
	res, err := noFollow.Get(baseURL + "/")
	// Нет связи —
	if err != nil {
		// — падаем
		t.Fatal(err)
	}
	// Тело не нужно
	res.Body.Close()
	// В обычном режиме — перенаправление на фронтенд; в программе для Windows — сама страница
	// Только 307 или 200
	if res.StatusCode != 307 && res.StatusCode != 200 {
		// Иначе падаем
		t.Fatalf("GET / → %d", res.StatusCode)
	}
	// У перенаправления есть адрес
	if res.StatusCode == 307 && res.Header.Get("Location") == "" {
		// Иначе ошибка
		t.Error("нет адреса перенаправления")
	}
	// Иконка
	res2, data := do(t, http.MethodGet, "/favicon.ico", nil, "")
	// 204 или 200
	if res2.StatusCode != 204 && res2.StatusCode != 200 {
		// Иначе падаем
		t.Fatalf("favicon → %d %s", res2.StatusCode, data)
	}
}
