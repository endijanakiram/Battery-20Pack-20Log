import { RequestHandler } from "express";
import {
  BatteryDB,
  PackDoc,
  getAllCells,
  getAllModuleIds,
  readDB,
  writeDB,
  readConfig,
  writeConfig,
} from "../utils/db";
import { CodeType, generateCodes } from "../utils/codes";

function normalizeLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function allocateModuleIds(db: BatteryDB, count: number): string[] {
  // New module serial format: MLFP + DDYY + NNNNN (auto-increment per day)
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `MLFP${dd}${yy}`; // e.g., MLFP3023
  const used = getAllModuleIds(db);

  // Find max numeric suffix (last 5 digits) for today's prefix
  let max = 0;
  for (const id of used) {
    if (id.startsWith(prefix) && id.length === prefix.length + 5) {
      const tail = id.slice(prefix.length);
      if (/^\d{5}$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > max) max = n;
      }
    }
  }

  const nextId = (n: number) => `${prefix}${String(n).padStart(5, "0")}`;
  const out: string[] = [];
  let n = Math.max(1, max + 1);
  while (out.length < count) {
    const cand = nextId(n);
    if (!used.has(cand)) out.push(cand);
    n++;
  }
  return out;
}

function nextPackSerial(db: BatteryDB): string {
  // RIV + YY + MM + MODEL(4) + BATCH(3) + UNIT(4)
  const cfg = readConfig();
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const model = cfg.model; // LFP6 or LFP9
  const batch = (cfg.batch || "001").padStart(3, "0");
  const prefix = `RIV${yy}${mm}${model}${batch}`;

  let maxUnit = 0;
  for (const id of Object.keys(db.packs)) {
    if (id.startsWith(prefix)) {
      const unit = id.slice(prefix.length);
      if (/^\d{4}$/.test(unit)) {
        const n = parseInt(unit, 10);
        if (n > maxUnit) maxUnit = n;
      }
    }
  }
  const next = maxUnit + 1 || 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export const generatePack: RequestHandler = async (req, res) => {
  const body = req.body as any;
  const pack_serial = body.pack_serial as string | undefined;
  const code_type = (body.code_type || body.codeType || body.type) as CodeType;
  const operator = (body.operator ?? null) as string | null;
  const overwrite = !!body.overwrite;

  function pickCells(key: string): string | string[] | null {
    if (body[key] != null) return body[key];
    if (body.modules && body.modules[key] != null) return body.modules[key];
    const short = key.replace(/module(\d)_cells/, "m$1");
    if (body[short] != null) return body[short];
    if (body.modules && body.modules[short] != null) return body.modules[short];
    return null;
  }

  const module1_cells = pickCells("module1_cells");
  const module2_cells = pickCells("module2_cells");
  const module3_cells = pickCells("module3_cells");

  const db = readDB();
  const finalPackSerial =
    pack_serial && pack_serial.trim().length
      ? pack_serial.trim()
      : nextPackSerial(db);

  const cfg = readConfig();
  const enabled = cfg.modulesEnabled || { m1: true, m2: true, m3: false };
  const requiredCount =
    enabled.m1 && enabled.m2 && enabled.m3
      ? 3
      : enabled.m1 && enabled.m2
        ? 2
        : 1;

  // --- replace or add this helper near the top, replacing previous normalizeLines if you like
  function normalizeCells(input?: string | string[] | null): string[] {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map((s) => String(s).trim()).filter(Boolean);
    }
    return String(input)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // normalize provided cells (strings with newlines or arrays)
  const m1 = normalizeCells(module1_cells as any);
  const m2 = normalizeCells(module2_cells as any);
  const m3 = normalizeCells(module3_cells as any);

  const providedCount =
    (m1.length > 0 ? 1 : 0) + (m2.length > 0 ? 1 : 0) + (m3.length > 0 ? 1 : 0);
  const desiredCount = providedCount > 0 ? providedCount : requiredCount;

  if (desiredCount >= 1 && m1.length === 0)
    return res.status(400).json({ error: "Module 1 cell list is required" });
  if (desiredCount >= 2 && m2.length === 0)
    return res.status(400).json({ error: "Module 2 cell list is required" });
  if (desiredCount >= 3 && m3.length === 0)
    return res.status(400).json({ error: "Module 3 cell list is required" });

  // Check duplicates inside each module
  const dup1 = duplicatesInArray(m1);
  const dup2 = duplicatesInArray(m2);
  const dup3 = duplicatesInArray(m3);
  if (dup1.length || dup2.length || dup3.length) {
    return res.status(409).json({
      error: "Duplicate cells within module",
      module1_duplicates: dup1,
      module2_duplicates: dup2,
      module3_duplicates: dup3,
    });
  }

  // Check pack exists
  if (db.packs[finalPackSerial] && !overwrite) {
    return res.status(409).json({ error: "Pack already exists", exists: true });
  }

  // Check duplicates across DB
  const allCells = getAllCells(db);
  const conflicts: { cell: string; pack: string; module: string }[] = [];
  for (const cell of [...m1, ...m2, ...m3]) {
    const hit = allCells.get(cell);
    if (hit) conflicts.push({ cell, pack: hit.pack, module: hit.module });
  }
  if (conflicts.length) {
    return res.status(409).json({ error: "Duplicate cells in DB", conflicts });
  }

  const ids = allocateModuleIds(db, desiredCount);

  const createdAt = new Date().toISOString();

  try {
    const bundle = await generateCodes(
      code_type || "barcode",
      ids,
      finalPackSerial,
      createdAt,
    );

    const modules: Record<string, string[]> = {};
    const codes: Record<string, string> = { master: bundle.masterUrl };
    let idx = 0;
    if (m1.length > 0) {
      modules[ids[idx]] = m1;
      codes[ids[idx]] = bundle.moduleUrls[ids[idx]];
      idx++;
    }
    if (m2.length > 0) {
      modules[ids[idx]] = m2;
      codes[ids[idx]] = bundle.moduleUrls[ids[idx]];
      idx++;
    }
    if (m3.length > 0) {
      modules[ids[idx]] = m3;
      codes[ids[idx]] = bundle.moduleUrls[ids[idx]];
      idx++;
    }

    const doc: PackDoc = {
      pack_serial: finalPackSerial,
      created_at: createdAt,
      created_by: operator || null,
      modules,
      codes,
    };

    db.packs[finalPackSerial] = doc;
    writeDB(db);

    return res.json({
      ok: true,
      pack: doc,
      files: { modules: bundle.moduleUrls, master: bundle.masterUrl },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to generate codes",
      detail: String(err?.message || err),
    });
  }
};

export const listPacks: RequestHandler = (_req, res) => {
  const db = readDB();
  res.json({ packs: Object.values(db.packs) });
};

export const getPack: RequestHandler = (req, res) => {
  const id = String(req.params.id);
  const db = readDB();
  const pack = db.packs[id];
  if (!pack) return res.status(404).json({ error: "Not found" });
  res.json(pack);
};

export const updatePack: RequestHandler = (req, res) => {
  const id = String(req.params.id);
  const { modules } = req.body as { modules: Record<string, string[]> };
  const db = readDB();
  const pack = db.packs[id];
  if (!pack) return res.status(404).json({ error: "Not found" });
  pack.modules = modules;
  db.packs[id] = pack;
  writeDB(db);
  res.json({ ok: true, pack });
};

export const deletePack: RequestHandler = (req, res) => {
  const id = String(req.params.id);
  const db = readDB();
  if (!db.packs[id]) return res.status(404).json({ error: "Not found" });
  delete db.packs[id];
  writeDB(db);
  res.json({ ok: true });
};

export const getConfig: RequestHandler = (_req, res) => {
  res.json(readConfig());
};

export const updateConfig: RequestHandler = (req, res) => {
  const { model, batch, modulesEnabled, productName, variant } = req.body as {
    model?: "LFP6" | "LFP9";
    batch?: string;
    modulesEnabled?: { m1?: boolean; m2?: boolean; m3?: boolean };
    productName?: string;
    variant?: "Classic" | "Pro" | "Max";
  };
  if (batch && !/^\d{1,3}$/.test(batch))
    return res.status(400).json({ error: "batch must be 1-3 digits" });
  if (model && model !== "LFP6" && model !== "LFP9")
    return res.status(400).json({ error: "model must be LFP6 or LFP9" });

  // Read current to derive variant dynamically from modulesEnabled
  const current = readConfig();
  const nextEnabled = modulesEnabled
    ? {
        m1: !!modulesEnabled.m1,
        m2: !!modulesEnabled.m2,
        m3: !!modulesEnabled.m3,
      }
    : current.modulesEnabled;
  const autoVariant: "Classic" | "Pro" | "Max" = nextEnabled.m3
    ? "Max"
    : nextEnabled.m2
    ? "Pro"
    : "Classic";

  const cfg = writeConfig({
    model,
    batch: batch ? batch.padStart(3, "0") : undefined,
    modulesEnabled: modulesEnabled as any,
    productName,
    // Always keep variant in sync with modulesEnabled unless explicitly overridden
    variant: variant ?? autoVariant,
  });
  res.json(cfg);
};

export const nextSerialPreview: RequestHandler = (_req, res) => {
  const db = readDB();
  res.json({ next: nextPackSerial(db) });
};

export const generateMasterOnly: RequestHandler = async (req, res) => {
  const { pack_serial, code_type } = req.body as {
    pack_serial: string;
    code_type: CodeType;
  };
  if (!pack_serial)
    return res.status(400).json({ error: "pack_serial is required" });
  const db = readDB();
  const pack = db.packs[pack_serial];
  if (!pack) return res.status(404).json({ error: "Pack not found" });
  const ids = Object.keys(pack.modules);
  if (!ids.length)
    return res.status(400).json({ error: "Pack missing modules" });
  try {
    const bundle = await generateCodes(
      code_type || "barcode",
      ids,
      pack_serial,
      pack.created_at,
    );
    // update only master url
    pack.codes.master = bundle.masterUrl;
    writeDB(db);
    return res.json({ ok: true, master: bundle.masterUrl, pack });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to generate master code",
      detail: String(err?.message || err),
    });
  }
};

