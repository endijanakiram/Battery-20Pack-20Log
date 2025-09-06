import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import JSZip from "jszip";
import { toast } from "sonner";

interface PackDoc {
  pack_serial: string;
  created_at: string;
  created_by: string | null;
  modules: Record<string, string[]>;
  codes: { module1: string; module2: string; master: string };
}
interface BatteryDB {
  packs: Record<string, PackDoc>;
}

type CodeType = "barcode" | "qr";

type GenerateResponse = {
  ok: boolean;
  pack: PackDoc;
  files: { module1: string; module2: string; master: string };
};

export default function Index() {
  const [packSerial, setPackSerial] = useState("");
  const [operator, setOperator] = useState("");
  const [codeType, setCodeType] = useState<CodeType>("barcode");
  const [m1, setM1] = useState("");
  const [m2, setM2] = useState("");
  const [db, setDb] = useState<BatteryDB>({ packs: {} });
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<any>(null);
  const [lastFiles, setLastFiles] = useState<{
    module1?: string;
    module2?: string;
    master?: string;
  }>({});

  useEffect(() => {
    fetchDB();
  }, []);

  async function fetchDB() {
    try {
      const res = await fetch("/api/db");
      const data = (await res.json()) as BatteryDB;
      setDb(data);
    } catch (e) {
      console.error(e);
    }
  }

  const packsCount = useMemo(() => Object.keys(db.packs).length, [db]);

  function normLines(text: string) {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleGenerate() {
    if (!packSerial.trim()) {
      toast.error("Enter pack serial");
      return;
    }
    if (!m1.trim() || !m2.trim()) {
      toast.error("Paste both module cell lists");
      return;
    }
    setLoading(true);
    try {
      let res = await fetch("/api/packs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_serial: packSerial.trim(),
          module1_cells: m1,
          module2_cells: m2,
          code_type: codeType,
          operator: operator || null,
        }),
      });
      if (res.status === 409) {
        const j = await res.json();
        if (j.exists) {
          const confirmOverwrite = window.confirm(
            "Pack exists. Overwrite? This will replace existing data.",
          );
          if (!confirmOverwrite) {
            setLoading(false);
            return;
          }
          res = await fetch("/api/packs/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pack_serial: packSerial.trim(),
              module1_cells: m1,
              module2_cells: m2,
              code_type: codeType,
              operator: operator || null,
              overwrite: true,
            }),
          });
        } else if (j.conflicts?.length) {
          const lines = j.conflicts
            .map((c: any) => `${c.cell} in ${c.pack} / ${c.module}`)
            .join("\n");
          toast.error("Duplicate cells found:\n" + lines, { duration: 7000 });
          setLoading(false);
          return;
        } else if (
          j.module1_duplicates?.length ||
          j.module2_duplicates?.length
        ) {
          const msg = `Duplicate cells in module1: ${j.module1_duplicates.join(", ")}\nDuplicate cells in module2: ${j.module2_duplicates.join(", ")}`;
          toast.error(msg, { duration: 7000 });
          setLoading(false);
          return;
        }
      }
      const data = (await res.json()) as GenerateResponse;
      if (!data.ok) throw new Error("Failed");
      setLastFiles(data.files);
      setDb((prev) => ({
        packs: { ...prev.packs, [data.pack.pack_serial]: data.pack },
      }));
      toast.success("Generated 3 code PNGs");
    } catch (e: any) {
      toast.error(e?.message || "Error generating pack");
    } finally {
      setLoading(false);
    }
  }

  async function handleMasterOnly() {
    if (!packSerial.trim()) return toast.error("Enter pack serial");
    setLoading(true);
    try {
      const res = await fetch("/api/packs/master-only", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_serial: packSerial.trim(),
          code_type: codeType,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed");
      setLastFiles((lf) => ({ ...lf, master: j.master }));
      toast.success("Generated master code");
    } catch (e: any) {
      toast.error(e?.message || "Error generating master code");
    } finally {
      setLoading(false);
    }
  }

  async function handleExportZip() {
    const urls = [
      lastFiles.module1,
      lastFiles.module2,
      lastFiles.master,
    ].filter(Boolean) as string[];
    if (!urls.length) return toast.error("Nothing to export yet");
    const zip = new JSZip();
    for (const url of urls) {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const name = url.split("/").pop()!;
      zip.file(name, blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `${packSerial || "codes"}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleSearch() {
    const q = searchQ.trim();
    if (!q) return;
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const j = await res.json();
    setSearchRes(j);
    if (!j || j.result === null) toast("Not found");
  }

  function clearAll() {
    setPackSerial("");
    setOperator("");
    setM1("");
    setM2("");
    setLastFiles({});
  }

  function printImage(url: string) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Print</title></head><body style="margin:0"><img src="${url}" onload="window.print();window.close();" /></body></html>`);
    w.document.close();
  }

  const brand = {
    title: "Battery Pack Data Log",
    subtitle: "Generate modules, enforce uniqueness, and print 20×20 mm codes",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-50 text-slate-800">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-emerald-700">
              {brand.title}
            </h1>
            <p className="text-xs text-slate-500">{brand.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchDB}>
              Load DB
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                fetch("/api/db", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(db),
                })
                  .then(() => toast.success("Saved DB"))
                  .catch(() => toast.error("Save failed"));
              }}
            >
              Save DB
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                toast("Use Google Drive by configuring server credentials.")
              }
            >
              Sign in to Google Drive
            </Button>
            <Button
              variant="outline"
              onClick={() => toast("Upload to Drive not configured")}
            >
              Upload DB to Drive
            </Button>
            <Button
              variant="outline"
              onClick={() => toast("Download from Drive not configured")}
            >
              Download DB from Drive
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Inputs Row */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="text-sm font-medium">Battery Pack Serial</label>
            <Input
              value={packSerial}
              onChange={(e) => setPackSerial(e.target.value)}
              placeholder="e.g. MLFP302300001"
              className="mt-1"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-sm font-medium">Operator</label>
            <Input
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="initials or name"
              className="mt-1"
            />
          </div>
          <div className="md:col-span-4">
            <label className="text-sm font-medium">Code Type</label>
            <div className="mt-1 flex rounded-md border p-1">
              <button
                className={
                  "flex-1 rounded px-3 py-2 text-sm " +
                  (codeType === "barcode"
                    ? "bg-emerald-600 text-white"
                    : "hover:bg-slate-50")
                }
                onClick={() => setCodeType("barcode")}
              >
                Barcode (Code128)
              </button>
              <button
                className={
                  "flex-1 rounded px-3 py-2 text-sm " +
                  (codeType === "qr"
                    ? "bg-emerald-600 text-white"
                    : "hover:bg-slate-50")
                }
                onClick={() => setCodeType("qr")}
              >
                QR
              </button>
            </div>
          </div>
        </section>

        {/* Two-column body */}
        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold">Module 1 cells</h3>
              <span className="text-xs text-slate-500">
                {normLines(m1).length} lines
              </span>
            </div>
            <Textarea
              rows={12}
              value={m1}
              onChange={(e) => setM1(e.target.value)}
              placeholder="Paste each cell serial on a new line"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold">Module 2 cells</h3>
              <span className="text-xs text-slate-500">
                {normLines(m2).length} lines
              </span>
            </div>
            <Textarea
              rows={12}
              value={m2}
              onChange={(e) => setM2(e.target.value)}
              placeholder="Paste each cell serial on a new line"
            />
          </div>
        </section>

        {/* Actions */}
        <section className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleGenerate} disabled={loading}>
            Generate Modules + Master
          </Button>
          <Button
            variant="secondary"
            onClick={handleMasterOnly}
            disabled={loading}
          >
            Generate Master Only
          </Button>
          <Button variant="outline" onClick={clearAll}>
            Clear
          </Button>
          <Button variant="outline" onClick={handleExportZip}>
            Export ZIP
          </Button>
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-3">
            <span>Total packs: {packsCount}</span>
          </div>
        </section>

        {/* Latest files preview */}
        {(lastFiles.module1 || lastFiles.module2 || lastFiles.master) && (
          <section className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {lastFiles.module1 && (
              <figure className="border rounded p-3 bg-white shadow-sm">
                <img src={lastFiles.module1} alt="module1 code" className="mx-auto" />
                <figcaption className="mt-2 text-center text-xs break-all">
                  {lastFiles.module1.split("/").pop()}
                </figcaption>
                <div className="mt-2 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => printImage(lastFiles.module1!)}>Print Mod 1</Button>
                </div>
              </figure>
            )}
            {lastFiles.module2 && (
              <figure className="border rounded p-3 bg-white shadow-sm">
                <img src={lastFiles.module2} alt="module2 code" className="mx-auto" />
                <figcaption className="mt-2 text-center text-xs break-all">
                  {lastFiles.module2.split("/").pop()}
                </figcaption>
                <div className="mt-2 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => printImage(lastFiles.module2!)}>Print Mod 2</Button>
                </div>
              </figure>
            )}
            {lastFiles.master && (
              <figure className="border rounded p-3 bg-white shadow-sm">
                <img src={lastFiles.master} alt="master code" className="mx-auto" />
                <figcaption className="mt-2 text-center text-xs break-all">
                  {lastFiles.master.split("/").pop()}
                </figcaption>
                <div className="mt-2 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => printImage(lastFiles.master!)}>Print Master</Button>
                </div>
              </figure>
            )}
          </section>
        )}

        {/* Search */}
        <section className="mt-10 border-t pt-6">
          <h3 className="font-semibold">Trace / Search</h3>
          <div className="mt-2 flex gap-2">
            <Input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Paste a pack serial or a cell serial"
            />
            <Button variant="outline" onClick={handleSearch}>
              Search
            </Button>
          </div>
          {searchRes && searchRes.type === "pack" && (
            <div className="mt-4 rounded border bg-white p-4 text-sm">
              <div className="font-medium">
                Pack: {searchRes.pack.pack_serial}
              </div>
              <div className="text-slate-500">
                Created: {new Date(searchRes.pack.created_at).toLocaleString()}{" "}
                by {searchRes.pack.created_by || "—"}
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(searchRes.pack.modules).map(
                  ([mid, cells]: any) => (
                    <div key={mid}>
                      <div className="font-semibold">{mid}</div>
                      <ul className="mt-1 text-xs grid grid-cols-2 gap-x-4">
                        {cells.map((c: string) => (
                          <li key={c} className="truncate">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
          {searchRes && searchRes.type === "cell" && (
            <div className="mt-4 rounded border bg-white p-4 text-sm">
              <div>
                Cell <b>{searchRes.cell}</b> found in module{" "}
                <b>{searchRes.moduleId}</b>, pack <b>{searchRes.packId}</b>
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(searchRes.pack.modules).map(
                  ([mid, cells]: any) => (
                    <div key={mid}>
                      <div className="font-semibold">{mid}</div>
                      <ul className="mt-1 text-xs grid grid-cols-2 gap-x-4">
                        {cells.map((c: string) => (
                          <li
                            key={c}
                            className={
                              c === searchRes.cell
                                ? "text-emerald-700 font-medium"
                                : "truncate"
                            }
                          >
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </section>

        {/* Help */}
        <section className="mt-10 text-xs text-slate-500">
          <p>
            Label printing spec: 20×20 mm at 300 dpi = 236×236 px. For QR,
            payloads use compact JSON for reliability. Barcode uses short text
            payloads like M:&lt;module_id&gt; and
            P:&lt;pack&gt;|MS:&lt;m1&gt;,&lt;m2&gt;.
          </p>
        </section>
      </main>
    </div>
  );
}
