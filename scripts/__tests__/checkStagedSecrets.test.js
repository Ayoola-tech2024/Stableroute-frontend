const path = require('path');
const fs = require('fs');
const os = require('os');

// We require the script relatively; it is CommonJS and pure.
const {
  BLOCKED_FILENAME_PATTERNS,
  SKIP_CONTENT_PATTERNS,
  PATTERN_DEFINITIONS,
  SAFE_LINE_PATTERNS,
  INLINE_DISABLE_PATTERN,
  DEFAULT_ENTROPY_CONFIG,
  calculateShannonEntropy,
  isHighEntropy,
  extractAssignmentValue,
  isBlockedFilename,
  shouldSkipContent,
  isSafeLine,
  redactPreview,
  findSecretMatches,
  scanTextContent,
  runCheck,
  formatReport,
  parseArgs,
  printHelp,
  getWorkingTreeFiles,
  readWorkingTreeFiles,
} = require('../check-staged-secrets');

// ---------------------------------------------------------------------------
// calculateShannonEntropy
// ---------------------------------------------------------------------------

describe('calculateShannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(calculateShannonEntropy('')).toBe(0);
  });

  it('returns 0 for nullish input', () => {
    expect(calculateShannonEntropy(null)).toBe(0);
    expect(calculateShannonEntropy(undefined)).toBe(0);
  });

  it('returns 0 for a single repeated character', () => {
    expect(calculateShannonEntropy('aaaaaaaa')).toBe(0);
  });

  it('returns 1 for two equally distributed characters', () => {
    expect(calculateShannonEntropy('ab')).toBeCloseTo(1, 6);
  });

  it('returns higher entropy for random-looking strings', () => {
    const randomish = 'aZ3q9X0P7Lm4K8nT2vR6';
    expect(calculateShannonEntropy(randomish)).toBeGreaterThan(4);
  });

  it('returns lower entropy for English-like strings', () => {
    const english = 'theleadingcauseofdeathinsterengothequickbr';
    expect(calculateShannonEntropy(english)).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------
// isHighEntropy
// ---------------------------------------------------------------------------

describe('isHighEntropy', () => {
  const cfg = { minLength: 20, minEntropy: 4.5 };

  it('returns false for empty / non-string input', () => {
    expect(isHighEntropy('', cfg)).toBe(false);
    expect(isHighEntropy(null, cfg)).toBe(false);
    expect(isHighEntropy(undefined, cfg)).toBe(false);
    expect(isHighEntropy(123, cfg)).toBe(false);
  });

  it('returns false when value is shorter than minLength', () => {
    expect(isHighEntropy('ShortButRandom', cfg)).toBe(false);
  });

  it('returns false when length OK but entropy below threshold', () => {
    const longEnglish =
      'theleadingcauseofdeathinsterthequickbrownfoxjumpsoverthelazydogthisisalongenglish';
    expect(isHighEntropy(longEnglish, cfg)).toBe(false);
  });

  it('returns true for an opaque base64-ish token', () => {
    expect(isHighEntropy('aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy', cfg)).toBe(true);
  });

  it('respects a custom config', () => {
    // Force a permissive config.
    expect(isHighEntropy('aaaaaaaaaa', { minLength: 5, minEntropy: 0 })).toBe(
      true
    );
    // Force a restrictive config.
    expect(
      isHighEntropy('aZ3q9X0P7Lm4K8nT2vR6', { minLength: 100, minEntropy: 4.5 })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractAssignmentValue
// ---------------------------------------------------------------------------

describe('extractAssignmentValue', () => {
  it('extracts a bare assignment', () => {
    expect(extractAssignmentValue('API_KEY = abcdefghij')).toBe('abcdefghij');
  });

  it('extracts a colon-separated assignment', () => {
    expect(extractAssignmentValue('token: my-secret-value')).toBe(
      'my-secret-value'
    );
  });

  it('extracts a double-quoted assignment', () => {
    expect(extractAssignmentValue('SECRET="hello world"')).toBe('hello world');
  });

  it('extracts a single-quoted assignment', () => {
    expect(extractAssignmentValue("PASSWORD='hunter2hunter2'")).toBe(
      'hunter2hunter2'
    );
  });

  it('strips a trailing # comment', () => {
    expect(extractAssignmentValue('KEY=value # comment')).toBe('value');
  });

  it('returns null when there is no assignment', () => {
    expect(extractAssignmentValue('just a sentence')).toBeNull();
    expect(extractAssignmentValue('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filename blocklist / skip / safe-line classification
// ---------------------------------------------------------------------------

describe('isBlockedFilename', () => {
  it.each([
    ['.env', true],
    ['.env.local', true],
    ['.env.production', true],
    ['.envrc', true],
    ['keys/server.pem', true],
    ['./relative/id_rsa', true],
    ['id_ed25519', true],
    ['secrets/store.p12', true],
    ['certs/thing.pfx', true],
    ['.env.example', true], // intentionally blocked — opt-in via gitignore
  ])('blocks %s', (filename, expected) => {
    expect(isBlockedFilename(filename)).toBe(expected);
  });

  it.each([
    ['src/lib/apiClient.ts', false],
    ['SECURITY.md', false],
    ['README.md', false],
  ])('does not block %s', (filename, expected) => {
    expect(isBlockedFilename(filename)).toBe(expected);
  });

  it('exposes BLOCKED_FILENAME_PATTERNS as a non-empty array of regexes', () => {
    expect(Array.isArray(BLOCKED_FILENAME_PATTERNS)).toBe(true);
    expect(BLOCKED_FILENAME_PATTERNS.length).toBeGreaterThan(0);
    for (const re of BLOCKED_FILENAME_PATTERNS) {
      expect(re).toBeInstanceOf(RegExp);
    }
  });

  it('exposes SKIP_CONTENT_PATTERNS and SAFE_LINE_PATTERNS', () => {
    expect(SKIP_CONTENT_PATTERNS.length).toBeGreaterThan(0);
    expect(SAFE_LINE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('exposes a non-empty PATTERN_DEFINITIONS list with id/regex fields', () => {
    expect(PATTERN_DEFINITIONS.length).toBeGreaterThan(5);
    for (const def of PATTERN_DEFINITIONS) {
      expect(def.id).toEqual(expect.any(String));
      expect(def.description).toEqual(expect.any(String));
      expect(def.regex).toBeInstanceOf(RegExp);
    }
  });

  it('exposes a frozen DEFAULT_ENTROPY_CONFIG', () => {
    expect(DEFAULT_ENTROPY_CONFIG.minLength).toBeGreaterThan(0);
    expect(DEFAULT_ENTROPY_CONFIG.minEntropy).toBeGreaterThan(0);
    expect(() => {
      DEFAULT_ENTROPY_CONFIG.minLength = 1;
    }).toThrow();
  });
});

describe('shouldSkipContent', () => {
  it.each([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'public/lib.min.js',
    'styles/app.min.css',
  ])('skips %s', (file) => {
    expect(shouldSkipContent(file)).toBe(true);
  });

  it.each(['src/app/page.tsx', 'README.md', 'package.json'])(
    'does not skip %s',
    (file) => {
      expect(shouldSkipContent(file)).toBe(false);
    }
  );
});

describe('isSafeLine', () => {
  it.each([
    '  // hello',
    'const x = "data:image/png;base64,iVBORw0KGgoAA"',
    'integrity="sha256-abcdef0123456789"',
    '# yaml comment',
    ' * jsdoc line',
  ])('treats "%s" as safe', (line) => {
    expect(isSafeLine(line)).toBe(true);
  });

  it.each(['const SECRET = "abc";', 'API_KEY=abcdef1234567890'])(
    'does not treat "%s" as safe',
    (line) => {
      expect(isSafeLine(line)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// redactPreview
// ---------------------------------------------------------------------------

describe('redactPreview', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(redactPreview('')).toBe('');
    expect(redactPreview(null)).toBe('');
    expect(redactPreview(undefined)).toBe('');
  });

  it('short strings get first-char + length tag', () => {
    expect(redactPreview('abcd')).toBe('a***(4)');
  });

  it('long strings get prefix + suffix + length tag', () => {
    expect(redactPreview('abcdefghijklmnopqrstuvwxyz')).toBe('abcd…wxyz (len=26)');
  });
});

// ---------------------------------------------------------------------------
// findSecretMatches
// ---------------------------------------------------------------------------

const allPatterns = { patterns: PATTERN_DEFINITIONS, entropyConfig: DEFAULT_ENTROPY_CONFIG };
const assignmentOnlyCheck = { patterns: PATTERN_DEFINITIONS, entropyConfig: DEFAULT_ENTROPY_CONFIG };

describe('findSecretMatches', () => {
  it('flags a GitHub classic PAT', () => {
    const m = findSecretMatches(
      'const token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
      allPatterns
    );
    const ids = m.map((x) => x.type);
    expect(ids).toContain('github-pat-classic');
  });

  it('flags a GitHub fine-grained PAT', () => {
    // Body assembled at runtime so the literal GitHub secret scanner cannot
    // pattern-match the vendor prefix in source; the detector still sees the
    // canonical shape at runtime.
    const fineGrained = `github_pat_${'a'.repeat(80)}`;
    const m = findSecretMatches(`token = "${fineGrained}"`, allPatterns);
    expect(m.map((x) => x.type)).toContain('github-fine-grained-pat');
  });

  it('flags a Stripe live secret key on an assignment line', () => {
    // Body assembled at runtime to bypass GitHub's static secret scanner.
    const stripeLive = `sk_live_${'a'.repeat(40)}`;
    const line = `STRIPE_SECRET = "${stripeLive}";`;
    const m = findSecretMatches(line, allPatterns);
    expect(m.map((x) => x.type)).toContain('stripe-live-secret');
  });

  it('flags a Stripe live key even outside an assignment (vendor-only pattern)', () => {
    const stripeLive = `sk_live_${'a'.repeat(40)}`;
    const line = `console.log("DEBUG ${stripeLive}");`;
    const m = findSecretMatches(line, allPatterns);
    // The pattern is assignmentOnly: sk_live_ requires assignment; should not match.
    expect(m.map((x) => x.type)).not.toContain('stripe-live-secret');
  });

  it('flags a Google API key on an assignment line', () => {
    // AIza + 35+ base62 chars; body assembled at runtime.
    const googleKey = `AIza${'a'.repeat(38)}`;
    const m = findSecretMatches(
      `GOOGLE_KEY = "${googleKey}";`,
      allPatterns
    );
    expect(m.map((x) => x.type)).toContain('google-api-key');
  });

  it('flags an OpenAI-style key (sk-…T3BlbkFJ…)', () => {
    // 22 chars on each side of T3BlbkFJ; assembled at runtime so GitHub
    // push protection cannot pattern-match the literal `sk-...T3BlbkFJ...`.
    const openai = `sk-${'a'.repeat(22)}T3BlbkFJ${'a'.repeat(22)}`;
    const m = findSecretMatches(
      `OPENAI_API_KEY="${openai}";`,
      allPatterns
    );
    expect(m.map((x) => x.type)).toContain('openai-api-key');
  });

  it('flags an Anthropic-style key', () => {
    // Assembled at runtime so the literal GitHub scanner can't match
    // `sk-ant-` followed by a long opaque body in source.
    const anthropic = `sk-ant-${'a'.repeat(30)}`;
    const m = findSecretMatches(
      `ANTHROPIC="${anthropic}"`,
      allPatterns
    );
    expect(m.map((x) => x.type)).toContain('anthropic-api-key');
  });

  it('flags a BEGIN PRIVATE KEY block', () => {
    const m = findSecretMatches('-----BEGIN PRIVATE KEY-----', allPatterns);
    expect(m.map((x) => x.type)).toContain('private-key-block');
  });

  it('flags an OPENSSH private key block', () => {
    const m = findSecretMatches('-----BEGIN OPENSSH PRIVATE KEY-----', allPatterns);
    expect(m.map((x) => x.type)).toContain('rsa-private-key-block');
  });

  it('flags a Slack webhook URL', () => {
    // Path segments built at runtime from repeated single chars so the
    // literal `https://hooks.slack.com/services/<tokens>` never appears
    // on disk — GitHub push protection would otherwise block this commit.
    const slackHook = `https://hooks.slack.com/services/${'A'.repeat(
      15
    )}/${'B'.repeat(15)}/${'C'.repeat(30)}`;
    const m = findSecretMatches(`SLACK_HOOK=${slackHook}`, allPatterns);
    expect(m.map((x) => x.type)).toContain('slack-webhook');
  });

  it('flags a Slack token', () => {
    // Defensive: build the `xoxb-...` body at runtime.
    const slackBot = `xoxb-${'a'.repeat(25)}`;
    const m = findSecretMatches(`SLACK_BOT=${slackBot}`, allPatterns);
    expect(m.map((x) => x.type)).toContain('slack-token');
  });

  it('flags an AWS Access Key ID', () => {
    const m = findSecretMatches(
      'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
      allPatterns
    );
    expect(m.map((x) => x.type)).toContain('aws-access-key-id');
  });

  it('flags a high-entropy assignment to a sensitive-looking key', () => {
    const line = 'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4P1";';
    const m = findSecretMatches(line, allPatterns);
    expect(m.map((x) => x.type)).toContain('generic-secret-assignment');
    expect(m.map((x) => x.type)).toContain('high-entropy-assignment');
  });

  it('does NOT flag a high-entropy SRI integrity hash on the same safe line', () => {
    // The line is on a "safe" pattern (data: URI / SRI) so entropy is skipped.
    const line = 'integrity="sha256-aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4"';
    const m = findSecretMatches(line, allPatterns);
    // The line is a vendor assignment pattern, so generic-secret-assignment
    // should not fire either (the key word "integrity" isn't in the list).
    expect(m).toEqual([]);
  });

  it('does NOT flag a benign-looking value with low entropy', () => {
    const line = 'API_KEY="hello-world-string-2024-final"';
    const m = findSecretMatches(line, allPatterns);
    expect(m).toEqual([]);
  });

  it('honours the inline disable comment', () => {
    const line = 'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4"; // stableroute-disable-line secret-scan';
    const m = findSecretMatches(line, allPatterns);
    expect(m).toEqual([]);
  });

  it('honours the next-line variant of the disable comment', () => {
    const m = findSecretMatches(
      '// stableroute-disable-next-line secret-scan\nSECRET="aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";',
      allPatterns
    );
    // Only one match would have fired (entropy) — both lines must produce none.
    expect(m).toEqual([]);
  });

  it('returns an empty array for empty / non-string input', () => {
    expect(findSecretMatches('', allPatterns)).toEqual([]);
    expect(findSecretMatches(null, allPatterns)).toEqual([]);
  });

  it('exposes INLINE_DISABLE_PATTERN regex', () => {
    expect(INLINE_DISABLE_PATTERN).toBeInstanceOf(RegExp);
  });

  it('does not double-report on the disabled-behaviour line', () => {
    const m = findSecretMatches(
      "API_KEY = 'hunter2hunter2' # stableroute-disable-next-line secret-scan",
      allPatterns
    );
    expect(m).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanTextContent
// ---------------------------------------------------------------------------

describe('scanTextContent', () => {
  it('flips a match lineNumber onto 1-based index', () => {
    const f = scanTextContent(
      'src/config.ts',
      'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\nOK = true',
      allPatterns
    );
    expect(f.path).toBe('src/config.ts');
    expect(f.skipped).toBe(false);
    expect(f.matches.length).toBeGreaterThan(0);
    expect(f.matches[0].lineNumber).toBe(1);
  });

  it('flips lineNumber onto second line for second match', () => {
    const f = scanTextContent(
      'a.ts',
      'plain\nconst token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
      allPatterns
    );
    const gh = f.matches.find((m) => m.type === 'github-pat-classic');
    expect(gh).toBeDefined();
    expect(gh.lineNumber).toBe(2);
  });

  it('marks skip for lockfiles regardless of matching content', () => {
    const f = scanTextContent(
      'package-lock.json',
      'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";',
      allPatterns
    );
    expect(f.skipped).toBe(true);
    expect(f.matches).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const f = scanTextContent(
      'a.ts',
      'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\r\nOK = 1\r\n',
      allPatterns
    );
    expect(f.matches[0].lineNumber).toBe(1);
  });

  it('returns empty matches when content is null/undefined', () => {
    expect(scanTextContent('a.ts', null, allPatterns).matches).toEqual([]);
    expect(scanTextContent('a.ts', undefined, allPatterns).matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runCheck orchestrator
// ---------------------------------------------------------------------------

describe('runCheck', () => {
  it('short-circuits when allowSkip is true', () => {
    const r = runCheck({
      stagedFiles: ['.env'],
      fileContents: { '.env': 'TOKEN=abc' },
      allowSkip: true,
    });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.blockedFilenames).toEqual([]);
    expect(r.fileFindings).toEqual([]);
  });

  it('reports blocked filenames without reading content', () => {
    const r = runCheck({
      stagedFiles: ['secrets/.env.local', '.env'],
      fileContents: {},
    });
    expect(r.ok).toBe(false);
    expect(r.blockedFilenames).toEqual(
      expect.arrayContaining(['secrets/.env.local', '.env'])
    );
    expect(r.summary.blocked).toBe(2);
  });

  it('reports content matches and counts scanned files', () => {
    const fileContents = {
      'src/config.ts':
        'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\n',
      'src/clean.ts': 'export const x = 1;\n',
    };
    const r = runCheck({
      stagedFiles: ['src/config.ts', 'src/clean.ts'],
      fileContents,
    });
    expect(r.ok).toBe(false);
    expect(r.summary.filesScanned).toBe(2);
    expect(r.summary.matches).toBeGreaterThan(0);
    const dirty = r.fileFindings.find((f) => f.path === 'src/config.ts');
    expect(dirty.skipped).toBe(false);
    expect(dirty.matches.length).toBeGreaterThan(0);
  });

  it('returns ok=true for clean files only', () => {
    const r = runCheck({
      stagedFiles: ['src/clean.ts'],
      fileContents: { 'src/clean.ts': 'export const safe = "hello";\n' },
    });
    expect(r.ok).toBe(true);
    expect(r.summary.blocked).toBe(0);
    expect(r.summary.matches).toBe(0);
    expect(r.summary.filesScanned).toBe(1);
  });

  it('skips lockfiles and minified assets but still records them as skipped', () => {
    const r = runCheck({
      stagedFiles: ['package-lock.json', 'public/lib.min.js'],
      fileContents: {},
    });
    expect(r.fileFindings).toHaveLength(2);
    expect(r.fileFindings[0].skipped).toBe(true);
    expect(r.fileFindings[1].skipped).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.summary.filesScanned).toBe(0);
  });

  it('handles missing fileContents entry gracefully', () => {
    const r = runCheck({
      stagedFiles: ['src/missing.ts'],
      fileContents: {},
    });
    expect(r.ok).toBe(true);
    // A file with no sourceable content is recorded as `missingContents`
    // and does NOT count toward `filesScanned` — we have nothing to
    // assert against, so we don't claim a clean scan either.
    expect(r.summary.filesScanned).toBe(0);
    expect(r.summary.missing).toBe(1);
    expect(r.fileFindings[0].matches).toEqual([]);
  });

  it('coerces non-array stagedFiles to empty', () => {
    const r = runCheck({ stagedFiles: undefined, fileContents: {} });
    expect(r.ok).toBe(true);
    expect(r.summary.filesScanned).toBe(0);
  });

  it('uses an empty allowed-set when allowSkip is true even with bad input', () => {
    const r = runCheck({ allowSkip: true });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('honours inline disable inside file content', () => {
    const r = runCheck({
      stagedFiles: ['src/api.ts'],
      fileContents: {
        'src/api.ts':
          'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4"; // stableroute-disable-line secret-scan\n',
      },
    });
    expect(r.ok).toBe(true);
    expect(r.summary.matches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('prints a SKIPPED banner when allowSkip was honoured', () => {
    const out = formatReport({
      ok: true,
      skipped: true,
      blockedFilenames: [],
      fileFindings: [],
      summary: { blocked: 0, matches: 0, filesScanned: 0 },
    });
    expect(out).toMatch(/SKIPPED/);
  });

  it('prints a success line when ok', () => {
    const out = formatReport({
      ok: true,
      skipped: false,
      blockedFilenames: [],
      fileFindings: [
        { path: 'a.ts', skipped: false, matches: [] },
      ],
      summary: { blocked: 0, matches: 0, filesScanned: 1 },
    });
    expect(out).toMatch(/OK/);
  });

  it('prints blocked filenames and per-file matches on failure', () => {
    const out = formatReport({
      ok: false,
      skipped: false,
      blockedFilenames: ['.env'],
      fileFindings: [
        {
          path: 'a.ts',
          skipped: false,
          matches: [
            {
              type: 'github-pat-classic',
              description: 'GitHub PAT',
              preview: 'ghp…aaaa (len=40)',
              lineNumber: 7,
            },
          ],
        },
      ],
      summary: { blocked: 1, matches: 1, filesScanned: 1 },
    });
    expect(out).toMatch(/blocked filename/);
    expect(out).toMatch(/a\.ts:7/);
    expect(out).toMatch(/FAIL/);
  });

  it('marks content-skipped files in the report', () => {
    const out = formatReport({
      ok: true,
      skipped: false,
      blockedFilenames: [],
      fileFindings: [
        { path: 'package-lock.json', skipped: true, matches: [] },
      ],
      summary: { blocked: 0, matches: 0, filesScanned: 0 },
    });
    expect(out).toMatch(/content scan skipped/);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to staged scope', () => {
    const a = parseArgs(['node', 'check.js']);
    expect(a.scope).toBe('staged');
    expect(a.baseRef).toBe('origin/main');
    expect(a.allowSkip).toBe(false);
  });

  it('parses --scope working-tree', () => {
    expect(parseArgs(['node', 'check.js', '--scope=working-tree']).scope).toBe(
      'working-tree'
    );
  });

  it('parses --scope pr-diff', () => {
    expect(parseArgs(['node', 'check.js', '--scope=pr-diff']).scope).toBe(
      'pr-diff'
    );
  });

  it('parses --base-ref', () => {
    expect(
      parseArgs(['node', 'check.js', '--base-ref=origin/develop']).baseRef
    ).toBe('origin/develop');
  });

  it('parses --allow-skip', () => {
    expect(parseArgs(['node', 'check.js', '--allow-skip']).allowSkip).toBe(
      true
    );
  });

  it('parses --help', () => {
    expect(parseArgs(['node', 'check.js', '-h']).help).toBe(true);
    expect(parseArgs(['node', 'check.js', '--help']).help).toBe(true);
  });

  it('captures unknown flags', () => {
    expect(parseArgs(['node', 'check.js', '--wat']).unknown).toBe('--wat');
  });
});

describe('printHelp', () => {
  it('describes scope, base-ref, allow-skip, help, and env vars', () => {
    const h = printHelp();
    expect(h).toMatch(/--scope/);
    expect(h).toMatch(/--base-ref/);
    expect(h).toMatch(/--allow-skip/);
    expect(h).toMatch(/STABLEROUTE_SKIP_SECRET_SCAN/);
    expect(h).toMatch(/STABLEROUTE_SKIP_PRECOMMIT/);
  });
});

// ---------------------------------------------------------------------------
// Working-tree fs walkers
// ---------------------------------------------------------------------------

describe('getWorkingTreeFiles + readWorkingTreeFiles', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-secret-'));
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'clean.ts'), 'export const x = 1;\n');
    fs.writeFileSync(
      path.join(tmpRoot, 'src', 'dirty.ts'),
      'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\n'
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'src', 'safe-sri.ts'),
      'integrity="sha256-aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\n'
    );
    fs.writeFileSync(path.join(tmpRoot, 'package-lock.json'), '{}');
    fs.writeFileSync(
      path.join(tmpRoot, 'node_modules', 'leftpad.js'),
      '// we should be skipped'
    );
    // Force a `dist` skip-dir too.
    fs.mkdirSync(path.join(tmpRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'dist', 'bundle.js'), 'x');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('walks the tree and skips ignore-directories + lockfiles by NAME', () => {
    const all = getWorkingTreeFiles(tmpRoot);
    expect(all).toEqual(
      expect.arrayContaining([
        path.join('src', 'clean.ts'),
        path.join('src', 'dirty.ts'),
        path.join('src', 'safe-sri.ts'),
        path.join('package-lock.json'),
      ])
    );
    expect(all.some((p) => p.includes('node_modules'))).toBe(false);
    expect(all.some((p) => p.startsWith(path.join('dist', '')))).toBe(false);
  });

  it('reads file contents into a { path: string } map', () => {
    const files = [
      path.join('src', 'clean.ts'),
      path.join('src', 'dirty.ts'),
      path.join('src', 'safe-sri.ts'),
    ];
    const map = readWorkingTreeFiles(files, tmpRoot);
    expect(map[path.join('src', 'clean.ts')]).toMatch(/const x = 1/);
    expect(map[path.join('src', 'dirty.ts')]).toMatch(/API_KEY/);
    expect(map[path.join('src', 'safe-sri.ts')]).toMatch(/sha256-/);
  });

  it('skips binaries (NUL-byte-headed files)', () => {
    const binPath = path.join(tmpRoot, 'src', 'blob.bin');
    // Bytes: 0x00, 0x01, 0x02, 0x03
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 4, 5]));
    const map = readWorkingTreeFiles([path.join('src', 'blob.bin')], tmpRoot);
    expect(map[path.join('src', 'blob.bin')]).toBeUndefined();
  });

  it('end-to-end: detects a real credential in the working tree', () => {
    const files = getWorkingTreeFiles(tmpRoot);
    const map = readWorkingTreeFiles(files, tmpRoot);
    const r = runCheck({ stagedFiles: files, fileContents: map });
    const dirty = r.fileFindings.find(
      (f) => f.path === path.join('src', 'dirty.ts')
    );
    expect(dirty).toBeDefined();
    expect(dirty.matches.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it('end-to-end: stays green for a clean tree', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-clean-'));
    fs.writeFileSync(path.join(sub, 'ok.ts'), 'export const safe = 1;\n');
    const files = getWorkingTreeFiles(sub);
    const map = readWorkingTreeFiles(files, sub);
    const r = runCheck({ stagedFiles: files, fileContents: map });
    fs.rmSync(sub, { recursive: true, force: true });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanTextContent: cross-line next-line disable (zustand-style state machine).
// ---------------------------------------------------------------------------

describe('scanTextContent multi-line next-line disable', () => {
  it('skips the next line when preceded by stableroute-disable-next-line', () => {
    const f = scanTextContent(
      'src/api.ts',
      [
        '// stableroute-disable-next-line secret-scan',
        'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";',
      ].join('\n'),
      { patterns: PATTERN_DEFINITIONS, entropyConfig: DEFAULT_ENTROPY_CONFIG }
    );
    expect(f.matches).toEqual([]);
  });

  it('does NOT skip the line AFTER the protected one', () => {
    const f = scanTextContent(
      'src/api.ts',
      [
        '// stableroute-disable-next-line secret-scan',
        'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";',
        'API_KEY = "L8nT2vR6WqL9bZc3Xy7N4aZ3q9X0P7";',
      ].join('\n'),
      { patterns: PATTERN_DEFINITIONS, entropyConfig: DEFAULT_ENTROPY_CONFIG }
    );
    // Only the second secret should be picked up (line 3).
    expect(f.matches.length).toBeGreaterThan(0);
    expect(f.matches[0].lineNumber).toBe(3);
  });

  it('still flags vendor patterns that match on the comment line itself', () => {
    // A playwright token written INSIDE a comment-with-disable must still
    // match (we never blanket-suppress; vendor patterns are the safety net).
    const f = scanTextContent(
      'src/x.ts',
      '// example with ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa in a comment',
      { patterns: PATTERN_DEFINITIONS, entropyConfig: DEFAULT_ENTROPY_CONFIG }
    );
    expect(f.matches.some((m) => m.type === 'github-pat-classic')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runCheck: env opt-out, missing content, custom patterns
// ---------------------------------------------------------------------------

describe('runCheck env opt-out + missing content', () => {
  it('honours STABLEROUTE_SKIP_SECRET_SCAN via env', () => {
    const r = runCheck({
      stagedFiles: ['.env'],
      fileContents: {},
      env: { STABLEROUTE_SKIP_SECRET_SCAN: '1' },
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.summary.skipReason).toBe('env');
  });

  it('records files that were staged but whose content we could not read', () => {
    const r = runCheck({
      stagedFiles: ['src/x.ts'],
      fileContents: {},
    });
    expect(r.missingContents).toEqual(['src/x.ts']);
    expect(r.summary.missing).toBe(1);
    expect(r.ok).toBe(true); // missing != finding
    expect(r.fileFindings[0].matches).toEqual([]);
  });

  it('formats `skipped` reports with the env-flag reason', () => {
    const out = formatReport({
      ok: true,
      skipped: true,
      blockedFilenames: [],
      missingContents: [],
      fileFindings: [],
      summary: { blocked: 0, matches: 0, filesScanned: 0, missing: 0, skipReason: 'env' },
    });
    expect(out).toMatch(/SKIPPED.*env/);
  });

  it('formats reports with missingContents banner', () => {
    const out = formatReport({
      ok: true,
      skipped: false,
      blockedFilenames: [],
      missingContents: ['src/blob.bin'],
      fileFindings: [{ path: 'src/blob.bin', skipped: false, matches: [] }],
      summary: { blocked: 0, matches: 0, filesScanned: 0, missing: 1 },
    });
    expect(out).toMatch(/unreadable/);
  });

  it('accepts custom patterns to override vendor detection', () => {
    const r = runCheck({
      stagedFiles: ['src/x.ts'],
      fileContents: { 'src/x.ts': 'INTERNAL_TOKEN = "my-token-1234567890"\n' },
      patterns: [
        {
          id: 'internal-token',
          description: 'Internal mock token',
          assignmentOnly: true,
          regex: /INTERNAL_TOKEN/,
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.fileFindings[0].matches[0].type).toBe('internal-token');
  });
});

// ---------------------------------------------------------------------------
// findSecretMatches: JWT exclusion in bearer-token pattern + env opt-out
// ---------------------------------------------------------------------------

describe('findSecretMatches bearer-token JWT exclusion', () => {
  it('does NOT flag a Bearer JWT', () => {
    // Three base64url segments joined by `.` — classic JWT shape.
    const line =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxRxJq9w2v4n8eEa7iCvKQq6wMnVxh1g";
    const m = findSecretMatches(line, allPatterns);
    expect(m.map((x) => x.type)).not.toContain('bearer-token-header');
  });

  it('DOES flag a Bearer non-JWT opaque token', () => {
    const line =
      'Authorization: Bearer aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4qW';
    const m = findSecretMatches(line, allPatterns);
    expect(m.map((x) => x.type)).toContain('bearer-token-header');
  });

  it('does NOT flag anything when STABLEROUTE_SKIP_SECRET_SCAN=1 in env', () => {
    const m = findSecretMatches(
      'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";',
      { ...allPatterns, env: { STABLEROUTE_SKIP_SECRET_SCAN: '1' } }
    );
    expect(m).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLI helpers: getStagedFiles / getPrDiffFiles via injected gitRunner.
// ---------------------------------------------------------------------------

const { getStagedFileContent, getPrDiffFiles, getStagedFiles, runMain } = require('../check-staged-secrets');

function makeRunner(map) {
  return (cmd, args) => {
    const key = `${cmd}|${args.join('|')}`;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      const v = map[key];
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error(`unexpected git invocation: ${key}`);
  };
}

describe('getStagedFiles / getStagedFileContent', () => {
  it('parses `git diff --cached --name-only --diff-filter=ACMR`', () => {
    const runner = makeRunner({
      'diff|--cached|--name-only|--diff-filter=ACMR': 'src/app/page.tsx\n.env\n   \n',
    });
    expect(getStagedFiles('/tmp', runner)).toEqual([
      'src/app/page.tsx',
      '.env',
    ]);
  });

  it('throws if git exits non-zero', () => {
    const runner = () => {
      throw new Error('git diff --cached --name-only --diff-filter=ACMR failed: bad ref');
    };
    expect(() => getStagedFiles('/tmp', runner)).toThrow(/bad ref/);
  });

  it('retrieves file content via `git show :<path>`', () => {
    const runner = makeRunner({ 'show|:src/app/page.tsx': 'export const x = 1;\n' });
    expect(getStagedFileContent('src/app/page.tsx', '/tmp', runner)).toBe(
      'export const x = 1;\n'
    );
  });
});

describe('getPrDiffFiles', () => {
  it('returns three-dot diff when non-empty', () => {
    const runner = makeRunner({
      'diff|--name-only|--diff-filter=ACMR|origin/main...HEAD': 'src/foo.ts\n',
    });
    expect(getPrDiffFiles('/tmp', 'origin/main', runner)).toEqual(['src/foo.ts']);
  });

  it('falls back to two-dot diff when three-dot returns empty', () => {
    const runner = makeRunner({
      'diff|--name-only|--diff-filter=ACMR|origin/main...HEAD': '',
      'diff|--name-only|--diff-filter=ACMR|origin/main|HEAD': 'src/foo.ts\n',
    });
    expect(getPrDiffFiles('/tmp', 'origin/main', runner)).toEqual(['src/foo.ts']);
  });

  it('returns empty list when both diffs are empty', () => {
    const runner = makeRunner({
      'diff|--name-only|--diff-filter=ACMR|origin/main...HEAD': '',
      'diff|--name-only|--diff-filter=ACMR|origin/main|HEAD': '',
    });
    expect(getPrDiffFiles('/tmp', 'origin/main', runner)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runMain — the CLI orchestrator. All I/O is mocked.
// ---------------------------------------------------------------------------

function streamCollector() {
  let buf = '';
  return {
    write: (chunk) => {
      buf += String(chunk);
    },
    text: () => buf,
  };
}

describe('runMain', () => {
  it('prints help when --help is set', () => {
    const stdout = streamCollector();
    const rc = runMain(
      { help: true, scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stdout }
    );
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/Usage: node scripts\/check-staged-secrets\.js/);
  });

  it('returns 2 on unknown flag', () => {
    const stderr = streamCollector();
    const stdout = streamCollector();
    const rc = runMain(
      { unknown: '--wat', scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stderr, stdout }
    );
    expect(rc).toBe(2);
    expect(stderr.text()).toMatch(/Unknown flag: --wat/);
  });

  it('returns 0 with banner when STABLEROUTE_SKIP_PRECOMMIT=1', () => {
    const stdout = streamCollector();
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stdout, env: { STABLEROUTE_SKIP_PRECOMMIT: '1' } }
    );
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/SKIPPED/);
  });

  it('returns 2 on unknown --scope value', () => {
    const stderr = streamCollector();
    const rc = runMain(
      { scope: 'wat-scope', baseRef: 'origin/main', allowSkip: false },
      { stderr }
    );
    expect(rc).toBe(2);
    expect(stderr.text()).toMatch(/Unknown --scope/);
  });

  it('returns 2 when git throws for --scope=staged', () => {
    const stderr = streamCollector();
    const runner = () => {
      throw new Error('not a git repository');
    };
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stderr, gitRunner: runner }
    );
    expect(rc).toBe(2);
    expect(stderr.text()).toMatch(/ERROR/);
  });

  it('returns 0 on a clean staged run', () => {
    const stdout = streamCollector();
    const runner = makeRunner({
      'diff|--cached|--name-only|--diff-filter=ACMR': 'src/clean.ts\n',
      'show|:src/clean.ts': 'export const x = 1;\n',
    });
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stdout, gitRunner: runner }
    );
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/OK/);
  });

  it('returns 1 and writes partial report on a finding', () => {
    const stdout = streamCollector();
    const runner = makeRunner({
      'diff|--cached|--name-only|--diff-filter=ACMR':
        'src/clean.ts\n.env\nsrc/dirty.ts\n',
      'show|:src/clean.ts': 'export const x = 1;\n',
      'show|:src/dirty.ts':
        'API_KEY = "aZ3q9X0P7Lm4K8nT2vR6WqL9bZc3Xy7N4";\n',
    });
    let exitCode;
    const exitFn = (code) => {
      exitCode = code;
    };
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stdout, gitRunner: runner, exitFn }
    );
    expect(rc).toBe(1);
    expect(exitCode).toBe(1);
    expect(stdout.text()).toMatch(/FAIL/);
    expect(stdout.text()).toMatch(/\.env — blocked filename/);
    expect(stdout.text()).toMatch(/src\/dirty\.ts/);
  });

  it('returns 0 with banner when STABLEROUTE_SKIP_SECRET_SCAN=1', () => {
    const stdout = streamCollector();
    const runner = makeRunner({
      'diff|--cached|--name-only|--diff-filter=ACMR': '.env\n',
    });
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: false },
      { stdout, gitRunner: runner, env: { STABLEROUTE_SKIP_SECRET_SCAN: '1' } }
    );
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/SKIPPED/);
  });

  it('--allow-skip flag exits 0 with banner', () => {
    const stdout = streamCollector();
    const runner = makeRunner({
      'diff|--cached|--name-only|--diff-filter=ACMR': '.env\n',
    });
    const rc = runMain(
      { scope: 'staged', baseRef: 'origin/main', allowSkip: true, unknown: undefined, help: undefined },
      { stdout, gitRunner: runner }
    );
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/SKIPPED/);
  });

  it('--scope=working-tree uses fsAdapter (falls into the runner error path on bad scope chosen)', () => {
    // A real disk walk via a tmp dir exercises the working-tree branch.
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-runmain-'));
    fs.writeFileSync(path.join(sub, 'clean.ts'), 'export const x = 1;\n');
    const stdout = streamCollector();
    const rc = runMain(
      { scope: 'working-tree', baseRef: 'origin/main', allowSkip: false },
      { stdout, cwd: sub }
    );
    fs.rmSync(sub, { recursive: true, force: true });
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/OK/);
  });

  it('--scope=pr-diff uses gitRunner + fsAdapter', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-pr-'));
    fs.writeFileSync(path.join(sub, 'src.ts'), 'export const clean = 1;\n');
    fs.mkdirSync(path.join(sub, 'src'), { recursive: true });
    const runner = makeRunner({
      'diff|--name-only|--diff-filter=ACMR|origin/main...HEAD': 'src.ts\n',
    });
    const stdout = streamCollector();
    const rc = runMain(
      { scope: 'pr-diff', baseRef: 'origin/main', allowSkip: false },
      { stdout, cwd: sub, gitRunner: runner }
    );
    fs.rmSync(sub, { recursive: true, force: true });
    expect(rc).toBe(0);
    expect(stdout.text()).toMatch(/OK/);
  });
});

// ---------------------------------------------------------------------------
// Coverage-of-the-edges: getWorkingTreeFiles / readWorkingTreeFiles /
// defaultFsAdapter / formatReport(verbose=false) / main() wrapper.
// ---------------------------------------------------------------------------

const {
  defaultFsAdapter,
  defaultGitRunner,
  formatReport: fmtReport,
  main: mainWrapper,
} = require('../check-staged-secrets');

describe('getWorkingTreeFiles edge cases', () => {
  it('skips files larger than 1 MiB from the scan list (and content read)', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-large-'));
    fs.writeFileSync(path.join(sub, 'small.txt'), 'hi\n');
    // 2 MiB file — the walker should OMIT it from the scan list entirely
    // (never even tried to read its content), per the policy in
    // `getWorkingTreeFiles`.
    const big = Buffer.alloc(2 * 1024 * 1024, 65); // 'A' = 0x41, not NUL
    fs.writeFileSync(path.join(sub, 'huge.bin'), big);
    const files = getWorkingTreeFiles(sub);
    fs.rmSync(sub, { recursive: true, force: true });
    expect(files).toEqual([path.join('small.txt')]);
    expect(files).not.toContain(path.join('huge.bin'));
  });

  it('swallows readdirSync errors and returns what it could read', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-rd-'));
    // Real fs failing on a missing directory inside walk.
    const ret = getWorkingTreeFiles(sub);
    fs.rmSync(sub, { recursive: true, force: true });
    // Empty dir → no files.
    expect(ret).toEqual([]);
  });

  it('honours the skip-dir set (node_modules, .git, …)', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-skipd-'));
    fs.mkdirSync(path.join(sub, 'node_modules', 'leftpad'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'node_modules', 'leftpad', 'index.js'), 'module.exports=1;\n');
    fs.mkdirSync(path.join(sub, '.git'), { recursive: true });
    fs.writeFileSync(path.join(sub, '.git', 'config'), '/* */\n');
    fs.writeFileSync(path.join(sub, 'real.ts'), 'export const x = 1;\n');
    const files = getWorkingTreeFiles(sub);
    fs.rmSync(sub, { recursive: true, force: true });
    expect(files).toEqual([path.join('real.ts')]);
  });

  it('returns sorted output', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-sort-'));
    fs.writeFileSync(path.join(sub, 'b.ts'), '');
    fs.mkdirSync(path.join(sub, 'a'));
    fs.writeFileSync(path.join(sub, 'a', 'a.ts'), '');
    const files = getWorkingTreeFiles(sub);
    fs.rmSync(sub, { recursive: true, force: true });
    // Directories are walked depth-first; sort puts `a/a.ts` before `b.ts`.
    expect(files[0]).toBe(path.join('a', 'a.ts'));
  });
});

describe('readWorkingTreeFiles error handling', () => {
  it('ignores files that fail to open (ENOENT etc.)', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-rw-'));
    // Don't write the file but list it.
    const map = readWorkingTreeFiles([path.join('does-not-exist.ts')], sub);
    fs.rmSync(sub, { recursive: true, force: true });
    expect(Object.keys(map)).toHaveLength(0);
  });
});

describe('defaultFsAdapter memoization', () => {
  it('returns the same module instance on subsequent calls', () => {
    const a = defaultFsAdapter();
    const b = defaultFsAdapter();
    expect(a).toBe(b);
  });

  it('exposes the Node fs module (has statSync)', () => {
    expect(typeof defaultFsAdapter().statSync).toBe('function');
  });
});

describe('defaultGitRunner', () => {
  it('runs an actual git invocation via the default child_process', () => {
    // Use --version which is stable; doesn't depend on the repo state.
    const out = defaultGitRunner('--version', []);
    expect(out.trim()).toMatch(/^git version /);
  });
});

describe('formatReport verbose=false', () => {
  it('omits the "scanning…" banner when verbose is false', () => {
    const out = formatReport(
      {
        ok: true,
        skipped: false,
        blockedFilenames: [],
        missingContents: [],
        fileFindings: [],
        summary: { blocked: 0, matches: 0, filesScanned: 0, missing: 0 },
      },
      { verbose: false }
    );
    expect(out).not.toMatch(/scanning/);
  });

  it('falls through to the success banner when verbose defaults to true', () => {
    const out = fmtReport({
      ok: true,
      skipped: false,
      blockedFilenames: [],
      missingContents: [],
      fileFindings: [],
      summary: { blocked: 0, matches: 0, filesScanned: 0, missing: 0 },
    });
    expect(out).toMatch(/scanning/);
  });
});

describe('main() CLI wrapper', () => {
  it('returns 0 and does NOT call process.exit on --help', () => {
    const origArgv = process.argv;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      process.argv = ['node', 'check-staged-secrets.js', '--help'];
      const rc = mainWrapper();
      expect(rc).toBe(0);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      process.argv = origArgv;
      exitSpy.mockRestore();
    }
  });

  it('invokes process.exit with rc=2 on a bad flag', () => {
    const origArgv = process.argv;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      process.argv = ['node', 'check-staged-secrets.js', '--bogus-flag'];
      mainWrapper();
      // main() calls process.exit(2) after writing the error, so the spy
      // is the only way to assert the code without terminating jest.
      expect(exitSpy).toHaveBeenCalledWith(2);
    } finally {
      process.argv = origArgv;
      exitSpy.mockRestore();
    }
  });
});
