// Fast drop-in for csv-reader 1.0.0 — v3.
// Original single-pass implementation. Returns exactly csv-reader 1.0.0's
// answer for every input {text, header}: {columns, rows, errors}.
//
// Speed notes: unquoted fields are scanned with a tight charCodeAt loop and
// sliced in bulk (no per-field allocation beyond the slice itself); quoted
// fields jump from quote to quote with indexOf and only normalise a segment
// when it actually holds a line break; field results are written to shared
// locals, so no result object is allocated per field. Errors are only built
// when broken input really occurs.
//
// Semantics (from the published task text):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote, each CRLF or lone CR inside reads as LF; what
//   follows the closing quote, up to the next comma or line break, is appended
//   as it stands (quote_junk, when the field ends); a quote that never closes
//   is a literal character and the text after it is read again as unquoted
//   (unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds the
//   records after it, each padded (short_row, with fields: its field count) or
//   cut (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, row its record's index in rows (null for the
//   header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Errors are attributed to the record.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended (COMMA/LINE_BREAK/END) and
  // how many characters the unquoted scan kept. The field readers write these
  // instead of returning an object.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, appending to `init` ('' normally,
  // '"' when re-reading after an unterminated quote, or a quoted value when
  // reading junk after a closing quote). Writes fValue/fEnded/fAdded; fAdded
  // counts the characters kept by this scan (not the initial value, and not
  // dropped CRs). Updates pos and line. Records stray_cr errors.
  function unquoted(init) {
    let value = init;
    let added = 0;
    for (;;) {
      let end = pos;
      while (end < n) {
        const c = text.charCodeAt(end);
        if (c === 44 || c === 10 || c === 13) break;
        end++;
      }
      if (end >= n) {
        if (end > pos) {
          value += text.slice(pos, end);
          added += end - pos;
        }
        pos = end;
        fValue = value; fEnded = END; fAdded = added;
        return;
      }
      const c = text.charCodeAt(end);
      if (c === 44) {
        if (end > pos) {
          value += text.slice(pos, end);
          added += end - pos;
        }
        pos = end + 1;
        fValue = value; fEnded = COMMA; fAdded = added;
        return;
      }
      if (c === 10) {
        if (end > pos) {
          value += text.slice(pos, end);
          added += end - pos;
        }
        pos = end + 1;
        line++;
        fValue = value; fEnded = LINE_BREAK; fAdded = added;
        return;
      }
      // c === 13 (CR)
      if (end + 1 < n && text.charCodeAt(end + 1) === 10) {
        if (end > pos) {
          value += text.slice(pos, end);
          added += end - pos;
        }
        pos = end + 2;
        line++;
        fValue = value; fEnded = LINE_BREAK; fAdded = added;
        return;
      }
      // Lone CR: dropped (stray_cr), the field goes on past it.
      err('stray_cr');
      if (end > pos) {
        value += text.slice(pos, end);
        added += end - pos;
      }
      pos = end + 1;
    }
  }

  // Normalises one quoted segment: every CRLF or lone CR becomes one LF.
  // Only called for segments that actually hold a line break. Returns the
  // cleaned segment and counts the breaks it held.
  function foldSegment(seg) {
    let breaks = 0;
    const clean = seg.replace(/\r\n?|\n/g, () => {
      breaks++;
      return '\n';
    });
    return { clean, breaks };
  }

  // Reads a quoted field whose opening quote is at pos. Writes
  // fValue/fEnded/fAdded. Updates pos and line. Records unterminated_quote
  // and quote_junk errors.
  function quoted() {
    const open = pos;
    const openLine = line;
    // Walk from quote to quote with indexOf. A quote followed by another
    // quote is a doubled quote (one literal quote); the first quote not
    // followed by another is the closing quote.
    let seg = open + 1;
    let parts = null;
    let addLines = 0;
    let q = text.indexOf('"', open + 1);
    for (;;) {
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        err('unterminated_quote');
        unquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: keep the first of the pair in the slice and
        // resume after the second.
        let run = text.slice(seg, q + 1);
        if (run.indexOf('\r') !== -1 || run.indexOf('\n') !== -1) {
          const folded = foldSegment(run);
          addLines += folded.breaks;
          run = folded.clean;
        }
        if (parts === null) parts = [run];
        else parts.push(run);
        seg = q + 2;
        q = text.indexOf('"', q + 2);
        continue;
      }
      // The closing quote: fold the last segment and build the value.
      let tail = text.slice(seg, q);
      if (tail.indexOf('\r') !== -1 || tail.indexOf('\n') !== -1) {
        const folded = foldSegment(tail);
        addLines += folded.breaks;
        tail = folded.clean;
      }
      const value = parts === null ? tail : parts.join('') + tail;
      line += addLines;
      pos = q + 1;
      if (pos >= n) { fValue = value; fEnded = END; fAdded = 0; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        fValue = value; fEnded = COMMA; fAdded = 0;
        return;
      }
      if (c === 10) {
        pos++;
        line++;
        fValue = value; fEnded = LINE_BREAK; fAdded = 0;
        return;
      }
      if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        fValue = value; fEnded = LINE_BREAK; fAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      unquoted(value);
      if (fAdded > 0) err('quote_junk');
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let isQuoted = false;
    do {
      isQuoted = pos < n && text.charCodeAt(pos) === 34;
      if (isQuoted) quoted(); else unquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !isQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
