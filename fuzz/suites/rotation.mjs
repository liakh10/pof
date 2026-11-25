// Suite "rotation": the Verifier key's delay, slot by slot.
// R1 the switch: after set_verifier(V2) at slot p, a certify signed by the old key and one signed by V2 are simulated at every slot
//    until past the switch; each outcome is judged at the bank slot the simulation ran at (old key ok iff slot < p + delay).
// R2 POF-17's fix: lowering the delay waits out the old one (held_delay, held_until), proposals in that window wait the old delay.
// R3 a random sequence of set_params(delay), set_verifier(key | none), apply_verifier and waits, with a model of the Rust logic
//    compared field by field after every step, and the property: a key proposed at slot p never takes over before t + E(t) for any
//    earlier observation t, where E(t) = max(rotation_delay(t), held_delay(t) if t < held_until(t)) is the delay an observer at t
//    was promised.
import { PublicKey } from '../lib/core.mjs';

export async function rotation(W, o = {}) {
  const { h, R, P, admin, users, expect, note } = W;
  W.suite('rotation');
  const payer = users[1];
  const D = PublicKey.default;
  const params0 = (await W.config()).params;
  const setP = d => h.send([P.ix('set_params', { params: { ...params0, rotation_delay: BigInt(d) } }, { admin: admin.publicKey })], [admin]);
  const setV = k => h.send([P.ix('set_verifier', { next: k }, { admin: admin.publicKey })], [admin]);
  const apply = () => h.send([P.ix('apply_verifier', {}, { caller: payer.publicKey })], [payer]);
  const must = (r, w) => { if (!r.ok) throw Error(w + ': ' + r.why); return r; };
  must(await setP(40), 'delay 40');
  // R1
  {
    const cur = W.V, nxt = W.V2;
    // a certificate the outgoing key signs now (think: a leaked key, before the admin paused)
    const oldCtl = W.kp(); await h.fund([oldCtl], 3);
    const aOld = await W.att({ kind: 2, ctlKp: oldCtl, tier: 5, valid: 590 });
    must(await W.certify(oldCtl, aOld), 'certificate by the outgoing key');
    const r = must(await setV(nxt.publicKey), 'propose');
    const c = await W.config();
    expect('next_verifier_slot = proposal slot + delay', 'set_verifier', { ok: BigInt(c.next_verifier_slot) === BigInt(r.slot) + 40n, why: `nvs ${c.next_verifier_slot} vs slot ${r.slot}` }, null);
    const nvs = BigInt(c.next_verifier_slot);
    let before = 0, after = 0, edge = 0;
    while (true) {
      const s = await h.slotNow();
      const a = await W.att({ kind: 0, ctlKp: payer, slot: s });
      const [ro, rn] = await Promise.all([W.simCertify(payer, a, { signer: cur }), W.simCertify(payer, a, { signer: nxt })]);
      for (const [r, k] of [[ro, 'old'], [rn, 'new']]) {
        const live = BigInt(r.slot) >= nvs ? 'new' : 'old';
        expect(`slot ${r.slot} (switch ${nvs}): the ${k} key`, 'certify', r, k === live ? null : 'WrongVerifier');
        if (BigInt(r.slot) === nvs || BigInt(r.slot) === nvs - 1n) edge++;
        live === 'old' ? before++ : after++;
      }
      if (BigInt(s) > nvs + 3n) break;
    }
    note(`R1: ${before} simulations before the switch, ${after} after, ${edge} at the slot before or the switch slot itself`);
    expect('apply_verifier once due', 'apply_verifier', await apply(), null);
    expect('apply_verifier with nothing due', 'apply_verifier', await apply(), 'NoRotationDue');
    W.V = nxt; W.V2 = cur;   // the suites after this one sign with the new key
    // the certificate the old key signed is still live for every gate, paused or not, and nothing on chain can void it
    const reqOld = () => h.sim([P.ix('require_certificate', { subject_hash: aOld.subject_hash, asset: 0, min_tier: 5 }, { certificate: W.certPda(aOld.subject_hash, 0) })], [payer]);
    await h.send([P.ix('set_paused', { paused: true }, { admin: admin.publicKey })], [admin]);
    const ro2 = await reqOld();
    await h.send([P.ix('set_paused', { paused: false }, { admin: admin.publicKey })], [admin]);
    expect('a certificate signed by the rotated-out key still passes require_certificate (paused)', 'require_certificate', ro2, null);
    note(W.P.ixs.void_by_key ? `after rotation (and while paused) a certificate signed by the old key still passes require_certificate until that key is revoked (revoke_verifier_key; the "void" suite tests it)` : `after rotation (and while paused) a certificate signed by the old key passes require_certificate until its expiry (${aOld.expiry_slot}); no instruction lets the admin void it, and its controller and its (possibly fake) nullifiers are the signer's choice`);
  }
  // R2
  {
    const r1 = must(await setP(5), 'lower to 5');
    const c = await W.config();
    expect('lowering 40 -> 5 holds 40 until slot + 40', 'set_params', { ok: c.held_delay === 40n && BigInt(c.held_until) === BigInt(r1.slot) + 40n, why: `held ${c.held_delay} until ${c.held_until} (slot ${r1.slot})` }, null);
    const p = must(await setV(W.V3.publicKey), 'propose in the hold');
    const c2 = await W.config();
    expect('a proposal inside the hold waits the old 40', 'set_verifier', { ok: BigInt(c2.next_verifier_slot) === BigInt(p.slot) + 40n, why: `nvs ${c2.next_verifier_slot} slot ${p.slot}` }, null);
    must(await setV(D), 'cancel');
    await h.waitSlot(BigInt(c.held_until) + 1n);
    const p2 = must(await setV(W.V3.publicKey), 'propose after the hold');
    const c3 = await W.config();
    expect('after the hold the new 5 applies', 'set_verifier', { ok: BigInt(c3.next_verifier_slot) === BigInt(p2.slot) + 5n, why: `nvs ${c3.next_verifier_slot} slot ${p2.slot}` }, null);
    must(await setV(D), 'cancel');
  }
  // R3
  {
    const steps = o.steps ?? 40;
    const obs = [];   // { slot, E, pending }
    const keyPairs = [W.kp(), W.kp(), W.kp()], keys = keyPairs.map(k => k.publicKey);
    let m = await W.config();
    const props = [];
    const read = async () => { const r = await h.conn.getAccountInfoAndContext(W.K.config, 'confirmed'); const c = P.decodeAccount('Config', r.value.data); return { c, slot: BigInt(r.context.slot) }; };
    const E = (c, t) => { const d = BigInt(c.params.rotation_delay); return t < BigInt(c.held_until) && BigInt(c.held_delay) > d ? BigInt(c.held_delay) : d; };
    let mismatches = 0;
    for (let i = 0; i < steps; i++) {
      const op = R.pick(['delay', 'delay', 'propose', 'propose', 'cancel', 'apply', 'wait']);
      const before = await read();
      obs.push({ slot: before.slot, E: E(before.c, before.slot) });
      let r = null, want;
      const c = before.c;
      if (op === 'delay') {
        const d = BigInt(R.pick([5, 8, 20, 40, 60]));
        r = await setP(d);
        const s = BigInt(r.slot);
        // the model of set_params
        const old = BigInt(c.params.rotation_delay);
        want = { held_delay: BigInt(c.held_delay), held_until: BigInt(c.held_until), nvs: BigInt(c.next_verifier_slot), next: c.next_verifier, verifier: c.verifier, delay: d };
        if (d < old) { const held = s < want.held_until ? (want.held_delay > old ? want.held_delay : old) : old; want.held_delay = held; want.held_until = s + held; }
      } else if (op === 'propose' || op === 'cancel') {
        const k = op === 'cancel' ? D : R.pick(keys);
        r = await setV(k);
        const s = BigInt(r.slot);
        want = { held_delay: BigInt(c.held_delay), held_until: BigInt(c.held_until), next: k.toBase58(), verifier: c.verifier, delay: BigInt(c.params.rotation_delay) };
        if (c.next_verifier !== D.toBase58() && s >= BigInt(c.next_verifier_slot)) want.verifier = c.next_verifier;
        const d = s < want.held_until ? (want.delay > want.held_delay ? want.delay : want.held_delay) : want.delay;
        want.nvs = k.equals(D) ? 0n : s + d;
        if (!k.equals(D)) props.push({ key: k.toBase58(), slot: s, nvs: want.nvs });
      } else if (op === 'apply') {
        r = await apply();
        const due = c.next_verifier !== D.toBase58() && BigInt(r.slot) >= BigInt(c.next_verifier_slot);
        expect(`step ${i}: apply_verifier ${due ? 'due' : 'not due'}`, 'apply_verifier', r, due ? null : 'NoRotationDue');
        continue;
      } else { await h.waitSlot(before.slot + BigInt(R.range(1, 15))); continue; }
      if (!r.ok) { expect(`step ${i}: ${op}`, op === 'delay' ? 'set_params' : 'set_verifier', r, null); continue; }
      const after = (await read()).c;
      const got = { held_delay: BigInt(after.held_delay), held_until: BigInt(after.held_until), nvs: BigInt(after.next_verifier_slot), next: after.next_verifier, verifier: after.verifier, delay: BigInt(after.params.rotation_delay) };
      const same = Object.keys(want).every(k => String(want[k]) === String(got[k]));
      if (!same) mismatches++;
      expect(`step ${i}: ${op} matches the model`, op === 'delay' ? 'set_params' : 'set_verifier', { ok: same, why: `model ${JSON.stringify(want, (k, v) => typeof v === 'bigint' ? String(v) : v)} chain ${JSON.stringify(got, (k, v) => typeof v === 'bigint' ? String(v) : v)}` }, null);
    }
    // the promise: no proposal takes over before t + E(t) of any observation t at or before it was made
    let broken = 0;
    for (const p of props) for (const t of obs) if (t.slot <= p.slot && p.nvs < t.slot + t.E) { broken++; W.results.unexpected.push({ suite: 'rotation', case: 'promise broken', proposal: p, observation: { slot: String(t.slot), E: String(t.E) } }); }
    W.results.suites.rotation.cases += props.length; if (broken) W.results.suites.rotation.unexpected += broken;
    note(`R3: ${steps} random steps, ${props.length} proposals, ${obs.length} observations: ${mismatches} model mismatches, ${broken} broken delay promises`);
    must(await setV(D), 'cancel at the end');
    // a random proposal may have come due and become the key: the suites after this one sign with whatever key is active now
    const fin = await W.config();
    const k = [W.V, W.V2, W.V3, ...keyPairs].find(x => x.publicKey.toBase58() === fin.verifier);
    if (!k) throw Error('the active verifier key is not one of ours');
    W.V = k;
    must(await setP(Number(params0.rotation_delay)), 'restore');
  }
}
