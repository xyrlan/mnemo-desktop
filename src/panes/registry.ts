/** What a view of one pane of the layout store is given: its id, and the props it was opened with
 *  (a presentation's `present`, `name`, `active`, `close`: `src/terminal/view.tsx`). The registry of
 *  views by name went with the workbench, which drew every pane through it: the drawer draws its
 *  terminals directly. */
export type PaneViewProps = { id: number; props: Record<string, unknown> }
