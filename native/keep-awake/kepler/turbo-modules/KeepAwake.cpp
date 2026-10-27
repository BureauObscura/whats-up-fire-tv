#include "KeepAwake.h"

#include <apmf/iface/com/amazon/apmf/DeviceError.h>
#include <apmf/iface/com/amazon/apmf/NotSupportedError.h>
#include <apmf/iface/com/amazon/kepler/user_engagement/IKeplerUserEngagementModuleV2.h>

using apmf::iface::com::amazon::kepler::user_engagement::IKeplerUserEngagementModuleV2;

namespace whatsup {
    KeepAwake::KeepAwake() : TM_API_NAMESPACE::KeplerTurboModule("KeepAwake") {}

    void KeepAwake::aggregateMethods(TM_API_NAMESPACE::MethodAggregator<TM_API_NAMESPACE::KeplerTurboModule>& methodAggregator) const noexcept {
        methodAggregator.addMethod("start", 0, &KeepAwake::start);
        methodAggregator.addMethod("stop", 0, &KeepAwake::stop);
    }

    // The engagement object is made once; the app reports against video playback,
    // the capability the platform counts as "someone is watching".
    std::string KeepAwake::ensure() {
        if (engagement) return "";
        try {
            auto module = apmf::GetProcessObject()
                ->getComponent("/com.amazon.kepler.user_engagement.user_engagement_module")
                .TryQueryInterface<IKeplerUserEngagementModuleV2>();
            if (module == nullptr) return "IKeplerUserEngagementModuleV2 not found";
            engagement = module->makeVideoPlaybackUserEngagement();
            return engagement ? "" : "makeVideoPlaybackUserEngagement returned null";
        } catch (const apmf::NotSupportedError& e) {
            return std::string("NotSupportedError: ") + e.what();
        } catch (const apmf::DeviceError& e) {
            return std::string("DeviceError: ") + e.what();
        } catch (const std::exception& e) {
            return std::string("error: ") + e.what();
        } catch (...) {
            return "unknown error";
        }
    }

    std::string KeepAwake::start() {
        std::lock_guard<std::mutex> guard(lock);
        auto error = ensure();
        if (!error.empty()) return error;
        try { engagement->start(); return ""; }
        catch (const std::exception& e) { return std::string("start: ") + e.what(); }
        catch (...) { return "start: unknown error"; }
    }

    std::string KeepAwake::stop() {
        std::lock_guard<std::mutex> guard(lock);
        if (!engagement) return "";
        try { engagement->stop(); return ""; }
        catch (const std::exception& e) { return std::string("stop: ") + e.what(); }
        catch (...) { return "stop: unknown error"; }
    }
}
