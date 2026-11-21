import { getAedInstruction } from "@/lib/aed-steps";

/** Instrukcja użycia AED w formacie odczytywalnym maszynowo (JSON). */
export async function GET() {
  return Response.json(getAedInstruction(), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
