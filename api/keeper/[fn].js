// /api/keeper/scan and /api/keeper/anchor: cron only (Bearer CRON_SECRET), and off before launch (POF_KEEPER_LIVE).
import { node, areas } from '../../verifier/dist/pof-verifier.mjs';
export default node(areas.keeper());
