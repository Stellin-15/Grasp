import express, { type Request, type Response } from "express";
import type { AppConfig } from "./config.js";
import { TokenService } from "./auth/token.js";
import * as math from "./utils/index.js";
import { clamp } from "@/utils";

/**
 * Builds the HTTP app. Routes are registered here so tests can create a server
 * without binding a port.
 */
export function createServer(config: AppConfig) {
  const app = express();
  const tokens = new TokenService(config.jwtSecret);

  app.get("/sum", (req: Request, res: Response) => {
    const a = Number(req.query.a);
    const b = Number(req.query.b);
    res.json({ result: clamp(math.add(a, b), 0, 1000) });
  });

  app.post("/login", (req: Request, res: Response) => {
    if (!tokens.verify(String(req.headers.authorization))) {
      res.status(401).end();
      return;
    }
    res.json({ token: tokens.issue("user") });
  });

  return app;
}
