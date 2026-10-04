import type { LanguagePack } from "@grasp/core";
import { javascriptPack } from "./javascript.js";
import { pythonPack } from "./python.js";

export { javascriptPack, extractJavaScript, createJsResolver } from "./javascript.js";
export { pythonPack, extractPython, createPyResolver } from "./python.js";

/** Tier 1 languages. More packs are added per the plan's language tiers. */
export function defaultPacks(): LanguagePack[] {
  return [javascriptPack, pythonPack];
}
