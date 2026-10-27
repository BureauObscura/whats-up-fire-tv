#ifndef KEEPAWAKE_H
#define KEEPAWAKE_H

#include "Kepler/turbomodule/KeplerTurboModule.h"
#include <apmf/apmf_base.h>
#include <apmf/ptr.h>
#include <apmf/process.h>
#include <apmf/iface/com/amazon/kepler/user_engagement/IUserEngagement.h>

#include <mutex>
#include <string>

#define TM_API_NAMESPACE com::amazon::kepler::turbomodule

namespace whatsup {
    // Tells Vega the user is engaged (or not) with what's on screen, through the
    // User Engagement API (com.amazon.kepler.user_engagement). While engaged, the
    // system holds off its idle state (the screensaver / ambient experience).
    class KeepAwake: public TM_API_NAMESPACE::KeplerTurboModule {
    public:
        KeepAwake();
        void aggregateMethods(TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>& methodAggregator) const noexcept;

        // Both return "" on success, else the error text.
        std::string start();
        std::string stop();

    private:
        std::string ensure();
        std::mutex lock;
        apmf::Ptr<apmf::iface::com::amazon::kepler::user_engagement::IUserEngagement> engagement;
    };
}
#endif  // KEEPAWAKE_H
