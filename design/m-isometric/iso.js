/* A small isometric engine. True isometric (30 degrees): a point (x, y, z) in protocol space lands on the page at
     sx = ox + (x - y) cos 30,  sy = oy + (x + y) sin 30 - z
   so a lift in z is a plain vertical move on the page (which is why the layers can breathe with a CSS translateY).
   Everything returns SVG strings; strokes are styled by class (see m.css) and never scale with the drawing. */

export const C = Math.cos(Math.PI / 6);
export const S = 0.5;
const K = Math.SQRT2;
export const f = n => Math.round(n * 100) / 100;

export class Iso {
  constructor(ox, oy) { this.ox = ox; this.oy = oy; }
  p(x, y, z = 0) { return [f(this.ox + (x - y) * C), f(this.oy + (x + y) * S - z)]; }
  q(x, y, z = 0) { const [a, b] = this.p(x, y, z); return `${a} ${b}`; }
  /* a circle of radius r in a horizontal plane is an axis-aligned ellipse */
  rx(r) { return f(r * K * C); }
  ry(r) { return f(r * K * S); }

  ell(x, y, z, r, cls = '', at = '') {
    const [cx, cy] = this.p(x, y, z);
    return `<ellipse class="${cls}" cx="${cx}" cy="${cy}" rx="${this.rx(r)}" ry="${this.ry(r)}" ${at}/>`;
  }
  /* the whole horizontal circle as a path (for pathLength, dashes, motion) */
  ellD(x, y, z, r, start = 'left') {
    const [cx, cy] = this.p(x, y, z), a = this.rx(r), b = this.ry(r);
    if (start === 'top') return `M${cx} ${f(cy - b)} A${a} ${b} 0 0 1 ${cx} ${f(cy + b)} A${a} ${b} 0 0 1 ${cx} ${f(cy - b)}Z`;
    return `M${f(cx - a)} ${cy} A${a} ${b} 0 0 1 ${f(cx + a)} ${cy} A${a} ${b} 0 0 1 ${f(cx - a)} ${cy}Z`;
  }
  /* the near (front) or far (back) half of a horizontal circle */
  arc(x, y, z, r, side = 'front') {
    const [cx, cy] = this.p(x, y, z), a = this.rx(r), b = this.ry(r);
    return `M${f(cx - a)} ${cy} A${a} ${b} 0 0 ${side === 'front' ? 0 : 1} ${f(cx + a)} ${cy}`;
  }
  /* the visible outside of a cylinder from z to z + h */
  wallD(x, y, z, r, h) {
    const [cx, cy] = this.p(x, y, z), a = this.rx(r), b = this.ry(r);
    return `M${f(cx - a)} ${cy} A${a} ${b} 0 0 0 ${f(cx + a)} ${cy} L${f(cx + a)} ${f(cy - h)} A${a} ${b} 0 0 1 ${f(cx - a)} ${f(cy - h)}Z`;
  }
  /* the far inside wall of a ring, seen through its hole */
  innerD(x, y, z, r, h) {
    const [cx, cy] = this.p(x, y, z), a = this.rx(r), b = this.ry(r);
    return `M${f(cx - a)} ${f(cy - h)} A${a} ${b} 0 0 1 ${f(cx + a)} ${f(cy - h)} L${f(cx + a)} ${cy} A${a} ${b} 0 0 0 ${f(cx - a)} ${cy}Z`;
  }
  /* an annulus in a horizontal plane (even-odd fill) */
  annD(x, y, z, ro, ri) { return this.ellD(x, y, z, ro) + this.ellD(x, y, z, ri); }

