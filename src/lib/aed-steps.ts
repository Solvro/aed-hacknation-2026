/**
 * Instrukcja użycia AED krok po kroku.
 *
 * Treść opracowana na podstawie wytycznych Europejskiej Rady Resuscytacji (ERC)
 * i Polskiej Rady Resuscytacji. Przed publikacją wymaga weryfikacji przez
 * ratownika medycznego / instruktora PRC.
 *
 * Dane udostępniamy też maszynowo pod GET /api/instrukcja-aed (JSON).
 */

export const STEP_IDS = [
  "bezpieczenstwo",
  "oddech",
  "wezwij-pomoc",
  "wlacz-aed",
  "elektrody",
  "analiza",
  "wyladowanie",
  "rko",
] as const;

export type StepId = (typeof STEP_IDS)[number];

export type StepTask =
  | { type: "place-pads"; label: string }
  | { type: "shock"; label: string };

export type AedStep = {
  id: StepId;
  number: number;
  /** Krótka etykieta do paska postępu. */
  short: string;
  title: string;
  instruction: string;
  details: string[];
  /** Komunikat głosowy, który w tym momencie podaje urządzenie AED. */
  aedPrompt?: string;
  warning?: string;
  task?: StepTask;
  /** Tekstowy opis sceny 3D (alternatywa dla czytników ekranu). */
  sceneDescription: string;
};

export type AedInstruction = {
  title: string;
  version: string;
  language: "pl";
  source: string;
  reviewStatus: "do-weryfikacji" | "zweryfikowano";
  emergencyNumber: "112";
  steps: AedStep[];
};

