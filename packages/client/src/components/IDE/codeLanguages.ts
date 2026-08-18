/**
 * codeLanguages.ts — §5.5 #17-27 v4.87 내장 편집창의 **언어 사양 config 표**.
 *
 * 강조기를 새로 들이지 않는 대신(§5.5 #17-27 ④), 언어마다 "무엇이 주석이고 무엇이 문자열이며
 * 어떤 낱말이 키워드인가" 만 표로 적는다. 새 언어 추가 = 이 표에 한 줄(토크나이저는 손대지 않는다).
 *
 * 여기 없는 확장자는 `plain` 으로 떨어져 **색 없이** 그려진다 — 모르는 언어를 아는 척 칠하지 않는다.
 */

/** 색을 나눠 줄 토큰 갈래. */
export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'type'
  | 'function'
  | 'property'
  | 'punct';

/** 토큰 갈래 → Tailwind 색 클래스 (VS Code Dark+ 톤). */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: 'text-gray-200',
  comment: 'text-emerald-600/90 italic',
  string: 'text-orange-300',
  number: 'text-lime-300',
  keyword: 'text-violet-300',
  type: 'text-teal-300',
  function: 'text-yellow-200',
  property: 'text-sky-300',
  punct: 'text-gray-500',
};

/** 문자열 규칙 — 여는 기호/닫는 기호/역슬래시 이스케이프 여부/여러 줄 허용 여부. */
export interface StringRule {
  open: string;
  close: string;
  /** 역슬래시로 닫는 기호를 피할 수 있는가(대부분의 언어 = true) */
  escape?: boolean;
  /** 줄바꿈을 넘어 이어지는가(템플릿 리터럴·파이썬 삼중따옴표) */
  multiline?: boolean;
}

/** 한 언어의 사양. 없는 항목은 "그 규칙이 없다" 는 뜻이다. */
export interface LanguageSpec {
  id: string;
  /** code = 일반 프로그래밍 언어, markup = 태그 언어, markdown = 문서 */
  mode: 'code' | 'markup' | 'markdown';
  lineComments: string[];
  blockComments: [string, string][];
  strings: StringRule[];
  keywords: ReadonlySet<string>;
  types: ReadonlySet<string>;
  /** true/false/null 처럼 상수로 칠할 낱말 */
  literals: ReadonlySet<string>;
  /** 낱말 뒤에 `:` 가 오면 속성 색으로(json·yaml 의 키) */
  keyBeforeColon: boolean;
  /** 키워드 대소문자를 무시하는가(sql) */
  ignoreCase: boolean;
  /** `$이름` 을 변수로 칠하는가(shell) */
  dollarVars: boolean;
}

/** 표를 짧게 쓰기 위한 기본값 채우개 — 안 적은 규칙은 "없음". */
function spec(id: string, partial: Partial<Omit<LanguageSpec, 'id'>>): LanguageSpec {
  return {
    id,
    mode: partial.mode ?? 'code',
    lineComments: partial.lineComments ?? [],
    blockComments: partial.blockComments ?? [],
    strings: partial.strings ?? [],
    keywords: partial.keywords ?? new Set<string>(),
    types: partial.types ?? new Set<string>(),
    literals: partial.literals ?? new Set<string>(),
    keyBeforeColon: partial.keyBeforeColon ?? false,
    ignoreCase: partial.ignoreCase ?? false,
    dollarVars: partial.dollarVars ?? false,
  };
}

const QUOTES: StringRule[] = [
  { open: '"', close: '"', escape: true },
  { open: "'", close: "'", escape: true },
];

const C_COMMENTS = { lineComments: ['//'], blockComments: [['/*', '*/']] as [string, string][] };

const JS_KEYWORDS = [
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from',
  'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof',
  'let', 'new', 'of', 'package', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies',
  'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'declare', 'abstract', 'override', 'namespace', 'infer', 'asserts',
];
const JS_TYPES = [
  'any', 'bigint', 'boolean', 'never', 'number', 'object', 'string', 'symbol', 'unknown',
  'Array', 'Date', 'Error', 'Map', 'Promise', 'Record', 'RegExp', 'Set', 'WeakMap',
];
const JS_LITERALS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'];

