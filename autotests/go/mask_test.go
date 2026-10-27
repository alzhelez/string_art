package autotests

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"testing"
)

// TC-API-28: маска, поправленная кистью, принимается в любом размере и сохраняется как «edited».
func TestMaskBrushEdit_TC_API_28(t *testing.T) {
	img := uploadImage(t)
	res, data := do(t, http.MethodPut, "/api/images/"+img.ID+"/mask.png", bytes.NewReader([]byte("not png")), "image/png")
	expectStatus(t, res, data, 400)

	mask := image.NewGray(image.Rect(0, 0, 256, 256)) // вдвое меньше фото — сервер растянет
	for y := 0; y < 256; y++ {
		for x := 64; x < 192; x++ {
			mask.SetGray(x, y, color.Gray{Y: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, mask); err != nil {
		t.Fatal(err)
	}
	res, data = do(t, http.MethodPut, "/api/images/"+img.ID+"/mask.png", &buf, "image/png")
	expectStatus(t, res, data, 200)
	st := decode[map[string]any](t, data)
	if st["status"] != "ready" || st["edited"] != true {
		t.Fatalf("статус маски: %v", st)
	}
	res, data = do(t, http.MethodGet, "/api/images/"+img.ID+"/mask.png", nil, "")
	expectStatus(t, res, data, 200)
	got, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if b := got.Bounds(); b.Dx() != img.Width || b.Dy() != img.Height {
		t.Fatalf("размер маски %v, а фото %dx%d", b, img.Width, img.Height)
	}
}
