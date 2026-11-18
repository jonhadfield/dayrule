// The help articles (PLAN.md §8): short, plain, with a diagram where a
// picture is clearer than words.

import { BINDINGS, displayKeys, type Binding } from '../../app/keymap'
import { Arrow, Box, Diagram, Label, type Tone } from './Diagram'
import { H2, K, List, P, Tip } from './Prose'
import type { TopicSlug } from './topics'

export function Article({ slug }: { slug: TopicSlug }) {
  switch (slug) {
    case 'start':
      return <Start />
    case 'lists':
      return <Lists />
    case 'scheduling':
      return <Scheduling />
    case 'projects':
      return <Projects />
    case 'devices':
      return <Devices />
    case 'privacy':
      return <Privacy />
    case 'shortcuts':
      return <Shortcuts />
    case 'data':
      return <Data />
  }
}

function Start() {
  return (
    <>
      <P>
        Dayrule keeps your to-dos in a few lists. You write things down as they
        come to you, then decide when to do them. Each day, Today shows what’s
        on.
      </P>
      <Diagram
        width={640}
        height={220}
        description="A new to-do goes into the Inbox. From there you send it to Today, Scheduled for a date, or the Backlog. When you complete it, it goes to Done."
        caption="The life of a to-do."
      >
        <Box x={70} y={110} w={100} label="Add" tone="accent" />
        <Box x={210} y={110} w={110} label="Inbox" sub="not sorted yet" />
        <Arrow x1={120} y1={110} x2={153} y2={110} />
        <Box
          x={400}
          y={45}
          w={150}
          label="Today"
          sub="do it today"
          tone="today"
        />
        <Box
          x={400}
          y={110}
          w={150}
          label="Scheduled"
          sub="on a later date"
          tone="scheduled"
        />
        <Box
          x={400}
          y={175}
          w={150}
          label="Backlog"
          sub="any time, or not now"
          tone="ready"
        />
        <Arrow x1={266} y1={102} x2={324} y2={50} />
        <Arrow x1={266} y1={110} x2={324} y2={110} />
        <Arrow x1={266} y1={118} x2={324} y2={170} />
        <Box x={580} y={110} w={90} label="Done" tone="done" />
        <Arrow x1={476} y1={55} x2={534} y2={100} />
        <Arrow x1={476} y1={165} x2={534} y2={120} />
      </Diagram>
      <H2>Add a to-do</H2>
      <List ordered>
        <li>
          Press <K>Add</K> at the bottom of a list (or <K>N</K> on a keyboard).
        </li>
        <li>Type what needs doing. Add notes underneath if you like.</li>
        <li>
          Press <K>Enter</K> or click away to close it. A new to-do with nothing
          typed in it is thrown away.
        </li>
      </List>
      <P>
        A to-do lands in the list you added it from: add it in Today and it’s
        for today.
      </P>
      <H2>Sort your Inbox</H2>
      <P>
        To-dos you add in the Inbox wait there until you decide. Open one and
        choose <K>When</K>: Today, a date, Backlog or Not now. Or move it into a
        project.
      </P>
      <H2>Get it done</H2>
      <P>
        Tick the circle to complete a to-do. It stays in its list for a moment,
        then moves to Done.
      </P>
      <Tip>
        Not sure where something belongs? Leave it in the Inbox and sort it
        later.
      </Tip>
    </>
  )
}

