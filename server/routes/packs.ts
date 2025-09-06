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

function nextModuleIds(
  db: BatteryDB,
  packSerial: string,
): { module1Id: string; module2Id: string } {
  const match = packSerial.match(/^(\D*)(\d+)$/);
  const used = getAllModuleIds(db);
  if (!match) {
    // Fallback: use packSerial-1 and packSerial-2 if no numeric suffix
    let i = 1;
    let m1 = `${packSerial}-${i}`;
    while (used.has(m1)) {
      i++;
      m1 = `${packSerial}-${i}`;
    }
    i++;
    let m2 = `${packSerial}-${i}`;
    while (used.has(m2)) {
      i++;
      m2 = `${packSerial}-${i}`;
    }
    return { module1Id: m1, module2Id: m2 };
  }
  const prefix = match[1];
  const digits = match[2];
  const pad = digits.length;
  let n = parseInt(digits, 10);
  // module1 starts at n, module2 >= n+1, skipping used
  let m1 = `${prefix}${String(n).padStart(pad, "0")}`;
  while (used.has(m1)) {
    n++;
    m1 = `${prefix}${String(n).padStart(pad, "0")}`;
  }
  n++;
  let m2 = `${prefix}${String(n).padStart(pad, "0")}`;
  while (used.has(m2)) {
    n++;
    m2 = `${prefix}${String(n).padStart(pad, "0")}`;
  }
  return { module1Id: m1, module2Id: m2 };
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
  const next = (maxUnit + 1) || 1;
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
  const finalPackSerial = pack_serial && pack_serial.trim().length ? pack_serial.trim() : nextPackSerial(db);

  const m1 = normalizeLines(module1_cells || "");
  const m2 = normalizeLines(module2_cells || "");
  if (m1.length === 0 || m2.length === 0) {
    return res.status(400).json({ error: "Both module cell lists are required" });
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

  try {
    const files = await generateCodes(
      code_type || "barcode",
      module1Id,
      module2Id,
      finalPackSerial,
    );

    const doc: PackDoc = {
      pack_serial: finalPackSerial,
      created_at: new Date().toISOString(),
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
    return res.status(500).json({ error: "Failed to generate codes", detail: String(err?.message || err) });
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
    );
    // update only master url
    pack.codes.master = files.masterUrl;
    writeDB(db);
    return res.json({ ok: true, master: files.masterUrl, pack });
  } catch (err: any) {
    return res
      .status(500)
      .json({
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
