import { describe, expect, it } from "vitest";
import { parseAdrMarkdown } from "../src/indexing/adr-parser.js";

describe("parseAdrMarkdown", () => {
  it("parses title, status, context, decision, and consequences", () => {
    const adr = parseAdrMarkdown(`# ADR 0002: Frontend must not import database layer

## Status
Accepted

## Context
Frontend code should communicate through API/service boundaries.

## Decision
Files under frontend/ or ui/ must not import from db/ directly.

## Consequences
Database access remains centralized.
`);

    expect(adr.title).toBe("ADR 0002: Frontend must not import database layer");
    expect(adr.status).toBe("Accepted");
    expect(adr.sections.context).toContain("Frontend code");
    expect(adr.sections.decision).toContain("must not import");
    expect(adr.sections.consequences).toContain("centralized");
  });

  it("falls back safely for irregular Markdown", () => {
    const adr = parseAdrMarkdown("Architecture note without headings.");

    expect(adr.rawContent).toBe("Architecture note without headings.");
    expect(adr.title).toBeUndefined();
    expect(adr.sections).toEqual({});
  });
});
