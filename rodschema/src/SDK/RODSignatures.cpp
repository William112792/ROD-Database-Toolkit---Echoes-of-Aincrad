#include "SDK/RODSignatures.h"
#include "Signatures.hpp"
#include "SigScanner/SinglePassSigScanner.hpp"
#include "Utility/Logging.h"
#include "Helpers/String.hpp"
#include "ASMHelper/ASMHelper.hpp"

using namespace RC;
using namespace RC::Unreal;

namespace ROD {
    void SignatureManager::Initialize()
    {
        std::vector<SignatureContainer> SigContainerBox;
        SinglePassScanner::SignatureContainerMap SigContainerMap;

        for (auto& [ClassAndName, Signature] : Signatures)
        {
            if (Signature.empty())
            {
                // Placeholder not yet found -- skip scanning for it
                // entirely rather than feeding an empty pattern to the
                // scanner. GetSignature() will correctly return nullptr
                // for this entry, and callers already handle that (log +
                // no-op) per RODMainLoader's hook setup functions.
                PS::Log<LogLevel::Warning>(STR("[RODSchema] Signature for {} is not yet set -- skipping.\n"), RC::to_generic_string(ClassAndName));
                continue;
            }

            SignatureContainer SigContainer = [=]() -> SignatureContainer {
                return {
                    {{Signature}},
                    [=](SignatureContainer& self) {
                        void* FunctionPointer = static_cast<void*>(self.get_match_address());

                        SignatureMap.emplace(ClassAndName, FunctionPointer);
                        PS::Log<LogLevel::Normal>(STR("[RODSchema] Found {}: {}\n"), RC::to_generic_string(ClassAndName), FunctionPointer);

                        self.get_did_succeed() = true;

                        return true;
                    },
                    [=](const SignatureContainer& self) {
                        if (!self.get_did_succeed())
                        {
                            PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to find signature for {}.\n"), RC::to_generic_string(ClassAndName));
                        }
                    }
                };
            }();
            SigContainerBox.emplace_back(SigContainer);
        }

        for (auto& [ClassAndName, Signature] : SignaturesCallResolve)
        {
            if (Signature.empty())
            {
                PS::Log<LogLevel::Warning>(STR("[RODSchema] Call-resolve signature for {} is not yet set -- skipping.\n"), RC::to_generic_string(ClassAndName));
                continue;
            }

            SignatureContainer SigContainer = [=]() -> SignatureContainer {
                return {
                    {{Signature}},
                    [=](SignatureContainer& self) {
                        void* FunctionPointer = static_cast<void*>(self.get_match_address());
                        void* FinalAddress = ASM::resolve_call(FunctionPointer);

                        SignatureMap.emplace(ClassAndName, FinalAddress);
                        PS::Log<LogLevel::Normal>(STR("[RODSchema] Found {}: {}\n"), RC::to_generic_string(ClassAndName), FinalAddress);

                        self.get_did_succeed() = true;

                        return true;
                    },
                    [=](const SignatureContainer& self) {
                        if (!self.get_did_succeed())
                        {
                            PS::Log<LogLevel::Error>(STR("[RODSchema] Failed to find call-resolve signature for {}.\n"), RC::to_generic_string(ClassAndName));
                        }
                    }
                };
            }();
            SigContainerBox.emplace_back(SigContainer);
        }

        SigContainerMap.emplace(ScanTarget::MainExe, SigContainerBox);
        SinglePassScanner::start_scan(SigContainerMap);
    }

    void* SignatureManager::GetSignature(const std::string& ClassAndFunction)
    {
        auto It = SignatureMap.find(ClassAndFunction);
        if (It != SignatureMap.end())
        {
            return It->second;
        }

        return nullptr;
    }
}
