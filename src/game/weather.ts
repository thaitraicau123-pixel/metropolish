import type { WeatherKind, WeatherPreset } from './types';

export interface WeatherAmounts {
  weather: WeatherKind;
  rain: number; // 0..1
  snow: number; // 0..1
}

/**
 * Deterministic seasonal weather cycle when preset === 'auto'.
 * Cycles gently across days so players experience clear skies, rain showers,
 * and winter snowfall without jarring rapid flipping.
 */
export function resolveTargetWeather(
  preset: WeatherPreset,
  day: number,
  timeOfDay: number,
): WeatherKind {
  if (preset !== 'auto') return preset;
  // Day 1 starts clear/sunny so opening impression is bright;
  // Subsequent days rotate cleanly through clear, rain, and snow spells.
  const phase = (day - 1 + timeOfDay) % 5;
  if (phase >= 1.35 && phase < 2.35) return 'rain';
  if (phase >= 3.3 && phase < 4.35) return 'snow';
  return 'clear';
}

export function stepWeatherAmounts(
  current: WeatherAmounts,
  target: WeatherKind,
  dt: number,
): WeatherAmounts {
  const targetRain = target === 'rain' ? 1 : 0;
  const targetSnow = target === 'snow' ? 1 : 0;
  const rate = Math.min(1, dt * 3.4);

  const rain = current.rain + (targetRain - current.rain) * rate;
  const snow = current.snow + (targetSnow - current.snow) * rate;

  return {
    weather: target,
    rain: rain < 0.01 ? 0 : rain > 0.99 ? 1 : rain,
    snow: snow < 0.01 ? 0 : snow > 0.99 ? 1 : snow,
  };
}
