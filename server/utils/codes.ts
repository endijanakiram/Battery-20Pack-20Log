import fs from "fs";
import path from "path";
import bwipjs from "bwip-js";
import { CODES_DIR } from "./db";

export type CodeType = "barcode" | "qr";

// Printing spec @ 203 DPI
const QR_SIDE_PX = 197; // 25 mm square ≈ 197 px @ 203 dpi (as requested)
const BARCODE_W_PX = 315; // 40 mm wide
const BARCODE_H_PX = 118; // 15 mm tall

function outputPath(filename: string) {
  return path.join(CODES_DIR, filename);
}

export interface GeneratedFiles {
  module1Path: string; // absolute path
  module2Path: string;
  masterPath: string;
  module1Url: string; // public URL path under /files
  module2Url: string;
  masterUrl: string;
}

async function generateBarcodePng(
  payload: string,
  humanText: string,
): Promise<Buffer> {
  // 40×15 mm canvas at 203 DPI with margins, include human-readable text
  const margin = 6;
  const width = BARCODE_W_PX - margin * 2;
  const height = BARCODE_H_PX - margin * 2;
  return await bwipjs.toBuffer({
    bcid: "code128",
    text: payload,
    scale: 3,
    includetext: true,
    textxalign: "center",
    alttext: humanText,
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
  // Generate 25 mm square QR @ 203 DPI
  const side = QR_SIDE_PX;
  const margin = 4;
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
  module1Id: string,
  module2Id: string,
  packId: string,
  createdAtISO: string,
): Promise<GeneratedFiles> {
  const dateOnly = toDateOnly(createdAtISO);

  // Payloads must contain only the serial number and the creation date
  const m1Payload = `${module1Id}|${dateOnly}`;
  const m2Payload = `${module2Id}|${dateOnly}`;
  const masterPayload = `${packId}|${dateOnly}`;

  const m1Human = `${module1Id} ${dateOnly}`;
  const m2Human = `${module2Id} ${dateOnly}`;
  const masterHuman = `${packId} ${dateOnly}`;

  let m1Name: string;
  let m2Name: string;
  let masterName: string;
  let m1Buf: Buffer;
  let m2Buf: Buffer;
  let masterBuf: Buffer;

  if (codeType === "barcode") {
    m1Name = `${module1Id}_BARCODE_40x15mm_203dpi.png`;
    m2Name = `${module2Id}_BARCODE_40x15mm_203dpi.png`;
    masterName = `${packId}_MASTER_BARCODE_40x15mm_203dpi.png`;
    m1Buf = await generateBarcodePng(m1Payload, m1Human);
    m2Buf = await generateBarcodePng(m2Payload, m2Human);
    masterBuf = await generateBarcodePng(masterPayload, masterHuman);
  } else {
    m1Name = `${module1Id}_QR_25mm_203dpi.png`;
    m2Name = `${module2Id}_QR_25mm_203dpi.png`;
    masterName = `${packId}_MASTER_QR_25mm_203dpi.png`;
    m1Buf = await generateQrPng(m1Payload, m1Human);
    m2Buf = await generateQrPng(m2Payload, m2Human);
    masterBuf = await generateQrPng(masterPayload, masterHuman);
  }

  // Write files
  fs.writeFileSync(outputPath(m1Name), m1Buf);
  fs.writeFileSync(outputPath(m2Name), m2Buf);
  fs.writeFileSync(outputPath(masterName), masterBuf);

  return {
    module1Path: outputPath(m1Name),
    module2Path: outputPath(m2Name),
    masterPath: outputPath(masterName),
    module1Url: `/files/codes/${m1Name}`,
    module2Url: `/files/codes/${m2Name}`,
    masterUrl: `/files/codes/${masterName}`,
  };
}
