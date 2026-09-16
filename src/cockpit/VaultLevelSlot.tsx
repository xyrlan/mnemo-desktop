/** The box at the foot of the sidebar where the vault's level lives: fixed size, docked under
 *  the cockpit body, holding only a placeholder. `vault-level` fills it from its own module:
 *  it finds `[data-vault-level-slot]`, portals the square in and adds `vl-filled` to this root,
 *  which hides the placeholder (theme.css). The class list only changes with `className`, so a
 *  re-render leaves that class alone. */
export function VaultLevelSlot({ className }: { className?: string }) {
  return (
    <div data-vault-level-slot="" className={`vault-level-slot${className ? ` ${className}` : ''}`}>
      <div className="vault-level-placeholder" />
    </div>
  )
}

export default VaultLevelSlot