const PY_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
];

const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'function', 'in', 'return', 'export', 'local', 'readonly', 'set', 'unset', 'source', 'echo', 'cd',
];

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create',
  'table', 'alter', 'drop', 'index', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group',
  'order', 'by', 'having', 'limit', 'offset', 'union', 'distinct', 'as', 'and', 'or', 'not', 'null',
];

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for',
  'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select',
  'struct', 'switch', 'type', 'var',
];

const RUST_KEYWORDS = [
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern',
  'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref',
  'return', 'self', 'static', 'struct', 'super', 'trait', 'type', 'unsafe', 'use', 'where', 'while',
];

const JAVA_KEYWORDS = [
  'abstract', 'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do',
  'else', 'enum', 'extends', 'final', 'finally', 'for', 'goto', 'if', 'implements', 'import',
  'instanceof', 'interface', 'native', 'new', 'package', 'private', 'protected', 'public', 'return',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
  'try', 'volatile', 'while', 'var', 'record', 'sealed', 'yield',
];

const C_KEYWORDS = [
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extern', 'for',
  'goto', 'if', 'inline', 'register', 'return', 'sizeof', 'static', 'struct', 'switch', 'typedef',
  'union', 'volatile', 'while', 'class', 'namespace', 'new', 'delete', 'template', 'typename',
  'public', 'private', 'protected', 'virtual', 'using', 'this', 'try', 'catch', 'throw', 'operator',
];

const C_TYPES = [
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void', 'size_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
];

