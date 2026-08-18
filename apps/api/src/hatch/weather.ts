import type Database from 'better-sqlite3';

export interface WeatherLocation {
  lat: number;
  lon: number;
  name: string;
}

export interface WeatherForecast {
  precipitationProbability: number;
  weatherCode: number;
  summary: string;
}

/** Open-Meteo（https://open-meteo.com/）はAPIキー登録不要・無料枠が広く、Nestioのような
 * 個人用途では十分。docker/.envへの新規シークレット追加が不要になる利点も大きい */
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: '快晴',
  1: 'ほぼ晴れ',
  2: '一部曇り',
  3: '曇り',
  45: '霧',
  48: '霧氷',
  51: '弱い霧雨',
  53: '霧雨',
  55: '強い霧雨',
  61: '弱い雨',
  63: '雨',
  65: '強い雨',
  71: '弱い雪',
  73: '雪',
  75: '強い雪',
  80: 'にわか雨',
  81: 'にわか雨',
  82: '激しいにわか雨',
  95: '雷雨',
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { value: WeatherForecast; expiresAt: number }>();

/** 今日の最高降水確率・天気コードを取得する（地点単位で30分キャッシュ） */
export async function fetchWeatherForecast(lat: number, lon: number): Promise<WeatherForecast | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,weathercode&timezone=Asia%2FTokyo`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    daily?: { precipitation_probability_max?: number[]; weathercode?: number[] };
  };
  const probability = data.daily?.precipitation_probability_max?.[0];
  const weatherCode = data.daily?.weathercode?.[0];
  if (probability === undefined || weatherCode === undefined) return null;

  const value: WeatherForecast = {
    precipitationProbability: probability,
    weatherCode,
    summary: `${WEATHER_CODE_LABELS[weatherCode] ?? '不明な天気'}・降水確率${probability}%`,
  };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** user_settings.weather_location_jsonから地点を読み出す。未設定/不正なら null */
export function getUserWeatherLocation(db: Database.Database, userId: string): WeatherLocation | null {
  const row = db.prepare('SELECT weather_location_json FROM user_settings WHERE user_id = ?').get(userId) as
    | { weather_location_json: string }
    | undefined;
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.weather_location_json) as Partial<WeatherLocation>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
    return { lat: parsed.lat, lon: parsed.lon, name: parsed.name ?? '' };
  } catch {
    return null;
  }
}