export const savePackOnly: RequestHandler = (req, res) => {
  const body2 = req.body as any;
  const pack_serial = body2.pack_serial as string | undefined;
  const operator = (body2.operator ?? null) as string | null;
  const overwrite = !!body2.overwrite;
  function pickCells2(key: string): string | string[] | null {
    if (body2[key] != null) return body2[key];
    if (body2.modules && body2.modules[key] != null) return body2.modules[key];
    const short = key.replace(/module(\d)_cells/, "m$1");
    if (body2[short] != null) return body2[short];
    if (body2.modules && body2.modules[short] != null)
      return body2.modules[short];
    return null;
  }
  const module1_cells = pickCells2("module1_cells");
  const module2_cells = pickCells2("module2_cells");
  const module3_cells = pickCells2("module3_cells");

  const db = readDB();
  const finalPackSerial =
    pack_serial && pack_serial.trim().length
      ? pack_serial.trim()
      : nextPackSerial(db);

  const cfg = readConfig();
  const enabled = cfg.modulesEnabled || { m1: true, m2: true, m3: false };
  const requiredCount =
    enabled.m1 && enabled.m2 && enabled.m3
      ? 3
      : enabled.m1 && enabled.m2
        ? 2
        : 1;

  // --- replace or add this helper near the top, replacing previous normalizeLines if you like
  function normalizeCells(input?: string | string[] | null): string[] {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map((s) => String(s).trim()).filter(Boolean);
    }
    return String(input)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // normalize provided cells (strings with newlines or arrays)
  const m1 = normalizeCells(module1_cells as any);
  const m2 = normalizeCells(module2_cells as any);
  const m3 = normalizeCells(module3_cells as any);

  const providedCount =
    (m1.length > 0 ? 1 : 0) + (m2.length > 0 ? 1 : 0) + (m3.length > 0 ? 1 : 0);
  const desiredCount = providedCount > 0 ? providedCount : requiredCount;

  if (desiredCount >= 1 && m1.length === 0)
    return res.status(400).json({ error: "Module 1 cell list is required" });
  if (desiredCount >= 2 && m2.length === 0)
    return res.status(400).json({ error: "Module 2 cell list is required" });
  if (desiredCount >= 3 && m3.length === 0)
    return res.status(400).json({ error: "Module 3 cell list is required" });

  // Check duplicates inside each module
  const dup1 = duplicatesInArray(m1);
  const dup2 = duplicatesInArray(m2);
  const dup3 = duplicatesInArray(m3);
  if (dup1.length || dup2.length || dup3.length) {
    return res.status(409).json({
      error: "Duplicate cells within module",
      module1_duplicates: dup1,
      module2_duplicates: dup2,
      module3_duplicates: dup3,
    });
  }

  // Check pack exists
  if (db.packs[finalPackSerial] && !overwrite) {
    return res.status(409).json({ error: "Pack already exists", exists: true });
  }

  // Check duplicates across DB
  const allCells = getAllCells(db);
  const conflicts: { cell: string; pack: string; module: string }[] = [];
  for (const cell of [...m1, ...m2, ...m3]) {
    const hit = allCells.get(cell);
    if (hit) conflicts.push({ cell, pack: hit.pack, module: hit.module });
  }
  if (conflicts.length) {
    return res.status(409).json({ error: "Duplicate cells in DB", conflicts });
  }

  const ids = allocateModuleIds(db, desiredCount);
  const createdAt = new Date().toISOString();

  const modules: Record<string, string[]> = {};
  let i = 0;
  if (m1.length > 0) modules[ids[i++]] = m1;
  if (m2.length > 0) modules[ids[i++]] = m2;
  if (m3.length > 0) modules[ids[i++]] = m3;

  const doc: PackDoc = {
    pack_serial: finalPackSerial,
    created_at: createdAt,
    created_by: operator || null,
    modules,
    codes: { master: "" },
  };

  db.packs[finalPackSerial] = doc;
  writeDB(db);

  return res.json({ ok: true, pack: doc });
};

