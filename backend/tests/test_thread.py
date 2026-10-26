import pytest

from app.thread import cumulative_lengths_m, pick_spool, raw_length_m, recommended_lines, thread_stats

# A1 → C1 (противоположные, хорда = D) → A1 (ещё раз D) → A31 (gap 30 → D·sin(22.5°))
SEQ = [0, 120, 0, 30]


def test_raw_length_known_sequence():
    assert raw_length_m(SEQ, 2, 50) == pytest.approx(1.0)  # 2 × 0.5 м


def test_cumulative_lengths():
    cum = cumulative_lengths_m(SEQ, 50)
    assert cum[0] == 0
    assert cum == sorted(cum)
    assert cum[-1] == pytest.approx(raw_length_m(SEQ, 3, 50))


def test_steps_out_of_range():
    with pytest.raises(ValueError):
        raw_length_m(SEQ, 4, 50)
    with pytest.raises(ValueError):
        raw_length_m(SEQ, -1, 50)


def test_margin_is_15_percent_by_default():
    stats = thread_stats(SEQ, 2, 50)
    assert stats.margin == 0.15
    assert stats.total_length_m == pytest.approx(1.15, abs=0.05)


def test_length_scales_with_diameter():
    small = thread_stats(SEQ, 3, 30).raw_length_m
    big = thread_stats(SEQ, 3, 60).raw_length_m
    assert big == pytest.approx(2 * small, rel=1e-2)


@pytest.mark.parametrize(
    "length, expected",
    [
        (0, (100, 1)),
        (99.9, (100, 1)),
        (100, (100, 1)),
        (100.1, (150, 1)),
        (999, (1000, 1)),
        (1176.7, (1500, 1)),
        (5000, (5000, 1)),
        (5000.1, (1000, 6)),
        (12345, (1000, 13)),
    ],
)
def test_pick_spool_boundaries(length, expected):
    assert pick_spool(length) == expected


def test_pick_spool_negative():
    with pytest.raises(ValueError):
        pick_spool(-1)


def test_spool_is_never_smaller_than_required():
    for length in range(0, 20000, 37):
        size, count = pick_spool(length)
        assert size * count >= length


@pytest.mark.parametrize("d, lines", [(20, 1000), (25, 1000), (30, 1200), (50, 2000), (70, 2800), (125, 5000), (150, 5000)])
def test_recommended_lines(d, lines):
    assert recommended_lines(d) == lines
