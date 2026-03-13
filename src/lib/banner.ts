/**
 * Shared ASCII art logo and banner display for sswskills CLI.
 */

import pc from 'picocolors';
import { isTTY } from '../utils.js';

export const LOGO_LINES = [
  '   ███████╗███████╗██╗    ██╗   ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '   ██╔════╝██╔════╝██║    ██║   ██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '   ███████╗███████╗██║ █╗ ██║   ███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '   ╚════██║╚════██║██║███╗██║   ╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '   ███████║███████║╚███╔███╔╝█╗ ███████║██║  ██╗██║███████╗███████╗███████║',
  '   ╚══════╝╚══════╝ ╚══╝╚══╝ ╚╝ ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
] as const;

// Red gradient colors (top to bottom): bright red → deep red
// All colors kept bright enough to be readable on dark backgrounds
// Length must match LOGO_LINES (one color per line).
const GRADIENT_COLORS: readonly [number, number, number][] = [
  [255, 80, 80],
  [240, 55, 55],
  [220, 35, 35],
  [200, 20, 20],
  [185, 10, 10],
  [170, 0, 0],
] as const;

/** Check if colors are disabled via NO_COLOR convention (https://no-color.org). */
function isColorDisabled(): boolean {
  return 'NO_COLOR' in process.env;
}

/**
 * Check if the terminal supports truecolor (24-bit) via COLORTERM env var.
 */
function supportsTruecolor(): boolean {
  if (isColorDisabled()) return false;
  const ct = process.env.COLORTERM;
  return ct === 'truecolor' || ct === '24bit';
}

/** Apply truecolor gradient, fall back to picocolors cyan. */
function colorLine(line: string, index: number): string {
  if (supportsTruecolor()) {
    const color = GRADIENT_COLORS[index % GRADIENT_COLORS.length];
    const [r, g, b] = color;
    return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
  }
  return pc.red(line);
}

/**
 * Get the colored banner as a string.
 * Returns the colored logo + tagline, or plain text when colors are disabled.
 */
export function getBannerText(): string {
  const lines: string[] = [''];

  for (let i = 0; i < LOGO_LINES.length; i++) {
    lines.push(colorLine(LOGO_LINES[i], i));
  }

  lines.push(
    `   ${pc.dim('The SSW Skill Manager for AI Coding Agents')} — ${pc.bold(pc.cyan('https://github.com/SSWSydney/sswskills'))}`,
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Print the colored ASCII art banner with tagline.
 * Only outputs when stdout is a TTY.
 */
export function printBanner(): void {
  if (!isTTY()) return;
  console.log(getBannerText());
}