function Lists() {
  const rows: [string, string, string][] = [
    ['Inbox', 'New to-dos you haven’t sorted yet.', 'plain'],
    [
      'Today',
      'Anything for today: started today or earlier, or due today.',
      'today',
    ],
    [
      'Scheduled',
      'To-dos with a date in the future, by day for the next week, then by month.',
      'scheduled',
    ],
    [
      'Backlog',
      'To-dos you could do any time, grouped by project and area. At the end, Not now holds ideas and maybes you don’t want to think about yet.',
      'ready',
    ],
    ['Done', 'Everything you’ve completed, newest first.', 'done'],
    ['Trash', 'Deleted to-dos and projects, until you empty it.', 'muted'],
  ]
  return (
    <>
      <P>
        Every to-do shows in one list at a time. Which one depends on what
        you’ve told Dayrule about it.
      </P>
      <Diagram
        width={640}
        height={336}
        description="How Dayrule picks a list: completed to-dos are in Done. Otherwise, if you set it to Not now, it's in the Not now section of the Backlog. If it's for today or due today, it's in Today. If it has a later date, it's in Scheduled. If it's sorted but has no date, it's in the Backlog. If you haven't sorted it yet, it's in the Inbox."
        caption="Which list a to-do shows in, checked from top to bottom."
      >
        {(
          [
            ['Completed?', 'Done', 'done'],
            ['Set to Not now?', 'Not now', 'later'],
            ['For today, or due today?', 'Today', 'today'],
            ['Has a later date?', 'Scheduled', 'scheduled'],
            ['Sorted, no date?', 'Backlog', 'ready'],
          ] as [string, string, Tone][]
        ).map(([q, list, tone], i) => (
          <g key={q}>
            <Box
              x={190}
              y={30 + i * 52}
              w={280}
              h={36}
              label={q}
              tone="muted"
            />
            <Arrow
              x1={330}
              y1={30 + i * 52}
              x2={448}
              y2={30 + i * 52}
              label="yes"
            />
            <Box
              x={520}
              y={30 + i * 52}
              w={130}
              h={36}
              label={list}
              tone={tone}
            />
            {i < 4 && (
              <Arrow x1={190} y1={48 + i * 52} x2={190} y2={64 + i * 52} />
            )}
          </g>
        ))}
        <Arrow x1={190} y1={256} x2={190} y2={286} />
        <Label x={204} y={276} anchor="start">
          no to all
        </Label>
        <Box x={190} y={306} w={130} h={36} label="Inbox" tone="plain" />
      </Diagram>
      <H2>The lists</H2>
      <ul className="mb-3 divide-y divide-hairline border-y border-hairline">
        {rows.map(([name, what]) => (
          <li key={name} className="flex gap-4 py-2">
            <strong className="w-24 shrink-0">{name}</strong>
            <span>{what}</span>
          </li>
        ))}
      </ul>
      <P>
        Your projects and areas appear in the sidebar too (on a phone, on the
        first screen). Their to-dos also show in Today, Scheduled and Backlog
        when they fit there.
      </P>
      <H2>Tags</H2>
      <P>
        Give to-dos tags such as “Errand” or “Phone”. Lists that use tags show
        them at the top: tap one to see only those to-dos.
      </P>
    </>
  )
}

