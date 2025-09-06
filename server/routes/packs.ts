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
  const {
    pack_serial,
    module1_cells,
    module2_cells,
    code_type,
    operator,
    overwrite,
  } = req.body as {
    pack_serial?: string;
    module1_cells: string;
    module2_cells: string;
    code_type: CodeType;
    operator?: string | null;
    overwrite?: boolean;
  };

  const db = readDB();
  const finalPackSerial =
    pack_serial && pack_serial.trim().length
      ? pack_serial.trim()
      : nextPackSerial(db);

  const m1 = normalizeLines(module1_cells || "");
  const m2 = normalizeLines(module2_cells || "");
  if (m1.length === 0 || m2.length === 0) {
    return res
      .status(400)
      .json({ error: "Both module cell lists are required" });
  }

  // Check duplicates inside each module
  const dup1 = duplicatesInArray(m1);
  const dup2 = duplicatesInArray(m2);
  if (dup1.length || dup2.length) {
    return res.status(409).json({
      error: "Duplicate cells within module",
      module1_duplicates: dup1,
      module2_duplicates: dup2,
    });
  }

  // Check pack exists
  if (db.packs[finalPackSerial] && !overwrite) {
    return res.status(409).json({ error: "Pack already exists", exists: true });
  }

  // Check duplicates across DB
  const allCells = getAllCells(db);
  const conflicts: { cell: string; pack: string; module: string }[] = [];
  for (const cell of [...m1, ...m2]) {
    const hit = allCells.get(cell);
    if (hit) conflicts.push({ cell, pack: hit.pack, module: hit.module });
  }
  if (conflicts.length) {
    return res.status(409).json({ error: "Duplicate cells in DB", conflicts });
  }

  const { module1Id, module2Id } = nextModuleIds(db, finalPackSerial);

  const createdAt = new Date().toISOString();

  try {
    const files = await generateCodes(
      code_type || "barcode",
      module1Id,
      module2Id,
      finalPackSerial,
      createdAt,
    );

    const doc: PackDoc = {
      pack_serial: finalPackSerial,
      created_at: createdAt,
      created_by: operator || null,
      modules: {
        [module1Id]: m1,
        [module2Id]: m2,
      },
      codes: {
        module1: files.module1Url,
        module2: files.module2Url,
        master: files.masterUrl,
      },
    };

    db.packs[finalPackSerial] = doc;
    writeDB(db);

    return res.json({
      ok: true,
      pack: doc,
      files: {
        module1: files.module1Url,
        module2: files.module2Url,
        master: files.masterUrl,
      },
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({
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
  const { model, batch } = req.body as {
    model?: "LFP6" | "LFP9";
    batch?: string;
  };
  if (batch && !/^\d{1,3}$/.test(batch))
    return res.status(400).json({ error: "batch must be 1-3 digits" });
  if (model && model !== "LFP6" && model !== "LFP9")
    return res.status(400).json({ error: "model must be LFP6 or LFP9" });
  const cfg = writeConfig({
    model,
    batch: batch ? batch.padStart(3, "0") : undefined,
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
  const [m1, m2] = Object.keys(pack.modules);
  if (!m1 || !m2)
    return res.status(400).json({ error: "Pack missing modules" });
  try {
    const files = await generateCodes(
      code_type || "barcode",
      m1,
      m2,
      pack_serial,
      pack.created_at,
    );
    // update only master url
    pack.codes.master = files.masterUrl;
    writeDB(db);
    return res.json({ ok: true, master: files.masterUrl, pack });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to generate master code",
      detail: String(err?.message || err),
    });
  }
};

export const savePackOnly: RequestHandler = (req, res) => {
  const {
    pack_serial,
    module1_cells,
    module2_cells,
    operator,
    overwrite,
  } = req.body as {
    pack_serial?: string;
    module1_cells: string;
    module2_cells: string;
    operator?: string | null;
    overwrite?: boolean;
  };

  const db = readDB();
  const finalPackSerial =
    pack_serial && pack_serial.trim().length
      ? pack_serial.trim()
      : nextPackSerial(db);

  const m1 = normalizeLines(module1_cells || "");
  const m2 = normalizeLines(module2_cells || "");
  if (m1.length === 0 || m2.length === 0) {
    return res
      .status(400)
      .json({ error: "Both module cell lists are required" });
  }

  // Check duplicates inside each module
  const dup1 = duplicatesInArray(m1);
  const dup2 = duplicatesInArray(m2);
  if (dup1.length || dup2.length) {
    return res.status(409).json({
      error: "Duplicate cells within module",
      module1_duplicates: dup1,
      module2_duplicates: dup2,
    });
  }

  // Check pack exists
  if (db.packs[finalPackSerial] && !overwrite) {
    return res.status(409).json({ error: "Pack already exists", exists: true });
  }

  // Check duplicates across DB
  const allCells = getAllCells(db);
  const conflicts: { cell: string; pack: string; module: string }[] = [];
  for (const cell of [...m1, ...m2]) {
    const hit = allCells.get(cell);
    if (hit) conflicts.push({ cell, pack: hit.pack, module: hit.module });
  }
  if (conflicts.length) {
    return res.status(409).json({ error: "Duplicate cells in DB", conflicts });
  }

  const { module1Id, module2Id } = nextModuleIds(db, finalPackSerial);
  const createdAt = new Date().toISOString();

  const doc: PackDoc = {
    pack_serial: finalPackSerial,
    created_at: createdAt,
    created_by: operator || null,
    modules: {
      [module1Id]: m1,
      [module2Id]: m2,
    },
    codes: { module1: "", module2: "", master: "" },
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
  if (moduleIds.length < 2)
    return res.status(400).json({ error: "Pack missing modules" });
  const [m1, m2] = moduleIds;
  try {
    const files = await generateCodes(
      code_type || "barcode",
      m1,
      m2,
      pack_serial,
      pack.created_at,
    );
    pack.codes = {
      module1: files.module1Url,
      module2: files.module2Url,
      master: files.masterUrl,
    };
    writeDB(db);
    return res.json({ ok: true, pack, files: pack.codes });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to regenerate codes",
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
