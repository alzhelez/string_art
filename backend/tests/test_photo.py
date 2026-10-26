import json

import numpy as np
import pytest
from PIL import Image

from app import photo
from app.config import PROCESSING_SIZE
from app.algorithm import generate_sequence

from .conftest import FIXTURES

GOLDEN = json.loads((FIXTURES / "prep-golden.json").read_text(encoding="utf-8"))


# --- эталон, общий с frontend/lib/prep.ts --------------------------------------
@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: json.dumps(c["prep"], sort_keys=True)[:60])
def test_golden_tone_pipeline(case):
    h, w = GOLDEN["height"], GOLDEN["width"]
    rgb = np.array(GOLDEN["rgb"], dtype=np.uint8).reshape(h, w, 3)
    mask = np.array(GOLDEN["mask"], dtype=np.uint8).reshape(h, w)
    p = photo.Prep(**case["prep"])
    g = photo.to_gray(rgb)
    if p.remove_background:
        g = photo.apply_mask(g, mask)
    g = photo.brightness_contrast(photo.auto_levels(g), p.brightness, p.contrast)
    out = np.clip(np.rint(g), 0, 255).astype(int).ravel()
    assert np.abs(out - np.array(case["expected"])).max() <= 1


@pytest.mark.parametrize("case", GOLDEN["crop_cases"], ids=lambda c: f"{c['width']}x{c['height']}")
def test_golden_crop_box(case):
    got = photo.crop_box(case["width"], case["height"], photo.Prep(**case["prep"]))
    assert got == pytest.approx(case["expected"], abs=1e-4)


# --- кадр ---------------------------------------------------------------------
def test_crop_default_is_centered_square():
    assert photo.crop_box(1600, 1200, photo.Prep()) == (200, 0, 1200)


def test_crop_zoom_and_clamp_to_edges():
    x0, y0, side = photo.crop_box(800, 800, photo.Prep(center_x=1.0, center_y=0.0, zoom=4))
    assert side == 200
    assert (x0, y0) == (600, 0)  # уткнулись в правый верхний угол, но не вышли за фото


def test_clamp_prep_bounds():
    p = photo.clamp_prep(photo.Prep(center_x=2, center_y=-1, zoom=10, brightness=3, contrast=-3))
    assert (p.center_x, p.center_y, p.zoom, p.brightness, p.contrast) == (1, 0, 4, 0.5, -0.5)


# --- тональные операции ----------------------------------------------------------
def test_auto_levels_stretches_range():
    g = np.linspace(100, 150, 10000, dtype=np.float32)
    out = photo.auto_levels(g)
    assert out.min() == 0 and out.max() == 255


def test_auto_levels_flat_image_unchanged():
    g = np.full(100, 77, dtype=np.float32)
    assert np.all(photo.auto_levels(g) == 77)


def test_brightness_and_contrast():
    g = np.array([0, 128, 255], dtype=np.float32)
    assert photo.brightness_contrast(g, 0.1, 0).tolist() == pytest.approx([25.5, 153.5, 255])
    assert photo.brightness_contrast(g, 0, 1.0).tolist() == pytest.approx([0, 128, 255])
    assert photo.brightness_contrast(g, 0, -0.5).tolist() == pytest.approx([64, 128, 191.5])


def test_mask_makes_background_white():
    g = np.array([10, 10], dtype=np.float32)
    assert photo.apply_mask(g, np.array([255, 0])).tolist() == [10, 255]


def test_prepare_gray_with_background_removed_is_lighter():
    img = Image.open(FIXTURES / "face.jpg").convert("RGB")
    mask = Image.new("L", img.size, 0)
    mask.paste(255, (150, 0, 370, 512))  # «человек» — полоса посередине
    plain = np.asarray(photo.prepare_gray(img, photo.Prep()))
    no_bg = np.asarray(photo.prepare_gray(img, photo.Prep(remove_background=True), mask))
    assert plain.shape == no_bg.shape == (PROCESSING_SIZE, PROCESSING_SIZE)
    assert no_bg[:, :60].mean() > 250  # фон слева стал белым
    assert no_bg.mean() > plain.mean()


def test_normalize_original_limits_size_and_flattens_alpha():
    big = Image.new("RGBA", (4000, 1000), (0, 0, 0, 0))
    out = photo.normalize_original(big)
    assert out.mode == "RGB" and out.size == (1600, 400)
    assert out.getpixel((10, 10)) == (255, 255, 255)


# --- лицо ---------------------------------------------------------------------
@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
def test_face_found_on_portrait():
    faces = photo.detect_faces(Image.open(FIXTURES / "face.jpg"))
    assert faces, "лицо астронавта должно находиться"
    f = faces[0]
    assert 0.3 < f.x + f.w / 2 < 0.55 and 0.1 < f.y + f.h / 2 < 0.4


@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
def test_no_face_on_blank():
    assert photo.detect_faces(Image.new("RGB", (400, 400), "white")) == []


def test_face_prep_frames_head():
    face = photo.Box(x=0.4, y=0.2, w=0.2, h=0.2)
    p = photo.face_prep(1000, 1000, face)
    assert p.face_focus
    assert p.center_x == pytest.approx(0.5)
    assert p.center_y == pytest.approx(0.324)  # чуть ниже центра лица — влезают плечи
    assert p.zoom == pytest.approx(1000 / (200 * 2.4), rel=1e-3)


def test_face_importance_peaks_on_face():
    face = photo.Box(x=0.4, y=0.4, w=0.2, h=0.2)
    imp = photo.face_importance(1000, 1000, photo.Prep(), face)
    c = PROCESSING_SIZE // 2
    assert imp[c, c] == pytest.approx(2.0)
    assert imp[5, 5] == pytest.approx(1.0, abs=1e-3)


def test_importance_pulls_lines_to_region():
    size = PROCESSING_SIZE
    dark = np.full((size, size), 0.5, dtype=np.float32)
    imp = np.ones_like(dark)
    imp[:, : size // 2] = 3.0  # левая половина важнее
    seq = generate_sequence(dark, max_lines=300, importance=imp)
    from app.geometry import nail_xy

    left = sum((nail_xy(a, 1)[0] + nail_xy(b, 1)[0]) / 2 < 0 for a, b in zip(seq, seq[1:]))
    assert left / 300 > 0.6


def test_importance_shape_mismatch():
    with pytest.raises(ValueError):
        generate_sequence(np.zeros((10, 10)), max_lines=1, importance=np.ones((5, 5)))
