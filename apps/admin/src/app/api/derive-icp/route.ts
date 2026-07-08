import { NextResponse } from "next/server";

// Thin proxy to the NestJS server (see api/company-search/route.ts).
const API_URL = process.env.COMPANY_DISCOVERY_API_URL ?? "http://localhost:4000";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);

    const response = await fetch(`${API_URL}/company-search/derive-icp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": clientIp,
      },
      body: JSON.stringify(await request.json()),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message ?? data.error ?? "ICP derivation failed" },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production"
            ? "Company discovery API is temporarily unavailable."
            : `Company discovery API is unreachable at ${API_URL}. Start it with \`pnpm dev\` (or cd apps/server && pnpm dev).`,
      },
      { status: 502 },
    );
  }
}
