#!/usr/bin/env bash
# Test smoke modułu „Ogólnopolski zbiór AED” – sprawdza WYŁĄCZNIE elementy dodane/zmienione przez moduł:
# flagę zbioru AED w API, endpointy /aed/*, agregat (zbiór MC z zasobami CSV/GeoJSON), synchronizację
# per dostawca, brak publicznego zapisu oraz panel raportów z izolacją instytucji.
#
# Wymagania: działające środowisko docker (mcod-admin, mcod-api, mcod-celery), wykonane komendy
# aed_init_aggregate i aed_seed_demo, wpisy *.mcod.local w /etc/hosts, curl, jq.
#
# Użycie: scripts/aed_smoke.sh   (zmienne: API, ADMIN, AED_PASS, ADMIN_CONTAINER, TIMEOUT)
set -uo pipefail

API="${API:-https://api.mcod.local/1.4}"
ADMIN="${ADMIN:-https://admin.mcod.local}"
AED_PASS="${AED_PASS:-Aed2026!demo}"
ADMIN_CONTAINER="${ADMIN_CONTAINER:-mcod-admin}"
TIMEOUT="${TIMEOUT:-240}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
ok()   { PASS=$((PASS + 1)); printf '✅ %s\n' "$*"; }
fail() { printf '❌ %s\n' "$*"; printf '\nWynik: %d testów OK, przerwano na błędzie.\n' "$PASS"; exit 1; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else fail "$desc"; fi; }
jqt() { jq -e "$@" >/dev/null 2>&1; }  # jq jako warunek (bez wypisywania)

get() { # get <url> <outfile> -> kod HTTP
  curl -sk -m 60 -o "$2" -w '%{http_code}' "$1"
}
code_of() { curl -sk -m 60 -o /dev/null -w '%{http_code}' "$@"; }

echo "== Moduł AED – test smoke (API: $API, panel: $ADMIN)"

# --- 1. Flaga zbioru AED w API zbiorów -------------------------------------------------------------
c=$(get "$API/datasets?is_aed_dataset=true&per_page=50" "$TMP/ds.json")
n=$(jq '.meta.count' "$TMP/ds.json" 2>/dev/null)
# liczba dostawców = liczba opublikowanych zbiorów oznaczonych jako AED (np. 4 z aed_seed_demo + kolejne)
EXPECTED_PROVIDERS="${EXPECTED_PROVIDERS:-$n}"
check "GET /datasets?is_aed_dataset=true → HTTP $c, zbiorów AED: $n (oczekiwano ≥ 4)" \
  test "$c" = 200 -a "$n" -ge 4
check "każdy zwrócony zbiór ma attributes.is_aed_dataset == true" \
  jqt '[.data[].attributes.is_aed_dataset] | all' "$TMP/ds.json"

# --- 2. Statystyki ----------------------------------------------------------------------------------
c=$(get "$API/aed/stats" "$TMP/stats.json")
total=$(jq '.data.total' "$TMP/stats.json")
providers=$(jq '.data.providers' "$TMP/stats.json")
check "GET /aed/stats → HTTP $c, AED: $total, dostawców: $providers" \
  test "$c" = 200 -a "$total" -gt 0 -a "$providers" = "$EXPECTED_PROVIDERS"
check "procenty w statystykach mieszczą się w 0–100" \
  jqt '[.data.always_open_pct, .data.locked_pct, .data.verified_12m_pct, .data.avg_quality] | all(. >= 0 and . <= 100)' "$TMP/stats.json"

# --- 3. Rekordy -------------------------------------------------------------------------------------
c=$(get "$API/aed/records?per_page=5" "$TMP/rec.json")
count=$(jq '.meta.count' "$TMP/rec.json")
check "GET /aed/records → HTTP $c, meta.count=$count == stats.total=$total" test "$c" = 200 -a "$count" = "$total"
check "rekordy mają aed_uid, dostawca, zbior_zrodlowy, data_aktualizacji i współrzędne w Polsce" \
  jqt '[.data[].attributes | (.aed_uid|length>0) and (.dostawca|length>0) and (.zbior_zrodlowy|length>0)
          and (.data_aktualizacji|length>0) and (.szerokosc_geogr>=49 and .szerokosc_geogr<=54.9)
          and (.dlugosc_geogr>=14.1 and .dlugosc_geogr<=24.2)] | all' "$TMP/rec.json"
