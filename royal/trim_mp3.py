#!/usr/bin/env python3
"""يقصّ ملف MP3 عند حدود الإطارات (بلا إعادة ترميز) — يدعم MPEG1 و MPEG2/2.5."""
import sys

# [نسخة][طبقة][فهرس] — نستعمل الطبقة III فقط
BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def frames(b):
    """يرجع [(offset, length, seconds)] لكل إطار سليم."""
    i = 0
    if b[:3] == b"ID3":
        sz = (b[6] & 0x7F) << 21 | (b[7] & 0x7F) << 14 | (b[8] & 0x7F) << 7 | (b[9] & 0x7F)
        i = 10 + sz
    out = []
    start = i
    while i + 4 <= len(b):
        if b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0:
            ver = (b[i + 1] >> 3) & 3          # 3=MPEG1  2=MPEG2  0=MPEG2.5
            lay = (b[i + 1] >> 1) & 3          # 1 = Layer III
            bi = (b[i + 2] >> 4) & 0xF
            si = (b[i + 2] >> 2) & 3
            pad = (b[i + 2] >> 1) & 1
            if lay == 1 and ver != 1 and bi not in (0, 15) and si != 3:
                br = (BR_V1 if ver == 3 else BR_V2)[bi] * 1000
                sr = SR[ver][si]
                spf = 1152 if ver == 3 else 576
                flen = int((spf // 8) * br / sr) + pad
                if flen > 4:
                    out.append((i, flen, spf / sr))
                    i += flen
                    continue
        i += 1
    return out, start


def trim(src, dst, seconds):
    b = open(src, "rb").read()
    fr, start = frames(b)
    if not fr:
        raise SystemExit("لم أجد إطارات MP3 في " + src)
    total = sum(f[2] for f in fr)
    keep, t = 0, 0.0
    for f in fr:
        if t >= seconds:
            break
        t += f[2]
        keep += 1
    end = fr[keep - 1][0] + fr[keep - 1][1]
    open(dst, "wb").write(b[start:end])
    print("%s: %.2fs (%d كب)  ->  %s: %.2fs (%d كب)"
          % (src.split("/")[-1], total, len(b) / 1024,
             dst.split("/")[-1], t, (end - start) / 1024))


if __name__ == "__main__":
    trim(sys.argv[1], sys.argv[2], float(sys.argv[3]))
