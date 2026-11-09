import { parse } from "csv-parse/sync";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ExtractedDocument = {
  sections: Array<{ text: string; metadata: Record<string, string | number> }>;
  rows?: Array<Record<string, string>>;
};

const MAX_EXTRACTED_CHARACTERS = 5_000_000;

export async function extractDocument(fileName: string, mimeType: string, data: Buffer): Promise<ExtractedDocument> {
  let sections: ExtractedDocument["sections"];
  let rows: Array<Record<string, string>> | undefined;

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      sections = result.pages.map((page) => ({ text: page.text, metadata: { page: page.num } }));
    } finally {
      await parser.destroy();
    }
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const html = await mammoth.convertToHtml({ buffer: data }, { externalFileAccess: false });
    const blocks = html.value.split(/(?=<h[1-6][^>]*>)/i).map((block) => block.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()).filter(Boolean);
    sections = blocks.map((text, index) => ({ text, metadata: { section: index + 1 } }));
    if (sections.length === 0) {
      const raw = await mammoth.extractRawText({ buffer: data });
      sections = [{ text: raw.value, metadata: { section: 1 } }];
    }
  } else if (mimeType === "text/csv" || fileName.toLowerCase().endsWith(".csv")) {
    rows = parse(data, { bom: true, columns: true, skip_empty_lines: true, relax_column_count: false, max_record_size: 1_000_000 }) as Array<Record<string, string>>;
    sections = rows.map((row, index) => ({
      text: Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(" | "),
      metadata: { row_start: index + 1, row_end: index + 1 },
    }));
  } else {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    const markdown = mimeType === "text/markdown" || /\.md(?:own)?$/i.test(fileName);
    if (markdown) {
      const blocks = text.split(/(?=^#{1,6}\s)/m).map((block) => block.trim()).filter(Boolean);
      sections = blocks.map((block, index) => ({ text: block, metadata: { section: block.match(/^#{1,6}\s+(.+)/)?.[1]?.trim() ?? `Section ${index + 1}` } }));
    } else {
      sections = [{ text, metadata: { section: "Text" } }];
    }
  }

  const totalCharacters = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (totalCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted text exceeds the 5 million character processing limit.");
  if (sections.length === 0 || totalCharacters === 0) throw new Error("No searchable text could be extracted from this file.");
  return { sections, rows };
}

export function chunkSections(sections: ExtractedDocument["sections"], size = 1200, overlap = 180) {
  const chunks: Array<{ content: string; metadata: Record<string, string | number> }> = [];
  for (const section of sections) {
    const text = section.text.trim();
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + Math.floor(size * 0.65)) end = boundary;
      }
      chunks.push({ content: text.slice(start, end).trim(), metadata: section.metadata });
      if (end >= text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
