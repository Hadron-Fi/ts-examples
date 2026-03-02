#include <stdlib.h>

// Shim for glibc 2.38's __isoc23_strtol — just forwards to strtol.
// Allows litesvm's native binary (compiled on glibc 2.38+) to run on
// older glibc (e.g. Ubuntu 22.04 with glibc 2.35).
//
// Build:  gcc -shared -o strtol_shim.so strtol_shim.c
// Usage:  LD_PRELOAD=./strtol_shim.so npm run depth-curves

long __isoc23_strtol(const char *nptr, char **endptr, int base) {
    return strtol(nptr, endptr, base);
}

long long __isoc23_strtoll(const char *nptr, char **endptr, int base) {
    return strtoll(nptr, endptr, base);
}

unsigned long __isoc23_strtoul(const char *nptr, char **endptr, int base) {
    return strtoul(nptr, endptr, base);
}

unsigned long long __isoc23_strtoull(const char *nptr, char **endptr, int base) {
    return strtoull(nptr, endptr, base);
}