const steps: AedStep[] = [
  {
    id: "bezpieczenstwo",
    number: 1,
    short: "Bezpieczeństwo",
    title: "Oceń bezpieczeństwo i reakcję",
    instruction:
      "Upewnij się, że Tobie i poszkodowanemu nic nie grozi. Podejdź, delikatnie potrząśnij za ramiona i głośno zapytaj: „Czy wszystko w porządku?”.",
    details: [
      "Rozejrzyj się: ruch uliczny, prąd, ogień, gaz.",
      "Jeśli osoba nie reaguje, głośno zawołaj o pomoc.",
    ],
    sceneDescription:
      "Poszkodowany leży na plecach. Wokół jego głowy rozchodzą się fale symbolizujące głośne wołanie.",
  },
  {
    id: "oddech",
    number: 2,
    short: "Oddech",
    title: "Sprawdź oddech",
    instruction:
      "Udrożnij drogi oddechowe: odchyl głowę do tyłu i unieś żuchwę. Patrz, słuchaj i wyczuwaj oddech, ale nie dłużej niż 10 sekund.",
    details: [
      "Brak oddechu albo pojedyncze, nieregularne westchnięcia (oddech agonalny) oznaczają zatrzymanie krążenia.",
      "Jeśli masz wątpliwości, działaj tak, jakby oddechu nie było.",
    ],
    sceneDescription:
      "Zbliżenie na głowę poszkodowanego, która odchyla się do tyłu, aby udrożnić drogi oddechowe.",
  },
  {
    id: "wezwij-pomoc",
    number: 3,
    short: "112 i RKO",
    title: "Zadzwoń 112 i zacznij RKO",
    instruction:
      "Zadzwoń pod 112 i włącz tryb głośnomówiący. Poproś kogoś, żeby przyniósł najbliższe AED. Od razu zacznij uciskać klatkę piersiową.",
    details: [
      "Uciskaj środek klatki piersiowej na głębokość 5–6 cm, w tempie 100–120 razy na minutę.",
      "30 uciśnięć, potem 2 oddechy ratownicze, jeśli potrafisz je wykonać.",
      "Jeśli jesteś sam, nie odchodź od poszkodowanego na poszukiwanie AED. Prowadź RKO i słuchaj dyspozytora.",
    ],
    sceneDescription:
      "Ratowniczka klęczy przy poszkodowanym, ramiona ma wyprostowane i ustawione pionowo nad mostkiem. Uciska środek klatki piersiowej splecionymi dłońmi. Obok unosi się telefon z wybranym numerem 112.",
  },
  {
    id: "wlacz-aed",
    number: 4,
    short: "Włącz AED",
    title: "Włącz AED",
    instruction:
      "Połóż AED obok poszkodowanego, otwórz pokrywę lub naciśnij przycisk zasilania. Od tej chwili słuchaj poleceń głosowych urządzenia.",
    details: [
      "AED może użyć każdy. Urządzenie prowadzi krok po kroku.",
      "Jeśli pomaga druga osoba, niech nie przerywa RKO, gdy przygotowujesz AED.",
    ],
    aedPrompt: "Odsłoń klatkę piersiową poszkodowanego i naklej elektrody.",
    sceneDescription:
      "Zbliżenie na zielone urządzenie AED. Pokrywa się otwiera, a przycisk zasilania świeci.",
  },
  {
    id: "elektrody",
    number: 5,
    short: "Elektrody",
    title: "Naklej elektrody",
    instruction:
      "Odsłoń klatkę piersiową. Naklej jedną elektrodę pod prawym obojczykiem, a drugą na lewym boku, poniżej pachy, tak jak na rysunku na elektrodach.",
    details: [
      "Skóra powinna być sucha. W razie potrzeby szybko ją wytrzyj.",
      "Nie naklejaj elektrody bezpośrednio na wszczepiony stymulator ani na plaster z lekiem.",
    ],
    aedPrompt: "Naklej elektrody zgodnie z rysunkiem.",
    task: { type: "place-pads", label: "Naklej obie elektrody" },
    sceneDescription:
      "Odsłonięta klatka piersiowa poszkodowanego z dwoma podświetlonymi miejscami na elektrody: pod prawym obojczykiem, obok mostka, i na lewym boku w linii pachowej, poniżej pachy.",
  },
  {
    id: "analiza",
    number: 6,
    short: "Analiza",
    title: "Nie dotykaj: analiza rytmu",
    instruction:
      "Odsuń się i dopilnuj, żeby nikt nie dotykał poszkodowanego. AED analizuje rytm serca.",
    details: [
      "Ruch lub dotyk może zakłócić analizę.",
      "Przerwij RKO tylko na czas analizy.",
    ],
    aedPrompt: "Nie dotykaj pacjenta. Trwa analiza rytmu serca.",
    warning: "Nikt nie dotyka poszkodowanego!",
    sceneDescription:
      "Wokół poszkodowanego pulsuje czerwona strefa bezpieczeństwa. Na ekranie AED widać zapis rytmu serca.",
  },
  {
    id: "wyladowanie",
    number: 7,
    short: "Wyładowanie",
    title: "Wykonaj wyładowanie",
    instruction:
      "Jeśli AED zaleci wyładowanie, upewnij się, że nikt nie dotyka poszkodowanego, i naciśnij migający przycisk wyładowania.",
    details: [
      "Głośno powiedz „Odsuń się!” i sprawdź wzrokiem, czy nikt nie dotyka poszkodowanego.",
      "AED w pełni automatyczne wykona wyładowanie samo, po ostrzeżeniu głosowym.",
      "Jeśli AED nie zaleca wyładowania, od razu wróć do RKO.",
    ],
    aedPrompt:
      "Zalecane wyładowanie. Odsuń się od pacjenta. Naciśnij migający przycisk.",
    warning: "Odsuń się od poszkodowanego!",
    task: { type: "shock", label: "Naciśnij przycisk wyładowania" },
    sceneDescription:
      "Zbliżenie na AED z migającym pomarańczowym przyciskiem wyładowania.",
  },
  {
    id: "rko",
    number: 8,
    short: "RKO",
    title: "Wróć do RKO",
    instruction:
      "Zaraz po wyładowaniu wznów uciskanie klatki piersiowej: 30 uciśnięć i 2 oddechy. Postępuj zgodnie z poleceniami AED.",
    details: [
      "Nie odklejaj elektrod. AED co 2 minuty ponownie przeanalizuje rytm.",
      "Przerwij dopiero, gdy przyjedzie Zespół Ratownictwa Medycznego, poszkodowany zacznie normalnie oddychać albo opadniesz z sił.",
      "Jeśli pomaga druga osoba, zmieniajcie się co 2 minuty.",
    ],
    aedPrompt: "Rozpocznij resuscytację krążeniowo-oddechową.",
    sceneDescription:
      "Ratowniczka ponownie uciska klatkę piersiową, między naklejonymi elektrodami. Licznik odlicza uciśnięcia od 1 do 30.",
  },
];

export function getAedInstruction(): AedInstruction {
  return {
    title: "Jak użyć defibrylatora AED",
    version: "0.1.0",
    language: "pl",
    source:
      "Opracowanie na podstawie wytycznych Europejskiej Rady Resuscytacji (ERC) i Polskiej Rady Resuscytacji.",
    reviewStatus: "do-weryfikacji",
    emergencyNumber: "112",
    steps,
  };
}
