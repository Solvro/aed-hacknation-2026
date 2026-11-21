# Modele 3D

| Plik | Opis | Licencja |
|---|---|---|
| `victim.glb` | Poszkodowany: mężczyzna ok. 45 lat, biały T-shirt (osobny obiekt `Shirt`), jeansy, buty | CC0 1.0 |
| `rescuer.glb` | Ratowniczka: kobieta ok. 25 lat, koszula, jeansy, kucyk | CC0 1.0 |

Postacie wygenerowane przez zespół w Blenderze za pomocą **MPFB2** (MakeHuman Plugin for Blender)
z zasobów **MakeHuman system assets** (skóry, oczy, brwi, rzęsy, zęby, włosy, ubrania), szkielet `game_engine`.

- MakeHuman: modele eksportowane z MakeHuman/MPFB oraz zasoby systemowe są udostępnione na licencji CC0
  – https://static.makehumancommunity.org/about/license.html
- MPFB2 (narzędzie, GPLv3 – nie jest częścią rozwiązania): https://github.com/makehumancommunity/mpfb2

Odtworzenie: `scripts/models/build_human.py` + `scripts/models/victim.json` / `rescuer.json`
(Blender 4.2+, MPFB 2.0.18, pakiet `makehuman_system_assets_cc0.zip`), następnie
`gltf-transform optimize <in> <out> --compress meshopt --texture-compress webp --texture-size 2048`.

Pozowanie, animacje i punkty anatomiczne są liczone w kodzie (`src/components/aed-trainer/scene/`).
