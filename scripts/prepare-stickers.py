#!/usr/bin/env python3
"""Offline asset preparation: resize, convert to PNG and quantize with pngquant."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--size', type=int, default=192)
args = parser.parse_args()
files = sorted(p for p in args.source.rglob('*') if p.suffix.lower() in ('.webp', '.png'))
if not files:
    raise SystemExit('No input images')
if args.source.resolve() == args.output.resolve():
    raise SystemExit('Use separate source and output directories')

def convert(source):
    destination = args.output / source.relative_to(args.source).with_suffix('.png')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='stickers-png-') as temp:
        uncompressed = Path(temp) / 'resized.png'
        subprocess.run(['magick', str(source), '-auto-orient', '-resize', f'{args.size}x{args.size}>', '-strip', f'PNG32:{uncompressed}'], check=True)
        subprocess.run(['pngquant', '--strip', '--speed', '1', '--quality', '70-95', '--force', '--output', str(destination), str(uncompressed)], check=True)
        return {'file': str(destination.relative_to(args.output)), 'source_bytes': source.stat().st_size, 'resized_png_bytes': uncompressed.stat().st_size, 'quantized_bytes': destination.stat().st_size}

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(convert, files))
report = {'size': args.size, 'count': len(results), 'source_bytes': sum(r['source_bytes'] for r in results), 'resized_png_bytes': sum(r['resized_png_bytes'] for r in results), 'quantized_bytes': sum(r['quantized_bytes'] for r in results), 'files': results}
args.output.mkdir(parents=True, exist_ok=True)
(args.output / 'conversion-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}))