export const regenerateCodes: RequestHandler = async (req, res) => {
  const { pack_serial, code_type } = req.body as {
    pack_serial: string;
    code_type: CodeType;
  };
  if (!pack_serial)
    return res.status(400).json({ error: "pack_serial is required" });
  const db = readDB();
  const pack = db.packs[pack_serial];
  if (!pack) return res.status(404).json({ error: "Pack not found" });
  const moduleIds = Object.keys(pack.modules);
  if (moduleIds.length < 1)
    return res.status(400).json({ error: "Pack missing modules" });
  try {
    const bundle = await generateCodes(
      code_type || "barcode",
      moduleIds,
      pack_serial,
      pack.created_at,
    );
    const codes: Record<string, string> = { master: bundle.masterUrl };
    for (const id of moduleIds) codes[id] = bundle.moduleUrls[id];
    pack.codes = codes;
    writeDB(db);
    return res.json({
      ok: true,
      pack,
      files: { modules: bundle.moduleUrls, master: bundle.masterUrl },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to regenerate codes",
      detail: String(err?.message || err),
    });
  }
};

// Param variants to avoid JSON body parsing issues in some environments
export const regenerateCodesParam: RequestHandler = async (req, res) => {
  const pack_serial = String(req.params.id || "").trim();
  const type = String(req.params.type || "barcode").toLowerCase() as CodeType;
  if (!pack_serial)
    return res.status(400).json({ error: "pack_serial is required" });
  const db = readDB();
  const pack = db.packs[pack_serial];
  if (!pack) return res.status(404).json({ error: "Pack not found" });
  const moduleIds = Object.keys(pack.modules);
  if (moduleIds.length < 1)
    return res.status(400).json({ error: "Pack missing modules" });
  try {
    const bundle = await generateCodes(
      type || "barcode",
      moduleIds,
      pack_serial,
      pack.created_at,
    );
    const codes: Record<string, string> = { master: bundle.masterUrl };
    for (const id of moduleIds) codes[id] = bundle.moduleUrls[id];
    pack.codes = codes;
    writeDB(db);
    return res.json({
      ok: true,
      pack,
      files: { modules: bundle.moduleUrls, master: bundle.masterUrl },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to regenerate codes",
      detail: String(err?.message || err),
    });
  }
};

