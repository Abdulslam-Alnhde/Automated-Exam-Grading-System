/**
 * BFF: grading — forwards JSON body to the backend service.
 */
import { bffProxy } from "@/lib/bff-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.text();
  return bffProxy("/services/grading", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
