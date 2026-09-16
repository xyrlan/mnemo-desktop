/** The box at the foot of the sidebar where the vault's level lives: fixed size, docked under
 *  the cockpit body. `vault-level` imports this component and passes its square as children;
 *  with no children an empty bordered square holds the place. This slot stays agnostic about
 *  what fills it — it never imports `src/vaultlevel/`. */
import type { ReactNode } from 'react'

export function VaultLevelSlot({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={`vault-level-slot${className ? ` ${className}` : ''}`}>
      {children ?? <div className="vault-level-placeholder" />}
    </div>
  )
}

export default VaultLevelSlot
