import fs from "fs";
import path from "path";
import bwipjs from "bwip-js";
import { CODES_DIR } from "./db";

export type CodeType = "barcode" | "qr";

// Printing spec @ 203 DPI
const STICKER_W_PX = 394; // 50 mm width
const STICKER_H_PX = 197; // 25 mm height
const QR_SIDE_PX = 157; // 20 mm square ≈ 157 px @ 203 dpi
const BARCODE_W_PX = 315; // 40 mm wide
const BARCODE_H_PX = 118; // 15 mm tall

function outputPath(filename: string) {
  return path.join(CODES_DIR, filename);
}

export interface GeneratedBundle {
  moduleUrls: Record<string, string>; // key: moduleId, value: public url
  masterUrl: string;
}

async function generateBarcodePng(
  payload: string,
  humanText: string,
): Promise<Buffer> {
  const margin = 8; // ≥1mm margin @203dpi
  const width = BARCODE_W_PX - margin * 2;
  const height = BARCODE_H_PX - margin * 2;
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

  // Write files
  const moduleUrls: Record<string, string> = {};
  for (const m of moduleBuffers) {
    fs.writeFileSync(outputPath(m.name), m.buf);
    moduleUrls[m.id] = `/files/codes/${m.name}`;
  }
  fs.writeFileSync(outputPath(masterName), masterBuf);

  return { moduleUrls, masterUrl: `/files/codes/${masterName}` };
}
