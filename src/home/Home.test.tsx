import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { HomeRepo, HomeSession, HomeSnapshot } from "./types";
import { repoAccent } from "./repo-color";

/** What `home_snapshot` answers; Home loads on mount, so the store state alone is not enough. */
let current: HomeSnapshot = { repos: [], clone_base: "/gh", errors: [], protected: 0 };
/** What `gh_auth` answers; `{}` renders nothing on the header's right side. */
let auth: unknown = {};
/** Every command Home invoked, in order. */
const invoked: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    invoked.push(cmd);
    if (cmd === "home_refresh_github") return undefined;
    return cmd === "gh_auth" ? auth : current;
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import Home from "./Home";
import { homeStore } from "./app-store";
import { githubStore } from "../github/app-store";
import { store as layout } from "../layout/app-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  auth = {};
  invoked.length = 0;
  githubStore.setState({ auth: null });
  homeStore.setState({ selected: null, filter: "", showProtected: false, showHidden: false, github: "idle", githubAt: null, notice: null });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const sess = (o: Partial<HomeSession> & { id: string }): HomeSession => ({
  title: o.id,
  cwd: "/gh/a",
  last_at: 1,
  transcript: true,
  live: null,
  kind: "interactive",
  agent: null,
  ...o,
});
const repo = (o: Partial<HomeRepo> & { root: string }): HomeRepo => ({
  name: o.root.split("/").pop()!,
  last_at: 1,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
  ...o,
});
const snapOf = (repos: HomeRepo[], errors: string[] = []): HomeSnapshot => ({ repos, clone_base: "/gh", errors, protected: 0 });
const issue = (number: number, title: string) => ({
  number,
  title,
  labels: ["bug"],
  assignees: [],
  state: "OPEN",
  url: `https://github.com/o/a/issues/${number}`,
  updated_at: "",
  milestone: null,
  prs: [],
  pieces: [],
});
const pr = (number: number, child: string | null, over: object = {}) => ({
  number,
  title: `pr ${number}`,
  state: "open" as const,
  checks: "none" as const,
  child,
  url: `https://github.com/o/a/pull/${number}`,
  ...over,
});
const group = (root: string) => host.querySelector<HTMLElement>(`.hm-group[data-root="${root}"]`)!;
const texts = (el: ParentNode, sel: string) => [...el.querySelectorAll(sel)].map((n) => n.textContent);

test("every repo is one group in a single stream: issues, PRs, sessions and children together", async () => {
  current = snapOf([
    repo({
      root: "/gh/a",
      pinned: true,
      issues: [issue(3, "crash on start")],
      prs: [pr(9, "cccc1111", { checks: "fail", state: "draft" }), pr(8, null, { checks: "pass" })],
      sessions: [sess({ id: "s1", title: "fix pty", live: "elsewhere" }), sess({ id: "s2", title: "gone", cwd: "/gh/a-wt", transcript: false })],
      children: [sess({ id: "cccc1111-x", title: "Work on issue #3", live: "bg", kind: "background" })],
    }),
    repo({ root: "/gh/b", sessions: [sess({ id: "s3", title: "other repo", cwd: "/gh/b" })] }),
  ]);
  await act(async () => root.render(<Home />));
  expect(texts(host, ".hm-group-head .hm-repo-name")).toEqual(["★ a", "b"]);
  const a = group("/gh/a");
  expect(texts(a, ".hm-section-label")).toEqual(["Issues 1", "PRs 2", "Sessions 2", "Dispatch children 1"]);
  expect(texts(a, ".hm-issue .hm-session-title")).toEqual(["crash on start"]);
  expect(texts(a, ".hm-pr .hm-num")).toEqual(["#9", "#8"]);
  expect(texts(a, ".hm-pr .hm-checks")).toEqual(["✗", "✓"]);
  expect(a.querySelector(".hm-pr .hm-agent")?.textContent).toBe("draft");
  // A PR with no child is ordinary: no badge at all.
  expect(texts(a, ".hm-child")).toEqual(["← child cccc1111"]);
  const rows = a.querySelectorAll<HTMLButtonElement>(".hm-session");
  expect(texts(a, ".hm-session .hm-session-title")).toEqual(["fix pty", "gone", "Work on issue #3"]);
  expect(rows[0].querySelector(".hm-live")?.textContent).toBe("in another terminal");
  expect(rows[0].disabled).toBe(true);
  expect(rows[1].disabled).toBe(true);
  expect(rows[1].querySelector(".hm-session-cwd")?.textContent).toBe("/gh/a-wt");
  expect(rows[2].querySelector(".hm-live")?.textContent).toBe("background");
  expect(texts(group("/gh/b"), ".hm-session-title")).toEqual(["other repo"]);
  // Load picks a default repo for the rest of the app, as before.
  expect(homeStore.getState().selected).toBe("/gh/a");
});

