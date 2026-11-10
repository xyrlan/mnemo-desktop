"""Write `data.sample.js`: a synthetic capture with the shape `capture.py` writes.

    python sample.py

Every name, prompt, path and number in it is invented, so it is the capture that may be
committed and the one every screenshot leaving a machine is taken with. It is seeded: the
same file comes out each run, and `check.py` holds its shape to the real capture's.
"""
import json
import os
import random
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
R = random.Random(20261109)
NOW = datetime(2026, 11, 9, 21, 30, 0, tzinfo=timezone.utc)
ZERO = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheCreation': 0, 'thinking': 0}


def iso(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).strftime('%Y-%m-%dT%H:%M:%SZ')


def sid(n):
    return '%08x-%04x-4%03x-a%03x-%012x' % (R.getrandbits(32), R.getrandbits(16), R.getrandbits(12),
                                            R.getrandbits(12), R.getrandbits(48))


RULES = [
    'paths-compare-as-paths-on-windows', 'retry-with-idempotency-key', 'never-mock-the-database-in-integration',
    'migrations-are-forward-only', 'feature-flag-default-off', 'webhook-signature-before-parse',
    'cache-key-includes-tenant', 'timezones-store-utc-render-local', 'pagination-cursor-not-offset',
    'optimistic-ui-rolls-back-on-409', 'log-request-id-everywhere', 'image-upload-unique-key-per-version',
    'css-animations-over-js-motion', 'changelog-entry-per-change', 'dispatch-children-push-before-stop',
]
TOOLS = [
    ('Read', 'read', ['src/billing/invoice.ts', 'src/api/routes/orders.ts', 'README.md', 'src/lib/cache.ts', 'tests/orders.test.ts']),
    ('Grep', 'search-code', ['idempotencyKey', 'useOptimistic\\(', 'TODO\\(billing\\)', 'export function sign']),
    ('Edit', 'edit', ['src/billing/invoice.ts', 'src/api/routes/orders.ts', 'src/lib/cache.ts', 'src/ui/OrderRow.tsx']),
    ('Write', 'write', ['tests/billing/invoice.test.ts', 'changelog.d/412.fixed.md']),
    ('Bash', 'shell', ['pnpm test --run billing', 'git status -sb', 'pnpm tsc --noEmit', 'gh pr checks 412', 'git diff --stat']),
    ('WebSearch', 'web-search', ['stripe idempotency key retry semantics', 'postgres advisory lock vs select for update']),
    ('WebFetch', 'web-fetch', ['https://docs.example.com/api/idempotency', 'https://example.org/blog/cursor-pagination']),
    ('mcp__mnemo__read_mnemo_rule', 'memory', RULES),
    ('mcp__claude-in-chrome__computer', 'browser', ['screenshot', 'left_click', 'scroll']),
    ('Agent', 'agent', ['Map the billing module', 'Find every caller of sign()']),
]
WEIGHTS = [22, 9, 16, 4, 26, 2, 2, 3, 4, 1]


