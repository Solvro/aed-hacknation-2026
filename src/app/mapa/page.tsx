import type { Metadata, Viewport } from "next";
import AedMapApp from "@/components/aed-map/AedMapApp";
import "@/components/aed-map/aed-map.css";

export const metadata: Metadata = {
  title: "Mapa AED — najbliższy defibrylator",
  description:
    "Ponad 16 tysięcy defibrylatorów AED w Polsce na jednej mapie. Sprawdź, gdzie jest najbliższy, czy jest dostępny całą dobę i ile minut zajmie dojście.",
};

// Mapa zawsze w jasnym motywie — także pasek przeglądarki na telefonie.
export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function MapaPage() {
  return <AedMapApp />;
}
