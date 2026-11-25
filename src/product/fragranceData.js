/** Fictional collection. Absorption values are per unit length of the bottle's own height, per channel. */
export const FRAGRANCES = [
  {
    id: 'deep', no: '01', name: 'The Deep', labelName: ['THE', 'DEEP'], line: 'The memory of water.', price: 145,
    notes: ['Sea salt', 'Mineral accord', 'Driftwood', 'Wet stone', 'Cold musk'], character: 'Cold. Mineral. Quiet. Dark.',
    accent: [0.50, 0.74, 0.86],
    glass: { abs: [1.15, 0.72, 0.56] }, liquid: { abs: [3.6, 1.15, 0.85], scatter: [0.02, 0.11, 0.14] },
    mood: { tint: [0.86, 1.0, 1.10], fog: [0.022, 0.042, 0.056], dens: 1.15, storm: 0.35, rain: 0.5, char: 0, grade: [0.94, 1.0, 1.07], wind: 0.6 },
  },
  {
    id: 'storm', no: '02', name: 'The Storm', labelName: ['THE', 'STORM'], line: 'The hour before the coast.', price: 155,
    notes: ['Black pepper', 'Incense', 'Cedar', 'Leather', 'Smoke'], character: 'Intense. Warm. Raw. Unpredictable.',
    accent: [0.95, 0.52, 0.26],
    glass: { abs: [1.9, 2.25, 2.6] }, liquid: { abs: [1.1, 3.4, 6.2], scatter: [0.16, 0.045, 0.012] },
    mood: { tint: [1.08, 0.96, 0.86], fog: [0.034, 0.036, 0.038], dens: 1.5, storm: 3.2, rain: 1.5, char: 1, grade: [1.05, 0.98, 0.92], wind: 1.6 },
  },
  {
    id: 'light', no: '03', name: 'The Last Light', labelName: ['THE LAST', 'LIGHT'], line: 'What the dark kept.', price: 180,
    notes: ['Amber', 'Dry wood', 'Bergamot', 'Soft smoke', 'Warm musk'], character: 'Warm. Fading. Emotional. Memorable.',
    accent: [1.0, 0.70, 0.36],
    glass: { abs: [0.10, 0.13, 0.17] }, liquid: { abs: [0.22, 1.15, 3.3], scatter: [0.20, 0.10, 0.025] },
    mood: { tint: [1.10, 1.0, 0.84], fog: [0.044, 0.042, 0.040], dens: 0.85, storm: 0.15, rain: 0.2, char: 0, grade: [1.06, 1.0, 0.91], wind: 0.4 },
  },
];
export const byId = Object.fromEntries(FRAGRANCES.map((f) => [f.id, f]));
export const NEUTRAL = { tint: [1, 1, 1], fog: [0.030, 0.043, 0.056], dens: 1, storm: 1, rain: 1, char: 0, grade: [1, 1, 1], wind: 1 };
