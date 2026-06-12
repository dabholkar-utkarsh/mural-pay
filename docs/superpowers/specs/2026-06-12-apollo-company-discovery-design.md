# Apollo Company Discovery MVP Design

## Summary

Build a lightweight internal company discovery tool in `apps/admin` for finding companies that resemble the initial Mural Pay ICP. The first MVP uses Apollo's mixed company search endpoint, displays the active filters, returns a requested number of companies, and adds simple derived buying signals so the team can quickly qualify results.

The MVP is live-only. It does not persist searches or results, sync to a CRM, enrich contacts outside Apollo's response, or expose the Apollo API key to the browser.

## Goals

- Let an internal user search Apollo using a preset ICP filter set.
- Show all active filters in the UI before and after search.
- Let the user request a target number of companies, defaulting to `10`.
- Fetch enough Apollo pages to return up to the requested company count.
- Display company size, revenue, location, matched filters, and derived buying signals in a scannable table.
- Keep the Apollo API key server-side.

## Non-Goals

- Saved searches or database persistence.
- User authentication or role management beyond the existing admin app boundary.
- CRM export, CSV export, or workflow automation.
- Complex lead scoring, AI ranking, or account research summaries.
- Contact/person enrichment beyond fields returned by the company search response.

## Product Scope

The first screen is an internal admin page for Apollo company discovery. It starts from the original ICP:

- Industry keywords: `payroll`, `e-com`, `marketplace`, `betting`
- Employee ranges: `50,200`, `200,500`
- Revenue minimum: `10000000`
- Locations: `United States`, `Mexico`, `Brazil`
- Target job titles: `CPO`, `CLO`, `CFO`
- Company count: `10`

The user can toggle preset chips on and off and change the company count. The first MVP does not need arbitrary free-text filter creation. That keeps the workflow close to the known ICP while still allowing quick experimentation.

## Architecture

The UI lives in `apps/admin`. The React page submits the selected filters and company count to a server-side endpoint. The browser never calls Apollo directly and never receives the Apollo API key.

For the MVP, the server-side endpoint should be a Next.js route handler inside `apps/admin`. That keeps the UI and its thin Apollo proxy together, avoids adding NestJS wiring before persistence or shared backend workflows exist, and still keeps `APOLLO_API_KEY` server-only.

The endpoint maps the selected filters to Apollo's `mixed_companies/search` request:

- `q_organization_keyword_tags` for industry keywords.
- `organization_num_employees_ranges` for employee ranges.
- `organization_locations` for target countries.
- `q_organization_job_titles` for target job titles.
- `revenue_range.min` for the revenue floor.
- `page` and `per_page` for pagination.

The endpoint requests pages until it has collected the requested number of companies or Apollo returns no more results. It normalizes Apollo's response into a frontend shape and attaches derived buying signals before returning JSON to the UI.

## API Contract

The internal search endpoint accepts:

```json
{
  "filters": {
    "keywords": ["payroll", "e-com", "marketplace", "betting"],
    "employeeRanges": ["50,200", "200,500"],
    "revenueMin": 10000000,
    "locations": ["United States", "Mexico", "Brazil"],
    "jobTitles": ["CPO", "CLO", "CFO"]
  },
  "limit": 10
}
```

The response returns:

```json
{
  "companies": [
    {
      "id": "apollo-organization-id",
      "name": "Example Company",
      "websiteUrl": "https://example.com",
      "industry": "Payroll",
      "employeeCount": 120,
      "annualRevenue": 25000000,
      "location": "United States",
      "matchedFilters": ["payroll", "50,200", "United States"],
      "signals": [
        { "key": "size_match", "label": "ICP size match", "matched": true },
        { "key": "revenue_match", "label": "Revenue 10M+", "matched": true }
      ],
      "fit": "Strong"
    }
  ],
  "requestedLimit": 10,
  "returnedCount": 1
}
```

The exact Apollo response fields will be normalized defensively because some records may omit revenue, employee count, location, or title metadata.

## UI Design

The admin page is a single-screen search workflow:

1. Header: short explanation that this is an Apollo-powered ICP company discovery tool.
2. Filter panel: grouped preset chips for industries, company size, revenue, locations, and target job titles.
3. Company count input: numeric control defaulting to `10`.
4. Search action: runs the live Apollo lookup.
5. Result states: loading, empty result, API error, missing API key, and success.
6. Results table: optimized for scanning.

The results table columns are:

- Company name and website.
- Industry.
- Employee count and size bucket.
- Annual revenue.
- Location.
- Matched filters.
- Buying signals and fit label.

Rows show a simple fit label:

- `Strong`: most major signals match.
- `Medium`: some major signals match.
- `Weak`: few major signals match or key data is missing.

## Derived Buying Signals

The MVP derives simple signals from Apollo's returned company fields and the selected ICP filters:

- `industry_match`: company industry, keywords, or tags match selected industry keywords.
- `size_match`: employee count fits `50-500` or a selected employee range.
- `revenue_match`: annual revenue is at least `10000000` when Apollo provides revenue.
- `location_match`: company location matches one of the selected target countries.
- `title_relevance`: returned title/person metadata supports a selected job title when Apollo provides it.

The initial `fit` label is a simple count of matched signals:

- `Strong`: 4 or more matched signals.
- `Medium`: 2 or 3 matched signals.
- `Weak`: fewer than 2 matched signals.

Missing data does not count as a match. The UI should make missing values visible instead of hiding them.

## Error Handling

The endpoint returns clear errors for:

- Missing Apollo API key.
- Apollo authentication failure.
- Apollo rate limit or transient service failure.
- Invalid company count.
- No results found for the selected filters.

The UI shows these errors in plain language and keeps the selected filters visible so the user can adjust and retry.

## Security

Apollo credentials are read only on the server side from environment variables. The React client sends selected filters to the internal endpoint and receives normalized results. The API key is never embedded in frontend code, logged in browser-visible output, or returned in API responses.

Because an Apollo API key was used in terminal output during exploration, the key should be rotated before this tool is used beyond local development.

## Testing Plan

Tests should focus on the risky logic:

- Apollo request mapping from selected filters.
- Page fetching until the requested company limit is reached.
- Result normalization with missing optional fields.
- Derived signal and fit-label calculation.
- Endpoint error behavior for missing API key, Apollo failure, and invalid limit.

The first UI can be verified with lightweight component checks or manual local testing because the main behavior sits in the endpoint and normalization logic.

## Implementation Notes

- Authentication for the admin page is outside this MVP. The feature should still be built as an internal tool and avoid public exposure of secrets.
