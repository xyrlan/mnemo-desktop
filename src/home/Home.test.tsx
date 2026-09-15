import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { HomeSnapshot } from "./types";

/** What `home_snapshot` answers; Home loads on mount, so the store state alone is not enough. */
let current: HomeSnapshot = { repos: [], clone_base: "/gh", errors: [] };
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => current) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import Home from "./Home";
import { homeStore } from "./app-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
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
