/* The drawings. Every scene is the protocol as an isometric system: the Privacy Ring as stacked glass layers, disclosure
   as a beam through them, the attestation as a 240-byte plate, the certificate as one mint ring, the transparency log as a
   stack of thin plates under a Merkle lattice. No objects from the world: only layers, rings, beams, lattices, type, data. */
import { Iso, callout, rnd, f, C, S } from './iso.js';

const svg = (w, h, body, { cls = '', label = '' } = {}) =>
  `<svg class="iso ${cls}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${body}</svg>`;

let uid = 0;
/* shared defs: glass, beam and halo gradients, the fade mask for the ground grid */
function defs(id) {
  return `<defs>
  <linearGradient id="${id}-face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ice)" stop-opacity=".2"/><stop offset=".55" stop-color="var(--ice)" stop-opacity=".07"/><stop offset="1" stop-color="var(--ice)" stop-opacity=".14"/></linearGradient>
  <linearGradient id="${id}-wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--ice)" stop-opacity=".26"/><stop offset=".35" stop-color="var(--ice)" stop-opacity=".08"/><stop offset=".8" stop-color="var(--ice)" stop-opacity=".05"/><stop offset="1" stop-color="var(--ice)" stop-opacity=".2"/></linearGradient>
  <linearGradient id="${id}-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--mint)" stop-opacity=".04"/><stop offset=".5" stop-color="var(--mint)" stop-opacity=".42"/><stop offset="1" stop-color="var(--mint)" stop-opacity=".04"/></linearGradient>
  <linearGradient id="${id}-beamv" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".7" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="${id}-beamfade" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#${id}-beamv)"/></mask>
  <radialGradient id="${id}-halo"><stop offset="0" stop-color="var(--mint)" stop-opacity=".28"/><stop offset=".6" stop-color="var(--mint)" stop-opacity=".07"/><stop offset="1" stop-color="var(--mint)" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}-fade"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <mask id="${id}-gm" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#${id}-fade)"/></mask>
</defs>`;
}
const glass = id => ({ face: `url(#${id}-face)`, wall: `url(#${id}-wall)` });

/* the beam: a vertical light column from z0 to z1 */
function beam(I, id, x, y, z0, z1, r, cls = '') {
  return `<path class="beam ${cls}" d="${I.wallD(x, y, z0, r, z1 - z0)}" fill="url(#${id}-beam)"/>`;
}
/* the light packets that rise up a beam */
function packets(I, x, y, z0, z1, r, n = 4, cls = '') {
  let s = '';
  for (let i = 0; i < n; i++) s += `<g class="pk ${cls}" style="--rise:${f(-(z1 - z0))}px;--i:${i};--n:${n}">${I.ell(x, y, z0, r, 'pk-e')}</g>`;
  return s;
}
/* the attestation plate: 240 cells of data on a thin slab */
function plate(I, x, y, z, w, d, t, { cols = 16, rows = 15, seed = 3, cls = '' } = {}) {
  const r = rnd(seed); let cells = '', grid = '';
  const cw = w / cols, ch = d / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (r() < 0.34) {
      const a = x + i * cw + 1.2, b = y + j * ch + 1.2, e = z + t;
      cells += `M${I.q(a, b, e)}L${I.q(a + cw - 2.4, b, e)}L${I.q(a + cw - 2.4, b + ch - 2.4, e)}L${I.q(a, b + ch - 2.4, e)}Z`;
    }
  }
  for (let i = 1; i < cols; i++) grid += `M${I.q(x + i * cw, y, z + t)}L${I.q(x + i * cw, y + d, z + t)}`;
  for (let j = 1; j < rows; j++) grid += `M${I.q(x, y + j * ch, z + t)}L${I.q(x + w, y + j * ch, z + t)}`;
  return `<g class="plate ${cls}">${I.box(x, y, z, w, d, t, 'slab')}<path class="cells" d="${cells}"/><path class="pgrid" d="${grid}"/></g>`;
}
/* the transparency log: a stack of thin plates, with byte ticks on the near edge */
function logStack(I, x, y, z, w, d, n, pitch, { t = 2.2, seed = 5 } = {}) {
  const r = rnd(seed); let s = '';
  for (let i = 0; i < n; i++) {
    const zz = z + i * pitch;
    let ticks = '';
    const k = 10 + Math.floor(r() * 9);
    for (let j = 0; j < k; j++) { const a = x + 6 + r() * (w - 12); ticks += `M${I.q(a, y + d, zz + 0.4)}L${I.q(a, y + d, zz + t - 0.4)}`; }
    s += `<g class="lp" style="--i:${i}">${I.box(x, y, zz, w, d, t, 'leaf')}<path class="bytes" d="${ticks}"/></g>`;
  }
  return s;
}
/* a Merkle lattice over leaves along x: nodes are small cubes, the root is the signed head */
function merkle(I, x, y, z, w, levels = 3, rise = 30, s = 6) {
  let nodes = '', edges = '';
  let row = [];
  const n = 2 ** levels;
  for (let i = 0; i < n; i++) row.push([x + (w / n) * (i + 0.5), y, z]);
  const all = [row];
  for (let l = 1; l <= levels; l++) {
    const up = [];
    for (let i = 0; i < row.length; i += 2) up.push([(row[i][0] + row[i + 1][0]) / 2, y, z + l * rise]);
    all.push(up); row = up;
  }
  all.forEach((lv, l) => {
    lv.forEach((p, i) => {
      if (l < all.length - 1) {
        const par = all[l + 1][Math.floor(i / 2)];
        edges += `M${I.q(p[0], p[1], p[2] + s)}L${I.q(par[0], par[1], par[2])}`;
      }
      nodes += I.box(p[0] - s / 2, p[1] - s / 2, p[2], s, s, s, l === all.length - 1 ? 'node root' : l === 0 ? 'node leafn' : 'node');
    });
  });
  return `<g class="merkle"><path class="m-edge" d="${edges}"/>${nodes}</g>`;
}
/* an iso check lying in a horizontal plane (the mark of a live certificate) */
function check(I, x, y, z, k = 1, cls = 'chk') {
  return I.line([[x - 16 * k, y + 2 * k, z], [x - 5 * k, y + 13 * k, z], [x + 18 * k, y - 10 * k, z]], cls);
}
/* note slots on a ring band */
function noteMarks(I, x, y, z, rMid, angles, r = 5, cls = 'note-m') {
  return angles.map(a => { const t = (a * Math.PI) / 180; return I.ell(x + Math.cos(t) * rMid, y + Math.sin(t) * rMid, z, r, cls); }).join('');
}
/* a vertical engineering dimension at a page x between two page ys, label rotated along it */
function vdim(x, y0, y1, label, side = 'left') {
  const tx = side === 'left' ? x - 10 : x + 10, my = (y0 + y1) / 2;
  return `<g class="dim"><path class="dim-ln" d="M${x} ${y0}V${y1}M${x - 5} ${y0 + 5}L${x + 5} ${y0 - 5}M${x - 5} ${y1 + 5}L${x + 5} ${y1 - 5}"/>`
    + `<text class="dim-t" transform="translate(${f(tx)} ${f(my)}) rotate(-90)" text-anchor="middle">${label}</text></g>`;
}
/* a dimension along an iso axis, ticked at both ends, text lying on the plane */
function xdim(I, x0, x1, y, z, label, off = 14) {
  const yy = y + off;
  return `<g class="dim">${I.line([[x0, y, z], [x0, yy + 4, z]], 'dim-x')}${I.line([[x1, y, z], [x1, yy + 4, z]], 'dim-x')}`
    + I.line([[x0, yy, z], [x1, yy, z]], 'dim-ln')
    + I.line([[x0 - 3, yy + 3, z], [x0 + 3, yy - 3, z]], 'dim-ln') + I.line([[x1 - 3, yy + 3, z], [x1 + 3, yy - 3, z]], 'dim-ln')
    + I.text((x0 + x1) / 2, yy + 14, z, label, 'x', 'dim-t iso-t', 'text-anchor="middle"') + `</g>`;
}