function Scheduling() {
  return (
    <>
      <P>
        A to-do can have a start date (when to do it), a deadline (when it must
        be done), or both.
      </P>
      <Diagram
        width={640}
        height={200}
        description="A timeline. A to-do with today's date is in Today. One with a later date waits in Scheduled and moves to Today on that day. A deadline is shown with a flag, and the to-do appears in Today on its deadline even if you didn't schedule it."
        caption="Start dates move a to-do into Today on the day. Deadlines warn you."
      >
        <line
          x1={40}
          y1={110}
          x2={610}
          y2={110}
          strokeWidth={2}
          className="stroke-hairline"
        />
        {[
          [80, 'Today'],
          [230, 'Thu'],
          [380, 'Fri'],
          [530, 'Mon'],
        ].map(([x, d]) => (
          <g key={d}>
            <line
              x1={x as number}
              y1={104}
              x2={x as number}
              y2={116}
              strokeWidth={2}
              className="stroke-text-secondary"
            />
            <Label x={x as number} y={134}>
              {d}
            </Label>
          </g>
        ))}
        <Box x={80} y={55} w={110} h={40} label="Today" tone="today" />
        <Arrow x1={80} y1={76} x2={80} y2={102} />
        <Box
          x={230}
          y={55}
          w={130}
          h={40}
          label="Scheduled"
          sub="starts Thursday"
          tone="scheduled"
        />
        <Arrow x1={230} y1={78} x2={230} y2={102} />
        <Box
          x={455}
          y={55}
          w={150}
          h={40}
          label="Deadline: Fri"
          sub="must be done by"
          tone="plain"
        />
        <Arrow x1={420} y1={78} x2={385} y2={102} />
        <Label x={530} y={175}>
          repeats every Monday
        </Label>
        <circle cx={530} cy={110} r={6} className="fill-accent" />
      </Diagram>
      <H2>When</H2>
      <P>
        Open a to-do and choose <K>When</K>:
      </P>
      <List>
        <li>
          <strong>Today</strong> — it shows in Today now.
        </li>
        <li>
          <strong>A date</strong> — it waits in Scheduled and appears in Today
          on that date.
        </li>
        <li>
          <strong>Backlog</strong> — no date, do it when you can.
        </li>
        <li>
          <strong>Not now</strong> — at the end of the Backlog, out of the way
          until you choose otherwise.
        </li>
      </List>
      <P>
        You can also type in the When box: <K>tom</K>, <K>fri</K>,{' '}
        <K>next week</K>, <K>in 3 days</K> or a date such as <K>10/20</K>. Dates
        are shown year first, like 2026/10/20.
      </P>
      <H2>Deadlines</H2>
      <P>
        A deadline puts a flag on the to-do. On the day it’s due, it appears in
        Today even if you didn’t schedule it, and it turns red if it’s late.
      </P>
      <H2>Repeating to-dos</H2>
      <P>
        Choose <K>Repeat</K> in a to-do: daily, weekly on the days you pick,
        monthly or yearly, every so many days, weeks, months or years.
      </P>
      <List>
        <li>
          <strong>On a schedule</strong> — a new copy appears on each date, like
          “every Monday”.
        </li>
        <li>
          <strong>After I complete the last one</strong> — the next copy is due
          a set time after you finish the last, like “3 weeks after my last
          haircut”.
        </li>
      </List>
      <P>
        The repeating to-do itself lives in Scheduled at its next date. Open it
        there to change it, or to stop it repeating. If you’re away for a while,
        you get one copy for the latest date, not one for every day you missed.
      </P>
      <H2>Reminders</H2>
      <P>
        Choose <K>Reminder</K> in a to-do to be reminded at a time: on the hour,
        or at quarter past, half past or quarter to. Turn reminders on first, in
        Account → Reminders, as a notification, an email or both.
      </P>
    </>
  )
}

function Projects() {
  return (
    <>
      <P>
        A <strong>project</strong> is a piece of work made of several to-dos,
        with an end, like “Paint the kitchen”. An <strong>area</strong> is a
        part of your life with no end, like “Home” or “Work”, that holds
        projects and to-dos.
      </P>
      <Diagram
        width={640}
        height={250}
        description="An area called Home contains a project called Paint the kitchen and a loose to-do, Fix the gate. The project is split into two headings, Buy and Do, each with its own to-dos."
        caption="Areas hold projects. Projects can be split with headings."
      >
        <rect
          x={20}
          y={15}
          width={600}
          height={225}
          rx={12}
          strokeWidth={1.5}
          className="fill-bg stroke-text"
        />
        <Label x={40} y={40} anchor="start" size={14} strong>
          Area: Home
        </Label>
        <rect
          x={40}
          y={55}
          width={400}
          height={170}
          rx={10}
          strokeWidth={1.5}
          className="fill-sidebar stroke-hairline"
        />
        <Label x={58} y={80} anchor="start" size={13} strong>
          Project: Paint the kitchen
        </Label>
        <Label x={60} y={108} anchor="start">
          Heading: Buy
        </Label>
        <Box
          x={170}
          y={132}
          w={190}
          h={30}
          label="○ Paint and brushes"
          tone="plain"
        />
        <Label x={60} y={170} anchor="start">
          Heading: Do
        </Label>
        <Box
          x={170}
          y={194}
          w={190}
          h={30}
          label="○ Paint the walls"
          tone="plain"
        />
        <Box x={325} y={132} w={100} h={30} label="○ Tape" tone="plain" />
        <Box
          x={530}
          y={140}
          w={150}
          h={36}
          label="○ Fix the gate"
          tone="plain"
        />
        <Label x={530} y={115}>
          a loose to-do
        </Label>
      </Diagram>
      <H2>Make one</H2>
      <P>
        Choose <K>New List</K> at the bottom of the sidebar, then{' '}
        <K>New Project</K> or <K>New Area</K>. Give it a name. Add to-dos inside
        it with <K>Add</K>.
      </P>
      <H2>Headings</H2>
      <P>
        In a project, add headings to split it into stages (<K>Shift</K>{' '}
        <K>N</K> on a keyboard). Drag to-dos between them.
      </P>
      <H2>Finishing</H2>
      <P>
        The circle next to a project fills in as you complete its to-dos.
        Complete the project itself and everything left in it is completed too.
      </P>
      <Tip>
        Move a to-do into a project with Move, or drag it onto the project in
        the sidebar.
      </Tip>
    </>
  )
}

