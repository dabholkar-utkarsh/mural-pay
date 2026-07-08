import {
  APOLLO_BULK_ENRICH_URL,
  apolloHeaders,
  formatLocation,
} from "./apollo";
import { FILTER_GROUPS, LLM_RERANK_MODEL, SELLER_CONTEXT } from "./constants";
import type {
  ApolloBulkEnrichResponse,
  ApolloOrganization,
  CompanyFilters,
} from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export const MIN_EXAMPLE_DOMAINS = 1;
export const MAX_EXAMPLE_DOMAINS = 5;

export type DeriveIcpRequest = {
  domains: string[];
};

// What we show the user about each seed company (the evidence).
export type IcpExampleProfile = {
  domain: string;
  found: boolean;
  name: string | null;
  industry: string | null;
  employeeCount: number | null;
  revenueDisplay: string | null;
  location: string | null;
  keywords: string[];
  description: string | null;
};

export type DerivedSignal = {
  label: string;
  evidence: string;
};

export type DeriveIcpResponse = {
  examples: IcpExampleProfile[];
  // One-paragraph LLM read of what the examples have in common; null when
  // the LLM did not run (no key or it failed).
  pattern: string | null;
  signals: DerivedSignal[];
  // Ready to drop into the existing company search.
  filters: CompanyFilters;
  llmUsed: boolean;
};

// Accepts bare domains, full URLs, and trailing paths; rejects empties.
export function normalizeDomain(value: string): string | null {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];

  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(trimmed) ? trimmed : null;
}

export function parseDeriveIcpRequest(value: unknown): DeriveIcpRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Request body must be an object");
  }

  const raw = (value as Partial<DeriveIcpRequest>).domains;

  if (!Array.isArray(raw)) {
    throw new Error("domains must be an array of company domains");
  }

  const domains = Array.from(
    new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map(normalizeDomain)
        .filter((domain): domain is string => domain !== null),
    ),
  );

  if (domains.length < MIN_EXAMPLE_DOMAINS) {
    throw new Error("Provide at least one valid company domain (e.g. slash.com)");
  }

  if (domains.length > MAX_EXAMPLE_DOMAINS) {
    throw new Error(`Provide at most ${MAX_EXAMPLE_DOMAINS} example domains`);
  }

  return { domains };
}

export async function deriveIcpFromExamples({
  apiKey,
  request,
  anthropicApiKey,
  fetcher = fetch,
}: {
  apiKey: string;
  request: DeriveIcpRequest;
  anthropicApiKey?: string;
  fetcher?: typeof fetch;
}): Promise<DeriveIcpResponse> {
  const organizations = await enrichExampleDomains({
    apiKey,
    domains: request.domains,
    fetcher,
  });

  const examples = request.domains.map((domain) =>
    toExampleProfile(domain, organizations.get(domain) ?? null),
  );
  const foundExamples = examples.filter((example) => example.found);

  if (foundExamples.length === 0) {
    throw new Error(
      "Apollo could not enrich any of these domains. Check the spelling or try different example companies.",
    );
  }

  // Mechanical derivation always runs; the LLM refines it when available.
  const mechanicalFilters = deriveMechanicalFilters(foundExamples);

  const llmResult = anthropicApiKey
    ? await synthesizeIcpWithLlm({
        apiKey: anthropicApiKey,
        examples: foundExamples,
        fetcher,
      })
    : null;

  return {
    examples,
    pattern: llmResult?.pattern ?? null,
    signals: llmResult?.signals ?? [],
    filters: llmResult?.filters ?? mechanicalFilters,
    llmUsed: llmResult !== null,
  };
}

async function enrichExampleDomains({
  apiKey,
  domains,
  fetcher,
}: {
  apiKey: string;
  domains: string[];
  fetcher: typeof fetch;
}): Promise<Map<string, ApolloOrganization>> {
  const response = await fetcher(APOLLO_BULK_ENRICH_URL, {
    method: "POST",
    headers: apolloHeaders(apiKey),
    body: JSON.stringify({ domains }),
  });

  if (!response.ok) {
    throw new Error(`Apollo enrichment failed with status ${response.status}`);
  }

  const data = (await response.json()) as ApolloBulkEnrichResponse;
  const byDomain = new Map<string, ApolloOrganization>();

  for (const organization of data.organizations ?? []) {
    if (organization?.primary_domain) {
      byDomain.set(organization.primary_domain.toLowerCase(), organization);
    }
  }

  return byDomain;
}

function toExampleProfile(
  domain: string,
  organization: ApolloOrganization | null,
): IcpExampleProfile {
  if (!organization) {
    return {
      domain,
      found: false,
      name: null,
      industry: null,
      employeeCount: null,
      revenueDisplay: null,
      location: null,
      keywords: [],
      description: null,
    };
  }

  return {
    domain,
    found: true,
    name: organization.name ?? null,
    industry: organization.industry ?? null,
    employeeCount: organization.estimated_num_employees ?? null,
    revenueDisplay: organization.organization_revenue_printed ?? null,
    location: formatLocation(organization),
    keywords: (organization.keywords ?? []).slice(0, 15),
    description:
      (organization.short_description ?? organization.seo_description ?? null)
        ?.slice(0, 400) ?? null,
  };
}

function allowedEmployeeRanges(): string[] {
  return (
    FILTER_GROUPS.find((group) => group.key === "employeeRanges")?.options.map(
      (option) => option.value,
    ) ?? []
  );
}

