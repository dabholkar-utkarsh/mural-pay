import { describe, expect, it } from "vitest";

import {
  deriveIcpFromExamples,
  deriveMechanicalFilters,
  normalizeDomain,
  parseDeriveIcpRequest,
  parseLlmIcpResult,
  type IcpExampleProfile,
} from "./derive-icp";

function exampleProfile(
  overrides: Partial<IcpExampleProfile> = {},
): IcpExampleProfile {
  return {
    domain: "slash.com",
    found: true,
    name: "Slash",
    industry: "financial services",
    employeeCount: 120,
    revenueDisplay: null,
    location: "New York, New York, United States",
    keywords: ["business banking", "corporate cards", "fintech"],
    description: "Business banking and payments.",
    ...overrides,
  };
}

describe("normalizeDomain", () => {
  it("strips protocol, www, and paths", () => {
    expect(normalizeDomain("https://www.Slash.com/products?x=1")).toBe(
      "slash.com",
    );
  });

  it("rejects values that are not domains", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("parseDeriveIcpRequest", () => {
  it("normalizes and dedupes domains", () => {
    expect(
      parseDeriveIcpRequest({
        domains: ["https://slash.com", "SLASH.COM", "kalshi.com"],
      }),
    ).toEqual({ domains: ["slash.com", "kalshi.com"] });
  });

  it("rejects empty and oversized inputs", () => {
    expect(() => parseDeriveIcpRequest({ domains: ["nope"] })).toThrow(
      /at least one/,
    );
    expect(() =>
      parseDeriveIcpRequest({
        domains: ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"],
      }),
    ).toThrow(/at most/);
  });
});

describe("deriveMechanicalFilters", () => {
  it("prefers keywords shared by 2+ examples and covers sizes and countries", () => {
    const filters = deriveMechanicalFilters([
      exampleProfile(),
      exampleProfile({
        domain: "kalshi.com",
        name: "Kalshi",
        employeeCount: 90,
        location: "San Francisco, California, United States",
        keywords: ["prediction markets", "fintech"],
      }),
    ]);

    expect(filters.keywords).toEqual(["fintech"]);
    expect(filters.employeeRanges).toEqual(["50,200"]);
    expect(filters.locations).toEqual(["United States"]);
    expect(filters.jobTitles).toEqual([]);
  });

  it("falls back to a single example's own keywords when nothing is shared", () => {
    const filters = deriveMechanicalFilters([exampleProfile()]);

    expect(filters.keywords).toEqual([
      "business banking",
      "corporate cards",
      "fintech",
    ]);
  });
});

describe("parseLlmIcpResult", () => {
  it("parses a valid response and drops unknown employee ranges", () => {
    const result = parseLlmIcpResult(
      JSON.stringify({
        pattern: "Fintechs operating payout flows.",
        signals: [{ label: "Payouts", evidence: "Both move money out." }],
        filters: {
          keywords: ["business banking", "embedded finance"],
          employeeRanges: ["50,200", "7,13"],
          revenueMin: 0,
          locations: ["United States"],
          jobTitles: ["CFO"],
          hiringTitles: [],
        },
      }),
    );

    expect(result?.pattern).toMatch(/payout/i);
    expect(result?.filters.employeeRanges).toEqual(["50,200"]);
    expect(result?.filters.jobTitles).toEqual(["CFO"]);
  });

  it("returns null for non-JSON output", () => {
    expect(parseLlmIcpResult("Sorry, I cannot do that.")).toBeNull();
  });
});

describe("deriveIcpFromExamples", () => {
  const enrichResponse = {
    organizations: [
      {
        primary_domain: "slash.com",
        name: "Slash",
        industry: "financial services",
        estimated_num_employees: 120,
        country: "United States",
        keywords: ["business banking", "fintech"],
        short_description: "Business banking and payments.",
      },
    ],
  };

  it("marks unmatched domains as not found and still derives filters", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify(enrichResponse), {
        status: 200,
      })) as typeof fetch;

    const result = await deriveIcpFromExamples({
      apiKey: "key",
      request: { domains: ["slash.com", "unknown.io"] },
      fetcher,
    });

    expect(result.examples.map((e) => e.found)).toEqual([true, false]);
    expect(result.llmUsed).toBe(false);
    expect(result.pattern).toBeNull();
    expect(result.filters.keywords).toContain("fintech");
  });

  it("throws when no domain enriches", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ organizations: [] }), {
        status: 200,
      })) as typeof fetch;

    await expect(
      deriveIcpFromExamples({
        apiKey: "key",
        request: { domains: ["unknown.io"] },
        fetcher,
      }),
    ).rejects.toThrow(/could not enrich/);
  });

  it("uses the LLM synthesis when an Anthropic key is provided", async () => {
    const llmResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pattern: "Fintechs with payout flows.",
            signals: [],
            filters: {
              keywords: ["embedded finance"],
              employeeRanges: ["50,200"],
              revenueMin: 0,
              locations: ["United States"],
              jobTitles: ["CFO"],
              hiringTitles: [],
            },
          }),
        },
      ],
    };
    const fetcher = (async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("anthropic") ? llmResponse : enrichResponse,
        ),
        { status: 200 },
      )) as typeof fetch;

    const result = await deriveIcpFromExamples({
      apiKey: "key",
      request: { domains: ["slash.com"] },
      anthropicApiKey: "anthropic-key",
      fetcher,
    });

    expect(result.llmUsed).toBe(true);
    expect(result.pattern).toBe("Fintechs with payout flows.");
    expect(result.filters.keywords).toEqual(["embedded finance"]);
  });
});
