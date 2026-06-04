/**
 * BFF: teacher exam PDF extraction — forwards multipart body to the backend service.
 */
import { bffProxy } from "@/lib/bff-proxy";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          "تعذر قراءة ملف الاختبار المرفوع. أعد اختيار الملف ثم حاول مرة أخرى.",
      },
      { status: 400 }
    );
  }
  return bffProxy("/services/extract-teacher", {
    method: "POST",
    body: formData,
  });
}