function Devices() {
  return (
    <>
      <P>
        Use Dayrule on as many phones and computers as you like. Sign in with
        the same email and password and your to-dos follow you.
      </P>
      <Diagram
        width={640}
        height={220}
        description="Your phone and your computer each lock your to-dos with your key before sending them. The Dayrule server stores and passes on the locked copies, but cannot open them. Each device unlocks them with your key."
        caption="Changes are locked on your device, passed through the server, and unlocked on your other devices."
      >
        <Box
          x={95}
          y={70}
          w={150}
          h={60}
          label="Your phone"
          sub="holds your key"
          tone="plain"
        />
        <Box
          x={95}
          y={170}
          w={150}
          h={60}
          label="Your computer"
          sub="holds your key"
          tone="plain"
        />
        <Box
          x={455}
          y={120}
          w={230}
          h={80}
          label="Dayrule server"
          sub="only locked copies, no key"
          tone="muted"
        />
        <Arrow x1={172} y1={72} x2={338} y2={108} both label="locked copies" />
        <Arrow
          x1={172}
          y1={168}
          x2={338}
          y2={132}
          both
          label="locked copies"
          labelDy={14}
        />
      </Diagram>
      <H2>Sync</H2>
      <P>
        Changes sync on their own, within a few seconds when you’re online. The
        status at the bottom of Settings says when it last synced. If the
        session expires, your lists stay on this device; Sign in to sync
        connects them again.
      </P>
      <H2>Offline</H2>
      <P>
        Dayrule works without a connection. Everything you change is saved on
        your device and sent when you’re back online. If you change the same
        to-do on two devices while offline, each change is kept where it doesn’t
        clash; where it does, the most recent wins.
      </P>
      <H2>Install it like an app</H2>
      <List>
        <li>
          <strong>iPhone and iPad:</strong> in Safari, tap Share, then Add to
          Home Screen.
        </li>
        <li>
          <strong>Android:</strong> in Chrome, open the menu and choose Install
          app. From other apps, Share → Dayrule creates an Inbox to-do with the
          shared title, text and link.
        </li>
        <li>
          <strong>Computer:</strong> in Chrome or Edge, click the install icon
          in the address bar.
        </li>
      </List>
      <P>
        When there’s a new version of Dayrule, a message offers <K>Reload</K>.
        Nothing changes until you choose it.
      </P>
      <H2>Bookmarklet</H2>
      <P>
        On a computer, Account → Your data → <K>Copy bookmarklet</K> puts a
        small script on the clipboard. Create a bookmark whose address is that
        script (or drag it to the bookmarks bar). On any webpage, open the
        bookmark: Dayrule’s Inbox opens with that page’s title, any text you
        selected, and its address — the same fields Android Share uses.
      </P>
      <H2>Locking</H2>
      <P>
        Dayrule locks itself after 15 minutes without use, and when you close
        it, unless you chose <strong>Stay unlocked on this device</strong>. Only
        do that on a device that’s yours alone.
      </P>
    </>
  )
}

