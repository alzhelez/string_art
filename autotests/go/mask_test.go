// Тот же пакет — видны помощники из client_test.go
package autotests

// Импорты:
import (
	// bytes — буферы
	"bytes"
	// image — картинка маски
	"image"
	// image/color — цвет пикселя
	"image/color"
	// image/png — кодирование и чтение PNG
	"image/png"
	// net/http — методы запросов
	"net/http"
	// testing — тесты
	"testing"
)

// TC-API-28: маска, поправленная кистью, принимается в любом размере и сохраняется как «edited».
// Тест кейса TC-API-28
func TestMaskBrushEdit_TC_API_28(t *testing.T) {
	// Загружаем фото
	img := uploadImage(t)
	// Отправляем не PNG
	res, data := do(t, http.MethodPut, "/api/images/"+img.ID+"/mask.png", bytes.NewReader([]byte("not png")), "image/png")
	// → 400
	expectStatus(t, res, data, 400)

	// Маска 256×256 в оттенках серого
	mask := image.NewGray(image.Rect(0, 0, 256, 256)) // вдвое меньше фото — сервер растянет
	// По всем строкам —
	for y := 0; y < 256; y++ {
		// — в полосе посередине —
		for x := 64; x < 192; x++ {
			// — белые пиксели («человек»)
			mask.SetGray(x, y, color.Gray{Y: 255})
		}
	}
	// Буфер
	var buf bytes.Buffer
	// Кодируем маску в PNG
	if err := png.Encode(&buf, mask); err != nil {
		// Не получилось — падаем
		t.Fatal(err)
	}
	// Отправляем маску
	res, data = do(t, http.MethodPut, "/api/images/"+img.ID+"/mask.png", &buf, "image/png")
	// → 200
	expectStatus(t, res, data, 200)
	// Ответ
	st := decode[map[string]any](t, data)
	// Маска готова и отмечена как исправленная
	if st["status"] != "ready" || st["edited"] != true {
		// Иначе падаем со статусом
		t.Fatalf("статус маски: %v", st)
	}
	// Скачиваем сохранённую маску
	res, data = do(t, http.MethodGet, "/api/images/"+img.ID+"/mask.png", nil, "")
	// → 200
	expectStatus(t, res, data, 200)
	// Читаем PNG
	got, err := png.Decode(bytes.NewReader(data))
	// Не PNG —
	if err != nil {
		// — падаем
		t.Fatal(err)
	}
	// Размер маски равен размеру фото
	if b := got.Bounds(); b.Dx() != img.Width || b.Dy() != img.Height {
		// Иначе падаем
		t.Fatalf("размер маски %v, а фото %dx%d", b, img.Width, img.Height)
	}
}
