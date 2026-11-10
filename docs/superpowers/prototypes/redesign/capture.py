"""Snapshot this machine's real sessions for the redesign concept prototypes.

    python capture.py [HOURS] [--no-gh]     # default 48; writes data.js beside this file

`data.js` (`window.MNEMO = …`) is gitignored: it carries real project names, prompts and
paths, and this repository is public. The prototypes fall back to `data.sample.js`, the
synthetic capture `sample.py` writes, when `data.js` is absent. `DATA.md` is the shape.

Everything here is read from disk or from read-only commands (`claude agents --json`,
`mnemo sessions --json`, and `gh pr view` for the pull requests the sessions opened, which
`--no-gh` skips); nothing is written outside this folder. Sources, per field, are named in
`DATA.md`.
"""
import base64
import glob
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser('~')
NOW = time.time()
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
NO_GH = '--no-gh' in sys.argv
HOURS = float(ARGS[0]) if ARGS else 48
START = NOW - HOURS * 3600
VAULT = os.environ.get('MNEMO_VAULT') or os.path.join(HOME, 'mnemo')
APP = os.path.join(HOME, '.mnemo-desktop')
SHOTS = os.path.join(HERE, 'shots')
ACTIVITY_CAP = 400      # newest tool calls kept per session
SERIES_CAP = 240        # points kept of a session's context curve
SHOTS_PER_SESSION = 6   # newest browser screenshots written per session
BUCKET_S = 300          # timeline bucket


