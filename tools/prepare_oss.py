#!/usr/bin/env python3
"""Prepare the portfolio's reachable assets for OSS, without changing live pages.

Run with an output directory outside the repository. Upload its `upload` folder
contents to the existing bucket root, then use --activate only after verification.
No credentials are read or stored by this script.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://cancan-portfolio-media.oss-cn-shanghai.aliyuncs.com'
SITE_ORIGIN = 'https://furinaaa-cancan.github.io'
PAGES = ('index.html', 'projects/legal-ai/index.html', 'projects/rem-lab/index.html')
ATTR = re.compile(r'\b(src|href|poster|srcset)=([' + '\"\'' + r'])(.*?)\2', re.S)
CSS_URL = re.compile(r'url\(\s*[\"\']?([^\)\"\']+)')
EXISTING_VIDEO = {'assets/showreel.mp4', 'assets/showreel-10bit.mp4'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_asset(value, parent):
    parsed = urlsplit(value)
    if parsed.scheme == 'https' and parsed.netloc == urlsplit(ORIGIN).netloc:
        published = re.fullmatch(r'/portfolio/[0-9a-f]{16}/(assets/.+)', unquote(parsed.path))
        if published:
            value = published[1]
            parent = ROOT
            parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path or unquote(parsed.path).startswith('#'):
        return None
    path = (parent / unquote(parsed.path)).resolve()
    if not path.is_relative_to(ROOT / 'assets'):
        return None
    if not path.is_file():
        raise ValueError(f'Missing asset: {path.relative_to(ROOT)}')
    return path.relative_to(ROOT).as_posix()


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in ('src', 'href', 'poster', 'srcset'):
                if key == 'srcset':
                    self.urls.extend(part.strip().split()[0] for part in value.split(','))
                else:
                    self.urls.append(value)


def prepare(output):
    if output.exists():
        raise ValueError('Use a new output directory; existing output is never overwritten.')
    if output.is_relative_to(ROOT):
        raise ValueError('Output must be outside the repository.')
    assets, pending = set(), list(PAGES)
    while pending:
        name = pending.pop()
        path = ROOT / name
        if path.suffix not in ('.html', '.css', '.svg'):
            continue
        source = path.read_text()
        refs = References()
        if path.suffix != '.css':
            refs.feed(source)
        for url in refs.urls + CSS_URL.findall(source):
            asset = local_asset(url, path.parent)
            if asset and asset not in assets and asset not in EXISTING_VIDEO:
                assets.add(asset)
                pending.append(asset)
    files = {name: {'sha256': digest(ROOT / name), 'bytes': (ROOT / name).stat().st_size}
             for name in sorted(assets)}
    release = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
    prefix = f'portfolio/{release}'
    for name in files:
        target = output / 'upload' / prefix / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    page_hashes = {}
    for name in PAGES:
        path = ROOT / name
        source = path.read_text()
        # Both codecs already exist on OSS. Drop the duplicate local fallbacks.
        source = re.sub(r'^\s*<source src="\.\./\.\./assets/showreel(?:-10bit)?\.mp4[^\n]*\n', '', source, flags=re.M)

        def rewrite(match):
            key, quote, value = match.groups()

            def replace_url(url):
                asset = local_asset(url, path.parent)
                return f'{ORIGIN}/{prefix}/{asset}' if asset else url

            if key == 'srcset':
                value = ', '.join(' '.join([replace_url(parts[0]), *parts[1:]])
                                  for part in value.split(',') if (parts := part.split()))
            else:
                value = replace_url(value)
            return f'{key}={quote}{value}{quote}'

        source = ATTR.sub(rewrite, source)
        source = source.replace(f'  <link rel="preconnect" href="{ORIGIN}" crossorigin />\n', '')
        source = source.replace('</head>', f'  <link rel="preconnect" href="{ORIGIN}" crossorigin />\n</head>')
        target = output / 'pages' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)
        page_hashes[name] = digest(path)
    manifest = {'prefix': prefix, 'assets': files, 'pages': page_hashes,
                'prepared_pages': {name: digest(output / 'pages' / name) for name in PAGES}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Prepared {len(files)} assets, {sum(item["bytes"] for item in files.values()) / 1048576:.2f} MiB.')
    print(f'Upload contents of {output / "upload"} to the bucket root, preserving paths.')
    print('Live pages are unchanged. Font CORS must allow https://furinaaa-cancan.github.io.')


def verify_and_activate(output):
    manifest = json.loads((output / 'manifest.json').read_text())
    # Check source and package freshness before any network request or write.
    for name, expected in manifest['pages'].items():
        if digest(ROOT / name) != expected:
            raise ValueError(f'Source changed; prepare again: {name}')
        if digest(output / 'pages' / name) != manifest['prepared_pages'][name]:
            raise ValueError(f'Prepared page changed: {name}')
    expected_types = {'.css': 'text/css', '.js': ('application/javascript', 'text/javascript'),
                      '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
                      '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'}
    for name, info in manifest['assets'].items():
        if digest(ROOT / name) != info['sha256']:
            raise ValueError(f'Asset changed; prepare again: {name}')
        url = f'{ORIGIN}/{manifest["prefix"]}/{name}'
        with urlopen(Request(url, method='HEAD', headers={'Origin': SITE_ORIGIN}), timeout=30) as res:
            if int(res.headers.get('Content-Length', -1)) != info['bytes']:
                raise ValueError(f'Wrong remote size: {name}')
            expected = expected_types.get(Path(name).suffix)
            expected = (expected,) if isinstance(expected, str) else expected
            if expected and res.headers.get_content_type() not in expected:
                raise ValueError(f'Wrong remote Content-Type: {name}')
            if name.endswith('.woff2') and res.headers.get('Access-Control-Allow-Origin') not in ('*', SITE_ORIGIN):
                raise ValueError(f'Font CORS is missing: {name}')
    for name in sorted(EXISTING_VIDEO):
        with urlopen(Request(f'{ORIGIN}/{Path(name).name}', method='HEAD'), timeout=30) as res:
            if res.headers.get_content_type() != 'video/mp4' or int(res.headers.get('Content-Length', 0)) <= 0:
                raise ValueError(f'Existing video unavailable: {name}')
    # All verification must pass before changing any source HTML.
    for name in PAGES:
        shutil.copyfile(output / 'pages' / name, ROOT / name)
    print('Verified all remote assets and font CORS; updated the three source pages.')
    print('Preview and review the diff before committing and publishing.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=lambda value: Path(value).expanduser().resolve())
    parser.add_argument('--activate', action='store_true', help='Verify uploads, then update source HTML.')
    args = parser.parse_args()
    try:
        verify_and_activate(args.output) if args.activate else prepare(args.output)
    except (ValueError, OSError) as error:
        raise SystemExit(f'Not activated: {error}')
