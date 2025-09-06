import fs from "fs";
import path from "path";

export const DATA_DIR = path.join(process.cwd(), "server", "data");
export const CODES_DIR = path.join(DATA_DIR, "codes");
export const DB_PATH = path.join(DATA_DIR, "battery_db.json");

export interface PackDoc {
  pack_serial: string;
  created_at: string;
  created_by: string | null;
  modules: Record<string, string[]>; // module_id -> cells
  codes: Record<string, string>; // keys: module1, module2, optional module3, master
}

export interface Config {
  model: "LFP6" | "LFP9";
  batch: string; // 3-digit string
  modulesEnabled: { m1: boolean; m2: boolean; m3: boolean };
}

export interface BatteryDB {
  packs: Record<string, PackDoc>;
  config: Config;
}

export function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CODES_DIR)) fs.mkdirSync(CODES_DIR, { recursive: true });
}

export function readDB(): BatteryDB {
  ensureDataDirs();
  const defaultCfg: Config = { model: "LFP9", batch: "001", modulesEnabled: { m1: true, m2: true, m3: false } };
  if (!fs.existsSync(DB_PATH)) {
    const empty: BatteryDB = { packs: {}, config: defaultCfg };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as BatteryDB;
    if (!parsed.packs) parsed.packs = {} as any;
    if (!parsed.config) parsed.config = defaultCfg;
    if (!(parsed.config as any).modulesEnabled) {
      (parsed.config as any).modulesEnabled = { m1: true, m2: true, m3: false };
    }
    return parsed;
  } catch {
    return { packs: {}, config: defaultCfg };
  }
}

export function writeDB(db: BatteryDB) {
  ensureDataDirs();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function readConfig() {
  const db = readDB();
  return db.config;
}

export function writeConfig(partial: Partial<Config>) {
  const db = readDB();
  db.config = { ...db.config, ...partial } as Config;
  if (!(db.config as any).modulesEnabled) {
    (db.config as any).modulesEnabled = { m1: true, m2: true, m3: false };
  }
  writeDB(db);
  return db.config;
}

export function getAllModuleIds(db: BatteryDB): Set<string> {
  const set = new Set<string>();
  for (const pack of Object.values(db.packs)) {
    for (const mid of Object.keys(pack.modules)) set.add(mid);
  }
  return set;
}

export function getAllCells(
  db: BatteryDB,
): Map<string, { pack: string; module: string }> {
  const map = new Map<string, { pack: string; module: string }>();
  for (const [packId, pack] of Object.entries(db.packs)) {
    for (const [mid, cells] of Object.entries(pack.modules)) {
      for (const cell of cells) {
        if (!map.has(cell)) map.set(cell, { pack: packId, module: mid });
      }
    }
  }
  return map;
}
