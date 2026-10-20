#!/usr/bin/env python3
"""Stage the original DAW's referenced project media for the existing OSS bucket.

Usage: python3 tools/prepare_daw.py --project /path/to/project --output /tmp/new-release
The source project is read only. No credentials, upload, or activation are involved.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def prepare(project, output):
    if output.exists():
        raise ValueError('Use a new output directory.')
    project = project.resolve()
    data = json.loads((project / 'project.json').read_text())
    files = {'project.json'}

    def collect(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ('file', 'peaks', 'spec', 'pitch', 'pitchTarget', 'fp') and isinstance(value, str):
                    path = (project / value).resolve()
                    if not path.is_relative_to(project) or not path.is_file():
                        raise ValueError(f'Missing or invalid project resource: {value}')
                    files.add(value)
                else:
                    collect(value)
        elif isinstance(node, list):
            for value in node:
                collect(value)

    collect(data)
    assets = {}
    for name in sorted(files):
        content = (project / name).read_bytes()
        assets[name] = {'sha256': hashlib.sha256(content).hexdigest(),
                        'md5': hashlib.md5(content).hexdigest(), 'bytes': len(content)}
    revision = hashlib.sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest()[:16]
    prefix = f'portfolio/{revision}/assets/rem-lab/daw/project'
    for name in assets:
        target = output / 'upload' / prefix / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(project / name, target)
    manifest = {'prefix': prefix, 'assets': assets,
                'counts': {k: len(data[k]) for k in ('tracks', 'versions', 'issues', 'comps')}}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'prefix': prefix, 'files': len(assets),
                      'MiB': round(sum(x['bytes'] for x in assets.values()) / 1048576, 2),
                      'counts': manifest['counts']}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.project, args.output)