c=$(get "$API/aed/records?dostawca=Krosna&per_page=500" "$TMP/krosno.json")
check "filtr ?dostawca=Krosna zwraca tylko rekordy Urzędu Miasta Krosna (HTTP $c, $(jq '.meta.count' "$TMP/krosno.json") rek.)" \
  jqt '(.data|length>0) and ([.data[].attributes.dostawca] | all(. == "Urząd Miasta Krosna"))' "$TMP/krosno.json"
uid=$(jq -r '.data[0].id' "$TMP/rec.json")
c=$(get "$API/aed/records/$uid" "$TMP/one.json")
check "GET /aed/records/$uid → HTTP $c z historią zmian" jqt '.data.attributes.historia | type == "array"' "$TMP/one.json"

# --- 4. Mapa (GeoJSON) ------------------------------------------------------------------------------
c=$(get "$API/aed/records.geojson" "$TMP/map.geojson")
nf=$(jq '.features | length' "$TMP/map.geojson")
check "GET /aed/records.geojson → HTTP $c, FeatureCollection, punktów: $nf == $total" \
  jqt --argjson t "$total" '.type == "FeatureCollection" and (.features|length) == $t' "$TMP/map.geojson"

# --- 5. Agregat jako zwykły zbiór portalu ----------------------------------------------------------
c=$(get "$API/aed/aggregate" "$TMP/agg.json")
ds_id=$(jq -r '.data.attributes.dataset_id' "$TMP/agg.json")
csv_id=$(jq -r '.data.attributes.csv_resource_id' "$TMP/agg.json")
geo_id=$(jq -r '.data.attributes.geojson_resource_id' "$TMP/agg.json")
check "GET /aed/aggregate → HTTP $c: zbiór #$ds_id, CSV #$csv_id, GeoJSON #$geo_id" \
  test "$c" = 200 -a "$ds_id" != null -a "$csv_id" != null -a "$geo_id" != null
get "$API/datasets/$ds_id?include=institution" "$TMP/aggds.json" >/dev/null
owner=$(jq -r '[.included[]? | select(.type=="institution") | .attributes.title][0]' "$TMP/aggds.json")
check "właścicielem agregatu jest „Ministerstwo Cyfryzacji” (jest: $owner)" test "$owner" = "Ministerstwo Cyfryzacji"
# API portalu cache'uje odpowiedzi – parametr _ omija cache; po przebudowie agregatu portal reindeksuje dane (ponawiamy)
for _try in $(seq 1 12); do
  c=$(get "$API/resources/$csv_id/data?per_page=1&_=$(date +%s)$_try" "$TMP/tab.json")
  jqt '.meta.count > 0' "$TMP/tab.json" && break
  sleep 5
done
check "dane tabelaryczne zasobu CSV agregatu dostępne w API portalu (HTTP $c, wierszy: $(jq '.meta.count' "$TMP/tab.json"))" \
  jqt '.meta.count > 0' "$TMP/tab.json"
file_url=$(curl -sk "$API/resources/$csv_id" | jq -r '.data.attributes.file_url')
curl -sk -m 60 -o "$TMP/agg.csv" "$file_url"
header=$(head -1 "$TMP/agg.csv" | tr -d '\r\357\273\277')
missing=""
for col in aed_uid id_aed szerokosc_geogr dlugosc_geogr miejscowosc ulica nr_budynku kod_pocztowy nazwa_obiektu \
  opis_lokalizacji dostep dysponent data_weryfikacji wewnatrz_budynku pietro sposob_dostepu telefon_kontaktowy \
  teryt_terc teryt_simc producent model data_przegladu waznosc_elektrod waznosc_baterii zdjecie_url \
  dostawca dostawca_regon zbior_zrodlowy zasob_zrodlowy data_aktualizacji wspolrzedne_zrodlo teryt_gminy gmina \
  jakosc_danych instrukcja_dla_dyspozytora; do
  [[ ",$header," == *",$col,"* ]] || missing="$missing $col"
done
check "CSV agregatu zawiera kolumny wzorcowego zakresu i odpowiedzialności${missing:+ (brakuje:$missing)}" test -z "$missing"