function Privacy() {
  return (
    <>
      <P>
        Your to-dos are encrypted on your device before they’re sent. Your
        password makes the key that opens them. We never have your password or
        your key, so we can’t read your to-dos — and we can’t open them for you
        either.
      </P>
      <Diagram
        width={640}
        height={240}
        description="Your password opens your account key. Your 24-word recovery phrase also opens your account key. The account key opens your to-dos. If you lose both the password and the recovery phrase, nobody can open them."
        caption="Two ways in: your password, or your recovery phrase. Keep at least one."
      >
        <Box
          x={110}
          y={60}
          w={170}
          h={50}
          label="Password"
          sub="you type it"
          tone="plain"
        />
        <Box
          x={110}
          y={180}
          w={170}
          h={50}
          label="Recovery phrase"
          sub="24 words, kept safe"
          tone="plain"
        />
        <Box
          x={340}
          y={120}
          w={150}
          h={56}
          label="Account key"
          sub="never leaves your devices"
          tone="accent"
        />
        <Box
          x={550}
          y={120}
          w={150}
          h={56}
          label="Your to-dos"
          sub="unlocked"
          tone="ready"
        />
        <Arrow x1={196} y1={70} x2={264} y2={108} label="opens" />
        <Arrow x1={196} y1={170} x2={264} y2={132} label="opens" labelDy={16} />
        <Arrow x1={416} y1={120} x2={474} y2={120} label="opens" />
      </Diagram>
      <H2>Your recovery phrase</H2>
      <P>
        When you create your account, Dayrule shows 24 words. They’re the only
        way back in if you forget your password. Write them down and keep them
        somewhere safe, away from your devices.
      </P>
      <Tip>
        If you lose your password <strong>and</strong> your recovery phrase,
        your to-dos can’t be recovered — by you, by us, or by anyone.
      </Tip>
      <H2>Forgot your password?</H2>
      <P>
        On the sign-in screen, choose <K>Forgot password?</K>, enter your 24
        words, and set a new password.
      </P>
      <H2>Change your password</H2>
      <P>
        Account → Password. You need your current password. Your other devices
        are signed out and will ask for the new one.
      </P>
      <H2>Unlock with a passkey</H2>
      <P>
        Account → Devices → <K>Unlock with a passkey</K> lets you open Dayrule
        on that device with Face ID, Touch ID or Windows Hello instead of typing
        your password. Your password still works.
      </P>
      <H2>When you leave the tab</H2>
      <P>
        Switching to another tab or the app switcher hides your lists behind the
        Dayrule name until you come back. Sign-in stays a password screen.
      </P>
      <H2>What we can see</H2>
      <P>
        Your email address, how much you store, when your devices sync, and —
        only if you turn reminders on — when a reminder is due. Never what
        you’ve written. The{' '}
        <a className="text-accent underline" href="/privacy">
          privacy notice
        </a>{' '}
        has the details.
      </P>
    </>
  )
}

