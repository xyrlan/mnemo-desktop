import './error-line.css'

/** An error the reader can put away: `onDismiss` adds the ×, without it the error stays. */
export function ErrorLine({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <div className="vt-error-line">
      <pre className="vt-error">{text}</pre>
      {onDismiss && (
        <button title="Dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}
