#include <windows.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char* argv[]) {
    const char* src = NULL;
    const char* dst = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') {
            if (!src) {
                src = argv[i];
            } else if (!dst) {
                dst = argv[i];
            }
        }
    }
    if (!src || !dst) return 0;
    if (CopyFileA(src, dst, FALSE)) {
        return 0;
    }
    return 1;
}