# --- 6. Inkrementalna aktualizacja jednego dostawcy ------------------------------------------------
provider_counts() { curl -sk "$API/aed/providers" | jq -c '[.data[] | {d: .attributes.dostawca, a: .attributes.aktywne, w: .attributes.wycofane}] | sort_by(.d)'; }
wait_for_krosno() { # wait_for_krosno <aktywne> <wycofane>
  local t=0
  while [ $t -lt "$TIMEOUT" ]; do
    local cur; cur=$(curl -sk "$API/aed/providers" | jq -c '.data[] | select(.attributes.dostawca=="Urząd Miasta Krosna") | [.attributes.aktywne, .attributes.wycofane]')
    [ "$cur" = "[$1,$2]" ] && return 0
    sleep 5; t=$((t + 5))
  done
  return 1
}
docker exec "$ADMIN_CONTAINER" python manage.py aed_demo_update krosno --original >/dev/null 2>&1
check "przywrócenie oryginalnego pliku Krosna (21 aktywnych)" wait_for_krosno 21 0
before=$(provider_counts)
ids_before=$(curl -sk "$API/aed/aggregate" | jq -c '[.data.attributes.dataset_id, .data.attributes.csv_resource_id, .data.attributes.geojson_resource_id]')
docker exec "$ADMIN_CONTAINER" python manage.py aed_demo_update krosno >/dev/null 2>&1
check "nowa wersja pliku Krosna: −1 aktywny, +1 wycofany (20/1)" wait_for_krosno 20 1
after=$(provider_counts)
others_before=$(echo "$before" | jq -c '[.[] | select(.d != "Urząd Miasta Krosna")]')
others_after=$(echo "$after" | jq -c '[.[] | select(.d != "Urząd Miasta Krosna")]')
check "liczniki pozostałych dostawców bez zmian" test "$others_before" = "$others_after"
ids_after=$(curl -sk "$API/aed/aggregate" | jq -c '[.data.attributes.dataset_id, .data.attributes.csv_resource_id, .data.attributes.geojson_resource_id]')
check "identyfikatory zbioru i zasobów agregatu stałe po przebudowie ($ids_after)" test "$ids_before" = "$ids_after"
c=$(get "$API/aed/records/PL-AED-ORG$(curl -sk "$API/aed/providers" | jq -r '.data[] | select(.attributes.dostawca=="Urząd Miasta Krosna") | .id')-22" "$TMP/h.json")
check "rekord zmieniony ma wpis „updated” w historii (HTTP $c)" \
  jqt '[.data.attributes.historia[].zmiana] | index("updated") != null' "$TMP/h.json"

# --- 7. Brak publicznego zapisu --------------------------------------------------------------------
for m in POST PUT DELETE; do
  c=$(code_of -X "$m" "$API/aed/records")
  check "$m /aed/records → $c (oczekiwano 405/401)" test "$c" = 405 -o "$c" = 401
done
c=$(code_of "$ADMIN/aed/aedimportrun/")
check "anonimowy GET panelu raportów AED → $c (przekierowanie na logowanie)" test "$c" = 302

# --- 8. Panel dostawcy: logowanie i izolacja instytucji ---------------------------------------------
login() { # login <email> <cookiejar>
  rm -f "$2"
  curl -sk -c "$2" -b "$2" -o "$TMP/login.html" "$ADMIN/login/"
  local token; token=$(grep -oE 'name="csrfmiddlewaretoken" value="[^"]+"' "$TMP/login.html" | head -1 | sed 's/.*value="//;s/"$//')
  curl -sk -c "$2" -b "$2" -e "$ADMIN/login/" -o /dev/null -w '%{http_code}' \
    --data-urlencode "csrfmiddlewaretoken=$token" --data-urlencode "username=$1" \
    --data-urlencode "password=$AED_PASS" --data-urlencode "this_is_the_login_form=1" \
    --data-urlencode "next=/aed/aedimportrun/" "$ADMIN/login/"
}
c=$(login krosno@mcod.local "$TMP/krosno.jar")
check "logowanie krosno@mcod.local → $c" test "$c" = 302
c=$(curl -sk -b "$TMP/krosno.jar" -o "$TMP/runs.html" -w '%{http_code}' "$ADMIN/aed/aedimportrun/")
foreign=$(grep -cE 'Przemyślu|Marki|Legionowo' "$TMP/runs.html")
check "lista raportów AED jako Krosno → HTTP $c, raporty innych instytucji: $foreign" test "$c" = 200 -a "$foreign" = 0
krosno_run=$(grep -oE '/aed/aedimportrun/[0-9]+/change/' "$TMP/runs.html" | head -1 | grep -oE '[0-9]+')
c=$(curl -sk -b "$TMP/krosno.jar" -o "$TMP/run.html" -w '%{http_code}' "$ADMIN/aed/aedimportrun/$krosno_run/change/")
check "raport #$krosno_run (mapowanie kolumn, problemy) jako Krosno → HTTP $c" \
  sh -c "test $c = 200 && grep -q 'Mapowanie kolumn' '$TMP/run.html'"
