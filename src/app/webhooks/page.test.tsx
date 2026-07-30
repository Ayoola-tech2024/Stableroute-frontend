import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WebhooksPage from './page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wire up global.fetch to respond with a JSON body for the initial GET
 * /api/v1/webhooks request, and optionally with additional responses for
 * subsequent calls (POST, DELETE, reload GET).
 */
function mockFetchSequence(
  ...responses: Array<{ ok: boolean; body?: unknown; status?: number }>
) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    const resp = responses[call] ?? responses[responses.length - 1];
    call += 1;
    if (resp.ok) {
      return Promise.resolve({
        ok: true,
        status: resp.status ?? 200,
        text: () => Promise.resolve(JSON.stringify(resp.body ?? {})),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: false,
      status: resp.status ?? 500,
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: 'server_error', message: 'Server error' })
        ),
    } as unknown as Response);
  });
}

/** A single webhook fixture. */
const HOOK_1 = {
  id: 'wh-001',
  url: 'https://example.com/hook',
  events: ['pair.registered', 'pair.deleted'],
  createdAt: Date.now() - 60_000,
};

const HOOK_2 = {
  id: 'wh-002',
  url: 'https://other.example.com/hook',
  events: ['quote.requested'],
  createdAt: Date.now() - 120_000,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

describe('WebhooksPage', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // FORM ANNOUNCEMENT
  // -------------------------------------------------------------------------

  it('announces form submission status inside the polite live region', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });

    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    fetchMock.mockImplementationOnce(
      () => pendingResponse
    ) as unknown as typeof global.fetch;
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    const liveRegion = document.querySelector('[aria-live=polite]');
    expect(liveRegion).toHaveTextContent('Registering webhook…');

    resolvePost?.({
      ok: true,
      status: 201,
      text: () => Promise.resolve('{}'),
    });

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Webhook registered.');
    });
  });

  it('clears the form announcement on registration failure', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: 'validation_error',
            message: 'Invalid URL',
          })
        ),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid URL/i);
    });

    const liveRegion = document.querySelector('[aria-live=polite]');
    expect(liveRegion).not.toHaveTextContent('Registering webhook');
    expect(liveRegion).not.toHaveTextContent('Webhook registered');
  });

  it('does not announce form status on initial render', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    const liveRegion = document.querySelector('[aria-live=polite]');
    expect(liveRegion).not.toHaveTextContent('Registering');
    expect(liveRegion).not.toHaveTextContent('Webhook registered');
  });

  // -------------------------------------------------------------------------
  // LIST / RENDER
  // -------------------------------------------------------------------------

  it('shows loading indicator before data arrives', () => {
    // fetch that never resolves → stays in loading state
    global.fetch = jest.fn(
      () => new Promise(() => {})
    ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /webhooks/i })
    ).toBeInTheDocument();
  });

  it('renders a registered webhook URL in the list', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
  });

  it('renders all event badges for a webhook', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('pair.registered')).toBeInTheDocument()
    );
    expect(screen.getByText('pair.deleted')).toBeInTheDocument();
  });

  it('renders multiple webhooks', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1, HOOK_2] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    expect(
      screen.getByText('https://other.example.com/hook')
    ).toBeInTheDocument();
  });

  it('shows the empty state message when there are no webhooks', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
  });

  it('renders the EmptyState component when there are no webhooks', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/Register your first webhook endpoint/i)
    ).toBeInTheDocument();
  });

  it('renders webhooks inside a single aria-live=polite region', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const live = document.querySelector('[aria-live=polite]');
    expect(live).toBeInTheDocument();
    expect(live).toHaveAttribute('aria-atomic', 'true');
  });

  it('has exactly one aria-live=polite region', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(document.querySelectorAll('[aria-live=polite]')).toHaveLength(1);
  });

  it('has exactly one #main-content landmark', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // ERROR STATES
  // -------------------------------------------------------------------------

  it('surfaces a list-load failure with role=alert', async () => {
    // apiClient converts network errors to "Network request failed"
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Network request failed/i
    );
  });

  it('shows a Retry button in the error state', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /retry/i })
      ).toBeInTheDocument()
    );
  });

  it('clicking Retry re-fetches the webhook list', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loading state has aria-busy set to true', () => {
    global.fetch = jest.fn(
      () => new Promise(() => {})
    ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toHaveAttribute('aria-busy', 'true');
  });

  it('aria-busy is removed after loading transitions to error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    );
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toHaveAttribute('aria-busy', 'true');
  });

  it('aria-busy is removed after loading transitions to empty', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toHaveAttribute('aria-busy', 'true');
  });

  it('does not show the error state when data loads successfully', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    expect(screen.queryByText(/failed to load webhooks/i)).not.toBeInTheDocument();
  });

  it('does not show the empty state when data loads successfully', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    // EmptyState title should not be present when data exists
    expect(
      screen.queryByText(/register your first webhook/i)
    ).not.toBeInTheDocument();
  });

  it('does not show the loading indicator when there is an error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    );
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
  });

  it('does not show the loading indicator when the list is empty', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
  });

  it('does not show empty state when there is an error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    );
    expect(screen.queryByText(/No webhooks registered/i)).not.toBeInTheDocument();
  });

  it('surfaces an HTTP error from the list endpoint with role=alert', async () => {
    // apiClient extracts the message field from the JSON body
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: 'forbidden', message: 'Forbidden' })
        ),
    } as unknown as Response);
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Forbidden/i)
    );
  });

  it('surfaces a create failure with role=alert', async () => {
    // GET list succeeds; POST fails with validation error (apiClient extracts body.message)
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: 'validation_error',
              message: 'Invalid URL',
            })
          ),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    // Fill in URL and submit
    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/new' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);

    // Confirm dialog appears — click Confirm
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid URL/i)
    );
  });

  // -------------------------------------------------------------------------
  // FORM: URL VALIDATION
  // -------------------------------------------------------------------------

  it('shows an error when submitted without HTTPS', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'http://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/https/i)
    );
  });

  it('shows an error when no events are selected', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    // Deselect the default "pair.registered" checkbox
    const checkbox = screen.getByRole('checkbox', {
      name: /pair\.registered/i,
    });
    fireEvent.click(checkbox);

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/at least one event/i)
    );
  });

  // -------------------------------------------------------------------------
  // EVENT CHECKBOXES
  // -------------------------------------------------------------------------

  it('renders a checkbox for every WEBHOOK_EVENT_OPTIONS entry', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    const expected = [
      'pair.registered',
      'pair.deleted',
      'quote.requested',
      'router.paused',
      'router.unpaused',
    ];
    expected.forEach((evt) => {
      expect(screen.getByRole('checkbox', { name: evt })).toBeInTheDocument();
    });
  });

  it('pre-selects pair.registered by default', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    expect(
      screen.getByRole('checkbox', { name: /pair\.registered/i })
    ).toBeChecked();
  });

  it('toggles an event checkbox on/off', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    const cb = screen.getByRole('checkbox', { name: /pair\.deleted/i });
    expect(cb).not.toBeChecked();
    fireEvent.click(cb);
    expect(cb).toBeChecked();
    fireEvent.click(cb);
    expect(cb).not.toBeChecked();
  });

  it('sends only selected events in the POST body', async () => {
    const fetchMock = jest.fn();
    // GET list
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    // POST create
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve('{}'),
    } as unknown as Response);
    // GET reload
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    // Select pair.deleted in addition to the default pair.registered
    fireEvent.click(screen.getByRole('checkbox', { name: /pair\.deleted/i }));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);

    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const postCall = fetchMock.mock.calls[1];
    const body = JSON.parse(postCall[1].body as string) as {
      url: string;
      events: string[];
    };
    expect(body.events).toEqual(
      expect.arrayContaining(['pair.registered', 'pair.deleted'])
    );
    expect(body.events).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // CREATE FLOW
  // -------------------------------------------------------------------------

  it('clears the URL field after a successful create', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve('{}'),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    const urlInput = screen.getByLabelText(/URL/i);
    fireEvent.change(urlInput, {
      target: { value: 'https://example.com/hook' },
    });
    expect(urlInput).toHaveValue('https://example.com/hook');

    fireEvent.submit(urlInput.closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(urlInput).toHaveValue(''));
  });

  it('reloads the list after a successful create', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve('{}'),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    // After reload, the new webhook URL should appear in the list
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    // GET (initial) + POST + GET (reload) = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends the correct URL and events in the POST body', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve('{}'),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://target.example.com/wh' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const postCall = fetchMock.mock.calls[1];
    expect(postCall[0]).toContain('/api/v1/webhooks');
    const body = JSON.parse(postCall[1].body as string) as {
      url: string;
      events: string[];
    };
    expect(body.url).toBe('https://target.example.com/wh');
    expect(body.events).toContain('pair.registered');
  });

  it('shows Registering… on the button while submitting', async () => {
    const fetchMock = jest.fn();
    let resolvePost!: (v: unknown) => void;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response)
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolvePost = res;
          })
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /registering/i })
      ).toBeDisabled()
    );

    // Unblock the POST
    resolvePost({
      ok: true,
      status: 201,
      text: () => Promise.resolve('{}'),
    });
  });

  it('cancelling the confirm dialog does not submit', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() => screen.getByText(/No webhooks registered/i));

    fireEvent.change(screen.getByLabelText(/URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.submit(screen.getByLabelText(/URL/i).closest('form')!);
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Only the initial GET; no POST
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // REMOVE FLOW
  // -------------------------------------------------------------------------

  it('calls apiDelete with the correct webhook id', async () => {
    const fetchMock = jest.fn();
    // GET list with one webhook
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
    } as unknown as Response);
    // DELETE response (204 No Content)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: () => Promise.resolve(''),
    } as unknown as Response);
    // GET reload after delete
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [] })),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    // Click the Remove icon button for HOOK_1
    fireEvent.click(screen.getByRole('button', { name: /remove webhook/i }));

    // Confirm deletion in the dialog
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const deleteCall = fetchMock.mock.calls[1];
    expect(deleteCall[0]).toContain(`/api/v1/webhooks/${HOOK_1.id}`);
    expect(deleteCall[1].method).toBe('DELETE');
  });

  it('reloads the list after a successful remove', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /remove webhook/i }));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    // After reload the list should be empty
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
  });

  it('removes the correct webhook when multiple are listed', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ items: [HOOK_1, HOOK_2] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_2] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    // Click the first Remove button (HOOK_1)
    const removeButtons = screen.getAllByRole('button', {
      name: /remove webhook/i,
    });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const deleteCall = fetchMock.mock.calls[1];
    expect(deleteCall[0]).toContain(`/api/v1/webhooks/${HOOK_1.id}`);
  });

  it('cancelling the remove dialog does not call DELETE', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /remove webhook/i }));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Only the initial GET; no DELETE
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Webhook URL still visible
    expect(screen.getByText('https://example.com/hook')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // TIMESTAMPS
  // -------------------------------------------------------------------------

  it("renders a <time> element for each webhook's creation timestamp", async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1, HOOK_2] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const timeEls = document.querySelectorAll('time');
    expect(timeEls.length).toBeGreaterThanOrEqual(2);
    timeEls.forEach((el) => expect(el).toHaveAttribute('dateTime'));
  });

  // -------------------------------------------------------------------------
  // A11Y: TABLE SEMANTICS
  // -------------------------------------------------------------------------

  it('renders a <caption> inside the webhooks table', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const caption = document.querySelector('table caption');
    expect(caption).toBeInTheDocument();
    expect(caption).toHaveTextContent(/webhooks/i);
  });

  it('renders column headers with scope="col"', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const colHeaders = document.querySelectorAll('thead th[scope="col"]');
    expect(colHeaders.length).toBeGreaterThanOrEqual(1);
    colHeaders.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
  });

  it('renders row header cells with scope="row"', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const rowHeaders = document.querySelectorAll('tbody th[scope="row"]');
    expect(rowHeaders.length).toBeGreaterThanOrEqual(1);
    rowHeaders.forEach((th) => expect(th).toHaveAttribute('scope', 'row'));
  });

  it('does not render a <table> when there are no webhooks', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(document.querySelector('table')).not.toBeInTheDocument();
  });

  it('does not render a <table> when there is an error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /retry/i })
      ).toBeInTheDocument()
    );
    expect(document.querySelector('table')).not.toBeInTheDocument();
  });

  it('renders the caption as visually hidden (sr-only)', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    const caption = document.querySelector('table caption');
    expect(caption).toHaveClass('sr-only');
  });

  // -------------------------------------------------------------------------
  // RETRY KEYBOARD OPERABILITY
  // -------------------------------------------------------------------------

  it('Retry button is focusable and keyboard-operable', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /retry/i })
      ).toBeInTheDocument()
    );

    const retryButton = screen.getByRole('button', { name: /retry/i });
    retryButton.focus();
    expect(retryButton).toHaveFocus();

    fireEvent.click(retryButton);

    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // STATE EXCLUSIVITY: ERROR vs EMPTY vs LOADING vs DATA
  // -------------------------------------------------------------------------

  it('only shows the error state, not loading or empty, when fetch fails', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Network error')
      ) as unknown as typeof global.fetch;
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No webhooks registered/i)
    ).not.toBeInTheDocument();
    expect(document.querySelector('table')).not.toBeInTheDocument();
  });

  it('only shows the empty state, not loading or error, when list is empty', async () => {
    mockFetchSequence({ ok: true, body: { items: [] } });
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByText(/No webhooks registered/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('only shows the data table, not loading, empty, or error, when data exists', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1] } });
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No webhooks registered/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/failed to load webhooks/i)
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // TEST DELIVERY
  // -------------------------------------------------------------------------

  it('renders a Test button for each webhook row', async () => {
    mockFetchSequence({ ok: true, body: { items: [HOOK_1, HOOK_2] } });
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    const testButtons = screen.getAllByRole('button', { name: /test delivery/i });
    expect(testButtons).toHaveLength(2);
    testButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it('shows Testing… and disables the button while a test is in-flight', async () => {
    let resolveTest!: (v: unknown) => void;
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveTest = res;
          })
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    const testButton = screen.getByRole('button', {
      name: /test delivery for https:\/\/example\.com\/hook/i,
    });
    fireEvent.click(testButton);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: /testing/i })).toHaveAttribute(
      'aria-busy',
      'true'
    );

    resolveTest({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ statusCode: 200, ok: true })),
    });
  });

  it('dispatches a POST to the test endpoint when Test is clicked', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ statusCode: 200, ok: true })
          ),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /test delivery for https:\/\/example\.com\/hook/i,
      })
    );

    await waitFor(() =>
      expect(
        screen.getByText(/test delivery:/i)
      ).toBeInTheDocument()
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const testCall = fetchMock.mock.calls[1];
    expect(testCall[0]).toContain(`/api/v1/webhooks/${HOOK_1.id}/test`);
    expect(testCall[1].method).toBe('POST');
  });

  it('shows OK and status code on a successful test delivery', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ statusCode: 200, ok: true })
          ),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /test delivery for https:\/\/example\.com\/hook/i,
      })
    );

    await waitFor(() =>
      expect(screen.getByText(/OK \(200\)/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/test delivery:/i)).toHaveClass('text-green-600');
  });

  it('shows Failed and status code on a failed delivery', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ statusCode: 500, ok: false })
          ),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /test delivery for https:\/\/example\.com\/hook/i,
      })
    );

    await waitFor(() =>
      expect(screen.getByText(/Failed \(500\)/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/test delivery:/i)).toHaveClass('text-rose-600');
  });

  it('shows Failed \(0\) when the test endpoint itself fails', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('Network error'));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /test delivery for https:\/\/example\.com\/hook/i,
      })
    );

    await waitFor(() =>
      expect(screen.getByText(/Failed \(0\)/i)).toBeInTheDocument()
    );
  });

  it('testing one webhook does not affect another', async () => {
    let resolveTest!: (v: unknown) => void;
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ items: [HOOK_1, HOOK_2] })
          ),
      } as unknown as Response)
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveTest = res;
          })
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    const buttons = screen.getAllByRole('button', { name: /test delivery/i });
    expect(buttons).toHaveLength(2);

    // Click Test on HOOK_1
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      const hook1Btn = screen.getByRole('button', {
        name: /test delivery for https:\/\/example\.com\/hook/i,
      });
      expect(hook1Btn).toBeDisabled();
      expect(hook1Btn).toHaveTextContent(/testing/i);
    });

    // HOOK_2 button should still be enabled
    const hook2Btn = screen.getByRole('button', {
      name: /test delivery for https:\/\/other\.example\.com\/hook/i,
    });
    expect(hook2Btn).not.toBeDisabled();
    expect(hook2Btn).toHaveTextContent(/^Test$/);

    resolveTest({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ statusCode: 200, ok: true })),
    });
  });

  it('re-tests a webhook overwrites the previous result', async () => {
    const fetchMock = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ items: [HOOK_1] })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ statusCode: 500, ok: false })
          ),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ statusCode: 200, ok: true })
          ),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    render(<WebhooksPage />);
    await waitFor(() =>
      expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    );

    const testButton = screen.getByRole('button', {
      name: /test delivery for https:\/\/example\.com\/hook/i,
    });

    // First test — fails
    fireEvent.click(testButton);
    await waitFor(() =>
      expect(screen.getByText(/Failed \(500\)/i)).toBeInTheDocument()
    );

    // Second test — succeeds
    fireEvent.click(testButton);
    await waitFor(() =>
      expect(screen.getByText(/OK \(200\)/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Failed \(500\)/i)).not.toBeInTheDocument();
  });
});
