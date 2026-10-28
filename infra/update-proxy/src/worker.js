/**
 * Vibisual 업데이트 피드 프록시(Cloudflare Worker).
 * - `GET/HEAD /latest.yml`·`/latest-mac.yml`·`/latest-linux.yml` — GitHub 최신 릴리스의 같은 파일을 넘긴다(요청 하나 = 돌고 있는 설치 하나).
 * - `GET /<설치 파일 이름>` — 릴리스 자산으로 302(대역폭은 GitHub, 자산 다운로드 수도 GitHub 에 남는다) · `GET /stats` — 날짜별 집계만.
 * 앱은 어차피 4시간마다 묻는다(`UPDATE_CHECK_INTERVAL_MS`) — 새 수집이 아니다. GitHub 직행이면 `latest.yml` 다운로드 수뿐이라 1대인지 여럿인지 못 가린다.
 * 개인정보(PRIVACY.md 의 약속): IP 는 하루치 소금(`HASH_SALT`+그날 날짜)으로 접은 SHA-256 16자만 · 계정·쿠키·기기 식별자 없음 · KV TTL 35일 · 쿼리스트링 미기록 · `HASH_SALT` 가 없으면 계수 없이 프록시만.
 */

const OWNER = 'Vibisual';
const REPO = 'vibisual';

/** electron-updater 가 묻는 피드 파일. 이 셋만 계수 대상이다. */
const FEED_FILES = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml']);

/** 자산으로 인정하는 확장자. 목록 밖은 404 — 임의 경로를 GitHub 으로 흘리지 않는다. */
const ASSET_EXT = /\.(exe|dmg|zip|AppImage|deb|rpm|blockmap)$/i;

/** 집계에서 한 번에 훑는 최대 날짜 수. */
const STATS_DAYS = 30;

/** KV 항목 수명(초). 35일 — 30일 집계 창보다 조금 길게 둬 경계에서 잘리지 않게. */
const KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

const utcDate = (now) => new Date(now).toISOString().slice(0, 10);

/** 릴리스 자산 URL. 파일 이름에 든 판올림으로 태그를 짚고, 못 읽으면 `latest` 로 떨어진다. */
function assetUrl(name) {
  const m = /(\d+\.\d+\.\d+)/.exec(name);
  const tag = m ? `v${m[1]}` : 'latest';
  return tag === 'latest'
    ? `https://github.com/${OWNER}/${REPO}/releases/latest/download/${name}`
    : `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${name}`;
}