/* ================================================================================================ the first screen */
export function heroScene() {
  const id = `h${uid++}`, W = 960, H = 880;
  const I = new Iso(440, 596);
  const RO = 160, RI = 108, LH = 7, PITCH = 19, N = 7, TOP = (N - 1) * PITCH + LH;
  const PZ = 236, CZ = 352;
  let s = defs(id);

  /* the ground: a fading iso grid, a dial, the keeper's orbit, two axes */
  s += `<g class="ground"><path class="g-grid" mask="url(#${id}-gm)" d="${I.grid(-480, -480, 480, 480, 0, 40)}"/>`;
  s += `<path class="g-fine" mask="url(#${id}-gm)" d="${I.grid(-240, -240, 240, 240, 0, 10)}"/>`;
  s += I.ell(0, 0, 0, 246, 'g-ring') + I.ell(0, 0, 0, 300, 'g-ring dash');
  s += `<path class="g-tick" d="${I.ticks(0, 0, 0, 246, 252, 120, { every: 10, r3: 262 })}"/>`;
  s += I.line([[-400, 0, 0], [420, 0, 0]], 'g-axis') + I.line([[0, -330, 0], [0, 420, 0]], 'g-axis');
  for (const p of [[-400, 0], [420, 0], [0, 420]]) s += I.ell(p[0], p[1], 0, 5, 'g-term');
  s += I.text(262, 10, 0, 'RINGS STATE TREE · TREE 0', 'x', 'iso-t g-lab');
  s += I.text(10, 300, 0, 'SLOT', 'y', 'iso-t g-lab', 'data-slot-ground');
  /* the keeper: a marker on its orbit around the ring, watching the disclosed nullifiers */
  s += `<path class="orbit" id="${id}-orbit" d="${I.ellD(0, 0, 0, 214)}"/>`;
  s += `<g class="keeper" data-at="${I.q(214 / Math.SQRT2, 214 / Math.SQRT2, 0)}"><ellipse class="kp" rx="${I.rx(7)}" ry="${I.ry(7)}"/><ellipse class="kp-c" rx="${I.rx(2.6)}" ry="${I.ry(2.6)}"/><animateMotion dur="18s" repeatCount="indefinite" rotate="0"><mpath href="#${id}-orbit"/></animateMotion></g>`;
  s += `</g>`;

  /* the beam's root on the ground */
  s += I.ell(0, 0, 0, 42, 'root-r') + I.ell(0, 0, 0, 24, 'root-d');

  /* the Privacy Ring: seven glass layers; the beam passes through each membrane */
  const marks = [[12, 48, 101, 150, 205, 262, 318], [30, 84, 133, 190, 240, 300], [5, 70, 118, 172, 228, 280, 336], [40, 96, 160, 212, 270, 325], [22, 64, 140, 196, 250, 306], [8, 58, 110, 178, 232, 290, 344], [34, 88, 126, 168, 220, 276, 330]];
  s += `<g class="stack">`;
  for (let i = 0; i < N; i++) {
    const z = i * PITCH;
    s += `<g class="lyr" style="--i:${i}">`;
    s += beam(I, id, 0, 0, i ? z - PITCH + LH : 0, z, 24, 'b-seg');
    s += I.ring(0, 0, z, RO, RI, LH, glass(id));
    s += I.ell(0, 0, z + LH, 24, 'ap');
    s += noteMarks(I, 0, 0, z + LH, (RO + RI) / 2, marks[i], 4.2);
    s += `</g>`;
  }
  s += `</g>`;
  /* the disclosed notes, lifted out of their layers into the beam (an exploded view) */
  const lifted = [[2, 133, 150], [4, 196, 176], [5, 290, 202]];
  let leaders = '', notes = '';
  lifted.forEach(([layer, deg, z], k) => {
    const t = (deg * Math.PI) / 180, rm = (RO + RI) / 2, zz = layer * PITCH + LH;
    const sx = Math.cos(t) * rm, sy = Math.sin(t) * rm;
    const nx = [-8, 9, -3][k], ny = [6, -5, -9][k];
    leaders += I.line([[sx, sy, zz], [sx, sy, z], [nx, ny, z]], 'lead');
    leaders += I.ell(sx, sy, zz, 4.2, 'slot-o');
    notes += `<g class="dn dn${k}" style="--k:${k}">${I.disc(nx, ny, z, 10, 3, 'note')}</g>`;
  });
  s += `<g class="beam-up">${beam(I, id, 0, 0, TOP, PZ, 24, 'b-free')}${packets(I, 0, 0, 0, PZ, 22, 4)}</g>`;
  s += `<g class="lifted">${leaders}${notes}</g>`;

  /* the attestation: 240 bytes, signed */
  s += `<g class="att">${I.ell(0, 0, PZ + 4, 24, 'ap')}${plate(I, -70, -70, PZ, 140, 140, 4)}</g>`;
  s += xdim(I, -70, 70, 70, PZ, '240 BYTES', 16);
  /* the beam to the certificate */
  s += `<g class="beam-top">${beam(I, id, 0, 0, PZ + 4, CZ, 12, 'b-thin')}${packets(I, 0, 0, PZ + 4, CZ, 11, 3, 'pk-s')}</g>`;
  /* the certificate: one mint ring on chain */
  s += `<g class="cert" id="${id}-cert">`;
  s += `<ellipse class="halo" cx="${I.p(0, 0, CZ)[0]}" cy="${I.p(0, 0, CZ)[1]}" rx="${I.rx(150)}" ry="${I.ry(150)}" fill="url(#${id}-halo)"/>`;
  s += `<path class="c-tick" d="${I.ticks(0, 0, CZ + 5, 86, 91, 96, { every: 8, r3: 97 })}"/>`;
  s += `<g class="c-ring">${I.ring(0, 0, CZ, 78, 64, 5, { cls: 'mint', membrane: false, hidden: false })}</g>`;
  s += `<path class="c-diss" pathLength="1000" d="${I.ellD(0, 0, CZ + 5, 71)}"/>`;
  s += `</g>`;

  /* the transparency log: thin plates, the Merkle lattice over them, the signed head */
  const LW = 118, LD = 62, LX = 28 - LW / 2, LY = -388 - LD / 2, LN = 14, LP = 5.6;
  const ltop = LN * LP;
  s += I.line([[70, -70, PZ + 2], [LX + LW / 2, LY + LD / 2, PZ + 2], [LX + LW / 2, LY + LD / 2, ltop + 14 + 96]], 'flow');
  s += `<g class="log">${I.box(LX - 8, LY - 8, -2, LW + 16, LD + 16, 2, 'base')}${logStack(I, LX, LY, 0, LW, LD, LN, LP)}`;
  s += `<g class="lp-new">${I.box(LX, LY, ltop, LW, LD, 2.2, 'leaf new')}</g>`;
  s += merkle(I, LX, LY + LD / 2, ltop + 14, LW, 3, 30, 6);
  s += `</g>`;

  /* dimensions and callouts */
  const [lx, ly] = I.p(-(RO + 26) / Math.SQRT2, (RO + 26) / Math.SQRT2, 0);
  s += vdim(f(lx), f(ly), f(ly - TOP), 'SHIELDED');
  const [cxp, cyp] = I.p(0, 0, CZ + 5);
  const [px, py] = I.p(-70, 70, PZ + 4);
  const [nx0, ny0] = I.p(9, -5, 176 + 3);
  const [rx0, ry0] = I.p(RO / Math.SQRT2, -RO / Math.SQRT2, TOP - 30);
  const [hx, hy] = I.p(LX + LW / 2, LY + LD / 2, ltop + 14 + 90 + 6);
  const [kx, ky] = I.p(214 / Math.SQRT2, 214 / Math.SQRT2, 0);
  const [wx, wy] = I.p(RO * 0.97, RO * 0.26, TOP * 0.5);
  s += callout([cxp - I.rx(78), cyp], [cxp - I.rx(78) - 60, cyp - 52], 150, 'CERTIFICATE', 'at least a tier, never an amount', { side: 'left', id: `${id}-co-cert` });
  s += callout([px, py], [px - 50, py - 64], 160, 'ATTESTATION', '240 bytes, signed by the Verifier', { side: 'left' });
  s += callout([nx0 + 12, ny0], [nx0 + 200, ny0 + 78], 140, 'DISCLOSED NOTES', 'the fewest that reach the tier');
  s += callout([hx - 2, hy - 4], [hx - 36, hy - 44], 130, 'TRANSPARENCY LOG', 'signed head, on chain', { side: 'left' });
  s += callout([wx, wy], [wx + 70, wy + 64], 140, 'PRIVACY RING', 'your vault: the rest stays shielded');
  s += callout([kx, ky], [kx + 110, ky + 36], 150, 'KEEPER', 'revokes at the slot a note moves');
  return svg(W, H, s, { cls: 'hero-iso', label: 'The protocol as an isometric system: a Privacy Ring of stacked glass layers; a beam of disclosed notes rises through it to a 240-byte attestation plate and on to a mint certificate ring; beside it the transparency log, a stack of thin plates under a Merkle lattice.' });
}


