#pragma once
#include "Unreal/UnrealVersion.hpp"
#include <DynamicOutput/DynamicOutput.hpp>

// Thin wrapper matching PalSchema's PS::Log<Level>(fmt, args...) call
// shape, but routed through UE4SS's own DynamicOutput so log lines land
// in the same ue4ss/UE4SS.log the person is already checking (see
// README "Verifying it's actually injecting").
//
// NOTE: deliberately fully-qualifying the type as RC::LogLevel::LogLevel
// (not just RC::LogLevel) -- RC::LogLevel is a STRUCT wrapping a nested
// enum of the same name (a common C++ idiom for scoped-enum-like
// behavior); the real enum type is RC::LogLevel::LogLevel, confirmed by
// the compiler's own error messages repeatedly citing that exact
// qualified name when this was wrong. Enumerator VALUES like
// RC::LogLevel::Warning still resolve fine everywhere else in the
// codebase without change, since an unscoped enum nested in a struct of
// the same name injects its enumerators into the enclosing struct's
// scope -- it's specifically the TYPE name in this template parameter
// that needed the extra qualification.
namespace PS {
    template <RC::LogLevel::LogLevel Level = RC::LogLevel::LogLevel::Default, typename... Args>
    void Log(const RC::StringViewType fmt, Args&&... args)
    {
        RC::Output::send<Level>(fmt, std::forward<Args>(args)...);
    }
}