/** 하루치 소금으로 접은 방문자 표식 16자. 원본(IP·UA)은 어디에도 남지 않는다. */
async function visitorKey(request, salt, date) {
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const ua = request.headers.get('user-agent') ?? '';
  const data = new TextEncoder().encode(`${salt}|${date}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 방문자를 하루 한 번만 기록한다 — KV 쓰기는 같은 값이어도 소모된다(무료 하루 1,000회). 오늘 이미 썼으면 엣지 캐시가 막는다. */
async function recordVisit(request, env, ctx, platform) {
  if (!env.HASH_SALT || !env.VISITS) return;
  const date = utcDate(Date.now());
  const who = await visitorKey(request, env.HASH_SALT, date);
  const key = `u:${date}:${who}`;

  const cache = caches.default;
  const marker = new Request(`${new URL(request.url).origin}/__seen/${key}`, { method: 'GET' });
  if (await cache.match(marker)) return;

  ctx.waitUntil(
    Promise.all([
      // ⚠️ OS 는 **값이 아니라 metadata 로** 넣는다 — 집계는 `list()` 로 도는데 그 응답에는
      //    값이 오지 않고 metadata 만 온다. 값에 넣으면 OS 별 칸이 전부 0 으로 나온다.
      env.VISITS.put(key, '1', { expirationTtl: KEY_TTL_SECONDS, metadata: { platform } }),
      // 자정까지만 유효하면 충분하지만, 캐시는 어차피 최선 노력이라 6시간으로 둔다.
      cache.put(marker, new Response('1', { headers: { 'cache-control': 'max-age=21600' } })),
    ]),
  );
}

/**
 * 사이트 방문·내려받기 클릭 계수(`/px?e=view|download`) — 사이트가 방문자 IP 를 제3자로 안 보내므로 세는 쪽도 우리다.
 * 업데이트 확인과 같은 방식(하루치 소금 → 16자 → 35일 TTL)이고 `e` 만 읽는다(경로·리퍼러·쿼리 ❌).
 */
const PX_EVENTS = new Set(['view', 'download']);

async function servePx(request, env, ctx, url) {
  const event = url.searchParams.get('e') ?? 'view';
  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  };
  if (!PX_EVENTS.has(event)) return new Response(null, { status: 204, headers });

  if (env.HASH_SALT && env.VISITS) {
    const date = utcDate(Date.now());
    const who = await visitorKey(request, env.HASH_SALT, date);
    // 조회는 방문자당 하루 1회, 내려받기 클릭은 **누를 때마다** 센다(그게 의도 지표다).
    const key =
      event === 'download' ? `p:${date}:download:${who}:${crypto.randomUUID()}` : `p:${date}:view:${who}`;
    ctx.waitUntil(env.VISITS.put(key, '1', { expirationTtl: KEY_TTL_SECONDS, metadata: { event } }));
  }
  return new Response(null, { status: 204, headers });
}

/** 피드 파일 이름 → 그 파일을 묻는 플랫폼. 집계에서 OS 별로 가르는 데만 쓴다. */
function platformOf(file) {
  if (file === 'latest-mac.yml') return 'mac';
  if (file === 'latest-linux.yml') return 'linux';
  return 'win';
}

async function serveFeed(request, env, ctx, file) {
  await recordVisit(request, env, ctx, platformOf(file));

  const upstream = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${file}`;
  // yml 은 몇 KB 라 그대로 넘긴다. 5분 캐시 — 새 릴리스 인지가 그만큼 늦을 수 있지만
  // 앱의 확인 주기가 4시간이라 체감되지 않고, GitHub 쪽 부담과 응답 시간이 줄어든다.
  const res = await fetch(upstream, {
    method: 'GET',
    redirect: 'follow',
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  const headers = new Headers({
    'content-type': 'text/yaml; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
  if (!res.ok) {
    return new Response(request.method === 'HEAD' ? null : 'upstream error', {
      status: 502,
      headers,
    });
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(await res.text(), { status: 200, headers });
}

/** 날짜별 집계. 개별 표식은 내보내지 않는다 — 나가는 것은 숫자뿐이다. */
async function serveStats(env) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=600',
    'access-control-allow-origin': '*',
  };
  if (!env.VISITS) return new Response(JSON.stringify({ error: 'no store' }), { status: 503, headers });

  /** 한 접두사의 키를 끝까지 세면서, 원하면 metadata 로 갈라 센다. */
  const tally = async (prefix, split) => {
    let cursor;
    let total = 0;
    const buckets = {};
    do {
      const page = await env.VISITS.list({ prefix, cursor });
      total += page.keys.length;
      if (split) {
        for (const k of page.keys) {
          const v = k.metadata?.[split];
          if (v) buckets[v] = (buckets[v] ?? 0) + 1;
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return { total, buckets };
  };

  const today = Date.now();
  const days = [];
  for (let i = 0; i < STATS_DAYS; i += 1) {
    const date = utcDate(today - i * 86_400_000);
    const installs = await tally(`u:${date}:`, 'platform');
    const views = await tally(`p:${date}:view:`);
    const downloads = await tally(`p:${date}:download:`);
    days.push({
      date,
      // 그날 업데이트를 물어 온 설치 수(같은 설치는 하루에 한 번만 센다).
      active: installs.total,
      byPlatform: {
        win: installs.buckets.win ?? 0,
        mac: installs.buckets.mac ?? 0,
        linux: installs.buckets.linux ?? 0,
      },
      // 사이트 쪽 — 방문자 수(하루 1회)와 내려받기 누름(누를 때마다).
      siteVisitors: views.total,
      downloadClicks: downloads.total,
    });
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), days }, null, 2), {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/+/, '');

    // `sendBeacon` 은 POST 로 온다 — 메서드 검사보다 먼저 받는다.
    if (name === 'px') return servePx(request, env, ctx, url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }
    // 집계는 요청마다 KV 를 30일 × 3접두사 = 90회 훑는다. 엣지 캐시를 앞에 두지 않으면
    // 이 주소를 아는 누구든 두드리는 것만으로 무료 읽기 한도를 태울 수 있다(그러면 계수가
    // 아니라 **집계 조회**가 죽는다 — 쓰기는 별 한도라 계수 자체는 계속 돈다).
    if (name === 'stats') {
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await serveStats(env);
      // 실패한 응답은 캐시하지 않는다 — 10분 동안 같은 오류를 되돌려 주게 된다.
      if (res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }
    if (FEED_FILES.has(name)) return serveFeed(request, env, ctx, name);
    // 자산은 GitHub 이 내준다 — 우리는 길만 알려준다.
    if (ASSET_EXT.test(name) && !name.includes('/')) {
      return Response.redirect(assetUrl(name), 302);
    }
    return new Response('not found', { status: 404 });
  },
};
