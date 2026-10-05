# pi-claude-auth

Shapes Anthropic requests from the [pi coding agent](https://pi.dev) in the
Claude Code format. Auth is pi's own: this extension does not read, write, or
refresh credentials. It does not guarantee which plan a request bills against.

Changes:

- Overrides the `anthropic` provider `user-agent` to the full Claude Code form
- Injects the Claude Code billing header into Anthropic payloads (formatting only, and only
  when pi's Claude Code identity block is present, i.e. OAuth)

## Install

```bash
pi install git:github.com/nredd/pi-claude-auth@v0.1.3-nredd.1
```

## Auth

Use pi's native flow:

- `/login` -> Anthropic to sign in
- `/logout` to sign out
- Token refresh is handled by pi

Pi's `~/.pi/agent/auth.json` is the sole persisted credential store, with
`PI_CODING_AGENT_DIR` honored by Pi. Native API-key/environment precedence is unchanged.
Claude Code credentials (Keychain, `~/.claude/.credentials.json`) are not read,
written, imported, or deleted. Existing Pi credentials remain in place. Use `/login`
for missing or invalid credentials and to switch accounts. A fresh Pi `/login` is
recommended when tokens were previously shared with Claude Code: independently
refreshing the same tokens can invalidate the other store.

Directly selected non-Anthropic providers are untouched. Pi's request hook does not
expose the resolved provider of virtual models, so routed requests use the existing
Claude model / OAuth identity payload guard. This preserves `router/default` without
changing Pi core; it cannot distinguish arbitrary virtual providers that reproduce
that same payload identity. API-key payloads without the identity are untouched.

## Development

```bash
npx --yes pnpm@10.32.1 install --frozen-lockfile
npm run lint && npm run build && npm test
```

Notes:

- The old Keychain lookup used `/usr/bin/security` by absolute path; that code is
  gone, so nothing shells out for credentials any more

## License

MIT