/* ================================================================================================ helpers for the steps */
const R2 = Math.SQRT1_2;
/* a horizontal light beam along x, centre (y, zc), radius r: a band between its two silhouettes, lit across its width */
function beamX(I, id, x0, x1, y, zc, r, cls = 'beam') {
  const a0 = I.p(x0, y + r * R2, zc - r * R2), a1 = I.p(x1, y + r * R2, zc - r * R2), b1 = I.p(x1, y - r * R2, zc + r * R2), b0 = I.p(x0, y - r * R2, zc + r * R2);
  const g = `${id}-bx${uid++}`;
  return `<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${a0[0]}" y1="${a0[1]}" x2="${b0[0]}" y2="${b0[1]}"><stop offset="0" stop-color="var(--mint)" stop-opacity=".05"/><stop offset=".5" stop-color="var(--mint)" stop-opacity=".45"/><stop offset="1" stop-color="var(--mint)" stop-opacity=".05"/></linearGradient>`
    + `<path class="${cls}" fill="url(#${g})" d="M${a0.join(' ')}L${a1.join(' ')}L${b1.join(' ')}L${b0.join(' ')}Z"/>`;
}
/* a standing data plate in the YZ plane (its face x + t looks at the viewer's right) */
function plateYZ(I, x, y, z, d, h, t, { cols = 12, rows = 20, seed = 9 } = {}) {
  const r = rnd(seed), fx = x + t; let cells = '', grid = '';
  const cw = d / cols, ch = h / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (r() < 0.36) {
    const a = y + i * cw + 1, b = z + j * ch + 1;
    cells += `M${I.q(fx, a, b)}L${I.q(fx, a + cw - 2, b)}L${I.q(fx, a + cw - 2, b + ch - 2)}L${I.q(fx, a, b + ch - 2)}Z`;
  }
  for (let i = 1; i < cols; i++) grid += `M${I.q(fx, y + i * cw, z)}L${I.q(fx, y + i * cw, z + h)}`;
  for (let j = 1; j < rows; j++) grid += `M${I.q(fx, y, z + j * ch)}L${I.q(fx, y + d, z + j * ch)}`;
  return `<g class="plate">${I.box(x, y, z, t, d, h, 'slab')}<path class="cells" d="${cells}"/><path class="pgrid" d="${grid}"/></g>`;
}
/* a glass gate standing in the YZ plane, with the beam's aperture */
function gate(I, x, d, h, zc, r) {
  return `<g class="gate">${I.box(x, -d / 2, 0, 2.5, d, h, 'glassbox')}`
    + I.circ([x + 2.5, 0, zc], [0, 1, 0], [0, 0, 1], r, 'ap-v') + I.circ([x + 2.5, 0, zc], [0, 1, 0], [0, 0, 1], r + 7, 'ap-vo') + `</g>`;
}
/* a small ground under each step scene */
function stepGround(I, id, ext = 260, step = 20) {
  return `<path class="g-grid" mask="url(#${id}-gm)" d="${I.grid(-ext, -ext, ext, ext, 0, step)}"/>`;
}
/* a stack of ring layers */
function stack(I, id, x, y, n, z0, pitch, ro, ri, h, marks = null, { membrane = true } = {}) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const z = z0 + i * pitch;
    s += `<g class="lyr" style="--i:${i}">${I.ring(x, y, z, ro, ri, h, { ...glass(id), membrane })}`;
    if (marks) s += noteMarks(I, x, y, z + h, (ro + ri) / 2, marks[i % marks.length], 3.6);
    s += `</g>`;
  }
  return s;
}
/* a mover along a page-space path (SMIL), with a static place for reduced motion */
function mover(inner, d, dur, begin = 0, at = '', keyOpacity = '') {
  return `<g class="mv" data-at="${at}"${keyOpacity ? ' opacity="0"' : ''}>${inner}<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}" calcMode="linear"/>`
    + (keyOpacity ? `<animate attributeName="opacity" dur="${dur}s" begin="${begin}s" repeatCount="indefinite" values="${keyOpacity}"/>` : '') + `</g>`;
}
const MARKS = [[10, 52, 96, 140, 190, 232, 280, 322], [30, 74, 120, 166, 210, 256, 300, 344], [0, 44, 88, 134, 178, 224, 268, 312], [20, 66, 110, 154, 200, 246, 290, 336]];

