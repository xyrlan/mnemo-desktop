import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { HomeSnapshot } from "./types";

/** What `home_snapshot` answers; Home loads on mount, so the store state alone is not enough. */
let current: HomeSnapshot = { repos: [], clone_base: "/gh", errors: [] };
/** What `gh_auth` answers; `{}` renders nothing on the header's right side. */
let auth: unknown = {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "gh_auth" ? auth : current)),
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
  githubStore.setState({ auth: null });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("renders repos and sessions from the store, live badge and disabled row", async () => {
  current = {
    repos: [
      {
        root: "/gh/a",
        name: "a",
        last_at: Date.now(),
        pinned: true,
        hidden: false,
        unresolved: false,
        sessions: [
          {
            id: "s1",
            title: "fix pty",
            cwd: "/gh/a",
            last_at: Date.now(),
            transcript: true,
            live: "elsewhere",
            kind: "interactive",
          },
          {
            id: "s2",
            title: "gone",
            cwd: "/gh/a-wt",
            last_at: 1,
            transcript: false,
            live: null,
            kind: "interactive",
          },
        ],
      },
    ],
    clone_base: "/gh",
    errors: [],
  };
  homeStore.setState({ selected: null });
  await act(async () => root.render(<Home />));
  expect(
    host.querySelector(".hm-repo.hm-selected .hm-repo-name")?.textContent,
  ).toBe("★ a");
  const rows = host.querySelectorAll(".hm-session");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector(".hm-live")?.textContent).toBe(
    "em outro terminal",
  );
  expect((rows[0] as HTMLButtonElement).disabled).toBe(true);
  expect((rows[1] as HTMLButtonElement).disabled).toBe(true);
  expect(rows[1].querySelector(".hm-session-cwd")?.textContent).toBe(
    "/gh/a-wt",
  );
});

test("empty history shows the two entry buttons", async () => {
  current = { repos: [], clone_base: "/gh", errors: [] };
  homeStore.setState({ selected: null });
  await act(async () => root.render(<Home />));
  expect(host.querySelector(".hm-empty")).not.toBeNull();
  expect(host.querySelectorAll(".hm-empty button")).toHaveLength(2);
});

test("an unresolved repo is muted and not auto-selected", async () => {
  const repo = { name: "", last_at: 1, pinned: false, hidden: false, sessions: [] };
  current = {
    repos: [
      { ...repo, root: "/Users/me/Downloads/x", name: "x", unresolved: true },
      { ...repo, root: "/gh/b", name: "b", unresolved: false },
    ],
    clone_base: "/gh",
    errors: [],
  };
  homeStore.setState({ selected: null });
  await act(async () => root.render(<Home />));
  const rows = host.querySelectorAll(".hm-repo");
  expect(rows[0].classList.contains("hm-unresolved")).toBe(true);
  expect(rows[1].classList.contains("hm-unresolved")).toBe(false);
  expect(host.querySelector(".hm-repo.hm-selected .hm-repo-name")?.textContent).toBe("b");
});

const oneRepo = (): HomeSnapshot => ({
  repos: [{ root: "/gh/a", name: "a", last_at: 1, pinned: false, hidden: false, unresolved: false, sessions: [] }],
  clone_base: "/gh",
  errors: [],
});

test("header right side: @login when gh is logged in, the wordmark and repo rows stay", async () => {
  current = oneRepo();
  auth = { installed: true, logged: true, login: "xyrlan", scopes: ["repo", "project"] };
  await act(async () => root.render(<Home />));
  const head = host.querySelector(".hm-head")!;
  expect(head.querySelector(".gh-login")?.textContent).toBe("@xyrlan");
  expect(head.querySelector(".gh-login")?.getAttribute("title")).toContain("project");
  expect(head.querySelector(".brand-wordmark")).not.toBeNull();
  expect(host.querySelectorAll(".hm-repo")).toHaveLength(1);
});

test("header right side: Entrar no GitHub runs gh auth login --web in a terminal tab", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    current = oneRepo();
    auth = { installed: true, logged: false, login: null, scopes: [] };
    const typed: [string | undefined, string][] = [];
    layout.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) });
    await act(async () => root.render(<Home />));
    const login = [...host.querySelectorAll<HTMLButtonElement>(".hm-head button")].find((b) => b.textContent === "Entrar no GitHub")!;
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
  expect([...head.querySelectorAll("button")].some((b) => b.textContent === "instalar gh")).toBe(true);
  expect(head.textContent).toContain("brew install gh");
});
