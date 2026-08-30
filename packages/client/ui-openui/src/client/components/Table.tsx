/** React implementation of the curated `Table` OpenUI component. */
import css from './Table.module.css'

export interface TableProps {
  columns: string[]
  rows: string[][]
}

/** A cell reading as a signed delta (`+12%`, `-3.4`), rendered as a colored pill instead of plain text. */
const SIGNED_DELTA = /^[+-]\d/

/** Render one table cell: a signed-delta value gets a colored pill, everything else is plain text. */
function Cell({ value }: { value: string }) {
  if (!SIGNED_DELTA.test(value)) return value
  const negative = value.startsWith('-')
  return <span className={`${css.delta} ${negative ? css.deltaNegative : css.deltaPositive}`}>{value}</span>
}

/** Render an OpenUI `Table` as a styled HTML table of text cells. */
export function Table({ columns, rows }: TableProps) {
  return (
    <div className={css.wrapper}>
      <table className={css.table} data-openui-component="Table">
        <thead>
          <tr>
            {columns.map((column, index) => <th key={`col-${index}`} className={css.headCell}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className={css.row}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className={css.cell}><Cell value={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
