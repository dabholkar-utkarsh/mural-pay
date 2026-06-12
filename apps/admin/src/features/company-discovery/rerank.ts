import { LLM_RERANK_MODEL, SELLER_CONTEXT } from "./constants";
import type { ApolloOrganization, CompanyFilters } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type LlmVerdict = {
  // 0-1
  score: number;
  reason: string;
};

// Scores candidates against the ICP with a single LLM call. Catches the
// "talks about the industry vs. operates in it" gap that keyword matching
// cannot (media companies, consultancies, ad-tech, investors).
// Returns null on any failure so the caller falls back to rule-only scoring.
export async function rerankWithLlm({
  apiKey,
  organizations,
  filters,
  // false = scores only (faster, used for the wide pre-screen); reasons are
  // the dominant latency cost, so they're reserved for displayable results.
  includeReasons = true,
  fetcher = fetch,
}: {
  apiKey: string;
  organizations: ApolloOrganization[];
  filters: CompanyFilters;
  includeReasons?: boolean;
  fetcher?: typeof fetch;
}): Promise<Map<string, LlmVerdict> | null> {
  if (organizations.length === 0) {
    return null;
  }

  try {
    const response = await fetcher(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: LLM_RERANK_MODEL,
        // Enough for verdicts on a full 100-candidate pool; a truncated
        // response fails JSON parsing and silently disables the re-rank.
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: buildRerankPrompt(organizations, filters, includeReasons),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((block) => block.text)?.text;

    if (!text) {
      return null;
    }

    return parseVerdicts(text);
  } catch {
    return null;
  }
}

export function buildRerankPrompt(
  organizations: ApolloOrganization[],
  filters: CompanyFilters,
  includeReasons = true,
): string {
  const candidates = organizations.map((organization) => ({
    id: organization.id ?? organization.primary_domain ?? organization.name,
    name: organization.name,
    domain: organization.primary_domain,
    industry: organization.industry,
    location:
      [
        organization.city ?? organization.organization_city,
        organization.country ?? organization.organization_country,
      ]
        .filter(Boolean)
        .join(", ") || undefined,
    keywords: (organization.keywords ?? []).slice(0, 10),
    description: (organization.short_description ?? organization.seo_description ?? "").slice(
      0,
      300,
    ),
  }));

  const geographyLine =
    filters.locations.length > 0
      ? `The ICP targets companies based in: ${filters.locations.join(", ")}. Score LOW any company clearly headquartered or operating only outside these markets.`
      : "";

  return [
    SELLER_CONTEXT,
    "",
    `The current search targets companies that OPERATE in these industries: ${filters.keywords.join(", ")}.`,
    "They must be actual operators (e.g. a marketplace business, an online betting platform, a payroll provider, an e-commerce brand).",
    "Score LOW: media companies, publishers, consultancies, agencies, ad-tech, investors, staffing/recruiting firms, or anyone who merely serves, covers, advertises for, or invests in these industries without operating in them.",
    geographyLine,
    "",
    includeReasons
      ? 'Score each company 0-100 for how strong a Mural Pay prospect it is. Respond with ONLY a JSON array, no other text: [{"id": "...", "score": 0, "reason": "max 12 words"}]'
      : 'Score each company 0-100 for how strong a Mural Pay prospect it is. Respond with ONLY a JSON array, no other text and no reasons: [{"id": "...", "score": 0}]',
    "",
    `Companies: ${JSON.stringify(candidates)}`,
  ].join("\n");
}

export function parseVerdicts(text: string): Map<string, LlmVerdict> | null {
  try {
    const jsonText = text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
    const parsed = JSON.parse(jsonText) as Array<{
      id?: string;
      score?: number;
      reason?: string;
    }>;

    if (!Array.isArray(parsed)) {
      return null;
    }

    const verdicts = new Map<string, LlmVerdict>();

    for (const item of parsed) {
      if (typeof item.id === "string" && typeof item.score === "number") {
        verdicts.set(item.id, {
          score: Math.min(Math.max(item.score, 0), 100) / 100,
          reason: item.reason ?? "",
        });
      }
    }

    return verdicts.size > 0 ? verdicts : null;
  } catch {
    return null;
  }
}
