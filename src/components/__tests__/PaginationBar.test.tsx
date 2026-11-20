import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { loadedLabel, PaginationBar } from '../PaginationBar';

const base = {
  page: 0,
  pageSize: 50,
  pageSizeOptions: [50],
  totalLoaded: 200,
  hasMore: true,
  fetchingMore: false,
  onPageChange: jest.fn(),
  onPageSizeChange: jest.fn(),
};

describe('PaginationBar total', () => {
  it('formats the loaded label honestly', () => {
    expect(loadedLabel(200, true, 1207)).toBe('200 of 1,207 loaded');
    expect(loadedLabel(1207, false, 1207)).toBe('1,207 rows loaded');
    expect(loadedLabel(200, true)).toBe('200 rows loaded+');
    expect(loadedLabel(30, false)).toBe('30 rows loaded');
  });

  it('shows the total and a Load all button when the total is known', () => {
    const onLoadAll = jest.fn();
    render(<PaginationBar {...base} total={1207} onLoadAll={onLoadAll} />);
    expect(screen.getByText('200 of 1,207 loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load all 1,207' }));
    expect(onLoadAll).toHaveBeenCalled();
  });

  it('keeps the old wording and no Load all when the total is unknown', () => {
    render(<PaginationBar {...base} />);
    expect(screen.getByText('200 rows loaded+')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load all/ })).toBeNull();
  });
});
