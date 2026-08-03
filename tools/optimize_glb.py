#!/usr/bin/env python3
"""
مُحسِّن ملفات GLB.

الوضع الافتراضي «بلا فقدان» (lossless): لا يمسّ أي بكسل ولا أي رأس —
  • تحويل فهارس uint32 إلى uint16 حين يسمح أكبر فهرس (نفس القيم تماماً)
  • حذف مجموعات TEXCOORD_n التي لا تشير إليها أي خامة (لا تُقرأ أصلاً)
  • دمج البيانات المكرّرة حرفياً (نماذج سكتشفاب تكرّر الهندسة كثيراً)
  • إعادة بناء المخزن بإزالة الفراغات والبيانات غير المرجعية

الوضع المُفقِد (--lossy) يضيف: حذف TANGENT وتحويل PNG المصمت إلى JPEG.
"""
import json, struct, sys, io, os, hashlib
from PIL import Image

COMP_SZ = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def read_glb(path):
    d = open(path, 'rb').read()
    magic, _, length = struct.unpack('<III', d[:12])
    assert magic == 0x46546C67, 'not a glb'
    off, js, binc = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def write_glb(path, js, binc):
    jsb = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jsb += b' ' * ((4 - len(jsb) % 4) % 4)
    binc = binc + b'\0' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jsb) + 8 + len(binc)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jsb), 0x4E4F534A)); f.write(jsb)
        f.write(struct.pack('<II', len(binc), 0x004E4942)); f.write(binc)
    return total


def accessor_bytes(js, binc, ai):
    a = js['accessors'][ai]
    assert 'sparse' not in a, 'sparse accessors unsupported'
    elem = NUM[a['type']] * COMP_SZ[a['componentType']]
    if 'bufferView' not in a:
        return b'\0' * (elem * a['count'])
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or elem
    if stride == elem:
        return binc[base:base + elem * a['count']]
    out = bytearray()
    for i in range(a['count']):
        o = base + i * stride
        out += binc[o:o + elem]
    return bytes(out)


def max_texcoord(js):
    mx = 0
    def scan(ti):
        nonlocal mx
        if isinstance(ti, dict) and 'index' in ti:
            mx = max(mx, ti.get('texCoord', 0))
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for k in ('baseColorTexture', 'metallicRoughnessTexture'):
            scan(pbr.get(k))
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            scan(m.get(k))
        for ext in (m.get('extensions') or {}).values():
            if isinstance(ext, dict):
                for v in ext.values():
                    scan(v)
    return mx


def protected_images(js):
    """صور لا تُحوَّل إلى JPEG: الشفافة وخرائط البيانات (normal/ORM)"""
    need = set()
    def src_of(ti):
        return js['textures'][ti['index']].get('source') if ti else None
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        if m.get('alphaMode', 'OPAQUE') != 'OPAQUE':
            s = src_of(pbr.get('baseColorTexture'))
            if s is not None: need.add(s)
        for ti in (m.get('normalTexture'), m.get('occlusionTexture'),
                   pbr.get('metallicRoughnessTexture')):
            s = src_of(ti)
            if s is not None: need.add(s)
    return need


