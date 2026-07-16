# 0003 - Initial Project Packaged Build in Unreal Engine

This guide walks through packaging Echoes of Aincrad for 
the platform to generate pak, ucas, and utoc.
WARNING: If a true SDK Modkit is released it will be the standard that replaces 
this process aka Standard Operating Procedure (SOP)

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Launch your EchoesofAincrad Project

Launch your EchoesofAincrad project created with Unreal Engine 5.3.2

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqwtk1se81.png)

## Step 2 — Set Shipping and Package Project

Under Platforms and Windows, select Shipping then Package Project

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqwyay7o9w.png)

## Step 3 — Create and Select Build folder

You will want to create a Build folder for the game files to get generated in. 
Typically a Build folder in your Project works well for this but can be 
any folder on any drive your prefer. The Paks folder below this will contain or 
packaged mods per chunkID.

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqx73w8yh1.png)

## Step 4 — Packaging Project and Output Log view

You will see a "Packaging project for Windows..." Toast Notification while the project 
is being cooked and packaged. Selecting "Show Output Log" will show you details on 
the progress of the current package.

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqxcdp598v.png)

## Step 5 — Confirm Build Successful in Tail of Output Log

Once the packaging process has completed you should see something in the Output Log 
that says "BUILD SUCCESSFUL" with the duration of time it took.
WARNING: Larger projects and SDK Modkits can take a lot longer for initial packaging.

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqxi0f4rh2.png)

## Step 6 — Reference: Any action including reimports is logged in Output Log

As you import assets or change assets you will get notifications to re-import. 
You can follow any action or change in the Output Log to troubleshoot issues or changes.

![screenshot](uploads/initial-project-packaged-build-in-unreal-engine/img_mraqxnrwjnh4.png)

---

## What's next

- Importing assets extracted with this toolkit — see the Asset Inspector and the
  per-asset download buttons for `psk`/`fbx`/`blend` files
- Repacking and testing in-game
- Installing UE4SS with Developer options and/or Tools like FModel

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.