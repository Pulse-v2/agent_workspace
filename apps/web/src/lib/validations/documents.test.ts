import { describe, expect, it } from "vitest";
import { contentMatchesType, extensionOf, sanitizeFileName, storageKeyName } from "./documents";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("document upload validation", () => {
  it("accepts only supported extensions", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("data.csv")).toBe("csv");
    expect(extensionOf("notes.markdown")).toBe("markdown");
    expect(extensionOf("script.exe")).toBeNull();
    expect(extensionOf("no-extension")).toBeNull();
  });

  it("checks that content matches the claimed type", () => {
    expect(contentMatchesType("pdf", bytes("%PDF-1.7 ..."))).toBe(true);
    expect(contentMatchesType("pdf", bytes("not a pdf"))).toBe(false);
    expect(contentMatchesType("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(contentMatchesType("docx", bytes("plain text"))).toBe(false);
    expect(contentMatchesType("txt", bytes("Ünïcödé text is fine"))).toBe(true);
    expect(contentMatchesType("csv", new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(contentMatchesType("txt", new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
  });

  it("sanitizes file names without losing the extension", () => {
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("bad\u0000name?.csv")).toBe("badname_.csv");
    const long = sanitizeFileName(`${"a".repeat(300)}.docx`);
    expect(long).toHaveLength(180);
    expect(long.endsWith(".docx")).toBe(true);
  });

  it("produces ASCII-only storage keys", () => {
    expect(storageKeyName("Звіт за Q3 (final).pdf")).toMatch(/^[\w.-]+$/);
  });
});
