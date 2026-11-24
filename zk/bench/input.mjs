// Writes bench/input.json: the circuit input of a 4-note test scenario (the worst case the circuit allows), for the bench page.
import fs from 'node:fs';
import path from 'node:path';
import * as Z from '../js/zk.js';
import { scenario, ONE_SOL, root } from '../test/fixtures.mjs';
const s = await scenario({ amounts: [4n, 3n, 2n, 1n].map(x => x * ONE_SOL), minAmount: 10n * ONE_SOL });
fs.writeFileSync(path.join(root, 'bench/input.json'), JSON.stringify(Z.buildInputs(s.P, s).input));
console.log('bench/input.json written');