test("every group and so every row carries its repo's accent; rows name their repo", async () => {
  current = snapOf([repo({ root: "/gh/a", sessions: [sess({ id: "s1" })] }), repo({ root: "/gh/b", prs: [pr(1, null)] })]);
  await act(async () => root.render(<Home />));
  expect(group("/gh/a").style.getPropertyValue("--repo")).toBe(repoAccent("/gh/a"));
  expect(group("/gh/b").style.getPropertyValue("--repo")).toBe(repoAccent("/gh/b"));
  expect(group("/gh/a").querySelector(".hm-row")?.getAttribute("title")).toMatch(/^a · /);
  expect(group("/gh/b").querySelector(".hm-row")?.getAttribute("title")).toMatch(/^b · /);
});

test("GitHub is read once when the lens shows and again only from the refresh control", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    current = snapOf([repo({ root: "/gh/a" })]);
    await act(async () => root.render(<Home />));
    const reads = () => invoked.filter((c) => c === "home_refresh_github").length;
    expect(reads()).toBe(1);
    // Sessions were read before GitHub, and the snapshot is read again to carry the lists.
    const snaps = invoked.filter((c) => c === "home_snapshot");
    expect(snaps.length).toBe(2);
    expect(invoked.indexOf("home_snapshot")).toBeLessThan(invoked.indexOf("home_refresh_github"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10 * 60_000)));
    expect(reads()).toBe(1);
    const refresh = host.querySelector<HTMLButtonElement>(".hm-refresh")!;
    expect(refresh.textContent).toBe("↻ GitHub");
    await act(async () => refresh.click());
    expect(reads()).toBe(2);
    expect(homeStore.getState().github).toBe("ready");
  } finally {
    vi.useRealTimers();
  }
});

test("a repo gh could not read still shows its sessions, with the reason; other errors stay in the footer", async () => {
  current = snapOf(
    [repo({ root: "/gh/a", sessions: [sess({ id: "s1", title: "still here" })] }), repo({ root: "/gh/b" })],
    ["github (a): no git remotes found", "history unreadable"],
  );
  await act(async () => root.render(<Home />));
  const a = group("/gh/a");
  expect(a.querySelector(".hm-gh-error")?.textContent).toBe("GitHub could not read this repo: no git remotes found");
  expect(texts(a, ".hm-session-title")).toEqual(["still here"]);
  expect(group("/gh/b").querySelector(".hm-gh-error")).toBeNull();
  expect(host.querySelector(".hm-errors")?.textContent).toBe("history unreadable");
});

test("before any GitHub read a repo without lists renders; an empty one says so", async () => {
  current = snapOf([repo({ root: "/gh/a" })]);
  delete (current.repos[0] as Partial<HomeRepo>).issues;
  await act(async () => root.render(<Home />));
  expect(texts(group("/gh/a"), ".hm-section-label")).toEqual([]);
  expect(group("/gh/a").querySelector(".hm-muted")?.textContent).toBe("No sessions yet.");
});

test("clicking an issue or a PR opens its page; a child badge opens the child", async () => {
  const views: [string, unknown, string | undefined][] = [];
  const typed: [string | undefined, string][] = [];
  const prev = layout.getState();
  layout.setState({
    openView: ((kind: string, props: unknown, _where: unknown, title?: string) => void views.push([kind, props, title])) as never,
    openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]),
  });
  try {
    current = snapOf([
      repo({
        root: "/gh/a",
        issues: [issue(3, "crash")],
        prs: [pr(9, "cccc1111"), pr(10, "dddd2222")],
        children: [sess({ id: "cccc1111-x", live: "bg", kind: "background" })],
      }),
    ]);
    await act(async () => root.render(<Home />));
    const a = group("/gh/a");
    act(() => a.querySelector<HTMLButtonElement>(".hm-issue")!.click());
    act(() => a.querySelector<HTMLButtonElement>(".hm-pr-open")!.click());
    expect(views).toEqual([
      ["browser", { url: "https://github.com/o/a/issues/3" }, "#3"],
      ["browser", { url: "https://github.com/o/a/pull/9" }, "PR #9"],
    ]);
    const badges = a.querySelectorAll(".hm-child");
    expect(badges[0].tagName).toBe("BUTTON");
    act(() => (badges[0] as HTMLButtonElement).click());
    expect(typed).toEqual([["/gh/a", "claude attach cccc1111-x"]]);
    // A child this snapshot does not list is still named, but is not a control.
    expect(badges[1].tagName).toBe("SPAN");
    expect(badges[1].textContent).toBe("← child dddd2222");
  } finally {
    layout.setState({ openView: prev.openView, openCommandTab: prev.openCommandTab });
  }
});

