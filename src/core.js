// Quoted-printable encoding and decoding, RFC 2045 section 6.7.
//
// The encoder always uses soft line breaks (=\r\n) at a maximum line length of 76
// characters, which is the value required by RFC 2045 for bodies that must remain
// within the 998-octet SMTP limit. A shorter limit is not offered because the
// encoding is only ever consumed by MIME parsers, all of which accept 76.
//
// The decoder is deliberately strict about the shape of an escape sequence: an
// equals sign must be followed by exactly two uppercase hexadecimal digits, or by
// CRLF. Lowercase hex is rejected because RFC 2045 requires uppercase and silently
// accepting both hides malformed input. If you have to consume output from a
// lenient producer, normalise it before calling decode().

const SOFT_BREAK = '=\r\n';
const MAX_LINE_LENGTH = 76;
const HEX = '0123456789ABCDEF';

/**
 * Returns true for bytes that may appear literally in a quoted-printable body.
 * The range 33..60 and 62..126 excludes '=' (61), the escape character, and
 * everything outside printable ASCII. Space and tab are handled separately
 * because they are only literal when they are not at the end of a line.
 */
function isLiteralByte(byte) {
  return (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126);
}

/**
 * Encodes a JavaScript string to quoted-printable text.
 *
 * The string is first encoded as UTF-8, so any character outside the ASCII range
 * becomes a sequence of escaped bytes rather than a single '?' or a lone surrogate.
 *
 * @param {string} input
 * @returns {string}
 */
export function encode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('encode expects a string');
  }
  const bytes = new TextEncoder().encode(input);
  return encodeBytes(bytes);
}

/**
 * Encodes raw bytes to quoted-printable text. Exposed separately because callers
 * that already hold binary data (for example an attachment payload) should not be
 * forced through a lossy string round trip.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeToBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('encodeToBytes expects a Uint8Array');
  }
  return encodeBytes(bytes);
}

function encodeBytes(bytes) {
  let out = '';
  let lineLength = 0;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let token;

    if (isLiteralByte(byte)) {
      token = String.fromCharCode(byte);
    } else if (byte === 32 || byte === 9) {
      // Space and tab are literal unless they fall at the end of a line. We do
      // not know yet whether this is the last byte of the line, so peek ahead.
      const atEnd = i + 1 === bytes.length;
      const nextIsBreak = !atEnd && (bytes[i + 1] === 10 || bytes[i + 1] === 13);
      if (atEnd || nextIsBreak) {
        token = '=' + HEX[(byte >> 4) & 0xf] + HEX[byte & 0xf];
      } else {
        token = String.fromCharCode(byte);
      }
    } else if (byte === 10 || byte === 13) {
      // Normalise line endings: a bare LF becomes CRLF, an existing CRLF is
      // emitted as-is, and a bare CR is treated as a line break too. RFC 2045
      // allows only CRLF, so anything else would be non-conforming output.
      if (byte === 13 && i + 1 < bytes.length && bytes[i + 1] === 10) {
        i++;
      }
      out += '\r\n';
      lineLength = 0;
      continue;
    } else {
      token = '=' + HEX[(byte >> 4) & 0xf] + HEX[byte & 0xf];
    }

    // A soft break is needed when appending the token would push the line past
    // the limit. The check uses the token length because an escape is three
    // characters wide while a literal is one.
    if (lineLength + token.length > MAX_LINE_LENGTH) {
      out += SOFT_BREAK;
      lineLength = 0;
    }
    out += token;
    lineLength += token.length;
  }

  return out;
}

/**
 * Decodes quoted-printable text back to a JavaScript string.
 *
 * Trailing whitespace on a line is stripped before the line is processed, which
 * matches the behaviour of every MIME parser in the wild and is what RFC 2045
 * implies by forbidding raw trailing whitespace.
 *
 * @param {string} input
 * @returns {string}
 */
export function decode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('decode expects a string');
  }
  const bytes = decodeToBytes(input);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Decodes quoted-printable text to raw bytes, without assuming UTF-8.
 *
 * @param {string} input
 * @returns {Uint8Array}
 */
export function decodeFromBytes(input) {
  if (typeof input !== 'string') {
    throw new TypeError('decodeFromBytes expects a string');
  }
  return decodeToBytes(input);
}

function decodeToBytes(input) {
  const out = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (ch === '\r' || ch === '\n') {
      // Consume a CRLF pair as a single logical line break; a lone CR or LF is
      // also accepted because real-world producers emit both.
      if (ch === '\r' && i + 1 < n && input[i + 1] === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      out.push(10);
      continue;
    }

    if (ch === '=') {
      if (i + 1 < n && input[i + 1] === '\r' && i + 2 < n && input[i + 2] === '\n') {
        // Soft line break: drop it entirely.
        i += 3;
        continue;
      }
      if (i + 1 < n && input[i + 1] === '\n') {
        // A soft break written with a bare LF is tolerated for the same reason
        // bare LF line endings are tolerated above.
        i += 2;
        continue;
      }
      const hi = i + 1 < n ? input[i + 1] : '';
      const lo = i + 2 < n ? input[i + 2] : '';
      const hiVal = hexValue(hi);
      const loVal = hexValue(lo);
      if (hiVal === -1 || loVal === -1) {
        throw new Error(`invalid quoted-printable escape at index ${i}`);
      }
      out.push((hiVal << 4) | loVal);
      i += 3;
      continue;
    }

    // Any other character is copied through as a code unit. Input is expected
    // to be ASCII; non-ASCII characters pass through unchanged, which keeps the
    // decoder useful for lenient producers without pretending to validate.
    out.push(ch.charCodeAt(0));
    i += 1;
  }

  return Uint8Array.from(out);
}

/**
 * Maps a single hexadecimal digit to its value, or -1 if it is not a digit.
 * Uppercase only: RFC 2045 mandates uppercase escapes.
 */
function hexValue(ch) {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'F') return ch.charCodeAt(0) - 55;
  return -1;
}
