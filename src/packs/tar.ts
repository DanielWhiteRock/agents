import { gzipSync } from "node:zlib";
import type { PackTree } from "./tree.js";

/**
 * A pack folder as a tar.gz, so "download the pack" hands back a real
 * directory rather than a bespoke bundle.
 *
 * tar is a fixed 512-byte-header format and writing it is a page of code, which
 * is cheaper than a dependency and means `tar xzf` works everywhere without
 * anyone installing our tooling.
 */
const BLOCK = 512;

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function header(path: string, size: number, mtime: Date): Buffer {
  const buf = Buffer.alloc(BLOCK);
  // ustar splits long paths across name and prefix; a pack's paths are short,
  // so a name longer than 100 bytes is refused rather than silently truncated.
  if (Buffer.byteLength(path, "utf8") > 100) {
    throw new Error(`path too long for a tar entry: ${path}`);
  }
  buf.write(path, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100, 8, "ascii");       // mode
  buf.write(octal(0, 8), 108, 8, "ascii");           // uid
  buf.write(octal(0, 8), 116, 8, "ascii");           // gid
  buf.write(octal(size, 12), 124, 12, "ascii");
  buf.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, "ascii");
  buf.write("        ", 148, 8, "ascii");            // checksum placeholder: spaces
  buf.write("0", 156, 1, "ascii");                   // type: regular file
  buf.write("ustar\0", 257, 6, "ascii");
  buf.write("00", 263, 2, "ascii");

  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(octal(sum, 7), 148, 7, "ascii");
  buf.write("\0", 155, 1, "ascii");
  return buf;
}

function pad(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

export function tarball(tree: PackTree, rootDir: string, mtime = new Date()): Buffer {
  const parts: Buffer[] = [];
  for (const file of [...tree].sort((a, b) => a.path.localeCompare(b.path))) {
    const body = Buffer.from(file.content, "utf8");
    parts.push(header(`${rootDir}/${file.path}`, body.length, mtime), body, pad(body.length));
  }
  // Two zero blocks end the archive.
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

export function tarGz(tree: PackTree, rootDir: string, mtime = new Date()): Buffer {
  return gzipSync(tarball(tree, rootDir, mtime), { level: 9 });
}
