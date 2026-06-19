import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";

type Props = { sourceFileId: string; filename: string };

function hexToBytes(hex: string): Uint8Array {
  // Postgres bytea over PostgREST comes back as "\x504b0304..."
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function SourceFilePreview({ sourceFileId, filename }: Props) {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isStructured = /\.(xlsx|xls|csv)$/i.test(filename);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setWb(null);
    setTextPreview(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("source_files" as any)
          .select("file_bytes")
          .eq("id", sourceFileId)
          .maybeSingle();
        if (error) throw error;
        const raw = (data as any)?.file_bytes;
        if (!raw) throw new Error("Original file bytes not available.");
        const bytes = typeof raw === "string" ? hexToBytes(raw) : new Uint8Array(raw);

        if (!isStructured) {
          // Unstructured: show extracted text (best-effort) or a binary placeholder
          if (/\.txt$/i.test(filename)) {
            if (!alive) return;
            setTextPreview(new TextDecoder().decode(bytes));
          } else if (/\.docx$/i.test(filename)) {
            const mammoth = (await import("mammoth")).default;
            const { value } = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
            if (!alive) return;
            setTextPreview(value);
          } else if (/\.pdf$/i.test(filename)) {
            const pdfjs: any = await import(/* @vite-ignore */ "pdfjs-dist/build/pdf.mjs" as any);
            pdfjs.GlobalWorkerOptions.workerSrc =
              "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
            const doc = await pdfjs.getDocument({ data: bytes }).promise;
            const parts: string[] = [];
            const maxPages = Math.min(doc.numPages, 20);
            for (let i = 1; i <= maxPages; i++) {
              const page = await doc.getPage(i);
              const c = await page.getTextContent();
              parts.push(`── page ${i} ──\n` + c.items.map((it: any) => it.str ?? "").join(" "));
            }
            await doc.destroy?.();
            if (!alive) return;
            setTextPreview(parts.join("\n\n") + (doc.numPages > maxPages ? `\n\n…(${doc.numPages - maxPages} more pages)` : ""));
          } else {
            if (!alive) return;
            setTextPreview("Preview not available for this file type.");
          }
        } else {
          const isCsv = /\.csv$/i.test(filename);
          const book = isCsv
            ? XLSX.read(new TextDecoder().decode(bytes), { type: "string" })
            : XLSX.read(bytes, { type: "array", cellDates: false });
          if (!alive) return;
          setWb(book);
          setSheetName(book.SheetNames[0] ?? null);
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Failed to load preview");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sourceFileId, filename, isStructured]);

  const grid = useMemo(() => {
    if (!wb || !sheetName) return null;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return null;
    const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
    return aoa.slice(0, 500); // cap for performance
  }, [wb, sheetName]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading original…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-start gap-2 p-4 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
      </div>
    );
  }
  if (textPreview !== null) {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">{textPreview}</pre>
      </div>
    );
  }
  if (!wb || !grid) return <div className="p-4 text-sm text-muted-foreground">No preview.</div>;

  const cols = grid[0]?.length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {wb.SheetNames.length > 1 && (
        <div className="flex gap-1 px-2 pt-2 border-b overflow-x-auto">
          {wb.SheetNames.map((n) => (
            <button
              key={n}
              onClick={() => setSheetName(n)}
              className={`px-3 py-1.5 text-xs rounded-t-md border-b-2 whitespace-nowrap ${
                n === sheetName
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="text-xs border-collapse w-max">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border border-border px-2 py-1 text-right text-muted-foreground w-12">#</th>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="border border-border px-2 py-1 text-left font-medium text-muted-foreground min-w-[120px]">
                  {XLSX.utils.encode_col(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-primary/5 font-medium" : ""}>
                <td className="border border-border px-2 py-1 text-right text-muted-foreground tabular-nums bg-muted/40">
                  {ri + 1}
                </td>
                {Array.from({ length: cols }).map((_, ci) => {
                  const v = row?.[ci];
                  return (
                    <td key={ci} className="border border-border px-2 py-1 whitespace-nowrap max-w-[260px] overflow-hidden text-ellipsis">
                      {v == null ? "" : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {grid.length >= 500 && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/40">
            Showing first 500 rows of the sheet.
          </div>
        )}
      </div>
    </div>
  );
}
