/** Python stdlib IO. No token is persisted, printed, or sent to a non-loopback address. */
export const VIBI3D_IO_PY = String.raw`import os, sys, json, math, re, time, uuid, base64, hashlib, struct, urllib.request, urllib.parse, urllib.error
from pathlib import Path

MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_BLOB_BYTES = 12 * 1024 * 1024
KEY = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$')

def valid_key(value):
    if not isinstance(value, str) or not KEY.fullmatch(value):
        raise ValueError('invalid-id')
    if re.fullmatch(r'(?i:con|prn|aux|nul|com[0-9]|lpt[0-9])', value):
        raise ValueError('reserved-id')
    return value

def inside(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('invalid-project-path')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('invalid-project-path')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root) or resolved == root:
        raise ValueError('path-outside-project')
    return resolved

def atomic_bytes(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name('.' + file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temporary, 'xb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, file)
    finally:
        if temporary.exists():
            temporary.unlink()

def atomic_json(file, value):
    atomic_bytes(file, json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8'))

def child_pointer(pointer, key):
    return pointer + '/' + str(key).replace('~', '~0').replace('/', '~1')

def array_key(item, index):
    key = (item.get('id') or item.get('uuid')) if isinstance(item, dict) else None
    return '@' + key if isinstance(key, str) and key else str(index)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('loopback-redirect-refused')

class CreationApi:
    def __init__(self, project_id):
        self.project_id = project_id
        self.base = os.environ.get('VIBISUAL_BASE', '').rstrip('/')
        if not self.base:
            raise ValueError('missing-vibisual-base')
        url = urllib.parse.urlsplit(self.base)
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.query or url.fragment or url.path:
            raise ValueError('loopback-base-required')
        self.token = os.environ.get('VIBISUAL_TOKEN') or os.environ.get('VIBISUAL_HOOK_AUTH')
        if not self.token:
            raise ValueError('missing-vibisual-hook-token')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.blobs = {}
        self.references = {}

    def request(self, method, route, body=None, raw=False):
        headers = {'x-vibisual-hook-token': self.token}
        if isinstance(body, bytes):
            headers['Content-Type'] = 'application/octet-stream'
            data = body
        elif body is not None:
            headers['Content-Type'] = 'application/json; charset=utf-8'
            data = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
            if len(data) > MAX_JSON_BYTES:
                raise ValueError('request-too-large: reduce mesh or texture size')
        else:
            data = None
        request = urllib.request.Request(self.base + '/api/app/creation' + route, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=60) as response:
                limit = MAX_BLOB_BYTES if raw else MAX_JSON_BYTES
                result = response.read(limit + 1)
                if len(result) > limit:
                    raise ValueError('response-too-large')
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')[:2000]
            raise RuntimeError('creation-http-' + str(error.code) + ': ' + detail) from None
        return result if raw else json.loads(result)

    def query(self):
        return '?projectId=' + urllib.parse.quote(self.project_id, safe='')

    def doc(self, doc_id):
        return self.request('GET', '/docs/' + urllib.parse.quote(doc_id, safe='') + self.query())['doc']

    def resolve(self, value, pointer=''):
        if pointer == '':
            self.references = {}
        if isinstance(value, str) and value.startswith('vibi-blob:'):
            name = value[10:]
            if name in self.blobs:
                result = self.blobs[name]
                self.references[pointer] = (result, value)
                return result
            if not re.fullmatch(r'[0-9a-f]{64}\.(png|jpg|webp|gif|avif|bmp|svg|bin|u32|f32|f64)', name):
                raise ValueError('invalid-blob-ref')
            data = self.request('GET', '/blobs/' + name + self.query(), raw=True)
            ext = name.rsplit('.', 1)[1]
            if hashlib.sha256(data).hexdigest() != name[:64]:
                raise ValueError('blob-hash-mismatch')
            if ext in ('u32', 'f32', 'f64'):
                code, size = {'u32': ('I', 4), 'f32': ('f', 4), 'f64': ('d', 8)}[ext]
                result = list(struct.unpack('<' + str(len(data) // size) + code, data))
                self.blobs[name] = result
                self.references[pointer] = (result, value)
                return result
            mime = {'jpg': 'image/jpeg', 'svg': 'image/svg+xml', 'bin': 'application/octet-stream'}.get(ext, 'image/' + ext)
            result = 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')
            self.blobs[name] = result
            self.references[pointer] = (result, value)
            return result
        if isinstance(value, dict):
            return {key: self.resolve(item, child_pointer(pointer, key)) for key, item in value.items()}
        if isinstance(value, list):
            return [self.resolve(item, child_pointer(pointer, array_key(item, index))) for index, item in enumerate(value)]
        return value

    def externalize(self, value, pointer=''):
        original = getattr(self, 'references', {}).get(pointer)
        if original is not None and value == original[0]:
            return original[1]  # Keep exact old blob references, including older noncanonical numeric encodings.
        if isinstance(value, list) and len(value) >= 64 and all(type(x) in (int, float) for x in value):
            if all(0 <= x <= 0xffffffff and x == int(x) for x in value):
                return self.upload(struct.pack('<' + str(len(value)) + 'I', *(int(x) for x in value)), 'u32')
            try:
                compact = struct.pack('<' + str(len(value)) + 'f', *value)
                if list(struct.unpack('<' + str(len(value)) + 'f', compact)) == value:
                    return self.upload(compact, 'f32')
            except OverflowError:
                pass
            return self.upload(struct.pack('<' + str(len(value)) + 'd', *value), 'f64')
        if isinstance(value, str) and value.startswith('data:image/') and ';base64,' in value and len(value) > 1024:
            header, encoded = value.split(';base64,', 1)
            ext = {'jpeg': 'jpg', 'svg+xml': 'svg'}.get(header[11:], header[11:])
            return self.upload(base64.b64decode(encoded), ext)
        if isinstance(value, dict):
            return {key: self.externalize(item, child_pointer(pointer, key)) for key, item in value.items()}
        if isinstance(value, list):
            return [self.externalize(item, child_pointer(pointer, array_key(item, index))) for index, item in enumerate(value)]
        return value

    def upload(self, data, ext):
        if len(data) > MAX_BLOB_BYTES:
            raise ValueError('blob-too-large: split parts or reduce mesh/texture size')
        return self.request('PUT', '/blobs' + self.query() + '&ext=' + ext, data)['ref']
`;
