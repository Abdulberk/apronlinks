import { DashboardController } from './dashboard.controller';

/**
 * The dashboard is a string, so nothing type-checks it and nothing lints it.
 * That is a real gap: the page once shipped with `String.raw`, which leaves the
 * escaping backslashes attached to the browser's own template literals and made
 * the emitted script a syntax error. The endpoint still answered 200 with a
 * plausible byte count, so every check short of opening it in a browser passed
 * while the page did nothing at all.
 *
 * These tests are the cheap version of opening it.
 */
describe('DashboardController', () => {
  const html = new DashboardController().index();

  it('serves a complete document', () => {
    expect(html).toContain('<!doctype html>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('emits a script the browser can actually parse', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toBeDefined();

    // Parsed, not executed. A syntax error throws here, which is exactly the
    // failure that shipped unnoticed.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const parse = (): unknown => new Function(script!);
    expect(parse).not.toThrow();
  });

  it('leaves no escaping backslash attached to a template literal', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

    // The specific footprint of the bug: a backslash immediately before a
    // backtick or an interpolation opener.
    expect(script).not.toMatch(/\\`/);
    expect(script).not.toMatch(/\\\$\{/);
  });

  it('reaches the endpoints it needs', () => {
    // A page that parses but calls nothing would still render empty.
    for (const path of ['/alerts', '/flights', '/alerts/stream']) {
      expect(html).toContain(path);
    }
  });

  it('escapes interpolated values before putting them in the page', () => {
    // Flight numbers and registrations come from a provider, so they are not
    // ours to trust.
    expect(html).toContain('const esc =');
    expect(html).toMatch(/esc\(/);
  });
});
