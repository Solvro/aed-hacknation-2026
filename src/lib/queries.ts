import { queryOptions } from "@tanstack/react-query";
import type { AedInstruction } from "./aed-steps";

async function fetchAedInstruction(): Promise<AedInstruction> {
  const res = await fetch("/api/instrukcja-aed");
  if (!res.ok) throw new Error("Nie udało się pobrać instrukcji AED");
  return res.json();
}

export const aedInstructionQuery = queryOptions({
  queryKey: ["aed-instruction"],
  queryFn: fetchAedInstruction,
  staleTime: 1000 * 60 * 60,
});
