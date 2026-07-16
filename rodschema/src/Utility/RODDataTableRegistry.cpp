#include "Utility/RODDataTableRegistry.h"
#include "Unreal/Engine/UDataTable.hpp"
#include "Unreal/NameTypes.hpp"
#include <atomic>

using namespace RC;
using namespace RC::Unreal;

namespace ROD {
    UDataTable* RODDataTableRegistry::GetDatatableByName(const std::string& name)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_datatableMap.find(name);
        return it != m_datatableMap.end() ? it->second : nullptr;
    }

    DatatableSerializeCallbackId RODDataTableRegistry::GenerateDatatableSerializeCallbackId()
    {
        static std::atomic<uint64_t> counter{ 0 };
        return ++counter;
    }

    DatatableSerializeCallbackId RODDataTableRegistry::RegisterDatatableSerializeCallback(const DatatableSerializeCallback& callback)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto id = GenerateDatatableSerializeCallbackId();
        m_callbackMap.emplace(id, callback);
        return id;
    }

    void RODDataTableRegistry::UnregisterDatatableSerializeCallback(const DatatableSerializeCallbackId& callbackId)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_callbackMap.erase(callbackId);
    }

    void RODDataTableRegistry::Add(const std::string& name, UDataTable* datatable)
    {
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_datatableMap[name] = datatable;
        }

        // Snapshot callbacks under lock, invoke outside it, so a callback
        // that itself calls back into the registry can't deadlock.
        std::vector<DatatableSerializeCallback> callbacksSnapshot;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            for (auto& [id, cb] : m_callbackMap) callbacksSnapshot.push_back(cb);
        }
        for (auto& cb : callbacksSnapshot) cb(datatable);
    }

    void RODDataTableRegistry::Add(UDataTable* datatable)
    {
        if (!datatable) return;
        Add(RC::to_string(datatable->GetName()), datatable);
    }
}
