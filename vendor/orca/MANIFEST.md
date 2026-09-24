# Manifest — what each vendored file draws, and what to replace

Paths are relative to `src/renderer/src/` in this folder (Orca's renderer), except
`src/shared/…`. Line ranges `[a-b]` mark the part of a file that carries the visual; the rest of
the file is there for context. Every file also imports `translate` (`@/i18n/i18n`), `cn`
(`@/lib/utils`), lucide-react and Orca's `components/ui/*` — ours are `@/ui/cn` and `@/ui`,
already ported. The tables name only the other, non-visual imports.

**Props Orca's primitives have that the files below use** — check `@/ui` has them before
relying on them:
- `CommandDialog`: `overlayClassName`, `contentClassName`, `commandProps`
- `CommandInput`: `wrapperClassName`, `iconClassName`, `trailing`
- `SheetContent`: `showCloseButton`, `overlayStyle`
- `Button` sizes `icon-xs` and `xs`
- `SwitchIndicator` from `ui/switch`
- `PopoverAnchor` and `PopoverArrow`

**Runtime CSS variables.**
- `App.tsx:79-90` sets `--window-controls-width`, `--window-controls-height` (138px/36px on
  Windows/Linux custom chrome, 0 otherwise), `--mac-traffic-lights-width` and
  `--collapsed-sidebar-header-width`.
- `sidebar/index.tsx` sets `--workspace-sidebar-live-width` on `<html>` during a resize drag.
- `--bg-titlebar` is read but never set, so it always falls back to `--card`.

**npm packages these rely on:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@tanstack/react-virtual`
(sidebar list), `tw-animate-css` (already in).

## 1. App shell

| File | Draws | Replace |
|---|---|---|
| app-shell/AppWorkspaceShell.tsx | Row layout: left column (full `.titlebar` or sidebar-width `.titlebar-left`, floating when collapsed), sidebar slot, center column (workbench and pages), floating right-sidebar toggle at `right: var(--window-controls-width)`, right sidebar | lazy pages, `RecoverableRenderErrorBoundary`, `FloatingTerminalToggleButton`, `AppChromeLayout` |
| app-shell/TitlebarLeftControls.tsx | Traffic-light pad or logo, ··· menu, app name, sidebar toggle, back/forward | store (`toggleSidebar`, `updateSettings`, worktree history), `useShortcutLabel`, `window.api.ui.popupMenu`, logo |
| app-shell/TitlebarMainStrip.tsx | `#titlebar-tabs` portal slot, collapse-pane button, right-sidebar toggle, window-controls spacer | store `toggleRightSidebar`, `ActivityTitlebarControls` |
| app-shell/WindowControls.tsx | Minimize, maximize/restore, close (Windows/Linux) | `window.api.ui.*` |
| app-shell/app-window-chrome.ts | Platform constants (138px/36px/80px) | `lib/desktop-window-chrome` |
| app-shell/use-app-chrome-layout.ts | Which titlebar variant mounts, floating vs docked | many store selectors |
| lib/titlebar-left-chrome.ts | Pure `shouldMount` / `isFloating` rule | — |
| components/TerminalWorkbenchContainer.tsx | Show/hide wrapper for the workbench | `useAnyBrowserGuestNeedsPaint` |
| App.tsx [76-113] | `.app-layout` root with the CSS variables | providers |
| app-shell/AppRootSurfaces.tsx [176-194, 283-299] | Status bar slot (24px fallback strip), `NotificationCardStack` mount | store `statusBarVisible` |
| hooks/useSidebarResize.ts | Drag-resize with clamp and draft width, both sidebars | — |

## 2. Left sidebar

Card modes (`sidebar/use-worktree-card-foundation.ts:47-48`): default (both flags false), compact
(`settings.compactWorktreeCards`), and an experimental new style. Inline agents default to
`'compact'`, rendered by the compact agent row.

| File | Draws | Replace |
|---|---|---|
| sidebar/index.tsx [34-41, 152-246] | `bg-worktree-sidebar` column: Nav, Header, List, Toolbar; drop target; resize handle on the seam | store (open, width, body), project drop, workspace board |
| sidebar/SidebarNav.tsx [88-152] | Search pill with hover-revealed key caps; nav entry (active `bg-worktree-sidebar-accent`) | store `openModal('worktree-palette')`, `activeView`; setup-guide and tasks entries (out) |
| sidebar/SidebarHeader.tsx [48-94, 124-134] | "Projects"/"Workspaces" title, bell toggle, action cluster | store `sidebarBody`, `groupBy`; intro popover (out) |
| sidebar/sidebar-header-actions.tsx | Add-project and New-workspace ghost icon buttons with tooltips | store `openModal`, keybindings, tour handoff (out) |
| sidebar/AgentDashboardSidebarEntry.tsx | "Agent Dashboard" entry with per-bucket dots and counts | `useAgentBucketCounts`, drawer flag, `window.api.dashboard.openPopout` |
| sidebar/worktree-list/viewport/VirtualizedWorktreeViewport.tsx [322-373] | listbox scroller (`worktree-sidebar-scrollbar scrollbar-sleek`), spacer, drop indicators, rows, scroll-to-top | ~20 hooks (virtualizer, keyboard nav, drag, reveal) |
| sidebar/worktree-list/rows/SectionHeader.tsx [179-403] | Project header row: h-7, sticky when active, drag-lift, collapse chevron, hover-revealed actions | header drag/collapse context, repo indicators |
| sidebar/ProjectHeaderActions.tsx | Actions hidden until hover (`can-hover:`) | — |
| sidebar/repo-header-action-button-class.ts | Width-reveal class for the header "+" | — |
| sidebar/worktree-list/rows/item-row.tsx [149-229] | Row wrapper (`role=option`, `opacity-0` while dragged) around the card | selection/drag context |
| sidebar/worktree-list/rows/indentation.ts [1-35, 146-187] | Indent and inset numbers | — |
| sidebar/WorktreeSidebarDropIndicator.tsx | Dot–line–dot insertion marker | — |
| sidebar/project-header-color.ts | Repo badge colour | shared constants |
| repo/repo-icon.tsx [130-186] | `RepoIconGlyph` (lucide, emoji or letter) | icon catalog |
| repo/RepoBadgeLabel.tsx | `RepoBadgeMark` colour dot | — |
| sidebar/WorktreeCard.tsx | Controller → surface | `useWorktreeCardController` (store-heavy) |
| sidebar/worktree-card-surface.tsx | Card body: rounded-lg, hover/active/multi-select, reveal glow, deleting overlay, sleeping dim, native drag | rename-failed dialog, context menu (out), sleeping flag |
| sidebar/worktree-card-presentation.tsx | Flags for default, compact and new styles; padding | details hover, ports (out) |
| sidebar/worktree-card-parent-content.tsx | Status lane + identity column + secondary rows | same |
| sidebar/worktree-card-header.tsx [1-105, 158-321] | Repo chip, title, primary/sparse badges, star (compact), hover trash | card model helpers; SSH block 106-157 (out) |
| sidebar/WorktreeTitleInlineRename.tsx [25-50, 336-385] | Title (unread = semibold), tooltip on truncation | rename and emoji paths (out) |
| sidebar/worktree-card-meta-row.tsx | Branch label, repo pill, conflict badge | `DetachedHeadBadge`, `CacheTimer`, host badge |
| sidebar/WorktreeCardMetaBadges.tsx | Right-aligned badges (PR via `ReviewIcon`, issue, notes) | Linear/Jira icons (out) |
| sidebar/WorktreeCardMetadataControls.tsx [1-17] | `MetaIconBadge` | — |
| sidebar/worktree-card-secondary-rows.tsx | Conflict notice, inline agents, lineage chip | Linear prompt (out) |
| sidebar/WorktreeCardStatusSlot.tsx | Status/unread lane: bell toggle crossfading with status on hover; amber unread dot | activity status, sleeping flag |
| sidebar/StatusIndicator.tsx | Worktree status glyph (spinner, activity, question, dots) | `lib/worktree-status` |
| sidebar/WorktreeCardHelpers.tsx | `FilledBellIcon`, `PullRequestIcon`, conflict labels | shared types |
| sidebar/worktree-review-helpers.tsx | `ReviewIcon` with check/state tone | — |
| github/review-state-presentation.ts | Merged/closed/draft icon map | shared type |
| sidebar/truncated-sidebar-label.tsx | Label that shows a tooltip only when overflowing | — |
| sidebar/WorktreeCardAgents.tsx [300-404] | Compact agents: summary pill or tree | expansion state, lineage tree, `useNow` |
| sidebar/worktree-card-compact-agents.tsx | Summary pill (state dot + overlapping agent icons, chevron), grid-row expansion | summary helpers |
| sidebar/worktree-card-compact-agent-row.tsx [68-310] | h-6 agent row: dot, icon, text, model, time, child disclosure | conversation name, prompt-cache countdown |
| sidebar/worktree-card-agent-summary.ts | Groups and labels for the pill | `lib/agent-row-dot-state` |
| dashboard/useDashboardData.ts | `DashboardAgentRow` type only | shared types |

## 3. Tab bar and tab groups

| File | Draws | Replace |
|---|---|---|
| tab-bar/tab-bar-surface.tsx [103-225] | Strip with scroll chevrons, `SortableContext`, fade mask, "+" (h-7 w-7) and menu | runtime/menu controllers, overflow helpers (out) |
| tab-bar/SortableTab.tsx | Tab: active bottom bar, amber unread wash, leading icon, pin, title + tooltip, colour dot, close X on hover, dblclick rename, middle-click close | activity status, `useTabAgent`, `useSortable`, context menu (out) |
| tab-bar/EditorFileTab.tsx [365-383] | Dirty dot and close X sharing one slot | — |
| tab-bar/EditorFileTabCloseButton.tsx | Close X visibility rules | shortcut label |
| tab-bar/TerminalTabLeadingIcon.tsx | Bell / `AgentStateDot` / agent icon / shell icon | shell icons |
| tab-bar/terminal-tab-activity-status.ts [239-255] | Status → dot state | — |
| tab-bar/drop-indicator.ts | Blue 2px insertion bars, active-tab classes | — |
| tab-bar/tab-width-rules.ts | 180/220px tab width | — |
| tab-bar/TabDragPreview.tsx | DragOverlay ghost chip | file-type icon |
| tab-bar/tab-strip-scroll-metrics.ts [55-70] | Fade-mask class picker | — |
| tab-bar/tab-strip-pointer-activation.ts, tab-strip-pointer-gesture.ts, middle-button-default-guard.ts | Activate on pointer-up unless dragged | — |
| tab-group/TabGroupSplitLayout.tsx | Recursive split tree; `ResizeHandle` (pointer capture, clamp 0.15–0.85); DndContext and DragOverlay | store split ratio |
| tab-group/TabGroupPanel.tsx [220-381] | Group frame: 32px strip, focus dimming, focused-only actions, body | workspace model commands |
| tab-group/TabGroupDropOverlay.tsx | Half-pane blue overlay + "New split" label | — |
| tab-group/TabPaneColumnSplitDragOverlay.tsx | Portal overlay over the hovered panel edge | — |
| tab-group/tab-drag-context.tsx, tab-drag-data.ts, useTabDragSplit.ts, tab-insertion.ts, tab-drop-zone.ts, tab-group-panel-split-target.ts, tab-drag-pointer.ts, tab-drag-hover-preview.ts [100-125] | Drag orchestration, insertion and edge-split geometry (20% bands) | store reorder/drop; the pointer sensor uses a 12px activation distance |

## 4. Status bar

| File | Draws | Replace |
|---|---|---|
| status-bar/StatusBarSurface.tsx [94-110, 219-302] | h-6 bar (`border-t`, `bg-[var(--bg-titlebar,var(--card))]`), spacer, right cluster, toggle with amber attention dot | controller, segments (out) |
| status-bar/StatusBarProviderSegment.tsx [15-56, 173-253] | Usage meter (48×6 `MiniBar`, % label, warning), letter badge | rate-limit types and helpers |
| status-bar/usage-percentage-label.ts | "% used/left" | — |
| status-bar/tooltip.tsx [78-101, 191-199] | `ProviderIcon`, `barColor` | icons |
| status-bar/icons.tsx [1-18, 318-345] | OpenAI, Claude, Droid SVGs | — |

## 5. Agent dashboard kanban

| File | Draws | Replace |
|---|---|---|
| dashboard/AgentDashboardDrawer.tsx [156-230] | Non-modal left sheet at the sidebar edge (`workspace-kanban-sheet-content` clip-path reveal) | drawer flags, live snapshot, reveal, pop-out |
| dashboard-popout/AgentKanbanBoard.tsx [38-111, 240-306] | Header, 4 columns (Needs You / Working / Done / Idle, `rounded-xl bg-muted/30`, count pill), scroller | ack/reveal defaults, toolbar, terminal dialog (out) |
| dashboard-popout/AgentKanbanCard.tsx [1-55, 116-168, 186-359] | Card with attention/done tint, `viewTransitionName`, icon, heading, dot, You/Agent lines, review pill, subagents | host badge (out), display state |
| dashboard-popout/agent-board-transitions.css | View-transition move/enter/exit keyframes | — |
| dashboard-popout/useDashboardSnapshot.ts [110-128] | `startViewTransition` + `flushSync` when a column changes | snapshot source |
| sidebar/workspace-chrome-metrics.ts | Top/bottom chrome heights | — |
| `src/shared/dashboard-snapshot.ts` [14-157] | Bucket, card, snapshot types; `DASHBOARD_BUCKET_ORDER` | — |

## 6. Agent state visuals

| File | Draws |
|---|---|
| components/AgentStateDot.tsx | Per-state glyph (spinner, activity, check, dashed, question, dots), sm/md |
| components/AgentWorkingSpinner.tsx | CSS spinner with phase sync on `animationstart` |
| components/StateIndicatorTooltip.tsx | 200ms-delay tooltip |
| components/ShortcutKeyCombo.tsx | Key caps, "+" separator off Mac |
| components/AgentQuestionIcon.tsx | `MessageCircleQuestion` in `text-agent-question` |
| lib/agent-catalog.tsx [334-415] | `AgentIcon` |
| lib/worktree-status.ts [15-22, 33-41, 160-162] | `WorktreeStatus` type and labels |

## 7. Notifications

| File | Draws |
|---|---|
| components/NotificationCardStack.tsx | Fixed bottom-right column (`bottom-10 right-4 w-[360px]`, reverse stack) |
| components/UpdateCard.tsx [232-276] | Stacked card shell with `animate-update-card-enter/exit` |

Toasts are `@/ui`'s `Toaster` (sonner), styled by `assets/main.css` 410-480.

## 8. Pet overlay

mnemo's pet is the octopus (`src/avatar/`); Orca's sprites are not vendored.

| File | Draws | Replace |
|---|---|---|
| pet/PetOverlay.tsx [1-121, 218-445] | Fixed draggable pet, hit area hugging the sprite, `pet-bob` keyframes, sprite-row animation, position clamp in localStorage | agent status maps, pet URL cache |
| pet/pet-agent-state.ts | Agent state → animation name | freshness check |
| pet/usePetPointerInteraction.ts | Drag, hover, run left/right | — |
| pet/sprite-animation-css.ts | Steps keyframe builder | — |
| pet/pet-models.ts, pet/pet-overlay-visibility.ts | Bundled pets, gate | — |
| hooks/usePrefersReducedMotion.ts | — | — |

## 9. Jump palette (Mod+J)

| File | Draws | Replace |
|---|---|---|
| components/WorktreeJumpPalette.tsx | Mount with a 300ms close linger | `activeModal`, controller (~15 hooks) |
| components/worktree-jump-palette-surface.tsx | 900px blurred `CommandDialog`, h-12 input, list, footer key hints | filter menu/chips, live status, emoji popover (out) |
| components/worktree-jump-palette-entry.tsx | Section header, "see more", row dispatch | other row kinds (out) |
| components/worktree-jump-palette-worktree-row.tsx | Status dot, highlighted title, age, Current/primary chips, branch, repo pill | live status dot, host badge, repo resolution |
| components/worktree-jump-palette-primitives.tsx [33-108, 270-292, 315-334] | `HighlightedText`, `PaletteState`, `FooterKey` | search types |
| components/worktree-jump-palette-model.ts [19-98] | Entry types | search types |
| components/cmd-j/palette-session-age.ts | "5m" age text | — |

## 10. New workspace composer

| File | Draws | Replace |
|---|---|---|
| components/NewWorkspaceComposerModal.tsx [69-100, 274-305] | `Dialog` (`sm:max-w-lg`, scroll body), header | composer state, `closeModal` |
| components/NewWorkspaceComposerCard.tsx [286-361] | Section stack, file-drag ring, footer | SSH/runtime logic above 286 (out) |
| new-workspace/NewWorkspaceComposerProjectSection.tsx [82-203] | Project label and field, add-project button | remote run target (out) |
| new-workspace/ProjectCombobox.tsx, ProjectComboboxRow.tsx, type-ahead-combobox-styles.ts, use-type-ahead-combobox.ts, use-wheel-scrollable.ts | Input-shaped trigger with popover list, recents, rows with badge dot and elided path; type-ahead keys | matching, recents |
| new-workspace/NewWorkspaceComposerNameSection.tsx [84-202] | Name label, warning, "use as branch" check | smart name search (out; its plain input is `h-9 bg-background pl-8 text-sm`), base-ref picker |
| new-workspace/NewWorkspaceComposerAgentSection.tsx | Agent field and settings button | agent combobox (out) |
| new-workspace/NewWorkspaceComposerFooter.tsx | Error box, switch row, Create button with ⌘↵ cap and spinner | — |

## 11. Right sidebar frame

| File | Draws | Replace |
|---|---|---|
| right-sidebar/index.tsx [31, 81-214] | `bg-sidebar` panel, `border-l`, top or side activity bar, 36px header + close, left-edge resize strip | open/width/position, tab routing |
| right-sidebar/right-sidebar-top-activity-bar.tsx | 36px icon tab strip with overflow | position menu (out) |
| right-sidebar/activity-bar-buttons.tsx | Icon tab (active 2px bar, status dot), overflow dropdown | check status type |
| right-sidebar/activity-bar-overflow.ts, right-sidebar-width.ts, right-sidebar-titlebar-drag-regions.ts | Fit-to-width split, width clamps, class constants | — |
| right-sidebar/right-sidebar-panel-content.tsx | Tab → panel switch | lazy panels |
| right-sidebar/local-workspace-ports-panel.tsx [198-225], local-port-section.tsx, local-port-row.tsx [95-196] | Example panel: uppercase header + refresh, sticky collapsible section with count, row with hover actions | port runtime, clipboard |

## CSS the areas rely on

`assets/main.css`:
- 1-2 imports; 27, 33 `@custom-variant dark` and `can-hover`
- tokens: `@theme` 64-65, 73-78, 103, 113-114, 124 (agent-question, worktree-sidebar*,
  ai-action-accent, tab-group-split-divider*, `--shadow-floating`); `:root` 180-187, 206-219,
  256-260; `.dark` 303-306, 320-338, 375-377
- 410-480 sonner toasts
- 536-626 `.scrollbar-sleek` (ported), `.scrollbar-sleek-parent`, `.worktree-sidebar-scrollbar`
- 685-730 tab-strip hidden scrollbar and fade masks
- 734-746 `#root`, `.app-layout`
- 756-800 `.tab-group-split-resize-handle` (6px hit area, 3px line, hover/dragging)
- 802-1091 (skip 870-876) titlebar, traffic pad, logo, window controls, right-sidebar header,
  sidebar toggles, titlebar icon buttons
- 1204-1234 jump palette selected row
- 1268-1349 `.worktree-sidebar-card-hover`, `[data-worktree-card-active]`,
  `[data-worktree-sleeping-dim]`, `.worktree-agent-row-hover`
- 1489-1553 `.worktree-agent-lineage-*`
- 1576-1704 compact agent expansion grid, `@keyframes agent-spinner-rotate`,
  `.agent-working-spinner`, summary panel, `[data-compact-agent-list]`
- 1706-1761 scroll-to-current-workspace highlight and glow keyframes
- 1852-1885, 1910-1928 `.workspace-kanban-sheet-content` and its clip-path keyframes
- 1993-2023 sidebar drag preview and count badge
- 2358-2382, 2395-2397 update-card enter/exit

`assets/terminal.css` 219-243: `.tab-drop-overlay`, `.tab-drop-overlay__label`.
`pet-bob` keyframes are injected by `pet/PetOverlay.tsx:312`.
