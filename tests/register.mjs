// Registers the resolution hook. Used as `node --import ./tests/register.mjs
// tests/all.ts`.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