/* ================================================================================================ 01 shield */
export function shieldScene() {
  const id = `s${uid++}`, W = 680, H = 460, I = new Iso(370, 318);
  let s = defs(id) + stepGround(I, id);
  const RO = 118, RI = 80, LH = 6, P = 16, N = 4, TOP = (N - 1) * P + LH;
  /* public and private: the boundary of the vault */
  s += I.ell(0, 0, 0, 150, 'bound') + I.ell(0, 0, 128, 150, 'bound');
  const [l0] = I.p(-150 * R2, 150 * R2, 0), [r0] = I.p(150 * R2, -150 * R2, 0), [, yb] = I.p(0, 0, 0), [, yt] = I.p(0, 0, 128);
  s += `<path class="bound" d="M${l0} ${yb}V${yt}M${r0} ${yb}V${yt}"/>`;
  s += I.text(-60, -150, 128, 'PRIVATE', 'x', 'iso-t lab-m');
  /* the wallet: a plain node; the deposit runs along the ground into the vault */
  s += I.box(-322, -14, 0, 28, 28, 28, 'node-b');
  s += I.line([[-294, 0, 0], [-150, 0, 0]], 'dep');
  s += I.line([[-150, 0, 0], [-118, 0, 0]], 'dep dash');
  s += stack(I, id, 0, 0, N, 0, P, RO, RI, LH, MARKS);
  s += I.ell(0, 0, TOP, 22, 'ap');
  /* notes travel from the wallet over the boundary and down into the ring */
  const path = [[-294, 0, 40], [-170, 0, 40], [-60, 0, 150], [0, 0, 150], [0, 0, TOP + 2]].map(p => I.p(...p));
  const d = 'M' + path.map(p => p.join(' ')).join('L');
  s += `<path class="trail" d="${d}"/>`;
  const disc = `<ellipse class="mv-e" rx="${I.rx(11)}" ry="${I.ry(11)}"/>`;
  for (let k = 0; k < 3; k++) s += mover(disc, d, 6, -k * 2, path[3].join(','), '0;1;1;1;0');
  s += callout(I.p(-308, 28, 0), [I.p(-308, 28, 0)[0] - 4, I.p(-308, 28, 0)[1] + 96], 130, 'WALLET', 'the deposit is public');
  s += callout(I.p(RO * 0.97, RO * 0.26, TOP * 0.5), [I.p(RO, 0, 0)[0] + 60, I.p(RO, 0, 0)[1] + 44], 120, 'POF VAULT', 'a separate Privacy Ring');
  s += callout(I.p(0, 0, 150), [I.p(0, 0, 150)[0] + 120, I.p(0, 0, 150)[1] - 36], 140, 'NOTES', 'private once inside');
  return svg(W, H, s, { label: 'A wallet deposits SOL or USDC in public; the notes cross into a separate Privacy Ring, the POF vault, where they stay shielded.' });
}