def sh(*argv, env=None):
    try:
        return subprocess.run(argv, capture_output=True, text=True, encoding='utf-8',
                              errors='replace', env=env, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return ''


def loads(text, default):
    try:
        return json.loads(text)
    except ValueError:
        return default


def jsonl(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                if line.strip():
                    try:
                        yield json.loads(line)
                    except ValueError:
                        continue
    except OSError:
        return


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def ts(value):
    """Seconds since the epoch from an ISO string, a ms number or a s number."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e11 else float(value)
    try:
        s = str(value).replace('Z', '+00:00')
        if re.search(r'[+-]\d{4}$', s):
            s = s[:-2] + ':' + s[-2:]
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.astimezone()
        return d.timestamp()
    except ValueError:
        return None


def iso(t):
    return None if t is None else datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def home(s):
    s = str(s or '')
    for h in (HOME, HOME.replace('\\', '/'), HOME.replace('\\', '\\\\')):
        s = s.replace(h, '~')
    return s


def short(s, n):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s if len(s) <= n else s[: n - 1] + '…'


def slash(p):
    return home(p).replace('\\', '/')


# --- tool calls -------------------------------------------------------------------------

KINDS = {
    'Read': 'read', 'Grep': 'search-code', 'Glob': 'search-code', 'NotebookEdit': 'edit',
    'Edit': 'edit', 'Write': 'write', 'Bash': 'shell', 'PowerShell': 'shell',
    'WebSearch': 'web-search', 'WebFetch': 'web-fetch', 'Artifact': 'artifact',
    'Agent': 'agent', 'Workflow': 'agent', 'SendMessage': 'message', 'Skill': 'skill',
    'AskUserQuestion': 'ask', 'ToolSearch': 'meta', 'Monitor': 'shell', 'TaskStop': 'meta',
}


def kind_of(name):
    if name in KINDS:
        return KINDS[name]
    if name.startswith('mcp__mnemo__'):
        return 'memory'
    if re.match(r'mcp__(claude-in-chrome|Claude_Browser|remote-devices__Claude_Browser)__', name):
        return 'browser'
    if name.startswith('mcp__'):
        return 'mcp'
    return 'other'


def target_of(name, inp):
    inp = inp or {}
    if name == 'AskUserQuestion':
        qs = inp.get('questions') or []
        return short(qs[0].get('question', '') if qs else '', 200)
    if name == 'SendMessage' and inp.get('message'):
        return short(home(inp['message']), 160)
    for key in ('command', 'file_path', 'pattern', 'url', 'query', 'skill', 'slug', 'topic',
                'description', 'prompt', 'path', 'notebook_path', 'action'):
        if inp.get(key):
            value = slash(inp[key]) if key in ('file_path', 'path', 'notebook_path') else home(inp[key])
            return short(value, 160)
    return ''


MEMORY_DIR = re.compile(r'/\.claude[^/]*/projects/[^/]+/memory/')


def memory_file(path):
    """`claude-memory`, `claude-md` or None: is this path one of Claude Code's own memory files?"""
    p = str(path or '').replace('\\', '/')
    if MEMORY_DIR.search(p):
        return 'claude-memory'
    if p.endswith('/CLAUDE.md') or p.endswith('/CLAUDE.local.md'):
        return 'claude-md'
    return None


URL = re.compile(r'https?://[^\s"\'<>)\\\]]+')


def result_text(content):
    if isinstance(content, str):
        return content
    out = []
    for c in content or []:
        if isinstance(c, dict) and c.get('type') == 'text':
            out.append(c.get('text') or '')
    return '\n'.join(out)


# --- one transcript ---------------------------------------------------------------------

def find_transcript(sid, hint=None):
    if hint and os.path.exists(hint):
        return hint
    hits = glob.glob(os.path.join(HOME, '.claude*', 'projects', '*', sid + '.jsonl'))
    return max(hits, key=os.path.getsize) if hits else None


def usage_of(message):
    u = message.get('usage') or {}
    return {
        'input': u.get('input_tokens') or 0,
        'output': u.get('output_tokens') or 0,
        'cacheRead': u.get('cache_read_input_tokens') or 0,
        'cacheCreation': u.get('cache_creation_input_tokens') or 0,
        'thinking': (u.get('output_tokens_details') or {}).get('thinking_tokens') or 0,
    }


def add(total, u):
    for k, v in u.items():
        total[k] = total.get(k, 0) + v
    return total


ZERO = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheCreation': 0, 'thinking': 0}


def subagent_usage(path):
    """Token use of one sub-agent transcript, deduped by message id like the main one."""
    by_id = {}
    model = None
    for r in jsonl(path):
        if r.get('type') == 'assistant':
            m = r.get('message') or {}
            if str(m.get('model') or '').startswith('claude'):
                by_id[m.get('id') or r.get('uuid')] = usage_of(m)
                model = m.get('model')
    total = dict(ZERO)
    for u in by_id.values():
        add(total, u)
    return total, model, len(by_id)


def parse_transcript(path, sid):
    s = {
        'title': None, 'agentName': None, 'model': None, 'effort': None, 'permissionMode': None,
        'accountUuid': None, 'startedAt': None, 'lastAt': None, 'cwd': None, 'gitBranch': None,
        'version': None, 'recap': None, 'lastPrompt': None, 'said': None, 'worktree': None,
        'window': None, 'turns': 0, 'turnMs': 0,
    }
    usage = {}                 # message id -> (usage, sidechain?, model)
    series = []                # (t, context tokens) per main-chain call
    compactions = []
    calls = {}                 # tool_use id -> activity row
    order = []
    instructions = {}
    claude_mem = []
    skills = []
    searches, fetches, pages, artifacts = [], [], [], []
    shots = []                 # (t, url, title, media_type, base64)
    edited, read = {}, {}
    prs = {}
    cost = None
    pending_ask = None
    beta_1m = False

    for r in jsonl(path):
        kind = r.get('type')
        at = ts(r.get('timestamp'))
        if at:
            s['startedAt'] = s['startedAt'] or at
            s['lastAt'] = max(s['lastAt'] or 0, at)
        if r.get('cwd'):
            s['cwd'] = r['cwd']
        if r.get('gitBranch'):
            s['gitBranch'] = r['gitBranch']
        if r.get('version'):
            s['version'] = r['version']

        if kind == 'assistant':
            m = r.get('message') or {}
            model = str(m.get('model') or '')
            side = bool(r.get('isSidechain'))
            if model.startswith('claude'):
                u = usage_of(m)
                usage[m.get('id') or r.get('uuid')] = (u, side, model)
                if not side:
                    s['model'] = model
                    s['effort'] = r.get('effort') or s['effort']
                    series.append((at, u['input'] + u['cacheRead'] + u['cacheCreation'] + u['output']))
            for c in m.get('content') or []:
                if not isinstance(c, dict) or side:
                    continue
                if c.get('type') == 'text' and (c.get('text') or '').strip():
                    s['said'] = {'at': iso(at), 'text': short(home(c['text']), 700)}
                elif c.get('type') == 'tool_use':
                    name = c.get('name') or ''
                    inp = c.get('input') or {}
                    row = {'at': at, 'tool': name, 'kind': kind_of(name),
                           'target': target_of(name, inp), 'running': True}
                    calls[c.get('id')] = row
                    order.append(c.get('id'))
                    path_in = inp.get('file_path') or inp.get('path')
                    mem = memory_file(path_in)
                    if mem and name in ('Read', 'Edit', 'Write'):
                        claude_mem.append({'at': iso(at), 'path': slash(path_in), 'file': mem,
                                           'op': name.lower(), 'via': 'tool'})
                    if name in ('Edit', 'Write', 'NotebookEdit') and path_in:
                        e = edited.setdefault(slash(path_in), {'path': slash(path_in), 'edits': 0, 'lastAt': None})
                        e['edits'] += 1
                        e['lastAt'] = iso(at)
                    elif name == 'Read' and path_in:
                        read[slash(path_in)] = read.get(slash(path_in), 0) + 1
                    elif name == 'Skill' and inp.get('skill'):
                        skills.append({'at': iso(at), 'name': inp['skill']})
                    elif name == 'AskUserQuestion':
                        qs = inp.get('questions') or []
                        if qs:
                            pending_ask = {'id': c.get('id'), 'at': iso(at),
                                           'question': short(qs[0].get('question'), 400),
                                           'options': [{'label': short(o.get('label'), 80),
                                                        'description': short(o.get('description'), 240)}
                                                       for o in qs[0].get('options') or []]}

        elif kind == 'user':
            m = r.get('message') or {}
            content = m.get('content')
            tur = r.get('toolUseResult')
            is_result = False
            if isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict) or c.get('type') != 'tool_result':
                        continue
                    is_result = True
                    row = calls.get(c.get('tool_use_id'))
                    if pending_ask and pending_ask['id'] == c.get('tool_use_id'):
                        pending_ask = None
                    if not row:
                        continue
                    row['running'] = False
                    row['ok'] = not c.get('is_error')
                    if at and row['at']:
                        row['ms'] = int((at - row['at']) * 1000)
                    name = row['tool']
                    text = result_text(c.get('content'))
                    if name == 'WebSearch' and isinstance(tur, dict):
                        results = []
                        for block in tur.get('results') or []:
                            for hit in (block.get('content') if isinstance(block, dict) else None) or []:
                                if isinstance(hit, dict) and hit.get('url'):
                                    results.append({'title': short(hit.get('title'), 120), 'url': hit['url']})
                        searches.append({'at': iso(row['at']), 'query': tur.get('query') or row['target'],
                                         'results': results[:10]})
                    elif name == 'WebFetch' and isinstance(tur, dict):
                        fetches.append({'at': iso(row['at']), 'url': tur.get('url') or row['target'],
                                        'code': tur.get('code'), 'bytes': tur.get('bytes'),
                                        'ms': tur.get('durationMs'), 'summary': short(home(tur.get('result')), 400)})
                    elif row['kind'] == 'browser':
                        tab = re.search(r'tabId \d+: "([^"]*)" \("?([^")]*)"?\)', text)
                        url = title = None
                        if tab:
                            title, url = tab.group(1), tab.group(2)
                        if url and url.startswith('http') and (not pages or pages[-1]['url'] != url):
                            pages.append({'at': iso(row['at']), 'url': url, 'title': short(title, 120)})
                        for img in c.get('content') if isinstance(c.get('content'), list) else []:
                            if isinstance(img, dict) and img.get('type') == 'image':
                                src = img.get('source') or {}
                                if src.get('type') == 'base64' and src.get('data'):
                                    shots.append((row['at'], url, title, src.get('media_type'), src['data']))
                    elif name == 'Artifact':
                        blob = json.dumps(tur, ensure_ascii=False) if tur is not None else text
                        for link in URL.findall(blob):
                            if '/artifact/' in link and not any(a['url'] == link for a in artifacts):
                                artifacts.append({'at': iso(row['at']), 'url': link.rstrip('.,'),
                                                  'title': short(row['target'], 120)})
            if not is_result and not r.get('isSidechain') and not r.get('isMeta'):
                text = content if isinstance(content, str) else result_text(content)
                if text.strip() and not text.lstrip().startswith(('<local-command', '<command-name', '<task-notification', '<system-reminder')):
                    s['turns'] += 1
                    for row in calls.values():   # a typed turn ends whatever was still "running"
                        row['running'] = False
                    pending_ask = None

        elif kind == 'attachment':
            a = r.get('attachment') or {}
            if a.get('type') == 'instructions':
                for f in a.get('files') or []:
                    p = slash(f.get('path'))
                    instructions[p] = {'path': p, 'type': f.get('type'), 'at': iso(at),
                                       'bytes': len((f.get('content') or '').encode('utf-8'))}
            elif a.get('type') in ('file', 'edited_text_file', 'compact_file_reference'):
                mem = memory_file(a.get('filename'))
                if mem:
                    claude_mem.append({'at': iso(at), 'path': slash(a.get('filename')), 'file': mem,
                                       'op': 'read', 'via': a.get('type')})
            elif a.get('type') == 'invoked_skills':
                for sk in a.get('skills') or []:
                    skills.append({'at': iso(at), 'name': sk.get('name')})

        elif kind == 'system':
            sub = r.get('subtype')
            if sub == 'compact_boundary':
                cm = r.get('compactMetadata') or {}
                compactions.append({'at': iso(at), 'pre': cm.get('preTokens'), 'post': cm.get('postTokens'),
                                    'trigger': cm.get('trigger')})
                if cm.get('postTokens'):
                    series.append((at, cm['postTokens']))
            elif sub == 'away_summary':
                s['recap'] = {'at': iso(at), 'text': short(home(r.get('content')), 500)}
            elif sub == 'turn_duration':
                s['turnMs'] += r.get('durationMs') or 0

        elif kind == 'ai-title':
            s['title'] = r.get('aiTitle') or s['title']
        elif kind == 'custom-title':
            s['title'] = r.get('customTitle') or s['title']
        elif kind == 'agent-name':
            s['agentName'] = r.get('agentName') or s['agentName']
        elif kind == 'permission-mode':
            s['permissionMode'] = r.get('permissionMode')
        elif kind == 'session-owner':
            s['accountUuid'] = r.get('accountUuid')
        elif kind == 'last-prompt' and r.get('lastPrompt'):
            s['lastPrompt'] = short(home(r['lastPrompt']), 400)
        elif kind == 'worktree-state':
            w = r.get('worktreeSession') or {}
            s['worktree'] = {'name': w.get('worktreeName'), 'branch': w.get('worktreeBranch'),
                             'path': slash(w.get('worktreePath')), 'from': slash(w.get('originalCwd'))} if w else None
        elif kind == 'pr-link' and r.get('prUrl'):
            prs[r['prUrl']] = {'number': r.get('prNumber'), 'url': r['prUrl'], 'repo': r.get('prRepository')}
        elif kind == 'cost-state':
            cost = r
        elif kind == 'api-request' and r.get('querySource') == 'repl_main_thread':
            beta_1m = any('context-1m' in b for b in (r.get('params') or {}).get('betas') or [])

    # tokens: one count per API message, the last record of it winning
    main, side, by_model = dict(ZERO), dict(ZERO), {}
    for u, is_side, model in usage.values():
        add(side if is_side else main, u)
        add(by_model.setdefault(model, dict(ZERO)), u)
    subagents = []
    for f in sorted(glob.glob(os.path.join(os.path.dirname(path), sid, 'subagents', 'agent-*.jsonl'))):
        total, model, n = subagent_usage(f)
        meta = read_json(f[:-6] + '.meta.json', {})
        subagents.append({'id': os.path.basename(f)[6:-6], 'description': short(meta.get('description'), 120),
                          'type': meta.get('agentType') or meta.get('subagent_type'), 'model': model,
                          'calls': n, 'tokens': total})

    context = series[-1][1] if series else None
    window = 1_000_000 if (beta_1m or (context or 0) > 200_000 or
                           any((c.get('pre') or 0) > 200_000 for c in compactions)) else 200_000
    step = max(1, len(series) // SERIES_CAP)
    thin = [[iso(t), n] for i, (t, n) in enumerate(series) if t and (i % step == 0 or i == len(series) - 1)]

    activity = [calls[i] for i in order]
    buckets = {}
    for row in activity:
        if row['at']:
            b = buckets.setdefault(int(row['at'] // BUCKET_S) * BUCKET_S, {})
            b[row['kind']] = b.get(row['kind'], 0) + 1
    counts = {}
    for row in activity:
        counts[row['kind']] = counts.get(row['kind'], 0) + 1
    for row in activity:
        row['at'] = iso(row['at'])

    saved = []
    for n, (at, url, title, media, data) in enumerate(shots[-SHOTS_PER_SESSION:]):
        ext = 'png' if media == 'image/png' else 'jpg'
        name = '%s-%d.%s' % (sid[:8], n, ext)
        try:
            os.makedirs(SHOTS, exist_ok=True)
            with open(os.path.join(SHOTS, name), 'wb') as f:
                f.write(base64.b64decode(data))
            saved.append({'at': iso(at), 'url': url, 'title': short(title, 120), 'src': 'shots/' + name})
        except (OSError, ValueError):
            continue

    s.update({
        'startedAt': iso(s['startedAt']), 'lastAt': iso(s['lastAt']), 'cwd': slash(s['cwd']),
        'tokens': {'main': main, 'sidechain': side, 'byModel': by_model, 'subagents': subagents},
        'cost': None if not cost else {
            'usd': cost.get('totalCostUSD'), 'apiMs': cost.get('totalAPIDuration'),
            'toolMs': cost.get('totalToolDuration'), 'linesAdded': cost.get('totalLinesAdded'),
            'linesRemoved': cost.get('totalLinesRemoved')},
        'context': {'tokens': context, 'window': window,
                    'percent': None if context is None else round(100 * context / window, 1),
                    'series': thin, 'compactions': compactions},
        'activity': activity[-ACTIVITY_CAP:], 'activityTotal': len(activity), 'activityCounts': counts,
        'timeline': [{'t': iso(t), 'kinds': k} for t, k in sorted(buckets.items()) if t >= START - BUCKET_S],
        'memory': {'instructions': list(instructions.values()), 'claude': claude_mem, 'skills': skills},
        'web': {'searches': searches, 'fetches': fetches, 'pages': pages, 'shots': saved, 'artifacts': artifacts},
        'files': {'edited': sorted(edited.values(), key=lambda e: -e['edits'])[:60],
                  'read': [{'path': p, 'count': n} for p, n in sorted(read.items(), key=lambda x: -x[1])[:60]]},
        'prs': list(prs.values()),
        'pendingAsk': pending_ask,
    })
    return s


# --- mnemo's logs, joined by session ----------------------------------------------------

def mnemo_logs():
    logs = {'reflex': {}, 'mcp': {}, 'briefings': {}, 'frictions': {}}
    d = os.path.join(VAULT, '.mnemo')
    for r in jsonl(os.path.join(d, 'reflex-log.jsonl')):
        judge = dict((r.get('judge') or {}).get('scores') or [])
        logs['reflex'].setdefault(r.get('session_id'), []).append({
            'at': r.get('ts'), 'emitted': r.get('emitted') or [], 'silence': r.get('silence_reason'),
            'promptTokens': r.get('prompt_tokens'),
            'candidates': [{'slug': c[0], 'score': c[1], 'judge': judge.get(c[0])}
                           for c in r.get('candidates') or [] if isinstance(c, list) and len(c) > 1],
        })
    for r in jsonl(os.path.join(d, 'mcp-access-log.jsonl')):
        args = r.get('args') or {}
        logs['mcp'].setdefault(r.get('session_id'), []).append({
            'at': r.get('timestamp'), 'tool': r.get('tool'), 'slug': args.get('slug'),
            'topic': args.get('topic'), 'query': short(args.get('query'), 200),
            'hits': r.get('hit_slugs') or [], 'count': r.get('result_count'), 'ms': r.get('elapsed_ms')})
    for r in jsonl(os.path.join(d, 'briefing-log.jsonl')):
        logs['briefings'].setdefault(r.get('reader_session_id'), []).append({
            'at': r.get('timestamp'), 'project': r.get('project'), 'date': r.get('date'),
            'path': r.get('path'), 'source': r.get('source'), 'entries': r.get('entries')})
    for r in jsonl(os.path.join(d, 'friction-ledger.jsonl')):
        logs['frictions'].setdefault(r.get('session_id'), []).append({
            'at': r.get('ts'), 'quote': short(r.get('quote'), 300), 'rule': short(r.get('rule_text'), 300),
            'origin': r.get('origin')})
    return logs


def vault_summary():
    d = os.path.join(VAULT, '.mnemo')
    learned = list(jsonl(os.path.join(d, 'learned.jsonl')))
    reflex = list(jsonl(os.path.join(d, 'reflex-log.jsonl')))
    silence = {}
    for r in reflex:
        key = r.get('silence_reason') or 'emitted'
        silence[key] = silence.get(key, 0) + 1
    levels = read_json(os.path.join(APP, 'project-levels.json'), {}).get('best_xp') or {}
    return {
        'xp': read_json(os.path.join(APP, 'vault-level.json'), {}).get('best_xp'),
        'projectXp': levels,
        'rules': next((r.get('thresholds', {}).get('doc_count') for r in reversed(reflex)
                       if r.get('thresholds', {}).get('doc_count')), None),
        'reflex': {'prompts': len(reflex), 'outcomes': silence},
        'learned': [{'at': r.get('ts'), 'slug': r.get('slug'), 'name': r.get('name'),
                     'projects': r.get('projects') or []} for r in learned[-40:]],
    }


# --- accounts and projects --------------------------------------------------------------

def accounts():
    state = read_json(os.path.join(APP, 'accounts.json'), {})
    rows = state.get('accounts') or []
    usage = {}
    for f in glob.glob(os.path.join(APP, 'plan-usage', '*.json')):
        j = read_json(f, {})
        usage[os.path.normcase(os.path.normpath(j.get('configDir') or ''))] = j
    default = os.path.join(HOME, '.claude')
    if not any(os.path.normcase(os.path.normpath(a.get('configDir') or default)) ==
               os.path.normcase(os.path.normpath(default)) for a in rows):
        rows = [{'id': 'default', 'label': 'default', 'configDir': default, 'kind': 'claude'}] + rows
    out = []
    for a in rows:
        cfg = a.get('configDir') or default
        j = usage.get(os.path.normcase(os.path.normpath(cfg)), {})
        u = j.get('usage') or {}
        oauth = (read_json(os.path.join(cfg, '.claude.json'), None) or
                 (read_json(os.path.join(HOME, '.claude.json'), {}) if cfg == default else {}))
        acct = (oauth or {}).get('oauthAccount') or {}
        out.append({
            'id': a.get('id') or 'default', 'label': a.get('label') or a.get('id') or 'default',
            'kind': a.get('kind') or 'claude', 'configDir': slash(cfg),
            'active': (a.get('id') or 'default') == (state.get('active') or 'default'),
            'accountUuid': acct.get('accountUuid'), 'plan': u.get('plan'),
            'limits': u.get('limits') or [], 'usageReadAt': j.get('at') or j.get('fetchedAt'),
        })
    return out


_roots = {}


def repo_root(cwd):
    """The main checkout a directory belongs to, so a worktree lands in its repo's project."""
    if not cwd:
        return None
    key = os.path.normcase(cwd)
    if key not in _roots:
        common = sh('git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip()
        if common:
            root = os.path.dirname(common) if os.path.basename(common) == '.git' else common
        else:
            root = re.sub(r'([\\/]\.claude[\\/]worktrees[\\/][^\\/]+|-wt-[^\\/]+)$', '', cwd)
        _roots[key] = root
    return _roots[key]


# --- sessions ---------------------------------------------------------------------------

def scratch(cwd):
    """A session a test suite started in a temp directory: not the maintainer's work."""
    p = str(cwd or '').replace('\\', '/').lower()
    return ('/appdata/local/temp/' in p or '/pytest-' in p or '/.probe-' in p
            or p.startswith(('/tmp/', '/private/var/')))


def claude_agents():
    rows = []
    dirs = [None] + [d for d in glob.glob(os.path.join(HOME, '.claude-*')) if os.path.isdir(os.path.join(d, 'projects'))]
    seen = set()
    for d in dirs:
        env = dict(os.environ)
        if d:
            env['CLAUDE_CONFIG_DIR'] = d
        for r in loads(sh('claude', 'agents', '--json', '--all', env=env), []):
            if r.get('sessionId') and r['sessionId'] not in seen:
                seen.add(r['sessionId'])
                r['_configDir'] = d or os.path.join(HOME, '.claude')
                # an interactive row is a running process; a background one outlives its
                # process in the listing, and `stopped`/`done` say it is over
                if r.get('kind') == 'interactive':
                    r['_live'] = bool(r.get('pid'))
                else:
                    r['_live'] = r.get('state') not in ('stopped', 'done', None)
                rows.append(r)
    return rows


def pr_facts(pr):
    """Fill a PR row with what GitHub says of it now: state, draft, CI and title."""
    if NO_GH or not pr.get('url'):
        return pr
    j = loads(sh('gh', 'pr', 'view', pr['url'], '--json', 'state,isDraft,title,statusCheckRollup,mergeable'), None)
    if not j:
        return pr
    checks = [c.get('conclusion') or c.get('state') or c.get('status') for c in j.get('statusCheckRollup') or []]
    if any(c in ('FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED') for c in checks):
        ci = 'red'
    elif any(c in ('PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', None) for c in checks):
        ci = 'running'
    else:
        ci = 'green' if checks else None
    pr.update({'state': (j.get('state') or '').lower(), 'draft': j.get('isDraft'), 'title': j.get('title'),
               'ci': ci, 'mergeable': (j.get('mergeable') or '').lower()})
    return pr


def state_of(agent, child, parsed):
    """One of need | working | ready | idle | stalled | ended. `DATA.md` says what each means."""
    if child:
        if child.get('is_blocked') or child.get('needs'):
            return 'need'
        if child.get('stall'):
            return 'stalled'
        if child.get('live') and child.get('tempo') == 'active':
            return 'working'
        if child.get('live'):
            return 'idle'
        prs = (parsed or {}).get('prs') or []
        # over, with a pull request still open: it waits for the maintainer's merge
        return 'ready' if any(p.get('state') == 'open' for p in prs) else 'ended'
    if not agent or not agent.get('_live'):
        return 'ended'
    if agent.get('state') == 'blocked' or agent.get('waitingFor') or (parsed and parsed.get('pendingAsk')):
        return 'need'
    if agent.get('status') == 'busy' or agent.get('state') in ('running', 'working'):
        return 'working'
    return 'idle'


def build():
    agents = {r['sessionId']: r for r in claude_agents()}
    children = {}
    for r in loads(sh('mnemo', 'sessions', '--json', '--all', '--stale'), []):
        sid = r.get('session_id')
        if sid and not scratch(r.get('cwd')) and (
                r.get('live') or r.get('is_blocked') or (ts(r.get('updated_at')) or 0) >= START):
            children[sid] = r
    parents_of = {}
    for r in jsonl(os.path.join(VAULT, '.mnemo', 'dispatch-parents.jsonl')):
        parents_of[r.get('short_id')] = r.get('parent_session')

    wanted = {sid for sid, a in agents.items() if a['_live'] and not scratch(a.get('cwd'))} | set(children)
    for c in children.values():
        p = c.get('parent_session') or parents_of.get(c.get('short_id'))
        if p:
            wanted.add(p)

    logs = mnemo_logs()
    accts = accounts()
    by_uuid = {a['accountUuid']: a['id'] for a in accts if a.get('accountUuid')}
    by_dir = {os.path.normcase(os.path.normpath(a['configDir'].replace('~', HOME))): a['id'] for a in accts}

    sessions = []
    for sid in wanted:
        agent, child = agents.get(sid), children.get(sid)
        path = find_transcript(sid, (child or {}).get('link_scan_path'))
        parsed = parse_transcript(path, sid) if path else None
        if not parsed and not agent and not child:
            continue
        p = parsed or {}
        if p.get('prs') and (child or (ts(p.get('lastAt')) or 0) >= START):
            p['prs'] = [pr_facts(pr) for pr in p['prs'][-3:]]
        cwd = (agent or {}).get('cwd') or (child or {}).get('cwd') or p.get('cwd')
        root = repo_root(cwd.replace('~', HOME) if cwd else None)
        parent = (child or {}).get('parent_session') or parents_of.get(sid[:8])
        account = by_uuid.get(p.get('accountUuid'))
        if not account and agent:
            account = by_dir.get(os.path.normcase(os.path.normpath(agent['_configDir'])))
        reflex = logs['reflex'].get(sid, [])
        row = {
            'id': sid, 'short': sid[:8],
            'role': 'child' if (child or parent) else 'parent',
            'agentKind': (agent or {}).get('kind') or ('background' if child else None),
            'live': bool(agent and agent['_live']) or bool((child or {}).get('live')),
            'abandoned': bool((child or {}).get('is_abandoned')),
            'state': state_of(agent, child, parsed),
            'project': os.path.basename(root) if root else None,
            'cwd': slash(cwd), 'branch': p.get('gitBranch'), 'worktree': p.get('worktree'),
            'title': p.get('title') or (child or {}).get('name') or (agent or {}).get('name'),
            'name': (agent or {}).get('name') or (child or {}).get('name') or p.get('agentName'),
            'account': account or 'default',
            'model': p.get('model') or (child or {}).get('model'),
            'effort': p.get('effort') or (child or {}).get('effort'),
            'advisor': (child or {}).get('advisor'),
            'permissionMode': p.get('permissionMode'),
            'startedAt': iso(ts((agent or {}).get('startedAt'))) or p.get('startedAt'),
            'lastAt': p.get('lastAt') or (child or {}).get('updated_at'),
            'parent': parent, 'children': [],
            'intent': short(home((child or {}).get('intent')), 400) or None,
            'detail': short(home((child or {}).get('detail')), 400) or None,
            'needs': short(home((child or {}).get('needs') or (agent or {}).get('waitingFor')), 400) or None,
            'suggestedReply': (child or {}).get('suggested_reply'),
            'may': (child or {}).get('may'),
            'recap': p.get('recap'), 'lastPrompt': p.get('lastPrompt'), 'said': p.get('said'),
            'turns': p.get('turns'), 'turnMs': p.get('turnMs'),
            'tokens': p.get('tokens'), 'cost': p.get('cost'), 'context': p.get('context'),
            'activity': p.get('activity') or [], 'activityTotal': p.get('activityTotal') or 0,
            'activityCounts': p.get('activityCounts') or {}, 'timeline': p.get('timeline') or [],
            'web': p.get('web') or {'searches': [], 'fetches': [], 'pages': [], 'shots': [], 'artifacts': []},
            'files': p.get('files') or {'edited': [], 'read': []},
            'prs': p.get('prs') or [],
            'pendingAsk': p.get('pendingAsk'),
            'memory': {
                'instructions': (p.get('memory') or {}).get('instructions') or [],
                'claude': (p.get('memory') or {}).get('claude') or [],
                'skills': (p.get('memory') or {}).get('skills') or [],
                'briefings': logs['briefings'].get(sid, []),
                'injected': [{'at': r['at'], 'slug': slug, 'score': next((c['score'] for c in r['candidates'] if c['slug'] == slug), None),
                              'judge': next((c['judge'] for c in r['candidates'] if c['slug'] == slug), None)}
                             for r in reflex for slug in r['emitted']],
                'considered': [{'at': r['at'], 'reason': r['silence'], 'candidates': r['candidates'][:3]}
                               for r in reflex if not r['emitted'] and r['candidates']][-40:],
                'prompts': len(reflex),
                'read': logs['mcp'].get(sid, []),
                'frictions': logs['frictions'].get(sid, []),
            },
            'hasTranscript': bool(parsed),
        }
        sessions.append(row)

    by_id = {s['id']: s for s in sessions}
    for s in sessions:
        if s['parent'] in by_id:
            by_id[s['parent']]['children'].append(s['id'])
        elif s['parent']:
            s['parentMissing'] = True

    def all_tokens(t):
        if not t:
            return dict(ZERO)
        total = add(dict(t['main']), t['sidechain'])
        for sub in t['subagents']:
            add(total, sub['tokens'])
        return total

    for s in sessions:
        own = all_tokens(s['tokens'])
        tree = dict(own)
        for cid in s['children']:
            add(tree, all_tokens(by_id[cid]['tokens']))
        s['totals'] = {'own': own, 'tree': tree}

    pending = []
    for s in sessions:
        if s['state'] == 'need':
            ask = s['pendingAsk']
            pending.append({'session': s['id'], 'kind': 'question' if ask else ('permission' if 'permission' in (s['needs'] or '').lower() else 'blocked'),
                            'text': (ask or {}).get('question') or s['needs'] or s['detail'] or (s['said'] or {}).get('text'),
                            'options': (ask or {}).get('options') or [], 'suggestedReply': s['suggestedReply'],
                            'at': (ask or {}).get('at') or s['lastAt']})
        elif s['state'] == 'ready':
            pr = next((p for p in reversed(s['prs']) if p.get('state') == 'open'), None)
            pending.append({'session': s['id'], 'kind': 'merge', 'text': (pr or {}).get('title') or s['title'],
                            'options': [], 'pr': pr, 'at': s['lastAt']})
        elif s['state'] == 'stalled':
            pending.append({'session': s['id'], 'kind': 'stalled', 'text': s['detail'], 'options': [], 'at': s['lastAt']})

    projects = {}
    for s in sessions:
        pr = projects.setdefault(s['project'] or '(none)', {'name': s['project'] or '(none)', 'sessions': []})
        pr['sessions'].append(s['id'])
    xp = vault_summary()
    for name, pr in projects.items():
        pr['xp'] = (xp['projectXp'] or {}).get(name)

    return {
        'synthetic': False, 'capturedAt': iso(NOW), 'windowHours': HOURS,
        'machine': {'platform': sys.platform, 'claude': sh('claude', '--version').strip(),
                    'mnemo': sh('mnemo', '--version').strip()},
        'accounts': accts, 'projects': sorted(projects.values(), key=lambda p: -len(p['sessions'])),
        'sessions': sorted(sessions, key=lambda s: s['lastAt'] or '', reverse=True),
        'pending': sorted(pending, key=lambda p: p['at'] or ''),
        'vault': xp,
    }


if __name__ == '__main__':
    data = build()
    out = os.path.join(HERE, 'data.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('window.MNEMO = ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    live = sum(1 for s in data['sessions'] if s['live'])
    print('%s: %d sessions (%d live), %d pending, %.1f MB' % (
        os.path.relpath(out), len(data['sessions']), live, len(data['pending']), os.path.getsize(out) / 1e6))
