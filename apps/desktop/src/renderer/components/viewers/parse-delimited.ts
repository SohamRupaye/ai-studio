// Pure parsing for the table viewer — React-free so it can be unit-tested
// directly (same rationale as main/ingestion.ts).

/**
 * RFC-4180-ish parser: quoted fields may contain the delimiter, doubled
 * quotes, and newlines. Bare \r is dropped so CRLF input parses clean.
 */
export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

/** Split ingestion's xlsx text ("## Sheet: name" + CSV per sheet) back into sheets. */
export function parseSheets(content: string): Array<{ name: string; rows: string[][] }> {
  const parts = content.split(/^## Sheet: (.+)$/m);
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const rows = parseDelimited(parts[i + 1]!.trim(), ",");
    if (rows.length) sheets.push({ name: parts[i]!.trim(), rows });
  }
  return sheets;
}
