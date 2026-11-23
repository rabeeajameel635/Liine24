// ffmpeg and ffprobe: the copies in app/bin (put there by install.sh) come first, then whatever is on the PATH (Homebrew).
// Imported for its side effect, before anything that runs them.
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = join(fileURLToPath(new URL('..', import.meta.url)), 'bin');
const path = (process.env.PATH ?? '').split(delimiter);
if (existsSync(bin) && !path.includes(bin)) process.env.PATH = [bin, ...path].join(delimiter);
