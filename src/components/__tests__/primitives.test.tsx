import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../IconButton';
import { Button } from '../Button';
import { StarButton } from '../StarButton';
import { EmptyEvents } from '../EmptyEvents';
import { TimeFilter } from '../TimeFilter';

describe('IconButton', () => {
  it('exposes its aria-label as the accessible name and has a 44px hit area class', () => {
    render(<IconButton aria-label="Close"><svg /></IconButton>);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('min-h-11');
    expect(btn.className).toContain('min-w-11');
  });

  it('reflects aria-pressed', () => {
    const { rerender } = render(<IconButton aria-label="Bold" aria-pressed={false}><svg /></IconButton>);
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<IconButton aria-label="Bold" aria-pressed><svg /></IconButton>);
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('complains loudly when the label is missing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // @ts-expect-error aria-label is required by the type
    render(<IconButton><svg /></IconButton>);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('aria-label'));
    err.mockRestore();
  });
});

describe('Button', () => {
  it('defaults to type=button and a 44px minimum height', () => {
    render(<Button>Go</Button>);
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toContain('min-h-11');
  });
});

describe('StarButton', () => {
  it('keeps a stable label and toggles aria-pressed', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<StarButton eventId="e1" isStarred={false} onToggle={onToggle} />);
    const btn = screen.getByRole('button', { name: 'Add to plan' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledWith('e1');
    rerender(<StarButton eventId="e1" isStarred onToggle={onToggle} />);
    const pressed = screen.getByRole('button', { name: 'Add to plan' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes friends going to assistive tech', () => {
    render(<StarButton eventId="e1" isStarred={false} onToggle={() => {}} friendsCount={3} />);
    expect(screen.getByRole('button', { name: /Add to plan/ })).toHaveTextContent('3 friends going');
  });

  it('does not use a hard-coded white hover background', () => {
    render(<StarButton eventId="e1" isStarred={false} onToggle={() => {}} />);
    expect(document.body.innerHTML).not.toContain('bg-white');
  });
});

describe('EmptyEvents', () => {
  it('shows the active filters and Clear all calls back', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<EmptyEvents activeFilters={['Search: "yoga"', 'AI']} onClearFilters={onClear} />);
    const list = screen.getByRole('list', { name: 'Active filters' });
    expect(list).toHaveTextContent('Search: "yoga"');
    expect(list).toHaveTextContent('AI');
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('hides Clear all when nothing is filtered', () => {
    render(<EmptyEvents activeFilters={[]} onClearFilters={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });
});

describe('TimeFilter', () => {
  it('shows the current value, opens a radio menu and reports the choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeFilter value="off" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Time filter: Any time' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Any time', 'Happening now', 'Today', 'Tomorrow']);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Tomorrow' }));
    expect(onChange).toHaveBeenCalledWith('tomorrow');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('supports arrow keys and Escape', async () => {
    const user = userEvent.setup();
    render(<TimeFilter value="today" onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Time filter: Today/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Today' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Tomorrow' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
