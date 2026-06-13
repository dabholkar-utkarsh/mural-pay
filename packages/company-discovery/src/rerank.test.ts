import { describe, expect, it, vi } from "vitest";

import { buildRerankPrompt, parseVerdicts, rerankWithLlm } from "./rerank";
import { FULL_ICP_FILTERS } from "./constants";

function anthropicResponse(text: string) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }] }),
    { status: 200 },
  );
}

describe("buildRerankPrompt", () => {
  it("includes the ICP industries and candidate data", () => {
    const prompt = buildRerankPrompt(
      [
        {
          id: "org_1",
          name: "Local Corporation",
          industry: "marketing & advertising",
          short_description: "Local search and advertising technology",
        },
      ],
      FULL_ICP_FILTERS,
    );

    expect(prompt).toContain("payroll, e-com, marketplace, betting");
    expect(prompt).toContain("Local Corporation");
    expect(prompt).toContain("Score LOW: media companies");
  });

  it("asks for scores only when reasons are disabled (fast pre-screen)", () => {
    const prompt = buildRerankPrompt([{ id: "org_1" }], FULL_ICP_FILTERS, false);

    expect(prompt).toContain("no reasons");
    expect(prompt).not.toContain("max 12 words");
  });

  it("scores prospects for Mural Pay, not just industry membership", () => {
    const prompt = buildRerankPrompt([{ id: "org_1" }], FULL_ICP_FILTERS);

    expect(prompt).toContain("Mural Pay");
    expect(prompt).toContain("stablecoin");
    expect(prompt).toContain("brick-and-mortar");
    expect(prompt).toContain("how strong a Mural Pay prospect");
  });

  it("includes target geographies and candidate locations", () => {
    const prompt = buildRerankPrompt(
      [{ id: "org_1", name: "Stoiximan", city: "Athens", country: "Greece" }],
      FULL_ICP_FILTERS,
    );

    expect(prompt).toContain(
      "targets companies based in: United States, Mexico, Brazil",
    );
    expect(prompt).toContain("Athens, Greece");
  });
});

describe("parseVerdicts", () => {
  it("parses a plain JSON array and normalizes scores to 0-1", () => {
    const verdicts = parseVerdicts(
      '[{"id": "org_1", "score": 15, "reason": "ad-tech, not an operator"}]',
    );

    expect(verdicts?.get("org_1")).toEqual({
      score: 0.15,
      reason: "ad-tech, not an operator",
    });
  });

  it("strips markdown code fences", () => {
    const verdicts = parseVerdicts('```json\n[{"id": "a", "score": 90}]\n```');

    expect(verdicts?.get("a")?.score).toBe(0.9);
  });

  it("returns null for unparseable output", () => {
    expect(parseVerdicts("I cannot score these companies.")).toBeNull();
    expect(parseVerdicts("{}")).toBeNull();
  });

  it("clamps out-of-range scores", () => {
    const verdicts = parseVerdicts('[{"id": "a", "score": 150}]');

    expect(verdicts?.get("a")?.score).toBe(1);
  });
});

describe("rerankWithLlm", () => {
  it("calls the Anthropic API and returns verdicts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        anthropicResponse('[{"id": "org_1", "score": 20, "reason": "media company"}]'),
      );

    const verdicts = await rerankWithLlm({
      apiKey: "test-key",
      organizations: [{ id: "org_1", name: "Entrepreneur Media" }],
      filters: FULL_ICP_FILTERS,
      fetcher,
    });

    expect(fetcher.mock.calls[0][0]).toContain("api.anthropic.com");
    expect(verdicts?.get("org_1")).toEqual({ score: 0.2, reason: "media company" });
  });

  it("returns null on API failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));

    expect(
      await rerankWithLlm({
        apiKey: "test-key",
        organizations: [{ id: "org_1" }],
        filters: FULL_ICP_FILTERS,
        fetcher,
      }),
    ).toBeNull();
  });

  it("splits large pools into parallel chunks and merges the verdicts", async () => {
    // 26 candidates, scores-only -> chunk size 25 -> 2 concurrent calls.
    const organizations = Array.from({ length: 26 }, (_, i) => ({
      id: `org_${i}`,
      name: `Company ${i}`,
    }));

    // Each call answers only for the ids present in its own prompt.
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
      };
      const verdicts = organizations
        .filter((org) => body.messages[0].content.includes(`"${org.id}"`))
        .map((org) => ({ id: org.id, score: 50 }));

      return anthropicResponse(JSON.stringify(verdicts));
    });

    const verdicts = await rerankWithLlm({
      apiKey: "test-key",
      organizations,
      filters: FULL_ICP_FILTERS,
      includeReasons: false,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verdicts?.size).toBe(26);
    expect(verdicts?.get("org_25")?.score).toBe(0.5);
  });

  it("keeps verdicts from surviving chunks when one chunk fails", async () => {
    const organizations = Array.from({ length: 30 }, (_, i) => ({
      id: `org_${i}`,
    }));

    const fetcher = vi
      .fn<typeof fetch>()
      // First chunk (org_0..org_24) fails; its companies fall back to
      // prescreen/neutral scoring downstream.
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        anthropicResponse('[{"id": "org_29", "score": 80}]'),
      );

    const verdicts = await rerankWithLlm({
      apiKey: "test-key",
      organizations,
      filters: FULL_ICP_FILTERS,
      includeReasons: false,
      fetcher,
    });

    expect(verdicts?.size).toBe(1);
    expect(verdicts?.get("org_29")?.score).toBe(0.8);
  });

  it("returns null without calling the API when there are no candidates", async () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(
      await rerankWithLlm({
        apiKey: "test-key",
        organizations: [],
        filters: FULL_ICP_FILTERS,
        fetcher,
      }),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
