// Lets `node tests/all.ts` resolve the extensionless imports that Next.js and
// TypeScript's bundler resolution allow (for example `./cache` inside
// src/lib/sources.ts). Node's ESM resolver requires an explicit extension, so
// this hook retries with the TypeScript extensions before giving up.
const EXTENSIONS = [".ts", ".tsx", ".js"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier) && !specifier.includes("?")) {
    for (const ext of EXTENSIONS) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        /* try the next extension */
      }
    }
  }
  return nextResolve(specifier, context);
}
