// GET /api/attest/log: the transparency log (CONTRACT §7): ?head, ?entry=i, ?proof=i&size=n, ?consistency=m&size=n, ?from=i&to=j.
import { node, areas } from '../../verifier/dist/pof-verifier.mjs';
export default node(areas.log());