/** 언어 사양 표 — 새 언어는 여기 한 줄. */
export const LANGUAGES: Record<string, LanguageSpec> = {
  plain: spec('plain', {}),

  ts: spec('ts', {
    ...C_COMMENTS,
    strings: [...QUOTES, { open: '`', close: '`', escape: true, multiline: true }],
    keywords: new Set(JS_KEYWORDS),
    types: new Set(JS_TYPES),
    literals: new Set(JS_LITERALS),
  }),

  json: spec('json', {
    ...C_COMMENTS, // .vscode/*.json 처럼 주석이 든 JSONC 도 그대로 읽힌다
    strings: [{ open: '"', close: '"', escape: true }],
    literals: new Set(['true', 'false', 'null']),
    keyBeforeColon: true,
  }),

  css: spec('css', {
    blockComments: [['/*', '*/']],
    lineComments: ['//'], // scss/less
    strings: QUOTES,
    keywords: new Set([
      'import', 'media', 'supports', 'keyframes', 'font-face', 'charset', 'use', 'apply', 'layer',
      'tailwind', 'theme', 'screen', 'variants', 'mixin', 'include', 'extend', 'if', 'else', 'each',
    ]),
    keyBeforeColon: true,
  }),

  html: spec('html', { mode: 'markup', blockComments: [['<!--', '-->']], strings: QUOTES }),

  markdown: spec('markdown', { mode: 'markdown', strings: [{ open: '`', close: '`' }] }),

  python: spec('python', {
    lineComments: ['#'],
    strings: [
      { open: '"""', close: '"""', multiline: true },
      { open: "'''", close: "'''", multiline: true },
      ...QUOTES,
    ],
    keywords: new Set(PY_KEYWORDS),
    types: new Set(['bool', 'bytes', 'dict', 'float', 'int', 'list', 'set', 'str', 'tuple']),
    literals: new Set(['True', 'False', 'None', 'self', 'cls']),
  }),

  shell: spec('shell', {
    lineComments: ['#'],
    strings: QUOTES,
    keywords: new Set(SHELL_KEYWORDS),
    dollarVars: true,
  }),

  yaml: spec('yaml', {
    lineComments: ['#'],
    strings: QUOTES,
    literals: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
    keyBeforeColon: true,
  }),

  toml: spec('toml', {
    lineComments: ['#'],
    strings: QUOTES,
    literals: new Set(['true', 'false']),
    keyBeforeColon: true,
  }),

  ini: spec('ini', { lineComments: ['#', ';'], strings: QUOTES, keyBeforeColon: true }),

  sql: spec('sql', {
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    strings: [{ open: "'", close: "'", escape: true }],
    keywords: new Set(SQL_KEYWORDS),
    ignoreCase: true,
  }),

  go: spec('go', {
    ...C_COMMENTS,
    strings: [...QUOTES, { open: '`', close: '`', multiline: true }],
    keywords: new Set(GO_KEYWORDS),
    types: new Set(['bool', 'byte', 'error', 'float32', 'float64', 'int', 'int32', 'int64', 'rune', 'string', 'uint']),
    literals: new Set(['true', 'false', 'nil', 'iota']),
  }),

  rust: spec('rust', {
    ...C_COMMENTS,
    strings: QUOTES,
    keywords: new Set(RUST_KEYWORDS),
    types: new Set(['bool', 'char', 'f32', 'f64', 'i8', 'i16', 'i32', 'i64', 'isize', 'str', 'u8', 'u16', 'u32', 'u64', 'usize', 'String', 'Vec', 'Option', 'Result']),
    literals: new Set(['true', 'false', 'None', 'Some', 'Ok', 'Err']),
  }),

  java: spec('java', {
    ...C_COMMENTS,
    strings: QUOTES,
    keywords: new Set(JAVA_KEYWORDS),
    types: new Set(['boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'void', 'String', 'Object', 'List', 'Map']),
    literals: new Set(['true', 'false', 'null']),
  }),

  c: spec('c', {
    ...C_COMMENTS,
    strings: QUOTES,
    keywords: new Set(C_KEYWORDS),
    types: new Set(C_TYPES),
    literals: new Set(['true', 'false', 'NULL', 'nullptr']),
  }),

  csharp: spec('csharp', {
    ...C_COMMENTS,
    strings: QUOTES,
    keywords: new Set([...JAVA_KEYWORDS, 'async', 'await', 'base', 'checked', 'delegate', 'event', 'fixed', 'foreach', 'in', 'internal', 'is', 'lock', 'namespace', 'operator', 'out', 'params', 'readonly', 'ref', 'sealed', 'sizeof', 'stackalloc', 'struct', 'typeof', 'unsafe', 'using', 'virtual', 'where']),
    types: new Set(['bool', 'byte', 'char', 'decimal', 'double', 'float', 'int', 'long', 'object', 'sbyte', 'short', 'string', 'uint', 'ulong', 'ushort', 'void', 'var']),
    literals: new Set(['true', 'false', 'null', 'this']),
  }),
};

/** 확장자(소문자) → 언어 id. 없는 확장자는 `plain`. */
export const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts', mts: 'ts', cts: 'ts',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', pyi: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java', kt: 'java', kts: 'java', groovy: 'java', swift: 'java', scala: 'java',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c', m: 'c', mm: 'c',
  cs: 'csharp',
  php: 'ts', rb: 'python', pl: 'python', lua: 'python', r: 'python',
};

/** 확장자가 없는 잘 알려진 파일 이름 → 언어 id. */
const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'shell',
  makefile: 'shell',
  gitignore: 'ini',
  gitattributes: 'ini',
  npmrc: 'ini',
  editorconfig: 'ini',
  '.env': 'ini',
};

/** 파일 경로 → 언어 id. 표에 없으면 `plain`(색 없이 그린다). */
export function languageFromPath(filePath: string): string {
  const name = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (!name) return 'plain';
  const byName = FILENAME_LANGUAGE[name] ?? FILENAME_LANGUAGE[name.replace(/^\./, '')];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plain';
  return EXTENSION_LANGUAGE[name.slice(dot + 1)] ?? 'plain';
}

/** 언어 id → 사양. 모르는 id 는 `plain` 사양. */
export function languageSpec(id: string): LanguageSpec {
  return LANGUAGES[id] ?? LANGUAGES['plain']!;
}
