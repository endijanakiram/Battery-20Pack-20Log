import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

interface PackDoc {
  pack_serial: string;
  created_at: string;
  created_by: string | null;
  modules: Record<string, string[]>;
  codes: Record<string, string>;
}

export default function Admin() {
  const nav = useNavigate();
  const [packs, setPacks] = useState<PackDoc[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [model, setModel] = useState<"LFP6" | "LFP9">("LFP9");
  const [batch, setBatch] = useState("001");
  const [nextSerial, setNextSerial] = useState("");

  const [searchQ, setSearchQ] = useState("");
  const [searchInfo, setSearchInfo] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [batchFilter, setBatchFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");

  useEffect(() => {
    if (localStorage.getItem("auth_role") !== "admin") {
      nav("/");
      return;
    }
    load();
    loadConfig();
    previewNext();
  }, []);

  async function load() {
    const res = await fetch("/api/packs");
    const j = await res.json();
    const list: PackDoc[] = j.packs || [];
    setPacks(list);
    if (list.length && !selected) setSelected(list[0].pack_serial);
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    if (res.ok) {
      const j = await res.json();
      setModel(j.model);
      setBatch(j.batch);
    }
  }

  async function saveConfig() {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, batch }),
    });
    if (res.ok) previewNext();
  }

  async function previewNext() {
    const r = await fetch("/api/next-pack-serial");
    if (r.ok) {
      const j = await r.json();
      setNextSerial(j.next);
    }
  }

  const total = useMemo(() => packs.length, [packs]);

  const filteredPacks = useMemo(() => {
    return packs.filter((p) => {
      // Date filter (YYYY-MM-DD)
      if (dateFilter) {
        const d = new Date(p.created_at).toISOString().slice(0, 10);
        if (d !== dateFilter) return false;
      }
      // Parse from pack_serial: RIV YY MM MODEL(4) BATCH(3) UNIT(4)
      const m = p.pack_serial.match(/^RIV(\d{2})(\d{2})(LFP6|LFP9)(\d{3})(\d{4})$/);
      const YY = m ? m[1] : null;
      const MM = m ? m[2] : null;
      const BATCH = m ? m[4] : null;
      const created = new Date(p.created_at);
      // Month filter
      if (monthFilter) {
        const mm = String(created.getMonth() + 1).padStart(2, "0");
        if (mm !== String(monthFilter).padStart(2, "0")) return false;
      }
      // Year filter
      if (yearFilter) {
        const yr = String(created.getFullYear());
        const yf = yearFilter.length === 2 ? `20${yearFilter}` : yearFilter;
        if (yr !== yf) return false;
      }
      // Batch filter
      if (batchFilter) {
        if (!BATCH || BATCH !== batchFilter.padStart(3, "0")) return false;
      }
      return true;
    });
  }, [packs, dateFilter, batchFilter, monthFilter, yearFilter]);

  const current = useMemo(
    () => filteredPacks.find((p) => p.pack_serial === selected) || filteredPacks[0] || null,
    [filteredPacks, selected],
  );

  useEffect(() => {
    if (current) {
      const map: Record<string, string> = {};
      for (const [mid, cells] of Object.entries(current.modules)) {
        map[mid] = cells.join("\n");
      }
      setEditing(map);
    }
  }, [current?.pack_serial]);

  async function saveEdits() {
    if (!current) return;
    const modules: Record<string, string[]> = {};
    for (const [mid, text] of Object.entries(editing)) {
      modules[mid] = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const res = await fetch(
      `/api/packs/${encodeURIComponent(current.pack_serial)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules }),
      },
    );
    if (res.ok) load();
  }

  async function deletePack() {
    if (!current) return;
    if (!confirm(`Delete pack ${current.pack_serial}?`)) return;
    const res = await fetch(
      `/api/packs/${encodeURIComponent(current.pack_serial)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      await load();
      setSelected("");
    }
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

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-emerald-700">Admin</h1>
          <p className="text-xs text-slate-500">Total packs: {total}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
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
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-12 gap-6">
        <aside className="md:col-span-4 space-y-4">
          <div className="border rounded p-3 bg-slate-50">
            <h3 className="font-semibold mb-2">Config</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Model</label>
                <select
                  className="mt-1 w-full border rounded px-2 py-2"
                  value={model}
                  onChange={(e) => setModel(e.target.value as any)}
                >
                  <option value="LFP6">LFP6</option>
                  <option value="LFP9">LFP9</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Batch (3 digits)</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-2"
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  maxLength={3}
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={saveConfig}>
                Save Config
              </Button>
              <Button variant="ghost" onClick={previewNext}>
                Preview Next
              </Button>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Next pack serial: <b>{nextSerial}</b>
            </div>
          </div>

          <div className="border rounded p-3 bg-slate-50">
            <h3 className="font-semibold mb-2">Packs</h3>

            <div className="mb-3 space-y-2">
              <div className="flex gap-2">
                <Input placeholder="Trace by pack/module/cell" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
                <Button variant="outline" onClick={async () => {
                  const q = searchQ.trim();
                  if (!q) return;
                  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                  const j = await r.json();
                  if (j && (j.type === 'pack' || j.type === 'cell' || j.type === 'module')) {
                    setSelected(j.pack.pack_serial);
                    setSearchInfo(j.type === 'pack' ? `Opened pack ${j.pack.pack_serial}` : j.type === 'cell' ? `Cell ${j.cell} found in ${j.pack.pack_serial} / ${j.moduleId}` : `Module ${j.moduleId} found in ${j.pack.pack_serial}`);
                  } else {
                    setSearchInfo('Not found');
                  }
                }}>Search</Button>
              </div>
              {searchInfo && <div className="text-xs text-slate-500">{searchInfo}</div>}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs">Date</label>
                  <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs">Batch</label>
                  <Input value={batchFilter} maxLength={3} onChange={(e) => setBatchFilter(e.target.value)} placeholder="001" />
                </div>
                <div>
                  <label className="text-xs">Month</label>
                  <select className="w-full border rounded px-2 py-2" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                    <option value="">All</option>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs">Year</label>
                  <Input value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} placeholder="2025" />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => { setDateFilter(""); setBatchFilter(""); setMonthFilter(""); setYearFilter(""); }}>Clear Filters</Button>
                <div className="text-xs text-slate-500 self-center">Showing {filteredPacks.length} / {packs.length}</div>
              </div>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {filteredPacks.map((p) => (
                <button
                  key={p.pack_serial}
                  className={`w-full text-left rounded px-3 py-2 border ${selected === p.pack_serial ? "bg-emerald-100 border-emerald-300" : "bg-white hover:bg-slate-50"}`}
                  onClick={() => setSelected(p.pack_serial)}
                >
                  <div className="font-medium">{p.pack_serial}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(p.created_at).toLocaleString()} ·{" "}
                    {p.created_by || "—"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="md:col-span-8">
          {current ? (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Edit {current.pack_serial}
                </h2>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveEdits}>
                    Save
                  </Button>
                  <Button variant="destructive" onClick={deletePack}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={async () => {
                  if (!current) return;
                  const r = await fetch('/api/packs/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack_serial: current.pack_serial, code_type: 'barcode' }) });
                  const j = await r.json();
                  if (j.ok) { setPacks((ps) => ps.map(p => p.pack_serial === current.pack_serial ? j.pack : p)); }
                }}>Regenerate as Barcode</Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  if (!current) return;
                  const r = await fetch('/api/packs/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack_serial: current.pack_serial, code_type: 'qr' }) });
                  const j = await r.json();
                  if (j.ok) { setPacks((ps) => ps.map(p => p.pack_serial === current.pack_serial ? j.pack : p)); }
                }}>Regenerate as QR</Button>
              </div>

              {/* Codes preview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                {current.codes.module1 && (
                  <figure className="border rounded p-3 bg-white shadow-sm">
                    <img src={current.codes.module1} alt="module1" className="mx-auto h-auto max-w-full object-contain" />
                    <figcaption className="mt-2 text-center text-xs break-all">{current.codes.module1.split('/').pop()}</figcaption>
                    {/_QR_/.test(current.codes.module1) && (
                      <div className="text-center text-xs mt-1">
                        {current.codes.module1.split('/').pop()!.split('_')[0]}
                      </div>
                    )}
                    <div className="mt-2 flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => printImage(current.codes.module1)}>Print</Button>
                      <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.module1)}>Download</Button>
                    </div>
                  </figure>
                )}
                {current.codes.module2 && (
                  <figure className="border rounded p-3 bg-white shadow-sm">
                    <img src={current.codes.module2} alt="module2" className="mx-auto h-auto max-w-full object-contain" />
                    <figcaption className="mt-2 text-center text-xs break-all">{current.codes.module2.split('/').pop()}</figcaption>
                    {/_QR_/.test(current.codes.module2) && (
                      <div className="text-center text-xs mt-1">
                        {current.codes.module2.split('/').pop()!.split('_')[0]}
                      </div>
                    )}
                    <div className="mt-2 flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => printImage(current.codes.module2)}>Print</Button>
                      <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.module2)}>Download</Button>
                    </div>
                  </figure>
                )}
                {current.codes.master && (
                  <figure className="border rounded p-3 bg-white shadow-sm">
                    <img src={current.codes.master} alt="master" className="mx-auto h-auto max-w-full object-contain" />
                    <figcaption className="mt-2 text-center text-xs break-all">{current.codes.master.split('/').pop()}</figcaption>
                    {/_QR_/.test(current.codes.master) && (
                      <div className="text-center text-xs mt-1">
                        {current.codes.master.split('/').pop()!.split('_')[0]}
                      </div>
                    )}
                    <div className="mt-2 flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => printImage(current.codes.master)}>Print</Button>
                      <Button variant="outline" size="sm" onClick={() => downloadImage(current.codes.master)}>Download</Button>
                    </div>
                  </figure>
                )}
              </div>

              {/* Module editors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {Object.keys(current.modules).map((mid) => (
                  <div key={mid} className="border rounded p-3">
                    <h3 className="font-medium">{mid}</h3>
                    <Textarea
                      className="mt-2"
                      rows={10}
                      value={editing[mid] || ""}
                      onChange={(e) => setEditing((s) => ({ ...s, [mid]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-slate-500">Select a pack to edit</div>
          )}
        </section>
      </main>
    </div>
  );
}
