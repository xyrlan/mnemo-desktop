import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { label: string; children: ReactNode }
type State = { error: Error | null }

/**
 * A render error inside one tab, the sidebar or Home must not unmount the whole
 * app: React drops the root on an uncaught error and the window turns into a
 * `--bg` rectangle. The boundary shows the error where the view was and keeps
 * everything else alive; "retry" re-renders once the underlying state changed.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] crashed`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crashed" role="alert">
        <div className="crashed-title">{this.props.label} crashed</div>
        <pre className="crashed-error">{error.message}</pre>
        <button onClick={() => this.setState({ error: null })}>retry</button>
      </div>
    )
  }
}
