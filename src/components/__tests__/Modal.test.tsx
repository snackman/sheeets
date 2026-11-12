import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open it</button>
      {open && (
        <Modal
          labelledBy="t"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <h2 id="t">Title</h2>
          <button>first</button>
          <input aria-label="field" />
          <button>last</button>
        </Modal>
      )}
    </div>
  );
}

describe('Modal', () => {
  it('has dialog semantics, labelled by its title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('open it'));
    const dialog = screen.getByRole('dialog', { name: 'Title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus to the first focusable element, and locks scroll', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('open it'));
    expect(screen.getByText('first')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('open it'));
    await user.tab();
    expect(screen.getByLabelText('field')).toHaveFocus();
    await user.tab();
    expect(screen.getByText('last')).toHaveFocus();
    await user.tab(); // wraps
    expect(screen.getByText('first')).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards
    expect(screen.getByText('last')).toHaveFocus();
  });

  it('closes on Escape, returns focus to the opener and unlocks scroll', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText('open it');
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('returns focus to the opener even when a child uses autoFocus', async () => {
    const user = userEvent.setup();
    function AutoFocusHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && (
            <Modal ariaLabel="auto" onClose={() => setOpen(false)}>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input aria-label="email" autoFocus />
            </Modal>
          )}
        </div>
      );
    }
    render(<AutoFocusHarness />);
    await user.click(screen.getByText('opener'));
    expect(screen.getByLabelText('email')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByText('opener')).toHaveFocus();
  });

  it('closes on backdrop click but not on panel click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('open it'));
    await user.click(screen.getByText('Title'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector('[data-modal-backdrop]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the topmost of stacked modals handles Escape', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal ariaLabel="outer" onClose={outer}>
          <button>o</button>
        </Modal>
        <Modal ariaLabel="inner" onClose={inner}>
          <button>i</button>
        </Modal>
      </>,
    );
    await user.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps scroll locked until the last stacked modal closes', () => {
    const a = render(<Modal ariaLabel="a" onClose={() => {}}><button>a</button></Modal>);
    const b = render(<Modal ariaLabel="b" onClose={() => {}}><button>b</button></Modal>);
    b.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    a.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
