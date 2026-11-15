// Deterministic weather: every player computes the same weather from the shared world clock (seconds).
// A slow "front" value moves between clear, cloudy, rain and storm; wind has gusts on top.

const h1 = (i) => { let h = Math.imul(i | 0, 374761393) ^ 0x68e31da4; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
export const noise1 = (x, s = 0) => { const i = Math.floor(x), f = x - i; return h1(i * 31 + s) * (1 - sm(f)) + h1((i + 1) * 31 + s) * sm(f); };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const MODES = ['auto', 'clear', 'cloudy', 'rain', 'storm'];
export const MODE_LABEL = { auto: 'Auto weather', clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm' };

// returns { cover 0..1, rain 0..1, storm 0..1, wind 0..1.6, gust 0..1, dir (radians, direction the wind blows toward), flash 0..1 }
export function weatherAt(t, mode = 'auto') {
  let cover, rain, storm;
  if (mode === 'clear') { cover = 0.06; rain = 0; storm = 0; }
  else if (mode === 'cloudy') { cover = 0.72; rain = 0; storm = 0; }
  else if (mode === 'rain') { cover = 0.92; rain = 0.62; storm = 0; }
  else if (mode === 'storm') { cover = 1; rain = 1; storm = 1; }
  else {
    const w = noise1(t / 150, 11) * 0.75 + noise1(t / 47, 5) * 0.25;           // slow weather front
    cover = ss(0.3, 0.78, w);
    rain = ss(0.64, 0.88, w) * (0.55 + 0.45 * noise1(t / 33, 7));
    storm = ss(0.7, 0.86, w) * ss(0.35, 0.75, noise1(t / 120, 17));
  }
  const base = 0.2 + 0.2 * noise1(t / 70, 3);
  const gust = ss(0.55, 0.9, noise1(t / 11, 9));                               // occasional gusts
  const wind = Math.min(1.6, base * (1 + 0.6 * cover) + gust * (0.5 + 0.4 * cover) + rain * 0.3 + storm * 0.55);
  const dir = 0.9 + (noise1(t / 240, 21) - 0.5) * 1.8;
  let flash = 0;
  if (storm > 0.4) {
    const slot = Math.floor(t / 6), r = h1(slot * 7 + 3);
    if (r > 0.5) {
      const ft = t - slot * 6 - h1(slot * 13 + 1) * 3.5;
      if (ft > 0 && ft < 0.7) flash = Math.max(Math.exp(-ft * 14), ft > 0.16 ? Math.exp(-(ft - 0.16) * 18) * 0.8 : 0) * Math.min(1, storm * 1.4);
    }
  }
  return { cover, rain, storm, wind, gust, dir, flash };
}

export function describe(w) {
  const sky = w.storm > 0.5 ? ['⛈️', 'Storm'] : w.rain > 0.45 ? ['🌧️', 'Rain'] : w.rain > 0.08 ? ['🌦️', 'Light rain'] : w.cover > 0.6 ? ['☁️', 'Cloudy'] : w.cover > 0.25 ? ['⛅', 'Partly cloudy'] : ['☀️', 'Clear'];
  const kmh = Math.round(w.wind * 22);
  const air = w.wind < 0.28 ? 'Calm' : w.wind < 0.6 ? 'Breeze' : w.wind < 1.0 ? 'Windy' : 'Gusty';
  return `${sky[0]} ${sky[1]} · 💨 ${air} ${kmh} km/h`;
}