/* ================================================================================================ 02 disclose */
export function discloseScene() {
  const id = `d${uid++}`, W = 680, H = 500, I = new Iso(330, 400);
  let s = defs(id) + stepGround(I, id);
  const RO = 116, RI = 80, LH = 6, P = 46, N = 4;
  s += I.line([[0, 0, 0], [0, 0, 250]], 'axis-c');
  s += stack(I, id, 0, 0, N, 0, P, RO, RI, LH, MARKS);
  /* the fewest notes that reach the tier, lifted out with leaders to their empty slots */
  const pick = [[0, 96, -36], [1, 210, 0], [3, 300, 36]], ZN = 270;
  pick.forEach(([layer, deg, x], k) => {
    const t = (deg * Math.PI) / 180, rm = (RO + RI) / 2, z = layer * P + LH, sx = Math.cos(t) * rm, sy = Math.sin(t) * rm;
    s += I.ell(sx, sy, z, 3.6, 'slot-o') + I.line([[sx, sy, z], [sx, sy, ZN - 26], [x, 0, ZN]], 'lead');
    s += `<g class="dn" style="--k:${k}">${I.disc(x, 0, ZN, 12, 4, 'note')}</g>`;
  });
  /* the tier ladder: five rungs; the notes reach the fourth */
  const lx = I.p(178, -178, 0)[0], base = I.p(178, -178, 0)[1];
  const rungs = ['1', '10', '100', '1,000', '10,000'], zr = [60, 130, 200, ZN + 4, ZN + 74];
  let lad = `<path class="dim-ln" d="M${lx} ${base}V${base - ZN - 96}"/>`;
  rungs.forEach((r, i) => {
    const y = base - zr[i] - (i === 3 ? 0 : 0), on = i === 3;
    lad += `<path class="${on ? 'rung on' : 'rung'}" d="M${lx - 6} ${y}H${lx + 6}"/><text class="${on ? 'rung-t on' : 'rung-t'}" x="${lx + 14}" y="${y + 4}">${r} SOL</text>`;
  });
  const yOn = base - zr[3], [nx, ny] = I.p(48, 0, ZN + 4);
  lad += `<path class="lead" d="M${nx + 8} ${ny}L${lx - 10} ${yOn}"/>`;
  s += `<g class="ladder">${lad}<text class="rung-k" x="${lx - 6}" y="${base - ZN - 108}" text-anchor="start">TIER, AT LEAST</text></g>`;
  s += callout(I.p(-RO * 0.97, RO * 0.26, P * 1 + 3), [I.p(-RO, 0, 0)[0] - 74, I.p(-RO, 0, 0)[1] + 26], 120, 'THE REST', 'never leaves your browser', { side: 'left' });
  s += callout(I.p(-36, 0, ZN + 4), [I.p(-36, 0, ZN)[0] - 70, I.p(-36, 0, ZN)[1] - 40], 120, 'DISCLOSED', '1 to 8 notes', { side: 'left' });
  return svg(W, H, s, { label: 'An exploded view of the Privacy Ring: three notes are lifted out of their layers; together they reach the 1,000 SOL rung of the tier ladder. The rest stays in place.' });
}

