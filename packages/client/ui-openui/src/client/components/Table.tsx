/** React implementation of the curated `Table` OpenUI component. */

export interface TableProps {
  columns: string[]
  rows: string[][]
}

/** Render an OpenUI `Table` as a plain semantic HTML table of text cells. */
export function Table({ columns, rows }: TableProps) {
  return (
    <table data-openui-component="Table">
      <thead>
        <tr>
          {columns.map((column, index) => <th key={`col-${index}`}>{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
