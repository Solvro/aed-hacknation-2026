import type { Metadata } from "next";
import { Suspense } from "react";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { getAedInstruction } from "@/lib/aed-steps";
import { aedInstructionQuery } from "@/lib/queries";
import { AedTrainer } from "@/components/aed-trainer/AedTrainer";

export const metadata: Metadata = {
  title: "Jak użyć AED: interaktywna instrukcja 3D",
  description:
    "Naucz się krok po kroku, jak użyć defibrylatora AED: od oceny bezpieczeństwa po wyładowanie i RKO.",
};

// Dane są statyczne, więc tekst kroków trafia do HTML już przy prerenderingu
// (działa bez JS i dla czytników ekranu), a w przeglądarce przejmuje go React Query.
// "use cache" jest potrzebne, bo React Query zapisuje znacznik czasu (Date.now()).
async function getDehydratedState() {
  "use cache";
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    ...aedInstructionQuery,
    queryFn: async () => getAedInstruction(),
  });
  return dehydrate(queryClient);
}

export default async function Page() {
  const state = await getDehydratedState();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Jak użyć defibrylatora AED
      </h1>
      <p className="mt-2 max-w-2xl text-muted">
        Przejdź przez kolejne kroki. W scenie możesz kliknąć podświetlone
        elementy, a widok obrócisz myszką.
      </p>
      <div className="mt-6">
        <Suspense
          fallback={
            <div className="scene-bg h-[46vh] min-h-[300px] animate-pulse rounded-2xl border border-border lg:h-[620px]" />
          }
        >
          <HydrationBoundary state={state}>
            <AedTrainer />
          </HydrationBoundary>
        </Suspense>
      </div>
    </div>
  );
}
