// Tiny, dependency-free file-type helpers safe to import everywhere.

export type ExtractKind = "structured" | "unstructured";

export function detectKind(filename: string): ExtractKind {
  if (/\.(xlsx|xls|csv)$/i.test(filename)) return "structured";
  if (/\.(pdf|docx|txt)$/i.test(filename)) return "unstructured";
  return "structured";
}

export function isSupported(filename: string): boolean {
  return /\.(xlsx|xls|csv|pdf|docx|txt)$/i.test(filename);
}