test("the one-click resume still focuses, attaches or resumes, and a group's actions keep working", async () => {
  const typed: [string | undefined, string][] = [];
  const focused: number[] = [];
  const prev = layout.getState();
  layout.setState({
    panes: { 5: { id: 5, sessionId: "live-here" } } as never,
    openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]),
    newTab: async (cwd) => void typed.push([cwd, "shell"]),
    focusPane: (id) => void focused.push(id),
  });
  try {
    current = snapOf([
      repo({ root: "/gh/a" }),
      repo({ root: "/gh/b", sessions: [sess({ id: "live-here", live: "here" }), sess({ id: "in-bg", live: "bg" }), sess({ id: "dead" })] }),
    ]);
    await act(async () => root.render(<Home />));
    const b = group("/gh/b");
    for (const row of b.querySelectorAll<HTMLButtonElement>(".hm-session")) act(() => row.click());
    expect(focused).toEqual([5]);
    const button = (label: string) => [...b.querySelectorAll<HTMLButtonElement>(".hm-group-head button")].find((x) => x.textContent === label)!;
    act(() => button("New session").click());
    act(() => button("Shell").click());
    expect(typed).toEqual([
      ["/gh/b", "claude attach in-bg"],
      ["/gh/b", "claude --resume dead"],
      ["/gh/b", "claude"],
      ["/gh/b", "shell"],
    ]);
    // Acting in a group makes it the repo the rest of the app defaults to.
    expect(homeStore.getState().selected).toBe("/gh/b");
  } finally {
    layout.setState({ panes: prev.panes, openCommandTab: prev.openCommandTab, newTab: prev.newTab, focusPane: prev.focusPane });
  }
});

test("long lists fold: quiet sessions past the recent ones, finished children, issues past five", async () => {
  current = snapOf([
    repo({
      root: "/gh/a",
      issues: [1, 2, 3, 4, 5, 6, 7].map((n) => issue(n, `i${n}`)),
      sessions: ["s1", "s2", "s3", "s4", "s5"].map((id) => sess({ id })).concat(sess({ id: "s6", live: "bg" })),
      children: [sess({ id: "k1" }), sess({ id: "k2", live: "bg" })],
    }),
  ]);
  await act(async () => root.render(<Home />));
  const a = group("/gh/a");
  expect(texts(a, ".hm-issue .hm-num")).toEqual(["#1", "#2", "#3", "#4", "#5"]);
  expect(texts(a, ".hm-session .hm-session-title")).toEqual(["s1", "s2", "s3", "s6", "k2"]);
  expect(texts(a, ".hm-more")).toEqual(["2 more issues", "2 older sessions", "1 finished children"]);
  const more = a.querySelectorAll<HTMLButtonElement>(".hm-more");
  act(() => more[1].click());
  expect(texts(a, ".hm-session .hm-session-title")).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "k2"]);
  act(() => more[2].click());
  expect(texts(a, ".hm-session .hm-session-title")).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "k1", "k2"]);
  expect(texts(a, ".hm-more")).toEqual(["2 more issues", "show less", "show less"]);
});

test("empty history shows the two entry buttons", async () => {
  current = snapOf([]);
  await act(async () => root.render(<Home />));
  expect(host.querySelector(".hm-empty")).not.toBeNull();
  expect(host.querySelectorAll(".hm-empty button")).toHaveLength(2);
});

test("an unresolved repo is folded behind one line, muted when shown, not auto-selected, and read on request", async () => {
  current = { ...snapOf([repo({ root: "/Users/me/Downloads/x", unresolved: true }), repo({ root: "/gh/b" })]), protected: 1 };
  await act(async () => root.render(<Home />));
  expect(host.querySelectorAll(".hm-group")).toHaveLength(1);
  const line = host.querySelector<HTMLButtonElement>(".hm-protected")!;
  expect(line.textContent).toBe("1 protected folder · show");
  act(() => line.click());
  const groups = host.querySelectorAll(".hm-group");
  expect(groups[0].classList.contains("hm-unresolved")).toBe(true);
  expect(groups[1].classList.contains("hm-unresolved")).toBe(false);
  expect(host.querySelector(".hm-group.hm-selected .hm-repo-name")?.textContent).toBe("b");
  expect(host.querySelector(".hm-protected")?.textContent).toBe("hide protected folders");
  // An unresolved group offers to read the repo, not to start work in a path git never saw.
  expect(texts(groups[0], ".hm-group-head button")).toEqual(["Read repo", "Pin", "Hide"]);
  const resolved: string[] = [];
  const select = homeStore.getState().select;
  homeStore.setState({ select: async (r) => void resolved.push(r) });
  act(() => groups[0].querySelector<HTMLButtonElement>(".hm-group-head button")!.click());
  homeStore.setState({ select });
  expect(resolved).toEqual(["/Users/me/Downloads/x"]);
  // Folded again; a typed filter that matches brings it back on its own.
  act(() => host.querySelector<HTMLButtonElement>(".hm-protected")!.click());
  act(() => homeStore.getState().setFilter("downloads"));
  expect(texts(host, ".hm-group-head .hm-repo-name")).toEqual(["x"]);
  act(() => homeStore.getState().setFilter("nothing like it"));
  expect(host.querySelector(".hm-stream .hm-muted")?.textContent).toBe("No repo matches “nothing like it”.");
  act(() => homeStore.getState().setFilter(""));
});

