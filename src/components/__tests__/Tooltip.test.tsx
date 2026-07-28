import { render, screen } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

describe('Tooltip', () => {
  it('renders its trigger children', () => {
    render(
      <Tooltip status="success">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByRole('button', { name: /hover me/i })).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    render(
      <Tooltip status="loading">
        <span>trigger</span>
      </Tooltip>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('renders the empty state', () => {
    render(
      <Tooltip status="empty">
        <span>trigger</span>
      </Tooltip>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/no data/i);
  });

  it('renders the error state with the provided message', () => {
    render(
      <Tooltip status="error" message="Failed to load">
        <span>trigger</span>
      </Tooltip>
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/error/i);
    expect(status).toHaveTextContent(/failed to load/i);
  });

  it('renders the success state', () => {
    render(
      <Tooltip status="success">
        <span>trigger</span>
      </Tooltip>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/ready/i);
  });

  it('keeps states mutually exclusive (only one status message present)', () => {
    render(
      <Tooltip status="success" message="Done">
        <span>trigger</span>
      </Tooltip>
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/ready/i);
    expect(status).not.toHaveTextContent(/loading/i);
    expect(status).not.toHaveTextContent(/no data/i);
    expect(status).not.toHaveTextContent(/error/i);
  });

  it('exposes the status for assistive technology via aria-live', () => {
    render(
      <Tooltip status="loading">
        <span>trigger</span>
      </Tooltip>
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
