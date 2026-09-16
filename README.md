# DeepSeek Harness

English | [中文](README.zh.md)

> This public repository is an unofficial desktop-launcher fork of
> [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
> The upstream project is still the source for the harness itself.

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Difference from the original project

This fork keeps the original DeepSeek Harness source intact and adds a local
Electron launcher so the Web UI can be opened as a desktop app instead of
copying a browser URL manually.

Added pieces:

- `apps/desktop`: a small Electron wrapper that starts `dsh web --port 0`,
  waits for the local URL printed by the harness, and loads it in a native
  desktop window.
- `pnpm dsh:desktop`: root-level shortcut for launching the Electron app.
- `apps/desktop/run-desktop.sh`: Linux desktop-entry helper used by local
  `.desktop` launchers.

The Electron launcher still uses the upstream Web UI and backend. It does not
replace the DeepSeek Harness runtime or evaluation logic.

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

To open this fork as a desktop app:

```sh
pnpm dsh:desktop
```

The Linux `.desktop` launcher uses [`apps/desktop/run-desktop.sh`](apps/desktop/run-desktop.sh), which automatically runs `pnpm run build:web` when `apps/web/dist/index.html` is missing and reuses an existing Web build; direct `pnpm dsh:desktop` does not perform this preflight.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
