import io

import numpy as np
import pytest
from PIL import Image
from pypdf import PdfReader

from app.config import PROCESSING_SIZE
from app.image_prep import ImageError, darkness_map, load_image, target_map, to_grayscale_square
from app.pdf import build_instructions_pdf, expected_page_count
from app.render import line_alpha, render_array, render_png

SEQ = [0, 120, 30, 150, 60, 180, 90, 210, 0]


# --- image_prep ---------------------------------------------------------------
def test_load_rejects_text(not_an_image):
    with pytest.raises(ImageError):
        load_image(not_an_image)


def test_load_rejects_empty():
    with pytest.raises(ImageError):
        load_image(b"")


def test_rgba_png_is_flattened_on_white(portrait_png):
    gray = to_grayscale_square(load_image(portrait_png))
    assert gray.mode == "L"
    assert gray.size == (PROCESSING_SIZE, PROCESSING_SIZE)


def test_non_square_is_center_cropped():
    wide = Image.new("RGB", (900, 300), "white")
    buf = io.BytesIO()
    wide.save(buf, "PNG")
    assert to_grayscale_square(load_image(buf.getvalue())).size == (PROCESSING_SIZE, PROCESSING_SIZE)


def test_darkness_is_zero_outside_circle(portrait_jpg):
    dark = darkness_map(to_grayscale_square(load_image(portrait_jpg)))
    assert dark[0, 0] == 0 and dark[-1, -1] == 0
    assert 0 <= dark.min() and dark.max() <= 1


def test_target_map_gamma_lightens_midtones(portrait_jpg):
    gray = to_grayscale_square(load_image(portrait_jpg))
    assert target_map(gray, gamma=1.6).mean() < target_map(gray, gamma=1.0).mean()


# --- render -------------------------------------------------------------------
def test_zero_steps_is_white():
    assert render_array(SEQ, 0, 100, 50).min() == 255


def test_more_steps_is_darker():
    assert render_array(SEQ, 8, 200, 50).mean() < render_array(SEQ, 2, 200, 50).mean()


def test_smaller_circle_looks_denser():
    assert line_alpha(800, 30) > line_alpha(800, 70)
    assert render_array(SEQ, 8, 200, 30).mean() < render_array(SEQ, 8, 200, 70).mean()


def test_render_png_is_png():
    png = render_png(SEQ, 8, 50, size=150)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert Image.open(io.BytesIO(png)).size == (150, 150)


# --- pdf ----------------------------------------------------------------------
@pytest.fixture(scope="module")
def long_seq() -> list[int]:
    rng = np.random.default_rng(1)
    out = [0]
    while len(out) < 451:
        n = int(rng.integers(0, 240))
        if abs(n - out[-1]) > 20:
            out.append(n)
    return out


def test_pdf_structure(long_seq):
    pdf = build_instructions_pdf("Тест", long_seq, 450, 50)
    assert pdf.startswith(b"%PDF")
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == expected_page_count(450) == 5
    cover = reader.pages[0].extract_text()
    assert "Портрет из нитей" in cover
    assert "Минимальная катушка" in cover
    assert "50,0 см" in cover
    steps_page = reader.pages[2].extract_text()
    assert "A1" in steps_page
    assert "шаги 1–200 из 450" in steps_page
    assert "шаги 401–450 из 450" in reader.pages[4].extract_text()


def test_pdf_rejects_bad_steps(long_seq):
    with pytest.raises(ValueError):
        build_instructions_pdf("x", long_seq, 0, 50)
    with pytest.raises(ValueError):
        build_instructions_pdf("x", long_seq, 451, 50)