function Shortcuts() {
  const groups = new Map<Binding['group'], Binding[]>()
  for (const b of BINDINGS) {
    const list = groups.get(b.group) ?? []
    if (!list.some((x) => x.description === b.description)) list.push(b)
    groups.set(b.group, list)
  }
  return (
    <>
      <H2>On a phone</H2>
      <Diagram
        width={640}
        height={200}
        description="On a phone: swipe a to-do to the right to choose When. Swipe it to the left to start selecting several to-dos. Swipe in from the left edge of the screen to go back to your lists."
        caption="Swipes on a phone."
      >
        <rect
          x={40}
          y={30}
          width={560}
          height={46}
          rx={8}
          strokeWidth={1.5}
          className="fill-bg stroke-hairline"
        />
        <Label x={90} y={58} anchor="start" size={14} strong>
          ○ Call the plumber
        </Label>
        <Arrow x1={300} y1={53} x2={420} y2={53} />
        <Label x={500} y={58} size={13} strong>
          Swipe right: When
        </Label>
        <rect
          x={40}
          y={100}
          width={560}
          height={46}
          rx={8}
          strokeWidth={1.5}
          className="fill-bg stroke-hairline"
        />
        <Label x={90} y={128} anchor="start" size={14} strong>
          ○ Buy stamps
        </Label>
        <Arrow x1={420} y1={123} x2={300} y2={123} />
        <Label x={500} y={128} size={13} strong>
          Swipe left: Select
        </Label>
        <line
          x1={20}
          y1={20}
          x2={20}
          y2={180}
          strokeWidth={3}
          className="stroke-accent"
        />
        <Arrow x1={24} y1={175} x2={120} y2={175} />
        <Label x={130} y={179} anchor="start">
          from the left edge: back to your lists
        </Label>
      </Diagram>
      <List>
        <li>Tap a to-do to open it. Tap Done to close it.</li>
        <li>
          Swipe right to choose When; swipe left to select. While selecting, tap
          more to-dos, then use the bar at the bottom.
        </li>
        <li>Press and hold a to-do, then drag, to move it up or down.</li>
      </List>
      <H2>On a computer</H2>
      <P>
        Click a to-do to select it, double-click to open it. Hold <K>Shift</K>{' '}
        or <K>⌘</K>/<K>Ctrl</K> to select several. Right-click for more. After
        Complete or Move to Trash, an Undo bar appears for a few seconds. Press{' '}
        <K>?</K> in Dayrule to see these any time.
      </P>
      {[...groups].map(([group, list]) => (
        <section key={group}>
          <h3 className="mt-5 mb-1 font-semibold">{group}</h3>
          <dl className="text-sm">
            {list.map((b) => (
              <div
                key={b.keys}
                className="flex justify-between gap-4 border-b border-hairline py-1.5"
              >
                <dt>{b.description}</dt>
                <dd>
                  <K>{displayKeys(b.keys)}</K>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  )
}

function Data() {
  return (
    <>
      <Diagram
        width={640}
        height={110}
        description="A completed to-do goes to Done. From Done you can move it to Trash. Emptying the Trash deletes it for good. You can restore things from Trash until then."
        caption="From Done to gone."
      >
        <Box x={90} y={55} w={120} label="Done" tone="done" />
        <Box
          x={300}
          y={55}
          w={130}
          label="Trash"
          sub="can be restored"
          tone="muted"
        />
        <Box
          x={520}
          y={55}
          w={150}
          label="Deleted for good"
          tone="plain"
          dashed
        />
        <Arrow x1={150} y1={55} x2={233} y2={55} label="Move to Trash" />
        <Arrow x1={367} y1={55} x2={443} y2={55} label="Empty Trash" />
      </Diagram>
      <H2>Done</H2>
      <P>
        Completed to-dos move to Done. Choose when in Settings →{' '}
        <strong>Move completed items to Done</strong>: immediately, at the end
        of the day, or when you press <K>Move to Done now</K> in Done.
      </P>
      <H2>Deleting</H2>
      <List>
        <li>
          Open a to-do and press the bin, or select it and press{' '}
          <K>Backspace</K>, or right-click → Move to Trash. On a phone, swipe
          left to select, then tap the bin.
        </li>
        <li>This works anywhere, including in Done.</li>
        <li>
          Anything in Trash can be restored. In Trash, <K>Empty Trash</K>{' '}
          deletes them for good. Complete, Trash and Empty Trash also show an
          Undo bar for a few seconds.
        </li>
      </List>
      <H2>Export and import</H2>
      <P>
        Account → Your data. <strong>Export JSON</strong> saves everything in a
        file you can import again; <strong>Export Markdown</strong> saves a
        readable outline. Both are built in your browser — not on Dayrule’s
        servers — and the files aren’t encrypted, so keep them safe.
        <strong> Import JSON</strong> adds a copy of a Dayrule export and never
        replaces what’s there.
      </P>
      <H2>Import from Things 3</H2>
      <P>
        On a Mac that has Things 3, run the read-only exporter from the Dayrule
        repo:
      </P>
      <List>
        <li>
          <K>cd tools/things-export && go run . -o things.json</K> (or pass{' '}
          <K>-db</K> to the Things <K>main.sqlite</K> path).
        </li>
        <li>
          In Dayrule, Account → Your data → Import JSON… and choose that file.
        </li>
      </List>
      <P>
        Mapping happens in the browser; the server never sees the plaintext.
        Areas, projects, headings, to-dos, checklists, tags, When/Deadline and
        the Logbook (as Done) come across. Things day / week / month / year
        repeats (including weekly days and after-completion) map into Dayrule;
        unusual schedules may still need a quick edit.
      </P>
      <H2>Delete your account</H2>
      <P>
        Account → Delete account. It deletes everything we hold, straight away,
        and can’t be undone. Export first if you want a copy.
      </P>
    </>
  )
}
