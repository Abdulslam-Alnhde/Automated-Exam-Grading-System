/** Proxies authenticated browser calls from Next Route Handlers to the standalone API (BFF). */
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/modules/auth/lib/auth";

function backendBase() {
  return (process.env.INTERNAL_API_URL || "http://127.0.0.1:4000").replace(
    /\/$/,
    ""
  );
}

function internalSecret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s) throw new Error("INTERNAL_API_SECRET is not configured");
  return s;
}

export async function requireSessionForBff(): Promise<
  { session: Session; error: null } | { session: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      session: null,
      error: NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export function trustedHeadersFromSession(session: Session): HeadersInit {
  const keys = (session.user.permissionKeys ?? []).join(",");
  return {
    "X-Internal-Secret": internalSecret(),
    "X-User-Id": session.user.id,
    "X-User-Role": session.user.role,
    "X-User-Permission-Keys": keys,
  };
}

/** Full BFF helper: session gate + upstream call + pass-through response. */
export async function bffProxy(
  apiPath: string,
  init: RequestInit = {}
): Promise<NextResponse> {
  const gate = await requireSessionForBff();
  if (gate.error) return gate.error;
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = `${backendBase()}/api${path}`;
  const headers = new Headers(init.headers);
  const extra = trustedHeadersFromSession(gate.session!);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v as string);
  try {
    const res = await fetch(url, { ...init, headers });
    return bffToNextResponse(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "تعذر الاتصال بخادم الـ API الداخلي",
        details: message,
        url,
      },
      { status: 502 }
    );
  }
}
export function internalFetchOnly(
  apiPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = `${backendBase()}/api${path}`;
  const headers = new Headers(init.headers);
  headers.set("X-Internal-Secret", internalSecret());
  return fetch(url, { ...init, headers });
}

export async function bffToNextResponse(upstream: Response): Promise<NextResponse> {
  const contentType = upstream.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const data = await upstream.json();
      return NextResponse.json(data, {
        status: upstream.status,
        statusText: upstream.statusText,
      });
    } catch (e) {
      console.error("Failed to parse upstream JSON:", e);
    }
  }

  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
