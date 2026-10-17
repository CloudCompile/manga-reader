// Minimal test harness. The suite runs on Node's built-in TypeScript support
// (`node tests/all.ts`), so there is no test framework to install or configure.

let passed = 0;
const failures: string[] = [];
let currentFile = "";

export function suite(name: string): void {
  currentFile = name;
  console.log(`\n${name}`);
}

export function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${currentFile} › ${name}\n       ${msg}`);
      console.log(`  FAIL ${name}\n       ${msg}`);
    });
}

export function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(`${message || "values differ"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function summary(): number {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  return failures.length ? 1 : 0;
}
