import markUrl from './mark.svg'
import './wordmark.css'

export function Wordmark() {
  return (
    <span className="brand-wordmark">
      <img className="brand-wordmark-mark" src={markUrl} alt="" width={18} height={18} />
      mnemo
    </span>
  )
}