def activity(n, span_min, end_min, running=False):
    rows, counts, buckets = [], {}, {}
    times = sorted(R.uniform(end_min, end_min + span_min) for _ in range(n))
    for i, t in enumerate(reversed(times)):
        tool, kind, targets = R.choices(TOOLS, WEIGHTS)[0]
        rows.append({'at': iso(t), 'tool': tool, 'kind': kind, 'target': R.choice(targets),
                     'running': bool(running and i == n - 1), 'ok': R.random() > 0.06, 'ms': int(R.lognormvariate(6.5, 1.3))})
        counts[kind] = counts.get(kind, 0) + 1
        key = iso(int(t // 5) * 5 + 5)
        buckets.setdefault(key, {})
        buckets[key][kind] = buckets[key].get(kind, 0) + 1
    if rows and rows[-1]['running']:
        rows[-1].pop('ok')
        rows[-1].pop('ms')
    return rows, counts, [{'t': t, 'kinds': k} for t, k in sorted(buckets.items())]


def context(window, percent, span_min, end_min, compactions):
    """A sawtooth: the context grows call by call and falls at each compaction."""
    series, cliffs = [], []
    target = int(window * percent / 100)
    points = 60
    legs = compactions + 1
    for leg in range(legs):
        top = target if leg == legs - 1 else int(window * R.uniform(0.78, 0.92))
        base = 21000 if leg else 14000
        for i in range(points // legs):
            frac = (leg + i / (points / legs)) / legs
            t = end_min + span_min * (1 - frac)
            series.append([iso(t), int(base + (top - base) * (i / (points / legs - 1)) ** 0.8)])
        if leg < legs - 1:
            t = end_min + span_min * (1 - (leg + 1) / legs)
            cliffs.append({'at': iso(t), 'pre': top, 'post': 21000 + R.randrange(4000), 'trigger': 'auto'})
    return {'tokens': target, 'window': window, 'percent': round(100 * target / window, 1),
            'series': series, 'compactions': cliffs}


def tokens(scale, model, subagents=0):
    main = {'input': int(900 * scale), 'output': int(52000 * scale), 'cacheRead': int(9.4e6 * scale),
            'cacheCreation': int(310000 * scale), 'thinking': int(21000 * scale)}
    subs = []
    for i in range(subagents):
        f = R.uniform(0.05, 0.2) * scale
        subs.append({'id': 'a%015x' % R.getrandbits(60), 'description': R.choice(['Map the billing module', 'Survey the route handlers', 'Read the design specs']),
                     'type': 'Explore', 'model': 'claude-opus-5-5', 'calls': R.randrange(20, 90),
                     'tokens': {'input': int(400 * f), 'output': int(30000 * f), 'cacheRead': int(4e6 * f),
                                'cacheCreation': int(200000 * f), 'thinking': int(9000 * f)}})
    return {'main': main, 'sidechain': dict(ZERO), 'byModel': {model: dict(main)}, 'subagents': subs}


def memory(project, n_inj, n_read, has_auto=True, frictions=0):
    inj = [{'at': iso(R.uniform(5, 600)), 'slug': s, 'score': round(R.uniform(3.2, 7.5), 4), 'judge': round(R.uniform(0.5, 0.95), 2)}
           for s in R.sample(RULES, n_inj)]
    considered = [{'at': iso(R.uniform(5, 600)), 'reason': R.choice(['judge_none_relevant', 'judge_none_relevant', 'notice_below_bar', 'deduped']),
                   'candidates': [{'slug': s, 'score': round(R.uniform(2.0, 3.9), 4), 'judge': round(R.uniform(0.02, 0.3), 2)}
                                  for s in R.sample(RULES, 3)]} for _ in range(n_inj * 2 + 2)]
    instr = [{'path': '~/work/%s/CLAUDE.md' % project, 'type': 'Project', 'at': iso(700), 'bytes': R.randrange(1800, 6200)}]
    claude = []
    if has_auto:
        instr.append({'path': '~/.claude/projects/-work-%s/memory/MEMORY.md' % project, 'type': 'AutoMem', 'at': iso(700), 'bytes': R.randrange(400, 1900)})
        for name in R.sample(['feedback-test-before-claiming.md', 'project-billing-migration.md', 'user-prefers-small-prs.md', 'reference-staging-dashboard.md'], 2):
            claude.append({'at': iso(R.uniform(5, 600)), 'path': '~/.claude/projects/-work-%s/memory/%s' % (project, name),
                           'file': 'claude-memory', 'op': R.choice(['read', 'read', 'write', 'edit']), 'via': 'tool'})
    return {
        'instructions': instr, 'claude': claude,
        'skills': [{'at': iso(R.uniform(5, 600)), 'name': 'mnemo-loop'}] if n_read else [],
        'briefings': [{'at': iso(700), 'project': project, 'date': '2026-11-08', 'path': 'bots/%s/briefings/sessions/%s.md' % (project, sid(0)),
                       'source': 'startup', 'entries': 10}],
        'injected': inj, 'considered': considered, 'prompts': len(inj) + len(considered) + R.randrange(3),
        'read': [{'at': iso(R.uniform(5, 600)), 'tool': 'read_mnemo_rule', 'slug': s, 'topic': None, 'query': '',
                  'hits': [s], 'count': 1, 'ms': round(R.uniform(8, 40), 2)} for s in R.sample(RULES, n_read)] + (
            [{'at': iso(R.uniform(5, 600)), 'tool': 'list_rules_by_topic', 'slug': None, 'topic': 'testing', 'query': 'retry a webhook without charging twice',
              'hits': R.sample(RULES, 4), 'count': 4, 'ms': round(R.uniform(20, 90), 2)}] if n_read else []),
        'frictions': [{'at': iso(R.uniform(5, 300)), 'quote': 'no, compare the paths as Path objects, not strings',
                       'rule': 'Compare paths as Path objects in tests.', 'origin': 'user'}][:frictions],
    }


def web(rich):
    if not rich:
        return {'searches': [], 'fetches': [], 'pages': [], 'shots': [], 'artifacts': []}
    return {
        'searches': [{'at': iso(48), 'query': 'stripe idempotency key retry semantics', 'results': [
            {'title': 'Idempotent requests · API reference', 'url': 'https://docs.example.com/api/idempotency'},
            {'title': 'Designing robust retries', 'url': 'https://example.org/blog/retries'},
            {'title': 'Exactly-once is a lie (and what to do)', 'url': 'https://example.net/exactly-once'}]}],
        'fetches': [{'at': iso(46), 'url': 'https://docs.example.com/api/idempotency', 'code': 200, 'bytes': 70157, 'ms': 9096,
                     'summary': 'Keys are scoped per account and expire after 24 hours; a replay with a different body returns 409.'}],
        'pages': [{'at': iso(31), 'url': 'http://localhost:5173/orders', 'title': 'Orders · Lumen'},
                  {'at': iso(29), 'url': 'http://localhost:5173/orders/8841', 'title': 'Order 8841 · Lumen'}],
        'shots': [{'at': iso(31), 'url': 'http://localhost:5173/orders', 'title': 'Orders · Lumen', 'src': 'sample-shots/orders.svg'},
                  {'at': iso(29), 'url': 'http://localhost:5173/orders/8841', 'title': 'Order 8841 · Lumen', 'src': 'sample-shots/order-8841.svg'}],
        'artifacts': [{'at': iso(22), 'url': 'https://claude.ai/code/artifact/00000000-0000-4000-a000-000000000000', 'title': 'Retry policy comparison'}],
    }


def session(project, title, state, role='parent', parent=None, model='claude-opus-5-5', minutes=5, span=240,
            calls=80, window=200_000, percent=40, compactions=0, scale=1.0, subs=0, rich=False, pr=None,
            ask=None, needs=None, recap=None, prompt=None, inj=2, read=1, live=True, frictions=0):
    s = sid(0)
    acts, counts, timeline = activity(calls, span, minutes, running=state == 'working')
    return {
        'id': s, 'short': s[:8], 'role': role, 'agentKind': 'interactive' if role == 'parent' else 'background',
        'live': live, 'abandoned': False, 'state': state, 'project': project,
        'cwd': '~/work/%s' % project if role == 'parent' else '~/work/%s-wt-%s' % (project, title.split()[0].lower()),
        'branch': 'main' if role == 'parent' else 'fix/issue-%d' % R.randrange(300, 480), 'worktree': None,
        'title': title, 'name': title.lower().replace(' ', '-')[:24], 'account': R.choice(['default', 'default', 'second']),
        'model': model, 'effort': R.choice(['high', 'high', 'medium']),
        'advisor': 'claude-opus-5-5' if role == 'child' and 'sonnet' in model else None,
        'permissionMode': 'bypassPermissions', 'startedAt': iso(minutes + span), 'lastAt': iso(minutes),
        'parent': parent, 'children': [],
        'intent': None if role == 'parent' else 'Work on issue #%d in this repo: %s' % (R.randrange(300, 480), title),
        'detail': None if role == 'parent' else (needs or 'running the route tests after the fix'),
        'needs': needs, 'suggestedReply': None, 'may': None if role == 'parent' else ['push', 'pr'],
        'recap': {'at': iso(minutes), 'text': recap} if recap else None,
        'lastPrompt': prompt, 'said': {'at': iso(minutes), 'text': recap or 'Done; the suite is green and the PR is open.'},
        'turns': R.randrange(3, 40), 'turnMs': int(span * 60000 * R.uniform(0.2, 0.6)),
        'tokens': tokens(scale, model, subs),
        'cost': None if live and role == 'parent' else {'usd': round(4.1 * scale, 2), 'apiMs': int(4.4e5 * scale), 'toolMs': int(4.7e5 * scale),
                                                        'linesAdded': int(210 * scale), 'linesRemoved': int(64 * scale)},
        'context': context(window, percent, span, minutes, compactions),
        'activity': acts, 'activityTotal': calls, 'activityCounts': counts, 'timeline': timeline,
        'web': web(rich),
        'files': {'edited': [{'path': '~/work/%s/%s' % (project, p), 'edits': R.randrange(1, 9), 'lastAt': iso(minutes + R.uniform(0, span))}
                             for p in R.sample(TOOLS[2][2], 3)],
                  'read': [{'path': '~/work/%s/%s' % (project, p), 'count': R.randrange(1, 6)} for p in TOOLS[0][2]]},
        'prs': [pr] if pr else [], 'pendingAsk': ask,
        'memory': memory(project, inj, read, frictions=frictions),
        'hasTranscript': True,
    }


def build():
    S = []

    def add(*a, **k):
        S.append(session(*a, **k))
        return S[-1]

    billing = add('atlas-api', 'Idempotent retries for the billing webhooks', 'working', minutes=0, span=310, calls=190,
                  window=1_000_000, percent=31, compactions=1, scale=6.2, subs=2, rich=True, inj=4, read=3, frictions=1,
                  recap='You asked for webhook retries that cannot double-charge. The handler now stores an idempotency key per event; I am running the billing suite before opening the PR.',
                  prompt='make the billing webhook safe to retry, we double charged a customer yesterday')
    add('atlas-api', 'Webhook signature check before parsing', 'need', role='child', parent=billing['id'], minutes=6, span=70, calls=44,
        percent=58, scale=0.9, needs='permission: Bash — git push origin fix/issue-412',
        ask=None, inj=1)
    add('atlas-api', 'Cursor pagination for /orders', 'ready', role='child', parent=billing['id'], minutes=38, span=120, calls=96,
        percent=71, scale=1.6, live=False,
        pr={'number': 412, 'url': 'https://github.com/example/atlas-api/pull/412', 'repo': 'example/atlas-api', 'state': 'open',
            'draft': False, 'title': 'orders: cursor pagination, offset kept behind a flag', 'ci': 'green', 'mergeable': 'mergeable'})
    add('atlas-api', 'Tenant in every cache key', 'working', role='child', parent=billing['id'], model='claude-sonnet-5-5', minutes=1,
        span=45, calls=31, percent=36, scale=0.4)
    add('atlas-api', 'Forward-only migration for invoices', 'stalled', role='child', parent=billing['id'], minutes=52, span=30, calls=12,
        percent=22, scale=0.2, needs=None, live=False)

    q = {'id': 'toolu_sample', 'at': iso(14), 'question': 'The orders table has 2.1M rows. Backfill the new column online in batches, or take a short maintenance window?',
         'options': [{'label': 'Online, in batches (Recommended)', 'description': 'No downtime; the backfill runs for about 40 minutes and can be paused.'},
                     {'label': 'Maintenance window', 'description': 'Simpler migration, roughly 6 minutes of read-only mode.'},
                     {'label': 'Skip the backfill', 'description': 'Leave old rows null and handle it in code.'}]}
    add('atlas-api', 'Order status history column', 'need', minutes=14, span=95, calls=61, percent=47, scale=1.3, ask=q,
        recap='The migration is written and tested on a copy. I need one decision from you before running the backfill.',
        prompt='add a status history to orders so support can see what happened')

    lumen = add('lumen-web', 'Optimistic updates on the orders screen', 'idle', minutes=22, span=400, calls=260, window=1_000_000,
                percent=64, compactions=2, scale=8.8, subs=1, rich=True, inj=5, read=2,
                recap='Optimistic updates are in for edit and cancel, with a rollback on 409. Next: you wanted to look at the empty state before I touch it.',
                prompt='the orders screen feels slow, make edits feel instant')
    add('lumen-web', 'Empty state for the orders table', 'ready', role='child', parent=lumen['id'], minutes=75, span=60, calls=40,
        percent=44, scale=0.7, live=False,
        pr={'number': 233, 'url': 'https://github.com/example/lumen-web/pull/233', 'repo': 'example/lumen-web', 'state': 'open',
            'draft': False, 'title': 'orders: an empty state that says what to do next', 'ci': 'running', 'mergeable': 'mergeable'})
    add('lumen-web', 'Dark theme contrast pass', 'idle', minutes=180, span=220, calls=120, percent=83, scale=2.4, inj=1,
        recap='Every text pair now passes AA. Two chart colours are still close; I listed them and stopped for your call.',
        prompt='check contrast on the dark theme')
    add('lumen-web', 'Why is the bundle 40% bigger', 'working', model='claude-fable-5-2', minutes=0, span=35, calls=52, percent=18,
        scale=1.1, subs=3, inj=0, read=0, prompt='the bundle grew a lot since last week, find out why')

    add('tessera', 'Design the plugin manifest format', 'idle', model='claude-fable-5-2', minutes=47, span=150, calls=38, percent=29,
        scale=1.9, rich=True, inj=2,
        recap='Three manifest shapes compared in an artifact. I recommend the flat one; waiting for you to read it.',
        prompt='we need a manifest for plugins, propose a format')
    add('tessera', 'Flaky snapshot test on Windows', 'idle', minutes=260, span=80, calls=70, percent=52, scale=1.0, frictions=1,
        recap='Fixed: the test compared a path as a string. It now compares Path objects and passes on all three systems.',
        prompt='snapshot test fails only on windows CI')
    harbor = add('harbor-cli', 'Release 2.4 checklist', 'idle', minutes=95, span=500, calls=140, window=1_000_000, percent=12,
                 compactions=3, scale=5.0, inj=3,
                 recap='Changelog assembled and the three release PRs merged. The tag is yours to push.',
                 prompt='walk the 2.4 release checklist with me')
    add('harbor-cli', 'Shell completions for fish', 'ended', role='child', parent=harbor['id'], minutes=300, span=50, calls=33,
        percent=40, scale=0.5, live=False,
        pr={'number': 88, 'url': 'https://github.com/example/harbor-cli/pull/88', 'repo': 'example/harbor-cli', 'state': 'merged',
            'draft': False, 'title': 'completions: fish', 'ci': 'green', 'mergeable': 'unknown'})
    add('harbor-cli', 'Notes for the 2.5 roadmap', 'idle', model='claude-sonnet-5-5', minutes=1300, span=40, calls=9, percent=9,
        scale=0.2, inj=0, read=0, prompt='draft the 2.5 roadmap from the open issues')

    by_id = {s['id']: s for s in S}
    for s in S:
        if s['parent']:
            by_id[s['parent']]['children'].append(s['id'])

    def total(t):
        out = dict(t['main'])
        for sub in t['subagents']:
            for k, v in sub['tokens'].items():
                out[k] += v
        return out

    for s in S:
        own = total(s['tokens'])
        tree = dict(own)
        for c in s['children']:
            for k, v in total(by_id[c]['tokens']).items():
                tree[k] += v
        s['totals'] = {'own': own, 'tree': tree}

    pending = []
    for s in S:
        if s['state'] == 'need':
            ask = s['pendingAsk']
            pending.append({'session': s['id'], 'kind': 'question' if ask else 'permission',
                            'text': (ask or {}).get('question') or s['needs'], 'options': (ask or {}).get('options') or [],
                            'suggestedReply': None, 'at': (ask or {}).get('at') or s['lastAt']})
        elif s['state'] == 'ready':
            pending.append({'session': s['id'], 'kind': 'merge', 'text': s['prs'][-1]['title'], 'options': [],
                            'pr': s['prs'][-1], 'at': s['lastAt']})
        elif s['state'] == 'stalled':
            pending.append({'session': s['id'], 'kind': 'stalled', 'text': s['detail'], 'options': [], 'at': s['lastAt']})

    projects = {}
    for s in S:
        projects.setdefault(s['project'], {'name': s['project'], 'sessions': [], 'xp': None})['sessions'].append(s['id'])
    xp = {'atlas-api': 5121, 'lumen-web': 948, 'tessera': 245, 'harbor-cli': 163}
    for name, p in projects.items():
        p['xp'] = xp.get(name)

    limits = lambda a, b, c: [
        {'kind': 'session', 'group': 'session', 'model': None, 'percent': a, 'severity': 'normal', 'resetsAt': iso(-140), 'active': True},
        {'kind': 'weekly_all', 'group': 'weekly', 'model': None, 'percent': b, 'severity': 'normal', 'resetsAt': iso(-4300), 'active': True},
        {'kind': 'weekly_scoped', 'group': 'weekly', 'model': 'Fable', 'percent': c, 'severity': 'normal', 'resetsAt': iso(-4300), 'active': True}]
    return {
        'synthetic': True, 'capturedAt': iso(0), 'windowHours': 48.0,
        'machine': {'platform': 'win32', 'claude': '2.1.321 (Claude Code)', 'mnemo': 'mnemo 1.14.2'},
        'accounts': [
            {'id': 'default', 'label': 'main', 'kind': 'claude', 'configDir': '~/.claude', 'active': True, 'accountUuid': '00000000-0000-4000-8000-000000000001',
             'plan': 'max', 'limits': limits(46.0, 21.0, 6.0), 'usageReadAt': None},
            {'id': 'second', 'label': 'second', 'kind': 'claude', 'configDir': '~/.claude-second', 'active': False, 'accountUuid': None,
             'plan': 'max', 'limits': limits(8.0, 2.0, 0.0), 'usageReadAt': None}],
        'projects': sorted(projects.values(), key=lambda p: -len(p['sessions'])),
        'sessions': sorted(S, key=lambda s: s['lastAt'], reverse=True),
        'pending': sorted(pending, key=lambda p: p['at']),
        'vault': {'xp': 11223, 'projectXp': xp, 'rules': 4160,
                  'reflex': {'prompts': 1039, 'outcomes': {'emitted': 219, 'judge_none_relevant': 660, 'notice_below_bar': 68,
                                                           'below_min_tokens': 43, 'session_cap_reached': 21, 'no_term_match': 15, 'deduped': 12}},
                  'learned': [{'at': iso(60 * (i + 1) * 7), 'slug': s, 'name': s.replace('-', ' ').capitalize(), 'projects': [R.choice(list(xp))]}
                              for i, s in enumerate(RULES[:8])]},
    }


if __name__ == '__main__':
    out = os.path.join(HERE, 'data.sample.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.MNEMO = ')
        json.dump(build(), f, ensure_ascii=False, indent=1)
        f.write(';\n')
    print('wrote', os.path.relpath(out))