/* ================================================================================================ 03 attest */
export function attestScene() {
  const id = `a${uid++}`, W = 720, H = 440, I = new Iso(330, 290);
  let s = defs(id) + stepGround(I, id, 300);
  const ZC = 64, R = 15, GX = [-180, -100, -20, 60], names = ['COMMITMENT', 'IN THE TREE', 'UNSPENT', 'SUM, TIER'];
  s += I.line([[-300, 0, 0], [260, 0, 0]], 'g-axis');
  /* the beam enters from the left and stops at the plate; the gates check it on the way */
  s += beamX(I, id, -290, 150, 0, ZC, R);
  GX.forEach((x, i) => {
    s += gate(I, x, 96, 128, ZC, R);
    s += I.text(x + 2.5, 40, 112, `0${i + 1}`, 'yz', 'iso-t gate-n');
    const [gx, gy] = I.p(x + 2.5, -48, 128);
    s += `<g class="co"><path class="co-ln" d="M${gx} ${gy}V${gy - 36 - i * 0}"/><circle class="co-dot" cx="${gx}" cy="${gy}" r="2.4"/><text class="co-k sm" x="${gx}" y="${gy - 44}" text-anchor="middle">${names[i]}</text></g>`;
  });
  for (let k = 0; k < 3; k++) {
    const a = I.p(-290, 0, ZC), b = I.p(150, 0, ZC);
    s += mover(new Iso(0, 0).circ([0, 0, 0], [0, 1, 0], [0, 0, 1], R - 3, 'pk-v', 48), `M${a.join(' ')}L${b.join(' ')}`, 4.2, -k * 1.4, '', '0;1;1;1;0');
  }
  s += plateYZ(I, 150, -56, ZC - 70, 112, 140, 4);
  s += I.text(154, 44, ZC + 74, '240 BYTES', 'yz', 'iso-t');
  /* and after the plate: nothing kept */
  s += `<g class="kept">${I.box(200, -40, 30, 70, 80, 70, 'ghost')}</g>`;
  s += callout(I.p(235, 40, 30), [I.p(235, 40, 30)[0] + 26, I.p(235, 40, 30)[1] + 50], 110, 'KEPT', 'nothing');
  s += callout(I.p(154, 56, ZC - 40), [I.p(154, 56, ZC - 40)[0] - 30, I.p(154, 56, ZC - 40)[1] + 64], 150, 'ATTESTATION', 'signed, ed25519', { side: 'left' });
  return svg(W, H, s, { label: 'The disclosed notes pass as a beam through four checks: the commitment, membership in the Rings state tree, unspent, and the sum against the tier. The beam ends in a 240-byte signed plate; nothing is kept.' });
}

/* ================================================================================================ 04 certify */
export function certifyScene() {
  const id = `c${uid++}`, W = 700, H = 480, I = new Iso(330, 330);
  let s = defs(id);
  /* the chain: a wide thin slab with its state grid */
  s += `<g class="chain">${I.box(-190, -150, -6, 380, 280, 6, 'slab-c')}<path class="c-grid" d="${I.grid(-190, -150, 190, 130, 0, 20)}"/></g>`;
  s += I.text(10, 120, 0, 'SOLANA · THE POF PROGRAM', 'x', 'iso-t');
  /* the attestation above, rebuilt on chain (dashed), the certificate written over it */
  const AX = -60, AY = 20;
  s += `<g class="att">${plate(I, AX - 50, AY - 50, 196, 100, 100, 3, { cols: 12, rows: 20 })}</g>`;
  s += beam(I, id, AX, AY, 8, 196, 14, 'beam');
  s += `<path class="rebuilt" d="M${I.q(AX - 50, AY - 50, 0.5)}L${I.q(AX + 50, AY - 50, 0.5)}L${I.q(AX + 50, AY + 50, 0.5)}L${I.q(AX - 50, AY + 50, 0.5)}Z"/>`;
  s += `<ellipse class="halo" cx="${I.p(AX, AY, 8)[0]}" cy="${I.p(AX, AY, 8)[1]}" rx="${I.rx(110)}" ry="${I.ry(110)}" fill="url(#${id}-halo)"/>`;
  s += `<path class="c-tick" d="${I.ticks(AX, AY, 0.5, 60, 64, 72, { every: 6, r3: 69 })}"/>`;
  s += `<g class="c-up">${I.ring(AX, AY, 2, 54, 44, 5, { cls: 'mint', membrane: false, hidden: false })}</g>`;
  s += packets(I, AX, AY, 8, 196, 13, 3, 'pk-s');
  /* the log, on the right: plates, the new leaf landing, the Merkle head */
  const LX = 90, LY = -120, LW = 96, LD = 56, LN = 12, LP = 5.4, ltop = LN * LP;
  s += `<g class="log">${logStack(I, LX, LY, 0, LW, LD, LN, LP)}<g class="lp-new">${I.box(LX, LY, ltop, LW, LD, 2.2, 'leaf new')}</g>${merkle(I, LX, LY + LD / 2, ltop + 14, LW, 3, 26, 5.5)}</g>`;
  s += I.line([[AX + 50, AY - 50, 197], [LX + LW / 2, LY + LD / 2, 197], [LX + LW / 2, LY + LD / 2, ltop + 14 + 26 * 3 + 6]], 'flow');
  s += callout(I.p(AX - 50, AY + 50, 199), [I.p(AX - 50, AY + 50, 199)[0] - 30, I.p(AX - 50, AY + 50, 199)[1] - 40], 130, 'ATTESTATION', '240 bytes, signed', { side: 'left' });
  s += callout(I.p(AX - 54 * R2, AY + 54 * R2, 4), [I.p(AX - 54 * R2, AY + 54 * R2, 4)[0] - 40, I.p(AX - 54 * R2, AY + 54 * R2, 4)[1] + 60], 140, 'CERTIFICATE', 'rebuilt, checked, written', { side: 'left', cls: 'on' });
  const [hx, hy] = I.p(LX + LW / 2, LY + LD / 2, ltop + 14 + 26 * 3 + 6);
  s += callout([hx + 3, hy - 3], [hx + 30, hy - 40], 120, 'LOG HEAD', 'signed, anchored on chain');
  s += callout(I.p(LX + LW, LY + LD, LN * LP * 0.5), [I.p(LX + LW, LY + LD, 0)[0] + 40, I.p(LX + LW, LY + LD, 0)[1] + 50], 120, 'LEAF', '377 bytes, no amounts');
  return svg(W, H, s, { label: 'The 240-byte attestation is rebuilt on chain by the pof program, which checks the signature and writes the certificate, a mint ring. Beside it a new leaf lands on the transparency log under its signed Merkle head.' });
}

