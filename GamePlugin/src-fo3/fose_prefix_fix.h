/**
 * fose_prefix_fix.h — force-included prefix for the Fallout 3 target.
 *
 * The xFOSE sources are 2008-era MSVC code that relied on the old project's
 * precompiled header to pull in the C++ standard library; modern MSVC no
 * longer leaks <string>/<map> in transitively. Supplying them here (before
 * fose_prefix.h) lets the SDK sources compile untouched.
 */

#pragma once

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "fose_common/fose_prefix.h"
