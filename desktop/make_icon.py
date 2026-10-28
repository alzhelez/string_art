"""Рисует значок приложения: desktop/icon.ico (Windows) и frontend/app/icon.svg (вкладка браузера).

python desktop/make_icon.py — запускать после изменения дизайна значка.
"""

# Тригонометрия для расстановки гвоздей по кругу
import math
# Пути
from pathlib import Path

# Рисование картинки
from PIL import Image, ImageDraw

# Корень репозитория
ROOT = Path(__file__).resolve().parent.parent
# Синий акцент (одна выделенная нить)
ACCENT = (53, 80, 240)
# Почти чёрный «чернильный» цвет
INK = (23, 27, 36)
# На значке 24 гвоздя (на настоящей доске 240 — на значке их не разглядеть)
NAILS = 24
# Пары гвоздей, между которыми натянуты нити значка
CHORDS = [(1, 13), (4, 17), (7, 20), (10, 22), (2, 9), (15, 21), (5, 12), (18, 3)]


# Координаты гвоздя i на круге с центром c и радиусом r
def nail(i: int, c: float, r: float) -> tuple[float, float]:
    # Угол: равномерно по кругу, начиная сверху (−π/2)
    a = 2 * math.pi * i / NAILS - math.pi / 2
    # x и y
    return c + r * math.cos(a), c + r * math.sin(a)


# Нарисовать значок размером size × size
def draw(size: int) -> Image.Image:
    # Рисуем в 4 раза крупнее
    k = 4  # рисуем крупнее и уменьшаем — гладкие края
    # Размер черновика
    s = size * k
    # Прозрачная картинка
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    # Инструмент рисования
    d = ImageDraw.Draw(img)
    # Центр и радиус белого круга
    c, r = s / 2, s * 0.47
    # Белый круг с тёмной обводкой
    d.ellipse((c - r, c - r, c + r, c + r), fill=(255, 255, 255, 255), outline=(*INK, 255), width=max(k, s // 40))
    # Радиус кольца гвоздей (внутри белого круга)
    rn = r * 0.82
    # Толщина нити
    w = max(k, s // 64)
    # Рисуем нити
    for a, b in CHORDS:
        # Полупрозрачная тёмная линия между гвоздями
        d.line((*nail(a, c, rn), *nail(b, c, rn)), fill=(*INK, 200), width=w)
    # Одна синяя нить потолще — «текущий шаг»
    d.line((*nail(19, c, rn), *nail(8, c, rn)), fill=(*ACCENT, 255), width=w * 2)
    # Радиус точки гвоздя
    dot = max(k, s // 48)
    # Рисуем гвозди
    for i in range(NAILS):
        # Координаты гвоздя
        x, y = nail(i, c, rn)
        # Тёмная точка
        d.ellipse((x - dot, y - dot, x + dot, y + dot), fill=(*INK, 255))
    # Уменьшаем до нужного размера с качественным сглаживанием
    return img.resize((size, size), Image.Resampling.LANCZOS)


# Тот же значок векторным SVG (для вкладки браузера)
def svg() -> str:
    # Центр, радиус круга и радиус кольца гвоздей в координатах 32 × 32
    c, r, rn = 16, 15, 12.3
    # Координаты гвоздя, округлённые до сотых (короче текст SVG)
    p = lambda i: tuple(round(v, 2) for v in nail(i, c, rn))  # noqa: E731
    # Линии нитей
    lines = "".join(f'<line x1="{p(a)[0]}" y1="{p(a)[1]}" x2="{p(b)[0]}" y2="{p(b)[1]}"/>' for a, b in CHORDS)
    # Точки гвоздей
    dots = "".join(f'<circle cx="{p(i)[0]}" cy="{p(i)[1]}" r="0.75"/>' for i in range(NAILS))
    # Концы синей нити
    a, b = p(19), p(8)
    # Собираем текст SVG
    return (
        # Корневой элемент
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        # Белый круг
        f'<circle cx="16" cy="16" r="{r}" fill="#fff" stroke="#171b24" stroke-width="1"/>'
        # Группа нитей
        f'<g stroke="#171b24" stroke-opacity=".8" stroke-width=".5">{lines}</g>'
        # Синяя нить
        f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="#3550f0" stroke-width="1.1"/>'
        # Гвозди и конец SVG
        f'<g fill="#171b24">{dots}</g></svg>\n'
    )


# Запуск как скрипта
if __name__ == "__main__":
    # Значок 256 × 256
    big = draw(256)
    # ICO с набором размеров — Windows выберет подходящий
    big.save(ROOT / "desktop" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # PNG-версия
    big.save(ROOT / "desktop" / "icon.png")
    # SVG для вкладки браузера
    (ROOT / "frontend" / "app" / "icon.svg").write_text(svg(), encoding="utf-8")
    # Сообщение об успехе
    print("готово")
