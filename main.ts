// Driver for the csv-reader-speed-01 entry: reads every case from the input
// directory, answers each one alone with run() from solve.js, and writes the
// answers out as one JSON array, in the cases' order.
//
// Runs under Node 22 as `node main.ts`. Outside a container, the MAKEFUN_
// environment variables stand in for /input and /output; the output folder is
// created when it is missing and never removed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the rules allow tuning flags the same way as the
// baseline, and this is the baseline's flag).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL, typed here by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
