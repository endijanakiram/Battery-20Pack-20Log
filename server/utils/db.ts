import fs from "fs";
import path from "path";
import { getSupabase, ensureBucket } from "./supabase";

const IS_NETLIFY = !!(
  process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
);
const BASE_DIR = IS_NETLIFY
  ? path.join("/tmp", "battery-data")
  : path.join(process.cwd(), "server", "data");
export const DATA_DIR = BASE_DIR;
export const CODES_DIR = path.join(DATA_DIR, "codes");
export const DB_PATH = path.join(DATA_DIR, "battery_db.json");
const DB_BUCKET = "db";
const DB_OBJECT = "battery_db.json";

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
  productName: string; // e.g., NX100
  variant: "Classic" | "Pro" | "Max";
}

export interface BatteryDB {
  packs: Record<string, PackDoc>;
  config: Config;
}

export function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CODES_DIR)) fs.mkdirSync(CODES_DIR, { recursive: true });
  // If Supabase is configured, ensure storage buckets
  ensureBucket("codes", true).catch(() => {});
  ensureBucket(DB_BUCKET, false).catch(() => {});
}

export function readDB(): BatteryDB {
  ensureDataDirs();
  const defaultCfg: Config = {
    model: "LFP9",
    batch: "001",
    modulesEnabled: { m1: true, m2: true, m3: false },
    productName: "NX100",
    variant: "Pro",
  };

  const s = getSupabase();
  if (s) {
    return (function supabaseRead(): BatteryDB {
      // Synchronous facade: we can't block here, so use deopt with sync/await via deasync not available.
      // Instead, read from local cache if exists; else create remote default and return default for now.
      // To keep consistency, try to fetch using async promise with then/catch but return fallback immediately.
      // For our environment, most routes are async and will call writeDB before relying on contents.
      try {
        // Attempt to read synchronously from a cached copy; if missing, trigger async fetch to refresh cache.
        if (fs.existsSync(DB_PATH)) {
          const rawCache = fs.readFileSync(DB_PATH, "utf8");
          const parsed = JSON.parse(rawCache) as BatteryDB;
          // Fire-and-forget remote refresh
          s.storage
            .from(DB_BUCKET)
            .download(DB_OBJECT)
            .then(async (resp) => {
              if (resp.data) {
                const buf = await resp.data.arrayBuffer();
                const txt = Buffer.from(buf).toString("utf8");
                fs.writeFileSync(DB_PATH, txt);
              } else {
                const empty: BatteryDB = { packs: {}, config: defaultCfg };
                await s.storage
                  .from(DB_BUCKET)
                  .upload(DB_OBJECT, JSON.stringify(empty, null, 2), {
                    contentType: "application/json",
                    upsert: true,
                  });
              }
            })
            .catch(() => {});
          return parsed;
        } else {
          // No cache: try remote download synchronously-ish by blocking with Atomics not possible; fallback to default and kick off init
          s.storage
            .from(DB_BUCKET)
            .download(DB_OBJECT)
            .then(async (resp) => {
              if (resp.data) {
                const buf = await resp.data.arrayBuffer();
                const txt = Buffer.from(buf).toString("utf8");
                fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
                fs.writeFileSync(DB_PATH, txt);
              } else {
                const empty: BatteryDB = { packs: {}, config: defaultCfg };
                await s.storage
                  .from(DB_BUCKET)
                  .upload(DB_OBJECT, JSON.stringify(empty, null, 2), {
                    contentType: "application/json",
                    upsert: true,
                  });
                fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
                fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
              }
            })
            .catch(() => {});
          return { packs: {}, config: defaultCfg };
        }
      } catch {
        return { packs: {}, config: defaultCfg };
      }
    })();
  }

  // Filesystem fallback
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
    if (!(parsed.config as any).productName) {
      (parsed.config as any).productName = "NX100";
    }
    if (!(parsed.config as any).variant) {
      (parsed.config as any).variant = "Pro";
    }
    return parsed;
  } catch {
    return { packs: {}, config: defaultCfg };
  }
}

export function writeDB(db: BatteryDB) {
  ensureDataDirs();
  const payload = JSON.stringify(db, null, 2);
  fs.writeFileSync(DB_PATH, payload);
  const s = getSupabase();
  if (s) {
    s.storage
      .from(DB_BUCKET)
      .upload(DB_OBJECT, payload, {
        contentType: "application/json",
        upsert: true,
      })
      .catch(() => {});
  }
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
  if (!(db.config as any).productName) {
    (db.config as any).productName = "NX100";
  }
  if (!(db.config as any).variant) {
    (db.config as any).variant = "Pro";
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
