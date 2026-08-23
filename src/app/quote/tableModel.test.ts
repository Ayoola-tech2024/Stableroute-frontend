import {
  applyViewState,
  DEFAULT_VIEW_STATE,
  distinctSources,
  nextSortDir,
  PAGE_SIZE,
  parseViewState,
  serializeViewState,
  type HistoryEntry,
  type TableViewState,
} from './tableModel';

function entry(
  source: string,
  dest: string,
  amount: string,
  savedAt: number
): HistoryEntry {
  return { source, dest, amount, savedAt };
}

const rows: HistoryEntry[] = [
  entry('USDC', 'EURC', '3000', 1000),
  entry('XLM', 'USDC', '500', 2000),
  entry('USDC', 'NGN', '100', 3000),
  entry('BTC', 'USDC', '2500', 4000),
  entry('USDC', 'EURC', '700', 5000),
];

describe('parseViewState', () => {
  it('returns defaults for an empty query string', () => {
    expect(parseViewState(new URLSearchParams())).toEqual(DEFAULT_VIEW_STATE);
  });

  it('parses valid values from the query string', () => {
    const params = new URLSearchParams(
      'q_sort=amount&q_dir=desc&q_filter=usdc&q_asset=XLM&q_page=2'
    );
    expect(parseViewState(params)).toEqual({
      sort: 'amount',
      dir: 'desc',
      filter: 'usdc',
      asset: 'XLM',
      page: 2,
    });
  });

  it('falls back to defaults per-field for invalid values', () => {
    const params = new URLSearchParams(
      'q_sort=bogus&q_dir=sideways&q_page=zero&q_asset='
    );
    const state = parseViewState(params);
    expect(state.sort).toBe(DEFAULT_VIEW_STATE.sort);
    expect(state.dir).toBe(DEFAULT_VIEW_STATE.dir);
    expect(state.page).toBe(1);
    expect(state.asset).toBe('all');
  });

  it('clamps negative and zero pages to 1', () => {
    expect(parseViewState(new URLSearchParams('q_page=-3')).page).toBe(1);
    expect(parseViewState(new URLSearchParams('q_page=0')).page).toBe(1);
  });
});

describe('serializeViewState', () => {
  it('omits all defaults, producing a clean URL', () => {
    expect(serializeViewState(DEFAULT_VIEW_STATE).toString()).toBe('');
  });

  it('round-trips non-default values through parseViewState', () => {
    const state: TableViewState = {
      sort: 'dest',
      dir: 'desc',
      filter: 'eur',
      asset: 'USDC',
      page: 2,
    };
    const params = serializeViewState(state);
    // Round-trip via location-style URL to mirror real usage.
    const restored = parseViewState(new URLSearchParams(params.toString()));
    expect(restored).toEqual(state);
    expect(params.get('q_sort')).toBe('dest');
    expect(params.get('q_dir')).toBe('desc');
  });
});

describe('applyViewState — filtering', () => {
  it('narrows rows by case-insensitive substring over source and dest', () => {
    const result = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      filter: 'eurc',
    });
    // Only the two EURC destinations match.
    expect(result.totalFiltered).toBe(2);
    expect(result.rows.map((row) => row.savedAt)).toEqual([1000, 5000]);
  });

  it('narrows rows by exact enum match on the source asset', () => {
    const result = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      asset: 'USDC',
    });
    expect(result.totalFiltered).toBe(3);
    expect(
      result.rows.every((row) => row.source === 'USDC')
    ).toBe(true);
  });

  it('combines text and enum filters conjunctively', () => {
    const result = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      filter: 'eurc',
      asset: 'USDC',
    });
    expect(result.totalFiltered).toBe(2);
  });
});

