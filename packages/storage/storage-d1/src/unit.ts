/**
 * One opened D1 KV unit: table/global reads and writes issued as individual
 * D1 REST query calls. Each primitive is one HTTP round trip, atomic on D1's
 * side; like the SQLite backend, this unit runs no local write queue — write
 * ordering is the caller's responsibility per the KV contract.
 * @module @deepseek-ai/dsh-storage-d1/unit
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import type { D1Client } from '@deepseek-ai/dsh-d1-client'
import { recordTableName } from './schema.ts'

/**
 * The D1 {@link KvUnit}. Constructed by the backend AFTER the unit's record
 * tables exist. Values are stored as JSON text in the `value` column, same
 * physical layout as the SQLite backend.
 */
export class D1KvUnit implements KvUnit {
  private closed = false

  /**
   * @param client - Client bound to the owning database.
   * @param descriptor - Validated descriptor whose record tables already exist.
   * @param onClose - Backend callback releasing this unit's open-name slot.
   */
  constructor(
    private readonly client: D1Client,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.ensureOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const name of this.descriptor.tables) {
      const result = await this.client.query(`SELECT key, value FROM "${recordTableName(this.descriptor.name, name)}"`)
      // Null prototype: record keys are arbitrary strings, so '__proto__'
      // must land as an own property instead of mutating the prototype.
      const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      for (const row of result.results as unknown as Array<{ key: string; value: string }>) {
        records[row.key] = this.parseValue(row.value, `table '${name}' key '${row.key}'`)
      }
      tables[name] = records
    }
    let global: unknown = null
    if (this.descriptor.hasGlobal) {
      const result = await this.client.query('SELECT value FROM unit_globals WHERE unit = ?', [this.descriptor.name])
      const row = result.results[0] as { value: string } | undefined
      if (row !== undefined) global = this.parseValue(row.value, 'global slot')
    }
    return { tables, global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.ensureOpen()
    const physical = this.physicalTable(table)
    // JSON.stringify can propagate a value's own toJSON throw; wrap non-Error
    // throws so the Promise-returning contract never rejects with a bare value.
    let json: string
    try {
      json = JSON.stringify(value)
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    await this.client.query(
      `INSERT INTO "${physical}" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, json],
    )
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.ensureOpen()
    await this.client.query(`DELETE FROM "${this.physicalTable(table)}" WHERE key = ?`, [key])
  }

  async setGlobal(value: unknown): Promise<void> {
    this.ensureOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
    }
    await this.client.query(
      'INSERT INTO unit_globals (unit, value) VALUES (?, ?) ON CONFLICT(unit) DO UPDATE SET value = excluded.value',
      [this.descriptor.name, JSON.stringify(value)],
    )
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  private physicalTable(table: string): string {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    }
    return recordTableName(this.descriptor.name, table)
  }

  /** Parse one stored value column, mapping bad JSON to `malformed-medium`. */
  private parseValue(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StorageError(
        'malformed-medium',
        `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`,
        { cause: error },
      )
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
    }
  }
}
