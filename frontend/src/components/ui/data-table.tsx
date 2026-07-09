import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  render?: (row: Row) => ReactNode;
  className?: string;
}

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyMessage: string;
}

/** Minimal semantic table for admin/list views; column content via render(). */
export function DataTable<Row>({ columns, rows, rowKey, emptyMessage }: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("px-4 py-3 font-medium", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-hairline last:border-b-0">
              {columns.map((column) => (
                <td key={column.key} className={cn("px-4 py-3 text-body", column.className)}>
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
