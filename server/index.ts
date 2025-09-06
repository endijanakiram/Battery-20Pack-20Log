import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { handleDemo } from "./routes/demo";
import { ensureDataDirs, DATA_DIR } from "./utils/db";
import {
  generatePack,
  generateMasterOnly,
  getDB,
  uploadDB,
  search,
} from "./routes/packs";

export function createServer() {
  const app = express();

  // Prepare data directories
  ensureDataDirs();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Static files for generated codes
  app.use("/files", express.static(path.join(DATA_DIR)));

  // Health/demo
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });
  app.get("/api/demo", handleDemo);

  // Battery pack APIs
  app.post("/api/packs/generate", generatePack);
  app.post("/api/packs/master-only", generateMasterOnly);
  app.get("/api/packs", (req, res) =>
    import("./routes/packs").then((m) => m.listPacks(req, res)),
  );
  app.get("/api/packs/:id", (req, res) =>
    import("./routes/packs").then((m) => m.getPack(req, res)),
  );
  app.put("/api/packs/:id", (req, res) =>
    import("./routes/packs").then((m) => m.updatePack(req, res)),
  );
  app.delete("/api/packs/:id", (req, res) =>
    import("./routes/packs").then((m) => m.deletePack(req, res)),
  );
  app.get("/api/db", getDB);
  app.post("/api/db", uploadDB);
  app.get("/api/search", search);

  // Config endpoints
  app.get("/api/config", (req, res) =>
    import("./routes/packs").then((m) => m.getConfig(req, res)),
  );
  app.put("/api/config", (req, res) =>
    import("./routes/packs").then((m) => m.updateConfig(req, res)),
  );
  app.get("/api/next-pack-serial", (req, res) =>
    import("./routes/packs").then((m) => m.nextSerialPreview(req, res)),
  );

  return app;
}
