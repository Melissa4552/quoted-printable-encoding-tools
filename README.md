# quoted-printable-encoding-tools

Encodes and decodes text containing non-ASCII characters into a 7-bit ASCII-safe format using equals signs, following RFC 2045.

```js
import { encode, decode } from 'quoted-printable-encoding-tools';

const encoded = encode('café');
// 'caf=C3=A9'

decode(encoded);
// 'café'
```

The package exports four names: `encode`, `decode`, `encodeToBytes`, and `decodeFromBytes`.

## Why this exists

Quoted-printable is the encoding MIME uses when a message is mostly readable ASCII but
contains the occasional accented letter or emoji. Writing it by hand is fiddly because
the escape width varies (one character for literals, three for escapes) and the line
length limit counts the characters actually written, not the input bytes. This library
handles that accounting so callers can treat encoding as a single function call.

The trade-off is strictness on the decoding side. The decoder rejects lowercase
hexadecimal escapes and truncated escapes instead of guessing. Producers that emit
`=c3=a9` rather than `=C3=A9` are non-conforming, and silently accepting them would
make the decoder's output depend on how lenient it happened to be that day. If you
need to consume such input, uppercase it first.

## Awkward edge

Trailing whitespace is special in quoted-printable. A space or tab at the end of a
line must be escaped, because a MIME parser is allowed to strip it. The encoder escapes
only whitespace that actually falls at the end of a line, so `'a b '` becomes `'a b=20'`
while `'a b c'` is unchanged. The decoder strips nothing itself; it trusts the encoder
to have escaped correctly and treats every escaped byte literally.

## API

- `encode(text)` — UTF-8 encodes `text` and returns quoted-printable ASCII.
- `decode(text)` — decodes quoted-printable ASCII to a UTF-8 string.
- `encodeToBytes(bytes)` — encodes a `Uint8Array` without a string round trip.
- `decodeFromBytes(text)` — decodes to a `Uint8Array` without assuming UTF-8.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

