#pragma once

namespace RC::Unreal {
    class UScriptStruct;
}

namespace ROD {
    // A wrapper for UScriptStruct that automatically allocates and deallocates
    // memory for the struct data in constructor/destructor. Should only be
    // passed to functions that make a copy of the internal data, like
    // UDataTable::AddRow.
    //
    // Direct, unmodified port from PalSchema's FManagedStruct -- this is
    // pure generic Unreal Engine UScriptStruct reflection (GetStructureSize/
    // InitializeStruct/DestroyStruct are engine API, not Palworld or EOA
    // specific), so nothing needed to change here.
    class FManagedStruct {
    public:
        FManagedStruct(RC::Unreal::UScriptStruct* Struct);

        ~FManagedStruct();

        void* GetData();
    private:
        void* m_data;
        RC::Unreal::UScriptStruct* m_struct;
    };
}