/* ================================================================================================ 05 revoke */
export function revokeScene() {
  const id = `r${uid++}`, W = 700, H = 480, I = new Iso(310, 340);
  let s = defs(id) + stepGround(I, id, 280);
  const RO = 104, RI = 70, LH = 6, P = 15, N = 4, TOP = (N - 1) * P + LH;
  /* the keeper's orbit, and its marker */
  s += `<path class="orbit" id="${id}-o" d="${I.ellD(0, 0, 0, 150)}"/>`;
  s += `<g class="keeper" data-at="${I.q(150 * R2, 150 * R2, 0)}"><ellipse class="kp" rx="${I.rx(6)}" ry="${I.ry(6)}"/><ellipse class="kp-c" rx="${I.rx(2.2)}" ry="${I.ry(2.2)}"/><animateMotion dur="12s" repeatCount="indefinite"><mpath href="#${id}-o"/></animateMotion></g>`;
  s += stack(I, id, 0, 0, N, 0, P, RO, RI, LH, MARKS);
  /* the certificate above, and the beam that held it */
  const CZ = 210;
  s += `<g class="rv-beam">${beam(I, id, 0, 0, TOP, CZ, 12, 'beam')}<animate attributeName="opacity" dur="8s" repeatCount="indefinite" values="1;1;.12;.12;1" keyTimes="0;.42;.52;.9;1"/></g>`;
  s += `<g class="rv-cert"><ellipse class="halo" cx="${I.p(0, 0, CZ)[0]}" cy="${I.p(0, 0, CZ)[1]}" rx="${I.rx(120)}" ry="${I.ry(120)}" fill="url(#${id}-halo)"/>`
    + `<g class="c-ring">${I.ring(0, 0, CZ, 62, 50, 5, { cls: 'mint', membrane: false, hidden: false })}</g><animate attributeName="opacity" dur="8s" repeatCount="indefinite" values="1;1;0;0;1" keyTimes="0;.42;.52;.9;1"/></g>`;
  s += `<path class="rv-diss" pathLength="1000" d="${I.ellD(0, 0, CZ + 5, 56)}" opacity="0"><animate attributeName="opacity" dur="8s" repeatCount="indefinite" values="0;0;1;.5;0" keyTimes="0;.42;.52;.9;1"/><animate attributeName="stroke-dasharray" dur="8s" repeatCount="indefinite" values="1000 0;1000 0;6 18;2 34;2 34" keyTimes="0;.42;.52;.9;1"/><animate attributeName="stroke-dashoffset" dur="8s" repeatCount="indefinite" values="0;0;0;-80;-80" keyTimes="0;.42;.52;.9;1"/></path>`;
  s += `<path class="c-tick rv-t" d="${I.ticks(0, 0, CZ + 5, 68, 72, 72, { every: 6, r3: 77 })}"/>`;
  /* the spent note: it leaves the ring along the ground, and the chain records the slot */
  const out = [[30, -20, TOP + 2], [30, -20, TOP + 60], [210, -20, TOP + 60], [300, -20, 0]].map(p => I.p(...p));
  const d = 'M' + out.map(p => p.join(' ')).join('L');
  s += `<path class="trail" d="${d}"/>`;
  s += `<g class="rv-note">${mover(`<g>${new Iso(0, 0).disc(0, 0, 0, 11, 4, 'note')}</g>`, d, 8, 0, out[2].join(','), '1;1;1;1;0')}</g>`;
  s += I.text(220, -10, 0, 'SPENT', 'x', 'iso-t lab-m');
  s += callout(I.p(0, 0, CZ + 5).map((v, i) => i ? v : v + I.rx(62)), [I.p(0, 0, CZ)[0] + I.rx(62) + 50, I.p(0, 0, CZ)[1] - 46], 150, 'REVOKED', 'at the slot the note moved', { cls: 'on' });
  s += callout(I.p(150 * R2, 150 * R2, 0), [I.p(150 * R2, 150 * R2, 0)[0] + 70, I.p(150 * R2, 150 * R2, 0)[1] + 34], 120, 'KEEPER', 'calls revoke_spent');
  s += callout(I.p(-RO * 0.97, RO * 0.26, TOP * 0.5), [I.p(-RO, 0, 0)[0] - 64, I.p(-RO, 0, 0)[1] + 52], 120, 'THE RING', 'one note moved', { side: 'left' });
  return svg(W, H, s, { cls: 'rv', label: 'A disclosed note is spent and leaves the Privacy Ring. The keeper, circling the ring, proves the spend from chain state, and the mint certificate ring above dissolves: revoked at that slot.' });
}

