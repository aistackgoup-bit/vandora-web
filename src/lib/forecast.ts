// Small, explainable sales forecast for a boutique-sized history.
//
// Holt's exponential smoothing with a damped trend over complete weeks: a level that follows recent
// weeks (alpha) plus a trend (beta). The band is ±1.28 × the one-step-ahead error seen on
// the history (≈80% of past weeks fell inside it). With little history it falls back to
// the plain average so a single big week doesn't project a fake trend.

export type Forecast = {
  points: { value: number; low: number; high: number }[];
  method: 'holt' | 'average' | 'none';
  trendPerWeek: number;
};

const ALPHA = 0.4;
const BETA = 0.2;
const PHI = 0.85;   // trend damping: short histories shouldn't extrapolate a straight line
const Z80 = 1.28;
const MIN_WEEKS_FOR_TREND = 6;

export function forecastWeekly(history: number[], horizon = 4): Forecast {
  const series = history.map((v) => (Number.isFinite(v) ? Math.max(v, 0) : 0));
  if (series.length === 0) return { points: [], method: 'none', trendPerWeek: 0 };

  if (series.length < MIN_WEEKS_FOR_TREND) {
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
    return {
      method: 'average',
      trendPerWeek: 0,
      points: Array.from({ length: horizon }, () => ({
        value: mean,
        low: Math.max(mean - Z80 * sd, 0),
        high: mean + Z80 * sd,
      })),
    };
  }

  let level = series[0];
  let trend = (series[Math.min(3, series.length - 1)] - series[0]) / Math.min(3, series.length - 1);
  let squaredErrors = 0;
  for (let t = 1; t < series.length; t++) {
    const predicted = level + PHI * trend;
    squaredErrors += (series[t] - predicted) ** 2;
    const prevLevel = level;
    level = ALPHA * series[t] + (1 - ALPHA) * (level + PHI * trend);
    trend = BETA * (level - prevLevel) + (1 - BETA) * PHI * trend;
  }
  const rmse = Math.sqrt(squaredErrors / (series.length - 1));

  return {
    method: 'holt',
    trendPerWeek: trend,
    points: Array.from({ length: horizon }, (_, i) => {
      const h = i + 1;
      // Damped trend: each further week adds a bit less of the trend
      const dampedSteps = Array.from({ length: h }, (_, k) => PHI ** (k + 1)).reduce((a, b) => a + b, 0);
      const value = Math.max(level + dampedSteps * trend, 0);
      // Uncertainty grows with the horizon
      const spread = Z80 * rmse * Math.sqrt(1 + (h - 1) * ALPHA ** 2);
      return { value, low: Math.max(value - spread, 0), high: value + spread };
    }),
  };
}

// Monday (Ecuador time) of the week that contains `date`, as YYYY-MM-DD — matches sales_weekly.week
export function weekStart(date: Date): string {
  const ec = new Date(date.toLocaleString('en-US', { timeZone: 'America/Guayaquil' }));
  const day = (ec.getDay() + 6) % 7;
  ec.setDate(ec.getDate() - day);
  return `${ec.getFullYear()}-${String(ec.getMonth() + 1).padStart(2, '0')}-${String(ec.getDate()).padStart(2, '0')}`;
}

export function addWeeks(week: string, n: number): string {
  const [y, m, d] = week.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 7 * n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
