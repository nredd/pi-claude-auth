# Install pi-claude-auth

Steps:

- Remove the retired source with `pi remove npm:pi-claude-auth` if installed
- Run `pi install git:github.com/nredd/pi-claude-auth@v0.1.3-nredd.1`
- Restart pi
- Run `/login` and pick Anthropic (no Claude Code credentials needed or read)
- Verify with `pi config` that the extension is listed
