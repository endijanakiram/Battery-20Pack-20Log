import fs from "fs";
import path from "path";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import { CODES_DIR } from "./db";

export type CodeType = "barcode" | "qr";

const DPI = 240; // New spec
const MM_W = 50;
const MM_H = 25;
const WIDTH_PX = Math.round((MM_W / 25.4) * DPI); // ~472
const HEIGHT_PX = Math.round((MM_H / 25.4) * DPI); // ~236

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
  // 50x25mm canvas at 240 DPI with margins, includetext under code
  const margin = 8;
  const width = WIDTH_PX - margin * 2;
  const height = HEIGHT_PX - margin * 2;
  return await bwipjs.toBuffer({
    bcid: "code128",
    text: payload,
    scale: 3, // scale up for clarity, bwip will fit to width/height
    includetext: true,
    textxalign: "center",
    text: humanText,
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
  // Use bwip-js qrcode to conform to exact canvas size (centered in 50x25mm)
  const margin = 8;
  const width = WIDTH_PX - margin * 2;
  const height = HEIGHT_PX - margin * 2;
  return await bwipjs.toBuffer({
    bcid: "qrcode",
    text: payload,
    eclevel: "M",
    scale: 3,
    backgroundcolor: "FFFFFF",
    paddingwidth: margin,
    paddingheight: margin,
    width,
    height,
  } as any);
}

export async function generateCodes(
  codeType: CodeType,
  module1Id: string,
  module2Id: string,
  packId: string,
): Promise<GeneratedFiles> {
  const m1Payload = `M:${module1Id}`;
  const m2Payload = `M:${module2Id}`;
  const masterPayload = `P:${packId}|MS:${module1Id},${module2Id}`;

  const m1Name = `${module1Id}_code_25x50mm_240dpi.png`;
  const m2Name = `${module2Id}_code_25x50mm_240dpi.png`;
  const masterName = `${packId}_MASTER_code_25x50mm_240dpi.png`;

  let m1Buf: Buffer;
  let m2Buf: Buffer;
  let masterBuf: Buffer;

  if (codeType === "barcode") {
    m1Buf = await generateBarcodePng(m1Payload, module1Id);
    m2Buf = await generateBarcodePng(m2Payload, module2Id);
    masterBuf = await generateBarcodePng(masterPayload, packId);
  } else {
    // QR with compact JSON payloads per spec
    const m1QR = JSON.stringify({ t: "m", m: module1Id });
    const masterQR = JSON.stringify({
      t: "p",
      p: packId,
      ms: [module1Id, module2Id],
    });
    m1Buf = await generateQrPng(m1QR, module1Id);
    m2Buf = await generateQrPng(
      JSON.stringify({ t: "m", m: module2Id }),
      module2Id,
    );
    masterBuf = await generateQrPng(masterQR, packId);
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
