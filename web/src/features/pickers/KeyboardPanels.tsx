import { Dialog } from 'radix-ui'
import { useEntities, useIsDesktop } from '../../app/context'
import { Sheet } from '../../ui/Sheet'
import { BINDINGS, displayKeys, type Binding } from '../../app/keymap'
import { targetIds, useUI } from '../../app/ui-state'
import { DeadlinePanel } from './DeadlinePicker'
import { MovePanel } from './MovePicker'
import { TagPanel } from './TagPicker'
import { WhenPanel } from './WhenPicker'

const NO_TAGS: string[] = []

const TITLES = {
  when: 'When',
  deadline: 'Deadline',
  tags: 'Tags',
  move: 'Move',
  help: 'Keyboard shortcuts',
} as const

/**
 * Pickers opened without a trigger button: from the keyboard (⌘S, ⇧⌘D, ⇧T,
 * ⇧M, ?) on desktop, from swipes and the selection bar on mobile.
 */
export function KeyboardPanels() {
  const panel = useUI((s) => s.panel)
  const openPanel = useUI((s) => s.openPanel)
  const ids = panel && panel !== 'help' ? targetIds() : []
  // Select the stored array itself; a fresh [] each time would re-render forever.
  const firstTags =
    useEntities((e) => (ids[0] ? e.todos[ids[0]]?.tagIds : undefined)) ??
    NO_TAGS
  const close = () => openPanel(null)
  const isDesktop = useIsDesktop()

  const body = (
    <>
      {panel === 'when' && <WhenPanel ids={ids} onDone={close} />}
      {panel === 'deadline' && <DeadlinePanel ids={ids} onDone={close} />}
      {panel === 'move' && <MovePanel ids={ids} onDone={close} />}
      {panel === 'tags' && ids[0] && (
        <TagPanel itemId={ids[0]} current={firstTags} />
      )}
      {panel === 'help' && <ShortcutSheet />}
    </>
  )

  // On mobile these open from swipes and the selection bar, as sheets.
  if (!isDesktop) {
    return (
      <Sheet
        open={panel !== null}
        onOpenChange={(o) => !o && close()}
        title={panel ? TITLES[panel] : ''}
      >
        {body}
      </Sheet>
    )
  }

  return (
    <Dialog.Root open={panel !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
        <Dialog.Content
          className={`fixed top-[12vh] left-1/2 z-50 max-h-[76vh] outline-none -translate-x-1/2 overflow-y-auto rounded-[8px] border border-hairline bg-bg p-3 shadow-lg ${panel === 'help' ? 'w-[min(560px,calc(100vw-24px))]' : 'w-[min(300px,calc(100vw-24px))]'}`}
        >
          <Dialog.Title className="mb-2 font-serif text-lg font-semibold">
            {panel ? TITLES[panel] : ''}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {panel === 'help'
              ? 'All keyboard shortcuts'
              : `Set ${panel} for the selected to-dos`}
          </Dialog.Description>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ShortcutSheet() {
  const groups = new Map<Binding['group'], Binding[]>()
  for (const b of BINDINGS) {
    const list = groups.get(b.group) ?? []
    // Show each action once (N and ⌥N both create a to-do).
    if (!list.some((x) => x.description === b.description)) list.push(b)
    groups.set(b.group, list)
  }
  return (
    <>
      <p className="mb-3 text-sm text-text-secondary">
        More in{' '}
        <a
          href="/help/shortcuts"
          target="_blank"
          rel="noopener"
          className="text-accent hover:underline"
        >
          Help
        </a>
        .
      </p>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {[...groups].map(([group, list]) => (
          <section key={group} className="mb-3">
            <h3 className="mb-1 font-serif font-semibold text-accent">
              {group}
            </h3>
            <dl className="text-sm">
              {list.map((b) => (
                <div
                  key={b.keys}
                  className="flex justify-between gap-3 border-b border-hairline py-1"
                >
                  <dt>{b.description}</dt>
                  <dd className="font-mono text-text-secondary">
                    {displayKeys(b.keys)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}
