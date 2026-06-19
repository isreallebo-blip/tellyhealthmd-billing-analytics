// Client-side text extraction for PDF / DOCX / TXT.
// Returns the raw text content so the edge function can run LLM extraction.

import mammoth from "mammoth";

const PDF_WORKER_SRC =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";

export type ExtractKind = "structured" | "unstructured";

export function detectKind(filename: string): ExtractKind {
  if (/\.(xlsx|xls|csv)$/i.test(filename)) return "structured";
  if (/\.(pdf|docx|txt)$/i.test(filename)) return "unstructured";
  return "structured";
}

export function isSupported(filename: string): boolean {
  return /\.(xlsx|xls|csv|pdf|docx|txt)$/i.test(filename);
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(text);
  }
  await doc.destroy?.();
  return parts.join("\n\n").replace(/\s+\n/g, "\n").trim();
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value.trim();
}

async function extractTxt(buf: ArrayBuffer): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
}

export async function extractUnstructuredText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name)) return extractPdf(buf);
  if (/\.docx$/i.test(file.name)) return extractDocx(buf);
  if (/\.txt$/i.test(file.name)) return extractTxt(buf);
  throw new Error(`Unsupported unstructured file: ${file.name}`);
}
