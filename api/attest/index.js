// POST /api/attest: a CONTRACT §4 disclosure package in, a §3 attestation out. GET: the Verifier's public facts.
// All the logic is in the Verifier bundle (verifier/dist/pof-verifier.mjs, its sha256 is published in verifier/dist/BUILD.json).
import { node, areas } from '../../verifier/dist/pof-verifier.mjs';
export default node(areas.attest());
