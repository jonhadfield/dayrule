import { H1, H2, List, P } from './LegalPage'

export function Terms() {
  return (
    <article>
      <H1>Terms</H1>
      <p className="mb-6 text-sm text-text-secondary">
        Last updated 18 November 2026
      </p>

      <P>
        These are the terms for using Dayrule, a to-do app operated from the
        United Kingdom (contact:{' '}
        <a className="text-accent underline" href="mailto:privacy@dayrule.app">
          privacy@dayrule.app
        </a>
        ). By creating an account you agree to them.
      </P>

      <H2>The service</H2>
      <P>
        Dayrule is free. It’s provided as it is, without guarantees that it will
        always be available or free of faults, though we’ll do our best to keep
        it running and your data safe. We may change or stop the service; if we
        plan to stop it, we’ll give you notice and time to export your data.
      </P>

      <H2>Your password and recovery phrase</H2>
      <P>
        Your to-dos are encrypted with a key made from your password, and we
        don’t have it. If you forget your password, only your 24-word recovery
        phrase can get you back in.{' '}
        <strong>
          If you lose both, nobody — including us — can recover your data.
        </strong>{' '}
        Keep the recovery phrase somewhere safe, and keep your devices secure.
      </P>

      <H2>Using Dayrule fairly</H2>
      <List>
        <li>
          Use it for lawful purposes, and only with an account that’s yours.
        </li>
        <li>
          Don’t try to break, overload or get around its security or limits, or
          access other people’s accounts.
        </li>
        <li>
          Accounts have storage limits (currently 50 MB and 100,000 items).
        </li>
      </List>
      <P>
        We can suspend or close an account that’s being used to abuse the
        service, and will tell you why where we can.
      </P>

      <H2>Your data</H2>
      <P>
        What you write is yours. You can export it or delete your account at any
        time in the app. The privacy notice explains what we can and can’t see.
      </P>

      <H2>Liability</H2>
      <P>
        As far as the law allows, we’re not liable for indirect losses, or for
        losses caused by data you can’t decrypt because the password and
        recovery phrase were lost. Nothing in these terms limits liability that
        can’t be limited by law, or your statutory rights as a consumer.
      </P>

      <H2>Changes and law</H2>
      <P>
        If these terms change in a way that matters, we’ll tell you in the app
        before it takes effect. These terms are governed by the law of England
        and Wales.
      </P>
    </article>
  )
}
