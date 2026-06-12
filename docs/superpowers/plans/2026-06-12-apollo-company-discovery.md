# Apollo Company Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal `apps/admin` Apollo company discovery MVP with preset ICP filters, live server-side Apollo search, table results, and derived buying signals.

**Architecture:** The admin React page renders a client-side search workflow. A Next.js route handler in `apps/admin` receives selected filters, calls Apollo with the server-only `APOLLO_API_KEY`, paginates until the requested company limit is reached, normalizes companies, and returns derived signals. Pure request-mapping and normalization logic lives in focused modules with unit tests.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, shadcn-style `Button`, Vitest for admin unit tests.

---

## File Structure

- Create `apps/admin/src/features/company-discovery/types.ts`: shared request, response, Apollo, and signal types.
- Create `apps/admin/src/features/company-discovery/constants.ts`: default ICP filters, chip group definitions, and search limits.
- Create `apps/admin/src/features/company-discovery/apollo.ts`: Apollo request mapping, pagination, response normalization, and signal scoring.
- Create `apps/admin/src/features/company-discovery/apollo.test.ts`: unit tests for request mapping, limit pagination, normalization, and signal scoring.
- Create `apps/admin/src/components/company-discovery-client.tsx`: client UI for filters, company count, search states, and results table.
- Create `apps/admin/src/app/api/company-search/route.ts`: Next route handler that validates request JSON and returns company results.
- Modify `apps/admin/src/app/page.tsx`: replace the starter Next.js page with the company discovery page.
- Modify `apps/admin/package.json`: add `test` script and Vitest dev dependency.
- Modify `.env.example`: add `APOLLO_API_KEY` documentation.

## Task 1: Add Test Runner

**Files:**
- Modify: `apps/admin/package.json`

- [ ] **Step 1: Install Vitest in the admin workspace**

Run:

```bash
pnpm --filter admin add -D vitest
```

Expected: `apps/admin/package.json` includes `vitest` under `devDependencies`, and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Add the admin test script**

Edit `apps/admin/package.json` so the scripts block includes:

```json
{
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  }
}
```

Keep the rest of the package file unchanged.

- [ ] **Step 3: Verify no tests exist yet**

Run:

```bash
pnpm --filter admin test
```

Expected: Vitest exits with no test files found. If Vitest exits non-zero because no tests exist, continue to Task 2 and use the Task 2 test run as the first meaningful verification.

- [ ] **Step 4: Commit the test runner setup**

```bash
git add apps/admin/package.json pnpm-lock.yaml
git commit -m "Add admin unit test runner"
```

## Task 2: Define Types And Defaults

**Files:**
- Create: `apps/admin/src/features/company-discovery/types.ts`
- Create: `apps/admin/src/features/company-discovery/constants.ts`
- Create: `apps/admin/src/features/company-discovery/apollo.test.ts`

- [ ] **Step 1: Write failing tests for the default ICP contract**

Create `apps/admin/src/features/company-discovery/apollo.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEFAULT_COMPANY_LIMIT, DEFAULT_FILTERS, MAX_COMPANY_LIMIT } from "./constants";

describe("company discovery defaults", () => {
  it("uses the approved ICP defaults", () => {
    expect(DEFAULT_FILTERS).toEqual({
      keywords: ["payroll", "e-com", "marketplace", "betting"],
      employeeRanges: ["50,200", "200,500"],
      revenueMin: 10000000,
      locations: ["United States", "Mexico", "Brazil"],
      jobTitles: ["CPO", "CLO", "CFO"],
    });
  });

  it("defaults to 10 companies and caps large requests", () => {
    expect(DEFAULT_COMPANY_LIMIT).toBe(10);
    expect(MAX_COMPANY_LIMIT).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: FAIL because `./constants` does not exist.

- [ ] **Step 3: Add shared company discovery types**

Create `apps/admin/src/features/company-discovery/types.ts`:

```ts
export type CompanyFilters = {
  keywords: string[];
  employeeRanges: string[];
  revenueMin: number;
  locations: string[];
  jobTitles: string[];
};

export type CompanySearchRequest = {
  filters: CompanyFilters;
  limit: number;
};

export type SignalKey =
  | "industry_match"
  | "size_match"
  | "revenue_match"
  | "location_match"
  | "title_relevance";

