"""Screenshot a prototype page with the machine's own headless Chrome or Edge, and print
what its console said, so a page can be looked at and checked without a human at a browser.

    python shot.py console/index.html out.png                      # 2560x1440, real data
    python shot.py "console/index.html?data=sample#focus=…" out.png --size 1366x768

The page is given two seconds of virtual time to settle (`--wait MS` changes it). A state
worth a screenshot must be reachable from the URL alone, which is why every concept reads
its view from the hash. Exit code 1 when the console logged an error.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

CANDIDATES = [
    os.environ.get('CHROME'),
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    shutil.which('google-chrome'), shutil.which('chromium'), shutil.which('chromium-browser'),
    shutil.which('microsoft-edge'),
]


def browser():
    for c in CANDIDATES:
        if c and os.path.exists(c):
            return c
    sys.exit('no Chrome or Edge found; set CHROME to its path')


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    if len(args) < 2:
        sys.exit(__doc__)
    size = argv[argv.index('--size') + 1] if '--size' in argv else '2560x1440'
    wait = argv[argv.index('--wait') + 1] if '--wait' in argv else '2000'
    if '--size' in argv:
        args = [a for a in args if a != size]
    if '--wait' in argv:
        args = [a for a in args if a != wait]
    page, out = args[0], os.path.abspath(args[1])
    path, sep, rest = page.partition('?') if '?' in page else page.partition('#')
    url = pathlib.Path(os.path.abspath(path)).as_uri() + sep + rest
    with tempfile.TemporaryDirectory() as profile:
        run = subprocess.run([
            browser(), '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
            '--allow-file-access-from-files', '--force-device-scale-factor=1',
            '--user-data-dir=' + profile, '--window-size=' + size.replace('x', ','),
            '--virtual-time-budget=' + wait, '--enable-logging=stderr', '--v=0',
            '--screenshot=' + out, url,
        ], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    console = [line for line in run.stderr.splitlines() if 'CONSOLE' in line]
    errors = [line for line in console if 'Uncaught' in line or ':ERROR:' in line or '"error"' in line.lower()]
    for line in console:
        print(line.split('CONSOLE', 1)[1].strip())
    ok = os.path.exists(out)
    print(('wrote ' + out) if ok else 'no screenshot written', '· %d console lines, %d errors' % (len(console), len(errors)))
    return 1 if errors or not ok else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
