import { useMemo, useState, type ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: string;
  tip?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: Row) => ReactNode;
  sortValue?: (row: Row) => number | string;
  className?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

interface Props<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  defaultSort: SortState;
  onRowClick?: (row: Row) => void;
  selectedKey?: string | null;
  emptyMessage: string;
  pageSize?: number;
  moreLabel: (remaining: number) => string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  defaultSort,
  onRowClick,
  selectedKey,
  emptyMessage,
  pageSize = 150,
  moreLabel,
}: Props<Row>) {
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [limit, setLimit] = useState(pageSize);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va === vb) return 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        if (Number.isNaN(va)) return 1;
        if (Number.isNaN(vb)) return -1;
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, columns, sort]);

  const visible = sorted.slice(0, limit);
  const remaining = sorted.length - visible.length;

  const toggleSort = (col: Column<Row>) => {
    if (!col.sortValue) return;
    setSort((s) =>
      s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.align === 'right' ? 'desc' : 'asc' },
    );
  };

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={[c.align ?? 'left', c.sortValue ? 'sortable' : '', sort.key === c.key ? `sorted-${sort.dir}` : ''].join(' ')}
                title={c.tip}
                onClick={() => toggleSort(c)}
                scope="col"
              >
                <span>{c.header}</span>
                {sort.key === c.key && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {emptyMessage}
              </td>
            </tr>
          )}
          {visible.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                className={[onRowClick ? 'clickable' : '', selectedKey === k ? 'selected' : ''].join(' ')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={[c.align ?? 'left', c.className ?? ''].join(' ')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {remaining > 0 && (
        <button type="button" className="btn btn--ghost table-more" onClick={() => setLimit((l) => l + pageSize)}>
          {moreLabel(remaining)}
        </button>
      )}
    </div>
  );
}