/* ================================================================================================ the wall, empty */
export function wallScene() {
  const id = `w${uid++}`, W = 760, H = 420, I = new Iso(380, 230);
  let s = defs(id);
  const cols = 6, rows = 3, sp = 82, x0 = -((cols - 1) * sp) / 2, y0 = -((rows - 1) * sp) / 2;
  s += I.box(x0 - 58, y0 - 58, -5, (cols - 1) * sp + 116, (rows - 1) * sp + 116, 5, 'slab-c');
  s += `<path class="g-grid" d="${I.grid(x0 - 58, y0 - 58, x0 - 58 + (cols - 1) * sp + 116, y0 - 58 + (rows - 1) * sp + 116, 0, sp / 2)}" mask="url(#${id}-gm)"/>`;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = x0 + i * sp, y = y0 + j * sp, first = i === 0 && j === 0;
    s += I.ell(x, y, 0, 26, first ? 'sock first' : 'sock') + I.ell(x, y, 0, 3, 'sock-c');
  }
  const fx = x0, fy = y0;
  s += `<g class="incoming">${I.line([[fx, fy, 0], [fx, fy, 110]], 'drop')}${I.ell(fx, fy, 0, 34, 'sock-p')}</g>`;
  s += I.text(x0 - 50, y0 + (rows - 1) * sp + 48, 0, 'THE WALL · READ FROM CHAIN', 'x', 'iso-t');
  s += callout(I.p(fx, fy, 110), [I.p(fx, fy, 110)[0] + 60, I.p(fx, fy, 110)[1] - 14], 150, 'FIRST CERTIFICATE', 'lands here', { cls: 'on' });
  return svg(W, H, s, { label: 'An empty field of eighteen certificate sockets, waiting for the first certificate to land.' });
}

/* ================================================================================================ small glyphs */
export function certGlyph(state = 'live') {
  const id = `g${uid++}`, I = new Iso(110, 70);
  let s = defs(id);
  s += I.ell(0, 0, 0, 70, 'g-ring') + `<path class="g-tick" d="${I.ticks(0, 0, 0, 70, 74, 48, { every: 6, r3: 79 })}"/>`;
  if (state === 'live') s += `<ellipse class="halo" cx="${I.p(0, 0, 14)[0]}" cy="${I.p(0, 0, 14)[1]}" rx="${I.rx(90)}" ry="${I.ry(90)}" fill="url(#${id}-halo)"/>` + I.ring(0, 0, 10, 46, 36, 5, { cls: 'mint', membrane: false, hidden: false });
  else s += `<path class="rv-diss on" pathLength="1000" d="${I.ellD(0, 0, 10, 41)}"/>` + I.ell(0, 0, 0, 41, 'g-ring dash');
  return svg(220, 120, s, { cls: 'ct-g' });
}
export function glyph(kind) {
  const id = `t${uid++}`, I = new Iso(85, 84);
  let s = defs(id);
  if (kind === 'verify') {
    s += I.ring(0, 0, 0, 50, 34, 4, glass(id)) + I.ring(0, 0, 14, 50, 34, 4, glass(id)) + beam(I, id, 0, 0, 0, 60, 9) + I.ring(0, 0, 60, 26, 19, 3, { cls: 'mint', membrane: false, hidden: false });
  } else if (kind === 'docs') {
    /* the paper's unit: a 240-byte attestation plate, dimensioned */
    s += plate(I, -46, -46, 0, 92, 92, 3, { cols: 12, rows: 12, seed: 4 });
    s += xdim(I, -46, 46, 46, 3, '240 BYTES', 12);
    s += I.line([[-46, -46, 3], [-46, -46, 40]], 'dim-x') + I.line([[46, -46, 3], [46, -46, 40]], 'dim-x');
  } else if (kind === 'dev') {
    const pts = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push([-36 + i * 36, -36 + j * 36, (i + j) % 2 ? 0 : 26]);
    let e = '';
    pts.forEach((p, k) => { if (k % 3 < 2) e += `M${I.q(...p)}L${I.q(...pts[k + 1])}`; if (k < 6) e += `M${I.q(...p)}L${I.q(...pts[k + 3])}`; });
    s += `<path class="m-edge" d="${e}"/>` + pts.map((p, k) => I.box(p[0] - 4, p[1] - 4, p[2], 8, 8, 8, k === 4 ? 'node root' : 'node')).join('');
  } else if (kind === 'log') {
    s += logStack(I, -34, -22, 0, 68, 44, 8, 5, { t: 2 }) + merkle(I, -34, 0, 50, 68, 2, 18, 5);
  } else if (kind === 'status') {
    s += I.box(-50, -38, 0, 100, 76, 3, 'slab-c');
    s += `<path class="g-grid" d="${I.grid(-50, -38, 50, 38, 3, 12.5)}"/>`;
    const zs = [0, 0, 0, 18, 34, 6, 0, 0, 0];
    s += I.line(zs.map((z, i) => [-48 + i * 12, 2, 3 + z]), 'pulse-l');
  }
  return svg(170, 130, s, { cls: 'tg-g' });
}
