// Tiny stack VM: one file, Node stdlib only, answers i001..i040 in one run.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";

function run(p: Buffer, inp: Buffer): { out: Buffer; code: number } {
  const s: number[] = []; // data stack, at most 256
  const c: number[] = []; // call stack, at most 64
  const mem = new Int32Array(256);
  const o: number[] = []; // output bytes, at most 65536
  let pc = 0, ip = 0, steps = 0, code = -1;

  while (code < 0) {
    if (steps >= 1000000) { code = 10; break; } // step limit
    if (pc < 0 || pc >= p.length) { code = 9; break; } // pc outside program
    const op = p[pc];
    // Immediate length; unknown opcode traps 5 before the fit check.
    let len = 1;
    if (op === 0x01) len = 2;
    else if (op === 0x02) len = 5;
    else if (op === 0x30 || op === 0x31 || op === 0x32 || op === 0x33) len = 3;
    else if (
      !((op >= 0x10 && op <= 0x22) || (op >= 0x30 && op <= 0x34) ||
        (op >= 0x40 && op <= 0x41) || (op >= 0x50 && op <= 0x53) ||
        op === 0x00 || op === 0x03 || op === 0x04 || op === 0x05 ||
        op === 0x06 || op === 0x07)
    ) { code = 5; break; }
    if (pc + len > p.length) { code = 9; break; } // immediate cut off
    steps++;
    const need = (n: number): boolean => {
      if (s.length < n) { code = 2; return false; }
      return true;
    };
    const push = (v: number): boolean => {
      if (s.length >= 256) { code = 3; return false; }
      s.push(v | 0);
      return true;
    };
    const off = (): number => {
      const v = p[pc + 1] | (p[pc + 2] << 8);
      return v & 0x8000 ? v - 0x10000 : v;
    };
    switch (op) {
      case 0x00: code = 0; break; // HALT
      case 0x01: if (push((p[pc + 1] << 24) >> 24)) pc += 2; break; // PUSH8
      case 0x02: // PUSH32
        if (push(p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24))) pc += 5;
        break;
      case 0x03: if (need(1)) { s.pop(); pc += 1; } break; // POP
      case 0x04: if (need(1) && push(s[s.length - 1])) pc += 1; break; // DUP
      case 0x05: // SWAP
        if (need(2)) { const t = s[s.length - 1]; s[s.length - 1] = s[s.length - 2]; s[s.length - 2] = t; pc += 1; }
        break;
      case 0x06: if (need(2) && push(s[s.length - 2])) pc += 1; break; // OVER
      case 0x07: // ROT (a b c -- b c a)
        if (need(3)) {
          const a = s[s.length - 3];
          s[s.length - 3] = s[s.length - 2];
          s[s.length - 2] = s[s.length - 1];
          s[s.length - 1] = a;
          pc += 1;
        }
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (!need(2)) break;
        const b = s.pop() as number, a = s.pop() as number;
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) { code = 4; break; } r = (Math.trunc(a / b)) | 0; }
        else if (op === 0x14) { if (b === 0) { code = 4; break; } r = (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) { code = 4; break; } r = Math.trunc((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) { code = 4; break; } r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // 0x22 LTU
        s.push(r);
        pc += 1;
        break;
      }
      case 0x17: if (need(1)) { s[s.length - 1] = (-s[s.length - 1]) | 0; pc += 1; } break; // NEG
      case 0x1b: if (need(1)) { s[s.length - 1] = ~s[s.length - 1]; pc += 1; } break; // NOT
      case 0x30: pc = pc + 3 + off(); break; // JMP
      case 0x31: if (need(1)) { const v = s.pop() as number; pc = v === 0 ? pc + 3 + off() : pc + 3; } break; // JZ
      case 0x32: if (need(1)) { const v = s.pop() as number; pc = v !== 0 ? pc + 3 + off() : pc + 3; } break; // JNZ
      case 0x33: // CALL (unsigned target)
        if (c.length >= 64) { code = 7; break; }
        c.push(pc + 3);
        pc = p[pc + 1] | (p[pc + 2] << 8);
        break;
      case 0x34: // RET
        if (c.length === 0) { code = 8; break; }
        pc = c.pop() as number;
        break;
      case 0x40: // LOAD
        if (need(1)) {
          const a = s[s.length - 1];
          if (a < 0 || a > 255) { code = 6; break; }
          s[s.length - 1] = mem[a];
          pc += 1;
        }
        break;
      case 0x41: // STORE (v addr --), addr is top
        if (need(2)) {
          const a = s[s.length - 1], v = s[s.length - 2];
          if (a < 0 || a > 255) { code = 6; break; }
          mem[a] = v;
          s.pop(); s.pop();
          pc += 1;
        }
        break;
      case 0x50: // PRINT decimal ASCII, no newline
        if (need(1)) {
          const v = s.pop() as number;
          const t = String(v);
          if (o.length + t.length > 65536) { code = 11; break; }
          for (let i = 0; i < t.length; i++) o.push(t.charCodeAt(i));
          pc += 1;
        }
        break;
      case 0x51: // PUTC
        if (need(1)) {
          const v = s.pop() as number;
          if (o.length >= 65536) { code = 11; break; }
          o.push(v & 255);
          pc += 1;
        }
        break;
      case 0x52: if (push(ip < inp.length ? inp[ip++] : -1)) pc += 1; break; // IN
      case 0x53: if (need(1)) code = (s.pop() as number) & 255; break; // EXIT
    }
  }
  return { out: Buffer.from(o), code: code < 0 ? 0 : code };
}

for (let i = 1; i <= 40; i++) {
  const id = "i" + String(i).padStart(3, "0");
  const dir = join(IN_DIR, id);
  let prog: Buffer, inp: Buffer;
  try { prog = readFileSync(join(dir, "program.bin")); } catch { prog = Buffer.alloc(0); }
  try { inp = readFileSync(join(dir, "input.bin")); } catch { inp = Buffer.alloc(0); }
  const r = run(prog, inp);
  const od = join(OUT_DIR, id);
  mkdirSync(od, { recursive: true });
  writeFileSync(join(od, "stdout.bin"), r.out);
  writeFileSync(join(od, "exit.txt"), String(r.code) + "\n");
}
