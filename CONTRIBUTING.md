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

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run build: `npm run build`
6. Submit a PR

## Adding Agent Support

To add support for a new AI agent, add an entry to `AGENT_CONFIGS` in `src/index.ts`:

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

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
