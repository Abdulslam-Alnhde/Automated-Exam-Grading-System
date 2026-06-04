/**
 * BFF: student answer extraction — forwards multipart body to the backend service.
 */
import { bffProxy } from "@/lib/bff-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const formData = await req.formData();
  return bffProxy("/services/extract-student", {
    method: "POST",
    body: formData,
  });
}