export type CompanySignal = {
  key: SignalKey;
  label: string;
  matched: boolean;
};

export type FitLabel = "Strong" | "Medium" | "Weak";

export type DiscoveredCompany = {
  id: string;
  name: string;
  websiteUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  sizeBucket: string | null;
  annualRevenue: number | null;
  location: string | null;
  matchedFilters: string[];
  signals: CompanySignal[];
  fit: FitLabel;
};

export type CompanySearchResponse = {
  companies: DiscoveredCompany[];
  requestedLimit: number;
  returnedCount: number;
};

export type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  keywords?: string[];
  estimated_num_employees?: number;
  annual_revenue?: number;
  city?: string;
  state?: string;
  country?: string;
  organization_city?: string;
  organization_state?: string;
  organization_country?: string;
  short_description?: string;
  seo_description?: string;
  person_titles?: string[];
};

export type ApolloSearchResponse = {
  organizations?: ApolloOrganization[];
  accounts?: ApolloOrganization[];
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
};
```

- [ ] **Step 4: Add default filters and chip groups**

Create `apps/admin/src/features/company-discovery/constants.ts`:

```ts
import type { CompanyFilters } from "./types";

export const DEFAULT_COMPANY_LIMIT = 10;
export const MAX_COMPANY_LIMIT = 100;
export const APOLLO_PER_PAGE = 25;

export const DEFAULT_FILTERS: CompanyFilters = {
  keywords: ["payroll", "e-com", "marketplace", "betting"],
  employeeRanges: ["50,200", "200,500"],
  revenueMin: 10000000,
  locations: ["United States", "Mexico", "Brazil"],
  jobTitles: ["CPO", "CLO", "CFO"],
};

export const FILTER_GROUPS = [
  {
    key: "keywords",
    label: "Industry keywords",
    values: DEFAULT_FILTERS.keywords,
  },
  {
    key: "employeeRanges",
    label: "Company size",
    values: DEFAULT_FILTERS.employeeRanges,
  },
  {
    key: "locations",
    label: "Locations",
    values: DEFAULT_FILTERS.locations,
  },
  {
    key: "jobTitles",
    label: "Target job titles",
    values: DEFAULT_FILTERS.jobTitles,
  },
] as const;
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: PASS for the two default contract tests.

- [ ] **Step 6: Commit types and defaults**

```bash
git add apps/admin/src/features/company-discovery/types.ts apps/admin/src/features/company-discovery/constants.ts apps/admin/src/features/company-discovery/apollo.test.ts
git commit -m "Add company discovery defaults"
```

## Task 3: Map Apollo Requests And Validate Limits

**Files:**
- Modify: `apps/admin/src/features/company-discovery/apollo.test.ts`
- Create: `apps/admin/src/features/company-discovery/apollo.ts`

- [ ] **Step 1: Add failing tests for Apollo request mapping and limit parsing**

Update the imports at the top of `apps/admin/src/features/company-discovery/apollo.test.ts` to:

```ts
import { buildApolloSearchBody, normalizeLimit } from "./apollo";
```

Then append these tests:

```ts
describe("buildApolloSearchBody", () => {
  it("maps selected filters to Apollo mixed company search fields", () => {
    expect(
      buildApolloSearchBody({
        filters: DEFAULT_FILTERS,
        limit: 10,
        page: 2,
        perPage: 25,
      }),
    ).toEqual({
      q_organization_keyword_tags: ["payroll", "e-com", "marketplace", "betting"],
      organization_num_employees_ranges: ["50,200", "200,500"],
      organization_locations: ["United States", "Mexico", "Brazil"],
      q_organization_job_titles: ["CPO", "CLO", "CFO"],
      revenue_range: {
        min: 10000000,
      },
      per_page: 25,
      page: 2,
    });
  });
});

describe("normalizeLimit", () => {
  it("keeps valid requested limits", () => {
    expect(normalizeLimit(25)).toBe(25);
  });

  it("uses the default limit for invalid values", () => {
    expect(normalizeLimit(0)).toBe(DEFAULT_COMPANY_LIMIT);
    expect(normalizeLimit(Number.NaN)).toBe(DEFAULT_COMPANY_LIMIT);
  });

  it("caps requests at the maximum company limit", () => {
    expect(normalizeLimit(500)).toBe(MAX_COMPANY_LIMIT);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: FAIL because `./apollo` does not exist.

- [ ] **Step 3: Add Apollo request mapping and limit normalization**

Create `apps/admin/src/features/company-discovery/apollo.ts`:

```ts
import { APOLLO_PER_PAGE, DEFAULT_COMPANY_LIMIT, MAX_COMPANY_LIMIT } from "./constants";
import type {
  ApolloOrganization,
  ApolloSearchResponse,
  CompanyFilters,
  CompanySearchRequest,
  CompanySearchResponse,
  DiscoveredCompany,
  FitLabel,
} from "./types";

const APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_companies/search";

type BuildApolloSearchBodyInput = CompanySearchRequest & {
  page: number;
  perPage?: number;
};

type ApolloSearchBody = {
  q_organization_keyword_tags: string[];
  organization_num_employees_ranges: string[];
  organization_locations: string[];
  q_organization_job_titles: string[];
  revenue_range: {
    min: number;
  };
  per_page: number;
  page: number;
};

export function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_COMPANY_LIMIT;
  }

  return Math.min(Math.floor(limit), MAX_COMPANY_LIMIT);
}

export function buildApolloSearchBody({
  filters,
  page,
  perPage = APOLLO_PER_PAGE,
}: BuildApolloSearchBodyInput): ApolloSearchBody {
  return {
    q_organization_keyword_tags: filters.keywords,
    organization_num_employees_ranges: filters.employeeRanges,
    organization_locations: filters.locations,
    q_organization_job_titles: filters.jobTitles,
    revenue_range: {
      min: filters.revenueMin,
    },
    per_page: perPage,
    page,
  };
}

export async function searchApolloCompanies({
  apiKey,
  request,
  fetcher = fetch,
}: {
  apiKey: string;
  request: CompanySearchRequest;
  fetcher?: typeof fetch;
}): Promise<CompanySearchResponse> {
  const requestedLimit = normalizeLimit(request.limit);
  const companies: DiscoveredCompany[] = [];
  let page = 1;

  while (companies.length < requestedLimit) {
    const response = await fetcher(APOLLO_SEARCH_URL, {
      method: "POST",
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(
        buildApolloSearchBody({
          filters: request.filters,
          limit: requestedLimit,
          page,
          perPage: APOLLO_PER_PAGE,
        }),
      ),
    });

    if (!response.ok) {
      throw new Error(`Apollo search failed with status ${response.status}`);
    }

    const data = (await response.json()) as ApolloSearchResponse;
    const organizations = getApolloOrganizations(data);

    if (organizations.length === 0) {
      break;
    }

    for (const organization of organizations) {
      companies.push(normalizeApolloCompany(organization, request.filters));

      if (companies.length >= requestedLimit) {
        break;
      }
    }

    page += 1;
  }

  return {
    companies,
    requestedLimit,
    returnedCount: companies.length,
  };
}

export function getApolloOrganizations(data: ApolloSearchResponse): ApolloOrganization[] {
  return data.organizations ?? data.accounts ?? [];
}

export function normalizeApolloCompany(
  organization: ApolloOrganization,
  filters: CompanyFilters,
): DiscoveredCompany {
  const employeeCount = organization.estimated_num_employees ?? null;
  const annualRevenue = organization.annual_revenue ?? null;
  const location = formatLocation(organization);
  const signals = buildSignals(organization, filters);
  const matchedFilters = buildMatchedFilters(organization, filters, signals);

  return {
    id: organization.id ?? organization.primary_domain ?? organization.name ?? "unknown-company",
    name: organization.name ?? "Unknown company",
    websiteUrl: organization.website_url ?? null,
    industry: organization.industry ?? null,
    employeeCount,
    sizeBucket: getSizeBucket(employeeCount, filters.employeeRanges),
    annualRevenue,
    location,
    matchedFilters,
    signals,
    fit: getFitLabel(signals.filter((signal) => signal.matched).length),
  };
}

