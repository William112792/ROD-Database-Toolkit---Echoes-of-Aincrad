#pragma once

#include <functional>
#include <unordered_map>
#include <string>
#include <mutex>
#include <cstdint>

namespace RC::Unreal {
    class UDataTable;
}

namespace ROD {
    using DatatableSerializeCallback = std::function<void(RC::Unreal::UDataTable*)>;
    using DatatableSerializeCallbackId = uint64_t;

    // Ported from PalSchema's UDataTableRegistry. Every table that passes
    // through the UDataTable::Serialize hook gets recorded here by name, so
    // loaders can look up a table on demand (e.g. for auto-reload) without
    // needing to wait for another Serialize event.
    //
    // NOTE: PalSchema's version also tracks a parent-table-name ->
    // UCompositeDataTable map, for Palworld's custom composite-datatable
    // engine subclass (multiple source tables merged into one at runtime).
    // We have NOT confirmed EOA uses an equivalent composite-datatable
    // pattern anywhere, so that piece is deliberately left out here rather
    // than ported speculatively. Add it back if we find EOA has the same
    // mechanism.
    class RODDataTableRegistry {
    public:
        RC::Unreal::UDataTable* GetDatatableByName(const std::string& name);

        DatatableSerializeCallbackId RegisterDatatableSerializeCallback(const DatatableSerializeCallback& callback);
        void UnregisterDatatableSerializeCallback(const DatatableSerializeCallbackId& callbackId);

        void Add(const std::string& name, RC::Unreal::UDataTable* datatable);
        void Add(RC::Unreal::UDataTable* datatable);

    private:
        std::mutex m_mutex;
        std::unordered_map<std::string, RC::Unreal::UDataTable*> m_datatableMap;
        std::unordered_map<DatatableSerializeCallbackId, DatatableSerializeCallback> m_callbackMap;

        static DatatableSerializeCallbackId GenerateDatatableSerializeCallbackId();
    };
}
