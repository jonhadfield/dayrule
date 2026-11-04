import { H1, H2, List, P } from './LegalPage'

export function Privacy() {
  return (
    <article>
      <H1>Privacy</H1>
      <p className="mb-6 text-sm text-text-secondary">
        Last updated 17 October 2026
      </p>

      <P>
        Dayrule is built so that we can’t read your to-dos. They’re encrypted on
        your devices with a key made from your password before anything is sent,
        and only your devices can decrypt them. This notice explains the little
        we can see, why, and who else is involved.
      </P>

      <H2>Who we are</H2>
      <P>
        Dayrule is a to-do app operated from the United Kingdom. For privacy
        questions, contact{' '}
        <a className="text-accent underline" href="mailto:privacy@dayrule.app">
          privacy@dayrule.app
        </a>
        .
      </P>

      <H2>What we can’t see</H2>
      <P>
        Everything you write in Dayrule — titles, notes, checklists, tags,
        projects, areas, dates, repeats and settings — is end-to-end encrypted.
        We store it, but only as ciphertext, and we don’t have the key. We also
        never receive your password or your recovery phrase.
      </P>

      <H2>What we can see, and why</H2>
      <List>
        <li>
          <strong>Your email address</strong> — to sign you in and send you
          sign-up and email-change codes, and reminder emails if you turn those
          on.
        </li>
        <li>
          <strong>Account records</strong> — a hash that lets us check your
          password without knowing it, your encryption key in a form only your
          password or recovery phrase can unlock, and your settings for
          reminders.
        </li>
        <li>
          <strong>Signed-in devices</strong> — a label such as “Safari on iOS”,
          when each was last used, and its IP address in our hosting provider’s
          logs, so you can see and sign out your devices and so we can keep the
          service secure.
        </li>
        <li>
          <strong>How much you store and when you sync</strong> — the number and
          size of your encrypted records (to apply storage limits) and when your
          devices sync.
        </li>
        <li>
          <strong>Reminder times</strong>, only if you turn reminders on — when
          each reminder is due, never what it’s for. If you choose
          notifications, the address your browser gives us for sending them.
        </li>
      </List>
      <P>
        We use this to provide the service you’ve asked for (the contract
        between us) and, for security records like IP addresses and rate limits,
        our legitimate interest in keeping Dayrule safe from abuse. We don’t
        sell data, show ads, or use analytics or tracking.
      </P>

      <H2>Who else is involved</H2>
      <List>
        <li>
          <strong>Vercel</strong> hosts the app and the API. The API runs in
          London. Vercel, Inc. is a US company and its request logs (including
          IP addresses) are kept for a limited time under its data processing
          agreement.
        </li>
        <li>
          <strong>Neon</strong> runs the database, on AWS in London.
        </li>
        <li>
          <strong>Resend</strong> sends our emails, from its EU region. It sees
          your email address and the emails’ contents, which never include your
          to-dos.
        </li>
        <li>
          <strong>Your browser’s push service</strong> (for example Apple,
          Google or Mozilla), only if you turn on notifications. It delivers a
          message containing a random id and a time.
        </li>
      </List>

      <H2>How long we keep it</H2>
      <List>
        <li>Your account and encrypted data: until you delete your account.</li>
        <li>
          Deleting your account (Account → Delete account) removes everything we
          hold about you straight away, including your email address. Our
          database provider keeps a rolling six hours of history for recovery,
          after which it is gone from there too.
        </li>
        <li>Signed-in sessions: 30 days from last use.</li>
        <li>
          Email codes: deleted within a day. Reminder times: deleted two days
          after they’re due.
        </li>
        <li>
          Records of deleted items, kept so your devices stay in step: 90 days,
          encrypted.
        </li>
      </List>

      <H2>Cookies and storage on your device</H2>
      <P>
        One cookie, which keeps you signed in. It is strictly necessary, so
        there’s no cookie banner. Your devices also keep your encrypted data in
        the browser’s storage so Dayrule works offline. There are no analytics,
        advertising or third-party cookies.
      </P>

      <H2>Your rights</H2>
      <P>
        You can see, export and delete your data yourself in the app (Account →
        Your data, and Account → Delete account). Because we can’t decrypt your
        to-dos, the export in the app is the only way to get them in readable
        form. You can also ask us about anything we hold, ask us to correct or
        delete it, or object to how we use it, by writing to the address above.
        If you’re unhappy with our answer, you can complain to the UK
        Information Commissioner’s Office at{' '}
        <a className="text-accent underline" href="https://ico.org.uk">
          ico.org.uk
        </a>
        .
      </P>

      <H2>Children</H2>
      <P>Dayrule isn’t meant for children under 13.</P>

      <H2>Changes</H2>
      <P>
        If this notice changes in a way that matters, we’ll tell you in the app
        before it takes effect. The date at the top shows the last change.
      </P>
    </article>
  )
}
