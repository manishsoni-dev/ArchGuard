export type ParsedAdr = {
  title?: string;
  status?: string;
  date?: string;
  sections: {
    context?: string;
    decision?: string;
    consequences?: string;
    alternatives?: string;
    related?: string;
  };
  rawContent: string;
};

const sectionAliases = new Map<string, keyof ParsedAdr["sections"]>([
  ["context", "context"],
  ["decision", "decision"],
  ["consequences", "consequences"],
  ["alternatives", "alternatives"],
  ["related", "related"]
]);

export function parseAdrMarkdown(content: string): ParsedAdr {
  const lines = content.split("\n");
  const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim();
  const sections = parseSections(lines);

  return {
    title,
    status: parseScalarSection(lines, "status"),
    date: parseDate(lines),
    sections,
    rawContent: content
  };
}

function parseSections(lines: string[]): ParsedAdr["sections"] {
  const sections: ParsedAdr["sections"] = {};
  let current: keyof ParsedAdr["sections"] | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      const text = buffer.join("\n").trim();
      if (text) {
        sections[current] = text;
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading?.[1]) {
      flush();
      current = sectionAliases.get(normalizeHeading(heading[1]));
      continue;
    }

    if (current) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function parseScalarSection(lines: string[], sectionName: string): string | undefined {
  const startIndex = lines.findIndex((line) => normalizeHeading(line.replace(/^#+\s+/, "")) === sectionName);

  if (startIndex === -1) {
    return undefined;
  }

  const value = lines
    .slice(startIndex + 1)
    .find((line) => line.trim() && !line.trim().startsWith("#"))
    ?.trim();

  return value || undefined;
}

function parseDate(lines: string[]): string | undefined {
  const inlineDate = lines
    .map((line) => line.match(/date\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1])
    .find(Boolean);

  return inlineDate;
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}
