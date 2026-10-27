/*
* Copyright (c) 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
*
* PROPRIETARY/CONFIDENTIAL
* Use is subject to license terms.
*/
#include "turbo-modules/KeepAwake.h"

#include <Kepler/turbomodule/KeplerTurboModuleRegistration.h>

extern "C" {
__attribute__((visibility("default"))) void
    autoLinkKeplerTurboModulesV1() noexcept {
        // Currently, the macro argument cannot be namespace-qualified.
        using namespace whatsup;
        KEPLER_REGISTER_TURBO_MODULE(KeepAwake);
 }
 }
