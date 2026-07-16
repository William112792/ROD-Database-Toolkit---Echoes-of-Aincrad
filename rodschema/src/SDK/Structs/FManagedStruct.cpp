#include "SDK/Structs/FManagedStruct.h"
#include "Unreal/Core/HAL/UnrealMemory.hpp"
#include "Unreal/CoreUObject/UObject/Class.hpp"

using namespace RC;
using namespace RC::Unreal;

namespace ROD {
    FManagedStruct::FManagedStruct(UScriptStruct* Struct)
    {
        m_struct = Struct;
        m_data = FMemory::Malloc(Struct->GetStructureSize());
        Struct->InitializeStruct(m_data);
    }

    FManagedStruct::~FManagedStruct()
    {
        m_struct->DestroyStruct(m_data);
        FMemory::Free(m_data);
    }

    void* FManagedStruct::GetData()
    {
        return m_data;
    }
}
