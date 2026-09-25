// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatToolIcon.tsx
import { Bot, Eye, Folder, Globe, ListChecks, MessageSquareMore, Pencil, Plug, Search, SquareTerminal, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { ToolCategory } from '../run'

const GLYPHS: Record<ToolCategory | 'agent' | 'ask', LucideIcon> = {
  read: Eye,
  search: Search,
  list: Folder,
  command: SquareTerminal,
  edit: Pencil,
  web: Globe,
  mcp: Plug,
  todo: ListChecks,
  other: Wrench,
  agent: Bot,
  ask: MessageSquareMore,
}

/** The fixed 16px slot with a 14px glyph, which keeps every row's text on one left edge.
 *  Decorative: the word beside it is the row's name. */
export function ToolIcon({ kind, className }: { kind: keyof typeof GLYPHS; className?: string }) {
  const Glyph = GLYPHS[kind]
  return (
    <span className={cn('flex size-4 shrink-0 items-center justify-center text-muted-foreground', className)}>
      <Glyph aria-hidden className="size-3.5" />
    </span>
  )
}
