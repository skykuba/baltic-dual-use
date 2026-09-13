# Scenariusz wystąpienia — 3 minuty z demem

Sześć slajdów, demo w środku. Ciężar leży na problemie i modelu biznesowym;
technika jest w demie i w jednej liczbie, nie w wykładzie. Notatki są też wpisane
w plik `.pptx` (widok prelegenta) — ten dokument służy do prób i do wydruku.

**Przed wejściem na scenę:** aplikacja uruchomiona, warstwa mapowa pobrana,
symulacja **zapauzowana** na starcie, tempo **4×**, GNSS **włączony**. Drugie okno
z deckiem. Nie pobieraj mapy przy jury — to trwa i nie jest częścią opowieści.

---

## 0:00–0:35 · Slajd 1 — problem

> Jesteśmy baltic-dual-use i rozwiązujemy jeden problem: jak żołnierz ma wiedzieć,
> gdzie jest, kiedy GPS nie działa.
>
> Nie zacznę od technologii, bo problem jest już teraz i tutaj. W sierpniu tego roku
> zakłócenia GNSS wystąpiły nad Polską w **sześćdziesięciu trzech procentach dni**.
> W maju i czerwcu w siedemdziesięciu. Nad Pomorzem, w samym lipcu, blisko
> **dziewięćdziesiąt godzin**. Spoofing z obwodu kaliningradzkiego sięga
> czterystu pięćdziesięciu kilometrów. W sierpniu zagłuszono **ORP Albatros**
> podczas operacji na Bałtyku.
>
> To nie jest scenariusz na wypadek wojny. To warunki pracy.

*Nie przyspieszaj. Liczby mają zdążyć wybrzmieć — to jest slajd, który sprzedaje
całą resztę.*

---

## 0:35–0:55 · Slajd 2 — luka rynkowa

> Rynek Assured PNT to dziś miliard sto milionów dolarów, w 2035 ponad dziesięć
> miliardów, przy prawie trzydziestoprocentowym wzroście rocznie. Sześćdziesiąt
> procent tego rynku to obronność.
>
> Ale spójrzcie, co się na nim sprzedaje. Największy gracz w naszym segmencie ma
> kontrakt na **czterysta milionów dolarów** — na urządzenia montowane na bucie
> żołnierza.
>
> Wszyscy sprzedają sprzęt. Nasza teza jest inna: **dziewięćdziesiąt procent tej
> wartości da się dostarczyć jako oprogramowanie**, na czujnikach, które żołnierz
> już nosi w kieszeni.

---

## 0:55–1:20 · Slajd 3 — model biznesowy

> Model jest prosty: **roczna licencja na użytkownika** plus projekt wdrożeniowy.
> Żadnego sprzętu do kupienia — czujniki są już w kieszeni żołnierza, więc jednostka
> nie potrzebuje ani nakładów inwestycyjnych, ani przetargu na urządzenia.
> Wdrożenie liczy się w tygodniach, nie w latach, a aktualizację wypuszczamy
> zdalnie na całą jednostkę naraz.
>
> I rzecz najważniejsza: to jest **dual-use w dosłownym sensie**. Ten sam kod działa
> dla straży granicznej, dla ratownictwa górskiego i morskiego, dla strażaka
> w zadymionym budynku, gdzie GPS nie działa z zupełnie innego powodu.
> Rynek cywilny finansuje rozwój, wojskowy go waliduje.

*Jeśli ktoś zapyta o cenę: nie podawaj liczby, której nie obronisz. Powiedz, że
punktem odniesienia jest koszt urządzenia u konkurencji — kilka tysięcy dolarów
na żołnierza jednorazowo — i że licencja ma być ułamkiem tej kwoty rocznie.*

*Przełącz okno na aplikację.*

---

## 1:20–2:20 · Slajd 4 — DEMO (60 sekund, cztery ruchy)

| Czas | Ruch | Co mówisz |
|---|---|---|
| 0–10 s | **Start**, potem **zagłusz GNSS** | „I w tym momencie Kaliningrad włącza walkę elektroniczną." |
| 10–25 s | pozwól estymacie odpłynąć | „Od tej sekundy pozycja liczy się wyłącznie z czujników w telefonie." Pokaż rosnący błąd i pęczniejący okrąg niepewności. |
| 25–45 s | **wyłącz map matching**, potem **włącz** | „Bez mapy pozycja odpływa swobodnie. Z mapą — trzyma się ulic." Najkrótszy sposób, żeby pokazać, co mapa wnosi. |
| 45–60 s | **skoryguj pozycję** → klik w skrzyżowanie | „Żołnierz rozpoznaje skrzyżowanie. Jedno dotknięcie." Chmura kolapsuje, błąd spada do zera. |