export const generateMasterOnlyParam: RequestHandler = async (req, res) => {
  const pack_serial = String(req.params.id || "").trim();
  const type = String(req.params.type || "barcode").toLowerCase() as CodeType;
  if (!pack_serial)
    return res.status(400).json({ error: "pack_serial is required" });
  const db = readDB();
  const pack = db.packs[pack_serial];
  if (!pack) return res.status(404).json({ error: "Pack not found" });
  const ids = Object.keys(pack.modules);
  if (!ids.length)
    return res.status(400).json({ error: "Pack missing modules" });
  try {
    const bundle = await generateCodes(
      type || "barcode",
      ids,
      pack_serial,
      pack.created_at,
    );
    pack.codes.master = bundle.masterUrl;
    writeDB(db);
    return res.json({ ok: true, master: bundle.masterUrl, pack });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to generate master code",
      detail: String(err?.message || err),
    });
  }
};

export const getDB: RequestHandler = (_req, res) => {
  const db = readDB();
  res.json(db);
};

export const uploadDB: RequestHandler = (req, res) => {
  const data = req.body as BatteryDB;
  if (!data || typeof data !== "object" || !data.packs) {
    return res.status(400).json({ error: "Invalid DB payload" });
  }
  writeDB(data);
  res.json({ ok: true });
};

export const search: RequestHandler = (req, res) => {
  const q = String(req.query.q || "").trim();
  const db = readDB();
  if (!q) return res.json({ result: null });
  // If pack id
  if (db.packs[q]) return res.json({ type: "pack", pack: db.packs[q] });
  // Search module id
  for (const [pid, pack] of Object.entries(db.packs)) {
    if (Object.prototype.hasOwnProperty.call(pack.modules, q)) {
      return res.json({ type: "module", moduleId: q, packId: pid, pack });
    }
  }
  // Search cell
  for (const [pid, pack] of Object.entries(db.packs)) {
    for (const [mid, cells] of Object.entries(pack.modules)) {
      if (cells.includes(q))
        return res.json({
          type: "cell",
          cell: q,
          packId: pid,
          moduleId: mid,
          pack,
        });
    }
  }
  res.json({ result: null });
};

function duplicatesInArray(arr: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const a of arr) {
    if (seen.has(a)) dup.add(a);
    else seen.add(a);
  }
  return Array.from(dup);
}
