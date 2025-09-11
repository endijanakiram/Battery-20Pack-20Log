import fs from "fs";
import path from "path";
import bwipjs from "bwip-js";
import { CODES_DIR } from "./db";
import { getSupabase, ensureBucket } from "./supabase";

export type CodeType = "barcode" | "qr";

// Printing spec @ 203 DPI
const STICKER_W_PX = 394; // 50 mm width
const STICKER_H_PX = 197; // 25 mm height
const QR_SIDE_PX = 157; // 20 mm square ≈ 157 px @ 203 dpi
const BARCODE_W_PX = 315; // 40 mm wide
const BARCODE_H_PX = 71; // 9 mm tall (40% less)

function outputPath(filename: string) {
  return path.join(CODES_DIR, filename);
}

export interface GeneratedBundle {
  moduleUrls: Record<string, string>; // key: moduleId, value: public url
  masterUrl: string;
}

const USE_REMOTE =
  !!process.env.NETLIFY || process.env.CODES_USE_REMOTE === "1";

async function generateBarcodePng(
  payload: string,
  humanText: string,
): Promise<Buffer> {
  const margin = 8; // ≥1mm margin @203dpi
  const width = BARCODE_W_PX - margin * 2;
  const height = BARCODE_H_PX - margin * 2;
  if (USE_REMOTE) {
    const u = new URL("https://bwipjs-api.metafloor.com/");
    u.searchParams.set("bcid", "code128");
    u.searchParams.set("text", payload);
    u.searchParams.set("scale", "3");
    u.searchParams.set("includetext", "true");
    u.searchParams.set("textxalign", "center");
    u.searchParams.set("alttext", humanText);
    u.searchParams.set("textsize", "18");
    u.searchParams.set("backgroundcolor", "FFFFFF");
    u.searchParams.set("paddingwidth", String(margin));
    u.searchParams.set("paddingheight", String(margin));
    u.searchParams.set("width", String(width));
    u.searchParams.set("height", String(height));
    const resp = await fetch(u.toString());
    const ab = await resp.arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  }
  return await bwipjs.toBuffer({
    bcid: "code128",
    text: payload,
    scale: 3,
    includetext: true,
    textxalign: "center",
    alttext: humanText,
    textsize: 18,
    backgroundcolor: "FFFFFF",
    paddingwidth: margin,
    paddingheight: margin,
    width,
    height,
  } as any);
}

async function generateQrPng(
  payload: string,
  _humanText: string,
): Promise<Buffer> {
  const side = QR_SIDE_PX;
  const margin = 8; // ≥1mm margin @203dpi
  if (USE_REMOTE) {
    const u = new URL("https://bwipjs-api.metafloor.com/");
    u.searchParams.set("bcid", "qrcode");
    u.searchParams.set("text", payload);
    u.searchParams.set("eclevel", "M");
    u.searchParams.set("scale", "3");
    u.searchParams.set("backgroundcolor", "FFFFFF");
    u.searchParams.set("paddingwidth", String(margin));
    u.searchParams.set("paddingheight", String(margin));
    u.searchParams.set("width", String(side - margin * 2));
    u.searchParams.set("height", String(side - margin * 2));
    const resp = await fetch(u.toString());
    const ab = await resp.arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  }
  return await bwipjs.toBuffer({
    bcid: "qrcode",
    text: payload,
    eclevel: "M",
    scale: 3,
    backgroundcolor: "FFFFFF",
    paddingwidth: margin,
    paddingheight: margin,
    width: side - margin * 2,
    height: side - margin * 2,
  } as any);
}

function toDateOnly(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function generateCodes(
  codeType: CodeType,
  moduleIds: string[],
  packId: string,
  createdAtISO: string,
): Promise<GeneratedBundle> {
  const dateOnly = toDateOnly(createdAtISO);

  const masterPayload = `${packId}|${dateOnly}`;
  const masterHuman = `${packId} ${dateOnly}`;

  const moduleBuffers: Array<{ id: string; name: string; buf: Buffer }> = [];

  for (const moduleId of moduleIds) {
    const payload = `${moduleId}|${dateOnly}`;
    const human = `${moduleId} ${dateOnly}`;
    const name =
      codeType === "barcode"
        ? `${moduleId}_BARCODE_40x15mm_203dpi.png`
        : `${moduleId}_QR_20mm_203dpi.png`;
    const buf =
      codeType === "barcode"
        ? await generateBarcodePng(payload, human)
        : await generateQrPng(payload, human);
    moduleBuffers.push({ id: moduleId, name, buf });
  }

  const masterName =
    codeType === "barcode"
      ? `${packId}_MASTER_BARCODE_40x15mm_203dpi.png`
      : `${packId}_MASTER_QR_20mm_203dpi.png`;
  const masterBuf =
    codeType === "barcode"
      ? await generateBarcodePng(masterPayload, masterHuman)
      : await generateQrPng(masterPayload, masterHuman);

  // Write files (Supabase if configured, else filesystem)
  const s = getSupabase();
  const moduleUrls: Record<string, string> = {};
  if (s) {
    await ensureBucket("codes", true);
    for (const m of moduleBuffers) {
      await s.storage
        .from("codes")
        .upload(m.name, m.buf, { contentType: "image/png", upsert: true });
      const { data } = s.storage.from("codes").getPublicUrl(m.name);
      moduleUrls[m.id] = data.publicUrl;
    }
    await s.storage.from("codes").upload(masterName, masterBuf, {
      contentType: "image/png",
      upsert: true,
    });
    const { data: masterPub } = s.storage
      .from("codes")
      .getPublicUrl(masterName);
    return { moduleUrls, masterUrl: masterPub.publicUrl };
  }

  for (const m of moduleBuffers) {
    fs.writeFileSync(outputPath(m.name), m.buf);
    moduleUrls[m.id] = `/api/files/codes/${m.name}`;
  }
  fs.writeFileSync(outputPath(masterName), masterBuf);

  return { moduleUrls, masterUrl: `/api/files/codes/${masterName}` };
}
