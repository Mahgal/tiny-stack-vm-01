// tiny-stack-vm-01: a trap-exact interpreter for make.fun's tiny stack ISA v1
// (kit's generator/subject/ISA.md). Node 22, stdlib only. For each instance
// under /input/<id> it runs program.bin on input.bin and writes the bytes the
// program wrote to /output/<id>/stdout.bin and its exit code to exit.txt.
// Every trap, limit and edge case follows the ISA exactly, including the ones
// the house baseline gets wrong: exact 32-bit MUL, unsigned DIVU/MODU/LTU,
// INT_MIN / -1, remainder signs, shift counts masked to 5 bits, PUSH8 sign
// extension, EXIT's low byte, and all ten traps with their own exit codes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode byte -> [immediate bytes, values popped, values pushed].
const T: Record<number, [number, number, number] | undefined> = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0],
  0x04: [0, 1, 2], 0x05: [0, 2, 2], 0x06: [0, 2, 3], 0x07: [0, 3, 3],
  0x10: [0, 2, 1], 0x11: [0, 2, 1], 0x12: [0, 2, 1], 0x13: [0, 2, 1],
  0x14: [0, 2, 1], 0x15: [0, 2, 1], 0x16: [0, 2, 1], 0x17: [0, 1, 1],
  0x18: [0, 2, 1], 0x19: [0, 2, 1], 0x1a: [0, 2, 1], 0x1b: [0, 1, 1],
  0x1c: [0, 2, 1], 0x1d: [0, 2, 1], 0x1e: [0, 2, 1], 0x20: [0, 2, 1],
  0x21: [0, 2, 1], 0x22: [0, 2, 1], 0x30: [2, 0, 0], 0x31: [2, 1, 0],
  0x32: [2, 1, 0], 0x33: [2, 0, 0], 0x34: [0, 0, 0], 0x40: [0, 1, 1],
  0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1],
  0x53: [0, 1, 0],
};

const enc = new TextEncoder();

function run(prog: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const S = new Int32Array(256);
  const R = new Int32Array(64);
  const M = new Int32Array(256);
  const O = new Uint8Array(65536);
  let sp = 0, rp = 0, ol = 0, ip = 0, pc = 0, st = 0;
  const end = (code: number) => ({ out: O.slice(0, ol), code });
  for (;;) {
    if (st === 1000000) return end(10);
    if (pc < 0 || pc >= prog.length) return end(9);
    const ob = prog[pc];
    const meta = T[ob];
    if (meta === undefined) return end(5);
    const [imm, pops, pushes] = meta;
    if (pc + imm >= prog.length) return end(9);
    st++;
    const nx = pc + 1 + imm;
    if (sp < pops) return end(2);
    if (sp - pops + pushes > 256) return end(3);
    pc = nx;
    switch (ob) {
      case 0x00: return end(0);
      case 0x01: S[sp++] = (prog[nx - 1] << 24) >> 24; break;
      case 0x02: S[sp++] = prog[nx - 4] | (prog[nx - 3] << 8) | (prog[nx - 2] << 16) | (prog[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: S[sp] = S[sp - 1]; sp++; break;
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; }
      case 0x06: S[sp] = S[sp - 2]; sp++; break;
      case 0x07: { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; break; }
      case 0x17: S[sp - 1] = (-S[sp - 1]) | 0; break;
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = S[sp - 1], a = S[sp - 2];
        let r: number;
        if (ob === 0x10) r = (a + b) | 0;
        else if (ob === 0x11) r = (a - b) | 0;
        else if (ob === 0x12) r = Math.imul(a, b);
        else if (ob === 0x13) { if (b === 0) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (ob === 0x14) { if (b === 0) return end(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (ob === 0x15) { if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (ob === 0x16) { if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (ob === 0x18) r = a & b;
        else if (ob === 0x19) r = a | b;
        else if (ob === 0x1a) r = a ^ b;
        else if (ob === 0x1c) r = a << (b & 31);
        else if (ob === 0x1d) r = a >> (b & 31);
        else if (ob === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (ob === 0x20) r = a === b ? 1 : 0;
        else if (ob === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; S[sp++] = r; break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        let go = true;
        if (ob !== 0x30) { const v = S[--sp]; go = ob === 0x31 ? v === 0 : v !== 0; }
        if (go) pc = nx + rel;
        break;
      }
      case 0x33:
        if (rp === 64) return end(7);
        R[rp++] = nx; pc = prog[nx - 2] | (prog[nx - 1] << 8); break;
      case 0x34:
        if (rp === 0) return end(8);
        pc = R[--rp]; break;
      case 0x40: {
        const addr = S[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        S[sp - 1] = M[addr]; break;
      }
      case 0x41: {
        const addr = S[sp - 1], v = S[sp - 2];
        if (addr < 0 || addr >= 256) return end(6);
        sp -= 2; M[addr] = v; break;
      }
      case 0x50: {
        const bytes = enc.encode(String(S[sp - 1]));
        if (ol + bytes.length > 65536) return end(11);
        sp--; O.set(bytes, ol); ol += bytes.length; break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        O[ol++] = S[--sp] & 255; break;
      case 0x52:
        S[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53:
        return end(S[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
