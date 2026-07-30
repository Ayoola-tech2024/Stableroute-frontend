import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  let onChange: jest.Mock;

  beforeEach(() => {
    onChange = jest.fn();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    // jsdom does not implement matchMedia; the toggle resolves the
    // effective theme through it when the stored preference is "system".
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });
  });

  it('persists theme preference to localStorage', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(window.localStorage.getItem('stableroute.theme')).toBe('dark');
  });

  it('marks the selected theme as pressed', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(screen.getByRole('button', { name: 'light' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'dark' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('toggles the dark class on the document root', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('calls onChange with the selected theme', () => {
    render(<ThemeToggle onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('calls onChange for every theme selection', () => {
    render(<ThemeToggle onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, 'light');
    expect(onChange).toHaveBeenNthCalledWith(2, 'dark');
    expect(onChange).toHaveBeenNthCalledWith(3, 'system');
  });

  it('does not crash when onChange is omitted', () => {
    expect(() => render(<ThemeToggle />)).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    // No crash means the optional callback is handled correctly
  });
});
