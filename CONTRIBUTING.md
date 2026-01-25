# Contributing to skillfish

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/skillfish.git
cd skillfish
npm install
npm run build
```

## Running Locally

```bash
# Link for local testing
npm link

# Run the CLI
skillfish add owner/repo
```

## Testing

```bash
npm test           # Run tests once
npm run test:watch # Watch mode
```

## Code Style

- TypeScript with strict mode
- ESM modules
- Keep functions focused and testable

Code quality is enforced via ESLint and Prettier. Pre-commit hooks will run automatically:

```bash
npm run lint        # Check for lint errors
npm run lint:fix    # Auto-fix lint errors
npm run format      # Format code with Prettier
npm run typecheck   # Check TypeScript types
```

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run build: `npm run build`
6. Submit a PR

## Adding Agent Support

To add support for a new AI agent, add an entry to `AGENT_CONFIGS` in `src/lib/agents.ts`:

```typescript
{
  name: 'Agent Name',
  dir: '.agent/skills',
  homePaths: ['.agent/config.json'],  // Files in ~/
  cwdPaths: ['.agent'],               // Files in ./
}
```

## Reporting Issues

Include:
- Node.js version
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO).

By making a contribution, you certify that you have the right to submit it under the project's license.

Sign your commits with `-s`:

```bash
git commit -s -m "feat: add new agent support"
```

This adds a `Signed-off-by` line to your commit message.

## First-Time Contributors

Welcome! We're excited to have you.

1. **Find an issue**: Look for issues labeled [`good first issue`](https://github.com/knoxgraeme/skillfish/labels/good%20first%20issue)
2. **Claim it**: Comment "I'd like to work on this"
3. **Ask questions**: We're here to help - no question is too small
4. **Submit your PR**: We'll review it promptly

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
