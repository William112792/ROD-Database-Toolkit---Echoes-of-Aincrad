# 0002 - Preparing Project in Unreal Engine

This guide walks through configuring Unreal Engine for Echoes of Aincrad modding —
from setting Io Store to Preparing Pak Chunking.
WARNING: If a true SDK Modkit is released it will be the standard that replaces 
this process aka Standard Operating Procedure (SOP)

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Create a Blank project named EchoesofAincrad

Select the Project Name and enter in EchoesofAincrad before selecting Create.
Optional: You can change the Project Location to another path such as an external or extended drive.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraohmc006j9.png)

## Step 2 — Loading Package

You will now see the package loading which is what you will see when re-launching a fresh package.
Optional: We can change this splash screen in the future if so desired.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraol6374gmz.png)

## Step 3 — Accessing Project Settings

Under Edit, go to Project Settings.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraomu56l7g9.png)

## Step 4 — Open Packaging under Project Settings

In Project Settings, select Packaging.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraonfkrbr6h.png)

## Step 5 — Use Pak File, Io Store, and Generate Chunks

In the Packaging settings, ensure "Use Pak Files" and "Use Io Store" are already checked.
Make sure to also check "Generate Chunks" on this same screen before closing the Project Settings.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraonozijbh7.png)

## Step 6 — Accessing Editor Preferences

Under Edit, go to Editor Preferences.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraooc8ozsj1.png)

## Step 7 — Open Experimental under Editor Preferences

In Editor Preferences, select Experimental.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraop8ie60pp.png)

## Step 8 — Set Allow ChunkID Assignments

In the Experimental settings, make sure to check "Allow ChunkID Assignments" 
on this same screen before closing the Editor Preferences.

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraoq2nigjd8.png)

## Step 9 — Optional: Change Splash Screen back under Project Settings

In Project Settings, search for Splash and you can select a BMP file as seen below 
in order to use a custom splash image for your project.

BMP Splash Image:
![screenshot](uploads/preparing-project-in-unreal-engine/EOA.bmp)

![screenshot](uploads/preparing-project-in-unreal-engine/img_mraoxuji1lgl.png)
![screenshot](uploads/preparing-project-in-unreal-engine/img_mrapf3fv348t.png)

Final Result:
![screenshot](uploads/preparing-project-in-unreal-engine/img_mrapg0hk8rwb.png)

---

## What's next

- Importing assets extracted with this toolkit — see the Asset Inspector and the
  per-asset download buttons for `psk`/`fbx`/`blend` files
- Repacking and testing in-game
- Installing UE4SS with Developer options and/or Tools like FModel

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.