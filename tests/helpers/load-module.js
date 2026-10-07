// Test harness: load browser IIFE modules (window.X = ...) into a node vm context.
// Production modules under js/ never import anything; they attach to window. This
// helper gives them a window and returns it so tests can reach window.Sim, window.View.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function readJson(rel) {
  return JSON.parse(readText(rel));
}

/** Run one or more js files in a fresh vm context sharing a stub window. */
export function loadModule(relPaths, windowProps = {}) {
  const window = Object.assign({}, windowProps);
  window.window = window;
  const ctx = vm.createContext({ window, Math, Date, JSON, console, setTimeout, clearTimeout });
  for (const rel of [].concat(relPaths)) {
    vm.runInContext(readText(rel), ctx, { filename: rel });
  }
  return window;
}

/** Load js/simulation.js and initialize Sim with the repo data (or overrides). */
export function loadSim(opts = {}) {
  const window = loadModule("js/simulation.js");
  const schema = opts.schema || readJson("data/schema.json");
  const sites = opts.sites || readJson("data/sites.json");
  window.Sim.init(schema, sites);
  return { Sim: window.Sim, schema, sites, window };
}
