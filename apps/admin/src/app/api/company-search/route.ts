import { NextResponse } from "next/server";

import {
  parseCompanySearchRequest,
  searchApolloCompanies,
} from "@/features/company-discovery/apollo";

export async function POST(request: Request) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Missing APOLLO_API_KEY. Add it to your local environment and restart the admin app.",
      },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const searchRequest = parseCompanySearchRequest(body);
    const result = await searchApolloCompanies({
      apiKey,
      request: searchRequest,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Company search failed";
    const status = message.includes("Apollo search failed with status 401")
      ? 401
      : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
