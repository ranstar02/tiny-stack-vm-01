# Tiny Stack VM

A tiny stack virtual machine for make.fun's tiny stack ISA, in one file
(`main.ts`, Node 22, standard library only).

Run locally:

```sh
MAKEFUN_INPUT_DIR=<input-dir> MAKEFUN_OUTPUT_DIR=<output-dir> node main.ts
```

It answers all 40 instances (`i001`..`i040`) in one run, writing
`<id>/stdout.bin` and `<id>/exit.txt` for each.
