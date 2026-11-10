// Score: the day, left to right, a line per session, now at the right edge
// (docs/superpowers/specs/2026-11-10-recreation-front.md, "score").
//
//   ScoreView.tsx  the view: the bar, the fleet strip and ruler, the lines, the now column,
//                  the playhead, and the selected session's instruments at its moment
//   model.ts       what is derived from the world (spans, marks, a session at a past moment,
//                  the order of the lines)
//   draw.ts        the canvases and hit-testing
//   state.ts       the zoom, the folds, the playhead's keys
//
// The view takes keys only while focus is inside it. `scoreKey` is the same handling as a
// function, for the frame to route a key here without the score listening on `window`.

export { ScoreView } from './ScoreView'
export { backToNow, movePlayhead, scoreKey, setSpan, toggleFold, zoomAt } from './state'
