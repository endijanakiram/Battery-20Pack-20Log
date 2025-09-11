import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { saveAs } from "file-saver";

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
  const [productName, setProductName] = useState<string>("NX100");
  const [variant, setVariant] = useState<"Classic" | "Pro" | "Max">("Pro");
  const [stickerFiles, setStickerFiles] = useState<{
    master?: { url: string; name: string };
    m1?: { url: string; name: string };
    m2?: { url: string; name: string };
  }>({});
  const [m1On, setM1On] = useState(true);
  const [m2On, setM2On] = useState(true);
  const [m3On, setM3On] = useState(false);

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
      if (j.modulesEnabled) {
        setM1On(!!j.modulesEnabled.m1);
        setM2On(!!j.modulesEnabled.m2);
        setM3On(!!j.modulesEnabled.m3);
      }
      if ((j as any).productName) setProductName((j as any).productName);
      if ((j as any).variant) setVariant((j as any).variant);
    }
  }

  async function saveConfig() {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        batch,
        modulesEnabled: { m1: m1On, m2: m2On, m3: m3On },
      }),
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
      const m = p.pack_serial.match(
        /^RIV(\d{2})(\d{2})(LFP6|LFP9)(\d{3})(\d{4})$/,
      );
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
    () =>
      filteredPacks.find((p) => p.pack_serial === selected) ||
      filteredPacks[0] ||
      null,
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

  function ddmmyyyy(d: Date) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}-${mm}-${yyyy}`;
  }

  async function renderBarcodeCanvas(text: string, width: number, height: number) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    JsBarcode(c, text, {
      format: "CODE128",
      displayValue: false,
      margin: 8,
      width: 2,
      height: height - 8,
    } as any);
    return c;
  }

  async function renderQrCanvas(payload: string, size: number) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    await QRCode.toCanvas(c, payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    return c;
  }

  async function drawSticker(opts: {
    moduleLabel?: "M1" | "M2" | null;
    idText: string;
    qrPayload: string;
    batch: string;
    productName: string;
    variant: "Classic" | "Pro" | "Max";
  }): Promise<Blob> {
    await (document as any).fonts?.ready;
    const W = 402;
    const H = 201;
    const MARGIN = 15;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#000000";
    ctx.font = "bold 22px Arial, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("RIVOT MOTORS", 23, 39);

    ctx.font = "11px Arial, Roboto, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`BATCH NO: ${opts.batch}`, 402 - MARGIN - 8, 20 + MARGIN);

    const qrSize = 110;
    const qrX = 402 - MARGIN - qrSize;
    const qrY = MARGIN + 24;
    const qrCanvas = await renderQrCanvas(opts.qrPayload, qrSize);
    ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

    const barW = 210;
    const barH = 40;
    const barX = MARGIN + 0;
    const barY = MARGIN + 38;
    const barCanvas = await renderBarcodeCanvas(opts.idText, barW, barH);
    ctx.drawImage(barCanvas, barX, barY, barW, barH);

    ctx.fillStyle = "#000000";
    ctx.font = "12px Arial, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(opts.idText, barX + Math.floor(barW / 2), barY + barH + 14);

    ctx.fillStyle = "#666666";
    ctx.font = "11px Arial, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ddmmyyyy(new Date()), MARGIN + 0, MARGIN + 106);

    ctx.fillStyle = "#000000";
    ctx.font = "bold 12px Arial, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${opts.productName}-${opts.variant.toUpperCase()}`, barX + Math.floor(barW / 2), MARGIN + 126);

    if (opts.moduleLabel) {
      ctx.font = "bold 36px Arial, Roboto, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(opts.moduleLabel, MARGIN + 0, MARGIN + 160);
    }

    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  }

  async function generateStickers() {
    if (!current) return;
    const moduleIds = Object.keys(current.modules || {});
    const dateOnly = new Date(current.created_at).toISOString().slice(0, 10);

    const masterBlob = await drawSticker({
      moduleLabel: null,
      idText: current.pack_serial,
      qrPayload: `${current.pack_serial}|${dateOnly}`,
      batch,
      productName,
      variant,
    });

    const nextFiles: typeof stickerFiles = {} as any;

    const labels: ("M1" | "M2" | "M3")[] = ["M1", "M2", "M3"];
    const count = Math.min(moduleIds.length, 3);
    for (let i = 0; i < count; i++) {
      const mid = moduleIds[i];
      const blob = await drawSticker({
        moduleLabel: labels[i],
        idText: mid,
        qrPayload: `${mid}|${dateOnly}`,
        batch,
        productName,
        variant,
      });
      const name = `sticker_${labels[i]}_${mid}.png`;
      const url = URL.createObjectURL(blob);
      if (i === 0) nextFiles.m1 = { url, name } as any;
      if (i === 1) nextFiles.m2 = { url, name } as any;
      if (i === 2) nextFiles.m3 = { url, name } as any;
    }

    const masterName = `sticker_Master_${current.pack_serial}.png`;
    const masterUrl = URL.createObjectURL(masterBlob);
    nextFiles.master = { url: masterUrl, name: masterName } as any;

    setStickerFiles((prev) => {
      if (prev.master?.url && nextFiles.master) URL.revokeObjectURL(prev.master.url);
      if (prev.m1?.url && nextFiles.m1) URL.revokeObjectURL(prev.m1.url);
      if (prev.m2?.url && nextFiles.m2) URL.revokeObjectURL(prev.m2.url);
      if (prev.m3?.url && nextFiles.m3) URL.revokeObjectURL(prev.m3.url);
      return nextFiles;
    });
  }

  function printStickerBlob(name: string, url: string) {
    const w = window.open("", "_blank");
    if (!w) return;
    const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><title>${name}</title><style>
      @page { size: auto; margin: 0; }
      html, body { height: 100%; }
      body { margin: 0; display:flex; align-items:center; justify-content:center; }
      .wrap { width: 50mm; height: 25mm; display:flex; }
      img { width: 100%; height: 100%; object-fit: contain; }
    </style></head><body>
      <div class='wrap'><img src='${url}'/></div>
      <script>window.onload=()=>{window.focus();window.print();}</script>
    </body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  function downloadStickerBlob(name: string, url: string) {
    fetch(url).then(r=>r.blob()).then(b=>saveAs(b, name));
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
    const today = new Date().toLocaleDateString("en-GB");

    const stickerW = 50; // mm
    const stickerH = 25; // mm
    const textH = 2.4; // mm

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
  .barcode { width: 40mm; height: 9mm; display:block; margin: 0 auto; }
  .qr { width: 20mm; height: 20mm; display:block; margin: 0 auto; }
  .text { width: 100%; height: ${textH}mm; line-height: ${textH}mm; text-align: center; font-family: monospace; font-size: ${textH}mm; }
  .date { width: 100%; text-align: center; font-family: monospace; font-size: ${textH}mm; margin-bottom: 0.5mm; }
</style>
</head>
<body>
  <div class="sticker">
    ${isBar ? `<div class="date">${today}</div>` : ""}
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
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m1On}
                  onChange={(e) => setM1On(e.target.checked)}
                />{" "}
                Module 1
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m2On}
                  onChange={(e) => setM2On(e.target.checked)}
                />{" "}
                Module 2
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m3On}
                  onChange={(e) => setM3On(e.target.checked)}
                />{" "}
                Module 3
              </label>
              <div className="col-span-3 text-xs text-slate-600">
                Variant:{" "}
                {m1On && m2On && m3On
                  ? "Max"
                  : m1On && m2On
                    ? "Pro"
                    : m1On
                      ? "Classic"
                      : "—"}
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
                <Input
                  placeholder="Trace by pack/module/cell"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const q = searchQ.trim();
                    if (!q) return;
                    const r = await fetch(
                      `/api/search?q=${encodeURIComponent(q)}`,
                    );
                    const j = await r.json();
                    if (
                      j &&
                      (j.type === "pack" ||
                        j.type === "cell" ||
                        j.type === "module")
                    ) {
                      setSelected(j.pack.pack_serial);
                      setSearchInfo(
                        j.type === "pack"
                          ? `Opened pack ${j.pack.pack_serial}`
                          : j.type === "cell"
                            ? `Cell ${j.cell} found in ${j.pack.pack_serial} / ${j.moduleId}`
                            : `Module ${j.moduleId} found in ${j.pack.pack_serial}`,
                      );
                    } else {
                      setSearchInfo("Not found");
                    }
                  }}
                >
                  Search
                </Button>
              </div>
              {searchInfo && (
                <div className="text-xs text-slate-500">{searchInfo}</div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs">Date</label>
                  <Input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs">Batch</label>
                  <Input
                    value={batchFilter}
                    maxLength={3}
                    onChange={(e) => setBatchFilter(e.target.value)}
                    placeholder="001"
                  />
                </div>
                <div>
                  <label className="text-xs">Month</label>
                  <select
                    className="w-full border rounded px-2 py-2"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    {Array.from({ length: 12 }, (_, i) =>
                      String(i + 1).padStart(2, "0"),
                    ).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs">Year</label>
                  <Input
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    placeholder="2025"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDateFilter("");
                    setBatchFilter("");
                    setMonthFilter("");
                    setYearFilter("");
                  }}
                >
                  Clear Filters
                </Button>
                <div className="text-xs text-slate-500 self-center">
                  Showing {filteredPacks.length} / {packs.length}
                </div>
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
                <Button variant="outline" size="sm" onClick={saveEdits}>
                  Save
                </Button>
                <Button variant="destructive" size="sm" onClick={deletePack}>
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={generateStickers}>
                  Generate Stickers
                </Button>
              </div>

              {(stickerFiles.m1 || stickerFiles.m2 || stickerFiles.m3 || stickerFiles.master) && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
                  {stickerFiles.m1 && (
                    <figure className="border rounded p-3 bg-white shadow-sm">
                      <img src={stickerFiles.m1.url} alt={stickerFiles.m1.name} className="mx-auto h-auto max-w-full object-contain" />
                      <figcaption className="mt-2 text-center text-xs break-all">{stickerFiles.m1.name}</figcaption>
                      <div className="mt-2 flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => printStickerBlob(stickerFiles.m1!.name, stickerFiles.m1!.url)}>Print</Button>
                        <Button variant="outline" size="sm" onClick={() => downloadStickerBlob(stickerFiles.m1!.name, stickerFiles.m1!.url)}>Download</Button>
                      </div>
                    </figure>
                  )}
                  {stickerFiles.m2 && (
                    <figure className="border rounded p-3 bg-white shadow-sm">
                      <img src={stickerFiles.m2.url} alt={stickerFiles.m2.name} className="mx-auto h-auto max-w-full object-contain" />
                      <figcaption className="mt-2 text-center text-xs break-all">{stickerFiles.m2.name}</figcaption>
                      <div className="mt-2 flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => printStickerBlob(stickerFiles.m2!.name, stickerFiles.m2!.url)}>Print</Button>
                        <Button variant="outline" size="sm" onClick={() => downloadStickerBlob(stickerFiles.m2!.name, stickerFiles.m2!.url)}>Download</Button>
                      </div>
                    </figure>
                  )}
                  {stickerFiles.m3 && (
                    <figure className="border rounded p-3 bg-white shadow-sm">
                      <img src={stickerFiles.m3.url} alt={stickerFiles.m3.name} className="mx-auto h-auto max-w-full object-contain" />
                      <figcaption className="mt-2 text-center text-xs break-all">{stickerFiles.m3.name}</figcaption>
                      <div className="mt-2 flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => printStickerBlob(stickerFiles.m3!.name, stickerFiles.m3!.url)}>Print</Button>
                        <Button variant="outline" size="sm" onClick={() => downloadStickerBlob(stickerFiles.m3!.name, stickerFiles.m3!.url)}>Download</Button>
                      </div>
                    </figure>
                  )}
                  {stickerFiles.master && (
                    <figure className="border rounded p-3 bg-white shadow-sm">
                      <img src={stickerFiles.master.url} alt={stickerFiles.master.name} className="mx-auto h-auto max-w-full object-contain" />
                      <figcaption className="mt-2 text-center text-xs break-all">{stickerFiles.master.name}</figcaption>
                      <div className="mt-2 flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => printStickerBlob(stickerFiles.master!.name, stickerFiles.master!.url)}>Print</Button>
                        <Button variant="outline" size="sm" onClick={() => downloadStickerBlob(stickerFiles.master!.name, stickerFiles.master!.url)}>Download</Button>
                      </div>
                    </figure>
                  )}
                </div>
              )}

              {/* Module editors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {Object.keys(current.modules).map((mid) => (
                  <div key={mid} className="border rounded p-3">
                    <h3 className="font-medium">{mid}</h3>
                    <Textarea
                      className="mt-2"
                      rows={10}
                      value={editing[mid] || ""}
                      onChange={(e) =>
                        setEditing((s) => ({ ...s, [mid]: e.target.value }))
                      }
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