test("the fold and hidden lines count in English: one folder, two folders, one repo, two repos", async () => {
  const at = (name: string, over: Partial<HomeRepo>) => repo({ root: `/Users/me/Downloads/${name}`, ...over });
  const render = async (repos: HomeRepo[]) => {
    current = snapOf(repos);
    homeStore.setState({ selected: null, filter: "", showProtected: false, showHidden: false });
    await act(async () => root.render(<Home key={repos.length} />));
    return texts(host, ".hm-folds .hm-link");
  };
  expect(await render([at("a", { unresolved: true }), at("b", { unresolved: true }), at("c", { hidden: true }), at("d", {})])).toEqual([
    "2 protected folders · show",
    "1 hidden repo",
  ]);
  expect(await render([at("a", { hidden: true }), at("b", { hidden: true }), at("d", {})])).toEqual(["2 hidden repos"]);
  act(() => host.querySelector<HTMLButtonElement>(".hm-folds .hm-link")!.click());
  expect(host.querySelector(".hm-folds .hm-link")?.textContent).toBe("hide hidden repos");
  expect(host.querySelector(".hm-group.hm-hidden .hm-repo-name")?.textContent).toBe("a");
});

test("pin and hide stay on every group", async () => {
  const toggled: string[] = [];
  const prev = homeStore.getState();
  homeStore.setState({ togglePin: async (r) => void toggled.push(`pin ${r}`), toggleHidden: async (r) => void toggled.push(`hide ${r}`) });
  try {
    current = snapOf([repo({ root: "/gh/a", pinned: true })]);
    await act(async () => root.render(<Home />));
    const buttons = [...group("/gh/a").querySelectorAll<HTMLButtonElement>(".hm-group-head button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["New session", "Shell", "Unpin", "Hide"]);
    act(() => buttons[2].click());
    act(() => buttons[3].click());
    expect(toggled).toEqual(["pin /gh/a", "hide /gh/a"]);
  } finally {
    homeStore.setState({ togglePin: prev.togglePin, toggleHidden: prev.toggleHidden });
  }
});

const oneRepo = (): HomeSnapshot => ({
  repos: [{ root: "/gh/a", name: "a", last_at: 1, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }],
  clone_base: "/gh",
  errors: [],
  protected: 0,
});

test("header right side: @login when gh is logged in, the wordmark and repo rows stay", async () => {
  current = oneRepo();
  auth = { installed: true, logged: true, login: "xyrlan", scopes: ["repo", "project"] };
  await act(async () => root.render(<Home />));
  const head = host.querySelector(".hm-head")!;
  expect(head.querySelector(".gh-login")?.textContent).toBe("@xyrlan");
  expect(head.querySelector(".gh-login")?.getAttribute("title")).toContain("project");
  expect(head.querySelector(".brand-wordmark")).not.toBeNull();
  expect(host.querySelectorAll(".hm-group")).toHaveLength(1);
});

test("header right side: Log in to GitHub runs gh auth login --web in a terminal tab", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    current = oneRepo();
    auth = { installed: true, logged: false, login: null, scopes: [] };
    const typed: [string | undefined, string][] = [];
    layout.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) });
    await act(async () => root.render(<Home />));
    const login = [...host.querySelectorAll<HTMLButtonElement>(".hm-head button")].find((b) => b.textContent === "Log in to GitHub")!;
    act(() => login.click());
    expect(typed).toEqual([[undefined, "gh auth login --web"]]);
    // Logged in from that tab: the header follows on the next poll.
    auth = { installed: true, logged: true, login: "me", scopes: [] };
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(host.querySelector(".gh-login")?.textContent).toBe("@me");
  } finally {
    vi.useRealTimers();
  }
});

test("header right side: without gh, offers the brew line", async () => {
  current = oneRepo();
  auth = { installed: false, logged: false, login: null, scopes: [] };
  await act(async () => root.render(<Home />));
  const head = host.querySelector(".hm-head")!;
  expect([...head.querySelectorAll("button")].some((b) => b.textContent === "install gh")).toBe(true);
  expect(head.textContent).toContain("brew install gh");
});