def optimize(src, dst, lossless=True, jpeg_quality=90, verbose=True):
    js, binc = read_glb(src)
    before = os.path.getsize(src)
    maxtc = max_texcoord(js)
    keep = protected_images(js)
    stats = {'idx16': 0, 'uv_dropped': 0, 'tangent': 0, 'jpeg': 0, 'dedup': 0}

    # ---- 1) تنظيف السمات ----
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if not lossless and 'TANGENT' in attrs:
                del attrs['TANGENT']; stats['tangent'] += 1
            for k in list(attrs):
                if k.startswith('TEXCOORD_') and int(k.split('_')[1]) > maxtc:
                    del attrs[k]; stats['uv_dropped'] += 1

    # ---- 2) مُقدّمو الوصول المرجعيون ----
    used = set()
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            used.update(prim['attributes'].values())
            if 'indices' in prim:
                used.add(prim['indices'])
            for t in prim.get('targets', []):
                used.update(t.values())
    for anim in js.get('animations', []):
        for s in anim['samplers']:
            used.add(s['input']); used.add(s['output'])
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            used.add(sk['inverseBindMatrices'])

    # ---- 3) تصغير الفهارس (بلا فقدان: نفس القيم) ----
    new_data = {}
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            ai = prim.get('indices')
            if ai is None or ai in new_data:
                continue
            a = js['accessors'][ai]
            if a['componentType'] != 5125:
                continue
            raw = accessor_bytes(js, binc, ai)
            vals = struct.unpack('<%dI' % a['count'], raw[:4 * a['count']])
            if vals and max(vals) < 65536:
                new_data[ai] = struct.pack('<%dH' % len(vals), *vals)
                a['componentType'] = 5123
                stats['idx16'] += 1

    # ---- 4) إعادة بناء المخزن ----
    new_bin = bytearray()
    new_views = []
    pool = {}          # بصمة البيانات -> فهرس العرض (دمج المكرّر)

    def add_view(data, dedup=True):
        if dedup:
            h = hashlib.blake2b(data, digest_size=16).digest()
            hit = pool.get(h)
            if hit is not None:
                stats['dedup'] += len(data)
                return hit
        while len(new_bin) % 4:
            new_bin.append(0)
        off = len(new_bin)
        new_bin.extend(data)
        new_views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        idx = len(new_views) - 1
        if dedup:
            pool[h] = idx
        return idx

    for ai, a in enumerate(js['accessors']):
        if ai not in used:
            a.pop('bufferView', None)          # نتركه موجوداً لئلا تنكسر الفهرسة
            a.pop('byteOffset', None)
            continue
        data = new_data.get(ai) or accessor_bytes(js, binc, ai)
        a['bufferView'] = add_view(data)
        a.pop('byteOffset', None)

    # ---- 5) الصور ----
    if js.get('images'):
        out_imgs = []
        for i, im in enumerate(js['images']):
            if 'bufferView' not in im:
                out_imgs.append(im); continue
            bv = js['bufferViews'][im['bufferView']]
            raw = binc[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
            mime = im.get('mimeType', 'image/png')
            if not lossless and mime == 'image/png' and i not in keep and len(raw) > 120_000:
                try:
                    pil = Image.open(io.BytesIO(raw))
                    if pil.mode != 'RGB':
                        conv = pil.convert('RGBA')
                        if conv.getchannel('A').getextrema()[0] == 255:
                            pil = conv.convert('RGB')
                    if pil.mode == 'RGB':
                        buf = io.BytesIO()
                        pil.save(buf, 'JPEG', quality=jpeg_quality, optimize=True, progressive=True)
                        if buf.tell() < len(raw):
                            raw = buf.getvalue(); mime = 'image/jpeg'; stats['jpeg'] += 1
                except Exception as e:
                    if verbose: print('   ! image', i, e)
            im = dict(im); im['mimeType'] = mime
            im['bufferView'] = add_view(raw)
            out_imgs.append(im)
        js['images'] = out_imgs

    js['bufferViews'] = new_views
    js['buffers'] = [{'byteLength': len(new_bin)}]
    size = write_glb(dst, js, bytes(new_bin))
    if verbose:
        mode = 'lossless' if lossless else 'lossy'
        print(f'   {os.path.basename(src)} [{mode}]: {before/1e6:.1f}MB -> {size/1e6:.1f}MB '
              f'({100*(1-size/before):.0f}% أصغر)  dedup={stats["dedup"]/1e6:.1f}MB '
              f'idx16={stats["idx16"]} uv={stats["uv_dropped"]} jpeg={stats["jpeg"]}')
    return size


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--lossy']
    lossless = '--lossy' not in sys.argv
    for i in range(0, len(args), 2):
        optimize(args[i], args[i + 1], lossless=lossless)
