// Just enough TOML to read `codex -c key=value` overrides: dotted keys, basic/literal strings, booleans, numbers,
// arrays and inline tables. Codex treats a value that does not parse as TOML as a plain string; so does this.

/** @param {string} src */
export function parseTomlValue(src) {
  let i = 0;
  const fail = (msg) => {
    throw new Error(`${msg} at ${i}`);
  };
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };
  const basic = () => {
    i += 1;
    let out = '';
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\') {
        const e = src[i + 1];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
        if (e in map) {
          out += map[e];
          i += 2;
        } else if (e === 'u' || e === 'U') {
          const len = e === 'u' ? 4 : 8;
          out += String.fromCodePoint(parseInt(src.slice(i + 2, i + 2 + len), 16));
          i += 2 + len;
        } else fail('bad escape');
      } else {
        out += src[i];
        i += 1;
      }
    }
    if (src[i] !== '"') fail('unterminated string');
    i += 1;
    return out;
  };
  const literal = () => {
    const end = src.indexOf("'", i + 1);
    if (end < 0) fail('unterminated literal');
    const out = src.slice(i + 1, end);
    i = end + 1;
    return out;
  };
  const key = () => {
    ws();
    if (src[i] === '"') return basic();
    if (src[i] === "'") return literal();
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
    if (!m) fail('bad key');
    i += m[0].length;
    return m[0];
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '"') return basic();
    if (c === "'") return literal();
    if (c === '[') {
      i += 1;
      const arr = [];
      ws();
      while (src[i] !== ']') {
        arr.push(value());
        ws();
        if (src[i] === ',') {
          i += 1;
          ws();
        } else if (src[i] !== ']') fail('expected , or ]');
      }
      i += 1;
      return arr;
    }
    if (c === '{') {
      i += 1;
      const obj = {};
      ws();
      while (src[i] !== '}') {
        const path = [key()];
        ws();
        while (src[i] === '.') {
          i += 1;
          path.push(key());
          ws();
        }
        if (src[i] !== '=') fail('expected =');
        i += 1;
        setPath(obj, path, value());
        ws();
        if (src[i] === ',') {
          i += 1;
          ws();
        } else if (src[i] !== '}') fail('expected , or }');
      }
      i += 1;
      return obj;
    }
    const m = /^(true|false|[+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (!m) fail('bad value');
    i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    return Number(m[0].replace(/_/g, ''));
  };
  try {
    const v = value();
    ws();
    if (i !== src.length) fail('trailing input');
    return v;
  } catch {
    return src;
  }
}

/** @param {Record<string, any>} obj @param {string[]} path @param {unknown} v */
export function setPath(obj, path, v) {
  let cur = obj;
  for (const part of path.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[path[path.length - 1]] = v;
}

/** Splits a dotted `-c` key, honouring quoted segments (`hooks.state."a.b"`). */
export function splitKey(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1);
      out.push(raw.slice(i + 1, end < 0 ? raw.length : end));
      i = end < 0 ? raw.length : end + 1;
    } else {
      const dot = raw.indexOf('.', i);
      out.push(raw.slice(i, dot < 0 ? raw.length : dot));
      i = dot < 0 ? raw.length : dot;
    }
    if (raw[i] === '.') i += 1;
  }
  return out;
}

/** `-c a.b=v` pairs from argv → one nested config object (later overrides win, like the CLI). */
export function parseOverrides(argv) {
  const config = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const pair = arg === '-c' || arg === '--config' ? argv[(i += 1)] : arg.startsWith('--config=') ? arg.slice(9) : null;
    if (pair == null) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    setPath(config, splitKey(pair.slice(0, eq).trim()), parseTomlValue(pair.slice(eq + 1).trim()));
  }
  return config;
}
