"""Keep JS/CSS readable without requiring Node.js. Run with the pinned dev tools."""
from __future__ import annotations

import argparse
from pathlib import Path

import cssbeautifier
import jsbeautifier

ROOT = Path(__file__).resolve().parents[1]


def formatted(path: Path) -> str:
    text = path.read_text(encoding='utf-8')
    module = jsbeautifier if path.suffix == '.js' else cssbeautifier
    options = module.default_options()
    options.indent_size = 2
    options.indent_char = ' '
    options.end_with_newline = True
    if path.suffix == '.js':
        options.max_preserve_newlines = 2
        options.unescape_strings = False
    # Normalize to a fixed point: a multiline ternary can need a second pass.
    for _ in range(4):
        output = module.beautify(text, options)
        if output == text:
            return output
        text = output
    raise ValueError(f'Formatter did not stabilize: {path.name}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Format sources in place (then rebuild index.html)')
    args = parser.parse_args()
    changed = []
    for path in sorted((ROOT / 'src').glob('*')):
        if path.suffix not in {'.js', '.css'}:
            continue
        output = formatted(path)
        if path.read_text(encoding='utf-8') == output:
            continue
        changed.append(path.relative_to(ROOT).as_posix())
        if args.write:
            path.write_text(output, encoding='utf-8')
    if changed:
        print(('Formatted: ' if args.write else 'Formatting required: ') + ', '.join(changed))
    else:
        print('JS/CSS formatting is current')
    return 0 if args.write or not changed else 1


if __name__ == '__main__':
    raise SystemExit(main())
