import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListToolbar } from './ListToolbar';

const baseProps = {
  headline: '42 properties',
  onlyHidden: false,
  onExitHiddenMode: vi.fn(),
  showSavedChip: false,
  onlySaved: false,
  onToggleOnlySaved: vi.fn(),
  savedCount: 0,
  showHiddenChip: false,
  showHidden: false,
  onToggleShowHidden: vi.fn(),
  hiddenCount: 0,
  sortBy: 'dealScore' as const,
  onChangeSort: vi.fn(),
  hasRankingData: false,
};

describe('ListToolbar', () => {
  it('renders the headline', () => {
    render(<ListToolbar {...baseProps} headline="123 properties" />);
    expect(screen.getByText('123 properties')).toBeInTheDocument();
  });

  it('hides the saved chip when showSavedChip=false', () => {
    render(<ListToolbar {...baseProps} showSavedChip={false} savedCount={5} />);
    // No "Saved" chip when the flag is off, even with non-zero count.
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it('shows the saved chip with count when enabled', () => {
    render(<ListToolbar {...baseProps} showSavedChip savedCount={7} />);
    expect(screen.getByText(/Saved 7/)).toBeInTheDocument();
  });

  it('shows the hidden-mode banner with an Exit button', async () => {
    const onExit = vi.fn();
    render(
      <ListToolbar {...baseProps} onlyHidden onExitHiddenMode={onExit} />,
    );
    expect(screen.getByText(/Showing hidden listings only/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /exit/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('omits "Recommended for you" sort option until ranking data exists', () => {
    const { rerender } = render(<ListToolbar {...baseProps} hasRankingData={false} />);
    const select = screen.getByLabelText(/sort/i) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.value);
    expect(optionTexts).not.toContain('recommended');

    rerender(<ListToolbar {...baseProps} hasRankingData />);
    const updated = screen.getByLabelText(/sort/i) as HTMLSelectElement;
    const updatedTexts = Array.from(updated.options).map((o) => o.value);
    expect(updatedTexts).toContain('recommended');
  });

  it('fires onChangeSort with the selected option value', async () => {
    const onChange = vi.fn();
    render(<ListToolbar {...baseProps} onChangeSort={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/sort/i), 'priceAsc');
    expect(onChange).toHaveBeenCalledWith('priceAsc');
  });
});