describe('applyViewState — sorting', () => {
  it('sorts ascending and descending by amount numerically', () => {
    const asc = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'amount',
      dir: 'asc',
    });
    // Full ascending order is 100…3000; the returned slice is page one.
    expect(asc.totalFiltered).toBe(5);
    expect(asc.rows.map((row) => row.amount)).toEqual(['100', '500', '700']);

    const desc = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'amount',
      dir: 'desc',
    });
    expect(desc.rows.map((row) => row.amount)).toEqual([
      '3000',
      '2500',
      '700',
    ]);
  });

  it('orders unbounded digit amounts exactly (no float precision loss)', () => {
    const bigRows = [
      entry('A', 'B', '100000000000000000001', 1),
      entry('A', 'B', '100000000000000000002', 2),
      entry('A', 'B', '99', 3),
    ];
    const result = applyViewState(bigRows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'amount',
      dir: 'asc',
    });
    expect(result.rows.map((row) => row.amount)).toEqual([
      '99',
      '100000000000000000001',
      '100000000000000000002',
    ]);
  });

  it('is stable for equal keys: original order is preserved', () => {
    const result = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'source',
      dir: 'asc',
    });
    // Three USDC sources keep their original relative order (savedAt
    // 1000 → 3000 → 5000) instead of being shuffled. Verify across both
    // pages since the full sorted set spans them.
    expect(result.totalFiltered).toBe(5);
    expect(result.rows.map((row) => row.savedAt)).toEqual([
      4000, 1000, 3000,
    ]);
    const page2 = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'source',
      dir: 'asc',
      page: 2,
    });
    expect(page2.rows.map((row) => row.savedAt)).toEqual([5000, 2000]);
  });

  it('dir "none" keeps the original recency order regardless of column', () => {
    const result = applyViewState(rows, {
      ...DEFAULT_VIEW_STATE,
      sort: 'source',
      dir: 'none',
    });
    expect(result.rows.map((row) => row.savedAt)).toEqual([
      1000, 2000, 3000,
    ]);
  });
});

describe('nextSortDir', () => {
  it('cycles none → asc → desc → none', () => {
    expect(nextSortDir('none')).toBe('asc');
    expect(nextSortDir('asc')).toBe('desc');
    expect(nextSortDir('desc')).toBe('none');
  });
});

describe('applyViewState — pagination', () => {
  it('slices rows into full pages of PAGE_SIZE', () => {
    const page1 = applyViewState(rows, DEFAULT_VIEW_STATE);
    expect(page1.totalPages).toBe(Math.ceil(rows.length / PAGE_SIZE));
    expect(page1.rows).toHaveLength(PAGE_SIZE);

    const page2 = applyViewState(rows, { ...DEFAULT_VIEW_STATE, page: 2 });
    expect(page2.rows).toHaveLength(rows.length - PAGE_SIZE);
  });

  it('clamps an out-of-range page into the valid range', () => {
    const beyond = applyViewState(rows, { ...DEFAULT_VIEW_STATE, page: 99 });
    expect(beyond.page).toBe(beyond.totalPages);

    const zero = applyViewState(rows, { ...DEFAULT_VIEW_STATE, page: 0 });
    expect(zero.page).toBe(1);
  });

  it('clamping adapts when filters shrink the row count', () => {
    const stranded = applyViewState(rows, {
      filter: '',
      asset: 'all',
      sort: 'saved',
      dir: 'none',
      page: 2,
    });
    expect(stranded.page).toBe(2);

    // 'usdc' matches every row here (source OR destination), so the page
    // count stays at 2 and page 2 remains valid with its two leftovers.
    const shrunk = applyViewState(rows, {
      filter: 'usdc',
      asset: 'all',
      sort: 'saved',
      dir: 'none',
      page: 2,
    });
    expect(shrunk.totalFiltered).toBe(5);
    expect(shrunk.totalPages).toBe(2);
    expect(shrunk.page).toBe(2);
    expect(shrunk.rows.map((row) => row.savedAt)).toEqual([4000, 5000]);
  });
});

describe('distinctSources', () => {
  it('lists unique sources in first-seen order', () => {
    expect(distinctSources(rows)).toEqual(['USDC', 'XLM', 'BTC']);
  });
});