// No-LLM fallback: shared keywords, size buckets covering the examples, and
// the examples' countries. Personas/hiring are left empty rather than guessed.
export function deriveMechanicalFilters(
  examples: IcpExampleProfile[],
): CompanyFilters {
  const keywordCounts = new Map<string, number>();

  for (const example of examples) {
    for (const keyword of new Set(
      example.keywords.map((k) => k.toLowerCase()),
    )) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }
  }

  // Prefer keywords shared by 2+ examples; with a single example (or no
  // overlap) fall back to its top keywords.
  const shared = Array.from(keywordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([keyword]) => keyword);
  const keywords = (
    shared.length > 0 ? shared : Array.from(keywordCounts.keys())
  ).slice(0, 8);

  const ranges = allowedEmployeeRanges();
  const employeeRanges = ranges.filter((range) => {
    const [min, max] = range.split(",").map((v) => Number.parseInt(v, 10));

    return examples.some(
      (example) =>
        example.employeeCount !== null &&
        example.employeeCount >= min &&
        example.employeeCount <= max,
    );
  });

  const locations = Array.from(
    new Set(
      examples
        .map((example) => example.location?.split(", ").slice(-1)[0])
        .filter((country): country is string => Boolean(country)),
    ),
  );

  return {
    keywords,
    employeeRanges,
    revenueMin: 0,
    locations,
    jobTitles: [],
    hiringTitles: [],
  };
}

type LlmIcpResult = {
  pattern: string;
  signals: DerivedSignal[];
  filters: CompanyFilters;
};

async function synthesizeIcpWithLlm({
  apiKey,
  examples,
  fetcher,
}: {
  apiKey: string;
  examples: IcpExampleProfile[];
  fetcher: typeof fetch;
}): Promise<LlmIcpResult | null> {
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
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: buildDeriveIcpPrompt(examples),
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

    return text ? parseLlmIcpResult(text) : null;
  } catch {
    return null;
  }
}

export function buildDeriveIcpPrompt(examples: IcpExampleProfile[]): string {
  const ranges = allowedEmployeeRanges();

  return [
    SELLER_CONTEXT,
    "",
    "A GTM user picked these EXAMPLE companies as ideal prospects. Reverse-engineer the ICP they have in common, seen through what Mural Pay sells (payout flows are the key signal).",
    "",
    `Examples: ${JSON.stringify(examples)}`,
    "",
    "Produce Apollo company-search filters that would find MORE companies like these:",
    `- keywords: 5-10 tight Apollo q_organization_keyword_tags (2-3 word phrases, lowercase). Model them on the examples' own keyword tags. Avoid loose single words like "betting" or "marketplace" that pull agencies and media.`,
    `- employeeRanges: subset of ${JSON.stringify(ranges)} ("min,max" strings). Cover the examples' sizes, widened one bucket where sensible.`,
    "- revenueMin: dollars, 0 to disable. Use 0 unless every example clearly clears a floor.",
    "- locations: countries only, from the examples. Empty array if geography isn't part of the pattern.",
    '- jobTitles: 1-3 buyer personas who would own a payouts/stablecoin decision at these companies (e.g. "CFO", "Head of Payments").',
    '- hiringTitles: 0-2 job-posting titles that signal the pain (e.g. "payments operations"). Empty if none clearly apply.',
    "",
    "Also produce:",
    "- pattern: 1-2 sentences on what these companies share as Mural Pay prospects.",
    '- signals: 2-5 shared, observable signals with evidence from the examples, e.g. {"label": "Operates outbound payouts", "evidence": "Slash moves money for business customers; ..."}.',
    "",
    'Respond with ONLY a JSON object, no other text: {"pattern": "...", "signals": [{"label": "...", "evidence": "..."}], "filters": {"keywords": [], "employeeRanges": [], "revenueMin": 0, "locations": [], "jobTitles": [], "hiringTitles": []}}',
  ].join("\n");
}

export function parseLlmIcpResult(text: string): LlmIcpResult | null {
  try {
    const jsonText = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/```\s*$/m, "");
    const parsed = JSON.parse(jsonText) as {
      pattern?: unknown;
      signals?: unknown;
      filters?: Partial<CompanyFilters>;
    };

    if (typeof parsed.pattern !== "string" || !parsed.filters) {
      return null;
    }

    const filters = parsed.filters;
    const ranges = new Set(allowedEmployeeRanges());

    return {
      pattern: parsed.pattern,
      signals: Array.isArray(parsed.signals)
        ? parsed.signals
            .filter(
              (signal): signal is DerivedSignal =>
                typeof signal === "object" &&
                signal !== null &&
                typeof (signal as DerivedSignal).label === "string" &&
                typeof (signal as DerivedSignal).evidence === "string",
            )
            .slice(0, 5)
        : [],
      filters: {
        keywords: cleanStrings(filters.keywords, 10),
        employeeRanges: cleanStrings(filters.employeeRanges, 5).filter(
          (range) => ranges.has(range),
        ),
        revenueMin:
          typeof filters.revenueMin === "number" &&
          Number.isFinite(filters.revenueMin) &&
          filters.revenueMin >= 0
            ? filters.revenueMin
            : 0,
        locations: cleanStrings(filters.locations, 5),
        jobTitles: cleanStrings(filters.jobTitles, 3),
        hiringTitles: cleanStrings(filters.hiringTitles, 2),
      },
    };
  } catch {
    return null;
  }
}

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 60),
    ),
  ).slice(0, max);
}