c=$(curl -sk -b "$TMP/krosno.jar" -D "$TMP/csvh.txt" -o "$TMP/issues.csv" -w '%{http_code}' "$ADMIN/aed/aedimportrun/$krosno_run/issues.csv")
check "CSV problemów raportu Krosna → HTTP $c, text/csv, nagłówek wiersz,pole,waga,kod,komunikat" \
  sh -c "test $c = 200 && grep -qi 'content-type: text/csv' '$TMP/csvh.txt' && head -1 '$TMP/issues.csv' | grep -q 'wiersz,pole,waga,kod,komunikat'"
c=$(curl -sk -b "$TMP/krosno.jar" -o "$TMP/dsform.html" -w '%{http_code}' "$ADMIN/datasets/dataset/$(jq -r '[.data[] | select(.attributes.title|test("Krosno"))][0].id' "$TMP/ds.json")/change/")
check "formularz zbioru Krosna ma zakładkę „Raport AED” (HTTP $c)" sh -c "test $c = 200 && grep -q 'suit-tab-aed' '$TMP/dsform.html'"
c=$(login przemysl@mcod.local "$TMP/przemysl.jar")
check "logowanie przemysl@mcod.local → $c" test "$c" = 302
c=$(code_of -b "$TMP/przemysl.jar" "$ADMIN/aed/aedimportrun/$krosno_run/change/")
check "Przemyśl nie widzi raportu Krosna #$krosno_run → $c" test "$c" = 404 -o "$c" = 403
c=$(code_of -b "$TMP/przemysl.jar" "$ADMIN/aed/aedimportrun/$krosno_run/issues.csv")
check "Przemyśl nie pobierze CSV raportu Krosna → $c" test "$c" = 404 -o "$c" = 403

# --- 9. Uwagi do danych trafiają do dostawców, nie do właściciela agregatu ---------------------------
get "$API/aed/providers" "$TMP/prov.json" >/dev/null
check "każdy dostawca w /aed/providers ma zasób źródłowy do zgłaszania uwag" \
  jqt '[.data[].attributes.zasob_zrodlowy_id] | all(. != null)' "$TMP/prov.json"
COMMENT='{"data":{"type":"comment","attributes":{"comment":"[smoke] uwaga testowa do danych AED"}}}'
c=$(code_of -X POST -H 'Content-Type: application/vnd.api+json' -d "$COMMENT" "$API/resources/$csv_id/comments")
check "uwaga wysłana na zasób agregatu (MC) → $c (odrzucona, kierowanie do dostawcy)" test "$c" = 403
c=$(code_of -X POST -H 'Content-Type: application/vnd.api+json' -d "$COMMENT" "$API/datasets/$ds_id/comments")
check "uwaga wysłana na zbiór agregatu (MC) → $c (odrzucona)" test "$c" = 403
marki_res=$(jq -r '.data[] | select(.attributes.dostawca=="Urząd Miasta Marki") | .attributes.zasob_zrodlowy_id' "$TMP/prov.json")
c=$(code_of -X POST -H 'Content-Type: application/vnd.api+json' -d "$COMMENT" "$API/resources/$marki_res/comments")
check "uwaga do dostawcy (zasób źródłowy Marek #$marki_res) → $c (przyjęta, trafia do Urzędu Miasta Marki)" test "$c" = 201

printf '\nWynik: wszystkie %d testy OK ✅\n' "$PASS"
