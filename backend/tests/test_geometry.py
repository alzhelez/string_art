import math

import pytest

from app.config import NAILS_PER_SECTOR, TOTAL_NAILS
from app.geometry import (
    arc_spacing,
    chord_length,
    nail_angle,
    nail_gap,
    nail_label,
    nail_xy,
    parse_label,
)


def test_total_nails_is_240():
    assert TOTAL_NAILS == 240
    assert NAILS_PER_SECTOR == 60


@pytest.mark.parametrize(
    "index, label",
    [(0, "A1"), (59, "A60"), (60, "B1"), (119, "B60"), (120, "C1"), (179, "C60"), (180, "D1"), (239, "D60")],
)
def test_sector_boundaries_labels(index, label):
    assert nail_label(index) == label
    assert parse_label(label) == index


def test_label_roundtrip_for_every_nail():
    labels = [nail_label(i) for i in range(TOTAL_NAILS)]
    assert len(set(labels)) == TOTAL_NAILS
    assert [parse_label(lbl) for lbl in labels] == list(range(TOTAL_NAILS))


@pytest.mark.parametrize("raw, expected", [("a1", 0), (" C 37 ", 156), ("d-60", 239), ("B05", 64)])
def test_parse_label_is_lenient_to_format(raw, expected):
    assert parse_label(raw) == expected


@pytest.mark.parametrize("bad", ["", "A", "1A", "E1", "A0", "A61", "AA1", "A100", "Ж5"])
def test_parse_label_rejects_garbage(bad):
    with pytest.raises(ValueError):
        parse_label(bad)


@pytest.mark.parametrize("bad", [-1, 240, 1000])
def test_index_out_of_range(bad):
    with pytest.raises(ValueError):
        nail_label(bad)
    with pytest.raises(ValueError):
        nail_angle(bad)


# Экранные координаты: Y вниз, поэтому «сверху» = y < 0.
@pytest.mark.parametrize(
    "sector, x_sign, y_sign",
    [(0, -1, -1), (1, +1, -1), (2, +1, +1), (3, -1, +1)],
    ids=["A=лево-верх", "B=право-верх", "C=право-низ", "D=лево-низ"],
)
def test_sectors_are_quadrants_split_by_axes(sector, x_sign, y_sign):
    for n in range(NAILS_PER_SECTOR):
        x, y = nail_xy(sector * NAILS_PER_SECTOR + n, radius=1.0)
        assert x * x_sign > 0 and y * y_sign > 0


def test_no_nail_lies_on_axis():
    for i in range(TOTAL_NAILS):
        x, y = nail_xy(i, radius=1.0)
        assert abs(x) > 1e-6 and abs(y) > 1e-6


def test_numbering_goes_clockwise():
    angles = [nail_angle(i) for i in range(TOTAL_NAILS)]
    assert angles == sorted(angles)
    # A1 — сразу над левой точкой оси X: x около -R, y чуть меньше 0 (выше оси)
    x, y = nail_xy(0, radius=1.0)
    assert x < -0.99 and -0.02 < y < 0
    # A60 — сразу слева от верхней точки, B1 — сразу справа от неё
    x60, y60 = nail_xy(59, radius=1.0)
    xb1, yb1 = nail_xy(60, radius=1.0)
    assert -0.02 < x60 < 0 < xb1 < 0.02 and y60 < -0.99 and yb1 < -0.99


def test_nails_are_equidistant():
    pts = [nail_xy(i, radius=100.0) for i in range(TOTAL_NAILS)]
    dists = [math.dist(pts[i], pts[(i + 1) % TOTAL_NAILS]) for i in range(TOTAL_NAILS)]
    assert max(dists) - min(dists) < 1e-9


def test_nail_gap_is_symmetric_and_circular():
    assert nail_gap(0, 239) == 1
    assert nail_gap(239, 0) == 1
    assert nail_gap(0, 120) == 120
    assert max(nail_gap(0, j) for j in range(TOTAL_NAILS)) == 120


def test_chord_between_opposite_nails_equals_diameter():
    assert chord_length(0, 120, 50) == pytest.approx(50)
    assert chord_length(45, 165, 70) == pytest.approx(70)


def test_chord_of_neighbours_is_close_to_arc():
    assert chord_length(0, 1, 50) == pytest.approx(arc_spacing(50), rel=1e-3)


def test_arc_spacing_for_50cm():
    assert arc_spacing(500) == pytest.approx(6.545, abs=1e-3)  # мм
