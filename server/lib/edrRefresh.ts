// KMX EDC — EDR 토큰 자동 갱신(refresh) 헬퍼
//
// provider 데이터플레인이 발급하는 EDR 액세스 토큰은 단기(기본 5분)이며, 만료 시 pull 이 403 을
// 반환한다. EDR 에는 refresh 토큰과 refresh 엔드포인트가 함께 실려 오므로, 403 을 받으면 refresh
// 엔드포인트로 새 액세스 토큰을 받아 재시도한다(장시간/반복 pull 유지).
//
// provider 는 1회용 rotation 을 쓰므로(갱신 시 이전 refresh 토큰 무효화) 전송별로 최신 토큰 쌍을
// 캐시한다. 단일 BFF 인스턴스 가정 — 다중 레플리카/재시작에서는 공유 저장소(Redis 등)가 필요하다.

import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { assertEndpointPublic } from "../middleware/validation.js";

export interface EdrTokens {
  accessToken: string;
  refreshToken?: string;
  refreshEndpoint?: string;
}

interface CacheEntry extends EdrTokens {
  cachedAt: number;
}

// 전송별(connectorId:tpId) 최신 토큰 캐시. rotation 으로 회전된 토큰을 유지한다.
const tokenCache = new Map<string, CacheEntry>();
const CACHE_MAX = 2000; // 무한 증가 방지(초과 시 오래된 항목부터 제거)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2시간(> refresh 수명) 지난 캐시는 무효로 보고 EDR 재조회

function key(connectorId: string, tpId: string): string {
  return `${connectorId}:${tpId}`;
}

/** EDR 응답에서 액세스/ refresh 토큰·엔드포인트를 추출(네임스페이스 접두 유무 모두 허용). */
export function edrTokensFromResponse(edr: Record<string, unknown>): EdrTokens {
  const pick = (suffix: string): string | undefined => {
    if (typeof edr[suffix] === "string") return edr[suffix] as string;
    // JSON-LD 확장으로 EDC 네임스페이스가 접두된 키도 허용.
    for (const [k, v] of Object.entries(edr)) {
      if (k.endsWith(suffix) && typeof v === "string") return v;
    }
    return undefined;
  };
  return {
    accessToken: (edr["authorization"] as string) ?? "",
    refreshToken: pick("refreshToken"),
    refreshEndpoint: pick("refreshEndpoint"),
  };
}

/** 캐시된 최신 토큰이 있으면 반환, 없으면 EDR 응답에서 추출해 캐시 후 반환. */
export function resolveEdrTokens(
  connectorId: string,
  tpId: string,
  edr: Record<string, unknown>
): EdrTokens {
  const k = key(connectorId, tpId);
  const cached = tokenCache.get(k);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  const tokens = edrTokensFromResponse(edr);
  store(k, tokens);
  return tokens;
}

function store(k: string, tokens: EdrTokens): void {
  if (tokenCache.size >= CACHE_MAX && !tokenCache.has(k)) {
    // 가장 오래 전에 삽입된 항목 제거(Map 은 삽입 순서 보존).
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(k, { ...tokens, cachedAt: Date.now() });
}

/** 전송 종료/삭제 시 캐시 정리(선택적 호출). */
export function evictEdrTokens(connectorId: string, tpId: string): void {
  tokenCache.delete(key(connectorId, tpId));
}

/**
 * refresh 엔드포인트로 새 액세스+refresh 쌍을 받아 캐시를 갱신한다. 실패 시 null.
 * refresh 엔드포인트는 미신뢰 provider 데이터플레인이 EDR 로 반환한 값이므로 SSRF 가드를 적용한다.
 */
// refresh 응답은 소형 JSON(토큰 쌍)뿐 — 악성/침해 provider 가 강제하는 대용량 응답 버퍼링/동기
// 파싱으로 공유 BFF 힙을 OOM 시키는 것을 차단한다(pull 경로의 크기상한 가드와 동일 정책).
const REFRESH_MAX_BYTES = 64 * 1024;

// 같은 전송(connectorId:tpId)의 동시 refresh 를 1회로 합친다(single-flight). provider 가 refresh 를
// 1회용 rotation 으로 무효화하므로, 겹친 요청이 각자 회전을 시도하면 뒤 요청이 이미 소진된 토큰으로
// 실패(spurious 403)한다 — 진행 중인 refresh 프라미스를 공유해 이를 방지한다.
const inflightRefresh = new Map<string, Promise<EdrTokens | null>>();

function refreshTokens(
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  const k = key(connectorId, tpId);
  const existing = inflightRefresh.get(k);
  if (existing) return existing;
  const p = doRefresh(connectorId, tpId, tokens).finally(() =>
    inflightRefresh.delete(k)
  );
  inflightRefresh.set(k, p);
  return p;
}

async function doRefresh(
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  if (!tokens.refreshToken || !tokens.refreshEndpoint) return null;
  if (await assertEndpointPublic(tokens.refreshEndpoint)) return null; // SSRF: 사설/메타데이터 대역 차단
  try {
    const resp = await axios.post(
      tokens.refreshEndpoint,
      { refresh_token: tokens.refreshToken },
      {
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: REFRESH_MAX_BYTES,
        maxBodyLength: REFRESH_MAX_BYTES,
      }
    );
    const data = resp.data as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!data.access_token) return null;
    const next: EdrTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      refreshEndpoint: tokens.refreshEndpoint,
    };
    store(key(connectorId, tpId), next);
    return next;
  } catch {
    return null;
  }
}

/**
 * EDR 데이터 pull — 액세스 토큰으로 GET 하고, 403(만료)이면 refresh 후 1회 재시도한다.
 * axiosConfig 에 Authorization 이외의 옵션(responseType·timeout·maxContentLength·maxRedirects 등)을 전달.
 */
export async function pullEdrData(
  connectorId: string,
  tpId: string,
  targetUrl: string,
  edr: Record<string, unknown>,
  axiosConfig: AxiosRequestConfig
): Promise<AxiosResponse> {
  const tokens = resolveEdrTokens(connectorId, tpId, edr);
  try {
    return await axios.get(targetUrl, {
      ...axiosConfig,
      headers: { ...axiosConfig.headers, Authorization: `Bearer ${tokens.accessToken}` },
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 403) throw err;
    const refreshed = await refreshTokens(connectorId, tpId, tokens);
    if (!refreshed) throw err;
    return await axios.get(targetUrl, {
      ...axiosConfig,
      headers: { ...axiosConfig.headers, Authorization: `Bearer ${refreshed.accessToken}` },
    });
  }
}
