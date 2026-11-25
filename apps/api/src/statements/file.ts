import { parse } from "csv-parse/sync";
import {
  columnMappingSchema,
  readStatement,
  type ColumnMappingInput,
  type ParsedStatement,
} from "@cash-scout/domain";

/** How a statement file is laid out, before its columns are looked at. */
export interface CsvFormat {
  kind: "csv";
  /** A label the platform's decoder knows: "utf-8", "windows-1252"… */
  encoding: string;
  delimiter: ";" | "," | "\t";
}

/** A bank's statement layout: the file format and the columns. */
export interface StatementPreset {
  id: string;
  name: string;
  file: CsvFormat;
  mapping: ColumnMappingInput;
}

/** Reads a CSV file into a table of cells; a byte order mark is dropped. */
export function readCsvTable(content: Uint8Array, format: CsvFormat): string[][] {
  const text = new TextDecoder(format.encoding).decode(content);
  return parse(text, {
    bom: true,
    delimiter: format.delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];
}

/**
 * Reads a statement file with a preset: the lines, and the lines that could not be
 * read. Throws a `RangeError` when the file is not the one the preset describes.
 */
export function readStatementFile(
  content: Uint8Array,
  preset: StatementPreset,
  currency: string,
): ParsedStatement {
  return readStatement(
    readCsvTable(content, preset.file),
    columnMappingSchema.parse(preset.mapping),
    currency,
  );
}
