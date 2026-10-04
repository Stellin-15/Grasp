#!/usr/bin/env node
import { createServer } from "./server.js";
import { loadConfig } from "@/config";

const config = loadConfig(process.env);
const app = createServer(config);

app.listen(config.port, () => {
  console.log(`listening on ${config.port}`);
});
