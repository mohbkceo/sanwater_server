const { parentPort, workerData } = require("node:worker_threads");
function validateArchive(buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) return;
  const limit = 25 * 1024 * 1024;
  let end = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p--)
    if (buffer.readUInt32LE(p) === 0x06054b50) {
      end = p;
      break;
    }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6))
    throw new Error("Invalid or multipart XLSX archive");
  const count = buffer.readUInt16LE(end + 10);
  if (count > 256) throw new Error("Workbook has too many archive entries");
  let cursor = buffer.readUInt32LE(end + 16),
    total = 0;
  for (let n = 0; n < count; n++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw new Error("Invalid workbook directory");
    const method = buffer.readUInt16LE(cursor + 10),
      compressed = buffer.readUInt32LE(cursor + 20),
      expanded = buffer.readUInt32LE(cursor + 24),
      local = buffer.readUInt32LE(cursor + 42);
    total += expanded;
    if (
      total > limit ||
      buffer.readUInt16LE(cursor + 8) & 1 ||
      ![0, 8].includes(method) ||
      local + 30 > buffer.length ||
      buffer.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error(
        "Workbook expands beyond limits or is encrypted/unsupported",
      );
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length)
      throw new Error("Invalid workbook entry");
    const bytes = buffer.subarray(start, start + compressed);
    const content =
      method === 8
        ? require("node:zlib").inflateRawSync(bytes, { maxOutputLength: limit })
        : bytes;
    if (content.length !== expanded)
      throw new Error("Workbook expanded size does not match directory");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}
try {
  const XLSX = require("xlsx");
  const buffer = Buffer.from(workerData.buffer);
  validateArchive(buffer);
  const csv = workerData.format === '.csv';
  const source = csv ? new TextDecoder('utf-8', { fatal: true }).decode(buffer) : buffer;
  if (csv && /^\s*<(?:!doctype|html|table|\?xml)/i.test(source)) throw new Error('CSV must be UTF-8 delimited text');
  const workbook = XLSX.read(source, {
    type: csv ? 'string' : "buffer",
    codepage: 65001,
    sheetRows: 1002,
    cellFormula: true,
    raw: true,
    dense: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("No worksheet found");
  const range = XLSX.utils.decode_range(
    sheet["!fullref"] || sheet["!ref"] || "A1",
  );
  if (range.e.r > 1000 || range.e.c > 63)
    throw new Error("Maximum 1000 data rows and 64 columns");
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (matrix.length < 2)
    throw new Error("File must contain a header and data rows");
  const columns = matrix.shift().map(String);
  if (
    columns.some(
      (c) =>
        !c ||
        c.length > 100 ||
        ["__proto__", "prototype", "constructor"].includes(c),
    ) ||
    new Set(columns).size !== columns.length
  )
    throw new Error("Invalid or duplicate column names");
  const rows = matrix.map((row, index) => ({
    rowNumber: index + 2,
    raw: Object.fromEntries(
      columns.map((c, n) => [c, String(row[n] ?? "").slice(0, 3000)]),
    ),
  }));
  parentPort.postMessage({ columns, rows });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
