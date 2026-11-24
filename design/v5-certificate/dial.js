/* v5 "The Certificate": the seal drawn as an instrument dial. Pure geometry, hairline first: a graduated outer scale
   (180 ticks, every fifth long), fine concentric rings (the Privacy Rings), two signal rings, a segmented ring that turns,
   and the black disc with the check cut out. One function, used twice: once to write the static first paint into
   index.html, and in the page to redraw the dial when a certificate's state changes (live, revoked, idle).
   States: live (signal rings whole), revoked (the wide signal ring opens and turns to ink), idle (no subject read yet). */

const f = n => +n.toFixed(2);
const pt = (a, r) => `${f(Math.cos(a) * r)} ${f(Math.sin(a) * r)}`;
const TAU = Math.PI * 2;

/* [radius, stroke, role] from the disc outwards */
const RINGS = [
  [150, 0.75, 'h'], [160, 0.75, 'h'], [176, 11, 'ink'], [194, 0.75, 'h'], [202, 0.75, 'h'], [222, 15, 'sig'],
  [242, 0.75, 'h'], [250, 0.75, 'h'], [262, 6, 'ink'], [276, 0.75, 'h'], [286, 0.75, 'h'], [298, 3.5, 'sig2'],
  [310, 0.75, 'h'], [320, 0.75, 'h'], [330, 0.75, 'h'], [340, 0.75, 'h'], [350, 0.75, 'h'], [360, 0.75, 'h'],
  [370, 0.75, 'h'], [380, 0.75, 'h'], [390, 0.75, 'h'], [400, 0.75, 'h'], [410, 0.75, 'h'], [420, 1.5, 'ink'],
];

export function dialSVG({ state = 'idle', title = '' } = {}) {
  const dead = state === 'revoked';
  const p = [];
  // crosshair, hairline, running past the scale
  p.push(`<g class="d-xh"><line x1="-500" y1="0" x2="500" y2="0"/><line x1="0" y1="-500" x2="0" y2="500"/></g>`);
  // the graduated scale: 180 ticks between r 432 and 452/466
  const ticks = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU - Math.PI / 2;
    const long = i % 5 === 0, major = i % 45 === 0;
    const r0 = 434, r1 = major ? 474 : long ? 458 : 446;
    ticks.push(`M ${pt(a, r0)} L ${pt(a, r1)}`);
  }
  p.push(`<path class="d-ticks" d="${ticks.join(' ')}"/>`);
  p.push(`<circle class="d-h" r="432"/>`);
  // the rings
  RINGS.forEach(([r, w, role], i) => {
    if (role === 'h') return p.push(`<circle class="d-h" r="${r}"/>`);
    if (role === 'ink') return p.push(`<circle class="d-ink" r="${r}" stroke-width="${w}"/>`);
    if (role === 'sig2') return p.push(`<circle class="d-sig${dead ? ' off' : ''}" r="${r}" stroke-width="${w}" pathLength="1000"/>`);
    // the wide signal ring: whole when live, open at the upper right when revoked
    if (dead) {
      const C = TAU * r, gap = C * 0.09;
      return p.push(`<circle class="d-sig off broken" r="${r}" stroke-width="${w}" stroke-dasharray="${f(C - gap)} ${f(gap)}" stroke-dashoffset="${f(C * 0.12)}"/>`);
    }
    p.push(`<circle class="d-sig${state === 'idle' ? ' idle' : ''}" r="${r}" stroke-width="${w}" pathLength="1000"/>`);
  });
  if (dead) {
    const r = 222, a0 = -0.12 * TAU, a1 = a0 + 0.09 * TAU;
    p.push(`<path class="d-shard" d="M ${pt(a0 + .014, r + 30)} A ${r + 30} ${r + 30} 0 0 1 ${pt(a0 + .05, r + 30)}"/>`);
    p.push(`<path class="d-shard" d="M ${pt(a1 - .05, r + 52)} A ${r + 52} ${r + 52} 0 0 1 ${pt(a1 - .016, r + 52)}"/>`);
  }
  // the segmented ring that turns slowly
  p.push(`<g class="d-spin"><circle class="d-seg" r="136" stroke-dasharray="180 30 90 30 260 30 40 30 120 30" pathLength="840"/></g>`);
  // the disc, its inner hairline, the arc and the cut-out check
  p.push(`<circle class="d-disc" r="122"/>`);
  p.push(`<circle class="d-inner" r="112"/>`);
  p.push(`<path class="d-arc" d="M -98 34 A 104 104 0 0 0 98 34"/>`);
  p.push(`<path class="d-check" d="M -56 -2 L -15 39 L 62 -38"/>`);
  return `<svg class="dial dial-${state}" viewBox="-500 -500 1000 1000" xmlns="http://www.w3.org/2000/svg" role="img"${title ? ` aria-label="${title}"` : ' aria-hidden="true"'}>${p.join('')}</svg>`;
}

/* the film button: a ring of 36 ticks, one per second of the film, with the play triangle in the middle */
export function reelSVG() {
  const t = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU - Math.PI / 2;
    t.push(`M ${pt(a, 41)} L ${pt(a, i % 6 === 0 ? 48 : 45)}`);
  }
  return `<svg class="reel" viewBox="-50 -50 100 100" aria-hidden="true"><path class="reel-ticks" d="${t.join(' ')}"/><circle class="reel-ring" r="37"/><circle class="reel-prog" r="37" pathLength="1000"/><path class="reel-tri" d="M -9 -13 L 15 0 L -9 13 Z"/></svg>`;
}
