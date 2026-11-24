// /api/link/start, /api/link/check (POST) and /api/link/verify?id= (GET; /api/link?id= rewrites here): the X-handle linker.
import { node, areas } from '../../verifier/dist/pof-verifier.mjs';
export default node(areas.link());
