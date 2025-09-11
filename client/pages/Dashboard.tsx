import React, { Component, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { saveAs } from "file-saver";

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error("Dashboard crashed", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center">
          <h2 className="text-lg font-semibold text-red-700">
            Something went wrong loading the dashboard.
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Please refresh. If it persists, check server logs.
          </p>
        </div>
      );
    }
    return this.props.children as any;
  }
}

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
  productName: string;
  variant: "Classic" | "Pro" | "Max";
}

type CodeType = "barcode" | "qr" | "sticker";

type GenerateResponse = {
  ok: boolean;
  pack: PackDoc;
  files: { modules: Record<string, string>; master: string };
};

function DashboardInner() {
  const nav = useNavigate();
  const [packSerial, setPackSerial] = useState("");
  const [operator, setOperator] = useState("");
  const [codeType, setCodeType] = useState<CodeType>("sticker");
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
  const [dupM1, setDupM1] = useState<Set<string>>(new Set());
  const [dupM2, setDupM2] = useState<Set<string>>(new Set());
  const [dupM3, setDupM3] = useState<Set<string>>(new Set());
  const [modulesEnabled, setModulesEnabled] = useState<ModulesEnabled>({
    m1: true,
    m2: true,
    m3: false,
  });
  const [cfgBatch, setCfgBatch] = useState<string>("001");
  const [productName, setProductName] = useState<string>("NX100");
  const [variant, setVariant] = useState<"Classic" | "Pro" | "Max">("Pro");
  const [serialExists, setSerialExists] = useState(false);
  const [stickerFiles, setStickerFiles] = useState<{
    master?: { url: string; name: string };
    m1?: { url: string; name: string };
    m2?: { url: string; name: string };
    m3?: { url: string; name: string };
  }>({});

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
        const fallback = { m1: true, m2: true, m3: false };
        setModulesEnabled(j?.modulesEnabled ?? fallback);
        if ((j as any).batch) setCfgBatch((j as any).batch);
        if ((j as any).productName) setProductName((j as any).productName);
        if ((j as any).variant) setVariant((j as any).variant);
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
    const toArray = (input?: string | string[] | null): string[] => {
      if (!input) return [];
      if (Array.isArray(input))
        return input.map((s) => String(s).trim()).filter(Boolean);
      return String(input)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const m1Arr = toArray(m1);
    const m2Arr = modulesEnabled.m2 ? toArray(m2) : [];
    const m3Arr = modulesEnabled.m3 ? toArray(m3) : [];

    const need2 = modulesEnabled.m1 && modulesEnabled.m2 && !modulesEnabled.m3;
    const need3 = modulesEnabled.m1 && modulesEnabled.m2 && modulesEnabled.m3;

    if (
      m1Arr.length === 0 ||
      (need2 && m2Arr.length === 0) ||
      (need3 && (m2Arr.length === 0 || m3Arr.length === 0))
    ) {
      toast.error("Paste required module cell lists per config");
      return;
    }

    setErrorInfo("");
    setLoading(true);

    const buildPayload = (overwriteFlag?: boolean) => {
      const payload: any = {
        pack_serial: packSerial.trim(),
        code_type: "barcode",
        module1_cells: m1Arr,
      };
      if (modulesEnabled.m2) payload.module2_cells = m2Arr;
      if (modulesEnabled.m3) payload.module3_cells = m3Arr;
      if (operator && String(operator).trim() !== "")
        payload.operator = operator;
      if (overwriteFlag) payload.overwrite = true;
      return payload;
    };

    try {
      let res = await fetch("/api/packs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
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
            body: JSON.stringify(buildPayload(true)),
          });
        } else if (j.conflicts?.length) {
          const lines = j.conflicts
            .map((c: any) => `${c.cell} in ${c.pack} / ${c.module}`)
            .join("\n");
          const m1Set = new Set<string>();
          const m2Set = new Set<string>();
          const m3Set = new Set<string>();
          const mm1 = m1Arr, mm2 = m2Arr, mm3 = m3Arr;
          for (const c of j.conflicts) {
            if (mm1.includes(c.cell)) m1Set.add(c.cell);
            if (mm2.includes(c.cell)) m2Set.add(c.cell);
            if (mm3.includes(c.cell)) m3Set.add(c.cell);
          }
          setDupM1(m1Set); setDupM2(m2Set); setDupM3(m3Set);
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
          setDupM1(new Set(j.module1_duplicates || []));
          setDupM2(new Set(j.module2_duplicates || []));
          setDupM3(new Set(j.module3_duplicates || []));
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
      toast.success("Generated pack and codes");
      await generateStickerPreviews({ includeModules: true, includeMaster: true });
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
      const res = await fetch(
        `/api/packs/${encodeURIComponent(packSerial.trim())}/regenerate/${type}`,
        { method: "POST" },
      );
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
      const res = await fetch(
        `/api/packs/${encodeURIComponent(packSerial.trim())}/master-only/barcode`,
        { method: "POST" },
      );
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Failed");
      setLastFiles((lf) => ({ ...lf, master: j.master }));
      await generateStickerPreviews({ includeModules: false, includeMaster: true });
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
          module1_cells: normLines(m1),
          module2_cells: modulesEnabled.m2 ? normLines(m2) : undefined,
          module3_cells: modulesEnabled.m3 ? normLines(m3) : undefined,
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
              module1_cells: normLines(m1),
              module2_cells: modulesEnabled.m2 ? normLines(m2) : undefined,
              module3_cells: modulesEnabled.m3 ? normLines(m3) : undefined,
              operator: operator || null,
              overwrite: true,
            }),
          });
        } else if (j.conflicts?.length) {
          const lines = j.conflicts
            .map((c: any) => `${c.cell} in ${c.pack} / ${c.module}`)
            .join("\n");
          const m1Set = new Set<string>();
          const m2Set = new Set<string>();
          const m3Set = new Set<string>();
          const mm1 = normLines(m1); const mm2 = normLines(m2); const mm3 = normLines(m3);
          for (const c of j.conflicts) {
            if (mm1.includes(c.cell)) m1Set.add(c.cell);
            if (mm2.includes(c.cell)) m2Set.add(c.cell);
            if (mm3.includes(c.cell)) m3Set.add(c.cell);
          }
          setDupM1(m1Set); setDupM2(m2Set); setDupM3(m3Set);
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
          setDupM1(new Set(j.module1_duplicates || []));
          setDupM2(new Set(j.module2_duplicates || []));
          setDupM3(new Set(j.module3_duplicates || []));
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
    moduleLabel?: "M1" | "M2" | "M3" | null;
    idText: string; // barcode + human text (pack or module id)
    qrPayload: string; // QR data string
    batch: string;
    productName: string;
    variant: "Classic" | "Pro" | "Max";
  }): Promise<Blob> {
    await (document as any).fonts?.ready;
    const W = 402;
    const H = 201;
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
    const MARGIN = 15;
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

  async function generateStickerPreviews(opts: { includeModules: boolean; includeMaster: boolean }) {
    const pack = packSerial.trim();
    if (!pack) {
      toast.error("Enter pack serial");
      return;
    }
    const doc = (db.packs as any)[pack];
    if (!doc) {
      toast.error("Generate modules first, then retry");
      return;
    }

    const moduleIds = Object.keys(doc.modules || {});
    if (opts.includeModules) {
      if (modulesEnabled.m3) {
        if (moduleIds.length < 3) {
          toast.error("Three modules required by config (M1, M2, M3)");
          return;
        }
      } else if (modulesEnabled.m2) {
        if (moduleIds.length < 2) {
          toast.error("Two modules required by config (M1, M2)");
          return;
        }
      } else if (moduleIds.length < 1) {
        toast.error("Module 1 required by config");
        return;
      }
    }

    const createdISO: string = doc.created_at;
    const dateOnly = new Date(createdISO).toISOString().slice(0, 10);
    const batch = cfgBatch;

    const nextFiles: typeof stickerFiles = {};

    if (opts.includeModules) {
      const labelMap: ("M1" | "M2" | "M3")[] = ["M1", "M2", "M3"];
      const needCount = modulesEnabled.m3 ? 3 : modulesEnabled.m2 ? 2 : 1;
      for (let i = 0; i < needCount; i++) {
        const mid = moduleIds[i];
        const blob = await drawSticker({
          moduleLabel: labelMap[i],
          idText: mid,
          qrPayload: `${mid}|${dateOnly}`,
          batch,
          productName,
          variant,
        });
        const name = `sticker_${labelMap[i]}_${mid}.png`;
        const url = URL.createObjectURL(blob);
        if (i === 0) nextFiles.m1 = { url, name } as any;
        if (i === 1) nextFiles.m2 = { url, name } as any;
        if (i === 2) nextFiles.m3 = { url, name } as any;
      }
    }

    if (opts.includeMaster) {
      const masterBlob = await drawSticker({
        moduleLabel: null,
        idText: pack,
        qrPayload: `${pack}|${dateOnly}`,
        batch,
        productName,
        variant,
      });
      const masterName = `sticker_Master_${pack}.png`;
      const masterUrl = URL.createObjectURL(masterBlob);
      nextFiles.master = { url: masterUrl, name: masterName } as any;
    }

    setStickerFiles((prev) => {
      if (prev.master?.url && nextFiles.master) URL.revokeObjectURL(prev.master.url);
      if (prev.m1?.url && nextFiles.m1) URL.revokeObjectURL(prev.m1.url);
      if (prev.m2?.url && nextFiles.m2) URL.revokeObjectURL(prev.m2.url);
      if (prev.m3?.url && nextFiles.m3) URL.revokeObjectURL(prev.m3.url);
      return nextFiles;
    });

    toast.success("Stickers generated");
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
          <div className="md:col-span-3 flex flex-col justify-end">
            <label className="text-sm font-medium">Operator</label>
            <Input
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="initials or name"
              className="mt-1"
            />
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
              onChange={(e) => {
                setM1(e.target.value);
                setDupM1(new Set());
              }}
              placeholder="Paste each cell serial on a new line"
              className={dupM1.size ? "border-red-500" : undefined}
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
                onChange={(e) => {
                  setM2(e.target.value);
                  setDupM2(new Set());
                }}
                placeholder="Paste each cell serial on a new line"
                className={dupM2.size ? "border-red-500" : undefined}
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
                onChange={(e) => {
                  setM3(e.target.value);
                  setDupM3(new Set());
                }}
                placeholder="Paste each cell serial on a new line"
                className={dupM3.size ? "border-red-500" : undefined}
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
          <Button variant="outline" onClick={() => generateStickerPreviews({ includeModules: true, includeMaster: false })} disabled={loading}>
            Modules Only
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

        {(stickerFiles.m1 || stickerFiles.m2 || stickerFiles.m3 || stickerFiles.master) && (
          <section className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-6">
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
          </section>
        )}

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
                Module <b>{searchRes.moduleId}</b> found in pack{" "}
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

export default function Dashboard() {
  return (
    <ErrorBoundary>
      <DashboardInner />
    </ErrorBoundary>
  );
}
