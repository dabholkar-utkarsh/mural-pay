import { describe, expect, it, vi } from "vitest";

import { buildRerankPrompt, parseVerdicts, rerankWithLlm } from "./rerank";
import { DEFAULT_FILTERS } from "./constants";

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
      DEFAULT_FILTERS,
    );

    expect(prompt).toContain("payroll, e-com, marketplace, betting");
    expect(prompt).toContain("Local Corporation");
    expect(prompt).toContain("Score LOW: media companies");
  });

  it("asks for scores only when reasons are disabled (fast pre-screen)", () => {
    const prompt = buildRerankPrompt([{ id: "org_1" }], DEFAULT_FILTERS, false);

    expect(prompt).toContain("no reasons");
    expect(prompt).not.toContain("max 12 words");
  });

  it("scores prospects for Mural Pay, not just industry membership", () => {
    const prompt = buildRerankPrompt([{ id: "org_1" }], DEFAULT_FILTERS);

    expect(prompt).toContain("Mural Pay");
    expect(prompt).toContain("stablecoin");
    expect(prompt).toContain("brick-and-mortar");
    expect(prompt).toContain("how strong a Mural Pay prospect");
  });

  it("includes target geographies and candidate locations", () => {
    const prompt = buildRerankPrompt(
      [{ id: "org_1", name: "Stoiximan", city: "Athens", country: "Greece" }],
      DEFAULT_FILTERS,
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
      filters: DEFAULT_FILTERS,
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
        filters: DEFAULT_FILTERS,
        fetcher,
      }),
    ).toBeNull();
  });

  it("returns null without calling the API when there are no candidates", async () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(
      await rerankWithLlm({
        apiKey: "test-key",
        organizations: [],
        filters: DEFAULT_FILTERS,
        fetcher,
      }),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
