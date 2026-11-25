/**
 * Quality tiers + adaptive resolution governor.
 * The tier decides geometry / step counts at boot, the governor trades pixels for frame time live.
 */
const coarse = matchMedia('(pointer: coarse)').matches;
const small = Math.min(innerWidth, innerHeight) < 640;
const forced = new URLSearchParams(location.search).get('q');
const mobile = forced ? forced === 'mobile' : coarse && (small || /Android|iPhone|iPad/i.test(navigator.userAgent));

/** Integrated GPUs get the low tier from the first frame instead of suffering until the governor notices. */
function integrated() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' }), x = gl.getExtension('WEBGL_debug_renderer_info');
    const s = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : ''; gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /Intel|SwiftShader|llvmpipe|Basic Render|Radeon(TM) (Vega|Graphics)/i.test(s) && !/Arc/i.test(s);
  } catch { return false; }
}
const TIERS = {
  high: { name: 'high', maxDpr: 1.5, minScale: 0.55, samples: 4, oceanSeg: 220, oceanRings: 230, rockSeg: 440, rockRings: 190, shadow: 2048, volScale: 0.5, volSteps: 18, beamSteps: 22, rain: 5200, spray: 900, dust: 700, bloomLevels: 6, waveDetail: 9, glass: 34, stacks: 18 },
  low: { name: 'low', maxDpr: 1, minScale: 0.42, samples: 2, oceanSeg: 144, oceanRings: 150, rockSeg: 280, rockRings: 120, shadow: 1024, volScale: 0.34, volSteps: 10, beamSteps: 16, rain: 2600, spray: 500, dust: 350, bloomLevels: 5, waveDetail: 8, glass: 24, stacks: 10 },
  mobile: { name: 'mobile', maxDpr: 1.5, minScale: 0.4, samples: 0, oceanSeg: 96, oceanRings: 120, rockSeg: 220, rockRings: 96, shadow: 1024, volScale: 0.34, volSteps: 8, beamSteps: 11, rain: 900, spray: 240, dust: 160, bloomLevels: 5, waveDetail: 7, glass: 22, stacks: 8 },
};
export const Q = { ...(TIERS[forced] || TIERS[mobile ? 'mobile' : integrated() ? 'low' : 'high']), mobile, coarse, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };

export class Governor {
  constructor(apply) {
    this.apply = apply; this.scale = Q.mobile ? 0.8 : Q.name === 'low' ? 0.72 : 1; this.acc = 0; this.n = 0; this.hold = 2.5; this.good = 0;
  }
  tick(dt) {
    if (dt > 0.35) return;          // hidden tab or a compile hitch, not a measure of the GPU
    dt = Math.min(dt, 0.12);
    this.hold -= dt; this.acc += dt; this.n++;
    if (this.hold > 0 || this.acc < 1) { if (this.hold > 0) { this.acc = 0; this.n = 0; } return; }
    const ms = (this.acc / this.n) * 1000; this.acc = 0; this.n = 0;
    const prev = this.scale;
    if (ms > 21) { this.scale = Math.max(Q.minScale, this.scale * (ms > 34 ? 0.78 : 0.9)); this.good = 0; }
    else if (ms < 17.6) { if (++this.good >= 5) { this.scale = Math.min(1, this.scale * 1.08); this.good = 0; } }
    else this.good = 0;
    if (Math.abs(prev - this.scale) > 0.01) { this.apply(this.scale); this.hold = 1.2; }
  }
}