  /* one ring layer: a glass disc with a band, from z to z + h */
  ring(x, y, z, ro, ri, h, { cls = '', membrane = true, hidden = true, face = '', wall = '' } = {}) {
    const t = z + h, [cx, cy] = this.p(x, y, z), a = this.rx(ro);
    return `<g class="ring ${cls}">`
      + (hidden ? `<path class="hid" d="${this.arc(x, y, z, ro, 'back')}"/>` : '')
      + `<path class="wall-in" d="${this.innerD(x, y, z, ri, h)}"/>`
      + (membrane ? `<ellipse class="mem" cx="${cx}" cy="${f(cy - h)}" rx="${this.rx(ri)}" ry="${this.ry(ri)}"/>` : '')
      + `<path class="wall" d="${this.wallD(x, y, z, ro, h)}"${wall ? ` fill="${wall}"` : ''}/>`
      + `<path class="face"${face ? ` fill="${face}"` : ''} fill-rule="evenodd" d="${this.annD(x, y, t, ro, ri)}"/>`
      + `<path class="edge" d="${this.arc(x, y, z, ro, 'front')}M${f(cx - a)} ${cy}V${f(cy - h)}M${f(cx + a)} ${cy}V${f(cy - h)}"/>`
      + `<path class="edge-in" d="${this.arc(x, y, z, ri, 'back')}"/>`
      + `</g>`;
  }
  /* a solid cylinder (a disc), from z to z + h */
  disc(x, y, z, r, h, cls = '') {
    return `<g class="disc ${cls}"><path class="wall" d="${this.wallD(x, y, z, r, h)}"/>${this.ell(x, y, z + h, r, 'top')}</g>`;
  }
  /* a box from (x, y, z) to (x + w, y + d, z + h): top, left (y = y + d) and right (x = x + w) faces */
  box(x, y, z, w, d, h, cls = '') {
    const P = (a, b, c) => this.q(a, b, c);
    return `<g class="box ${cls}">`
      + `<path class="side-l" d="M${P(x, y + d, z)}L${P(x + w, y + d, z)}L${P(x + w, y + d, z + h)}L${P(x, y + d, z + h)}Z"/>`
      + `<path class="side-r" d="M${P(x + w, y, z)}L${P(x + w, y + d, z)}L${P(x + w, y + d, z + h)}L${P(x + w, y, z + h)}Z"/>`
      + `<path class="top" d="M${P(x, y, z + h)}L${P(x + w, y, z + h)}L${P(x + w, y + d, z + h)}L${P(x, y + d, z + h)}Z"/>`
      + `</g>`;
  }
  /* a polyline through 3D points */
  line(pts, cls = '', at = '') { return `<path class="${cls}" d="${pts.map((p, i) => (i ? 'L' : 'M') + this.q(...p)).join('')}" ${at}/>`; }
  /* a circle in any plane: centre c, unit vectors u and v spanning the plane */
  circ(c, u, v, r, cls = '', n = 96, at = '') {
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2, k = Math.cos(t) * r, m = Math.sin(t) * r;
      d += (i ? 'L' : 'M') + this.q(c[0] + u[0] * k + v[0] * m, c[1] + u[1] * k + v[1] * m, c[2] + u[2] * k + v[2] * m);
    }
    return `<path class="${cls}" d="${d}Z" ${at}/>`;
  }
  /* radial ticks around a horizontal circle */
  ticks(x, y, z, r1, r2, n, { every = 0, r3 = r2, from = 0, to = 360 } = {}) {
    let d = '';
    for (let i = 0; i < n; i++) {
      const deg = from + ((to - from) * i) / n; if (deg >= to) break;
      const t = (deg * Math.PI) / 180, e = every && i % every === 0 ? r3 : r2;
      d += `M${this.q(x + Math.cos(t) * r1, y + Math.sin(t) * r1, z)}L${this.q(x + Math.cos(t) * e, y + Math.sin(t) * e, z)}`;
    }
    return d;
  }
  /* a grid of lines in a horizontal plane */
  grid(x0, y0, x1, y1, z, step) {
    let d = '';
    for (let x = x0; x <= x1 + 0.01; x += step) d += `M${this.q(x, y0, z)}L${this.q(x, y1, z)}`;
    for (let y = y0; y <= y1 + 0.01; y += step) d += `M${this.q(x0, y, z)}L${this.q(x1, y, z)}`;
    return d;
  }
  /* text lying in a plane. plane 'x': on the ground along the x axis; 'y': on the ground along -y;
     'xz': standing, along x (the left face); 'yz': standing, along -y (the right face) */
  text(x, y, z, s, plane = 'x', cls = '', at = '') {
    const [tx, ty] = this.p(x, y, z);
    const m = { x: [C, S, -C, S], y: [C, -S, C, S], xz: [C, S, 0, 1], yz: [C, -S, 0, 1] }[plane];
    return `<text class="${cls}" transform="matrix(${m.map(f).join(' ')} ${tx} ${ty})" ${at}>${s}</text>`;
  }
}

/* a flat engineering callout: a dot at the anchor, a leader to an elbow, a shelf, a label above and a value below */
export function callout([ax, ay], [ex, ey], len, label, value = '', { side = 'right', cls = '', id = '' } = {}) {
  const sx = side === 'right' ? ex + len : ex - len;
  const tx = side === 'right' ? ex + 2 : ex - 2, anchor = side === 'right' ? 'start' : 'end';
  return `<g class="co ${cls}"${id ? ` id="${id}"` : ''}><circle class="co-dot" cx="${f(ax)}" cy="${f(ay)}" r="2.4"/>`
    + `<path class="co-ln" d="M${f(ax)} ${f(ay)}L${f(ex)} ${f(ey)}L${f(sx)} ${f(ey)}"/>`
    + `<text class="co-k" x="${f(tx)}" y="${f(ey - 8)}" text-anchor="${anchor}">${label}</text>`
    + (value ? `<text class="co-v" x="${f(tx)}" y="${f(ey + 17)}" text-anchor="${anchor}">${value}</text>` : '')
    + `</g>`;
}

/* a deterministic pseudo-random stream (the same drawing on every load) */
export function rnd(seed = 7) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
