"""Liczy piksele charakterystyczne dla obu kropek pozycji na zrzucie ekranu.

MapLibre nie zachowuje bufora rysowania, więc odczyt pikseli z kanwy przez
WebGL zwraca pustkę. Zrzut ekranu jest już skompozytowany, więc analiza
na nim mówi to, co naprawdę widzi operator.
"""
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui.png"
img = Image.open(path).convert("RGB")
w, h = img.size

# Obszar mapy: między panelami bocznymi po 320 px.
left, right = 330, w - 330
px = img.load()

# Legenda i pasek stanu zawierają te same kolory co znaczniki na mapie
# (biała obwódka, pomarańczowa kropka), więc bez ich wykluczenia test
# przechodziłby także wtedy, gdy mapa jest zupełnie pusta.
EXCLUDED = [
    (330, 0, 600, 210),      # legenda
    (640, 0, 960, 80),       # pasek stanu warstwy mapowej
    (1220, 740, 1290, 860),  # kontrolki nawigacji MapLibre
    (330, 855, 400, 895),    # podziałka
    (1050, 860, 1290, 900),  # atrybucja
]


def excluded(x, y):
    return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in EXCLUDED)

bright = amber = violet = cyan = 0
for y in range(0, h):
    for x in range(left, right):
        if excluded(x, y):
            continue
        r, g, b = px[x, y]
        # Próg łagodniejszy niż „czysta biel": obwódka ma 2,5 px i jest
        # antyaliasowana na niemal czarnym tle, więc pikseli o pełnej
        # jasności jest tylko kilka.
        if r > 165 and g > 165 and b > 165 and abs(r - b) < 30:
            bright += 1
        elif r > 200 and 130 < g < 195 and b < 90:
            amber += 1
        elif 140 < r < 200 and 110 < g < 160 and b > 220:
            violet += 1
        elif r < 90 and g > 180 and b > 200:
            cyan += 1

print(f"obszar mapy: {right-left}x{h} px")
print(f"  jasne (pozycja rzeczywista, biała obwódka): {bright}")
print(f"  pomarańczowe (pozycja estymowana):          {amber}")
print(f"  fioletowe (korekcja ręczna):                {violet}")
print(f"  cyjan (ślad GNSS):                          {cyan}")

ok = bright > 15 and amber > 15
print("\n" + ("✓ obie kropki widoczne" if ok else "✗ brakuje kropek pozycji"))
sys.exit(0 if ok else 1)
