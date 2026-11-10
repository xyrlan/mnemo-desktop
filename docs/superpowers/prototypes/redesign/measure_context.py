"""Measure how well a transcript's last call predicts the size of the session's context.

    python measure_context.py [N]      # the N newest transcripts on this machine, default 400

`capture.py` reports a session's context as the last main-chain call's
input + cache read + cache written + output tokens. Claude Code states the true size at one
moment only: a `compact_boundary` record carries `preTokens`, the context it was about to
compact. This compares the two at every compaction it finds, with and without the output
tokens, and prints the error.

Run on the maintainer's machine on 2026-11-09 over 400 transcripts: 108 compactions, from
200,512 to 967,338 tokens; with output, median error 0.00% and largest 0.4%; without it,
median -0.17% and largest 4.2%.
"""
import glob
import json
import os
import statistics
import sys


def compactions(path):
    last = None
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get('type') == 'assistant' and not r.get('isSidechain'):
                    m = r.get('message') or {}
                    if not str(m.get('model') or '').startswith('claude'):
                        continue
                    u = m.get('usage') or {}
                    last = (u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0)
                            + u.get('cache_creation_input_tokens', 0), u.get('output_tokens', 0))
                elif r.get('type') == 'system' and r.get('subtype') == 'compact_boundary' and last:
                    pre = (r.get('compactMetadata') or {}).get('preTokens')
                    if pre:
                        yield pre, last[0], last[0] + last[1]
                    last = None
    except OSError:
        return


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    files = sorted(glob.glob(os.path.join(os.path.expanduser('~'), '.claude*', 'projects', '*', '*.jsonl')),
                   key=os.path.getmtime, reverse=True)[:n]
    rows = [row for f in files for row in compactions(f)]
    if not rows:
        sys.exit('no compaction found in %d transcripts' % len(files))
    without = [a / pre - 1 for pre, a, _ in rows]
    with_out = [b / pre - 1 for pre, _, b in rows]
    print('%d transcripts, %d compactions, %d to %d tokens' % (
        len(files), len(rows), min(r[0] for r in rows), max(r[0] for r in rows)))
    print('input + caches + output: median %+.2f%%, largest %.1f%%' % (
        100 * statistics.median(with_out), 100 * max(map(abs, with_out))))
    print('input + caches:          median %+.2f%%, largest %.1f%%' % (
        100 * statistics.median(without), 100 * max(map(abs, without))))


if __name__ == '__main__':
    main()
