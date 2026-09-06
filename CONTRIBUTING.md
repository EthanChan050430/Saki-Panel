# Contributing

## Setup

Node.js ≥ 18 and npm ≥ 9.

```bash
git clone https://github.com/EthanChan050430/Saki-Panel.git
cd Saki-Panel
npm install
npx prisma db push --skip-generate
npm run dev
```

Web is http://localhost:5478. Default login is `admin` / `admin123456`.

## Before a pull request

```bash
npm run check
```

That typechecks every workspace. Do not commit `.env`, `data/`, `dist/`, or logs.

## Patches

- Keep the change scoped. Match the surrounding TypeScript and CSS.
- Agent, Watch, and daemon security paths need tests or a short note on what you verified.
- New instance types or permissions belong in `packages/shared` first.

## Bugs and ideas

Use the Bug or Feature issue forms. Security reports go to [SECURITY.md](SECURITY.md), not Issues.
