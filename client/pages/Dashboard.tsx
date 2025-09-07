import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface PackDoc {
  pack_serial: string;
  created_at: string;
  created_by: string | null;
  modules: Record<string, string[]>;
  codes: Record<string, string>;
}
interface BatteryDB {
  packs: Record<string, PackDoc>;
}

interface ModulesEnabled {
  m1: boolean;
  m2: boolean;
  m3: boolean;
}
interface Config {
  model: "LFP6" | "LFP9";
  batch: string;
  modulesEnabled: ModulesEnabled;
}

type CodeType = "barcode" | "qr";

type GenerateResponse = {
  ok: boolean;
  pack: PackDoc;
  files: { modules: Record<string, string>; master: string };
};

export default function Dashboard() {
  const nav = useNavigate();
  const [packSerial, setPackSerial] = useState("");
  const [operator, setOperator] = useState("");
  const [codeType, setCodeType] = useState<CodeType>("barcode");
  const [m1, setM1] = useState("");
  const [m2, setM2] = useState("");
  const [m3, setM3] = useState("");
  const [db, setDb] = useState<BatteryDB>({ packs: {} });
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<any>(null);
  const [lastFiles, setLastFiles] = useState<{
    modules?: Record<string, string>;
    master?: string;
  }>({});
  const [nextSerial, setNextSerial] = useState<string>("");
  const [errorInfo, setErrorInfo] = useState<string>("");
  const [modulesEnabled, setModulesEnabled] = useState<ModulesEnabled>({
    m1: true,
    m2: true,
    m3: false,
  });
  const [serialExists, setSerialExists] = useState(false);

  useEffect(() => {
    fetchDB();
    fetchNext();
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const r = await fetch("/api/config");
      if (r.ok) {
        const j = (await r.json()) as Config;
        setModulesEnabled(j.modulesEnabled);
      }
    } catch {}
  }

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

  async function fetchNext() {
    try {
      const r = await fetch("/api/next-pack-serial");
      if (r.ok) {
        const j = await r.json();
        setNextSerial(j.next);
      }
    } catch {}
  }

  function normLines(text: string) {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleGenerate() {
    const need2 = modulesEnabled.m1 && modulesEnabled.m2 && !modulesEnabled.m3;
    const need3 = modulesEnabled.m1 && modulesEnabled.m2 && modulesEnabled.m3;
    if (
      !m1.trim() ||
      (need2 && !m2.trim()) ||
      (need3 && (!m2.trim() || !m3.trim()))
    ) {
      toast.error("Paste required module cell lists per config");
      return;
    }
    setErrorInfo("");
    setLoading(true);
    try {
      let res = await fetch("/api/packs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_serial: packSerial.trim(),
          module1_cells: m1,
          module2_cells: modulesEnabled.m2 ? m2 : undefined,
          module3_cells: modulesEnabled.m3 ? m3 : undefined,
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
            setSerialExists(true);
            setLoading(false);
            return;
          }
          setSerialExists(false);
          res = await fetch("/api/packs/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pack_serial: packSerial.trim(),
              module1_cells: m1,
              module2_cells: modulesEnabled.m2 ? m2 : undefined,
              module3_cells: modulesEnabled.m3 ? m3 : undefined,
              code_type: codeType,
              operator: operator || null,
              overwrite: true,
            }),
          });
        } else if (j.conflicts?.length) {
          const lines = j.conflicts
            .map((c: any) => `${c.cell} in ${c.pack} / ${c.module}`)
            .join("\n");
          setErrorInfo(`Duplicate cells found:\n${lines}`);
          toast.error("Duplicate cells found. See details below.", {
            duration: 5000,
          });
          setLoading(false);
          return;
        } else if (
          j.module1_duplicates?.length ||
          j.module2_duplicates?.length ||
          j.module3_duplicates?.length
        ) {
          const msg = `Duplicate cells in module1: ${j.module1_duplicates?.join(", ") || "-"}\nDuplicate cells in module2: ${j.module2_duplicates?.join(", ") || "-"}\nDuplicate cells in module3: ${j.module3_duplicates?.join(", ") || "-"}`;
          setErrorInfo(msg);
          toast.error("Duplicate cells within module. See details below.", {
            duration: 5000,
          });
          setLoading(false);
          return;
        } else {
          toast.error(j.error || "Conflict error");
          setLoading(false);
          return;
        }
      }
      const data = (await res.json()) as GenerateResponse;
      if (!data.ok) throw new Error("Failed");
      setLastFiles({ modules: data.files.modules, master: data.files.master });
      setPackSerial(data.pack.pack_serial);
      setDb((prev) => ({
        packs: { ...prev.packs, [data.pack.pack_serial]: data.pack },
      }));
      toast.success("Generated 3 code PNGs");
      fetchNext();
    } catch (e: any) {
      toast.error(e?.message || "Error generating pack");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate(type: CodeType) {
    if (!packSerial.trim()) return toast.error("Enter pack serial");
    setLoading(true);
    try {
      const res = await fetch("/api/packs/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_serial: packSerial.trim(),
          code_type: type,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed");
      setLastFiles({ modules: j.files.modules, master: j.files.master });
      setDb((prev) => ({
        packs: { ...prev.packs, [j.pack.pack_serial]: j.pack },
      }));
      toast.success(`Regenerated as ${type.toUpperCase()}`);
    } catch (e: any) {
      toast.error(e?.message || "Error regenerating codes");
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

  async function handleSaveOnly() {
    const need2 = modulesEnabled.m1 && modulesEnabled.m2 && !modulesEnabled.m3;
    const need3 = modulesEnabled.m1 && modulesEnabled.m2 && modulesEnabled.m3;
    if (
      !m1.trim() ||
      (need2 && !m2.trim()) ||
      (need3 && (!m2.trim() || !m3.trim()))
    ) {
      toast.error("Paste required module cell lists per config");
      return;
    }
    setLoading(true);
    try {
      let res = await fetch("/api/packs/save-only", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_serial: packSerial.trim(),
          module1_cells: m1,
          module2_cells: modulesEnabled.m2 ? m2 : undefined,
          module3_cells: modulesEnabled.m3 ? m3 : undefined,
          operator: operator || null,
        }),
      });
      if (res.status === 409) {
        const j = await res.json();
        if (j.exists) {
          const ok = window.confirm("Pack exists. Overwrite existing data?");
          if (!ok) {
            setSerialExists(true);
            setLoading(false);
            return;
          }
          setSerialExists(false);
          res = await fetch("/api/packs/save-only", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pack_serial: packSerial.trim(),
              module1_cells: m1,
              module2_cells: modulesEnabled.m2 ? m2 : undefined,
              module3_cells: modulesEnabled.m3 ? m3 : undefined,
              operator: operator || null,
              overwrite: true,
            }),
          });
        } else if (j.conflicts?.length) {
          const lines = j.conflicts
            .map((c: any) => `${c.cell} in ${c.pack} / ${c.module}`)
            .join("\n");
          setErrorInfo(`Duplicate cells found:\n${lines}`);
          toast.error("Duplicate cells found. See details below.", {
            duration: 5000,
          });
          setLoading(false);
          return;
        } else if (
          j.module1_duplicates?.length ||
          j.module2_duplicates?.length ||
          j.module3_duplicates?.length
        ) {
          const msg = `Duplicate cells in module1: ${j.module1_duplicates?.join(", ") || "-"}\nDuplicate cells in module2: ${j.module2_duplicates?.join(", ") || "-"}\nDuplicate cells in module3: ${j.module3_duplicates?.join(", ") || "-"}`;
          setErrorInfo(msg);
          toast.error("Duplicate cells within module. See details below.", {
            duration: 5000,
          });
          setLoading(false);
          return;
        } else {
          toast.error(j.error || "Conflict error");
          setLoading(false);
          return;
        }
      }
      const data = await res.json();
      if (!data.ok) throw new Error("Failed");
      setPackSerial(data.pack.pack_serial);
      setDb((prev) => ({
        packs: { ...prev.packs, [data.pack.pack_serial]: data.pack },
      }));
      toast.success("Saved without generating codes");
    } catch (e: any) {
      toast.error(e?.message || "Error saving pack");
    } finally {
      setLoading(false);
    }
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
    setM3("");
    setSerialExists(false);
    setLastFiles({});
  }

  function downloadImage(url: string) {
    fetch(url)
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = url.split("/").pop() || "code.png";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  function printImage(url: string) {
    const name = url.split("/").pop() || "code.png";
    const serial = name.split("_")[0];
    const isQR = /_QR_/.test(name);
    const isBar = /_BARCODE_/.test(name);

    const stickerW = 50; // mm
    const stickerH = 25; // mm
    const textH = 2.8; // mm

    const w = window.open("", "_blank");
    if (!w) return;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Print ${name}</title>
<style>
  @page { size: auto; margin: 0; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; align-items: center; justify-content: center; }
  .sticker { width: ${stickerW}mm; height: ${stickerH}mm; padding: 1mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
  .img-wrap { width: 100%; display: flex; justify-content: center; }
  .barcode { width: 40mm; height: 15mm; }
  .qr { width: 20mm; height: 20mm; }
  .text { width: 100%; height: ${textH}mm; line-height: ${textH}mm; text-align: center; font-family: monospace; font-size: ${textH}mm; }
</style>
</head>
<body>
  <div class="sticker">
    <div class="img-wrap">
      <img class="${isQR ? "qr" : isBar ? "barcode" : "barcode"}" src="${url}" />
    </div>
    <div class="text">${serial}</div>
  </div>
  <script>window.onload = () => { window.focus(); window.print(); };</script>
</body>
</html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  const brand = {
    title: "Battery Pack Data Log",
    subtitle:
      "Generate modules, enforce uniqueness, and print QR 25mm / Code128 40×15mm @ 203 DPI",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-emerald-700">
              {brand.title}
            </h1>
            <p className="text-xs text-slate-500">{brand.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                localStorage.removeItem("auth_role");
                nav("/");
              }}
           >
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="text-sm font-medium">Battery Pack Serial</label>
            <Input
              value={packSerial}
              onChange={(e) => {
                setPackSerial(e.target.value);
                setSerialExists(false);
              }}
              placeholder="Leave blank for auto (e.g., RIV2509LFP90010001)"
              className={`mt-1 ${serialExists ? "border-red-500 text-red-700" : ""}`}
            />
            {serialExists && (
              <div className="mt-1 text-xs text-red-600">
                This pack serial already exists. Choose a different serial or
                overwrite.
              </div>
            )}
            <div className="mt-1 text-xs text-slate-500 flex items-center gap-2">
              <span>Next: {nextSerial || "—"}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPackSerial(nextSerial);
                  setSerialExists(false);
                }}
              >
                Autofill
              </Button>
            </div>
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

        <section
          className={`mt-6 grid grid-cols-1 ${modulesEnabled.m3 ? "md:grid-cols-3" : modulesEnabled.m2 ? "md:grid-cols-2" : "md:grid-cols-1"} gap-6`}
        >
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
          {modulesEnabled.m2 && (
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
          )}
          {modulesEnabled.m3 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold">Module 3 cells</h3>
                <span className="text-xs text-slate-500">
                  {normLines(m3).length} lines
                </span>
              </div>
              <Textarea
                rows={12}
                value={m3}
                onChange={(e) => setM3(e.target.value)}
                placeholder="Paste each cell serial on a new line"
              />
            </div>
          )}
        </section>

        {errorInfo && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 whitespace-pre-wrap">
            {errorInfo}
          </div>
        )}

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
          <Button variant="outline" onClick={handleSaveOnly} disabled={loading}>
            Save Without Codes
          </Button>
          <Button variant="outline" onClick={clearAll}>
            Clear
          </Button>
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-3">
            <span>Total packs: {packsCount}</span>
          </div>
        </section>

        {(lastFiles.modules && Object.keys(lastFiles.modules).length > 0) ||
        lastFiles.master ? (
          <>
            <div className="mt-6 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRegenerate("barcode")}
              >
                Regenerate as Barcode
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRegenerate("qr")}
              >
                Regenerate as QR
              </Button>
            </div>
            <section className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-6">
              {lastFiles.modules &&
                Object.entries(lastFiles.modules).map(([id, url]) => (
                  <figure
                    key={id}
                    className="border rounded p-3 bg-white shadow-sm"
                  >
                    <img
                      src={url}
                      alt={id}
                      className="mx-auto h-auto max-w-full object-contain"
                    />
                    <figcaption className="mt-2 text-center text-xs break-all">
                      {url.split("/").pop()}
                    </figcaption>
                    {/_QR_/.test(url) && (
                      <div className="text-center text-xs mt-1">
                        {(url.split("/").pop() || "").split("_")[0]}
                      </div>
                    )}
                    <div className="mt-2 flex justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => printImage(url)}
                      >
                        Print
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadImage(url)}
                      >
                        Download
                      </Button>
                    </div>
                  </figure>
                ))}
              {lastFiles.master && (
                <figure className="border rounded p-3 bg-white shadow-sm">
                  <img
                    src={lastFiles.master}
                    alt="master code"
                    className="mx-auto h-auto max-w-full object-contain"
                  />
                  <figcaption className="mt-2 text-center text-xs break-all">
                    {lastFiles.master.split("/").pop()}
                  </figcaption>
                  {/_QR_/.test(lastFiles.master) && (
                    <div className="text-center text-xs mt-1">
                      {lastFiles.master.split("/").pop()!.split("_")[0]}
                    </div>
                  )}
                  <div className="mt-2 flex justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => printImage(lastFiles.master!)}
                    >
                      Print
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadImage(lastFiles.master!)}
                    >
                      Download
                    </Button>
                  </div>
                </figure>
              )}
            </section>
          </>
        ) : null}

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
                Created: {new Date(searchRes.pack.created_at).toLocaleString()} {" "}
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
                Cell <b>{searchRes.cell}</b> found in module {" "}
                <b>{searchRes.moduleId}</b>, pack <b>{searchRes.packId}</b>
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(searchRes.pack.modules).map(
                  ([mid, cells]: any) => (
                    <div key={mid}>
                      <div className={
                        "font-semibold " +
                        (mid === searchRes.moduleId ? "text-emerald-700" : "")
                      }>
                        {mid}
                      </div>
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
          {searchRes && searchRes.type === "module" && (
            <div className="mt-4 rounded border bg-white p-4 text-sm">
              <div>
                Module <b>{searchRes.moduleId}</b> found in pack {" "}
                <b>{searchRes.packId}</b>
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(searchRes.pack.modules).map(
                  ([mid, cells]: any) => (
                    <div key={mid}>
                      <div
                        className={
                          "font-semibold " +
                          (mid === searchRes.moduleId ? "text-emerald-700" : "")
                        }
                      >
                        {mid}
                      </div>
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
        </section>

        <section className="mt-10 text-xs text-slate-500">
          <p>
            Label printing spec: QR 25×25 mm (~197 px @ 203 DPI) and Code128
            40×15 mm (315×118 px @ 203 DPI). Use Print for accurate sizing and
            printer selection.
          </p>
        </section>
      </main>
    </div>
  );
}
