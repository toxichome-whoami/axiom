/*
 * Axiom Zero-Bloat Toolchain Shim
 * Dispatches GCC/Clang/AR/DLLTool calls to Zig for seamless C/C++ compilation
 * in Rust crates (ring, libsql-sys, aws-lc-sys) without requiring MSYS64 or Visual Studio.
 */

#include <process.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

int main(int argc, char* argv[]) {
    const char* exe = argv[0];
    const char* subcmd = "cc";
    int is_dlltool = 0;

    if (strstr(exe, "dlltool") != NULL) {
        subcmd = "dlltool";
        is_dlltool = 1;
    } else if (strstr(exe, "g++") != NULL || strstr(exe, "c++") != NULL || strstr(exe, "clang++") != NULL) {
        subcmd = "c++";
    } else if (strstr(exe, "ar") != NULL) {
        subcmd = "ar";
    }

    // Check for dlltool -m flag
    int has_m = 0;
    if (is_dlltool) {
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "-m") == 0) {
                has_m = 1;
                break;
            }
        }
    }

    // Allocate space for zig, subcmd, maybe -m i386:x86-64, plus translated arguments
    char** new_argv = (char**)malloc((argc + 8) * sizeof(char*));
    if (!new_argv) return 1;

    int out_idx = 0;
    new_argv[out_idx++] = "zig";
    new_argv[out_idx++] = (char*)subcmd;

    if (is_dlltool && !has_m) {
        new_argv[out_idx++] = "-m";
        new_argv[out_idx++] = "i386:x86-64";
    }

    if (!is_dlltool && strcmp(subcmd, "ar") != 0) {
        new_argv[out_idx++] = "-Wno-date-time";
        new_argv[out_idx++] = "-fno-sanitize=all";
    }

    for (int i = 1; i < argc; i++) {
        char* arg = argv[i];
        if (strcmp(arg, "--target=x86_64-pc-windows-gnu") == 0) {
            new_argv[out_idx++] = "-target";
            new_argv[out_idx++] = "x86_64-windows-gnu";
        } else if (strcmp(arg, "-target") == 0 && i + 1 < argc && strcmp(argv[i + 1], "x86_64-pc-windows-gnu") == 0) {
            new_argv[out_idx++] = "-target";
            new_argv[out_idx++] = "x86_64-windows-gnu";
            i++;
        } else if (strcmp(arg, "x86_64-pc-windows-gnu") == 0) {
            new_argv[out_idx++] = "x86_64-windows-gnu";
        } else {
            new_argv[out_idx++] = arg;
        }
    }
    new_argv[out_idx] = NULL;

    intptr_t ret = _spawnvp(_P_WAIT, "zig", (const char* const*)new_argv);
    free(new_argv);
    return (int)ret;
}
