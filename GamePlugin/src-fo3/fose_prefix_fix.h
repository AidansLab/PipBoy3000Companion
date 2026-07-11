/*
 * Copyright (c) 2026 Aidan Lee-Calamera (aka Aidan's Lab). 
 * All rights reserved.
 *
 * This source code is licensed under the Creative Commons
 * Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0).
 *
 * You are free to share and adapt this code under the following conditions:
 *  - Attribution: You must give appropriate credit and provide a link to the license.
 *  - Non-Commercial: You may not use this material for commercial purposes.
 *  - ShareAlike: If you alter, transform, or build upon this work, you must
 *    distribute your contributions under the same CC BY-NC-SA 4.0 license.
 *
 * You may obtain a full copy of the License text in the LICENSE file in the
 * root directory of this project repository or online at:
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

/**
 * fose_prefix_fix.h - force-included prefix for the Fallout 3 target.
 *
 * The FOSE sources are 2008-era MSVC code that relied on the old project's
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