export function buildSignals(organization: ApolloOrganization, filters: CompanyFilters) {
  const searchableText = [
    organization.industry,
    organization.short_description,
    organization.seo_description,
    ...(organization.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const employeeCount = organization.estimated_num_employees ?? null;
  const annualRevenue = organization.annual_revenue ?? null;
  const location = formatLocation(organization)?.toLowerCase() ?? "";
  const titles = (organization.person_titles ?? []).join(" ").toLowerCase();

  return [
    {
      key: "industry_match" as const,
      label: "Industry keyword match",
      matched: filters.keywords.some((keyword) => searchableText.includes(keyword.toLowerCase())),
    },
    {
      key: "size_match" as const,
      label: "ICP size match",
      matched:
        employeeCount !== null &&
        filters.employeeRanges.some((range) => isEmployeeCountInRange(employeeCount, range)),
    },
    {
      key: "revenue_match" as const,
      label: "Revenue 10M+",
      matched: annualRevenue !== null && annualRevenue >= filters.revenueMin,
    },
    {
      key: "location_match" as const,
      label: "Target geography",
      matched: filters.locations.some((filterLocation) =>
        location.includes(filterLocation.toLowerCase()),
      ),
    },
    {
      key: "title_relevance" as const,
      label: "Relevant buying title",
      matched:
        titles.length > 0 &&
        filters.jobTitles.some((title) => titles.includes(title.toLowerCase())),
    },
  ];
}

function buildMatchedFilters(
  organization: ApolloOrganization,
  filters: CompanyFilters,
  signals: ReturnType<typeof buildSignals>,
): string[] {
  const matches: string[] = [];
  const text = [
    organization.industry,
    organization.short_description,
    organization.seo_description,
    ...(organization.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  matches.push(...filters.keywords.filter((keyword) => text.includes(keyword.toLowerCase())));

  const employeeCount = organization.estimated_num_employees ?? null;
  if (employeeCount !== null) {
    matches.push(
      ...filters.employeeRanges.filter((range) => isEmployeeCountInRange(employeeCount, range)),
    );
  }

  const location = formatLocation(organization)?.toLowerCase() ?? "";
  matches.push(
    ...filters.locations.filter((filterLocation) =>
      location.includes(filterLocation.toLowerCase()),
    ),
  );

  if (signals.some((signal) => signal.key === "revenue_match" && signal.matched)) {
    matches.push("Revenue 10M+");
  }

  return Array.from(new Set(matches));
}

function formatLocation(organization: ApolloOrganization): string | null {
  const city = organization.city ?? organization.organization_city;
  const state = organization.state ?? organization.organization_state;
  const country = organization.country ?? organization.organization_country;
  const parts = [city, state, country].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

function getSizeBucket(employeeCount: number | null, ranges: string[]): string | null {
  if (employeeCount === null) {
    return null;
  }

  return ranges.find((range) => isEmployeeCountInRange(employeeCount, range)) ?? null;
}

function isEmployeeCountInRange(employeeCount: number, range: string): boolean {
  const [min, max] = range.split(",").map((value) => Number.parseInt(value, 10));

  return Number.isFinite(min) && Number.isFinite(max) && employeeCount >= min && employeeCount <= max;
}

function getFitLabel(matchedSignalCount: number): FitLabel {
  if (matchedSignalCount >= 4) {
    return "Strong";
  }

  if (matchedSignalCount >= 2) {
    return "Medium";
  }

  return "Weak";
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: PASS for default, request mapping, and limit tests.

- [ ] **Step 5: Commit Apollo request mapping**

```bash
git add apps/admin/src/features/company-discovery/apollo.ts apps/admin/src/features/company-discovery/apollo.test.ts
git commit -m "Add Apollo company search mapping"
```

## Task 4: Normalize Apollo Results And Signals

**Files:**
- Modify: `apps/admin/src/features/company-discovery/apollo.test.ts`
- Modify: `apps/admin/src/features/company-discovery/apollo.ts`

- [ ] **Step 1: Add failing tests for normalization and derived signals**

Update the Apollo import at the top of `apps/admin/src/features/company-discovery/apollo.test.ts` to:

```ts
import { buildApolloSearchBody, normalizeApolloCompany, normalizeLimit } from "./apollo";
```

Then append these tests:

```ts
describe("normalizeApolloCompany", () => {
  it("normalizes Apollo fields and derives strong ICP signals", () => {
    const company = normalizeApolloCompany(
      {
        id: "org_123",
        name: "Acme Payroll",
        website_url: "https://acme.example",
        industry: "Payroll Software",
        keywords: ["payroll", "fintech"],
        estimated_num_employees: 180,
        annual_revenue: 25000000,
        city: "Austin",
        state: "Texas",
        country: "United States",
        person_titles: ["CFO", "Treasury Manager"],
      },
      DEFAULT_FILTERS,
    );

    expect(company).toMatchObject({
      id: "org_123",
      name: "Acme Payroll",
      websiteUrl: "https://acme.example",
      industry: "Payroll Software",
      employeeCount: 180,
      sizeBucket: "50,200",
      annualRevenue: 25000000,
      location: "Austin, Texas, United States",
      matchedFilters: ["payroll", "50,200", "United States", "Revenue 10M+"],
      fit: "Strong",
    });

    expect(company.signals).toEqual([
      { key: "industry_match", label: "Industry keyword match", matched: true },
      { key: "size_match", label: "ICP size match", matched: true },
      { key: "revenue_match", label: "Revenue 10M+", matched: true },
      { key: "location_match", label: "Target geography", matched: true },
      { key: "title_relevance", label: "Relevant buying title", matched: true },
    ]);
  });

  it("keeps missing Apollo data visible as nulls and weak fit", () => {
    const company = normalizeApolloCompany(
      {
        name: "Sparse Co",
      },
      DEFAULT_FILTERS,
    );

    expect(company).toMatchObject({
      id: "Sparse Co",
      name: "Sparse Co",
      websiteUrl: null,
      industry: null,
      employeeCount: null,
      sizeBucket: null,
      annualRevenue: null,
      location: null,
      matchedFilters: [],
      fit: "Weak",
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: PASS if Task 3 already included the normalization logic shown there. If a mismatch appears, adjust the implementation so it exactly satisfies the expected normalized fields and signal labels.

- [ ] **Step 3: Commit normalization and signal tests**

```bash
git add apps/admin/src/features/company-discovery/apollo.ts apps/admin/src/features/company-discovery/apollo.test.ts
git commit -m "Add company fit signal normalization"
```

## Task 5: Test Apollo Pagination To Requested Limit

**Files:**
- Modify: `apps/admin/src/features/company-discovery/apollo.test.ts`
- Modify: `apps/admin/src/features/company-discovery/apollo.ts`

- [ ] **Step 1: Add failing tests for server-side pagination**

Update the Vitest import at the top of `apps/admin/src/features/company-discovery/apollo.test.ts` to:

```ts
import { describe, expect, it, vi } from "vitest";
```

Update the Apollo import to:

```ts
import {
  buildApolloSearchBody,
  normalizeApolloCompany,
  normalizeLimit,
  searchApolloCompanies,
} from "./apollo";
```

Then append these tests:

```ts
describe("searchApolloCompanies", () => {
  it("fetches Apollo pages until the requested company limit is reached", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizations: [
              { id: "1", name: "One", estimated_num_employees: 75 },
              { id: "2", name: "Two", estimated_num_employees: 80 },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizations: [
              { id: "3", name: "Three", estimated_num_employees: 90 },
              { id: "4", name: "Four", estimated_num_employees: 100 },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: DEFAULT_FILTERS,
        limit: 3,
      },
      fetcher,
    });

    expect(result.returnedCount).toBe(3);
    expect(result.companies.map((company) => company.name)).toEqual(["One", "Two", "Three"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops when Apollo returns an empty page", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizations: [{ id: "1", name: "One" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizations: [],
          }),
          { status: 200 },
        ),
      );

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: DEFAULT_FILTERS,
        limit: 10,
      },
      fetcher,
    });

    expect(result.returnedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws a clear Apollo status error when Apollo fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("{}", { status: 401 }));

    await expect(
      searchApolloCompanies({
        apiKey: "bad-key",
        request: {
          filters: DEFAULT_FILTERS,
          limit: 10,
        },
        fetcher,
      }),
    ).rejects.toThrow("Apollo search failed with status 401");
  });
});
```

- [ ] **Step 2: Run pagination tests**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: PASS for pagination, empty page, and Apollo failure behavior.

- [ ] **Step 3: Commit pagination tests**

```bash
git add apps/admin/src/features/company-discovery/apollo.ts apps/admin/src/features/company-discovery/apollo.test.ts
git commit -m "Test Apollo company search pagination"
```

## Task 6: Add Company Search Route Handler

**Files:**
- Create: `apps/admin/src/app/api/company-search/route.ts`
- Modify: `apps/admin/src/features/company-discovery/apollo.test.ts`

- [ ] **Step 1: Add route validation helper tests**

Update the Apollo import at the top of `apps/admin/src/features/company-discovery/apollo.test.ts` to:

```ts
import {
  buildApolloSearchBody,
  normalizeApolloCompany,
  normalizeLimit,
  parseCompanySearchRequest,
  searchApolloCompanies,
} from "./apollo";
```

Then append these tests:

```ts
describe("parseCompanySearchRequest", () => {
  it("accepts a complete company search request", () => {
    expect(
      parseCompanySearchRequest({
        filters: DEFAULT_FILTERS,
        limit: 10,
      }),
    ).toEqual({
      filters: DEFAULT_FILTERS,
      limit: 10,
    });
  });

  it("rejects requests without filters", () => {
    expect(() => parseCompanySearchRequest({ limit: 10 })).toThrow("Filters are required");
  });
});
```

- [ ] **Step 2: Run tests and verify request parsing fails**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: FAIL because `parseCompanySearchRequest` is not exported yet.

- [ ] **Step 3: Add request parsing to the Apollo module**

Append this exported function to `apps/admin/src/features/company-discovery/apollo.ts`:

```ts
export function parseCompanySearchRequest(value: unknown): CompanySearchRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Request body must be an object");
  }

  const body = value as Partial<CompanySearchRequest>;

  if (typeof body.filters !== "object" || body.filters === null) {
    throw new Error("Filters are required");
  }

  const filters = body.filters as Partial<CompanyFilters>;

  return {
    filters: {
      keywords: normalizeStringArray(filters.keywords),
      employeeRanges: normalizeStringArray(filters.employeeRanges),
      revenueMin:
        typeof filters.revenueMin === "number" && Number.isFinite(filters.revenueMin)
          ? filters.revenueMin
          : 10000000,
      locations: normalizeStringArray(filters.locations),
      jobTitles: normalizeStringArray(filters.jobTitles),
    },
    limit: normalizeLimit(body.limit),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
```

- [ ] **Step 4: Create the Next route handler**

Create `apps/admin/src/app/api/company-search/route.ts`:

```ts
import { NextResponse } from "next/server";

import { parseCompanySearchRequest, searchApolloCompanies } from "@/features/company-discovery/apollo";

export async function POST(request: Request) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing APOLLO_API_KEY. Add it to your local environment and restart the admin app." },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const searchRequest = parseCompanySearchRequest(body);
    const result = await searchApolloCompanies({
      apiKey,
      request: searchRequest,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Company search failed";
    const status = message.includes("Apollo search failed with status 401") ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 5: Run unit tests**

Run:

```bash
pnpm --filter admin test -- apollo.test.ts
```

Expected: PASS for request parsing and existing Apollo logic.

- [ ] **Step 6: Run admin build**

Run:

```bash
pnpm --filter admin build
```

Expected: Next.js build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit route handler**

```bash
git add apps/admin/src/app/api/company-search/route.ts apps/admin/src/features/company-discovery/apollo.ts apps/admin/src/features/company-discovery/apollo.test.ts
git commit -m "Add admin company search API route"
```

## Task 7: Build Client Search UI

**Files:**
- Create: `apps/admin/src/components/company-discovery-client.tsx`
- Modify: `apps/admin/src/app/page.tsx`

- [ ] **Step 1: Replace the admin page with the discovery shell**

Set `apps/admin/src/app/page.tsx` to:

```tsx
import { CompanyDiscoveryClient } from "@/components/company-discovery-client";

export default function Home() {
  return <CompanyDiscoveryClient />;
}
```

- [ ] **Step 2: Add the client component**

Create `apps/admin/src/components/company-discovery-client.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DEFAULT_COMPANY_LIMIT, DEFAULT_FILTERS, FILTER_GROUPS } from "@/features/company-discovery/constants";
import type { CompanyFilters, CompanySearchResponse, DiscoveredCompany } from "@/features/company-discovery/types";
import { cn } from "@/lib/utils";

type SearchState = "idle" | "loading" | "success" | "error";

export function CompanyDiscoveryClient() {
  const [filters, setFilters] = useState<CompanyFilters>(DEFAULT_FILTERS);
  const [limit, setLimit] = useState(DEFAULT_COMPANY_LIMIT);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CompanySearchResponse | null>(null);

  const activeFilterCount = useMemo(
    () =>
      filters.keywords.length +
      filters.employeeRanges.length +
      filters.locations.length +
      filters.jobTitles.length +
      (filters.revenueMin > 0 ? 1 : 0),
    [filters],
  );

  async function searchCompanies() {
    setSearchState("loading");
    setError(null);

    try {
      const response = await fetch("/api/company-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters,
          limit,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Company search failed");
      }

      setResults(data as CompanySearchResponse);
      setSearchState("success");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Company search failed");
      setSearchState("error");
    }
  }

  function toggleFilter(groupKey: keyof Pick<CompanyFilters, "keywords" | "employeeRanges" | "locations" | "jobTitles">, value: string) {
    setFilters((current) => {
      const currentValues = current[groupKey];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...current,
        [groupKey]: nextValues,
      };
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">Mural Pay Admin</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Apollo ICP Company Discovery</h1>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Search Apollo with the approved ICP, review similar companies, and scan derived buying signals before deciding which accounts deserve deeper research.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-4">
              <p className="text-sm text-cyan-100">Active filters</p>
              <p className="text-3xl font-semibold text-white">{activeFilterCount}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-3xl border border-white/10 bg-white p-6 text-slate-950 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">ICP filters</h2>
                <p className="mt-1 text-sm text-slate-500">Toggle presets before searching.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-6">
              {FILTER_GROUPS.map((group) => (
                <div key={group.key}>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.values.map((value) => {
                      const selected = filters[group.key].includes(value);

                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleFilter(group.key, value)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                            selected
                              ? "border-slate-950 bg-slate-950 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
                          )}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Revenue</h3>
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-medium text-slate-900">Revenue 10M+</p>
                  <p className="text-xs text-slate-500">Apollo revenue minimum: {formatCurrency(filters.revenueMin)}</p>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Number of companies</span>
                <input
                  className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-950 outline-none ring-cyan-500 transition focus:ring-2"
                  min={1}
                  max={100}
                  type="number"
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                />
              </label>

              <Button className="h-11 rounded-xl" disabled={searchState === "loading"} onClick={searchCompanies}>
                {searchState === "loading" ? "Searching Apollo..." : "Search Companies"}
              </Button>
            </div>
          </aside>

          <section className="rounded-3xl border border-white/10 bg-white p-6 text-slate-950 shadow-xl">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Similar companies</h2>
                <p className="text-sm text-slate-500">Live Apollo results with derived ICP fit signals.</p>
              </div>
              {results ? (
                <p className="text-sm text-slate-500">
                  Showing {results.returnedCount} of requested {results.requestedLimit}
                </p>
              ) : null}
            </div>

            <div className="mt-6">
              {searchState === "idle" ? <EmptyState message="Set filters and search to see company matches." /> : null}
              {searchState === "loading" ? <EmptyState message="Searching Apollo for matching companies..." /> : null}
              {searchState === "error" ? <ErrorState message={error ?? "Company search failed"} /> : null}
              {searchState === "success" && results?.companies.length === 0 ? (
                <EmptyState message="No companies matched these filters. Try broadening the ICP chips." />
              ) : null}
              {searchState === "success" && results && results.companies.length > 0 ? (
                <CompanyTable companies={results.companies} />
              ) : null}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function CompanyTable({ companies }: { companies: DiscoveredCompany[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Matched filters</th>
              <th className="px-4 py-3">Buying signals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {companies.map((company) => (
              <tr key={company.id} className="align-top">
                <td className="px-4 py-4">
                  <div className="font-semibold text-slate-950">{company.name}</div>
                  {company.websiteUrl ? (
                    <a className="text-xs text-cyan-700 hover:underline" href={company.websiteUrl} rel="noreferrer" target="_blank">
                      {company.websiteUrl}
                    </a>
                  ) : (
                    <p className="text-xs text-slate-400">No website</p>
                  )}
                </td>
                <td className="px-4 py-4 text-slate-600">{company.industry ?? "Missing"}</td>
                <td className="px-4 py-4 text-slate-600">
                  {company.employeeCount !== null ? company.employeeCount.toLocaleString() : "Missing"}
                  {company.sizeBucket ? <div className="text-xs text-slate-400">{company.sizeBucket}</div> : null}
                </td>
                <td className="px-4 py-4 text-slate-600">{formatNullableCurrency(company.annualRevenue)}</td>
                <td className="px-4 py-4 text-slate-600">{company.location ?? "Missing"}</td>
                <td className="px-4 py-4">
                  <BadgeList values={company.matchedFilters.length > 0 ? company.matchedFilters : ["No direct matches"]} />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2">
                    <FitBadge fit={company.fit} />
                  </div>
                  <BadgeList values={company.signals.filter((signal) => signal.matched).map((signal) => signal.label)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BadgeList({ values }: { values: string[] }) {
  return (
    <div className="flex max-w-xs flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
          {value}
        </span>
      ))}
    </div>
  );
}

function FitBadge({ fit }: { fit: DiscoveredCompany["fit"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold",
        fit === "Strong" && "bg-emerald-100 text-emerald-700",
        fit === "Medium" && "bg-amber-100 text-amber-700",
        fit === "Weak" && "bg-slate-100 text-slate-600",
      )}
    >
      {fit}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-slate-500">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
      {message}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNullableCurrency(value: number | null) {
  return value === null ? "Missing" : formatCurrency(value);
}
```

- [ ] **Step 3: Run admin build**

Run:

```bash
pnpm --filter admin build
```

Expected: Next.js build succeeds. If TypeScript rejects the long `toggleFilter` type, extract `type ToggleGroupKey = "keywords" | "employeeRanges" | "locations" | "jobTitles";` above the component and use `ToggleGroupKey` in the function signature.

- [ ] **Step 4: Commit the client UI**

```bash
git add apps/admin/src/app/page.tsx apps/admin/src/components/company-discovery-client.tsx
git commit -m "Add company discovery admin UI"
```

## Task 8: Document Environment Configuration

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Apollo API key example**

Add this line to `.env.example` if it is not already present:

```bash
APOLLO_API_KEY=
```

If `.env.example` has comments, add this comment immediately above the key:

```bash
# Server-only Apollo API key for admin company discovery.
APOLLO_API_KEY=
```

- [ ] **Step 2: Run a secret scan by inspection**

Run:

```bash
git diff -- .env.example
```

Expected: the diff shows only the empty `APOLLO_API_KEY=` example and no real secret value.

- [ ] **Step 3: Commit environment documentation**

```bash
git add .env.example
git commit -m "Document Apollo API key configuration"
```

## Task 9: Final Verification

**Files:**
- Verify: `apps/admin/src/features/company-discovery/apollo.ts`
- Verify: `apps/admin/src/components/company-discovery-client.tsx`
- Verify: `apps/admin/src/app/api/company-search/route.ts`

- [ ] **Step 1: Run unit tests**

Run:

```bash
pnpm --filter admin test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run admin build**

Run:

```bash
pnpm --filter admin build
```

Expected: Next.js build succeeds.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm --filter admin lint
```

Expected: lint completes without errors. If `next lint` reports that it is removed or unavailable for the installed Next.js version, use the build and tests as verification and note the lint limitation in the completion summary.

- [ ] **Step 4: Manual local smoke test**

Run:

```bash
pnpm --filter admin dev
```

Expected: admin app starts on `http://localhost:3001`.

Open `http://localhost:3001`, confirm:

- The Apollo ICP Company Discovery header renders.
- All preset filter chips render.
- Number of companies defaults to `10`.
- Clicking chips toggles selected state.
- Searching without `APOLLO_API_KEY` shows a clear missing-key error.
- Searching with `APOLLO_API_KEY` returns a table or clear Apollo error.

- [ ] **Step 5: Final commit if verification caused fixes**

If final verification required code changes:

```bash
git add apps/admin .env.example pnpm-lock.yaml
git commit -m "Stabilize company discovery MVP"
```

If no fixes were needed, do not create an empty commit.
