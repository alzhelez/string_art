import numpy as np
import pytest

from app.algorithm import build_line_cache, generate_sequence, line_pixels
from app.config import MIN_NAIL_GAP, PROCESSING_SIZE, TOTAL_NAILS
from app.geometry import nail_gap
from app.image_prep import circle_mask


@pytest.fixture(scope="module")
def left_dark() -> np.ndarray:
    """Левая половина круга чёрная, правая белая."""
    size = PROCESSING_SIZE
    dark = np.zeros((size, size), dtype=np.float32)
    dark[:, : size // 2] = 1.0
    dark[~circle_mask(size)] = 0
    return dark


@pytest.fixture(scope="module")
def seq(left_dark) -> list[int]:
    return generate_sequence(left_dark, max_lines=800)


def test_length_and_start(seq):
    assert len(seq) == 801
    assert seq[0] == 0  # A1


def test_values_are_valid_nails(seq):
    assert all(0 <= n < TOTAL_NAILS for n in seq)


def test_min_gap_respected(seq):
    assert all(nail_gap(a, b) >= MIN_NAIL_GAP for a, b in zip(seq, seq[1:]))


def test_no_line_used_twice(seq):
    pairs = [tuple(sorted(p)) for p in zip(seq, seq[1:])]
    assert len(pairs) == len(set(pairs))


def test_is_deterministic(left_dark, seq):
    assert generate_sequence(left_dark, max_lines=800) == seq


def test_fewer_lines_is_prefix_of_more_lines(left_dark, seq):
    """На этом держится мгновенный ползунок количества линий."""
    assert generate_sequence(left_dark, max_lines=300) == seq[:301]


def test_lines_follow_dark_area(seq):
    from app.geometry import nail_xy

    left = 0
    for a, b in zip(seq, seq[1:]):
        (xa, _), (xb, _) = nail_xy(a, 1.0), nail_xy(b, 1.0)
        left += (xa + xb) / 2 < 0
    assert left / (len(seq) - 1) > 0.7


def test_blank_image_still_produces_valid_sequence():
    blank = np.zeros((PROCESSING_SIZE, PROCESSING_SIZE), dtype=np.float32)
    out = generate_sequence(blank, max_lines=50)
    assert len(out) == 51


def test_rejects_non_square():
    with pytest.raises(ValueError):
        generate_sequence(np.zeros((10, 20)), max_lines=5)


def test_rejects_zero_lines(left_dark):
    with pytest.raises(ValueError):
        generate_sequence(left_dark, max_lines=0)


def test_line_pixels_in_bounds_and_without_repeats():
    size = 200
    px = line_pixels(0, 120, size)
    assert px.min() >= 0 and px.max() < size * size
    assert np.all(px[1:] != px[:-1])
    # вертикальная линия через центр: длина ~ диаметр
    assert size - 5 <= len(px) <= size + 1


def test_line_cache_is_built_once():
    assert build_line_cache() is build_line_cache()