**Jeśli zostaje czas** (i tylko wtedy): wyznacz trasę do szpitala —
„I stąd system prowadzi go do punktu medycznego, bez sieci i bez GPS."

**Jeśli coś się zawiesi:** nie naprawiaj na scenie. Powiedz „liczby z tego przebiegu
mam na następnym slajdzie" i przełącz. Slajd 5 niesie całą treść demo.

---

## 2:20–2:45 · Slajd 5 — dowód

> Jedna liczba do zapamiętania: dopasowanie do mapy zbija błąd pozycji
> o **dziewięćdziesiąt dwa procent** — z czterech procent przebytej drogi do
> trzydziestu czterech setnych. Osiem przebiegów na osiem.
>
> Dla porównania: najlepsze rozwiązanie **sprzętowe** opisane w literaturze osiąga
> od trzydziestu dwóch setnych do jednego procenta. Jesteśmy w tym samym rzędzie
> wielkości — na telefonie.
>
> I mówię wprost, gdzie to nie działa. Gdy żołnierz schodzi z sieci dróg, mapa
> przestaje pomagać. Dlatego korekcja ręczna nie jest dodatkiem, tylko częścią
> konstrukcji.

*Ostatnie zdanie zostaw. Zespół, który zna granice własnej metody, wygląda
poważniej niż zespół z samymi dobrymi liczbami.*

---

## 2:45–3:00 · Slajd 6 — ask

> Każda liczba, którą pokazałem, jest odtwarzalna jednym poleceniem — mamy osiem
> skryptów pomiarowych. Następny krok to surowe dane z prawdziwego telefonu
> przepuszczone przez ten sam łańcuch. Szukamy **pilota z jednostką działającą
> w terenie zakłócanym**.
>
> Zakłócenia GNSS to warunki pracy, nie awaria — a nasza odpowiedź nie wymaga
> kupowania nowego sprzętu. Dziękuję.

---

## Ściąga na trudne pytania

**„Jaka jest cena?"**
Punktem odniesienia jest koszt urządzenia u konkurencji: kilka tysięcy dolarów na
żołnierza, jednorazowo, plus cykl zakupowy w latach. Licencja roczna ma być ułamkiem
tej kwoty, bez nakładów na sprzęt. Konkretną stawkę ustalamy przy pilocie.

**„Kto konkretnie to kupi?"**
Pierwszy odbiorca to jednostka działająca w terenie zakłócanym — dziś to całe Pomorze.
Równolegle rynek cywilny: ratownictwo górskie i morskie, straż pożarna, służby
kryzysowe. To ten sam produkt, więc jeden zespół obsługuje oba rynki.

**„Skąd wiemy, że nie oszukujecie — symulator zna prawdziwą trasę."**
Ground truth jest w strumieniu danych, ale estymator go nie widzi. Trafia wyłącznie
na front, żeby narysować szarą linię i policzyć błąd.

**„To symulacja. Jak to zachowa się na prawdziwych czujnikach?"**
Symulator generuje dryfujący bias żyroskopu, zaburzenia magnetyczne zależne od terenu
i błąd GNSS skorelowany w czasie — czyli to, co realnie psuje takie systemy. Interfejs
przyjmuje surowe odczyty IMU, więc podmiana źródła na prawdziwy telefon nie dotyka logiki.

**„Co, jeśli OpenStreetMap jest dziurawy?"**
Mapa jest warstwą wspomagającą, nie warunkiem działania. Bez niej wracamy do błędu
rzędu dwóch–sześciu procent przebytej drogi zamiast trzydziestu czterech setnych.

**„Czym to się różni od map offline?"**
Nawigacja offline zakłada, że wiesz, gdzie jesteś. My rozwiązujemy dokładnie ten
problem, w którym tego nie wiesz.

---

## Czego NIE mówić

- Nie podawaj ceny ani prognozy przychodów, której nie obronisz pytaniem „skąd ta liczba".
- Nie obiecuj dokładności bez podania scenariusza. 0,34% dotyczy marszu siecią dróg.
- Nie przedstawiaj symulacji jako pomiarów terenowych.
- Nie pomijaj granicy metody. Jeśli jury znajdzie tę słabość samo, wyjdzie na to,
  że jej nie znaliście.
