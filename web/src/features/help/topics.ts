/** The help topics, in reading order. */
export const TOPICS = [
  {
    slug: 'start',
    title: 'Getting started',
    summary: 'Add to-dos, sort them, get them done.',
  },
  {
    slug: 'lists',
    title: 'The lists',
    summary: 'Inbox, Today, Scheduled, Backlog, Done and Trash.',
  },
  {
    slug: 'scheduling',
    title: 'Dates, deadlines and repeats',
    summary: 'When to start something, when it’s due, and doing it again.',
  },
  {
    slug: 'projects',
    title: 'Projects and areas',
    summary: 'Group to-dos into bigger pieces of work.',
  },
  {
    slug: 'devices',
    title: 'Phones, computers and sync',
    summary: 'Use Dayrule everywhere, even offline.',
  },
  {
    slug: 'privacy',
    title: 'Your password and privacy',
    summary: 'How encryption works, and what to keep safe.',
  },
  {
    slug: 'shortcuts',
    title: 'Shortcuts and gestures',
    summary: 'The keyboard on a computer, swipes on a phone.',
  },
  {
    slug: 'data',
    title: 'Your data',
    summary: 'Export, import, Done, Trash and deleting your account.',
  },
] as const

export type TopicSlug = (typeof TOPICS)[number]['slug']
