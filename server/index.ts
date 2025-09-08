import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import * as Sentry from "@sentry/node";
import { ensureDataDirs, DATA_DIR } from "./utils/db";
import {
  generatePack,
  generateMasterOnly,
  getDB,
  search,
} from "./routes/packs";

export function createServer() {
  const app = express();

  // Sentry init (no-op if DSN missing)
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.2 });
    app.use(Sentry.Handlers.requestHandler());
  }

  // Prepare data directories
  ensureDataDirs();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Static files for generated codes (dev) and API served path for prod
  app.use("/files", express.static(path.join(DATA_DIR)));
  app.use("/api/files", express.static(path.join(DATA_DIR)));

  // Health/demo
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  // Battery pack APIs
  app.post("/api/packs/generate", generatePack);

  app.post("/api/packs/master-only", generateMasterOnly);

  app.post("/api/packs/save-only", (req, res, next) =>
    import("./routes/packs").then((m) => m.savePackOnly(req, res, next)),
  );

  app.post("/api/packs/regenerate", (req, res, next) =>
    import("./routes/packs").then((m) => m.regenerateCodes(req, res, next)),
  );
  app.get("/api/packs", (req, res, next) =>
    import("./routes/packs").then((m) => m.listPacks(req, res, next)),
  );
  app.get("/api/packs/:id", (req, res, next) =>
    import("./routes/packs").then((m) => m.getPack(req, res, next)),
  );
  app.put("/api/packs/:id", (req, res, next) =>
    import("./routes/packs").then((m) => m.updatePack(req, res, next)),
  );
  app.delete("/api/packs/:id", (req, res, next) =>
    import("./routes/packs").then((m) => m.deletePack(req, res, next)),
  );
  app.get("/api/db", getDB);
  app.get("/api/search", search);

  // Config endpoints
  app.get("/api/config", (req, res, next) =>
    import("./routes/packs").then((m) => m.getConfig(req, res, next)),
  );
  app.put("/api/config", (req, res, next) =>
    import("./routes/packs").then((m) => m.updateConfig(req, res, next)),
  );
  app.get("/api/next-pack-serial", (req, res, next) =>
    import("./routes/packs").then((m) => m.nextSerialPreview(req, res, next)),
  );

  // Sentry error handler after routes
  if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
  }

  return app;
}
