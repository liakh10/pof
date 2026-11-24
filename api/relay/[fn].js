// /api/relay/quote (GET) and /api/relay/certify (POST): the relayer for handle and badge certificates.
import { node, areas } from '../../verifier/dist/pof-verifier.mjs';
export default node(areas.relay());
