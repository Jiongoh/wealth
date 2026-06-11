import type { Key, ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";

export type DataTableColumn<Row> = {
  key: keyof Row;
  header: ReactNode;
  align?: "left" | "center" | "right";
  render?: (value: Row[keyof Row], row: Row) => ReactNode;
};

type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  emptyMessage?: string;
  getRowKey?: (row: Row, index: number) => Key;
  getRowClassName?: (row: Row, index: number) => string | undefined;
  getRowHref?: (row: Row, index: number) => string | undefined;
};

export function DataTable<Row>({
  columns,
  rows,
  emptyMessage = "No data available.",
  getRowKey = (_, index) => index,
  getRowClassName,
  getRowHref,
}: DataTableProps<Row>) {
  return (
    <div className="data-table-wrapper soft-scrollbar">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={alignmentClass(column.align)}
                key={String(column.key)}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="empty-row">
              <td className="data-table-empty" colSpan={columns.length}>
                <EmptyState message={emptyMessage} title="Nothing to show yet" />
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const rowHref = getRowHref?.(row, index);

              return (
                <tr
                  className={joinClassNames(getRowClassName?.(row, index), rowHref ? "data-table-clickable-row" : undefined)}
                  key={getRowKey(row, index)}
                  onClick={rowHref ? () => window.location.assign(rowHref) : undefined}
                  onKeyDown={
                    rowHref
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            window.location.assign(rowHref);
                          }
                        }
                      : undefined
                  }
                  role={rowHref ? "link" : undefined}
                  tabIndex={rowHref ? 0 : undefined}
                >
                  {columns.map((column) => {
                    const value = row[column.key];

                    return (
                      <td
                        className={alignmentClass(column.align)}
                        key={String(column.key)}
                      >
                        {column.render ? column.render(value, row) : String(value ?? "--")}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function alignmentClass(align: DataTableColumn<unknown>["align"]): string | undefined {
  if (align === "center") {
    return "align-center";
  }
  if (align === "right") {
    return "align-right";
  }
  return undefined;
}

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  const className = classNames.filter(Boolean).join(" ");
  return className || undefined;
}
